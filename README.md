# ClefQuest — Sight Reading Trainer

ClefQuest is a browser-based sight-reading practice game served by a Python/Flask backend. The client uses JavaScript (VexFlow for notation, Tone.js for audio) and saves per-user rounds to a local SQLite database.

This README is a short, practical guide to run and use the project locally.

## Quick start (macOS / zsh)

Note: using a Python virtual environment is recommended but optional. If you already install Python packages globally or prefer `--user`, you can skip the venv steps.

### Option A — (recommended) use a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
```

### Option B — run without a virtual environment

Install dependencies for your user (no venv required):

```bash
python3 -m pip install --user --upgrade pip
python3 -m pip install --user -r requirements.txt
```

Run the app (either option):

```bash
# from the project root
python3 -m flask --app app.py run --port 5001
# or
python3 app.py
```

Open a browser at http://127.0.0.1:5001/

## Main pages

- `/` — the game. Configure difficulty, timed/untimed rounds, seconds-per-question, and the playable vertical range. Click Start Round to begin.
- `/stats` — aggregated scores and your ClefScore evolution chart.
- `/register` and `/login` — create an account to save rounds.

## Quick gameplay notes

- Answer using the input box (press Enter) or use the note buttons. Enharmonic spellings are accepted (A# == Bb).
- The vertical range selector chooses which notes may appear.
- Press "Enable sound" to allow Tone.js audio (browser requires a user gesture).

## Troubleshooting

- If `flask` is not found, either activate the virtual environment (if you created one) or run using `python3 -m flask`.
- If the chart does not appear, ensure the CDN is reachable or the local vendor files in `static/vendor/` exist.
- If VexFlow rendering errors appear, the app will fall back to `static/vendor/vexflow.min.js`.

## Video demo (optional)

Paste your short demo video (YouTube URL) here:

Video URL: <PASTE_YOUR_VIDEO_URL_HERE>

## Developer notes

- Backend: `app.py` (Flask). DB: `database.db` (SQLite).
- Frontend: `static/game.js` (VexFlow rendering, input parsing, timer, range selector, saving scores).
- Templates: `templates/*.html` (Jinja2). Styles: `static/styles.css`.
- Vendor JS fallbacks live in `static/vendor/`.

If you want screenshots, Docker instructions, or automated tests added to this README, tell me what to include and I'll expand it.
