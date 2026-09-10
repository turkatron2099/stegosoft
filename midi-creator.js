// A step-sequencer that exports a real Standard MIDI File — hand-rolled
// byte writer, no library, since the format itself is small: a header
// chunk plus one track chunk per instrument, each a stream of delta-time-
// prefixed events. Multiple instrument tracks share one tempo/step grid
// so they play together as a single arrangement (format 1: a tempo-only
// conductor track, then one track per instrument, each on its own MIDI
// channel so a real player can mix/mute them independently).
(() => {
  const STEPS = 48; // 3 bars of 16th notes at 4/4 — three times the original length
  const LOW_NOTE = 48; // C3
  const HIGH_NOTE = 71; // B4 — two octaves, low to high
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const TICKS_PER_QUARTER = 480;
  const TICKS_PER_STEP = TICKS_PER_QUARTER / 4; // 16th notes

  // Channel 9 is skipped — General MIDI reserves it for drums regardless
  // of Program Change, so a melodic track landed there would misbehave in
  // a real synth. That caps this tool at 15 simultaneous instruments.
  const CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  const MAX_TRACKS = CHANNELS.length;

  const INSTRUMENTS = [
    { name: "Acoustic Grand Piano", program: 0, previewWave: "triangle" },
    { name: "Electric Piano", program: 4, previewWave: "sine" },
    { name: "Acoustic Guitar (Nylon)", program: 24, previewWave: "triangle" },
    { name: "Electric Bass", program: 33, previewWave: "sine" },
    { name: "Violin", program: 40, previewWave: "sawtooth" },
    { name: "Trumpet", program: 56, previewWave: "sawtooth" },
    { name: "Flute", program: 73, previewWave: "sine" },
    { name: "Synth Lead (Square)", program: 80, previewWave: "square" },
    { name: "Synth Lead (Saw)", program: 81, previewWave: "sawtooth" },
  ];

  const tempoInput = document.getElementById("tempo-input");
  const filenameInput = document.getElementById("filename-input");
  const playBtn = document.getElementById("play-btn");
  const addTrackBtn = document.getElementById("add-track-btn");
  const downloadBtn = document.getElementById("download-btn");
  const downloadLink = document.getElementById("download-link");
  const tracksContainer = document.getElementById("tracks-container");

  function noteLabel(note) {
    const name = NOTE_NAMES[note % 12];
    const octave = Math.floor(note / 12) - 1;
    return `${name}${octave}`;
  }

  function newActiveGrid() {
    const active = {};
    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) active[note] = new Array(STEPS).fill(false);
    return active;
  }

  // --- track state ---
  let nextTrackId = 0;
  const tracks = []; // { id, instrumentIndex, active }

  function addTrack() {
    if (tracks.length >= MAX_TRACKS) return;
    tracks.push({ id: nextTrackId++, instrumentIndex: 0, active: newActiveGrid() });
    renderTracks();
  }

  function removeTrack(id) {
    if (tracks.length <= 1) return; // always keep at least one
    const i = tracks.findIndex((t) => t.id === id);
    if (i !== -1) tracks.splice(i, 1);
    renderTracks();
  }

  function clearTrack(track) {
    track.active = newActiveGrid();
    renderTracks();
  }

  function populateInstrumentSelect(selectEl, selectedIndex) {
    INSTRUMENTS.forEach((inst, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = inst.name;
      if (i === selectedIndex) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function buildTrackEl(track, index) {
    const el = document.createElement("div");
    el.className = "midi-track";

    const header = document.createElement("div");
    header.className = "midi-track-header";

    const label = document.createElement("span");
    label.className = "midi-track-label";
    label.textContent = `Track ${index + 1}`;
    header.appendChild(label);

    const instrumentSelect = document.createElement("select");
    instrumentSelect.className = "midi-track-instrument";
    populateInstrumentSelect(instrumentSelect, track.instrumentIndex);
    instrumentSelect.addEventListener("change", () => {
      track.instrumentIndex = parseInt(instrumentSelect.value, 10);
    });
    header.appendChild(instrumentSelect);

    const actions = document.createElement("div");
    actions.className = "midi-track-header-actions";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => clearTrack(track));
    actions.appendChild(clearBtn);

    if (tracks.length > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "midi-track-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeTrack(track.id));
      actions.appendChild(removeBtn);
    }

    header.appendChild(actions);
    el.appendChild(header);

    const gridWrap = document.createElement("div");
    gridWrap.className = "midi-grid-wrap";
    const grid = document.createElement("div");
    grid.className = "midi-grid";
    grid.dataset.trackId = track.id;

    for (let note = HIGH_NOTE; note >= LOW_NOTE; note--) {
      const row = document.createElement("div");
      row.className = "midi-row";

      const rowLabel = document.createElement("span");
      rowLabel.className = "midi-row-label" + (note % 12 === 0 ? " is-c" : "");
      rowLabel.textContent = noteLabel(note);
      row.appendChild(rowLabel);

      for (let step = 0; step < STEPS; step++) {
        const cell = document.createElement("div");
        cell.className = "midi-cell" + (step % 4 === 0 ? " beat-start" : "");
        cell.dataset.note = note;
        cell.dataset.step = step;
        if (track.active[note][step]) cell.classList.add("active");
        cell.addEventListener("click", () => {
          const on = !track.active[note][step];
          track.active[note][step] = on;
          cell.classList.toggle("active", on);
        });
        row.appendChild(cell);
      }

      grid.appendChild(row);
    }

    gridWrap.appendChild(grid);
    el.appendChild(gridWrap);
    return el;
  }

  function renderTracks() {
    tracksContainer.innerHTML = "";
    tracks.forEach((track, i) => tracksContainer.appendChild(buildTrackEl(track, i)));
    addTrackBtn.disabled = tracks.length >= MAX_TRACKS;
    addTrackBtn.title = addTrackBtn.disabled ? `Max ${MAX_TRACKS} instruments (General MIDI's channel 10 is reserved for drums)` : "";
  }

  addTrackBtn.addEventListener("click", addTrack);

  // --- preview playback (Web Audio, not a real synth — see the page note) ---
  let previewTimer = null;
  let previewStep = 0;
  let audioCtx = null;

  function noteFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function clampTempo() {
    const v = parseInt(tempoInput.value, 10);
    return Math.max(40, Math.min(300, isNaN(v) ? 120 : v));
  }

  function playPreviewStep(step) {
    document.querySelectorAll(".midi-cell.playhead").forEach((c) => c.classList.remove("playhead"));
    const stepDurationSec = 60 / clampTempo() / 4;

    for (const track of tracks) {
      const wave = INSTRUMENTS[track.instrumentIndex].previewWave;
      const gridEl = tracksContainer.querySelector(`.midi-grid[data-track-id="${track.id}"]`);
      for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
        if (!track.active[note][step]) continue;
        const cell = gridEl && gridEl.querySelector(`.midi-cell[data-note="${note}"][data-step="${step}"]`);
        if (cell) cell.classList.add("playhead");

        const osc = audioCtx.createOscillator();
        osc.type = wave;
        osc.frequency.value = noteFreq(note);
        const gain = audioCtx.createGain();
        const now = audioCtx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + stepDurationSec * 0.95);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + stepDurationSec);
      }
    }
  }

  function stopPreview() {
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;
    playBtn.textContent = "▶ Play";
    document.querySelectorAll(".midi-cell.playhead").forEach((c) => c.classList.remove("playhead"));
  }

  function startPreview() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    previewStep = 0;
    playPreviewStep(previewStep);
    const stepMs = 60000 / clampTempo() / 4;
    previewTimer = setInterval(() => {
      previewStep = (previewStep + 1) % STEPS;
      playPreviewStep(previewStep);
    }, stepMs);
    playBtn.textContent = "■ Stop";
  }

  playBtn.addEventListener("click", () => {
    if (previewTimer) stopPreview();
    else startPreview();
  });

  // --- Standard MIDI File writer (format 1: a tempo-only conductor track,
  // then one track per instrument) ---
  function writeVarLen(value) {
    // 7 bits per byte, MSB=1 on every byte but the last — the standard
    // MIDI delta-time encoding.
    const bytes = [value & 0x7f];
    value >>= 7;
    while (value > 0) {
      bytes.unshift((value & 0x7f) | 0x80);
      value >>= 7;
    }
    return bytes;
  }

  function encodeTrackChunk(eventBytes) {
    const len = eventBytes.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...eventBytes];
  }

  function buildInstrumentTrack(track, channel) {
    const program = INSTRUMENTS[track.instrumentIndex].program;
    const events = [];
    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
      for (let step = 0; step < STEPS; step++) {
        if (!track.active[note][step]) continue;
        const onTick = step * TICKS_PER_STEP;
        events.push({ tick: onTick, bytes: [0x90 | channel, note, 100] });
        events.push({ tick: onTick + TICKS_PER_STEP, bytes: [0x80 | channel, note, 64] });
      }
    }
    events.sort((a, b) => a.tick - b.tick);

    const bytes = [0x00, 0xc0 | channel, program];
    let lastTick = 0;
    for (const ev of events) {
      const delta = ev.tick - lastTick;
      lastTick = ev.tick;
      bytes.push(...writeVarLen(delta), ...ev.bytes);
    }
    bytes.push(0x00, 0xff, 0x2f, 0x00); // end of track
    return encodeTrackChunk(bytes);
  }

  function buildMidiFile() {
    const bpm = clampTempo();
    const microsPerQuarter = Math.round(60000000 / bpm);

    const conductorBytes = [
      0x00, 0xff, 0x51, 0x03, (microsPerQuarter >> 16) & 0xff, (microsPerQuarter >> 8) & 0xff, microsPerQuarter & 0xff,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const trackChunks = [encodeTrackChunk(conductorBytes)];
    tracks.forEach((track, i) => trackChunks.push(buildInstrumentTrack(track, CHANNELS[i])));

    const ntrks = trackChunks.length;
    const header = [
      0x4d, 0x54, 0x68, 0x64, // "MThd"
      0x00, 0x00, 0x00, 0x06, // header length = 6
      0x00, 0x01, // format 1
      (ntrks >> 8) & 0xff, ntrks & 0xff,
      (TICKS_PER_QUARTER >> 8) & 0xff, TICKS_PER_QUARTER & 0xff,
    ];

    return new Uint8Array([...header, ...trackChunks.flat()]);
  }

  downloadBtn.addEventListener("click", () => {
    const bytes = buildMidiFile();
    const blob = new Blob([bytes], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const name = (filenameInput.value.trim() || "my-tune").replace(/\.mid$/i, "") + ".mid";
    downloadLink.href = url;
    downloadLink.download = name;
    downloadLink.click();
    // Object URLs only need to survive long enough for the browser to start
    // the save — freeing it right away would race the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  addTrack();
})();
