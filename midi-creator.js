// A simple step-sequencer that exports a real Standard MIDI File (format 0,
// single track) — hand-rolled byte writer, no library, since the format
// itself is small: a header chunk, a track chunk of delta-time-prefixed
// events, and an end-of-track marker. See buildMidiFile() below.
(() => {
  const STEPS = 16;
  const LOW_NOTE = 48; // C3
  const HIGH_NOTE = 71; // B4 — two octaves, low to high
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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

  const gridEl = document.getElementById("midi-grid");
  const tempoInput = document.getElementById("tempo-input");
  const instrumentSelect = document.getElementById("instrument-select");
  const filenameInput = document.getElementById("filename-input");
  const playBtn = document.getElementById("play-btn");
  const clearBtn = document.getElementById("clear-btn");
  const downloadBtn = document.getElementById("download-btn");
  const downloadLink = document.getElementById("download-link");

  // active[note][step] -> boolean, note keys are MIDI note numbers
  const active = {};
  for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) active[note] = new Array(STEPS).fill(false);

  function noteLabel(note) {
    const name = NOTE_NAMES[note % 12];
    const octave = Math.floor(note / 12) - 1;
    return `${name}${octave}`;
  }

  function buildGrid() {
    for (let note = HIGH_NOTE; note >= LOW_NOTE; note--) {
      const row = document.createElement("div");
      row.className = "midi-row";

      const label = document.createElement("span");
      label.className = "midi-row-label" + (note % 12 === 0 ? " is-c" : "");
      label.textContent = noteLabel(note);
      row.appendChild(label);

      for (let step = 0; step < STEPS; step++) {
        const cell = document.createElement("div");
        cell.className = "midi-cell" + (step % 4 === 0 ? " beat-start" : "");
        cell.dataset.note = note;
        cell.dataset.step = step;
        cell.addEventListener("click", () => {
          const on = !active[note][step];
          active[note][step] = on;
          cell.classList.toggle("active", on);
        });
        row.appendChild(cell);
      }

      gridEl.appendChild(row);
    }
  }

  function populateInstruments() {
    INSTRUMENTS.forEach((inst, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = inst.name;
      instrumentSelect.appendChild(opt);
    });
  }

  function clearGrid() {
    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) active[note].fill(false);
    gridEl.querySelectorAll(".midi-cell.active").forEach((c) => c.classList.remove("active"));
  }

  // --- preview playback (Web Audio, not a real synth — see the page note) ---
  let previewTimer = null;
  let previewStep = 0;
  let audioCtx = null;

  function noteFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function playPreviewStep(step) {
    gridEl.querySelectorAll(".midi-cell.playhead").forEach((c) => c.classList.remove("playhead"));
    const wave = INSTRUMENTS[instrumentSelect.value].previewWave;
    const stepDurationSec = 60 / clampTempo() / 4;

    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
      if (!active[note][step]) continue;
      const cell = gridEl.querySelector(`.midi-cell[data-note="${note}"][data-step="${step}"]`);
      if (cell) cell.classList.add("playhead");

      const osc = audioCtx.createOscillator();
      osc.type = wave;
      osc.frequency.value = noteFreq(note);
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + stepDurationSec * 0.95);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + stepDurationSec);
    }
  }

  function clampTempo() {
    const v = parseInt(tempoInput.value, 10);
    return Math.max(40, Math.min(300, isNaN(v) ? 120 : v));
  }

  function stopPreview() {
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = null;
    playBtn.textContent = "▶ Play";
    gridEl.querySelectorAll(".midi-cell.playhead").forEach((c) => c.classList.remove("playhead"));
  }

  function startPreview() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    previewStep = 0;
    playPreviewStep(previewStep);
    const stepMs = (60000 / clampTempo() / 4);
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

  clearBtn.addEventListener("click", () => {
    stopPreview();
    clearGrid();
  });

  // --- Standard MIDI File writer (format 0, single track) ---
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

  function buildMidiFile() {
    const TICKS_PER_QUARTER = 480;
    const ticksPerStep = TICKS_PER_QUARTER / 4; // 16th notes
    const bpm = clampTempo();
    const microsPerQuarter = Math.round(60000000 / bpm);
    const program = INSTRUMENTS[instrumentSelect.value].program;

    // Collect note on/off as absolute-tick events, then sort and delta-encode.
    const events = [];
    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
      for (let step = 0; step < STEPS; step++) {
        if (!active[note][step]) continue;
        const onTick = step * ticksPerStep;
        events.push({ tick: onTick, bytes: [0x90, note, 100] }); // Note On, channel 0
        events.push({ tick: onTick + ticksPerStep, bytes: [0x80, note, 64] }); // Note Off
      }
    }
    events.sort((a, b) => a.tick - b.tick);

    const track = [];
    // Tempo meta event
    track.push(0x00, 0xff, 0x51, 0x03, (microsPerQuarter >> 16) & 0xff, (microsPerQuarter >> 8) & 0xff, microsPerQuarter & 0xff);
    // Program Change
    track.push(0x00, 0xc0, program);

    let lastTick = 0;
    for (const ev of events) {
      const delta = ev.tick - lastTick;
      lastTick = ev.tick;
      track.push(...writeVarLen(delta), ...ev.bytes);
    }
    // End of track
    track.push(0x00, 0xff, 0x2f, 0x00);

    const header = [
      0x4d, 0x54, 0x68, 0x64, // "MThd"
      0x00, 0x00, 0x00, 0x06, // header length = 6
      0x00, 0x00, // format 0
      0x00, 0x01, // 1 track
      (TICKS_PER_QUARTER >> 8) & 0xff, TICKS_PER_QUARTER & 0xff,
    ];
    const trackHeader = [
      0x4d, 0x54, 0x72, 0x6b, // "MTrk"
      (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff,
    ];

    return new Uint8Array([...header, ...trackHeader, ...track]);
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

  buildGrid();
  populateInstruments();
})();
