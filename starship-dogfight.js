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
  const MATRIX_STORAGE_KEY = "thagobyte-matrix-mode";
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
  const ANAGLYPH_MODE_KEY = "thagobyte-anaglyph-mode";
  let anaglyphMode = localStorage.getItem(ANAGLYPH_MODE_KEY) === "1";

  window.addEventListener("thagobyte:anaglyph-mode-on", () => {
    anaglyphMode = true;
  });
  window.addEventListener("thagobyte:anaglyph-mode-off", () => {
    anaglyphMode = false;
  });

  // Virtual Boy: set by hero-logo.js once the logo re-skins again at 400
  // clicks, superseding the anaglyph mode above (hero-logo.js turns
  // anaglyphMode off before turning this on, so the two never overlap).
  const VIRTUALBOY_MODE_KEY = "thagobyte-virtualboy-mode";
  let virtualBoyMode = localStorage.getItem(VIRTUALBOY_MODE_KEY) === "1";

  window.addEventListener("thagobyte:virtualboy-mode-on", () => {
    virtualBoyMode = true;
  });
  window.addEventListener("thagobyte:virtualboy-mode-off", () => {
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

    if (dgMode !== "ambient") {
      dgFrame(now, dtScale);
    } else if (matrixMode) {
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

  // ============================================================
  // Playable dogfight — unlocked at 500 logo clicks. hero-logo.js dispatches
  // "thagobyte:dogfight-start" once the click count crosses that threshold,
  // and again on every click after (so clicking the logo once you've
  // unlocked it just replays the fight). Takes over this same canvas and
  // animation loop; frame() checks dgMode first and only falls through to
  // the ambient/matrix/anaglyph/virtualboy paths above when it's "ambient".
  //
  // Endless survival mode: one enemy to start, and destroying any enemy
  // spawns two more in its place — the fight only ends when the player is
  // destroyed. Score = 1 point/second survived + 25 per landed hit + 100 per
  // kill, with a streak multiplier (x1, x2, x3, ...) on the kill bonus that
  // climbs with consecutive kills and resets whenever the player is hit —
  // not on the whole run, so a player who's been hit once still builds a
  // multiplier on whatever kill streak they string together afterward.
  // ============================================================
  const DG_PLAYER_TURN_RATE = 0.07; // rad per 60fps-equivalent frame
  const DG_PLAYER_THRUST = 0.16;
  const DG_PLAYER_DRAG = 0.995; // light drag — coasts a long time, Asteroids-style
  const DG_PLAYER_MAX_SPEED = 4.4;
  const DG_ENEMY_TURN_RATE = 0.045;
  const DG_ENEMY_ACCEL = 0.12;
  const DG_ENEMY_DRAG = 0.99;
  const DG_ENEMY_MAX_SPEED = 3.0;
  const DG_PLAYER_COLOR = "#faa968"; // Thagobyte's own accent orange (same as .quote-author's color) — makes the player's ship stand out from the enemies
  const DG_ENEMY_COLOR = SHIP_COLOR; // enemies keep the ambient ships' plain hull color
  const DG_FIRE_COOLDOWN_MS = 320;
  const DG_BOLT_SPEED = 6.5;
  const DG_HIT_RADIUS = 11;
  const DG_START_FLASH_MS = 1800;
  const DG_SCORE_PER_SEC = 1; // base rate; the streak multiplier scales this directly, so a hot streak earns points faster rather than paying out in one-off bonuses
  const DG_LEADERBOARD_SIZE = 10;
  const DG_SPAWN_MARGIN = 30;
  const DG_PLAYER_HEALTH = 3;
  const DG_ENEMY_HEALTH = 1; // one shot kills
  const DG_ENEMY_SPAWN_STILL_MS = 2000; // freshly spawned enemies hold still and flash before joining the fight

  let dgMode = "ambient"; // ambient | start | playing | gameover | leaderboard
  let dgStateStartedAt = 0;
  let dgPlayer = null;
  let dgEnemies = [];
  let dgPlayerBolts = [];
  let dgEnemyBolts = [];
  let dgExplosions = [];
  let dgKeys = Object.create(null);
  let dgLastShotAt = 0;

  let dgScore = 0; // accumulates every "playing" frame at DG_SCORE_PER_SEC * (streak + 1) — no separate hit/kill bonuses
  let dgKillCount = 0;
  let dgStreak = 0; // kills since the player was last hit; drives the score-rate multiplier
  let dgFinalBreakdown = null;
  let dgInitials = "";
  let dgLeaderboard = [];

  // --- sound effects (synthesized, same Web Audio approach as hero-logo.js's
  // coin-pickup chime — no audio files) ---
  let dgAudioCtx = null;
  function dgAudio() {
    dgAudioCtx = dgAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    return dgAudioCtx;
  }
  function playLaserSound() {
    const actx = dgAudio();
    const now = actx.currentTime;
    const osc = actx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.12);
    const gain = actx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    osc.connect(gain);
    gain.connect(actx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }
  function playExplosionSound() {
    const actx = dgAudio();
    const now = actx.currentTime;
    const dur = 0.35;
    const bufferSize = Math.floor(actx.sampleRate * dur);
    const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = actx.createBufferSource();
    noise.buffer = buffer;
    const filter = actx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + dur);
    const gain = actx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(actx.destination);
    noise.start(now);
    noise.stop(now + dur);
  }

  // --- shared leaderboard storage ---
  // Backed by a public Firebase Realtime Database (rules scope open read/
  // write to just the dogfightLeaderboard path — see docs/dogfight-leaderboard
  // setup) so every visitor sees the same top 10. Each finished game POSTs a
  // new entry (Firebase assigns it a push key); reads fetch the whole
  // collection and sort client-side, since RTDB doesn't sort by value.
  // localStorage is kept only as an offline fallback — if Firebase can't be
  // reached, the game still works and at least remembers this browser's own
  // scores locally.
  const DG_FIREBASE_URL = "https://thagobyte-dogfight-default-rtdb.firebaseio.com";
  const DG_LEADERBOARD_PATH = "dogfightLeaderboard";
  const DG_LEADERBOARD_KEY = "thagobyte-dogfight-leaderboard"; // localStorage fallback cache

  function dgLocalLeaderboard() {
    try {
      const raw = localStorage.getItem(DG_LEADERBOARD_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  async function dgLoadLeaderboard() {
    try {
      const res = await fetch(`${DG_FIREBASE_URL}/${DG_LEADERBOARD_PATH}.json`);
      const data = await res.json();
      const list = data ? Object.values(data) : [];
      list.sort((a, b) => b.score - a.score);
      return list.slice(0, DG_LEADERBOARD_SIZE);
    } catch (e) {
      return dgLocalLeaderboard().slice(0, DG_LEADERBOARD_SIZE);
    }
  }

  async function dgSaveScore(initials, score) {
    const entry = { initials, score, at: Date.now() };
    try {
      await fetch(`${DG_FIREBASE_URL}/${DG_LEADERBOARD_PATH}.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch (e) {
      // couldn't reach Firebase — the local cache below still remembers it
    }
    try {
      const local = dgLocalLeaderboard();
      local.push(entry);
      local.sort((a, b) => b.score - a.score);
      localStorage.setItem(DG_LEADERBOARD_KEY, JSON.stringify(local.slice(0, DG_LEADERBOARD_SIZE)));
    } catch (e) {
      // no persistence available at all — the score still made it to Firebase above, if that succeeded
    }
    return dgLoadLeaderboard();
  }

  function dgMakeShip(health) {
    return { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2, health, invincibleUntil: 0, lastShotAt: 0, stillUntil: 0 };
  }

  // New enemies spawn stationary and flashing for DG_ENEMY_SPAWN_STILL_MS —
  // a beat of calm after a kill before they join the fight — then start
  // moving/shooting on their own. One hit is now lethal (DG_ENEMY_HEALTH).
  function dgSpawnEnemy() {
    const e = dgMakeShip(DG_ENEMY_HEALTH);
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { e.x = DG_SPAWN_MARGIN; e.y = rand(DG_SPAWN_MARGIN, H - DG_SPAWN_MARGIN); }
    else if (edge === 1) { e.x = W - DG_SPAWN_MARGIN; e.y = rand(DG_SPAWN_MARGIN, H - DG_SPAWN_MARGIN); }
    else if (edge === 2) { e.x = rand(DG_SPAWN_MARGIN, W - DG_SPAWN_MARGIN); e.y = DG_SPAWN_MARGIN; }
    else { e.x = rand(DG_SPAWN_MARGIN, W - DG_SPAWN_MARGIN); e.y = H - DG_SPAWN_MARGIN; }
    e.angle = Math.atan2(H / 2 - e.y, W / 2 - e.x);
    e.stillUntil = performance.now() + DG_ENEMY_SPAWN_STILL_MS;
    dgEnemies.push(e);
  }

  function dgResetGame() {
    dgPlayer = dgMakeShip(DG_PLAYER_HEALTH);
    dgPlayer.invincibleUntil = performance.now() + DG_START_FLASH_MS;
    dgEnemies = [];
    dgSpawnEnemy();
    dgPlayerBolts = [];
    dgEnemyBolts = [];
    dgExplosions = [];
    dgScore = 0;
    dgKillCount = 0;
    dgStreak = 0;
    dgFinalBreakdown = null;
    dgInitials = "";
  }

  // Runs every "playing" frame — base rate scaled by the current streak
  // multiplier, so a hot streak earns points faster rather than the old
  // flat per-hit/per-kill bonuses.
  function dgStepScore(dtScale) {
    dgScore += DG_SCORE_PER_SEC * (dgStreak + 1) * (dtScale / 60);
  }

  // Hidden for the whole active play session (start/playing/gameover) —
  // reappears once the fight ends and the leaderboard is up, or back on the
  // ambient scene.
  function dgUpdateLogoVisibility() {
    const logo = document.querySelector(".hero-logo");
    if (!logo) return;
    const hide = dgMode !== "ambient"; // hidden for the whole dogfight session, including the leaderboard
    logo.style.visibility = hide ? "hidden" : "";
  }

  function startDogfight() {
    dgMode = "start";
    dgStateStartedAt = performance.now();
    dgResetGame();
    dgUpdateLogoVisibility();
    hasSat = true;
    start();
  }
  window.addEventListener("thagobyte:dogfight-start", startDogfight);

  // Movement/fire input while playing; a separate branch below handles
  // letter/backspace/enter for the initials-entry screen. Only ever
  // captured (and only ever preventDefault'd, so normal page
  // scrolling/navigation is untouched otherwise) while a dogfight is
  // actually on screen.
  window.addEventListener("keydown", (e) => {
    if (dgMode === "leaderboard") {
      if (e.code === "Space" || e.key === " ") {
        dgMode = "ambient";
        dgUpdateLogoVisibility();
        window.dispatchEvent(new Event("thagobyte:dogfight-continue"));
        e.preventDefault();
      }
      return;
    }
    if (dgMode === "gameover") {
      if (/^[a-z0-9]$/i.test(e.key) && dgInitials.length < 3) {
        dgInitials += e.key.toUpperCase();
        e.preventDefault();
      } else if (e.key === "Backspace") {
        dgInitials = dgInitials.slice(0, -1);
        e.preventDefault();
      } else if (e.key === "Enter" && dgInitials.length > 0) {
        dgSubmitScore();
        e.preventDefault();
      }
      return;
    }
    if (dgMode === "ambient") return;
    const k = e.code === "Space" ? "space" : e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "space"].includes(k)) {
      dgKeys[k] = true;
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.code === "Space" ? "space" : e.key.toLowerCase();
    dgKeys[k] = false;
  });

  function dgSubmitScore() {
    const initials = dgInitials.padEnd(3, " ").slice(0, 3);
    dgMode = "leaderboard";
    dgUpdateLogoVisibility();
    dgSaveScore(initials, dgFinalBreakdown.total).then((list) => {
      dgLeaderboard = list;
    });
  }

  // Classic Asteroids-style rotate + thrust: A/D (or Left/Right) turn the
  // ship, W/Up burns forward along whatever direction it's currently facing,
  // and light drag lets it coast rather than snapping to a stop — smoother
  // and more physical than "hold a direction to move that way."
  function dgStepPlayer(dtScale) {
    if (dgKeys.a || dgKeys.arrowleft) dgPlayer.angle -= DG_PLAYER_TURN_RATE * dtScale;
    if (dgKeys.d || dgKeys.arrowright) dgPlayer.angle += DG_PLAYER_TURN_RATE * dtScale;
    if (dgKeys.w || dgKeys.arrowup) {
      dgPlayer.vx += Math.cos(dgPlayer.angle) * DG_PLAYER_THRUST * dtScale;
      dgPlayer.vy += Math.sin(dgPlayer.angle) * DG_PLAYER_THRUST * dtScale;
    }
    dgPlayer.vx *= Math.pow(DG_PLAYER_DRAG, dtScale);
    dgPlayer.vy *= Math.pow(DG_PLAYER_DRAG, dtScale);
    const speed = Math.hypot(dgPlayer.vx, dgPlayer.vy);
    if (speed > DG_PLAYER_MAX_SPEED) {
      dgPlayer.vx = (dgPlayer.vx / speed) * DG_PLAYER_MAX_SPEED;
      dgPlayer.vy = (dgPlayer.vy / speed) * DG_PLAYER_MAX_SPEED;
    }
    dgPlayer.x += dgPlayer.vx * dtScale;
    dgPlayer.y += dgPlayer.vy * dtScale;
    // Asteroids-style screen wrap.
    if (dgPlayer.x < 0) dgPlayer.x += W;
    if (dgPlayer.x > W) dgPlayer.x -= W;
    if (dgPlayer.y < 0) dgPlayer.y += H;
    if (dgPlayer.y > H) dgPlayer.y -= H;

    const now = performance.now();
    if (dgKeys.space && now - dgLastShotAt > DG_FIRE_COOLDOWN_MS) {
      dgLastShotAt = now;
      const nx = dgPlayer.x + Math.cos(dgPlayer.angle) * NOSE_LENGTH;
      const ny = dgPlayer.y + Math.sin(dgPlayer.angle) * NOSE_LENGTH;
      dgPlayerBolts.push({
        x: nx, y: ny,
        vx: Math.cos(dgPlayer.angle) * DG_BOLT_SPEED,
        vy: Math.sin(dgPlayer.angle) * DG_BOLT_SPEED,
        life: 60,
      });
      playLaserSound();
    }
  }

  function dgStepEnemies(dtScale, now) {
    dgEnemies.forEach((enemy) => {
      if (now < enemy.stillUntil) return; // holding still/flashing after spawn — no movement or fire yet
      const dx = dgPlayer.x - enemy.x, dy = dgPlayer.y - enemy.y;
      const dist = Math.hypot(dx, dy) || 1;
      const desired = Math.atan2(dy, dx);
      const turn = DG_ENEMY_TURN_RATE * dtScale;
      enemy.angle += Math.max(-turn, Math.min(turn, angleDiff(enemy.angle, desired)));
      // Close in when far, back off a little when right on top of the player.
      const thrust = dist > 160 ? 1 : dist < 90 ? -0.4 : 0;
      enemy.vx += Math.cos(enemy.angle) * DG_ENEMY_ACCEL * thrust * dtScale;
      enemy.vy += Math.sin(enemy.angle) * DG_ENEMY_ACCEL * thrust * dtScale;
      enemy.vx *= Math.pow(DG_ENEMY_DRAG, dtScale);
      enemy.vy *= Math.pow(DG_ENEMY_DRAG, dtScale);
      const speed = Math.hypot(enemy.vx, enemy.vy);
      if (speed > DG_ENEMY_MAX_SPEED) {
        enemy.vx = (enemy.vx / speed) * DG_ENEMY_MAX_SPEED;
        enemy.vy = (enemy.vy / speed) * DG_ENEMY_MAX_SPEED;
      }
      enemy.x += enemy.vx * dtScale;
      enemy.y += enemy.vy * dtScale;
      if (enemy.x < 0) enemy.x += W;
      if (enemy.x > W) enemy.x -= W;
      if (enemy.y < 0) enemy.y += H;
      if (enemy.y > H) enemy.y -= H;

      const facingOff = Math.abs(angleDiff(enemy.angle, desired));
      if (facingOff < FIRING_CONE && dist < 260 && now - enemy.lastShotAt > 900 + Math.random() * 700) {
        enemy.lastShotAt = now;
        const nx = enemy.x + Math.cos(enemy.angle) * NOSE_LENGTH;
        const ny = enemy.y + Math.sin(enemy.angle) * NOSE_LENGTH;
        dgEnemyBolts.push({
          x: nx, y: ny,
          vx: Math.cos(enemy.angle) * DG_BOLT_SPEED,
          vy: Math.sin(enemy.angle) * DG_BOLT_SPEED,
          life: 60,
        });
        playLaserSound();
      }
    });
  }

  function dgStepBolts(list, dtScale) {
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.x += b.vx * dtScale;
      b.y += b.vy * dtScale;
      b.life -= dtScale;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) list.splice(i, 1);
    }
  }

  function dgExplode(x, y, big) {
    dgExplosions.push({ x, y, life: 1, big: !!big, decay: big ? 0.035 : 0.05 });
    playExplosionSound();
  }

  function dgGameOver(now) {
    dgFinalBreakdown = {
      kills: dgKillCount,
      total: Math.floor(dgScore),
    };
    dgMode = "gameover";
    dgStateStartedAt = now;
    dgInitials = "";
    dgUpdateLogoVisibility();
  }

  function dgCheckHits(now) {
    if (dgPlayer.invincibleUntil < now) {
      for (let i = dgEnemyBolts.length - 1; i >= 0; i--) {
        const b = dgEnemyBolts[i];
        if (Math.hypot(b.x - dgPlayer.x, b.y - dgPlayer.y) < DG_HIT_RADIUS) {
          dgEnemyBolts.splice(i, 1);
          dgExplode(dgPlayer.x, dgPlayer.y);
          dgPlayer.health--;
          dgStreak = 0; // hit resets the multiplier streak, not the run
          if (dgPlayer.health <= 0) {
            dgGameOver(now);
            return;
          }
          break;
        }
      }
    }
    for (let i = dgPlayerBolts.length - 1; i >= 0; i--) {
      const b = dgPlayerBolts[i];
      let hitIndex = -1;
      for (let j = 0; j < dgEnemies.length; j++) {
        if (Math.hypot(b.x - dgEnemies[j].x, b.y - dgEnemies[j].y) < DG_HIT_RADIUS) {
          hitIndex = j;
          break;
        }
      }
      if (hitIndex >= 0) {
        dgPlayerBolts.splice(i, 1);
        const enemy = dgEnemies[hitIndex];
        // One hit is lethal (DG_ENEMY_HEALTH = 1) — every landed hit is a kill.
        // No flat point award here — the kill just raises the streak, which
        // dgStepScore is already turning into a faster scoring rate.
        dgExplode(enemy.x, enemy.y, true);
        dgEnemies.splice(hitIndex, 1);
        dgStreak++;
        dgKillCount++;
        // Endless mode: every kill spawns two more in its place, after a
        // beat of calm (see dgSpawnEnemy's stillUntil).
        dgSpawnEnemy();
        dgSpawnEnemy();
      }
    }
  }

  function dgStepExplosions(dtScale) {
    for (let i = dgExplosions.length - 1; i >= 0; i--) {
      dgExplosions[i].life -= dgExplosions[i].decay * dtScale;
      if (dgExplosions[i].life <= 0) dgExplosions.splice(i, 1);
    }
  }

  // Same hull shape as the ambient ships' drawShip(), factored out so both
  // the game ships and the small health-readout icons can use it at any
  // position/angle/scale.
  function dgDrawShipAt(x, y, angle, color, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);

    // Same art as the ambient background ships' drawShip(): flickering
    // engine flame first (so the hull overlaps its base), then the hull,
    // then the cockpit dot.
    const flame = 0.6 + Math.random() * 0.4;
    const flameLen = 6 + flame * 5;
    ctx.beginPath();
    ctx.moveTo(-8, 3);
    ctx.lineTo(-8 - flameLen, 0);
    ctx.lineTo(-8, -3);
    ctx.closePath();
    ctx.fillStyle = "rgba(250, 209, 102, " + (0.5 + flame * 0.4) + ")";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, 6);
    ctx.lineTo(-4, 3);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-4, -3);
    ctx.lineTo(-8, -6);
    ctx.closePath();
    ctx.fillStyle = color;
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

  // Freshly spawned enemies (still within their stillUntil window) flash
  // in place instead of drawing solid every frame — the same blink cadence
  // as the player's own post-spawn invincibility flash — so it reads as
  // "not attacking yet," not just invisible half the time.
  function dgDrawEnemies(now) {
    dgEnemies.forEach((en) => {
      if (now < en.stillUntil && Math.floor(now / 150) % 2 !== 0) return;
      dgDrawShipAt(en.x, en.y, en.angle, DG_ENEMY_COLOR, 1);
    });
  }

  function dgDrawExplosions() {
    dgExplosions.forEach((ex) => {
      ctx.save();
      ctx.translate(ex.x, ex.y);
      if (ex.big) {
        // Bright flash core, fading fast, under the radiating debris lines —
        // reads as a full ship blowing up rather than a graze.
        ctx.beginPath();
        ctx.arc(0, 0, 10 * ex.life, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(250, 209, 102, " + ex.life * 0.6 + ")";
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(250, 209, 102, " + ex.life + ")";
      ctx.lineWidth = ex.big ? 2.5 : 2;
      const spokes = ex.big ? 10 : 7;
      const r1 = 3, r2 = ex.big ? 3 + (1 - ex.life) * 30 : 3 + (1 - ex.life) * 16;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function dgDrawBolts(list) {
    list.forEach((b) => {
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 1.5, b.y - b.vy * 1.5);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = STAR_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  // Player health, top-left — three small ship icons, dimmed as they're lost.
  function dgDrawHealth() {
    for (let i = 0; i < 3; i++) {
      const alive = i < dgPlayer.health;
      ctx.save();
      ctx.globalAlpha = alive ? 1 : 0.2;
      dgDrawShipAt(24 + i * 26, 22, -Math.PI / 2, DG_PLAYER_COLOR, 0.8);
      ctx.restore();
    }
  }

  // Live score readout + current streak multiplier, top-right.
  function dgDrawScore() {
    ctx.save();
    ctx.fillStyle = STAR_COLOR;
    ctx.textAlign = "right";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(`Score: ${Math.floor(dgScore)}`, W - 12, 26);
    ctx.font = "12px sans-serif";
    ctx.fillText(`Multiplier: x${dgStreak + 1}`, W - 12, 44);
    ctx.restore();
  }

  function dgDrawCenteredText(text, y, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = STAR_COLOR;
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(text, W / 2, y);
    ctx.restore();
  }

  function dgDrawGameOver() {
    const b = dgFinalBreakdown;
    dgDrawCenteredText("GAME OVER", H / 2 - 130, 46);
    dgDrawCenteredText(`Ships destroyed: ${b.kills}`, H / 2 - 60, 13);
    dgDrawCenteredText(`TOTAL: ${b.total}`, H / 2 - 34, 19);
    dgDrawCenteredText("Enter your initials:", H / 2 + 4, 13);
    const shown = dgInitials.padEnd(3, "_").split("").join(" ");
    dgDrawCenteredText(shown, H / 2 + 28, 22);
    dgDrawCenteredText("Type 3 letters, then press ENTER", H / 2 + 52, 11, 0.7);
  }

  // Leaderboard stays up indefinitely with a blinking "PRESS SPACE" prompt —
  // pressing it hands off to hero-logo.js's post-game flourish (randomized
  // logo colors + click count set to 501, so clicking the logo again
  // immediately replays the fight) via dgSubmitScore's caller in the
  // keydown handler below.
  function dgDrawLeaderboard(now) {
    const rowH = 18;
    const top = H / 2 - (dgLeaderboard.length * rowH) / 2 - 30;
    dgDrawCenteredText("TOP 10", top - 24, 20);
    if (!dgLeaderboard.length) {
      dgDrawCenteredText("Loading…", top, 13, 0.7);
    }
    dgLeaderboard.forEach((row, i) => {
      dgDrawCenteredText(`${i + 1}.  ${row.initials}  ${row.score}`, top + i * rowH, 14);
    });
    const blinkOn = Math.floor(now / 500) % 2 === 0;
    dgDrawCenteredText("PRESS SPACE", top + dgLeaderboard.length * rowH + 30, 16, blinkOn ? 1 : 0);
  }

  function dgFrame(now, dtScale) {
    dgUpdateLogoVisibility();
    ctx.clearRect(0, 0, W, H);
    drawStars(now);

    if (dgMode === "start") {
      dgStepPlayer(dtScale);
      dgStepBolts(dgPlayerBolts, dtScale);
      dgStepExplosions(dtScale);
      dgStepScore(dtScale);
      dgDrawBolts(dgPlayerBolts);
      const flashOn = Math.floor(now / 150) % 2 === 0;
      if (flashOn) dgDrawShipAt(dgPlayer.x, dgPlayer.y, dgPlayer.angle, DG_PLAYER_COLOR, 1);
      dgDrawEnemies(now);
      dgDrawExplosions();
      dgDrawHealth();
      dgDrawScore();
      dgDrawCenteredText("GAME START", H / 2 - 70, 22);
      dgDrawCenteredText("Arrows/WASD to rotate + thrust — Space to fire", H / 2 - 46, 13);
      if (now - dgStateStartedAt > DG_START_FLASH_MS) {
        dgMode = "playing";
      }
      return;
    }

    if (dgMode === "playing") {
      dgStepPlayer(dtScale);
      dgStepEnemies(dtScale, now);
      dgStepBolts(dgPlayerBolts, dtScale);
      dgStepBolts(dgEnemyBolts, dtScale);
      dgCheckHits(now);
      dgStepExplosions(dtScale);
      dgStepScore(dtScale);

      if (dgMode !== "playing") return; // dgCheckHits may have just ended the run

      dgDrawBolts(dgPlayerBolts);
      dgDrawBolts(dgEnemyBolts);
      const playerVisible = dgPlayer.invincibleUntil < now || Math.floor(now / 100) % 2 === 0;
      if (playerVisible) dgDrawShipAt(dgPlayer.x, dgPlayer.y, dgPlayer.angle, DG_PLAYER_COLOR, 1);
      dgDrawEnemies(now);
      dgDrawExplosions();
      dgDrawHealth();
      dgDrawScore();
      return;
    }

    if (dgMode === "gameover") {
      dgStepExplosions(dtScale);
      dgDrawExplosions();
      dgDrawGameOver();
      return;
    }

    if (dgMode === "leaderboard") {
      dgDrawLeaderboard(now);
      return;
    }
  }

  let hasSat = matrixMode; // matrix rain shows immediately; the dogfight still waits its 10s

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (hasSat) start();
  });

  window.addEventListener("thagobyte:matrix-mode-on", () => {
    if (matrixMode) return;
    matrixMode = true;
    setupMatrixRain();
    hasSat = true;
    start();
  });

  // Same "r" reset key as hero-logo.js's click-counter reset — pressing it
  // also clears the matrix takeover back to the starfield/dogfight scene,
  // and bails out of an active dogfight (any state — mid-fight, game over,
  // initials entry, leaderboard) back to that same ambient scene.
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "r" || (!matrixMode && dgMode === "ambient")) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }
    if (matrixMode) {
      matrixMode = false;
      localStorage.removeItem(MATRIX_STORAGE_KEY);
    }
    dgMode = "ambient";
    dgUpdateLogoVisibility();
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
