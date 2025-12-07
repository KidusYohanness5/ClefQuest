// Minimal VexFlow staff renderer and simple note-guessing logic
// Start the game once DOM is ready and VexFlow is available. If VexFlow isn't
// immediately available (CDN failed and local fallback is loading), we poll briefly.
function initWhenReady() {
  function tryInit() {
    if (window.Vex && window.Vex.Flow) {
      initGame(window.Vex);
    } else {
      // Poll for up to ~2 seconds
      const start = Date.now();
      const interval = setInterval(() => {
        if (window.Vex && window.Vex.Flow) {
          clearInterval(interval);
          initGame(window.Vex);
        } else if (Date.now() - start > 2000) {
          clearInterval(interval);
          console.error('ClefQuest: VexFlow failed to load within 2s');
        }
      }, 150);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInit);
  } else {
    tryInit();
  }
}

function initGame(Vex) {
  const VF = Vex.Flow;
  const container = document.getElementById('staff_container');
  if (!container) return;

  let currentNote = null;

  // Tone.js synth (if available). Create lazily after a user gesture (Tone.start()).
  let synth = null;
  let audioStarted = false;

  // Convert VexFlow key (e.g. 'c#/4' or 'db/4') to Tone.js pitch (e.g. 'C#4' or 'Db4')
  function vexKeyToTone(key) {
    // match letter, optional accidental (# or b), optional /octave
    const m = key.match(/^([a-gA-G])([#b]?)(?:\/(\d+))?$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const accidental = m[2] || '';
    const octave = m[3] || '4';
    return `${letter}${accidental}${octave}`;
  }

  async function playToneForKey(key) {
    if (!synth) return;
    const note = vexKeyToTone(key);
    if (!note) return;
    try {
      if (!audioStarted && Tone && Tone.start) {
        await Tone.start();
        audioStarted = true;
      }
      // short release so synth doesn't hang
      synth.triggerAttackRelease(note, '8n');
    } catch (e) {
      console.warn('ClefQuest: failed to play Tone note', e);
    }
  }

  // Wire up the "Enable sound" button so browsers consider the audio context user-initiated.
  const soundBtn = document.getElementById('enable_sound_btn');
  if (soundBtn && window.Tone) {
    soundBtn.addEventListener('click', async () => {
      try {
        await Tone.start();
        audioStarted = true;
        // create synth lazily now that audio is allowed
        if (!synth) synth = new Tone.Synth().toDestination();
        soundBtn.disabled = true;
        soundBtn.textContent = 'Sound enabled';
      } catch (e) {
        console.warn('ClefQuest: failed to start audio', e);
        soundBtn.textContent = 'Enable sound (failed)';
        audioStarted = true;
        // create synth lazily now that audio is allowed
        if (!synth) synth = new Tone.Synth().toDestination();
        soundBtn.disabled = true;
        soundBtn.textContent = 'Sound enabled';
      }
    });
  }

  // Game control elements (difficulty, timer, start/stop)
  const difficultySelect = document.getElementById('difficulty_select');
  const timedCheck = document.getElementById('timed_check');
  const timeLimitInput = document.getElementById('time_limit');
  const startBtn = document.getElementById('start_round_btn');
  const stopBtn = document.getElementById('stop_round_btn');
  const timerDisplay = document.getElementById('timer_display');
  const scoreDisplay = document.getElementById('score_display');
  const questionsSelect = document.getElementById('questions_per_round');

  // Timer and scoring state
  let timed = true;
  let timeLimit = 8; // seconds per question
  let timerInterval = null;
  let timeRemaining = 0;
  let score = 0;
  let roundActive = false;
  // Guard for a single scheduled next-note timeout to avoid double-firing
  let nextPickTimeout = null;
  // Whether we are currently accepting answers for the displayed note.
  // After time-up or after a correct answer, this will be false until the
  // next question is drawn.
  let acceptingAnswers = false;
  // Track whether the last feedback shown was a correct message so we can
  // decide whether to keep it visible when the next question appears.
  let lastFeedbackWasCorrect = false;

  function scheduleNextPick(delayMs) {
    // Cancel any previously scheduled pick
    if (nextPickTimeout) {
      clearTimeout(nextPickTimeout);
      nextPickTimeout = null;
    }
    nextPickTimeout = setTimeout(() => {
      nextPickTimeout = null;
      if (roundActive) pickRandomNote();
    }, delayMs);
  }

  // Number of questions remaining in this round (0 = unlimited)
  let questionsRemaining = 0;
  // Number of questions the user actually answered in this round
  let questionsAnswered = 0;

  function handleQuestionEnd() {
    // Called when a question finishes (correct answer or time-up). Decrement
    // the remaining counter and either stop or schedule the next question.
    // Count this finished question toward the answered total
    questionsAnswered += 1;
    if (questionsRemaining > 0) {
      questionsRemaining -= 1;
    }
    if (questionsRemaining === 0 && questionsSelect && questionsSelect.value !== '0') {
      // Round complete
      stopRound();
      return;
    }
    // Otherwise schedule next question
    scheduleNextPick(700);
  }

  function cancelScheduledPick() {
    if (nextPickTimeout) {
      clearTimeout(nextPickTimeout);
      nextPickTimeout = null;
    }
  }

  function updateTimerDisplay() {
    if (!timed || !roundActive) {
      timerDisplay.textContent = 'Time: —';
    } else {
      timerDisplay.textContent = `Time: ${timeRemaining}s`;
    }
    scoreDisplay.textContent = `Score: ${score}`;
  }

  function clearTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function startTimer() {
    clearTimer();
    timeRemaining = timeLimit;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      timeRemaining -= 1;
      if (timeRemaining <= 0) {
        clearTimer();
        // Time's up: mark as wrong and move to next
        // Deduct a point on time-up (can go negative)
        score -= 1;
        feedback.textContent = `Time's up — I drew a ${keyToLetter(currentNote)}`;
        feedback.style.color = 'crimson';
        // After time-up we no longer accept answers until the next question
        acceptingAnswers = false;
        lastFeedbackWasCorrect = false;
        updateTimerDisplay();
        // Handle end of this question (decrement counter and schedule/stop)
        handleQuestionEnd();
      } else {
        updateTimerDisplay();
      }
    }, 1000);
  }

  function startRound() {
    // Read settings
    const diff = (difficultySelect && difficultySelect.value) || 'easy';
    timed = !!(timedCheck && timedCheck.checked);
    timeLimit = parseInt((timeLimitInput && timeLimitInput.value) || '8', 10) || 8;
    // Build possible keys from the selected range and difficulty. The range
    // selector overrides difficulty (difficulty only controls which spellings)
    try {
      const sel = getSelectedRangeAbs();
      possibleKeys = buildPossibleKeysFromRange(sel.lowAbs, sel.highAbs, diff);
    } catch (e) {
      console.warn('ClefQuest: range->pool build failed', e);
      possibleKeys = [];
    }
  score = 0;
  // Initialize questionsRemaining from selector (0 = unlimited)
  const qv = (questionsSelect && questionsSelect.value) ? parseInt(questionsSelect.value, 10) : 0;
  questionsRemaining = isNaN(qv) ? 0 : qv;
    roundActive = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    if (input) {
      input.disabled = false;
      input.focus();
    }
    pickRandomNote();
    // Accept answers for the freshly drawn note
    acceptingAnswers = true;
    if (timed) startTimer();
    updateTimerDisplay();
  }

  function stopRound() {
    roundActive = false;
    clearTimer();
    cancelScheduledPick();
    acceptingAnswers = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    if (input) input.disabled = true;
    updateTimerDisplay();
    // Auto-save the round score for logged-in users. Include some meta so
    // the server can record difficulty and question count.
    try {
      // Compute difficulty based on selected range width (in semitones)
      const selRange = getSelectedRangeAbs();
      const span = (selRange.highAbs - selRange.lowAbs) || 0;
  let computedDifficulty = 'easy';
  if (span <= 7) computedDifficulty = 'easy';
  else if (span <= 12) computedDifficulty = 'medium';
  else computedDifficulty = 'hard';
  const meta = JSON.stringify({ difficulty: computedDifficulty, questions: questionsAnswered });
      saveScoreToServer(score, meta)
        .then(() => {
          console.debug('ClefQuest: score saved');
          if (feedback) {
            feedback.textContent = 'Score saved.';
            feedback.style.color = 'green';
            setTimeout(() => { if (feedback && lastFeedbackWasCorrect === false) { feedback.textContent = ''; feedback.style.color = ''; } }, 2000);
          }
        })
        .catch((err) => {
          // Non-fatal: log and show a brief hint to the user
          console.debug('ClefQuest: saveScore failed', err);
          if (feedback) {
            feedback.textContent = 'Score not saved (network or auth).';
            feedback.style.color = 'orange';
            setTimeout(() => { if (feedback && lastFeedbackWasCorrect === false) { feedback.textContent = ''; feedback.style.color = ''; } }, 2500);
          }
        });
    } catch (e) {
      console.warn('ClefQuest: saveScore meta build failed', e);
    }
  }

  if (startBtn) startBtn.addEventListener('click', startRound);
  if (stopBtn) stopBtn.addEventListener('click', stopRound);

  // Utility: clear and redraw a single-note measure
  function drawNote(key) {
    // clear previous drawing
    container.innerHTML = '';
  const r = new VF.Renderer(container, VF.Renderer.Backends.SVG);
  r.resize(700, 150);
    const ctx = r.getContext();
  const st = new VF.Stave(10, 30, 680);
    st.addClef('treble').setContext(ctx).draw();

    const note = new VF.StaveNote({ clef: 'treble', keys: [key], duration: 'q' });

    // Render accidentals when present in the key (e.g. 'c#/4' or 'db/4')
    try {
      const keyPart = String(key).split('/')[0];
      // Only treat an accidental as present if the key contains an explicit
      // accidental character after the root letter (e.g. 'c#' or 'db'). This
      // prevents natural notes like 'b' (B natural) from being misinterpreted
      // as 'Bb'. Use a small regex to capture optional accidental.
      const kpMatch = keyPart.match(/^([a-gA-G])([#b])?$/);
      const accidental = (kpMatch && kpMatch[2]) ? kpMatch[2] : null;
      if (accidental) {
        // Different VexFlow builds expose different APIs. Prefer the modern
        // Note.addModifier(modifier, index) signature used by the bundled
        // local fallback (VexFlow v5+). Fall back to other possibilities.
        const acc = new VF.Accidental(accidental);
        if (typeof note.addModifier === 'function') {
          // Correct signature: addModifier(modifier, index)
          try {
            note.addModifier(acc, 0);
          } catch (e) {
            // If it still throws, fall through to other attempts below
            console.warn('ClefQuest: addModifier failed, will try alternatives', e);
            throw e;
          }
        } else if (typeof note.addAccidental === 'function') {
          // Older builds may expose addAccidental(index, accidental)
          try {
            note.addAccidental(0, acc);
          } catch (e) {
            // Try the reverse order just in case (some builds are inconsistent)
            try {
              note.addAccidental(acc, 0);
            } catch (err2) {
              console.warn('ClefQuest: addAccidental attempts failed', err2);
              throw err2;
            }
          }
        } else if (note.modifiers && Array.isArray(note.modifiers)) {
          // Last resort: push into modifiers array
          note.modifiers.push(acc);
        } else {
          throw new Error('No accidental API available on StaveNote');
        }
      }
    } catch (err) {
      // Some VexFlow builds may differ; don't block rendering. Log for debug.
      console.warn('Could not add accidental to note', err);
    }

    // Use a single-beat voice to match a quarter-note duration and avoid IncompleteVoice errors
  const voice = new VF.Voice({ num_beats: 1, beat_value: 4 });
    voice.addTickables([note]);

  new VF.Formatter().joinVoices([voice]).format([voice], 600);
    voice.draw(ctx, st);
    // Play the note audio
    if (synth) playToneForKey(key);

  }

  // Map VexFlow key (like 'c/4') to letter name (A-G)
  function keyToLetter(key) {
    // key could be 'c/4', 'c#/4', 'db/4' -> return e.g. 'C' or 'C#'
    const m = String(key).match(/^([a-gA-G])([#b]?)(?:\/\d+)?$/);
    if (!m) return '';
    const letter = m[1].toUpperCase();
    const acc = m[2] || '';
    return `${letter}${acc}`;
  }

  // Parse a user's typed guess into a semitone (0=C, 1=C#, ... 11=B).
  // Returns null for invalid input. Accepts forms: A, A#, Bb, ♯, ♭.
  function parseGuessToSemitone(raw) {
    if (!raw) return null;
    let s = String(raw).replace(/♯/g, '#').replace(/♭/g, 'b').trim();
    s = s.toUpperCase();
    const m = s.match(/^([A-G])([#B])?$/);
    if (!m) return null;
    const letter = m[1];
    const acc = m[2] || '';
    const baseMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
    let sem = baseMap[letter];
    if (acc === '#') sem = (sem + 1) % 12;
    if (acc === 'B') sem = (sem + 11) % 12; // flat
    return sem;
  }

  // Convert a VexFlow key like 'c#/4' or 'db/4' to a semitone number (0-11).
  // If octave is present it's ignored for comparison; we compare pitch class only.
  function keyToSemitone(key) {
    const m = String(key).match(/^([A-Ga-g])([#b]?)(?:\/(\d+))?$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const acc = m[2] || '';
    const baseMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
    let sem = baseMap[letter];
    if (acc === '#') sem = (sem + 1) % 12;
    if (acc === 'b') sem = (sem + 11) % 12;
    return sem;
  }

  // List of keys to choose from (will be built from selected range + difficulty)
  let possibleKeys = [];

  // --- Range selector data/functions -------------------------------------------------
  // Convert key like 'c#/4' or 'db/4' to absolute semitone number (C0 = 0)
  function keyToAbsolute(key) {
    const m = String(key).match(/^([A-Ga-g])([#b]?)(?:\/(\d+))?$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const acc = m[2] || '';
    const octave = parseInt(m[3] || '4', 10);
    const baseMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
    let sem = baseMap[letter];
    if (acc === '#') sem += 1;
    if (acc === 'b') sem -= 1;
    // normalize
    sem = (sem + 12) % 12;
    return octave * 12 + sem;
  }

  // Convert absolute semitone back to a key string using sharps (for internal use)
  const noteNamesSharp = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const noteNamesFlat =  ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  function absToKeySharp(abs) {
    const octave = Math.floor(abs / 12);
    const pc = abs % 12;
    return `${noteNamesSharp[pc].toLowerCase()}/${octave}`;
  }
  function absToDisplayLabel(abs) {
    const octave = Math.floor(abs / 12);
    const pc = abs % 12;
    if (noteNamesSharp[pc] === noteNamesFlat[pc]) return `${noteNamesSharp[pc]}${octave}`;
    // show flat first (e.g. Ab/G#) so flats like Ab4 look natural
    return `${noteNamesFlat[pc]}${octave}/${noteNamesSharp[pc]}${octave}`;
  }

  // Build the vertical range (Ab3 .. C#6). Note: lowest allowed is Ab3.
  const RANGE_LOW = 'ab/3';
  const RANGE_HIGH = 'c#/6';
  const rangeLowAbs = keyToAbsolute(RANGE_LOW);
  const rangeHighAbs = keyToAbsolute(RANGE_HIGH);
  const rangeSteps = (rangeHighAbs - rangeLowAbs) + 1;

  // Range UI elements
  const rangeTrack = document.getElementById('range_track');
  let topIndex = 0; // index into ticks (0 = highest)
  let bottomIndex = rangeSteps - 1; // inclusive
  let ticks = [];

  function buildRangeUI() {
    if (!rangeTrack) return;
  rangeTrack.innerHTML = '';
  // reset ticks array
  ticks = [];
    // create ticks from high -> low so index 0 is highest
    for (let i = 0; i < rangeSteps; i++) {
      const abs = rangeHighAbs - i;
      const t = document.createElement('div');
      t.className = 'tick';
      t.dataset.index = i;
      t.dataset.abs = abs;
  t.title = absToDisplayLabel(abs);
  // show a short label (prefer flats for black keys)
  const pc = abs % 12;
  const octave = Math.floor(abs / 12);
  const shortLabel = (noteNamesFlat[pc] !== noteNamesSharp[pc]) ? `${noteNamesFlat[pc]}${octave}` : `${noteNamesSharp[pc]}${octave}`;
  t.textContent = shortLabel;
  rangeTrack.appendChild(t);
  // clicking a tick selects nearest boundary
  t.addEventListener('click', () => onTickClick(i));
  ticks.push(t);
    }
    updateRangeUI();
  }

  function updateRangeUI() {
    if (!rangeTrack) return;
    const trackRect = rangeTrack.getBoundingClientRect();
    const trackHeight = trackRect.height || 200;
    const stepPx = trackHeight / Math.max(1, rangeSteps - 1);
    // Highlight ticks and mark selected top/bottom
    // color ticks
    ticks.forEach((t, idx) => {
      if (idx >= topIndex && idx <= bottomIndex) t.classList.add('in-range'); else t.classList.remove('in-range');
      t.classList.remove('selected-top', 'selected-bottom');
      if (idx === topIndex) t.classList.add('selected-top');
      if (idx === bottomIndex) t.classList.add('selected-bottom');
    });
  }

  // Convert mouse Y to nearest index
  function yToIndex(y) {
    const rect = rangeTrack.getBoundingClientRect();
    let rel = y - rect.top;
    rel = Math.max(0, Math.min(rel, rect.height));
    const frac = rel / Math.max(1, rect.height);
    const idx = Math.round(frac * (rangeSteps - 1));
    return idx;
  }

  // Clicking on a tick sets the nearest boundary (top or bottom). This
  // replaces draggable handles: users click the note they want as top/bottom.
  function onTickClick(idx) {
    const distTop = Math.abs(idx - topIndex);
    const distBottom = Math.abs(idx - bottomIndex);
    if (distTop <= distBottom) {
      topIndex = Math.min(idx, bottomIndex);
    } else {
      bottomIndex = Math.max(idx, topIndex);
    }
    updateRangeUI();
  }

  // Initialize range UI after a short delay so layout is ready
  setTimeout(() => {
    buildRangeUI();
    if (rangeTrack) {
      // nothing to attach to the track; ticks handle clicks individually
    }
    // Recalculate on window resize
    window.addEventListener('resize', updateRangeUI);
    // When the UI is ready, set a default range based on current difficulty
    function setRangeForDifficulty(diff) {
      // diff: 'easy'|'medium'|'hard'
      // diff: 'easy'|'medium'|'difficult'
      let lowKey = 'c/4';
      let highKey = 'g/4';
      if (diff === 'easy') {
        lowKey = 'c/4'; highKey = 'g/4';
      } else if (diff === 'medium') {
        lowKey = 'c/4'; highKey = 'c/5';
      } else {
        // hard
        lowKey = RANGE_LOW; highKey = RANGE_DEFAULT_HIGH;
      }
      const lowAbs = keyToAbsolute(lowKey);
      const highAbs = keyToAbsolute(highKey);
      if (lowAbs === null || highAbs === null) return;
      // compute indices
      const newTop = Math.max(0, Math.min(rangeSteps - 1, rangeHighAbs - highAbs));
      const newBottom = Math.max(0, Math.min(rangeSteps - 1, rangeHighAbs - lowAbs));
      topIndex = newTop; bottomIndex = newBottom;
      updateRangeUI();
    }

    if (difficultySelect) {
      // initialize to current difficulty
      const initialDiff = (difficultySelect && difficultySelect.value) || 'easy';
      setRangeForDifficulty(initialDiff);
      // Apply time presets based on difficulty
      if (timeLimitInput) {
        if (initialDiff === 'easy') timeLimitInput.value = '8';
        else if (initialDiff === 'medium') timeLimitInput.value = '5';
        else timeLimitInput.value = '3';
      }
      difficultySelect.addEventListener('change', (e) => {
        setRangeForDifficulty(e.target.value);
        // Update seconds per question according to difficulty
        if (timeLimitInput) {
          if (e.target.value === 'easy') timeLimitInput.value = '8';
          else if (e.target.value === 'medium') timeLimitInput.value = '5';
          else timeLimitInput.value = '3';
        }
      });
    }
      // Now that the range UI is initialized, build the initial possibleKeys
      // from the currently selected range and difficulty, then draw the first note.
      try {
        const sel = getSelectedRangeAbs();
        const diffNow = (difficultySelect && difficultySelect.value) || 'easy';
        possibleKeys = buildPossibleKeysFromRange(sel.lowAbs, sel.highAbs, diffNow);
        // Ensure we have at least one key before drawing
        if (possibleKeys.length > 0) pickRandomNote();
      } catch (e) {
        console.warn('ClefQuest: initial pool build failed', e);
      }
  }, 80);

  // Helper: return current selected absolute low/high
  function getSelectedRangeAbs() {
    const highAbs = rangeHighAbs - topIndex;
    const lowAbs = rangeHighAbs - bottomIndex;
    return { lowAbs, highAbs };
  }

  // Build possibleKeys from a selected absolute range and difficulty setting.
  // difficulty: 'easy'|'medium'|'hard'
  function buildPossibleKeysFromRange(lowAbs, highAbs, difficulty) {
    const keys = [];
    for (let abs = lowAbs; abs <= highAbs; abs++) {
      const octave = Math.floor(abs / 12);
      const pc = ((abs % 12) + 12) % 12;
      const sharp = `${noteNamesSharp[pc].toLowerCase()}/${octave}`;
      const flat = `${noteNamesFlat[pc].toLowerCase()}/${octave}`;
      // Exclude gb/3 explicitly per user's request
      if (sharp === 'gb/3' || flat === 'gb/3') continue;
      // Determine inclusion by difficulty
      if (difficulty === 'easy') {
        // only naturals
        if (['c','d','e','f','g','a','b'].includes(noteNamesSharp[pc].toLowerCase())) {
          keys.push(sharp);
        }
      } else if (difficulty === 'medium') {
        // include naturals and sharps (one spelling)
        if (['c','d','e','f','g','a','b'].includes(noteNamesSharp[pc].toLowerCase())) {
          keys.push(sharp);
        } else {
          // black keys: include sharp spelling
          keys.push(sharp);
        }
      } else {
        // hard: include both spellings for accidentals (unique entries)
        if (['c','d','e','f','g','a','b'].includes(noteNamesSharp[pc].toLowerCase())) {
          keys.push(sharp);
        } else {
          // add both flat and sharp spelling to increase variety
          keys.push(sharp);
          if (flat !== sharp) keys.push(flat);
        }
      }
    }
    return keys;
  }

  // -----------------------------------------------------------------------------------

  function pickRandomNote() {
    // If there's a pending scheduled pick, cancel it since we're executing now
    cancelScheduledPick();
    const k = possibleKeys[Math.floor(Math.random() * possibleKeys.length)];
    currentNote = k;
    drawNote(k);
    // When a new note appears we should accept answers again
    acceptingAnswers = true;
    // If the previous feedback was not 'Correct!', clear it for the new question
    if (!lastFeedbackWasCorrect && feedback) {
      feedback.textContent = '';
      feedback.style.color = '';
    }
    // If a timed round is active, restart the per-question timer
    if (roundActive && timed) {
      clearTimer();
      startTimer();
    }
    return k;
  }

  // Initial draw is deferred until range UI has been built and possibleKeys
  // constructed. pickRandomNote() will be called after initialization below.

  // Input handling
  const input = document.getElementById('note_input');
  // Ensure maxlength is present at runtime (defensive in case the DOM was
  // manipulated or the template didn't apply). Allow up to 2 chars (e.g. A#).
  if (input) {
    try {
      input.setAttribute('maxlength', '2');
      input.setAttribute('inputmode', 'text');
    } catch (e) {
      // ignore silently
    }
  }
  const feedback = document.getElementById('feedback');

  // Prevent receiving guesses before a round starts
  if (input) input.disabled = true;

  // Helper: read CSRF token from meta tag (set by templates/index.html)
  function getCsrfToken() {
    try {
      const m = document.querySelector('meta[name="csrf-token"]');
      return m ? m.getAttribute('content') : null;
    } catch (e) {
      return null;
    }
  }

  // Save a score to the server (POST /save_score). Sends JSON and includes
  // CSRF token in the X-CSRFToken header so Flask-WTF's CSRFProtect accepts it.
  async function saveScoreToServer(scoreValue, meta) {
    const token = getCsrfToken();
    const payload = { score: scoreValue, meta: meta };
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) headers['X-CSRFToken'] = token;
    const resp = await fetch('/save_score', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const text = await resp.text().catch(() => null);
      throw new Error(`save failed ${resp.status} ${text || ''}`);
    }
    return resp.json().catch(() => ({}));
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      // Ignore input when a round is not active
      if (!roundActive) return;
      if (e.key === 'Enter') {
        submitGuessString(input.value);
        input.value = '';
      }
    });
  }
  
  // Centralized guess handler used by both keyboard and button clicks.
  function submitGuessString(raw) {
    if (!roundActive) return;
    if (!raw) return;
    // If we're not accepting answers (e.g. after time-up or after a correct
    // submission while waiting for the next note), ignore input.
    if (!acceptingAnswers) {
      if (feedback) {
        feedback.textContent = 'Too late — wait for the next note';
        feedback.style.color = 'orange';
      }
      return;
    }
    const guessSem = parseGuessToSemitone(raw);
    const answerSem = keyToSemitone(currentNote);
    const answerLabel = keyToLetter(currentNote);
    if (guessSem === null || answerSem === null) {
      feedback.textContent = 'Please enter a valid note (e.g. A, A#, Bb).';
      feedback.style.color = 'orange';
      return;
    }
    if (guessSem === answerSem) {
      score += 1;
      feedback.textContent = 'Correct!';
      feedback.style.color = 'green';
      lastFeedbackWasCorrect = true;
      updateTimerDisplay();
  // Stop the per-question timer immediately and cancel any pending
  // scheduled pick (from a near-timeout) so time-up won't overwrite this
  // correct-answer feedback. Then handle question end (decrement counter
  // and schedule/stop as appropriate).
  clearTimer();
  acceptingAnswers = false;
  cancelScheduledPick();
  handleQuestionEnd();
    } else {
      // Penalize wrong answers by subtracting one point (can go negative)
      score -= 1;
      feedback.textContent = `Wrong — I drew a ${answerLabel}`;
      feedback.style.color = 'crimson';
      lastFeedbackWasCorrect = false;
      updateTimerDisplay();
    }
  }

  // Wire up click handlers for the note buttons
  const noteButtons = document.querySelectorAll('#note_buttons button');
  if (noteButtons && noteButtons.length) {
    noteButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (!roundActive) return;
        const n = btn.getAttribute('data-note');
        // Simulate a guess submission
        submitGuessString(n);
      });
    });
  }
}

// Kick off
initWhenReady();

// OLD: default range start/end used elsewhere (example)
// const RANGE_START = "ab/4";
// const RANGE_END = "c#/6";

// Set default selector bounds: lowest = Ab3, highest = C#6
const RANGE_DEFAULT_LOW = "ab/3";
const RANGE_DEFAULT_HIGH = "db/6";

// Difficulty → preset ranges (updated so Hard uses Ab3..C#6)
const DIFFICULTY_RANGES = {
  easy: { low: "c/4", high: "g/4" },
  medium: { low: "c/4", high: "c/5" },
  hard: { low: RANGE_DEFAULT_LOW, high: RANGE_DEFAULT_HIGH },
};

// When building the pool of possible keys (chromatic list), ensure Gb3 is excluded
function buildPossibleKeysFromRange(rangeLowKey, rangeHighKey, includeAccidentals = true) {
  // existing helper that builds an array of key strings like "c/4", "c#/4", "db/4", ...
  const all = buildChromaticRange(rangeLowKey, rangeHighKey); // returns semitone objects or key strings

  const keys = [];
  for (const k of all) {
    // k.key is like 'c/4' or 'c#/4' or 'db/4' depending on your generator
    // Explicitly skip the Gb3 spelling (per requirement)
    if (k === 'gb/3' || k.key === 'gb/3') {
      continue;
    }
    keys.push(k.key ? k.key : k);
  }
  return keys;
}

// When the difficulty changes or the range UI is initialized, use the new default low
function applyDifficultyPreset(difficulty) {
  const preset = DIFFICULTY_RANGES[difficulty] || DIFFICULTY_RANGES.easy;
  // update the range UI handles to preset.low / preset.high
  setRangeHandlesToKeys(preset.low, preset.high);
  // optionally rebuild the possibleKeys from the range
  possibleKeys = buildPossibleKeysFromRange(preset.low, preset.high);
}

// Ensure initialization uses the new Ab3 default for Hard
// Example init:
document.addEventListener('DOMContentLoaded', () => {
  // ...existing init...
  initRangeSelector({ low: RANGE_DEFAULT_LOW, high: RANGE_DEFAULT_HIGH });
  // Sync difficulty selector with the range
  document.getElementById('difficulty_select').addEventListener('change', (e) => {
    applyDifficultyPreset(e.target.value);
  });
  // ...rest of init...
});
