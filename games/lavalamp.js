(function () {
  const BASE_COLORS = [
    { id: "red", hex: "#e63946", label: "Red" },
    { id: "yellow", hex: "#ffd166", label: "Yellow" },
    { id: "blue", hex: "#3a86ff", label: "Blue" },
    { id: "black", hex: "#000000", label: "Black" },
    { id: "white", hex: "#ffffff", label: "White" },
  ];

  // Shared between both difficulties — the plain secondaries mean the same
  // thing (two different primaries) whichever mode asks for them.
  const ORANGE = { id: "orange", label: "Orange", pair: ["red", "yellow"] };
  const GREEN = { id: "green", label: "Green", pair: ["yellow", "blue"] };
  const PURPLE = { id: "purple", label: "Purple", pair: ["red", "blue"] };

  // Easy: only red/yellow/blue, only 2 pours, and everything asked for is
  // either a secondary (two different primaries) or a primary itself — made
  // by pouring the same primary in twice, since there's no separate "just
  // one color" recipe length in this engine.
  const EASY_TARGETS = [
    { id: "primaryRed", label: "Red", pair: ["red", "red"] },
    { id: "primaryYellow", label: "Yellow", pair: ["yellow", "yellow"] },
    { id: "primaryBlue", label: "Blue", pair: ["blue", "blue"] },
    ORANGE,
    GREEN,
    PURPLE,
  ];

  // Hard: every color the player might be asked to make, including black
  // and white. Most are 2-ingredient (a secondary, or a primary lightened/
  // darkened with white/black); the secondary tints/shades need all 3 — a
  // primary pair plus white or black — which is why hard mode accepts up to
  // 3 colors instead of 2.
  const HARD_TARGETS = [
    { id: "lightRed", label: "Pink", pair: ["red", "white"] },
    { id: "darkRed", label: "Dark Red", pair: ["red", "black"] },
    { id: "lightYellow", label: "Light Yellow", pair: ["yellow", "white"] },
    { id: "darkYellow", label: "Dark Yellow", pair: ["yellow", "black"] },
    { id: "lightBlue", label: "Light Blue", pair: ["blue", "white"] },
    { id: "darkBlue", label: "Dark Blue", pair: ["blue", "black"] },
    ORANGE,
    GREEN,
    PURPLE,
    { id: "lightOrange", label: "Light Orange", pair: ["red", "yellow", "white"] },
    { id: "darkOrange", label: "Dark Orange", pair: ["red", "yellow", "black"] },
    { id: "lightGreen", label: "Light Green", pair: ["yellow", "blue", "white"] },
    { id: "darkGreen", label: "Dark Green", pair: ["yellow", "blue", "black"] },
    { id: "lightPurple", label: "Light Purple", pair: ["red", "blue", "white"] },
    { id: "darkPurple", label: "Dark Purple", pair: ["red", "blue", "black"] },
  ];

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  }
  function colorById(id) {
    return BASE_COLORS.find((c) => c.id === id);
  }
  function mixColors(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  }
  // Averages any number of colors (2 or 3 here) — used for both 2- and
  // 3-ingredient targets so one function covers every recipe length.
  function blendMany(hexes) {
    const rgbs = hexes.map(hexToRgb);
    const sum = (key) => rgbs.reduce((s, c) => s + c[key], 0) / rgbs.length;
    return rgbToHex(sum("r"), sum("g"), sum("b"));
  }

  // Plain RGB averaging works fine for tinting/shading (mixing in white or
  // black), but it badly misrepresents mixing two hues — yellow and blue in
  // particular average toward gray/teal instead of green, since they sit
  // near-complementary in RGB space (real subtractive pigment mixing doesn't
  // work that way, which is the whole reason "yellow+blue=green" is a
  // familiar fact). So the two chromatic primaries get a curated result
  // instead of a computed one; white/black are then still averaged in on
  // top of that, which looks correct since tinting doesn't have this problem.
  const CHROMATIC_IDS = ["red", "yellow", "blue"];
  const SECONDARY_MIX = {
    "red,yellow": "#f3812e",
    "blue,yellow": "#3fa34d",
    "blue,red": "#8e4fae",
  };

  function blendIds(ids) {
    const chromatic = ids.filter((id) => CHROMATIC_IDS.includes(id));
    const modifiers = ids.filter((id) => !CHROMATIC_IDS.includes(id));

    let baseHex = chromatic.length === 2 ? SECONDARY_MIX[[...chromatic].sort().join(",")] : null;
    if (!baseHex && chromatic.length) {
      // 1 chromatic color (nothing to mis-mix), or all 3 at once (an
      // official recipe never asks for this — real paint just muddies
      // toward brown when you mix every primary, which a flat average
      // approximates fine).
      baseHex = blendMany(chromatic.map((id) => colorById(id).hex));
    }

    const modifierHexes = modifiers.map((id) => colorById(id).hex);
    if (!baseHex) return blendMany(modifierHexes); // only black/white picked
    return modifierHexes.length ? blendMany([baseHex, ...modifierHexes]) : baseHex;
  }

  // Each target's swatch is the true blend of its own recipe, so "the color
  // to make" always matches what mixing those base colors actually produces
  // in the lamp — correctness below just compares the picked id set to
  // target.pair rather than doing any float color-distance check.
  [...EASY_TARGETS, ...HARD_TARGETS].forEach((t) => {
    t.hex = blendIds(t.pair);
  });

  const LAMP_IMAGE = new Image();
  LAMP_IMAGE.src = "games/images/lavalamp1.png";
  // The sprite's "glass" interior is transparent pixels bounded by rows 5-22
  // and columns 11-20 of its 32x32 grid (read directly off the source art),
  // expressed as fractions of the drawn size so the floating area scales
  // with whatever size the lamp is rendered at.
  const BULB_LEFT_FRAC = 10.5 / 32;
  const BULB_RIGHT_FRAC = 20.5 / 32;
  const BULB_TOP_FRAC = 4.5 / 32;
  const BULB_BOTTOM_FRAC = 22.5 / 32;

  // The room the lamp lives in: 96x64, the same 3:2 shape as the canvas. It
  // began as a 64x64 drawing that was widened by 16 pixels each side, and
  // everything below measured in "room pixels" still uses that original
  // drawing's grid — hence the image's left edge sitting at x = -16.
  const ROOM_IMAGE = new Image();
  ROOM_IMAGE.src = "games/images/lavalamp-room.png";
  const ROOM_LEFT = -16;
  const ROOM_W = 96;
  const ROOM_H = 64;
  const ROOM_WALL_HEX = "#72d572"; // the art's wall color, shown until the image loads
  // Where the lamp stands: bottom-center of its sprite, on the dresser's top
  // edge (row 26), right of the window so it has plain wall behind it.
  const ROOM_LAMP_X = 27;
  const ROOM_LAMP_BOTTOM = 26;
  const ROOM_LAMP_SIZE = 12;

  // A movie-poster-shaped (2:3) slice of the Cool Cars title screen — a
  // screenshot of it without the title text or START button, cropped around
  // the car — centered on the bare wall between the floor lamp's shade and
  // the right edge of the room. It's background
  // dressing, so it's dimmed toward the game's navy to keep it from pulling
  // the eye.
  const POSTER_IMAGE = new Image();
  POSTER_IMAGE.src = "games/images/lavalamp-poster.png";
  const POSTER_X = 60;
  const POSTER_Y = 13;
  const POSTER_W = 16;
  const POSTER_H = 24;
  const POSTER_EDGE = 0.4;
  const POSTER_DIM = "rgba(10,37,64,0.3)";

  // The dancing robots that join the disco. Two 32x32 frames side by side:
  // arms down (the original art), then arms up (the same art with each
  // forearm and claw mirrored to stand above its shoulder).
  const ROBOT_IMAGE = new Image();
  ROBOT_IMAGE.src = "games/images/lavalamp-robot.png";
  const ROBOT_FRAME = 32;

  // The fish tank on the dresser: its water is rows 17-25 of the art,
  // between the tank's frame at column -4 and the one at column 15.
  const TANK_LEFT = -3;
  const TANK_TOP = 17;
  const TANK_BOTTOM = 26;
  const TANK_RIGHT = 15;
  // The fish art faces left and only fills part of its 32x32 frame (columns
  // 7-29, rows 11-21), so these locate its body within the frame.
  const FISH_IMAGE = new Image();
  FISH_IMAGE.src = "games/images/lavalamp-fish.png";
  const FISH_BODY_CX_FRAC = 18.5 / 32;
  const FISH_BODY_CY_FRAC = 16.5 / 32;
  const FISH_BODY_HALF_W_FRAC = 11.5 / 32;
  const FISH_BODY_HALF_H_FRAC = 5.5 / 32;
  // Drawn frame size of each fish, in room pixels, back to front. The small
  // ones read as further away, so they're also slower and a little washed out.
  const FISH_SIZES = [3, 3.4, 4.3, 4.8, 5.5];
  // Fish smaller than this swim behind the plant, the rest in front of it.
  const FISH_FAR_SIZE = 4;
  // The plant art is rooted at the bottom edge of its 32x32 frame. Drawn 9
  // room pixels square it stands most of the water's height, toward the
  // tank's right end so a little of it stays in view during gameplay.
  const PLANT_IMAGE = new Image();
  PLANT_IMAGE.src = "games/images/lavalamp-plant.png";
  const PLANT_SIZE = 9;
  const PLANT_LEFT = 6.5;
  const PANEL_FILL = "rgba(5,24,46,0.85)";

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // --- sound: synthesized live via Web Audio, same tone() idiom as the rest of the site ---
  function makeSound() {
    let ctx = null;
    function ensureCtx() {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    function tone(freq, dur, when, type, peakGain) {
      const c = ensureCtx();
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(when);
      osc.stop(when + dur + 0.02);
    }

    // --- background music: a 70s disco-funk groove, sequenced live so there
    // are no files to ship. Four-on-the-floor kick, offbeat open hats, a
    // syncopated bass, clav stabs through a wah and a square-wave lead, all on
    // a swung 16th-note grid. The chords loop every four bars, but the bass
    // and stab patterns are re-picked each bar and the lead is improvised
    // from the minor pentatonic, so it never plays the same way twice.
    const TEMPO_BPM = 112;
    const STEP_SEC = 60 / TEMPO_BPM / 4; // one 16th note
    const SWING = 0.14; // how late the off 16ths land, as a fraction of a step
    const STEPS_PER_BAR = 16;
    // One entry per half bar. `bass` is the root as a MIDI note, `color` the
    // interval above it that suits the chord (flat 7th, or 6th under the
    // major chord), `stab` the voicing the clav plays.
    const AM7 = { bass: 45, color: 10, stab: [57, 60, 64, 67] };
    const D9 = { bass: 50, color: 10, stab: [54, 57, 60, 64] };
    const FMAJ7 = { bass: 41, color: 9, stab: [53, 57, 60, 64] };
    const E7 = { bass: 40, color: 10, stab: [56, 62, 67] };
    const CHORDS = [AM7, AM7, D9, D9, AM7, AM7, FMAJ7, E7];
    // Bass lines as step -> interval above the chord's root ("c" = its color note).
    const BASS_PATTERNS = [
      { 0: 0, 3: 0, 4: 12, 6: 0, 8: 0, 10: "c", 11: 12, 14: 7 },
      { 0: 0, 2: 12, 4: 0, 6: 12, 8: 0, 10: 12, 12: 7, 14: "c" },
      { 0: 0, 3: 12, 6: 0, 7: 0, 8: 12, 11: 7, 12: "c", 14: 12 },
    ];
    const STAB_PATTERNS = [
      [3, 6, 11, 14],
      [2, 7, 10, 15],
      [3, 4, 10, 13],
    ];
    const LEAD_RHYTHMS = [
      [0, 3, 6, 8, 11, 14],
      [2, 4, 7, 10],
      [0, 2, 3, 6, 10, 12, 13],
      [4, 6, 7, 10, 12],
    ];
    const LEAD_SCALE = [69, 72, 74, 76, 79, 81, 84, 86, 88]; // A minor pentatonic, A4 up

    let musicBus = null;
    let musicTimerId = null;
    let noiseBuffer = null;
    let nextStepTime = 0;
    let stepIndex = 0;
    let bassPattern = BASS_PATTERNS[0];
    let stabPattern = STAB_PATTERNS[0];
    let leadRhythm = null; // null on the bars the lead sits out
    let leadDegree = 3;

    function midiHz(note) {
      return 440 * Math.pow(2, (note - 69) / 12);
    }
    function pickOne(list) {
      return list[Math.floor(Math.random() * list.length)];
    }

    // Short burst of filtered noise: hats and the body of the snare.
    function noiseHit(when, dur, peakGain, filterType, filterHz) {
      const c = ensureCtx();
      const src = c.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = c.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterHz;
      const gain = c.createGain();
      gain.gain.setValueAtTime(peakGain, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(musicBus);
      src.start(when, Math.random() * 0.5);
      src.stop(when + dur + 0.02);
    }

    function kick(when) {
      const c = ensureCtx();
      const osc = c.createOscillator();
      osc.frequency.setValueAtTime(150, when);
      osc.frequency.exponentialRampToValueAtTime(48, when + 0.11);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.9, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);
      osc.connect(gain);
      gain.connect(musicBus);
      osc.start(when);
      osc.stop(when + 0.26);
    }

    function snare(when) {
      noiseHit(when, 0.16, 0.42, "bandpass", 2200);
      const c = ensureCtx();
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(220, when);
      osc.frequency.exponentialRampToValueAtTime(150, when + 0.08);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.3, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
      osc.connect(gain);
      gain.connect(musicBus);
      osc.start(when);
      osc.stop(when + 0.12);
    }

    // A pitched voice through a filter whose cutoff sweeps from filterFrom to
    // filterTo over the note — the pluck of the bass, the "wah" of the clav.
    function synthNote(when, dur, notes, type, peakGain, filterType, filterFrom, filterTo, q) {
      const c = ensureCtx();
      const filter = c.createBiquadFilter();
      filter.type = filterType;
      filter.Q.value = q;
      filter.frequency.setValueAtTime(filterFrom, when);
      filter.frequency.exponentialRampToValueAtTime(filterTo, when + dur);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      filter.connect(gain);
      gain.connect(musicBus);
      notes.forEach((note) => {
        const osc = c.createOscillator();
        osc.type = type;
        osc.frequency.value = midiHz(note);
        osc.connect(filter);
        osc.start(when);
        osc.stop(when + dur + 0.02);
      });
    }

    function scheduleStep(index, when) {
      const step = index % STEPS_PER_BAR;
      const halfBar = Math.floor(index / (STEPS_PER_BAR / 2)) % CHORDS.length;
      const chord = CHORDS[halfBar];

      if (step === 0) {
        bassPattern = pickOne(BASS_PATTERNS);
        stabPattern = pickOne(STAB_PATTERNS);
        leadRhythm = Math.random() < 0.6 ? pickOne(LEAD_RHYTHMS) : null;
      }

      if (step % 4 === 0) kick(when);
      if (step === 4 || step === 12) snare(when);
      if (step % 4 === 2) noiseHit(when, 0.2, 0.13, "highpass", 7000); // open hat on the offbeat
      else noiseHit(when, 0.04, step % 2 ? 0.05 : 0.1, "highpass", 8000);

      const bassInterval = bassPattern[step];
      if (bassInterval !== undefined) {
        const note = chord.bass + (bassInterval === "c" ? chord.color : bassInterval);
        synthNote(when, STEP_SEC * 1.6, [note], "sawtooth", 0.4, "lowpass", 1400, 260, 5);
      }

      if (stabPattern.includes(step)) {
        synthNote(when, STEP_SEC * 1.3, chord.stab, "square", 0.045, "bandpass", 700, 2400, 4);
      }

      if (leadRhythm && leadRhythm.includes(step)) {
        // Mostly steps to a neighbouring note, held inside the scale's range.
        leadDegree += pickOne([-2, -1, -1, 1, 1, 2]);
        leadDegree = Math.max(0, Math.min(LEAD_SCALE.length - 1, leadDegree));
        synthNote(when, STEP_SEC * 2.2, [LEAD_SCALE[leadDegree]], "square", 0.07, "lowpass", 3200, 1200, 1);
      }
    }

    // Web Audio events have to be queued slightly ahead of time, so this
    // wakes up often and schedules every step due in the next 150ms.
    function pumpMusic() {
      const c = ensureCtx();
      while (nextStepTime < c.currentTime + 0.15) {
        const swing = stepIndex % 2 ? STEP_SEC * SWING : 0;
        scheduleStep(stepIndex, nextStepTime + swing);
        stepIndex++;
        nextStepTime += STEP_SEC;
      }
      musicTimerId = setTimeout(pumpMusic, 40);
    }

    // Browsers slow timers right down in a background tab, which would make
    // the groove stutter — so the whole context is paused while hidden.
    function onVisibilityChange() {
      if (!ctx) return;
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    }

    function startMusic() {
      if (musicBus) return;
      const c = ensureCtx();
      musicBus = c.createGain();
      musicBus.gain.setValueAtTime(0.0001, c.currentTime);
      musicBus.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 1.2);
      musicBus.connect(c.destination);

      noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

      nextStepTime = c.currentTime + 0.1;
      stepIndex = 0;
      document.addEventListener("visibilitychange", onVisibilityChange);
      pumpMusic();
    }

    // Spoken with the browser's built-in voice rather than recordings, so
    // every color name is covered without shipping a clip per color. Where
    // there's no speech support (or no voice installed) it's simply silent.
    let sayTimerId = null;
    function say(text, delayMs) {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      clearTimeout(sayTimerId);
      sayTimerId = setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }, delayMs);
    }

    return {
      startMusic,
      // Already-queued notes would otherwise keep playing after the cartridge
      // is ejected, so fade out and drop the whole context.
      stop() {
        clearTimeout(sayTimerId);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        if (musicTimerId) clearTimeout(musicTimerId);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (!ctx) return;
        const c = ctx;
        if (musicBus) musicBus.gain.setTargetAtTime(0, c.currentTime, 0.05);
        setTimeout(() => c.close(), 300);
      },
      pick() {
        tone(520, 0.09, ensureCtx().currentTime, "sine", 0.18);
      },
      mix() {
        const now = ensureCtx().currentTime;
        tone(300, 0.12, now, "sine", 0.14);
        tone(220, 0.16, now + 0.08, "sine", 0.12);
      },
      // Wrong-guess "miss" is deliberately silent — the game is meant to stay
      // low-pressure for kids, so a bad mix just resets quietly rather than
      // sounding a negative cue.
      celebrate() {
        const now = ensureCtx().currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.16, now + i * 0.1, "square", 0.18));
      },
      // Names the color just made, timed to land right after celebrate()'s
      // half-second arpeggio instead of talking over it.
      sayColor(label) {
        say(label, 550);
      },
    };
  }

  function startLavalamp(canvas) {
    const W = 720;
    const H = 480;
    const RENDER_SCALE = 2;
    canvas.width = W * RENDER_SCALE;
    canvas.height = H * RENDER_SCALE;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false; // keep the pixel-art lamp crisp when scaled up

    let state = "start"; // start, zooming, playing
    let zoomT = 0; // 0..1 progress of the title-to-gameplay zoom
    const ZOOM_FRAMES = 110; // ~1.8s
    let mode = null; // "easy" or "hard", set by the title-screen buttons
    let clickTargets = [];
    let running = true;
    let rafId;
    let hoverPoint = null;
    let animFrame = 0;
    const sound = makeSound();

    const PLAY_LAMP_SIZE = 290;
    const PLAY_LAMP_X = (W - PLAY_LAMP_SIZE) / 2;
    const PLAY_LAMP_Y = 96;
    const bulb = {
      left: PLAY_LAMP_X + PLAY_LAMP_SIZE * BULB_LEFT_FRAC,
      right: PLAY_LAMP_X + PLAY_LAMP_SIZE * BULB_RIGHT_FRAC,
      top: PLAY_LAMP_Y + PLAY_LAMP_SIZE * BULB_TOP_FRAC,
      bottom: PLAY_LAMP_Y + PLAY_LAMP_SIZE * BULB_BOTTOM_FRAC,
    };
    const bulbCX = (bulb.left + bulb.right) / 2;
    const bulbCY = (bulb.top + bulb.bottom) / 2;

    // A camera is a zoom (canvas px per room pixel) plus where the lamp's
    // foot lands on the canvas. CAM_OUT fits the whole room on the canvas;
    // CAM_IN blows the lamp up to exactly the PLAY_LAMP_* box, so the bulb
    // math above doesn't need to know the room exists.
    const OUT_ZOOM = H / ROOM_H;
    const CAM_OUT = {
      zoom: OUT_ZOOM,
      footX: (ROOM_LAMP_X - ROOM_LEFT) * OUT_ZOOM,
      footY: ROOM_LAMP_BOTTOM * OUT_ZOOM,
    };
    const CAM_IN = {
      zoom: PLAY_LAMP_SIZE / ROOM_LAMP_SIZE,
      footX: PLAY_LAMP_X + PLAY_LAMP_SIZE / 2,
      footY: PLAY_LAMP_Y + PLAY_LAMP_SIZE,
    };
    // Zoom is interpolated geometrically so the push-in feels like a steady
    // speed rather than rushing at the start and crawling at the end.
    function zoomCamera(t) {
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      return {
        zoom: CAM_OUT.zoom * Math.pow(CAM_IN.zoom / CAM_OUT.zoom, e),
        footX: CAM_OUT.footX + (CAM_IN.footX - CAM_OUT.footX) * e,
        footY: CAM_OUT.footY + (CAM_IN.footY - CAM_OUT.footY) * e,
      };
    }

    let target = null;
    let picks = []; // up to maxPicks() base-color ids currently in the lamp
    let blobs = [];
    let mixFramesLeft = 0;
    let resolved = false; // true once a mix has finished and settled into a single result
    const MIX_DELAY_FRAMES = 180; // ~3s at the 60fps-equivalent dt unit used below, restarted on every pour
    let merge = null; // { t, duration, from: [blobSnapshot, ...], resultHex, correct }
    let message = null; // { text, color, framesLeft, totalFrames }

    // The correct-answer celebration: a mirror ball drops in and throws
    // colored spots of light across the room. Deliberately a slow drift with
    // soft fades, never a flash or strobe. It runs for as long as the pause
    // before the next round (the 2200ms advance timeout).
    let disco = null; // { t } in frames, while the party's on
    const DISCO_FRAMES = 132;
    const DISCO_FADE_IN = 18;
    const DISCO_FADE_OUT = 26;
    const DISCO_BALL_X = 600;
    const DISCO_BALL_Y = 104;
    const DISCO_BALL_R = 30;
    const DISCO_FACET = 8;
    const DISCO_COLORS = ["#ff5fa2", "#ffd166", "#5ee6ff", "#9dff6b", "#c58bff", "#ffffff"];
    // Robots pop up from behind the dresser either side of the lamp and dance
    // for as long as the ball is down. Each entry is [left arm up, right arm
    // up] for one half beat of the music.
    const ROBOT_SIZE = 150;
    const ROBOT_OFFSET_X = 168; // each robot's center, out from the lamp's
    const ROBOT_STEP_FRAMES = (60 / 112 / 2) * 60; // half a beat at the music's tempo
    const ROBOT_MOVES = [
      [true, true],
      [false, false],
      [true, false],
      [false, true],
    ];
    const DISCO_SPOTS = Array.from({ length: 28 }, (_, i) => ({
      x: Math.random() * (W + 80),
      y: Math.random() * H,
      r: 9 + Math.random() * 9,
      speed: 1.1 + Math.random() * 1.3, // canvas px per frame, all one way: the ball only spins one direction
      phase: Math.random() * 6.28,
      color: DISCO_COLORS[i % DISCO_COLORS.length],
    }));
    let advanceTimeoutId = null;

    // Easy: 2-color pours only, from EASY_TARGETS. Hard: up to 3, from the
    // full HARD_TARGETS (light/dark tints/shades, black/white included).
    function maxPicks() {
      return mode === "easy" ? 2 : 3;
    }
    function targetPool() {
      return mode === "easy" ? EASY_TARGETS : HARD_TARGETS;
    }
    function activeColors() {
      return mode === "easy" ? BASE_COLORS.slice(0, 3) : BASE_COLORS;
    }

    function pickRandomTarget(excludeId) {
      const pool = targetPool();
      const options = excludeId ? pool.filter((t) => t.id !== excludeId) : pool;
      return options[Math.floor(Math.random() * options.length)];
    }

    function startNewRound(keepTarget) {
      if (advanceTimeoutId) {
        clearTimeout(advanceTimeoutId);
        advanceTimeoutId = null;
      }
      if (!keepTarget) target = pickRandomTarget(target && target.id);
      picks = [];
      blobs = [];
      merge = null;
      mixFramesLeft = 0;
      message = null;
      resolved = false;
      // A new round can start early (the player pours again mid-party), so
      // skip ahead to the fade-out rather than cutting the lights dead.
      if (disco) disco.t = Math.max(disco.t, DISCO_FRAMES - DISCO_FADE_OUT);
    }

    // slot 0 (first pick) enters from the top, slot 1 (second) from the
    // bottom, slot 2 (third, when a recipe needs one) from the middle.
    function spawnBlob(hex, slot) {
      const radius = 18;
      const x = bulbCX + (Math.random() - 0.5) * 8;
      const y = slot === 0 ? bulb.top + radius + 3 : slot === 1 ? bulb.bottom - radius - 3 : bulbCY;
      blobs.push({
        hex,
        radius,
        x,
        y,
        vx: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5),
        vy: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.4),
        wobble: Math.random() * Math.PI * 2,
      });
    }

    function showMessage(text, color, frames) {
      message = { text, color, framesLeft: frames, totalFrames: frames };
    }

    // Picking a color once a mix has already settled into a result (right or
    // wrong) always clears the lamp first, even after just 2 colors — the
    // player doesn't get to keep adding onto an already-resolved mix. While
    // still building up to that (2 colors, floating, not yet resolved), a
    // pour is still treated as reaching for a 3rd ingredient in hard mode;
    // only hitting the mode's cap unresolved also clears, same as an
    // already-resolved pour.
    function pickColor(id) {
      if (resolved || picks.length >= maxPicks()) startNewRound(true);
      picks.push(id);
      spawnBlob(colorById(id).hex, picks.length - 1);
      sound.pick();
      if (picks.length >= 2) mixFramesLeft = MIX_DELAY_FRAMES;
    }

    function updateBlob(b, dt) {
      b.x += b.vx * dt + Math.sin(animFrame * 0.02 + b.wobble) * 0.25;
      b.y += b.vy * dt + Math.cos(animFrame * 0.017 + b.wobble) * 0.25;
      if (b.x - b.radius < bulb.left) {
        b.x = bulb.left + b.radius;
        b.vx = Math.abs(b.vx);
      } else if (b.x + b.radius > bulb.right) {
        b.x = bulb.right - b.radius;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y - b.radius < bulb.top) {
        b.y = bulb.top + b.radius;
        b.vy = Math.abs(b.vy);
      } else if (b.y + b.radius > bulb.bottom) {
        b.y = bulb.bottom - b.radius;
        b.vy = -Math.abs(b.vy);
      }
    }

    // Easy mode keeps an exact-multiset match (its targets are always
    // exactly 2 picks anyway, so there's no room for this to matter). Hard
    // mode instead only requires the *set* of colors used to match the
    // target's — any ratio counts, so a dark-blue target (blue + black)
    // accepts 1-blue-2-black, 2-blue-1-black, or 1-of-each alike, not just
    // the one exact combination.
    function startMerge() {
      const resultHex = blendIds(picks);
      let correct;
      if (mode === "hard") {
        const uniquePicks = [...new Set(picks)].sort().join(",");
        const uniqueTarget = [...new Set(target.pair)].sort().join(",");
        correct = uniquePicks === uniqueTarget;
      } else {
        const sortedPicks = [...picks].sort().join(",");
        const sortedTarget = [...target.pair].sort().join(",");
        correct = sortedPicks === sortedTarget;
      }
      merge = { t: 0, duration: 36, from: blobs.map((b) => ({ ...b })), resultHex, correct };
      sound.mix();
    }

    function finishMerge() {
      const { resultHex, correct } = merge;
      blobs = [
        {
          hex: resultHex,
          radius: 26,
          x: bulbCX,
          y: bulbCY,
          vx: (Math.random() < 0.5 ? -1 : 1) * 0.4,
          vy: (Math.random() < 0.5 ? -1 : 1) * 0.3,
          wobble: Math.random() * Math.PI * 2,
        },
      ];
      merge = null;
      resolved = true;
      if (correct) {
        showMessage("You made " + target.label + "!", "#ffd166", 150);
        sound.celebrate();
        sound.sayColor(target.label);
        disco = { t: 0 };
        // Guarded by clearing this in startNewRound(): if the player pours a
        // fresh color in before this fires, that reset already cancels it,
        // so a stale advance can never clobber a round the player restarted.
        advanceTimeoutId = setTimeout(() => {
          advanceTimeoutId = null;
          if (running) startNewRound(false);
        }, 2200);
      } else {
        showMessage("Not quite — try again!", "#f6dcac", 90);
      }
    }

    function update(dt) {
      updateFish(dt);
      if (state === "zooming") {
        zoomT += dt / ZOOM_FRAMES;
        if (zoomT >= 1) state = "playing";
        return;
      }
      if (state !== "playing") return;
      if (merge) {
        merge.t += dt / merge.duration;
        if (merge.t >= 1) finishMerge();
      } else {
        blobs.forEach((b) => updateBlob(b, dt));
        if (picks.length >= 2 && mixFramesLeft > 0) {
          mixFramesLeft -= dt;
          if (mixFramesLeft <= 0) startMerge();
        }
      }
      if (message) {
        message.framesLeft -= dt;
        if (message.framesLeft <= 0) message = null;
      }
      if (disco) {
        disco.t += dt;
        if (disco.t >= DISCO_FRAMES) disco = null;
      }
    }

    // --- drawing ---

    function button(x, y, w, h, action, fill) {
      clickTargets.push({ x, y, w, h, action });
      const isHover = hoverPoint && hoverPoint.x >= x && hoverPoint.x <= x + w && hoverPoint.y >= y && hoverPoint.y <= y + h;
      ctx.save();
      if (isHover) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(1.04, 1.04);
        ctx.translate(-(x + w / 2), -(y + h / 2));
      }
      roundRect(ctx, x, y, w, h, 14);
      ctx.fillStyle = fill || "#0a2540";
      ctx.fill();
      ctx.lineWidth = isHover ? 3 : 2;
      ctx.strokeStyle = "#f6dcac";
      ctx.stroke();
      ctx.restore();
    }

    function drawColorButton(x, y, size, color) {
      clickTargets.push({ x, y, w: size, h: size, action: () => pickColor(color.id) });
      const isHover = hoverPoint && hoverPoint.x >= x && hoverPoint.x <= x + size && hoverPoint.y >= y && hoverPoint.y <= y + size;
      const cx = x + size / 2;
      const cy = y + size / 2;
      ctx.save();
      if (isHover) {
        ctx.translate(cx, cy);
        ctx.scale(1.08, 1.08);
        ctx.translate(-cx, -cy);
      }
      roundRect(ctx, x, y, size, size, 14);
      ctx.fillStyle = "#0a2540";
      ctx.fill();
      ctx.lineWidth = isHover ? 3 : 2;
      ctx.strokeStyle = "#f6dcac";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 - 12, 0, Math.PI * 2);
      ctx.fillStyle = color.hex;
      ctx.fill();
      // A faint ring so black (and dark blends) still read as a distinct
      // circle against the navy card behind it, not just a void.
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#f6dcac";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(color.label, cx, y + size + 16);
    }

    function drawLampSprite(x, y, size) {
      if (LAMP_IMAGE.complete && LAMP_IMAGE.naturalWidth) {
        ctx.drawImage(LAMP_IMAGE, x, y, size, size);
      }
    }

    function pickFishTarget(f) {
      const halfW = f.size * FISH_BODY_HALF_W_FRAC;
      const halfH = f.size * FISH_BODY_HALF_H_FRAC;
      const minX = TANK_LEFT + halfW + 0.3;
      const maxX = TANK_RIGHT - halfW - 0.3;
      // Far enough away that it's a real swim across, not a twitch.
      do {
        f.targetX = minX + Math.random() * (maxX - minX);
      } while (Math.abs(f.targetX - f.x) < (maxX - minX) * 0.3);
      f.targetY = TANK_TOP + halfH + 0.6 + Math.random() * (TANK_BOTTOM - TANK_TOP - 2 * halfH - 1.2);
    }
    const fish = FISH_SIZES.map((size) => {
      const f = { size, x: TANK_LEFT + Math.random() * (TANK_RIGHT - TANK_LEFT), y: 0, phase: Math.random() * 6.28 };
      f.speed = (0.02 + Math.random() * 0.01) * (size / 4.5); // room pixels per frame
      pickFishTarget(f);
      f.y = f.targetY;
      return f;
    });

    function updateFish(dt) {
      fish.forEach((f) => {
        const dx = f.targetX - f.x;
        const step = f.speed * dt;
        if (Math.abs(dx) <= step) {
          pickFishTarget(f);
          return;
        }
        f.x += Math.sign(dx) * step;
        f.y += (f.targetY - f.y) * Math.min(1, 0.01 * dt);
      });
    }

    function drawFish(near) {
      if (!(FISH_IMAGE.complete && FISH_IMAGE.naturalWidth)) return;
      fish.forEach((f) => {
        if (f.size >= FISH_FAR_SIZE !== near) return;
        const bob = Math.sin(animFrame * 0.03 + f.phase) * 0.25;
        ctx.save();
        ctx.translate(f.x, f.y + bob);
        if (f.targetX > f.x) ctx.scale(-1, 1); // the art faces left
        ctx.globalAlpha = near ? 1 : 0.7;
        ctx.drawImage(FISH_IMAGE, -f.size * FISH_BODY_CX_FRAC, -f.size * FISH_BODY_CY_FRAC, f.size, f.size);
        ctx.restore();
      });
    }

    // Drawn one row of the art at a time, each nudged sideways by a slow
    // wave that grows toward the tips, so it sways while staying rooted.
    function drawPlant() {
      if (!(PLANT_IMAGE.complete && PLANT_IMAGE.naturalWidth)) return;
      const rows = PLANT_IMAGE.naturalHeight;
      const rowH = PLANT_SIZE / rows;
      const top = TANK_BOTTOM - PLANT_SIZE;
      for (let r = 0; r < rows; r++) {
        const sway = Math.sin(animFrame * 0.02 + r * 0.15) * 0.3 * (1 - r / (rows - 1));
        // Slightly over-tall so neighbouring rows overlap instead of leaving a seam.
        ctx.drawImage(PLANT_IMAGE, 0, r, PLANT_IMAGE.naturalWidth, 1, PLANT_LEFT + sway, top + r * rowH, PLANT_SIZE, rowH * 1.1);
      }
    }

    function drawTank() {
      ctx.save();
      ctx.beginPath();
      ctx.rect(TANK_LEFT, TANK_TOP, TANK_RIGHT - TANK_LEFT, TANK_BOTTOM - TANK_TOP);
      ctx.clip();
      drawFish(false);
      drawPlant();
      drawFish(true);
      ctx.restore();
    }

    // Draws the room and the lamp standing in it, as seen by `cam`.
    function drawScene(cam) {
      ctx.fillStyle = ROOM_WALL_HEX;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.translate(cam.footX - ROOM_LAMP_X * cam.zoom, cam.footY - ROOM_LAMP_BOTTOM * cam.zoom);
      ctx.scale(cam.zoom, cam.zoom);
      if (ROOM_IMAGE.complete && ROOM_IMAGE.naturalWidth) {
        ctx.drawImage(ROOM_IMAGE, ROOM_LEFT, 0, ROOM_W, ROOM_H);
      }
      if (POSTER_IMAGE.complete && POSTER_IMAGE.naturalWidth) {
        ctx.fillStyle = "#212121"; // the room art's outline color
        ctx.fillRect(POSTER_X - POSTER_EDGE, POSTER_Y - POSTER_EDGE, POSTER_W + 2 * POSTER_EDGE, POSTER_H + 2 * POSTER_EDGE);
        // A screenshot rather than pixel art, so let it scale smoothly.
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(POSTER_IMAGE, POSTER_X, POSTER_Y, POSTER_W, POSTER_H);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = POSTER_DIM;
        ctx.fillRect(POSTER_X, POSTER_Y, POSTER_W, POSTER_H);
      }
      drawTank();
      const lampX = ROOM_LAMP_X - ROOM_LAMP_SIZE / 2;
      const lampY = ROOM_LAMP_BOTTOM - ROOM_LAMP_SIZE;
      drawLampGlass(lampX, lampY, ROOM_LAMP_SIZE);
      drawLampSprite(lampX, lampY, ROOM_LAMP_SIZE);
      ctx.restore();
    }

    // The sprite's glass is transparent, so without this the room would show
    // through and tint how the lava colors read. Painted before the sprite,
    // half a sprite-pixel under its outline: the main glass (rows 5-22) plus
    // the 4-pixel notch in the base below it (row 23).
    function drawLampGlass(x, y, size) {
      const px = size / 32;
      ctx.fillStyle = "#0a2540";
      ctx.fillRect(x + 10.5 * px, y + 4.5 * px, 11 * px, 19 * px);
      ctx.fillRect(x + 13.5 * px, y + 23 * px, 5 * px, 1.5 * px);
    }

    function drawPanel(x, y, w, h) {
      roundRect(ctx, x, y, w, h, 12);
      ctx.fillStyle = PANEL_FILL;
      ctx.fill();
    }

    // A real lava lamp blob isn't a flat circle — it's a soft, slowly
    // wobbling glob of wax with a glossy highlight and a faint glow. This
    // builds an irregular outline (radius wobbling per angle, two sine
    // frequencies layered so it doesn't look like a simple pulsing circle),
    // then fills it with a radial gradient (lightened center, true hex
    // mid-tone, darkened rim) for a waxy, lit-from-within look.
    const BLOB_POINTS = 10;
    function drawLavaBlob(x, y, r, hex, seed) {
      ctx.save();
      ctx.beginPath();
      const pts = [];
      for (let i = 0; i < BLOB_POINTS; i++) {
        const angle = (i / BLOB_POINTS) * Math.PI * 2;
        const wobble =
          Math.sin(angle * 3 + seed + animFrame * 0.025) * 0.6 + Math.sin(angle * 5 - seed * 1.7 + animFrame * 0.014) * 0.4;
        const rad = r * (1 + wobble * 0.12);
        pts.push({ x: x + Math.cos(angle) * rad, y: y + Math.sin(angle) * rad });
      }
      ctx.moveTo((pts[0].x + pts[pts.length - 1].x) / 2, (pts[0].y + pts[pts.length - 1].y) / 2);
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i];
        const next = pts[(i + 1) % pts.length];
        ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
      }
      ctx.closePath();

      const gradient = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r * 1.15);
      gradient.addColorStop(0, mixColors(hex, "#ffffff", 0.5));
      gradient.addColorStop(0.55, hex);
      gradient.addColorStop(1, mixColors(hex, "#000000", 0.3));
      ctx.fillStyle = gradient;
      ctx.shadowColor = hex;
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.ellipse(x - r * 0.28, y - r * 0.32, r * 0.24, r * 0.15, -0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fill();
    }

    function drawStartScreen() {
      drawScene(CAM_OUT);

      // Title up in the bare wall above the furniture, buttons down over the
      // floor, so neither hides the lamp on the dresser.
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#05182e";
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 64px 'Comic Sans MS', sans-serif";
      ctx.strokeText("LAVALAMP", W / 2, 50);
      ctx.fillText("LAVALAMP", W / 2, 50);

      function chooseMode(chosen) {
        mode = chosen;
        state = "zooming";
        zoomT = 0;
        sound.startMusic();
        startNewRound(false);
      }

      const btnW = 150;
      const btnGap = 20;
      const btnY = 412;
      const btnH = 56;
      const totalBtnW = btnW * 2 + btnGap;
      const easyX = W / 2 - totalBtnW / 2;
      const hardX = easyX + btnW + btnGap;

      button(easyX, btnY, btnW, btnH, () => chooseMode("easy"), "#3fa34d");
      button(hardX, btnY, btnW, btnH, () => chooseMode("hard"), "#e63946");

      ctx.fillStyle = "#fff";
      ctx.font = "bold 26px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("EASY", easyX + btnW / 2, btnY + btnH / 2);
      ctx.fillText("HARD", hardX + btnW / 2, btnY + btnH / 2);
    }

    function drawDisco() {
      // 0..1: how far the party has faded in (or back out).
      const k = Math.min(1, disco.t / DISCO_FADE_IN, (DISCO_FRAMES - disco.t) / DISCO_FADE_OUT);
      const ease = k * k * (3 - 2 * k);

      // Room lights down a little so the spots show up against the wall.
      ctx.fillStyle = "rgba(5,24,46," + 0.4 * ease + ")";
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.6 * ease;
      DISCO_SPOTS.forEach((sp) => {
        const x = ((sp.x + animFrame * sp.speed) % (W + 80)) - 40;
        const y = sp.y + Math.sin(animFrame * 0.02 + sp.phase) * 8;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, sp.r);
        glow.addColorStop(0, sp.color);
        glow.addColorStop(0.6, sp.color);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, sp.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // The lights land on the wall behind the lamp, not on the lamp.
      drawLampGlass(PLAY_LAMP_X, PLAY_LAMP_Y, PLAY_LAMP_SIZE);
      drawLampSprite(PLAY_LAMP_X, PLAY_LAMP_Y, PLAY_LAMP_SIZE);

      // Robots rise from behind the dresser's top edge, where the lamp stands.
      // The right-hand one is mirrored so the pair dance as reflections.
      if (ROBOT_IMAGE.complete && ROBOT_IMAGE.naturalWidth) {
        const floorY = PLAY_LAMP_Y + PLAY_LAMP_SIZE;
        const move = ROBOT_MOVES[Math.floor(disco.t / ROBOT_STEP_FRAMES) % ROBOT_MOVES.length];
        const hop = move[0] || move[1] ? 6 : 0;
        const top = floorY - ROBOT_SIZE * ease - hop * ease;
        const half = ROBOT_FRAME / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, floorY);
        ctx.clip();
        [-1, 1].forEach((side) => {
          ctx.save();
          ctx.translate(W / 2 + side * ROBOT_OFFSET_X, top);
          ctx.scale(-side, 1);
          // Each half of the robot comes from whichever frame has that arm
          // in the right place, so the arms can move independently.
          ctx.drawImage(ROBOT_IMAGE, move[0] ? ROBOT_FRAME : 0, 0, half, ROBOT_FRAME, -ROBOT_SIZE / 2, 0, ROBOT_SIZE / 2, ROBOT_SIZE);
          ctx.drawImage(ROBOT_IMAGE, (move[1] ? ROBOT_FRAME : 0) + half, 0, half, ROBOT_FRAME, 0, 0, ROBOT_SIZE / 2, ROBOT_SIZE);
          ctx.restore();
        });
        ctx.restore();
      }

      // The ball itself, lowered from above the screen on a cord.
      const by = -DISCO_BALL_R + (DISCO_BALL_Y + DISCO_BALL_R) * ease;
      ctx.fillStyle = "#212121";
      ctx.fillRect(DISCO_BALL_X - 1.5, 0, 3, Math.max(0, by - DISCO_BALL_R));
      ctx.save();
      ctx.beginPath();
      ctx.arc(DISCO_BALL_X, by, DISCO_BALL_R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#5c6677";
      ctx.fillRect(DISCO_BALL_X - DISCO_BALL_R, by - DISCO_BALL_R, DISCO_BALL_R * 2, DISCO_BALL_R * 2);
      // Mirror tiles sliding sideways read as the ball turning; each one
      // glints on its own slow cycle, a few of them in color.
      const slide = (animFrame * 0.35) % DISCO_FACET;
      const cells = Math.ceil((DISCO_BALL_R * 2) / DISCO_FACET) + 1;
      const turn = Math.floor((animFrame * 0.35) / DISCO_FACET);
      for (let i = -1; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          const id = i - turn; // stays with the tile as it slides across
          const glint = 0.5 + 0.5 * Math.sin(animFrame * 0.08 + id * 1.9 + j * 2.7);
          const tinted = (((id * 7 + j * 13) % 5) + 5) % 5 === 0;
          ctx.globalAlpha = 0.35 + 0.65 * glint;
          ctx.fillStyle = tinted ? DISCO_COLORS[(((id + j) % 5) + 5) % 5] : "#e8eef7";
          ctx.fillRect(
            DISCO_BALL_X - DISCO_BALL_R + i * DISCO_FACET + slide + 1,
            by - DISCO_BALL_R + j * DISCO_FACET + 1,
            DISCO_FACET - 2,
            DISCO_FACET - 2
          );
        }
      }
      ctx.globalAlpha = 1;
      const shade = ctx.createRadialGradient(
        DISCO_BALL_X - DISCO_BALL_R * 0.35, by - DISCO_BALL_R * 0.4, DISCO_BALL_R * 0.2,
        DISCO_BALL_X, by, DISCO_BALL_R
      );
      shade.addColorStop(0, "rgba(255,255,255,0.25)");
      shade.addColorStop(0.5, "rgba(0,0,0,0)");
      shade.addColorStop(1, "rgba(5,24,46,0.6)");
      ctx.fillStyle = shade;
      ctx.fillRect(DISCO_BALL_X - DISCO_BALL_R, by - DISCO_BALL_R, DISCO_BALL_R * 2, DISCO_BALL_R * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(DISCO_BALL_X, by, DISCO_BALL_R, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#212121";
      ctx.stroke();
    }

    function drawPlayingScreen() {
      drawScene(CAM_IN);
      if (disco) drawDisco();

      drawPanel(W / 2 - 90, 4, 180, 96);
      ctx.beginPath();
      ctx.arc(W / 2, 42, 28, 0, Math.PI * 2);
      ctx.fillStyle = target.hex;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#f6dcac";
      ctx.stroke();

      ctx.fillStyle = "#f6dcac";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("Make " + target.label, W / 2, 78);

      ctx.save();
      roundRect(ctx, bulb.left, bulb.top, bulb.right - bulb.left, bulb.bottom - bulb.top, 6);
      ctx.clip();
      if (merge) {
        merge.from.forEach((b) => {
          const t = merge.t;
          const x = b.x + (bulbCX - b.x) * t;
          const y = b.y + (bulbCY - b.y) * t;
          const r = b.radius * (1 - t * 0.6);
          drawLavaBlob(x, y, r, b.hex, b.wobble);
        });
      } else {
        blobs.forEach((b) => drawLavaBlob(b.x, b.y, b.radius, b.hex, b.wobble));
      }
      ctx.restore();

      // Pinned to the upper half of the glass, above where the merged blob
      // settles (bulbCY), so the resulting color — right or wrong — stays
      // fully visible instead of being hidden behind this banner.
      if (message) {
        const bw = 340;
        const bh = 40;
        const bx = W / 2 - bw / 2;
        const by = 145;
        drawPanel(bx, by, bw, bh);
        ctx.lineWidth = 2;
        ctx.strokeStyle = message.color;
        ctx.stroke();
        ctx.fillStyle = message.color;
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(message.text, W / 2, by + bh / 2);
      }

      const colors = activeColors();
      const btnSize = 56;
      const gap = 24;
      const totalW = colors.length * btnSize + (colors.length - 1) * gap;
      const startX = (W - totalW) / 2;
      const btnY = 396;
      drawPanel(startX - 20, btnY - 8, totalW + 40, btnSize + 36);
      colors.forEach((c, i) => {
        drawColorButton(startX + i * (btnSize + gap), btnY, btnSize, c);
      });
    }

    function draw() {
      clickTargets = [];
      if (state === "start") drawStartScreen();
      else if (state === "zooming") drawScene(zoomCamera(zoomT));
      else drawPlayingScreen();
    }

    function pointFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = W / rect.width;
      const scaleY = H / rect.height;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }

    function onClick(e) {
      const p = pointFromEvent(e);
      for (const t of clickTargets) {
        if (p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h) {
          t.action();
          break;
        }
      }
    }
    function onMouseMove(e) {
      hoverPoint = pointFromEvent(e);
      canvas.style.cursor = clickTargets.some(
        (t) => hoverPoint.x >= t.x && hoverPoint.x <= t.x + t.w && hoverPoint.y >= t.y && hoverPoint.y <= t.y + t.h
      )
        ? "pointer"
        : "default";
    }
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", onMouseMove);

    // Same dt-scaling approach as cool-cars.js: every per-frame amount above
    // is tuned as "per 60fps-equivalent frame," and dt converts real elapsed
    // time into that unit so timers/motion run at the same real-world speed
    // regardless of the display's actual refresh rate.
    const REFERENCE_MS = 1000 / 60;
    let lastTime = null;

    function loop(now) {
      if (!running) return;
      if (lastTime === null) lastTime = now;
      let delta = now - lastTime;
      lastTime = now;
      if (delta > 250) delta = 250; // don't lurch forward after a backgrounded tab
      const dt = delta / REFERENCE_MS;

      animFrame += dt;
      update(dt);
      draw();
      rafId = requestAnimationFrame(loop);
    }

    running = true;
    rafId = requestAnimationFrame(loop);

    return {
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        if (advanceTimeoutId) clearTimeout(advanceTimeoutId);
        sound.stop();
        canvas.removeEventListener("click", onClick);
        canvas.removeEventListener("mousemove", onMouseMove);
        canvas.style.cursor = "default";
      },
    };
  }

  window.STEGO_GAMES = window.STEGO_GAMES || {};
  window.STEGO_GAMES.lavalamp = {
    title: "Lavalamp",
    start: startLavalamp,
    controlsHint: "Click colors to pour into the lamp — match the color shown up top",
  };
})();
