# ClefQuest — Sight Reading Trainer

ClefQuest is a browser-based sight-reading practice game served by a Python/Flask backend. The client uses JavaScript (VexFlow for notation, Tone.js for audio) and saves per-user rounds to a local SQLite database.

This README is a short, practical guide to run and use the project locally.

## Quick start (macOS / zsh)

Install dependencies for your user:

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

- Answer using the input box (press Enter) or use the note buttons. Enharmonic equivalents are accepted (A# == Bb).
- The vertical range selector chooses which notes may appear.
- Press "Enable sound" to allow Tone.js audio (browser requires a user gesture).

## Troubleshooting

- If `flask` is not found, run using `python3 -m flask`.
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
