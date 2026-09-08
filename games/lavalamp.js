(function () {
  const BASE_COLORS = [
    { id: "red", hex: "#e63946", label: "Red" },
    { id: "yellow", hex: "#ffd166", label: "Yellow" },
    { id: "blue", hex: "#3a86ff", label: "Blue" },
  ];

  const SECONDARY_TARGETS = [
    { id: "orange", label: "Orange", pair: ["red", "yellow"] },
    { id: "green", label: "Green", pair: ["yellow", "blue"] },
    { id: "purple", label: "Purple", pair: ["red", "blue"] },
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
  function blendHex(hexA, hexB) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    return rgbToHex((a.r + b.r) / 2, (a.g + b.g) / 2, (a.b + b.b) / 2);
  }

  // Each target's swatch is the true blend of its own pair, so "the color to
  // make" always matches what mixing those two base colors actually produces
  // in the lamp — correctness below just compares the picked id pair to
  // target.pair rather than doing any float color-distance check.
  SECONDARY_TARGETS.forEach((t) => {
    const [a, b] = t.pair;
    t.hex = blendHex(colorById(a).hex, colorById(b).hex);
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
    return {
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

    let state = "start"; // start, playing
    let clickTargets = [];
    let running = true;
    let rafId;
    let hoverPoint = null;
    let animFrame = 0;
    const sound = makeSound();

    const START_LAMP_SIZE = 200;
    const START_LAMP_X = (W - START_LAMP_SIZE) / 2;
    const START_LAMP_Y = 250;

    const PLAY_LAMP_SIZE = 300;
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

    let target = null;
    let picks = []; // up to 2 base-color ids currently in the lamp
    let blobs = [];
    let mixFramesLeft = 0;
    const MIX_DELAY_FRAMES = 180; // ~3s at the 60fps-equivalent dt unit used below
    let merge = null; // { t, duration, from: [blobSnapshotA, blobSnapshotB], resultHex, correct }
    let message = null; // { text, color, framesLeft, totalFrames }
    let advanceTimeoutId = null;

    function pickRandomTarget(excludeId) {
      const options = excludeId ? SECONDARY_TARGETS.filter((t) => t.id !== excludeId) : SECONDARY_TARGETS;
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
    }

    function spawnBlob(hex, atTop) {
      const radius = 18;
      const x = bulbCX + (Math.random() - 0.5) * 8;
      const y = atTop ? bulb.top + radius + 3 : bulb.bottom - radius - 3;
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

    // Picking a color while 2 are already in the lamp (whether still
    // floating, mid-merge, or already resolved) clears the lamp first and
    // this pick becomes the new lone "first" color — same rule at every step.
    function pickColor(id) {
      if (picks.length >= 2) startNewRound(true);
      picks.push(id);
      spawnBlob(colorById(id).hex, picks.length === 1);
      sound.pick();
      if (picks.length === 2) mixFramesLeft = MIX_DELAY_FRAMES;
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

    function startMerge() {
      const [a, b] = blobs;
      const resultHex = blendHex(a.hex, b.hex);
      const sortedPicks = [...picks].sort();
      const sortedTarget = [...target.pair].sort();
      const correct = sortedPicks[0] === sortedTarget[0] && sortedPicks[1] === sortedTarget[1];
      merge = { t: 0, duration: 36, from: [{ ...a }, { ...b }], resultHex, correct };
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
      if (correct) {
        showMessage("You made " + target.label + "!", "#ffd166", 150);
        sound.celebrate();
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
      if (state !== "playing") return;
      if (merge) {
        merge.t += dt / merge.duration;
        if (merge.t >= 1) finishMerge();
      } else {
        blobs.forEach((b) => updateBlob(b, dt));
        if (picks.length === 2 && mixFramesLeft > 0) {
          mixFramesLeft -= dt;
          if (mixFramesLeft <= 0) startMerge();
        }
      }
      if (message) {
        message.framesLeft -= dt;
        if (message.framesLeft <= 0) message = null;
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
      ctx.restore();
      ctx.fillStyle = "#f6dcac";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(color.label, cx, y + size + 18);
    }

    function drawLampSprite(x, y, size) {
      if (LAMP_IMAGE.complete && LAMP_IMAGE.naturalWidth) {
        ctx.drawImage(LAMP_IMAGE, x, y, size, size);
      }
    }

    function drawBlobCircle(x, y, r, hex) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
    }

    function drawStartScreen() {
      ctx.fillStyle = "#0a2540";
      ctx.fillRect(0, 0, W, H);

      drawLampSprite(START_LAMP_X, START_LAMP_Y, START_LAMP_SIZE);

      ctx.textAlign = "center";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#05182e";
      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 64px 'Comic Sans MS', sans-serif";
      ctx.strokeText("LAVALAMP", W / 2, 90);
      ctx.fillText("LAVALAMP", W / 2, 90);

      button(
        W / 2 - 90,
        155,
        180,
        56,
        () => {
          state = "playing";
          startNewRound(false);
        },
        "#e63946"
      );
      ctx.fillStyle = "#fff";
      ctx.font = "bold 26px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("START", W / 2, 183);
    }

    function drawPlayingScreen() {
      ctx.fillStyle = "#0a2540";
      ctx.fillRect(0, 0, W, H);

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

      drawLampSprite(PLAY_LAMP_X, PLAY_LAMP_Y, PLAY_LAMP_SIZE);

      ctx.save();
      roundRect(ctx, bulb.left, bulb.top, bulb.right - bulb.left, bulb.bottom - bulb.top, 6);
      ctx.clip();
      if (merge) {
        merge.from.forEach((b) => {
          const t = merge.t;
          const x = b.x + (bulbCX - b.x) * t;
          const y = b.y + (bulbCY - b.y) * t;
          const r = b.radius * (1 - t * 0.6);
          drawBlobCircle(x, y, r, b.hex);
        });
      } else {
        blobs.forEach((b) => drawBlobCircle(b.x, b.y, b.radius, b.hex));
      }
      ctx.restore();

      if (message) {
        const bw = 360;
        const bh = 44;
        const bx = W / 2 - bw / 2;
        const by = 196;
        roundRect(ctx, bx, by, bw, bh, 12);
        ctx.fillStyle = "rgba(5,24,46,0.85)";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = message.color;
        ctx.stroke();
        ctx.fillStyle = message.color;
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(message.text, W / 2, by + bh / 2);
      }

      const btnSize = 56;
      const gap = 24;
      const totalW = BASE_COLORS.length * btnSize + (BASE_COLORS.length - 1) * gap;
      const startX = (W - totalW) / 2;
      const btnY = 402;
      BASE_COLORS.forEach((c, i) => {
        drawColorButton(startX + i * (btnSize + gap), btnY, btnSize, c);
      });
    }

    function draw() {
      clickTargets = [];
      if (state === "start") drawStartScreen();
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
    controlsHint: "Click a color to pour it into the lamp — match the color shown up top",
  };
})();
