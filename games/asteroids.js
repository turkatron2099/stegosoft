(function () {
  const TAU = Math.PI * 2;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function makeAsteroidShape(radius) {
    const points = Math.floor(rand(8, 13));
    const shape = [];
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * TAU;
      const r = radius * rand(0.7, 1.15);
      shape.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    return shape;
  }

  function scoreForRadius(radius) {
    if (radius > 34) return 20;
    if (radius > 18) return 50;
    return 100;
  }

  function startAsteroids(canvas) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    const starfield = Array.from({ length: 80 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.4 + 0.3,
    }));

    let ship, bullets, asteroids, keys, score, lives, level, invulnerable, gameOver, running, rafId, lastShot;

    function resetShip() {
      ship = {
        x: W / 2,
        y: H / 2,
        vx: 0,
        vy: 0,
        angle: -Math.PI / 2,
        radius: 12,
        thrusting: false,
      };
      invulnerable = 120; // frames of flicker immunity after spawn/respawn
    }

    function spawnWave(count) {
      asteroids = [];
      for (let i = 0; i < count; i++) {
        let x, y;
        do {
          x = rand(0, W);
          y = rand(0, H);
        } while (Math.hypot(x - ship.x, y - ship.y) < 140);
        const radius = rand(42, 52);
        asteroids.push({
          x,
          y,
          vx: rand(-1.2, 1.2),
          vy: rand(-1.2, 1.2),
          radius,
          angle: rand(0, TAU),
          spin: rand(-0.02, 0.02),
          shape: makeAsteroidShape(radius),
        });
      }
    }

    function resetGame() {
      score = 0;
      lives = 3;
      level = 1;
      gameOver = false;
      bullets = [];
      lastShot = 0;
      resetShip();
      spawnWave(4);
    }

    keys = {};
    function onKeyDown(e) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", " ", "Enter", "a", "d", "w"].includes(e.key)) {
        e.preventDefault();
      }
      keys[e.key] = true;
      if (e.key === "Enter" && gameOver) resetGame();
    }
    function onKeyUp(e) {
      keys[e.key] = false;
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function wrap(obj) {
      if (obj.x < -obj.radius) obj.x = W + obj.radius;
      if (obj.x > W + obj.radius) obj.x = -obj.radius;
      if (obj.y < -obj.radius) obj.y = H + obj.radius;
      if (obj.y > H + obj.radius) obj.y = -obj.radius;
    }

    function splitAsteroid(a) {
      const newRadius = a.radius / 1.8;
      if (newRadius < 10) return [];
      return [0, 1].map(() => ({
        x: a.x,
        y: a.y,
        vx: rand(-2, 2),
        vy: rand(-2, 2),
        radius: newRadius,
        angle: rand(0, TAU),
        spin: rand(-0.05, 0.05),
        shape: makeAsteroidShape(newRadius),
      }));
    }

    function update() {
      if (gameOver) return;

      const left = keys["ArrowLeft"] || keys["a"];
      const right = keys["ArrowRight"] || keys["d"];
      const up = keys["ArrowUp"] || keys["w"];
      const firing = keys[" "];

      if (left) ship.angle -= 0.06;
      if (right) ship.angle += 0.06;

      ship.thrusting = !!up;
      if (up) {
        ship.vx += Math.cos(ship.angle) * 0.12;
        ship.vy += Math.sin(ship.angle) * 0.12;
      }
      ship.vx *= 0.99;
      ship.vy *= 0.99;
      ship.x += ship.vx;
      ship.y += ship.vy;
      wrap(ship);

      if (invulnerable > 0) invulnerable--;

      lastShot++;
      if (firing && lastShot > 10) {
        bullets.push({
          x: ship.x + Math.cos(ship.angle) * ship.radius,
          y: ship.y + Math.sin(ship.angle) * ship.radius,
          vx: Math.cos(ship.angle) * 6 + ship.vx,
          vy: Math.sin(ship.angle) * 6 + ship.vy,
          life: 60,
        });
        lastShot = 0;
      }

      bullets.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        b.life--;
      });
      bullets = bullets.filter((b) => b.life > 0 && b.x > -10 && b.x < W + 10 && b.y > -10 && b.y < H + 10);

      asteroids.forEach((a) => {
        a.x += a.vx;
        a.y += a.vy;
        a.angle += a.spin;
        wrap(a);
      });

      // bullet vs asteroid
      const survivingAsteroids = [];
      asteroids.forEach((a) => {
        let hit = null;
        for (const b of bullets) {
          if (Math.hypot(a.x - b.x, a.y - b.y) < a.radius) {
            hit = b;
            break;
          }
        }
        if (hit) {
          bullets = bullets.filter((b) => b !== hit);
          score += scoreForRadius(a.radius);
          survivingAsteroids.push(...splitAsteroid(a));
        } else {
          survivingAsteroids.push(a);
        }
      });
      asteroids = survivingAsteroids;

      // ship vs asteroid
      if (invulnerable <= 0) {
        for (const a of asteroids) {
          if (Math.hypot(a.x - ship.x, a.y - ship.y) < a.radius + ship.radius * 0.7) {
            lives--;
            if (lives <= 0) {
              gameOver = true;
            } else {
              resetShip();
            }
            break;
          }
        }
      }

      if (asteroids.length === 0 && !gameOver) {
        level++;
        spawnWave(Math.min(3 + level, 9));
      }
    }

    function drawShip() {
      if (invulnerable > 0 && Math.floor(invulnerable / 4) % 2 === 0) return;
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.angle);
      ctx.strokeStyle = "#8cbfb8";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-10, 9);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-10, -9);
      ctx.closePath();
      ctx.stroke();

      if (ship.thrusting) {
        ctx.strokeStyle = "#faa968";
        ctx.beginPath();
        ctx.moveTo(-6, 0);
        ctx.lineTo(-16 - Math.random() * 6, 0);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawAsteroid(a) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle);
      ctx.strokeStyle = "#f6dcac";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      a.shape.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    function draw() {
      ctx.fillStyle = "#020c17";
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "#3f8f8a";
      starfield.forEach((s) => ctx.fillRect(s.x, s.y, s.r, s.r));

      bullets.forEach((b) => {
        ctx.fillStyle = "#faa968";
        ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
      });

      asteroids.forEach(drawAsteroid);
      drawShip();

      ctx.fillStyle = "#f6dcac";
      ctx.font = "16px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`SCORE ${score}`, 16, 26);
      ctx.textAlign = "right";
      ctx.fillText(`LIVES ${lives}`, W - 16, 26);
      ctx.textAlign = "center";
      ctx.fillText(`LV ${level}`, W / 2, 26);

      if (gameOver) {
        ctx.fillStyle = "rgba(2, 12, 23, 0.75)";
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#f85525";
        ctx.font = "bold 36px monospace";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", W / 2, H / 2 - 10);
        ctx.fillStyle = "#f6dcac";
        ctx.font = "16px monospace";
        ctx.fillText(`Final score: ${score}`, W / 2, H / 2 + 20);
        ctx.fillText("Press Enter to restart", W / 2, H / 2 + 46);
      }
    }

    function loop() {
      if (!running) return;
      update();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    running = true;
    resetGame();
    loop();

    return {
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
      },
    };
  }

  window.STEGO_GAMES = window.STEGO_GAMES || {};
  window.STEGO_GAMES.asteroids = {
    title: "Asteroids",
    start: startAsteroids,
  };
})();
