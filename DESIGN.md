# ClefQuest — Design Document

This document describes the technical design and implementation decisions behind ClefQuest.

## Overview

ClefQuest is a single-user web application for practicing sight-reading. It uses a lightweight Python/Flask backend to serve HTML templates and persist user accounts and round results in a local SQLite database. The client is a plain JavaScript application that renders notation with VexFlow, plays sounds via Tone.js (gated by a user gesture), and stores score metadata to the server via fetch requests.

## Architecture

- Server: Flask application (`app.py`). Responsible for authentication (register/login/logout), serving templates, handling CSRF protection, persisting scores, and computing aggregated statistics and a time-series "ClefScore" rating.
- Database: SQLite (`database.db`) with two primary tables: `users` and `scores`.
  - `users` stores username and password hash.
  - `scores` stores per-round results (score integer, user_id, created_at timestamp, and a JSON `meta` field with round details).
- Frontend: static files in `static/` and Jinja templates in `templates/`.
  - `static/game.js` orchestrates the game loop: create a question, render using VexFlow, accept user input, update timer and score, and call the server to save round results.
  - `templates/stats.html` renders the ClefScore chart using Chart.js (with a date adapter) and shows recent rounds.

## Key implementation details

### Notation and input

- VexFlow is used to draw notes on a staff. The app prefers CDN builds and falls back to `static/vendor/vexflow.min.js` if the CDN fails.
- Input parsing converts user-entered note names (A, A#, Bb, etc.) to semitone values for comparison. Enharmonic equivalence (e.g., A# == Bb) is accepted.

### Audio

- Tone.js produces audio for note playback. Browsers require a user gesture to enable audio, so the UI shows an "Enable sound" button that calls `Tone.start()` before playback.

### Range selection

- A vertical range selector constrains which notes (by MIDI/semitone range) may be chosen. The frontend translates the two endpoints into a pool of notes used for random selection.

### Scoring and persistence

- Each round collects: score (integer), difficulty, questions-per-round target, actual questions answered, time-per-question, and an array of question details in JSON meta.
- Save endpoint (`/save_score`) writes a row in `scores` with an explicit `created_at` timestamp (server local time) to avoid timezone display issues in the UI.

### ClefScore (ELO-like rating)

- The ClefScore is computed server-side by replaying saved rounds in chronological order and updating a numeric rating using an ELO-like update rule.
- Design choices:
  - The opponent strength is derived from difficulty (e.g., easy=800, medium=1000, hard=1200).
  - A fixed K-factor (e.g., 32) controls the update magnitude.
  - Each round's contribution to the rating is based on the normalized score (win/lose expectation) for that round.
- Keeping the replay deterministic on the server ensures the same rating for users across machines and avoids tiny per-client divergences.

### Charting

- Chart.js visualizes the ClefScore time series. The implementation uses a category (even spacing) x-axis so rounds are equally spaced visually even if they were saved at irregular intervals; a tooltip shows the exact local timestamp for each point.
- The app loads Chart.js and the `chartjs-adapter-date-fns` adapter from CDNs and falls back to local vendor files in `static/vendor/`.

### Security

- Passwords are stored as hashes using Werkzeug's utilities.
- CSRF protection is implemented via Flask-WTF's `CSRFProtect` and templates include the CSRF token where required.
- Logout is performed via POST to avoid CSRF-prone GET operations.

## Data model (high level)

- users(id, username, password_hash, created_at)
- scores(id, user_id, score, created_at, meta JSON)

The `meta` JSON currently includes difficulty, time_per_question, questions_target, questions_answered, and an array of question details.

## Trade-offs & alternatives

- Why Flask? Flask keeps the backend simple and easy to reason about for a small CS50-style project. A Node.js server could also work, but Flask integrates cleanly with SQLite and Python-based grading logic.
- Why category x-axis for the chart? Time-based x-axes showed large gaps when users had sparse play history; category spacing provides a clearer visual trend for rating evolution while tooltips provide exact timestamps.
- ELO-like rating vs. statistical smoothing: ELO provides a simple, well-understood update model that is easy to explain and reproduce. More sophisticated models (Bayesian skill rating, time-decay) could be added later.

## Future improvements

- Add per-question correctness logging for more rigorous analysis and per-question feedback.
- Offer export (CSV) of rounds and a downloadable snapshot of the ClefScore history.
- Add server-side unit tests and a small test harness for the ClefScore replay algorithm.
- Improve accessibility of the range selector and keyboard navigation for the note buttons.

## Notes for contributors

- Run the app locally following the README instructions.
- When adding vendor JS files, keep the CDN + local-fallback pattern used in the templates.
- Keep `templates/index.html` element IDs stable — `static/game.js` depends on specific IDs (`#staff_container`, `#note_input`, `#start_round_btn`, etc.).

