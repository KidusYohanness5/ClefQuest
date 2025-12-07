import os
import sqlite3
from flask import Flask, render_template, request, redirect, url_for, session, flash, g
import json
import math
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from flask_wtf import CSRFProtect


app = Flask(__name__)
# Use an environment variable for production; use a default for local dev
app.secret_key = os.environ.get('FLASK_SECRET', 'dev-secret-change-me')

# Initialize CSRF protection (templates can use {{ csrf_token() }})
csrf = CSRFProtect(app)

# Database file
DB_PATH = os.path.join(os.path.dirname(__file__), 'database.db')


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


def init_db():
    db = get_db()
    db.execute(
        """CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        );"""
    )
    # Keep a history of user scores over time
    db.execute(
        """CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            score INTEGER NOT NULL,
            meta TEXT,
            difficulty TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );"""
    )
    # Ensure the difficulty column exists for older databases: PRAGMA table_info
    db.commit()
    try:
        cols = [r['name'] for r in db.execute("PRAGMA table_info(scores)").fetchall()]
        if 'difficulty' not in cols:
            db.execute("ALTER TABLE scores ADD COLUMN difficulty TEXT;")
            db.commit()
    except Exception:
        # If PRAGMA or ALTER fails (older sqlite builds), ignore - table likely new
        pass


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


@app.before_request
def load_logged_in_user():
    """If a user id is stored in the session, load the user object into `g.user`.
    Templates can then access `current_user` via the context processor below.
    """
    user_id = session.get('user_id')
    if user_id is None:
        g.user = None
    else:
        try:
            g.user = get_db().execute('SELECT id, username FROM users WHERE id = ?', (user_id,)).fetchone()
        except Exception:
            g.user = None


@app.context_processor
def inject_current_user():
    """Make `current_user` available in all templates (None if not logged in)."""
    return {'current_user': getattr(g, 'user', None)}


@app.route('/')
def index():
    """Show the main game page"""
    return render_template('index.html')


@app.route('/save_score', methods=['POST'])
def save_score():
    """Persist a user's score. Accepts form-encoded or JSON POST with 'score' and optional 'meta'.
    Returns JSON when submitted as JSON, otherwise redirects back to index with flash.
    """
    # Ensure DB/tables exist
    init_db()
    user_id = session.get('user_id')
    if user_id is None:
        if request.is_json:
            return {'error': 'authentication required'}, 401
        flash('You must be logged in to save scores.', 'error')
        return redirect(url_for('login'))

    # Accept JSON or form post
    score_val = None
    meta = None
    if request.is_json:
        payload = request.get_json() or {}
        score_val = payload.get('score')
        meta = payload.get('meta')
    else:
        score_val = request.form.get('score')
        meta = request.form.get('meta')

    try:
        score_int = int(score_val)
    except Exception:
        if request.is_json:
            return {'error': 'invalid score'}, 400
        flash('Invalid score provided.', 'error')
        return redirect(url_for('index'))

    db = get_db()
    # Try extract difficulty from meta JSON for easier aggregation
    difficulty_val = None
    try:
        parsed = json.loads(meta) if meta else {}
        difficulty_val = parsed.get('difficulty') if isinstance(parsed, dict) else None
    except Exception:
        difficulty_val = None
    # store created_at in server local time so listings and clefseries reflect local time
    try:
        created_local = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        db.execute('INSERT INTO scores (user_id, score, meta, difficulty, created_at) VALUES (?, ?, ?, ?, ?)', (user_id, score_int, meta, difficulty_val, created_local))
    except Exception:
        # fallback to default behavior (let DB set CURRENT_TIMESTAMP)
        db.execute('INSERT INTO scores (user_id, score, meta, difficulty) VALUES (?, ?, ?, ?)', (user_id, score_int, meta, difficulty_val))
    db.commit()

    if request.is_json:
        return {'status': 'ok'}
    flash('Score saved.', 'success')
    return redirect(url_for('index'))


@app.route('/register', methods=['GET', 'POST'])
def register():
    init_db()
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        if not username or not password:
            flash('Username and password are required.', 'error')
            return render_template('register.html')
        db = get_db()
        try:
            db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)',
                       (username, generate_password_hash(password)))
            db.commit()
        except sqlite3.IntegrityError:
            flash('Username already taken.', 'error')
            return render_template('register.html')
        # Log the user in
        user = db.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone()
        session.clear()
        session['user_id'] = user['id']
        flash('Registration successful. You are now logged in.', 'success')
        return redirect(url_for('index'))
    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    init_db()
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        if user is None:
            flash('Invalid username or password.', 'error')
            return render_template('login.html')
        if not check_password_hash(user['password_hash'], password):
            flash('Invalid username or password.', 'error')
            return render_template('login.html')
        session.clear()
        session['user_id'] = user['id']
        flash('Logged in successfully.', 'success')
        return redirect(url_for('index'))
    return render_template('login.html')


