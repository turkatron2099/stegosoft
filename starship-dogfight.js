// A pair of small vector starships that wander into a loose dogfight behind
// the hero logo, starting 10s after the page loads (a "sit and watch" easter
// egg, in the same spirit as hero-logo.js's click-triggered ones). They
// periodically peel off past the section's edges and reappear elsewhere a
// few seconds later, so the fight never feels boxed in.
(function () {
  const hero = document.querySelector(".hero");
  if (!hero) return;

  const canvas = document.createElement("canvas");
  canvas.className = "dogfight-canvas";
  hero.insertBefore(canvas, hero.firstChild);
  // `ctx` is reassignable (not const): drawAnaglyphFrame() briefly points it
  // at an offscreen buffer so the existing drawStars/drawShip/etc functions
  // — which all close over this variable rather than taking a ctx param —
  // can render into that buffer unchanged, then restores it to mainCtx.
  let ctx = canvas.getContext("2d");
  const mainCtx = ctx;

  // Offscreen buffers for the anaglyph 3D render path (see drawAnaglyphFrame).
  const sceneCanvas = document.createElement("canvas");
  const sceneCtx = sceneCanvas.getContext("2d");
  const eyeCanvas = document.createElement("canvas");
  const eyeCtx = eyeCanvas.getContext("2d");

  let W = 0, H = 0;

  function resize() {
    const rect = hero.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    [sceneCanvas, eyeCanvas].forEach((c) => {
      c.width = canvas.width;
      c.height = canvas.height;
    });
    sceneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    eyeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // Small starfield behind the dogfight — same cream as the "Home" link and
  // the logo's border (var(--foreground) in style.css).
  const STAR_COLOR = "#f6dcac";
  let stars = [];
  function makeStars() {
    const count = Math.round((W * H) / 6000);
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({ x: rand(0, W), y: rand(0, H), r: rand(0.6, 1.6), phase: rand(0, Math.PI * 2) });
    }
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // Matrix-mode: once the konami easter egg (matrix-mode.js) has been
  // triggered, this replaces the starfield/dogfight scene with digital rain,
  // both immediately (via the event) and on every future page load (via the
  // shared localStorage flag).
  const MATRIX_STORAGE_KEY = "stegosoft-matrix-mode";
  const MATRIX_CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789";
  const MATRIX_FONT_SIZE = 16;
  let matrixMode = localStorage.getItem(MATRIX_STORAGE_KEY) === "1";
  let matrixDrops = [];

  function setupMatrixRain() {
    const cols = Math.ceil(W / MATRIX_FONT_SIZE);
    matrixDrops = new Array(cols).fill(0).map(() => rand(0, H / MATRIX_FONT_SIZE));
  }

  function drawMatrixRain(dtScale) {
    ctx.fillStyle = "rgba(3, 18, 34, 0.15)";
    ctx.fillRect(0, 0, W, H);
    ctx.font = MATRIX_FONT_SIZE + "px monospace";
    for (let i = 0; i < matrixDrops.length; i++) {
      const x = i * MATRIX_FONT_SIZE;
      const y = matrixDrops[i] * MATRIX_FONT_SIZE;
      ctx.fillStyle = Math.random() < 0.05 ? "#d6ffe0" : "#2fe86a";
      ctx.fillText(MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)], x, y);
      if (y > H && Math.random() > 0.975) {
        matrixDrops[i] = 0;
      } else {
        matrixDrops[i] += 0.4 * dtScale;
      }
    }
  }

  // Anaglyph mode: set by hero-logo.js once the logo settles into its
  // red/cyan skin at 300 clicks (same flag/event pattern as matrix mode
  // above, just triggered from that other script instead of this one).
  // Unlike matrix mode this doesn't replace the scene, just how it's
  // rendered — see drawAnaglyphFrame.
  const ANAGLYPH_MODE_KEY = "stegosoft-anaglyph-mode";
  let anaglyphMode = localStorage.getItem(ANAGLYPH_MODE_KEY) === "1";

  window.addEventListener("stegosoft:anaglyph-mode-on", () => {
    anaglyphMode = true;
  });
  window.addEventListener("stegosoft:anaglyph-mode-off", () => {
    anaglyphMode = false;
  });

  // Virtual Boy: set by hero-logo.js once the logo re-skins again at 400
  // clicks, superseding the anaglyph mode above (hero-logo.js turns
  // anaglyphMode off before turning this on, so the two never overlap).
  const VIRTUALBOY_MODE_KEY = "stegosoft-virtualboy-mode";
  let virtualBoyMode = localStorage.getItem(VIRTUALBOY_MODE_KEY) === "1";

  window.addEventListener("stegosoft:virtualboy-mode-on", () => {
    virtualBoyMode = true;
  });
  window.addEventListener("stegosoft:virtualboy-mode-off", () => {
    virtualBoyMode = false;
  });

  window.addEventListener("resize", () => {
    resize();
    makeStars();
    if (matrixMode) setupMatrixRain();
  });
  resize();
  makeStars();
  if (matrixMode) setupMatrixRain();

  const MARGIN = 70; // how far past the edge a ship flies before going "away"
  const SPEED = 1.7; // px per 60fps-equivalent frame cruising speed (scaled by dtScale)
  const TURN_RATE = 0.05; // max radians per 60fps-equivalent frame (scaled by dtScale)
  const NOSE_LENGTH = 14; // matches the hull's front vertex in drawShip's local coords
  const FIRING_CONE = Math.PI / 3; // only fire when the target is within this many radians of dead-ahead

  function newTarget(ship, other) {
    if (Math.random() < 0.7) {
      // Chase the other ship — with enough spread that it reads as a dogfight
      // weave rather than a straight-line tail.
      ship.targetX = other.x + rand(-140, 140);
      ship.targetY = other.y + rand(-100, 100);
    } else {
      ship.targetX = rand(40, W - 40);
      ship.targetY = rand(40, H - 40);
    }
    ship.retargetAt = performance.now() + rand(900, 2200);
  }

  function sendAway(ship) {
    // Aim just past whichever edge is closest to the current heading so the
    // exit looks like a continuation of the turn, not a snap.
    const dirX = Math.cos(ship.angle);
    const dirY = Math.sin(ship.angle);
    const exitX = dirX >= 0 ? W + MARGIN : -MARGIN;
    const exitY = dirY >= 0 ? H + MARGIN : -MARGIN;
    // Pick whichever axis the ship is more aimed at.
    if (Math.abs(dirX) > Math.abs(dirY)) {
      ship.targetX = exitX;
      ship.targetY = ship.y + dirY * 300;
    } else {
      ship.targetX = ship.x + dirX * 300;
      ship.targetY = exitY;
    }
    ship.state = "leaving";
  }

  function reenter(ship) {
    const edge = Math.floor(rand(0, 4));
    if (edge === 0) { ship.x = -MARGIN; ship.y = rand(0, H); }
    else if (edge === 1) { ship.x = W + MARGIN; ship.y = rand(0, H); }
    else if (edge === 2) { ship.x = rand(0, W); ship.y = -MARGIN; }
    else { ship.x = rand(0, W); ship.y = H + MARGIN; }
    ship.angle = Math.atan2(H / 2 - ship.y, W / 2 - ship.x);
    ship.state = "active";
    ship.retargetAt = 0; // pick a real target next tick
  }

  function makeShip(color) {
    return {
      color,
      state: "away",
      x: W / 2, y: H / 2,
      angle: rand(0, Math.PI * 2),
      targetX: W / 2, targetY: H / 2,
      retargetAt: 0,
      awayUntil: performance.now() + rand(300, 2500),
      flame: 0,
    };
  }

  // Same dark navy as the .about/.dark-background section behind the quote
  // (var(--dark-background) in style.css).
  const SHIP_COLOR = "#031222";
  const ships = [makeShip(SHIP_COLOR), makeShip(SHIP_COLOR)];
  const bolts = [];

  function angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function stepShip(ship, other, now, dtScale) {
    if (ship.state === "away") {
      if (now >= ship.awayUntil) reenter(ship);
      return;
    }

    if (ship.state === "active" && now >= ship.retargetAt) {
      newTarget(ship, other);
      // Rarely, break off and leave the scene instead of picking a new target.
      if (Math.random() < 0.12) sendAway(ship);
    }

    const desired = Math.atan2(ship.targetY - ship.y, ship.targetX - ship.x);
    const turn = TURN_RATE * dtScale;
    ship.angle += Math.max(-turn, Math.min(turn, angleDiff(ship.angle, desired)));
    ship.x += Math.cos(ship.angle) * SPEED * dtScale;
    ship.y += Math.sin(ship.angle) * SPEED * dtScale;
    ship.flame = 0.6 + Math.random() * 0.4;

    if (ship.state === "leaving" && (ship.x < -MARGIN || ship.x > W + MARGIN || ship.y < -MARGIN || ship.y > H + MARGIN)) {
      ship.state = "away";
      ship.awayUntil = now + rand(2500, 7000);
    }

    // Occasional blaster bolt at the other ship while both are on-screen and
    // reasonably close — a light flourish, not a real hit-detection system.
    // The 0.01 chance is per 60fps-equivalent frame, so scale it by dtScale
    // to keep the average bolt rate constant regardless of refresh rate.
    if (ship.state === "active" && other.state === "active" && Math.random() < 0.01 * dtScale) {
      const dx = other.x - ship.x, dy = other.y - ship.y;
      // Only fire when the other ship is roughly ahead — without this, a
      // bolt could launch toward a target off to the side or behind (e.g.
      // right after retargeting, before the ship has turned to face it),
      // which reads as firing out of the side no matter where on the hull
      // it starts.
      const facingOff = Math.abs(angleDiff(ship.angle, Math.atan2(dy, dx)));
      if (dx * dx + dy * dy < 300 * 300 && facingOff < FIRING_CONE) {
        // Fire from the hull's nose tip, not the ship's center point — the
        // center sits mid-hull on this delta-wing shape, so a bolt starting
        // there could otherwise read as coming out of the side/wing.
        const noseX = ship.x + Math.cos(ship.angle) * NOSE_LENGTH;
        const noseY = ship.y + Math.sin(ship.angle) * NOSE_LENGTH;
        // Bright accent color, not the ship's dark hull fill — a hull-colored
        // bolt is nearly invisible against the dark background.
        bolts.push({ x1: noseX, y1: noseY, x2: other.x, y2: other.y, life: 1, color: STAR_COLOR });
      }
    }
  }

  function drawShip(ship) {
    if (ship.state === "away") return;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);

    // Engine flame first, so the hull overlaps its base.
    const flameLen = 6 + ship.flame * 5;
    ctx.beginPath();
    ctx.moveTo(-8, 3);
    ctx.lineTo(-8 - flameLen, 0);
    ctx.lineTo(-8, -3);
    ctx.closePath();
    ctx.fillStyle = "rgba(250, 209, 102, " + (0.5 + ship.flame * 0.4) + ")";
    ctx.fill();

    // Hull — a swept-wing delta with a notched tail.
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, 6);
    ctx.lineTo(-4, 3);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-4, -3);
    ctx.lineTo(-8, -6);
    ctx.closePath();
    ctx.fillStyle = ship.color;
    ctx.fill();
    ctx.strokeStyle = STAR_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(4, 0, 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(246, 220, 172, 0.9)";
    ctx.fill();

    ctx.restore();
  }

  function drawBolts(dtScale) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.life -= 0.06 * dtScale;
      if (b.life <= 0) { bolts.splice(i, 1); continue; }
      const t = 1 - b.life;
      const x = b.x1 + (b.x2 - b.x1) * Math.min(1, t * 2.5);
      const y = b.y1 + (b.y2 - b.y1) * Math.min(1, t * 2.5);
      ctx.beginPath();
      ctx.moveTo(b.x1 + (x - b.x1) * 0.7, b.y1 + (y - b.y1) * 0.7);
      ctx.lineTo(x, y);
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = b.life;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawStars(now) {
    stars.forEach((s) => {
      const twinkle = 0.5 + Math.sin(now * 0.001 + s.phase) * 0.35;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = STAR_COLOR;
      ctx.globalAlpha = twinkle;
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  // A shooting star that streaks across every so often — a comet-trail line
  // (gradient to transparent) with a bright head, not a persisted trail.
  let meteor = null;
  let nextMeteorAt = performance.now() + rand(4000, 9000);

  function maybeSpawnMeteor(now) {
    if (meteor || now < nextMeteorAt) return;
    const speed = rand(9, 14);
    let x, y, angle;
    if (Math.random() < 0.6) {
      x = rand(0, W);
      y = -20;
      const goingRight = Math.random() < 0.5;
      const drop = rand(Math.PI * 0.15, Math.PI * 0.35);
      angle = goingRight ? drop : Math.PI - drop;
    } else {
      const fromLeft = Math.random() < 0.5;
      x = fromLeft ? -20 : W + 20;
      y = rand(0, H * 0.6);
      const drop = rand(Math.PI * 0.05, Math.PI * 0.25);
      angle = fromLeft ? drop : Math.PI - drop;
    }
    meteor = { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }

  function stepMeteor(now, dtScale) {
    if (!meteor) return;
    meteor.x += meteor.vx * dtScale;
    meteor.y += meteor.vy * dtScale;
    if (meteor.x < -50 || meteor.x > W + 50 || meteor.y < -50 || meteor.y > H + 50) {
      meteor = null;
      nextMeteorAt = now + rand(6000, 14000);
    }
  }

  function drawMeteor() {
    if (!meteor) return;
    const tailLen = 46;
    const angle = Math.atan2(meteor.vy, meteor.vx);
    const tailX = meteor.x - Math.cos(angle) * tailLen;
    const tailY = meteor.y - Math.sin(angle) * tailLen;
    const grad = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
    grad.addColorStop(0, "rgba(246, 220, 172, 0.95)");
    grad.addColorStop(1, "rgba(246, 220, 172, 0)");
    ctx.beginPath();
    ctx.moveTo(meteor.x, meteor.y);
    ctx.lineTo(tailX, tailY);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(meteor.x, meteor.y, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(246, 220, 172, 0.95)";
    ctx.fill();
  }

  // --- Anaglyph 3D render path ---
  // Renders the normal scene once (full color, into sceneCanvas), then
  // composites two horizontally-offset copies onto the visible canvas — one
  // recolored solid red, one solid cyan — the same red/cyan split a pair of
  // 3D glasses separates. eyeLayer() builds each copy by filling eyeCanvas
  // with the flat eye color, then "destination-in" clips that fill down to
  // wherever the (offset) scene has coverage, inheriting the scene's own
  // per-pixel alpha (so star twinkle and bolt fade still work). The two eye
  // layers are then drawn onto the main canvas with "lighter" (additive)
  // blending, which is what actually produces the characteristic red/cyan
  // fringing where the two don't quite overlap.
  const ANAGLYPH_OFFSET = 5; // px of horizontal separation between the two eye images

  function eyeLayer(color, offsetX) {
    eyeCtx.clearRect(0, 0, W, H);
    eyeCtx.globalCompositeOperation = "source-over";
    eyeCtx.fillStyle = color;
    eyeCtx.fillRect(0, 0, W, H);
    eyeCtx.globalCompositeOperation = "destination-in";
    eyeCtx.drawImage(sceneCanvas, offsetX, 0, W, H);
    eyeCtx.globalCompositeOperation = "source-over";
  }

  function drawAnaglyphFrame(now, dtScale) {
    maybeSpawnMeteor(now);
    stepMeteor(now, dtScale);
    stepShip(ships[0], ships[1], now, dtScale);
    stepShip(ships[1], ships[0], now, dtScale);

    // Render the full-color scene once into the offscreen buffer, using the
    // normal draw functions unchanged — they just need `ctx` pointed here.
    ctx = sceneCtx;
    ctx.clearRect(0, 0, W, H);
    drawStars(now);
    drawMeteor();
    drawBolts(dtScale);
    ships.forEach(drawShip);
    ctx = mainCtx;

    ctx.clearRect(0, 0, W, H);
    eyeLayer("rgb(255, 0, 0)", -ANAGLYPH_OFFSET);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(eyeCanvas, 0, 0, W, H);
    eyeLayer("rgb(0, 255, 255)", ANAGLYPH_OFFSET);
    ctx.drawImage(eyeCanvas, 0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  // --- Virtual Boy render path ---
  // Same full-color scene render into sceneCanvas as the anaglyph path
  // above, but composited down to Nintendo's actual Virtual Boy palette —
  // one flat red, no offset pair, no other hue — over a solid black
  // backdrop instead of anaglyph's transparency. Reuses eyeLayer() with no
  // horizontal offset, since there's no second eye to separate from.
  const VIRTUALBOY_RED = "#ff2400"; // matches hero-logo.js's Virtual Boy skin

  function drawVirtualBoyFrame(now, dtScale) {
    maybeSpawnMeteor(now);
    stepMeteor(now, dtScale);
    stepShip(ships[0], ships[1], now, dtScale);
    stepShip(ships[1], ships[0], now, dtScale);

    ctx = sceneCtx;
    ctx.clearRect(0, 0, W, H);
    drawStars(now);
    drawMeteor();
    drawBolts(dtScale);
    ships.forEach(drawShip);
    ctx = mainCtx;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
    eyeLayer(VIRTUALBOY_RED, 0);
    ctx.drawImage(eyeCanvas, 0, 0, W, H);
  }

  let running = false;
  let rafId = null;
  let lastTime = null;
  const REFERENCE_FRAME_MS = 1000 / 60; // all per-frame speeds above are tuned for 60fps
  const MAX_DT_MS = 50; // clamp so a stall/tab-switch hiccup doesn't teleport anything

  function frame() {
    if (!running) return;
    const now = performance.now();
    const dt = lastTime === null ? REFERENCE_FRAME_MS : Math.min(now - lastTime, MAX_DT_MS);
    lastTime = now;
    const dtScale = dt / REFERENCE_FRAME_MS; // >1 on slower displays, <1 on faster ones (e.g. 240Hz)

    if (matrixMode) {
      drawMatrixRain(dtScale);
    } else if (virtualBoyMode) {
      drawVirtualBoyFrame(now, dtScale);
    } else if (anaglyphMode) {
      drawAnaglyphFrame(now, dtScale);
    } else {
      ctx.clearRect(0, 0, W, H);
      drawStars(now);
      maybeSpawnMeteor(now);
      stepMeteor(now, dtScale);
      drawMeteor();
      stepShip(ships[0], ships[1], now, dtScale);
      stepShip(ships[1], ships[0], now, dtScale);
      drawBolts(dtScale);
      ships.forEach(drawShip);
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = null; // avoid a large dt from time spent stopped
    frame();
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  let hasSat = matrixMode; // matrix rain shows immediately; the dogfight still waits its 10s

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (hasSat) start();
  });

  window.addEventListener("stegosoft:matrix-mode-on", () => {
    if (matrixMode) return;
    matrixMode = true;
    setupMatrixRain();
    hasSat = true;
    start();
  });

  // Same "r" reset key as hero-logo.js's click-counter reset — pressing it
  // also clears the matrix takeover back to the starfield/dogfight scene.
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "r" || !matrixMode) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }
    matrixMode = false;
    localStorage.removeItem(MATRIX_STORAGE_KEY);
  });

  if (matrixMode) {
    start();
  } else {
    setTimeout(() => {
      hasSat = true;
      if (!document.hidden) start();
    }, 10000);
  }
})();
