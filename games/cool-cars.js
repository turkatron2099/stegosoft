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
    { id: "sports", emoji: "🏎️", label: "Sports Car" },
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

  // Roadside decorations scrolling past during gameplay: mostly palm trees,
  // with the occasional bird. ROADSIDE_MIN_GAP is the minimum vertical
  // clearance kept between any two items on the same side, checked at spawn
  // time — since every item moves at the identical SCROLL_SPEED afterward,
  // a safe gap at spawn stays safe forever (same trick used for cars/numbers).
  const ROADSIDE_MIN_GAP = 70;

  const ROAD_LEFT = 180;
  const ROAD_RIGHT = 540;
  const SCROLL_SPEED = 4;
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

    function startLoop(melody, stepSeconds, wave, sustain) {
      if (musicTimer) clearTimeout(musicTimer);
      currentMelody = melody;
      currentStepSeconds = stepSeconds;
      currentWave = wave;
      currentSustain = sustain;
      musicStep = 0;
      musicPlaying = true;
      scheduleMusicStep();
    }

    return {
      startCruiseMusic() {
        startLoop(CRUISE_MELODY, CRUISE_STEP_SECONDS, "triangle", 0.95);
      },
      startMusic() {
        startLoop(MAIN_MELODY, MAIN_STEP_SECONDS, "square", 0.8);
      },
      startVictoryMusic() {
        startLoop(VICTORY_MELODY, VICTORY_STEP_SECONDS, "square", 0.8);
      },
      stopMusic() {
        musicPlaying = false;
        if (musicTimer) clearTimeout(musicTimer);
      },
      honk() {
        const c = ensureCtx();
        const now = c.currentTime;
        tone(420, 0.14, now, "sawtooth", 0.18);
        tone(420, 0.14, now + 0.18, "sawtooth", 0.18);
      },
      coinPickup() {
        const c = ensureCtx();
        const now = c.currentTime;
        tone(988, 0.08, now, "square", 0.2);
        tone(1319, 0.18, now + 0.07, "square", 0.2);
      },
      animalSound(id) {
        const c = ensureCtx();
        const play = ANIMAL_SOUNDS[id];
        if (play) play(c.currentTime);
      },
    };
  }

  function startCoolCars(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false; // keep the pixel-art sprite crisp when scaled up
    const W = canvas.width;
    const H = canvas.height;

    let state = "start"; // start, chooseAnimal, chooseVehicle, chooseColor, playing, won
    let selection = { animal: ANIMALS[0], vehicle: VEHICLES[0], color: COLORS[0] };
    let clickTargets = [];
    let running = true;
    let rafId;
    let hoverPoint = null;
    let animFrame = 0;
    const sound = makeSound();

    let player, objects, nextNumber, crashTimer, spawnTimer, numberCooldown, roadside, roadsideTimer, birdTimer, popText, roadScroll;

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
      birdTimer = randInt(360, 600);
    }

    function spawnRoadsideItem(isBird) {
      const side = Math.random() < 0.5 ? "left" : "right";
      const y = -60;
      const blocked = roadside.some((r) => r.side === side && Math.abs(r.y - y) < ROADSIDE_MIN_GAP);
      if (blocked) return false;
      roadside.push({
        side,
        y,
        xJitter: rand(-16, 16),
        emoji: isBird ? "🐦" : "🌴",
        size: isBird ? 26 : 40,
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

    function update() {
      if (state !== "playing") return;

      if (crashTimer > 0) {
        crashTimer--;
        return;
      }

      const left = keys["ArrowLeft"] || keys["a"] || keys["A"];
      const right = keys["ArrowRight"] || keys["d"] || keys["D"];
      if (left) player.x -= STEER_SPEED;
      if (right) player.x += STEER_SPEED;
      player.x = clamp(player.x, ROAD_LEFT + player.w / 2 + 4, ROAD_RIGHT - player.w / 2 - 4);

      roadsideTimer--;
      if (roadsideTimer <= 0) {
        const spawned = spawnRoadsideItem(false);
        roadsideTimer = spawned ? randInt(45, 70) : 15;
      }
      birdTimer--;
      if (birdTimer <= 0) {
        const spawned = spawnRoadsideItem(true);
        birdTimer = spawned ? randInt(500, 900) : 30;
      }
      roadside.forEach((t) => (t.y += SCROLL_SPEED));
      roadside = roadside.filter((t) => t.y < H + 60);
      roadScroll += SCROLL_SPEED;

      spawnTimer--;
      if (spawnTimer <= 0) {
        spawnObstacle();
        spawnTimer = randInt(75, 140);
      }
      numberCooldown--;
      if (numberCooldown <= 0 && !objects.some((o) => o.type === "number")) {
        const spawned = spawnNumber();
        numberCooldown = spawned ? randInt(260, 380) : 20;
      }

      objects.forEach((o) => (o.y += SCROLL_SPEED));
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
        popText.life--;
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

    function drawSkyScene() {
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
      drawSideCar(W / 2, H * 0.87 + bounce, "#e63946", "🐶");
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
      drawSkyScene();

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
          state = "chooseColor";
        });
        emoji(v.emoji, x + w / 2, y + h / 2 - 20, 72);
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
      if (NPC_CAR_IMAGE.complete && NPC_CAR_IMAGE.naturalWidth > 0) {
        ctx.save();
        const extra = NPC_CAR_EXTRA_FILTER[color] || "";
        ctx.filter = `hue-rotate(${hexToHue(color) - NPC_CAR_BASE_HUE}deg) ${extra}`.trim();
        ctx.drawImage(NPC_CAR_IMAGE, cx - w / 2, cy - h / 2, w, h);
        ctx.restore();
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

    function drawPlayerVehicle(cx, cy, color, driverEmoji, w, h, vehicleId) {
      const isTruck = vehicleId === "truck";
      const image = isTruck ? PLAYER_TRUCK_IMAGE : PLAYER_CAR_IMAGE;
      const baseHue = isTruck ? PLAYER_TRUCK_BASE_HUE : PLAYER_CAR_BASE_HUE;
      const extraFilter = isTruck ? PLAYER_TRUCK_EXTRA_FILTER : PLAYER_CAR_EXTRA_FILTER;

      if (image.complete && image.naturalWidth > 0) {
        ctx.save();
        const extra = extraFilter[color] || "";
        ctx.filter = `hue-rotate(${hexToHue(color) - baseHue}deg) ${extra}`.trim();
        ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
        ctx.restore();
      } else if (isTruck) {
        drawTruckTopDown(cx, cy, color, driverEmoji, w, h);
      } else {
        drawSportsCarTopDown(cx, cy, color, driverEmoji, w, h);
      }
    }

    function drawGameplay() {
      ctx.fillStyle = "#6cb84a";
      ctx.fillRect(0, 0, W, H);
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
      if (e.key === " " && state === "playing") sound.honk();
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

    function loop() {
      if (!running) return;
      animFrame++;
      update();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    running = true;
    resetGameplay();
    sound.startCruiseMusic();
    loop();

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
