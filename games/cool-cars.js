(function () {
  const ANIMALS = [
    { id: "dog", emoji: "🐶", label: "Dog" },
    { id: "cat", emoji: "🐱", label: "Cat" },
    { id: "horse", emoji: "🐴", label: "Horse" },
    { id: "pig", emoji: "🐷", label: "Pig" },
    { id: "elephant", emoji: "🐘", label: "Elephant" },
    { id: "tiger", emoji: "🐯", label: "Tiger" },
    { id: "monkey", emoji: "🐵", label: "Monkey" },
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

  const ROAD_LEFT = 180;
  const ROAD_RIGHT = 540;
  const SCROLL_SPEED = 4;
  const STEER_SPEED = 5;
  const CRASH_FRAMES = 72;

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

    // A short, cheerful, entirely original 8-step riff (C major) — composed
    // here in code, so there's no licensing question about where it's from.
    const MELODY = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 392.0, 440.0];
    const STEP_SECONDS = 0.19;

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

    function scheduleMusicStep() {
      if (!musicPlaying) return;
      const c = ensureCtx();
      tone(MELODY[musicStep % MELODY.length], STEP_SECONDS * 0.8, c.currentTime, "square", 0.05);
      musicStep++;
      musicTimer = setTimeout(scheduleMusicStep, STEP_SECONDS * 1000);
    }

    return {
      startMusic() {
        if (musicPlaying) return;
        musicPlaying = true;
        scheduleMusicStep();
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
    };
  }

  function startCoolCars(canvas) {
    const ctx = canvas.getContext("2d");
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

    let player, objects, nextNumber, crashTimer, spawnTimer, numberCooldown, trees, popText;

    function resetGameplay() {
      player = { x: (ROAD_LEFT + ROAD_RIGHT) / 2, y: H - 96, w: 44, h: 70 };
      objects = [];
      nextNumber = 1;
      crashTimer = 0;
      spawnTimer = 80;
      numberCooldown = 120;
      popText = null;
      trees = Array.from({ length: 6 }, (_, i) => ({
        side: i % 2 === 0 ? "left" : "right",
        y: (i * H) / 3,
      }));
    }

    function spawnObstacle() {
      const w = 44;
      const x = rand(ROAD_LEFT + w, ROAD_RIGHT - w);
      const color = COLORS[randInt(0, COLORS.length - 1)];
      objects.push({ type: "car", x, y: -60, w: 44, h: 70, color: color.hex });
    }

    function spawnNumber() {
      const x = rand(ROAD_LEFT + 30, ROAD_RIGHT - 30);
      objects.push({ type: "number", x, y: -40, r: 20, value: nextNumber });
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

      trees.forEach((t) => {
        t.y += SCROLL_SPEED;
        if (t.y > H + 40) t.y -= H + 80;
      });

      spawnTimer--;
      if (spawnTimer <= 0) {
        spawnObstacle();
        spawnTimer = randInt(75, 140);
      }
      numberCooldown--;
      if (numberCooldown <= 0 && !objects.some((o) => o.type === "number")) {
        spawnNumber();
        numberCooldown = randInt(260, 380);
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
            nextNumber++;
            if (nextNumber > 10) state = "won";
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
        const x = startX + col * cellW + (row === 1 ? cellW * 1.5 : 0) - (row === 1 ? cellW / 2 : 0);
        const y = startY + row * cellH;
        button(x + 10, y, cellW - 20, cellH - 16, () => {
          selection.animal = a;
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
          },
        });
        const isHover = hoverPoint && hoverPoint.x >= x && hoverPoint.x <= x + size && hoverPoint.y >= y && hoverPoint.y <= y + size;
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, isHover ? size / 2 - 2 : size / 2 - 6, 0, Math.PI * 2);
        ctx.fillStyle = c.hex;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#f6dcac";
        ctx.stroke();
        ctx.fillStyle = "#f6dcac";
        ctx.font = "15px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(c.label, x + size / 2, y + size + 18);
      });
    }

    function drawTopDownCar(cx, cy, color, driverEmoji, w, h) {
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

      emoji(driverEmoji, cx, cy - h * 0.18, Math.min(26, w * 0.6));
    }

    function drawGameplay() {
      ctx.fillStyle = "#6cb84a";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#8d8f92";
      ctx.fillRect(ROAD_LEFT, 0, ROAD_RIGHT - ROAD_LEFT, H);
      ctx.strokeStyle = "#f6dcac";
      ctx.setLineDash([26, 20]);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo((ROAD_LEFT + ROAD_RIGHT) / 2, 0);
      ctx.lineTo((ROAD_LEFT + ROAD_RIGHT) / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);

      trees.forEach((t) => {
        const x = t.side === "left" ? ROAD_LEFT - 50 : ROAD_RIGHT + 50;
        emoji("🌴", x, t.y, 40);
      });

      objects.forEach((o) => {
        if (o.type === "car") {
          drawTopDownCar(o.x, o.y, o.color, "🚗", o.w, o.h);
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
        drawTopDownCar(player.x, player.y, selection.color.hex, selection.animal.emoji, player.w, player.h);
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

      emoji(selection.animal.emoji, W / 2 - 50, 220, 60);
      emoji(selection.vehicle.emoji, W / 2 + 50, 220, 60);

      button(W / 2 - 100, H - 100, 200, 56, () => {
        state = "start";
      }, "#e63946");
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("PLAY AGAIN", W / 2, H - 72);
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
    sound.startMusic();
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
