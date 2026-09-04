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
  const ctx = canvas.getContext("2d");

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  window.addEventListener("resize", () => { resize(); makeStars(); });
  resize();
  makeStars();

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  const MARGIN = 70; // how far past the edge a ship flies before going "away"
  const SPEED = 1.7; // px/frame cruising speed
  const TURN_RATE = 0.05; // max radians/frame steered toward the target heading

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

  function stepShip(ship, other, now) {
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
    ship.angle += Math.max(-TURN_RATE, Math.min(TURN_RATE, angleDiff(ship.angle, desired)));
    ship.x += Math.cos(ship.angle) * SPEED;
    ship.y += Math.sin(ship.angle) * SPEED;
    ship.flame = 0.6 + Math.random() * 0.4;

    if (ship.state === "leaving" && (ship.x < -MARGIN || ship.x > W + MARGIN || ship.y < -MARGIN || ship.y > H + MARGIN)) {
      ship.state = "away";
      ship.awayUntil = now + rand(2500, 7000);
    }

    // Occasional blaster bolt at the other ship while both are on-screen and
    // reasonably close — a light flourish, not a real hit-detection system.
    if (ship.state === "active" && other.state === "active" && Math.random() < 0.01) {
      const dx = other.x - ship.x, dy = other.y - ship.y;
      if (dx * dx + dy * dy < 300 * 300) {
        bolts.push({ x1: ship.x, y1: ship.y, x2: other.x, y2: other.y, life: 1, color: ship.color });
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

  function drawBolts() {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.life -= 0.06;
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

  function stepMeteor(now) {
    if (!meteor) return;
    meteor.x += meteor.vx;
    meteor.y += meteor.vy;
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

  let running = false;
  let rafId = null;

  function frame() {
    if (!running) return;
    const now = performance.now();
    ctx.clearRect(0, 0, W, H);
    drawStars(now);
    maybeSpawnMeteor(now);
    stepMeteor(now);
    drawMeteor();
    stepShip(ships[0], ships[1], now);
    stepShip(ships[1], ships[0], now);
    drawBolts();
    ships.forEach(drawShip);
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    frame();
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (hasSat) start();
  });

  let hasSat = false;
  setTimeout(() => {
    hasSat = true;
    if (!document.hidden) start();
  }, 10000);
})();
