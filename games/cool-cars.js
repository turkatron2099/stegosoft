(function () {
  const ANIMALS = [
    { id: "dog", emoji: "🐶", label: "Dog" },
    { id: "cat", emoji: "🐱", label: "Cat" },
    { id: "horse", emoji: "🐴", label: "Horse" },
    { id: "pig", emoji: "🐷", label: "Pig" },
    { id: "elephant", emoji: "🐘", label: "Elephant" },
    { id: "tiger", emoji: "🐯", label: "Tiger" },
    { id: "monkey", emoji: "🐵", label: "Monkey" },
    { id: "bear", emoji: "🐻", label: "Bear" },
  ];

  const VEHICLES = [
    { id: "sports", emoji: "🏎️", label: "Car" },
    { id: "truck", emoji: "🚚", label: "Truck" },
  ];

  const COLORS = [
    { id: "red", hex: "#e63946", label: "Red" },
    { id: "orange", hex: "#f3922b", label: "Orange" },
    { id: "yellow", hex: "#ffd166", label: "Yellow" },
    { id: "green", hex: "#43aa8b", label: "Green" },
    { id: "blue", hex: "#3a86ff", label: "Blue" },
    { id: "purple", hex: "#8338ec", label: "Purple" },
    { id: "pink", hex: "#ff5fa2", label: "Pink" },
  ];

  // Real recorded animal clips, keyed by animal id. animalSound() below
  // falls back to the synthesized version for any id missing here, in case
  // a future animal gets added without a clip yet. Preloaded once at module
  // scope so restarting the game doesn't re-fetch them.
  const ANIMAL_SOUND_FILES = {
    dog: "games/sounds/dog.mp3",
    cat: "games/sounds/cat.mp3",
    horse: "games/sounds/horse.mp3",
    pig: "games/sounds/pig.mp3",
    elephant: "games/sounds/elephant.mp3",
    tiger: "games/sounds/tiger.mp3",
    monkey: "games/sounds/monkey.mp3",
    bear: "games/sounds/bear.mp3",
  };
  const ANIMAL_AUDIO = {};
  Object.entries(ANIMAL_SOUND_FILES).forEach(([id, src]) => {
    const audio = new Audio(src);
    audio.preload = "auto";
    ANIMAL_AUDIO[id] = audio;
  });

  // Real background music per screen. makeSound()'s startCruiseMusic/
  // startMusic/startVictoryMusic play these directly, falling back to the
  // synthesized chiptune loop (further down) if a track fails to play.
  // Quieter than the sound effects (which play at full volume) so pickups,
  // honks, and animal noises still cut through.
  const MUSIC_FILES = {
    cruise: "games/sounds/title-screen-music.mp3",
    main: "games/sounds/in-game-music.mp3",
    victory: "games/sounds/victory-music.mp3",
  };
  const MUSIC_AUDIO = {};
  Object.entries(MUSIC_FILES).forEach(([key, src]) => {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = 0.4;
    MUSIC_AUDIO[key] = audio;
  });

  // Real horn honk. honk() below falls back to the synthesized version if
  // this fails to load/play. Trucks get their own, deeper horn clip.
  const HONK_AUDIO = new Audio("games/sounds/honk.mp3");
  HONK_AUDIO.preload = "auto";
  const TRUCK_HONK_AUDIO = new Audio("games/sounds/truck-horn.mp3");
  TRUCK_HONK_AUDIO.preload = "auto";

  // Pixel-art player sprite. Loaded once at module scope so it's ready
  // (and cached) across restarts; drawPlayerVehicle falls back to the old
  // procedural shape until it finishes loading.
  const PLAYER_CAR_IMAGE = new Image();
  PLAYER_CAR_IMAGE.src = "games/images/player-car.png";
  // The sprite's body is drawn at ~hue 231deg (blue); recolor it per
  // selection with a hue-rotate filter instead of needing a sprite per color.
  const PLAYER_CAR_BASE_HUE = 231;

  // Pixel-art oncoming-traffic sprite, recolored the same way as the player
  // sprite. Drawn red (~hue 5deg) by design.
  const NPC_CAR_IMAGE = new Image();
  NPC_CAR_IMAGE.src = "games/images/npc-car.png";
  const NPC_CAR_BASE_HUE = 5;

  // Pixel-art player truck sprite, recolored the same way. Same red family
  // as the NPC sprite, so it shares its base hue.
  const PLAYER_TRUCK_IMAGE = new Image();
  PLAYER_TRUCK_IMAGE.src = "games/images/truck.png";
  const PLAYER_TRUCK_BASE_HUE = 5;

  // Pixel-art title-screen car, drawn as-is (no recolor) since it's a fixed
  // decorative element rather than a player-selectable vehicle.
  const TITLE_CAR_IMAGE = new Image();
  TITLE_CAR_IMAGE.src = "games/images/title-screen-car.png";

  // Pixel-art truck icon for the vehicle picker. Recolored blue via the same
  // hue-rotate machinery as the player sprites (see drawVehicleScreen).
  const TRUCK_OPTION_IMAGE = new Image();
  TRUCK_OPTION_IMAGE.src = "games/images/truck-option.png";
  const TRUCK_OPTION_BASE_HUE = 0;

  // Tileable grass texture for the roadside during gameplay.
  const GRASS_IMAGE = new Image();
  GRASS_IMAGE.src = "games/images/grass.png";

  // Roadside decorations (palm trees) scrolling past during gameplay.
  // ROADSIDE_MIN_GAP is the minimum vertical clearance kept between any two
  // items on the same side, checked at spawn
  // time — since every item moves at the identical SCROLL_SPEED afterward,
  // a safe gap at spawn stays safe forever (same trick used for cars/numbers).
  const ROADSIDE_MIN_GAP = 70;

  const ROAD_LEFT = 180;
  const ROAD_RIGHT = 540;
  const SCROLL_SPEED = 3.5;
  const STEER_SPEED = 5;
  const CRASH_FRAMES = 72;

  function hexToHue(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  // Canvas's `filter` (hue-rotate/saturate/brightness) is much more
  // expensive per draw than a plain drawImage — costly when several NPC
  // cars are recolored independently every single frame. Render each
  // (sprite, color) combination through the filter exactly once into a
  // small offscreen canvas at native resolution, then every later draw is
  // just a cheap unfiltered drawImage from that cache. Module-level so the
  // cache survives game restarts, not just one playthrough.
  const SPRITE_RECOLOR_CACHE = new Map(); // image -> Map(color -> canvas)

  function getRecoloredSprite(image, color, baseHue, extraFilterMap) {
    if (!image.complete || image.naturalWidth === 0) return null;

    let byColor = SPRITE_RECOLOR_CACHE.get(image);
    if (!byColor) {
      byColor = new Map();
      SPRITE_RECOLOR_CACHE.set(image, byColor);
    }

    let cached = byColor.get(color);
    if (!cached) {
      cached = document.createElement("canvas");
      cached.width = image.naturalWidth;
      cached.height = image.naturalHeight;
      const octx = cached.getContext("2d");
      const extra = extraFilterMap[color] || "";
      octx.filter = `hue-rotate(${hexToHue(color) - baseHue}deg) ${extra}`.trim();
      octx.drawImage(image, 0, 0);
      byColor.set(color, cached);
    }
    return cached;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }
  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // --- sound: everything synthesized live via Web Audio, no audio files ---
  function makeSound() {
    let ctx = null;
    let musicTimer = null;
    let musicPlaying = false;
    let musicStep = 0;

    // Three short, entirely original riffs (composed here in code, so
    // there's no licensing question about where they came from): a laid-back
    // loop for the title/picker screens, a peppier one for gameplay, and a
    // brighter, faster fanfare for the win screen.
    const CRUISE_MELODY = [220.0, 261.63, 329.63, 392.0, 329.63, 293.66, 261.63, 246.94];
    const CRUISE_STEP_SECONDS = 0.3;
    const MAIN_MELODY = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 392.0, 440.0];
    const MAIN_STEP_SECONDS = 0.19;
    const VICTORY_MELODY = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.51, 1046.5];
    const VICTORY_STEP_SECONDS = 0.15;
    let currentMelody = CRUISE_MELODY;
    let currentStepSeconds = CRUISE_STEP_SECONDS;
    let currentWave = "triangle";
    let currentSustain = 0.8;

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

    // For sounds with a pitch that bends/wobbles over time (meow, neigh,
    // trumpet, roar) — freqFn(t) maps 0..1 across the sound's duration to
    // a frequency in Hz.
    function curveTone(freqFn, dur, when, type, peakGain) {
      const c = ensureCtx();
      const osc = c.createOscillator();
      osc.type = type;
      const steps = 50;
      const curve = new Float32Array(steps);
      for (let i = 0; i < steps; i++) curve[i] = Math.max(20, freqFn(i / (steps - 1)));
      osc.frequency.setValueCurveAtTime(curve, when, dur);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(when);
      osc.stop(when + dur + 0.02);
    }

    // Stylized, cartoonish approximations — not recordings — built the same
    // synthesized way as everything else here, so there's nothing to license.
    const ANIMAL_SOUNDS = {
      dog(now) {
        tone(190, 0.1, now, "square", 0.22);
        tone(160, 0.12, now + 0.15, "square", 0.22);
      },
      cat(now) {
        curveTone((t) => 420 + 320 * Math.sin(Math.PI * t), 0.35, now, "triangle", 0.16);
      },
      horse(now) {
        curveTone((t) => 360 - 90 * t + 26 * Math.sin(t * 40), 0.45, now, "sawtooth", 0.16);
      },
      pig(now) {
        tone(150, 0.09, now, "sawtooth", 0.2);
        tone(115, 0.11, now + 0.13, "sawtooth", 0.2);
      },
      elephant(now) {
        curveTone((t) => 220 + 420 * Math.pow(t, 0.5) + (t > 0.6 ? 18 * Math.sin(t * 60) : 0), 0.5, now, "sawtooth", 0.18);
      },
      tiger(now) {
        curveTone((t) => 100 - 15 * t + 22 * Math.sin(t * 10), 0.55, now, "sawtooth", 0.2);
      },
      monkey(now) {
        [0, 0.08, 0.16, 0.24].forEach((dt, i) => {
          tone(i % 2 === 0 ? 520 : 660, 0.06, now + dt, "square", 0.15);
        });
      },
      bear(now) {
        curveTone((t) => 85 - 20 * t + 14 * Math.sin(t * 6), 0.6, now, "sawtooth", 0.22);
      },
    };

    function scheduleMusicStep() {
      if (!musicPlaying) return;
      const c = ensureCtx();
      tone(currentMelody[musicStep % currentMelody.length], currentStepSeconds * currentSustain, c.currentTime, currentWave, 0.05);
      musicStep++;
      musicTimer = setTimeout(scheduleMusicStep, currentStepSeconds * 1000);
    }

    function startSynthLoop(melody, stepSeconds, wave, sustain) {
      if (musicTimer) clearTimeout(musicTimer);
      currentMelody = melody;
      currentStepSeconds = stepSeconds;
      currentWave = wave;
      currentSustain = sustain;
      musicStep = 0;
      musicPlaying = true;
      scheduleMusicStep();
    }

    function stopRealMusic() {
      Object.values(MUSIC_AUDIO).forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
    }

    // Plays the real track for this screen, restarting it from the top.
    // Falls back to the synthesized loop if playback fails for any reason
    // (the file missing, a decode error, autoplay being blocked) so there's
    // still music either way.
    function playTrack(key, melody, stepSeconds, wave, sustain) {
      musicPlaying = false;
      if (musicTimer) clearTimeout(musicTimer);
      stopRealMusic();

      const audio = MUSIC_AUDIO[key];
      const playResult = audio && audio.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => startSynthLoop(melody, stepSeconds, wave, sustain));
      } else if (!audio) {
        startSynthLoop(melody, stepSeconds, wave, sustain);
      }
    }

    return {
      startCruiseMusic() {
        playTrack("cruise", CRUISE_MELODY, CRUISE_STEP_SECONDS, "triangle", 0.95);
      },
      startMusic() {
        playTrack("main", MAIN_MELODY, MAIN_STEP_SECONDS, "square", 0.8);
      },
      startVictoryMusic() {
        playTrack("victory", VICTORY_MELODY, VICTORY_STEP_SECONDS, "square", 0.8);
      },
      stopMusic() {
        musicPlaying = false;
        if (musicTimer) clearTimeout(musicTimer);
        stopRealMusic();
      },
      honk(isTruck) {
        // Clone so rapid honks (holding Space) overlap instead of cutting
        // each other off, same as animalSound() below.
        const audio = isTruck ? TRUCK_HONK_AUDIO : HONK_AUDIO;
        const playResult = audio.cloneNode().play();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => {
            const c = ensureCtx();
            const now = c.currentTime;
            tone(420, 0.14, now, "sawtooth", 0.18);
            tone(420, 0.14, now + 0.18, "sawtooth", 0.18);
          });
        }
      },
      coinPickup() {
        const c = ensureCtx();
        const now = c.currentTime;
        tone(988, 0.08, now, "square", 0.2);
        tone(1319, 0.18, now + 0.07, "square", 0.2);
      },
      animalSound(id) {
        const clip = ANIMAL_AUDIO[id];
        if (clip) {
          // Clone so rapid repeats (e.g. collecting numbers back to back)
          // overlap instead of cutting each other off.
          clip.cloneNode().play().catch(() => {});
          return;
        }
        const c = ensureCtx();
        const play = ANIMAL_SOUNDS[id];
        if (play) play(c.currentTime);
      },
    };
  }

  function startCoolCars(canvas) {
    // Render at a higher backing-store resolution than the canvas's logical
    // 720x480 size so content (especially the number pickups' text) stays
    // crisp when CSS stretches the canvas much larger, e.g. fullscreen.
    // Every existing draw call and click-coordinate calculation below keeps
    // using the same 720x480 logical space via W/H; ctx.setTransform just
    // makes that space map onto more actual pixels.
    const W = 720;
    const H = 480;
    const RENDER_SCALE = 2;
    canvas.width = W * RENDER_SCALE;
    canvas.height = H * RENDER_SCALE;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false; // keep the pixel-art sprite crisp when scaled up

    let state = "start"; // start, chooseAnimal, chooseVehicle, chooseColor, playing, won
    let selection = { animal: ANIMALS[0], vehicle: VEHICLES[0], color: COLORS[0] };
    let clickTargets = [];
    let running = true;
    let rafId;
    let hoverPoint = null;
    let animFrame = 0;
    let grassPattern = null; // lazily built once GRASS_IMAGE has loaded
    const sound = makeSound();

    let player, objects, nextNumber, crashTimer, spawnTimer, numberCooldown, roadside, roadsideTimer, popText, roadScroll;

    function resetGameplay() {
      const isTruck = selection.vehicle.id === "truck";
      player = {
        x: (ROAD_LEFT + ROAD_RIGHT) / 2,
        y: H - 96,
        w: isTruck ? 50 : 40,
        h: isTruck ? 76 : 68,
      };
      objects = [];
      nextNumber = 1;
      crashTimer = 0;
      spawnTimer = 80;
      numberCooldown = 120;
      popText = null;
      roadScroll = 0;
      // Pre-seeded so the roadside isn't empty for the first couple seconds;
      // spacing here already respects ROADSIDE_MIN_GAP.
      roadside = [
        { side: "left", y: -200, xJitter: rand(-16, 16), emoji: "🌴", size: 40 },
        { side: "left", y: -20, xJitter: rand(-16, 16), emoji: "🌴", size: 40 },
        { side: "right", y: -260, xJitter: rand(-16, 16), emoji: "🌴", size: 40 },
        { side: "right", y: -80, xJitter: rand(-16, 16), emoji: "🌴", size: 40 },
      ];
      roadsideTimer = 30;
    }

    function spawnRoadsideItem() {
      const side = Math.random() < 0.5 ? "left" : "right";
      const y = -60;
      const blocked = roadside.some((r) => r.side === side && Math.abs(r.y - y) < ROADSIDE_MIN_GAP);
      if (blocked) return false;
      roadside.push({
        side,
        y,
        xJitter: rand(-16, 16),
        emoji: "🌴",
        size: 40,
      });
      return true;
    }

    // x is fixed for the lifetime of every object here (only y scrolls), so
    // avoiding an x-overlap at spawn time guarantees two objects can never
    // visually collide later, regardless of how their y positions drift.
    function pickSafeX(halfWidth, avoid) {
      const lo = ROAD_LEFT + halfWidth;
      const hi = ROAD_RIGHT - halfWidth;
      if (lo > hi) return null;
      for (let attempt = 0; attempt < 16; attempt++) {
        const x = rand(lo, hi);
        const conflict = avoid.some((a) => Math.abs(x - a.center) < halfWidth + a.halfWidth + (a.buffer || 0));
        if (!conflict) return x;
      }
      return null;
    }

    function spawnObstacle() {
      const w = 44;
      const activeNumbers = objects
        .filter((o) => o.type === "number" && !o.collected)
        .map((o) => ({ center: o.x, halfWidth: o.r, buffer: 26 }));
      const x = pickSafeX(w / 2, activeNumbers);
      if (x === null) return; // no safe gap right now — just skip this spawn cycle
      const color = COLORS[randInt(0, COLORS.length - 1)];
      objects.push({ type: "car", x, y: -60, w: 44, h: 70, color: color.hex });
    }

    function spawnNumber() {
      const activeCars = objects.filter((o) => o.type === "car").map((o) => ({ center: o.x, halfWidth: o.w / 2, buffer: 26 }));
      const x = pickSafeX(20, activeCars);
      if (x === null) return false; // no clear gap right now
      objects.push({ type: "number", x, y: -40, r: 20, value: nextNumber });
      return true;
    }

    function triggerCrash(obstacle) {
      obstacle.collected = true;
      crashTimer = CRASH_FRAMES;
    }

    function rectsOverlap(a, b) {
      return Math.abs(a.x - b.x) < (a.w + b.w) / 2 - 6 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 6;
    }
    function circleOverlap(rect, circle) {
      return Math.hypot(rect.x - circle.x, rect.y - circle.y) < circle.r + rect.w / 2 - 4;
    }

    function update(dt) {
      if (state !== "playing") return;

      if (crashTimer > 0) {
        crashTimer -= dt;
        return;
      }

      const left = keys["ArrowLeft"] || keys["a"] || keys["A"];
      const right = keys["ArrowRight"] || keys["d"] || keys["D"];
      if (left) player.x -= STEER_SPEED * dt;
      if (right) player.x += STEER_SPEED * dt;
      player.x = clamp(player.x, ROAD_LEFT + player.w / 2 + 4, ROAD_RIGHT - player.w / 2 - 4);

      roadsideTimer -= dt;
      if (roadsideTimer <= 0) {
        const spawned = spawnRoadsideItem();
        roadsideTimer = spawned ? randInt(45, 70) : 15;
      }
      roadside.forEach((t) => (t.y += SCROLL_SPEED * dt));
      roadside = roadside.filter((t) => t.y < H + 60);
      roadScroll += SCROLL_SPEED * dt;

      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnObstacle();
        spawnTimer = randInt(75, 140);
      }
      numberCooldown -= dt;
      if (numberCooldown <= 0 && !objects.some((o) => o.type === "number")) {
        const spawned = spawnNumber();
        numberCooldown = spawned ? randInt(260, 380) : 20;
      }

      objects.forEach((o) => (o.y += SCROLL_SPEED * dt));
      objects = objects.filter((o) => o.y < H + 60);

      for (const o of objects) {
        if (o.type === "car" && rectsOverlap(player, o)) {
          triggerCrash(o);
          break;
        }
        if (o.type === "number" && circleOverlap(player, o)) {
          if (o.value === nextNumber) {
            o.collected = true;
            popText = { text: `${nextNumber}!`, life: 45 };
            sound.coinPickup();
            sound.animalSound(selection.animal.id);
            nextNumber++;
            if (nextNumber > 10) {
              state = "won";
              sound.startVictoryMusic();
            }
          }
        }
      }
      objects = objects.filter((o) => !o.collected);

      if (popText) {
        popText.life -= dt;
        if (popText.life <= 0) popText = null;
      }
    }

    // --- drawing helpers ---

    function emoji(text, x, y, size) {
      ctx.font = `${size}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x, y);
    }

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

    function drawSkyScene(useTitleCarSprite) {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, "#4fb3e8");
      sky.addColorStop(1, "#bfe8f7");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H * 0.72);

      ctx.fillStyle = "#e8c94a";
      ctx.beginPath();
      ctx.arc(W - 100, 90, 44, 0, Math.PI * 2);
      ctx.fill();

      function cloud(cx, cy, s, phase) {
        const bob = Math.sin(animFrame * 0.035 + phase) * 6;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        [[-1, 0], [-0.4, -0.35], [0.4, -0.3], [1, 0], [0, 0.15]].forEach(([dx, dy]) => {
          ctx.beginPath();
          ctx.arc(cx + dx * s, cy + dy * s + bob, s * 0.6, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      cloud(140, 90, 30, 0);
      cloud(420, 60, 24, 1.4);
      cloud(300, 140, 20, 2.7);

      ctx.fillStyle = "#6cb84a";
      ctx.fillRect(0, H * 0.72, W, H * 0.28);

      ctx.fillStyle = "#8d8f92";
      ctx.fillRect(0, H * 0.8, W, H * 0.14);
      ctx.strokeStyle = "#f6dcac";
      ctx.setLineDash([22, 18]);
      ctx.lineDashOffset = -(animFrame * 3);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.87);
      ctx.lineTo(W, H * 0.87);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      emoji("🌴", 70, H * 0.765, 36);
      emoji("🌴", W - 70, H * 0.765, 36);

      const bounce = Math.sin(animFrame * 0.12) * 3;
      if (useTitleCarSprite && TITLE_CAR_IMAGE.complete && TITLE_CAR_IMAGE.naturalWidth) {
        drawSideCarSprite(W / 2, H * 0.82 + bounce, 140);
      } else {
        drawSideCar(W / 2, H * 0.87 + bounce, "#e63946", "🐶");
      }
    }

    // Both picker sprites are exported as 32x32 canvases with the actual art
    // only filling a thin horizontal band — crop to that content box so
    // scaling doesn't offset the visible art from where it's centered.
    function drawCroppedSprite(image, content, cx, cy, w) {
      const { sx, sy, sw, sh } = content;
      const h = (sh / sw) * w;
      ctx.drawImage(image, sx, sy, sw, sh, cx - w / 2, cy - h / 2, w, h);
    }

    const TITLE_CAR_CONTENT = { sx: 0, sy: 15, sw: 32, sh: 13 };
    const TRUCK_OPTION_CONTENT = { sx: 0, sy: 10, sw: 32, sh: 12 };

    function drawSideCarSprite(cx, cy, w) {
      drawCroppedSprite(TITLE_CAR_IMAGE, TITLE_CAR_CONTENT, cx, cy, w);
    }

    function drawSideCar(cx, cy, color, driverEmoji) {
      ctx.save();
      ctx.translate(cx, cy);
      roundRect(ctx, -70, -22, 140, 44, 16);
      ctx.fillStyle = color;
      ctx.fill();
      roundRect(ctx, -34, -38, 62, 30, 10);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
      ctx.fillStyle = "#222";
      [[-46, 20], [46, 20]].forEach(([wx, wy]) => {
        ctx.beginPath();
        ctx.arc(wx, wy, 12, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      emoji(driverEmoji, cx - 4, cy - 30, 34);
    }

    function drawStartScreen() {
      drawSkyScene(true);

      ctx.textAlign = "center";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#05182e";
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 64px 'Comic Sans MS', sans-serif";
      ctx.strokeText("COOL CARS", W / 2, 90);
      ctx.fillText("COOL CARS", W / 2, 90);

      button(W / 2 - 90, 155, 180, 56, () => {
        state = "chooseAnimal";
      }, "#e63946");
      ctx.fillStyle = "#fff";
      ctx.font = "bold 26px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("START", W / 2, 183);
    }

    function drawHeading(text) {
      ctx.fillStyle = "#0a2540";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#f6dcac";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, W / 2, 56);
    }

    function drawAnimalScreen() {
      drawHeading("Choose your driver!");
      const cols = 4;
      const cellW = 150;
      const cellH = 130;
      const startX = (W - cols * cellW) / 2;
      const startY = 100;
      ANIMALS.forEach((a, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * cellW;
        const y = startY + row * cellH;
        button(x + 10, y, cellW - 20, cellH - 16, () => {
          selection.animal = a;
          sound.animalSound(a.id);
          state = "chooseVehicle";
        });
        emoji(a.emoji, x + cellW / 2, y + (cellH - 16) / 2 - 14, 46);
        ctx.fillStyle = "#f6dcac";
        ctx.font = "16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(a.label, x + cellW / 2, y + cellH - 34);
      });
    }

    function drawVehicleScreen() {
      drawHeading("Choose your ride!");
      const w = 240;
      const h = 200;
      const gap = 30;
      const startX = W / 2 - w - gap / 2;
      VEHICLES.forEach((v, i) => {
        const x = startX + i * (w + gap);
        const y = 140;
        button(x, y, w, h, () => {
          selection.vehicle = v;
          sound.honk(v.id === "truck");
          state = "chooseColor";
        });
        if (v.id === "sports" && TITLE_CAR_IMAGE.complete && TITLE_CAR_IMAGE.naturalWidth) {
          drawSideCarSprite(x + w / 2, y + h / 2 - 20, 150);
        } else if (v.id === "truck" && TRUCK_OPTION_IMAGE.complete && TRUCK_OPTION_IMAGE.naturalWidth) {
          const blueTruck = getRecoloredSprite(TRUCK_OPTION_IMAGE, "#3a86ff", TRUCK_OPTION_BASE_HUE, {});
          drawCroppedSprite(blueTruck || TRUCK_OPTION_IMAGE, TRUCK_OPTION_CONTENT, x + w / 2, y + h / 2 - 20, 150);
        } else {
          emoji(v.emoji, x + w / 2, y + h / 2 - 20, 72);
        }
        ctx.fillStyle = "#f6dcac";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(v.label, x + w / 2, y + h - 34);
      });
    }

    function drawColorScreen() {
      drawHeading("Choose a color!");
      const cols = 4;
      const size = 110;
      const gap = 20;
      const rowW = cols * size + (cols - 1) * gap;
      const startX = (W - rowW) / 2;

      const isTruck = selection.vehicle.id === "truck";
      const baseW = isTruck ? 50 : 40;
      const baseH = isTruck ? 76 : 68;
      const previewH = 74;
      const previewW = previewH * (baseW / baseH);

      COLORS.forEach((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const itemsInRow = row === 1 ? COLORS.length - cols : cols;
        const rowOffset = row === 1 ? (W - (itemsInRow * size + (itemsInRow - 1) * gap)) / 2 - startX : 0;
        const x = startX + col * (size + gap) + rowOffset;
        const y = 110 + row * (size + 50);
        clickTargets.push({
          x,
          y,
          w: size,
          h: size,
          action: () => {
            selection.color = c;
            state = "playing";
            resetGameplay();
            sound.startMusic();
          },
        });
        const isHover = hoverPoint && hoverPoint.x >= x && hoverPoint.x <= x + size && hoverPoint.y >= y && hoverPoint.y <= y + size;

        roundRect(ctx, x, y, size, size, 14);
        ctx.fillStyle = "#0a2540";
        ctx.fill();
        ctx.lineWidth = isHover ? 3 : 2;
        ctx.strokeStyle = "#f6dcac";
        ctx.stroke();

        const cx = x + size / 2;
        const cy = y + size / 2;
        ctx.save();
        if (isHover) {
          ctx.translate(cx, cy);
          ctx.scale(1.08, 1.08);
          ctx.translate(-cx, -cy);
        }
        drawPlayerVehicle(cx, cy, c.hex, selection.animal.emoji, previewW, previewH, selection.vehicle.id);
        ctx.restore();

        ctx.fillStyle = "#f6dcac";
        ctx.font = "15px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(c.label, x + size / 2, y + size + 18);
      });
    }

    function drawTopDownCar(cx, cy, color, driverEmoji, w, h) {
      const sprite = getRecoloredSprite(NPC_CAR_IMAGE, color, NPC_CAR_BASE_HUE, NPC_CAR_EXTRA_FILTER);
      if (sprite) {
        ctx.drawImage(sprite, cx - w / 2, cy - h / 2, w, h);
        if (driverEmoji) {
          emoji(driverEmoji, cx, cy - h * 0.18, Math.min(26, w * 0.6));
        }
        return;
      }
      ctx.save();
      roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 10);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();

      roundRect(ctx, cx - w / 2 + 6, cy - h / 2 + 10, w - 12, h * 0.35, 6);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fill();

      ctx.fillStyle = "#222";
      const wheelW = 6;
      const wheelH = 14;
      [
        [cx - w / 2 - wheelW / 2 + 2, cy - h / 2 + 12],
        [cx + w / 2 - wheelW / 2 - 2, cy - h / 2 + 12],
        [cx - w / 2 - wheelW / 2 + 2, cy + h / 2 - 26],
        [cx + w / 2 - wheelW / 2 - 2, cy + h / 2 - 26],
      ].forEach(([wx, wy]) => ctx.fillRect(wx, wy, wheelW, wheelH));
      ctx.restore();

      if (driverEmoji) {
        emoji(driverEmoji, cx, cy - h * 0.18, Math.min(26, w * 0.6));
      }
    }

    function drawWheels(cx, cy, w, h, wheelW, wheelH, topInset, bottomInset) {
      ctx.fillStyle = "#222";
      [
        [cx - w / 2 - wheelW / 2 + 2, cy - h / 2 + topInset],
        [cx + w / 2 - wheelW / 2 - 2, cy - h / 2 + topInset],
        [cx - w / 2 - wheelW / 2 + 2, cy + h / 2 - bottomInset],
        [cx + w / 2 - wheelW / 2 - 2, cy + h / 2 - bottomInset],
      ].forEach(([wx, wy]) => ctx.fillRect(wx, wy, wheelW, wheelH));
    }

    // Sleek, tapered top-down shape echoing the 🏎️ from the vehicle picker.
    function drawSportsCarTopDown(cx, cy, color, driverEmoji, w, h) {
      const hw = w / 2;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy - h / 2);
      ctx.lineTo(cx + hw * 0.45, cy - h / 2 + 12);
      ctx.lineTo(cx + hw, cy - h * 0.05);
      ctx.lineTo(cx + hw * 0.9, cy + h / 2 - 10);
      ctx.lineTo(cx + hw * 0.55, cy + h / 2);
      ctx.lineTo(cx - hw * 0.55, cy + h / 2);
      ctx.lineTo(cx - hw * 0.9, cy + h / 2 - 10);
      ctx.lineTo(cx - hw, cy - h * 0.05);
      ctx.lineTo(cx - hw * 0.45, cy - h / 2 + 12);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(cx - 4, cy - h / 2 + 8, 8, h - 20);

      roundRect(ctx, cx - w * 0.26, cy - h * 0.12, w * 0.52, h * 0.26, 5);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();

      drawWheels(cx, cy, w, h, 6, 13, 16, 24);
      ctx.restore();

      if (driverEmoji) {
        emoji(driverEmoji, cx, cy - h * 0.1, Math.min(24, w * 0.55));
      }
    }

    // Boxy cab-plus-cargo shape echoing the 🚚 from the vehicle picker.
    function drawTruckTopDown(cx, cy, color, driverEmoji, w, h) {
      ctx.save();
      const cabH = h * 0.34;

      roundRect(ctx, cx - w / 2, cy - h / 2 + cabH - 4, w, h - cabH + 4, 6);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let i = 1; i <= 2; i++) {
        const ly = cy - h / 2 + cabH + ((h - cabH) * i) / 3;
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.beginPath();
        ctx.moveTo(cx - w / 2 + 4, ly);
        ctx.lineTo(cx + w / 2 - 4, ly);
        ctx.stroke();
      }

      roundRect(ctx, cx - w / 2, cy - h / 2, w, cabH, 8);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.stroke();

      roundRect(ctx, cx - w * 0.32, cy - h / 2 + 5, w * 0.64, cabH - 10, 4);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();

      drawWheels(cx, cy, w, h, 7, 16, cabH + 4, 20);
      ctx.restore();

      if (driverEmoji) {
        emoji(driverEmoji, cx, cy - h / 2 + cabH / 2, Math.min(22, w * 0.5));
      }
    }

    // Hue-rotate alone inherits the sprite's own (fairly muted, and fairly
    // dark since the base art is a dark blue) saturation and brightness, so
    // some colors come out duller/darker than their swatch — yellow needs
    // the biggest boost since it's naturally a much brighter hue than the
    // sprite's dark-blue base, otherwise it reads as brown.
    const PLAYER_CAR_EXTRA_FILTER = {
      "#f3922b": "saturate(1.6) brightness(1.2)", // orange
      "#ffd166": "saturate(1.6) brightness(2.5)", // yellow
      "#ff5fa2": "saturate(1.3) brightness(1.1)", // pink
    };

    // Same idea for the NPC sprite — its red base is brighter than the
    // player sprite's blue, so it needs smaller (but still real) boosts.
    // The player truck sprite shares this same red base, so it shares
    // these values too.
    const NPC_CAR_EXTRA_FILTER = {
      "#f3922b": "saturate(1.4) brightness(1.4)", // orange
      "#ffd166": "saturate(1.5) brightness(1.8)", // yellow
    };
    const PLAYER_TRUCK_EXTRA_FILTER = NPC_CAR_EXTRA_FILTER;

    // The truck sprite (32x64 source) is cab + front wheel-well (rows 0-21),
    // a plain flatbed section with no cross-details (rows 22-52), and a rear
    // wheel-well/tailgate (rows 53-63). Stretching just the plain middle
    // slice lengthens the cargo bed without distorting the cab or wheels.
    const TRUCK_SLICE_ROWS = { top: 22, mid: 31, bottom: 11 };
    const TRUCK_BED_EXTRA_FRACTION = 0.22; // how much longer the bed gets, as a fraction of the base height

    function drawTruckSprite(sprite, cx, cy, w, h) {
      const { top, mid, bottom } = TRUCK_SLICE_ROWS;
      const srcW = sprite.width;
      const scale = h / (top + mid + bottom);
      const topH = top * scale;
      const bottomH = bottom * scale;
      const midH = mid * scale + h * TRUCK_BED_EXTRA_FRACTION;
      const totalH = topH + midH + bottomH;

      const dx = cx - w / 2;
      let dy = cy - totalH / 2;
      ctx.drawImage(sprite, 0, 0, srcW, top, dx, dy, w, topH);
      dy += topH;
      ctx.drawImage(sprite, 0, top, srcW, mid, dx, dy, w, midH);
      dy += midH;
      ctx.drawImage(sprite, 0, top + mid, srcW, bottom, dx, dy, w, bottomH);
    }

    function drawPlayerVehicle(cx, cy, color, driverEmoji, w, h, vehicleId) {
      const isTruck = vehicleId === "truck";
      const image = isTruck ? PLAYER_TRUCK_IMAGE : PLAYER_CAR_IMAGE;
      const baseHue = isTruck ? PLAYER_TRUCK_BASE_HUE : PLAYER_CAR_BASE_HUE;
      const extraFilter = isTruck ? PLAYER_TRUCK_EXTRA_FILTER : PLAYER_CAR_EXTRA_FILTER;

      const sprite = getRecoloredSprite(image, color, baseHue, extraFilter);
      if (sprite) {
        if (isTruck) {
          drawTruckSprite(sprite, cx, cy, w, h);
        } else {
          ctx.drawImage(sprite, cx - w / 2, cy - h / 2, w, h);
        }
      } else if (isTruck) {
        drawTruckTopDown(cx, cy, color, driverEmoji, w, h);
      } else {
        drawSportsCarTopDown(cx, cy, color, driverEmoji, w, h);
      }
    }

    function drawGameplay() {
      if (!grassPattern && GRASS_IMAGE.complete && GRASS_IMAGE.naturalWidth > 0) {
        grassPattern = ctx.createPattern(GRASS_IMAGE, "repeat");
      }
      // Only paint the grass verges, not the road strip between them — it
      // gets immediately covered by the fillRect below, so painting it first
      // was pure wasted pattern-fill work (half the canvas width, every frame).
      ctx.fillStyle = grassPattern || "#6cb84a";
      ctx.fillRect(0, 0, ROAD_LEFT, H);
      ctx.fillRect(ROAD_RIGHT, 0, W - ROAD_RIGHT, H);
      ctx.fillStyle = "#8d8f92";
      ctx.fillRect(ROAD_LEFT, 0, ROAD_RIGHT - ROAD_LEFT, H);
      ctx.strokeStyle = "#f6dcac";
      ctx.setLineDash([26, 20]);
      ctx.lineDashOffset = -roadScroll;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo((ROAD_LEFT + ROAD_RIGHT) / 2, 0);
      ctx.lineTo((ROAD_LEFT + ROAD_RIGHT) / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      roadside.forEach((t) => {
        const baseX = t.side === "left" ? ROAD_LEFT - 50 : ROAD_RIGHT + 50;
        emoji(t.emoji, baseX + t.xJitter, t.y, t.size);
      });

      objects.forEach((o) => {
        if (o.type === "car") {
          drawTopDownCar(o.x, o.y, o.color, null, o.w, o.h);
        } else {
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
          ctx.fillStyle = "#ffd166";
          ctx.fill();
          ctx.strokeStyle = "#05182e";
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = "#05182e";
          ctx.font = "bold 22px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(o.value), o.x, o.y + 1);
        }
      });

      const flashHidden = crashTimer > 0 && Math.floor(crashTimer / 6) % 2 === 0;
      if (!flashHidden) {
        drawPlayerVehicle(player.x, player.y, selection.color.hex, selection.animal.emoji, player.w, player.h, selection.vehicle.id);
      }

      // HUD: progress dots
      const dotR = 10;
      const total = 10;
      const dotsW = total * (dotR * 2 + 6) - 6;
      const startX = W / 2 - dotsW / 2;
      for (let n = 1; n <= total; n++) {
        const x = startX + (n - 1) * (dotR * 2 + 6) + dotR;
        ctx.beginPath();
        ctx.arc(x, 24, dotR, 0, Math.PI * 2);
        ctx.fillStyle = n < nextNumber ? "#43aa8b" : n === nextNumber ? "#ffd166" : "rgba(255,255,255,0.35)";
        ctx.fill();
        ctx.fillStyle = "#05182e";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n), x, 25);
      }

      if (popText) {
        ctx.globalAlpha = Math.min(1, popText.life / 20);
        ctx.fillStyle = "#ffd166";
        ctx.font = "bold 40px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(popText.text, player.x, player.y - 60);
        ctx.globalAlpha = 1;
      }
    }

    function drawWinScreen() {
      drawSkyScene();
      ctx.fillStyle = "rgba(5,24,46,0.35)";
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = "center";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#05182e";
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 56px 'Comic Sans MS', sans-serif";
      ctx.strokeText("YOU WIN!", W / 2, 140);
      ctx.fillText("YOU WIN!", W / 2, 140);

      emoji(selection.animal.emoji, W / 2 - 60, 220, 60);
      {
        const isTruck = selection.vehicle.id === "truck";
        const baseW = isTruck ? 50 : 40;
        const baseH = isTruck ? 76 : 68;
        const previewH = 80;
        const previewW = previewH * (baseW / baseH);
        drawPlayerVehicle(W / 2 + 55, 222, selection.color.hex, null, previewW, previewH, selection.vehicle.id);
      }

      button(W / 2 - 100, 280, 200, 56, () => {
        state = "start";
        sound.startCruiseMusic();
      }, "#e63946");
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("PLAY AGAIN", W / 2, 308);
    }

    function draw() {
      clickTargets = [];
      switch (state) {
        case "start":
          drawStartScreen();
          break;
        case "chooseAnimal":
          drawAnimalScreen();
          break;
        case "chooseVehicle":
          drawVehicleScreen();
          break;
        case "chooseColor":
          drawColorScreen();
          break;
        case "playing":
          drawGameplay();
          break;
        case "won":
          drawWinScreen();
          break;
      }
    }

    const keys = {};
    function onKeyDown(e) {
      if (["ArrowLeft", "ArrowRight", " ", "a", "d", "A", "D"].includes(e.key)) {
        e.preventDefault();
      }
      keys[e.key] = true;
      if (e.key === " " && state === "playing") sound.honk(selection.vehicle.id === "truck");
    }
    function onKeyUp(e) {
      keys[e.key] = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

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

    // Movement speeds, spawn timers, and the crash duration are all tuned
    // as "amount per 1/60th of a second". requestAnimationFrame fires at
    // the display's refresh rate though, which is 120/144/240Hz on a lot
    // of gaming monitors — calling update() once per callback with those
    // fixed amounts would run the whole game (steering, traffic, spawn
    // rate, everything) proportionally faster on those screens than on a
    // standard 60Hz one. dt below is "how many 1/60s frames' worth of
    // real time actually passed since the last callback" (1.0 at 60Hz,
    // ~0.25 at 240Hz), and every per-frame amount in update() is scaled by
    // it — so update()/draw() still run once per callback (smooth at any
    // refresh rate) while covering the correct amount of game-time either
    // way, instead of the choppier alternative of only running update()
    // on some callbacks to hold a fixed simulation rate.
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
    resetGameplay();
    sound.startCruiseMusic();
    rafId = requestAnimationFrame(loop);

    return {
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        sound.stopMusic();
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("click", onClick);
        canvas.removeEventListener("mousemove", onMouseMove);
        canvas.style.cursor = "default";
      },
    };
  }

  window.STEGO_GAMES = window.STEGO_GAMES || {};
  window.STEGO_GAMES.coolCars = {
    title: "Cool Cars",
    start: startCoolCars,
    controlsHint: "Click to choose · Arrow keys (or A/D) to steer · Space to honk",
  };
})();
