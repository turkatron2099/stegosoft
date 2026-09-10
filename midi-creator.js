// A step-sequencer that exports a real Standard MIDI File — hand-rolled
// byte writer, no library, since the format itself is small: a header
// chunk plus one track chunk per instrument, each a stream of delta-time-
// prefixed events. Multiple instrument tracks share one tempo/length grid
// so they play together as a single arrangement (format 1: a tempo-only
// conductor track, then one track per instrument, each on its own MIDI
// channel so a real player can mix/mute them independently).
//
// Each cell is either off, an independent one-step note ("active" only),
// or tied to the step before it ("active" + "tie") — a Shift+drag paints
// tied cells, which the exporter and preview both collapse into a single
// held note spanning the whole run, rather than re-triggering every step.
(() => {
  const STEPS_PER_BAR = 16;
  const LOW_NOTE = 48; // C3
  const HIGH_NOTE = 71; // B4 — two octaves, low to high
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const TICKS_PER_QUARTER = 480;
  const TICKS_PER_STEP = TICKS_PER_QUARTER / 4; // 16th notes
  const MIN_BARS = 1;
  const MAX_BARS = 16;

  // Channel 9 is skipped — General MIDI reserves it for drums regardless
  // of Program Change, so a melodic track landed there would misbehave in
  // a real synth. That caps this tool at 15 simultaneous instruments.
  const CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  const MAX_TRACKS = CHANNELS.length;

  // Only 4 raw oscillator waveforms exist to approximate 9 GM instruments
  // with, so several necessarily share a wave (sawtooth: violin/trumpet/
  // synth saw; sine: e-piano/bass/flute; triangle: piano/guitar) — the
  // *exported* .mid file already sends the correct distinct GM program
  // per instrument regardless, this only affects the in-browser preview.
  // Attack/decay shape, vibrato, and a detuned second voice differentiate
  // same-wave instruments from each other (bowed vs. brassy vs. plucked,
  // etc.) so the preview doesn't collapse them into one sound.
  const INSTRUMENTS = [
    {
      name: "Acoustic Grand Piano", program: 0,
      preview: { wave: "triangle", attack: 0.004, decayTo: 0.35 }, // percussive hit, decays under a held note
    },
    {
      name: "Electric Piano", program: 4,
      preview: { wave: "sine", attack: 0.01, decayTo: 0.6 }, // softer onset, mellower decay than piano
    },
    {
      name: "Acoustic Guitar (Nylon)", program: 24,
      preview: { wave: "triangle", attack: 0.002, decayTo: 0.25 }, // sharper pluck, decays faster than piano
    },
    {
      name: "Electric Bass", program: 33,
      preview: { wave: "sine", attack: 0.005, decayTo: 0.8, detuneVoice: -1200, voiceGain: 0.5 }, // + an octave-down layer for weight
    },
    {
      name: "Violin", program: 40,
      preview: { wave: "sawtooth", attack: 0.09, decayTo: 1, vibrato: { rate: 5.5, depth: 15 } }, // slow bowed swell
    },
    {
      name: "Trumpet", program: 56,
      preview: { wave: "sawtooth", attack: 0.02, decayTo: 1, vibrato: { rate: 6, depth: 8 } }, // brighter/faster attack than violin
    },
    {
      name: "Flute", program: 73,
      preview: { wave: "sine", attack: 0.05, decayTo: 1, vibrato: { rate: 5, depth: 10 } }, // breathy onset, sustained
    },
    {
      name: "Synth Lead (Square)", program: 80,
      preview: { wave: "square", attack: 0.003, decayTo: 0.85 },
    },
    {
      name: "Synth Lead (Saw)", program: 81,
      preview: { wave: "sawtooth", attack: 0.003, decayTo: 0.85, detuneVoice: 10, voiceGain: 0.6 }, // detuned unison layer = classic synth-lead thickness
    },
  ];

  const tempoInput = document.getElementById("tempo-input");
  const lengthInput = document.getElementById("length-input");
  const filenameInput = document.getElementById("filename-input");
  const playBtn = document.getElementById("play-btn");
  const addTrackBtn = document.getElementById("add-track-btn");
  const downloadBtn = document.getElementById("download-btn");
  const downloadLink = document.getElementById("download-link");
  const tracksContainer = document.getElementById("tracks-container");

  let bars = 3;
  function getSteps() {
    return bars * STEPS_PER_BAR;
  }

  function noteLabel(note) {
    const name = NOTE_NAMES[note % 12];
    const octave = Math.floor(note / 12) - 1;
    return `${name}${octave}`;
  }

  function newTrackGrids() {
    const active = {};
    const tie = {};
    const steps = getSteps();
    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
      active[note] = new Array(steps).fill(false);
      tie[note] = new Array(steps).fill(false);
    }
    return { active, tie };
  }

  function resizeTrackGrids(track, newSteps) {
    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
      const a = track.active[note];
      const t = track.tie[note];
      while (a.length < newSteps) {
        a.push(false);
        t.push(false);
      }
      a.length = newSteps;
      t.length = newSteps;
    }
  }

  // --- track state ---
  let nextTrackId = 0;
  const tracks = []; // { id, instrumentIndex, active, tie, cellEls }

  function addTrack() {
    if (tracks.length >= MAX_TRACKS) return;
    tracks.push({ id: nextTrackId++, instrumentIndex: 0, cellEls: new Map(), ...newTrackGrids() });
    renderTracks();
  }

  function removeTrack(id) {
    if (tracks.length <= 1) return; // always keep at least one
    const i = tracks.findIndex((t) => t.id === id);
    if (i !== -1) tracks.splice(i, 1);
    renderTracks();
  }

  function clearTrack(track) {
    Object.assign(track, newTrackGrids());
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

  // --- cell state + visuals ---
  // A cell "merges right" when the *next* step ties back to it, so the
  // border between them disappears and the run reads as one bar.
  function refreshCellVisual(track, note, step) {
    const steps = getSteps();
    if (step < 0 || step >= steps) return;
    const el = track.cellEls.get(`${note}:${step}`);
    if (!el) return;
    el.classList.toggle("active", track.active[note][step]);
    const mergesRight = step + 1 < steps && track.active[note][step + 1] && track.tie[note][step + 1];
    el.classList.toggle("merge-right", !!mergesRight);
  }

  function setCellValue(track, note, step, value, tie) {
    track.active[note][step] = value;
    track.tie[note][step] = value ? tie : false;
    // Turning a cell off also breaks whatever the *next* step was tied to
    // it — otherwise that step would silently keep claiming a connection
    // to a note that no longer exists.
    if (!value && step + 1 < getSteps()) track.tie[note][step + 1] = false;
    refreshCellVisual(track, note, step - 1);
    refreshCellVisual(track, note, step);
    refreshCellVisual(track, note, step + 1);
  }

  // --- click-and-drag painting, Shift held = tie into one note ---
  // dragState.paintValue is fixed for the whole gesture (from the first
  // cell's *new* state) so sweeping back over already-painted cells can't
  // flicker them back off. dragState.tieRow restricts tying to the row the
  // drag started on — connecting different pitches into "one tone" isn't
  // meaningful, so a drag that wanders into another row just paints there.
  let dragState = null;

  function pointerEnterCell(track, note, step) {
    if (!dragState || dragState.track !== track) return;
    const tie = !dragState.isFirst && dragState.shiftTie && note === dragState.tieRow;
    setCellValue(track, note, step, dragState.paintValue, tie);
    dragState.isFirst = false;
  }

  function pointerDownCell(e, track, note, step) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const cell = e.currentTarget;
    try {
      if (cell.hasPointerCapture(e.pointerId)) cell.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* not captured — nothing to release */
    }
    dragState = {
      track,
      tieRow: note,
      shiftTie: e.shiftKey,
      paintValue: !track.active[note][step],
      isFirst: true,
    };
    pointerEnterCell(track, note, step);
  }

  window.addEventListener("pointerup", () => {
    dragState = null;
  });
  window.addEventListener("pointercancel", () => {
    dragState = null;
  });

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

    track.cellEls.clear();
    const steps = getSteps();
    for (let note = HIGH_NOTE; note >= LOW_NOTE; note--) {
      const row = document.createElement("div");
      row.className = "midi-row";

      const rowLabel = document.createElement("span");
      rowLabel.className = "midi-row-label" + (note % 12 === 0 ? " is-c" : "");
      rowLabel.textContent = noteLabel(note);
      row.appendChild(rowLabel);

      for (let step = 0; step < steps; step++) {
        const cell = document.createElement("div");
        cell.className = "midi-cell" + (step % 4 === 0 ? " beat-start" : "");
        cell.dataset.note = note;
        cell.dataset.step = step;
        cell.addEventListener("pointerdown", (e) => pointerDownCell(e, track, note, step));
        cell.addEventListener("pointerenter", () => pointerEnterCell(track, note, step));
        row.appendChild(cell);
        track.cellEls.set(`${note}:${step}`, cell);
      }

      grid.appendChild(row);
    }

    // Set initial classes from state now that every cell exists (merge-right
    // depends on a neighboring cell, so this has to happen after the loop).
    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
      for (let step = 0; step < steps; step++) refreshCellVisual(track, note, step);
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

  function clampBars() {
    const v = parseInt(lengthInput.value, 10);
    return Math.max(MIN_BARS, Math.min(MAX_BARS, isNaN(v) ? bars : v));
  }

  lengthInput.addEventListener("change", () => {
    const newBars = clampBars();
    lengthInput.value = newBars;
    if (newBars === bars) return;
    bars = newBars;
    tracks.forEach((track) => resizeTrackGrids(track, getSteps()));
    renderTracks();
  });

  // --- segments: collapse each note row's active+tied runs into single
  // (startStep, endStep) spans — shared by both export and preview so
  // they always agree on what "one held note" means. ---
  function trackSegments(track) {
    const steps = getSteps();
    const segments = [];
    for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
      let step = 0;
      while (step < steps) {
        if (!track.active[note][step]) {
          step++;
          continue;
        }
        const startStep = step;
        step++;
        while (step < steps && track.active[note][step] && track.tie[note][step]) step++;
        segments.push({ note, startStep, endStep: step });
      }
    }
    return segments;
  }

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

  // One oscillator+gain "voice" with its own attack/decay envelope and
  // optional vibrato; triggerPreviewNote calls this once (plainly) or
  // twice (base + a detuned layer) per instrument.preview recipe.
  function playPreviewVoice(preview, freq, startTime, durationSec, peakGain, detuneCents) {
    const osc = audioCtx.createOscillator();
    osc.type = preview.wave;
    osc.frequency.value = freq;
    if (detuneCents) osc.detune.value = detuneCents;

    if (preview.vibrato) {
      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = preview.vibrato.rate;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = preview.vibrato.depth;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);
      lfo.start(startTime);
      lfo.stop(startTime + durationSec + 0.05);
    }

    const attack = Math.min(preview.attack, durationSec * 0.5);
    const releaseStart = Math.max(startTime + attack, startTime + durationSec - 0.03);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain * preview.decayTo), releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.05);
  }

  function triggerPreviewNote(instrument, note, startTime, durationSec) {
    const preview = instrument.preview;
    const freq = noteFreq(note);
    playPreviewVoice(preview, freq, startTime, durationSec, 0.18, 0);
    if (preview.detuneVoice) {
      playPreviewVoice(preview, freq, startTime, durationSec, 0.18 * preview.voiceGain, preview.detuneVoice);
    }
  }

  function playPreviewStep(step) {
    document.querySelectorAll(".midi-cell.playhead").forEach((c) => c.classList.remove("playhead"));
    const stepDurationSec = 60 / clampTempo() / 4;

    for (const track of tracks) {
      const instrument = INSTRUMENTS[track.instrumentIndex];
      const gridEl = tracksContainer.querySelector(`.midi-grid[data-track-id="${track.id}"]`);
      for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
        if (!track.active[note][step]) continue;

        const cell = gridEl && gridEl.querySelector(`.midi-cell[data-note="${note}"][data-step="${step}"]`);
        if (cell) cell.classList.add("playhead");

        if (track.tie[note][step]) continue; // already sounding, started at the segment's first step

        let len = 1;
        const steps = getSteps();
        while (step + len < steps && track.active[note][step + len] && track.tie[note][step + len]) len++;
        const durationSec = stepDurationSec * len;

        triggerPreviewNote(instrument, note, audioCtx.currentTime, durationSec);
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
      previewStep = (previewStep + 1) % getSteps();
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
    for (const seg of trackSegments(track)) {
      events.push({ tick: seg.startStep * TICKS_PER_STEP, bytes: [0x90 | channel, seg.note, 100] });
      events.push({ tick: seg.endStep * TICKS_PER_STEP, bytes: [0x80 | channel, seg.note, 64] });
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