@app.route('/stats')
def stats():
    init_db()
    user_id = session.get('user_id')
    if user_id is None:
        flash('Please log in to view your stats.', 'error')
        return redirect(url_for('login'))

    db = get_db()
    # Aggregates
    agg = db.execute('SELECT COUNT(*) AS cnt, AVG(score) AS avg_score, SUM(score) AS total FROM scores WHERE user_id = ?', (user_id,)).fetchone()
    # Averages per difficulty
    avg_easy = db.execute("SELECT AVG(score) AS avg FROM scores WHERE user_id = ? AND difficulty = 'easy'", (user_id,)).fetchone()['avg']
    avg_medium = db.execute("SELECT AVG(score) AS avg FROM scores WHERE user_id = ? AND difficulty = 'medium'", (user_id,)).fetchone()['avg']
    avg_hard = db.execute("SELECT AVG(score) AS avg FROM scores WHERE user_id = ? AND difficulty = 'hard'", (user_id,)).fetchone()['avg']
    recent = db.execute('SELECT score, meta, created_at, difficulty FROM scores WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', (user_id,)).fetchall()
    # Parse meta JSON (if present) and produce a human-friendly string
    processed = []
    for r in recent:
        meta_raw = r['meta'] if r['meta'] is not None else ''
        meta_pretty = ''
        try:
            m = json.loads(meta_raw) if meta_raw else {}
            parts = []
            if 'difficulty' in m and m['difficulty'] is not None:
                parts.append(f"Difficulty: {m['difficulty']}")
            if 'questions' in m and m['questions'] is not None:
                parts.append(f"Questions: {m['questions']}")
            meta_pretty = ' '.join(parts)
        except Exception:
            # if meta isn't JSON, just show raw
            meta_pretty = meta_raw
        processed.append({'created_at': r['created_at'], 'score': r['score'], 'meta_pretty': meta_pretty})
    # Compute ClefScore (ELO-like) by replaying all rounds in chronological order
    clefscore = 1000.0
    K = 32.0
    # opponent ratings by difficulty: easy is 'weaker' opponent (so wrongs cost more), hard is 'stronger'
    opp = {'easy': 800.0, 'medium': 1000.0, 'hard': 1200.0}
    # Fetch all rounds for this user in chronological order
    all_rounds = db.execute('SELECT score, meta, difficulty, created_at FROM scores WHERE user_id = ? ORDER BY created_at ASC', (user_id,)).fetchall()
    # collect a time-series of ClefScore after each round for plotting
    clefseries = []

    for rr in all_rounds:
        # determine difficulty for the round
        d = rr['difficulty'] if rr['difficulty'] else None
        # try fallback to meta JSON
        q = None
        try:
            m = json.loads(rr['meta']) if rr['meta'] else {}
            if isinstance(m, dict):
                if not d and 'difficulty' in m:
                    d = m.get('difficulty')
                q = int(m.get('questions')) if m.get('questions') not in (None, '') else None
        except Exception:
            pass
        # If no difficulty or questions info, skip this round for ClefScore
        if not d or not q or q == 0:
            continue
        d = d if d in ('easy', 'medium', 'hard') else 'medium'
        # Compute number correct and wrong from net score and total questions
        S = int(rr['score'])
        Q = int(q)
        # correct = (Q + S)/2, wrong = Q - correct
        correct = int(round((Q + S) / 2.0))
        wrong = Q - correct
        # Play corrects first then wrongs (order matters slightly)
        prev_score = clefscore
        for _ in range(correct):
            expect = 1.0 / (1.0 + 10 ** ((opp[d] - clefscore) / 400.0))
            clefscore += K * (1.0 - expect)
        for _ in range(wrong):
            expect = 1.0 / (1.0 + 10 ** ((opp[d] - clefscore) / 400.0))
            clefscore += K * (0.0 - expect)
        # record the clefscore after this round (use integer for display) and delta
        delta = int(round(clefscore)) - int(round(prev_score))
        # normalize created_at to an ISO8601-like string (server may store 'YYYY-MM-DD HH:MM:SS')
        created_at_val = rr['created_at']
        created_iso = None
        try:
            if isinstance(created_at_val, str):
                # try common SQLite timestamp format
                created_iso = datetime.strptime(created_at_val, '%Y-%m-%d %H:%M:%S').isoformat(sep='T')
            else:
                created_iso = str(created_at_val)
        except Exception:
            try:
                # fallback: attempt conversion via generic str -> datetime
                created_iso = datetime.fromisoformat(str(created_at_val)).isoformat()
            except Exception:
                created_iso = str(created_at_val)

        clefseries.append({'created_raw': rr['created_at'], 'created_at': created_iso, 'clefscore': int(round(clefscore)), 'delta': delta})

    clefscore_display = int(round(clefscore))

    # attach clefscore delta to recent processed rows when possible
    delta_map = {c['created_raw']: c['delta'] for c in clefseries}
    for p in processed:
        try:
            p['clef_delta'] = delta_map.get(p['created_at'])
        except Exception:
            p['clef_delta'] = None

    return render_template('stats.html', agg=agg, recent=processed, avg_easy=avg_easy, avg_medium=avg_medium, avg_hard=avg_hard, clefscore=clefscore_display, clefseries=clefseries)


@app.route('/logout', methods=['POST'])
def logout():
    # Logout should be a POST to avoid CSRF via simple links; CSRFProtect will validate token
    session.clear()
    flash('Logged out.', 'info')
    return redirect(url_for('index'))


if __name__ == '__main__':
    # Allow selecting port via PORT env var (defaults to 5001 to avoid macOS service on 5000)
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=True, host='127.0.0.1', port=port)