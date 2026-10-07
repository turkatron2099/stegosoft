(function () {
  // Tark — an all-ASCII castle platformer. The whole screen is an 80x30
  // grid of monospace characters (9x16px cells filling the console's
  // 720x480 logical canvas), and everything — walls, the hero, the sword,
  // monsters, the HUD — is drawn as characters snapped to that grid.
  // Positions and physics are floats measured in cells (x in columns, y in
  // rows) and only rounded to whole cells at draw time.
  const COLS = 80;
  const ROWS = 30;
  const CW = 9;
  const CH = 16;
  const HUD_ROWS = 2;
  const VIEW_ROWS = ROWS - HUD_ROWS; // every room is exactly this tall

  const FONT = 'bold 15px "DejaVu Sans Mono", "Cascadia Mono", Menlo, Consolas, "Courier New", monospace';

  const COLOR = {
    bg: "#07060b",
    backdrop: "#262331",
    wall: "#55556a",
    wallAlt: "#474759",
    wallTop: "#a3a3b5",
    wood: "#b07a3c",
    spike: "#d8d8e0",
    torch: "#8a6a3a",
    flame: "#ffb030",
    hero: "#f6dcac",
    sword: "#e8f4ff",
    coin: "#ffd84a",
    potion: "#ff6b8a",
    door: "#faa968",
    doorLocked: "#5a4630",
    skeleton: "#e6e6d8",
    slime: "#5fd35f",
    bat: "#b07cff",
    ghost: "#9fe8e8",
    boss: "#f85525",
    shot: "#ffb030",
    hud: "#a7c9c6",
    heart: "#f85525",
    dim: "#4a4a5c",
    title: "#faa968",
    text: "#f6dcac",
    flash: "#ffffff",
  };

  // --- Rooms -------------------------------------------------------------
  // Each room is 25 rows of interior; the outer walls, ceiling and floor
  // are added automatically, and short rows are padded with open air.
  //   #  stone (solid)          =  wooden ledge (jump up through, Down drops)
  //   ^  spikes                 T  wall torch (decoration)
  //   $  coin                   +  health potion
  //   P  hero start             D  exit door (bottom-left corner)
  //   s  skeleton   m  slime    b  bat   g  ghost   B  the boss
  // Creatures and the door are placed by where their feet go. A jump clears
  // about 5 rows, so ledges are spaced 4 rows apart (rows 21, 17, 13, 9, 5).
  const LEVELS = [
    {
      name: "THE GATEHOUSE",
      rows: [
        "",
        "",
        "                               b                                      b",
        "",
        "                                                                    $ $ $",
        "                                                                  =========",
        "",
        "",
        "                                          $ $",
        "                                        =======            ======",
        "",
        "",
        "                     $ $ $                              $",
        "                   =========        ======          =========            ======",
        "",
        "",
        "                                                                                  +",
        "            ======            ======        =====                 =====        =====",
        "",
        "",
        "    T                                T                                  T               T",
        "       =====       =====                  ##        ====      ##            =====",
        "                                          ##                  ##",
        "                                          ##                  ##",
        " P          m           s                 ##     m        ^^^^##^^^^    s                D",
      ],
    },
    {
      name: "THE GREAT HALL",
      rows: [
        "",
        "",
        "              b                         b                            b",
        "",
        "                                             $ $ $",
        "                                            =========",
        "",
        "",
        "                  $                                          $ $             +",
        "          ============            =====            =====   ======        ========",
        "",
        "",
        "                                                                   g",
        "     =====                 =======        ======                         =====",
        "",
        "",
        "                    g",
        "            ====         ####      ====       ====     ####     =====           ====",
        "                         ####                          ####",
        "                         ####                          ####",
        "   T                     ####            T             ####              T",
        "       ====      ===     ####    ===           ====    ####    ===               ####",
        "                         ####                          ####                      ####",
        "                         ####                          ####                      ####",
        " P        s      ^^^^^^^^####^^^^^^     s    m    s    ####^^^^^^^^^^    s   m   ####    D",
      ],
    },
    {
      name: "THE THRONE ROOM",
      rows: [
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "                     +                                  +",
        "                  =======                            =======",
        "",
        "",
        "",
        "        ======                   ============                   ======",
        "",
        "",
        "   T                                  T                                   T",
        "                   =====                              =====",
        "",
        "",
        "",
        "      =====              =====                  =====              =====",
        "",
        "",
        "  P                                                         B           D",
      ],
    },
  ];

  // --- Sprites -----------------------------------------------------------
  // All drawn facing right; mirror() flips them for facing left.
  const HERO = {
    idle: [" o ", "/|\\", "/ \\"],
    walk: [" o ", "/|\\", " | "],
    jump: ["\\o/", " | ", "/ \\"],
    dead: ["   ", "   ", "_o/"],
  };
  const SPRITES = {
    skeleton: [
      [" @ ", "/#\\", "/ \\"],
      [" @ ", "/#\\", " | "],
    ],
    slime: [
      [" __ ", "(oo)"],
      ["(oo)", " '' "],
    ],
    bat: [["^o^"], ["-o-"]],
    ghost: [
      [" .-. ", "(o o)", " vVv "],
      [" .-. ", "(o o)", " VvV "],
    ],
    boss: [
      ["  \\VVV/  ", "  (o,o)  ", " /[###]\\ ", "/ [###] \\", "  _/ \\_  "],
      ["  \\VVV/  ", "  (O,O)  ", "\\_[###]_/", "  [###]  ", "  _/ \\_  "],
    ],
  };
  const DOOR = [" __ ", "|  |", "| o|", "|__|"];

  const KINDS = {
    s: { type: "skeleton", w: 3, h: 3, hp: 2, score: 50, color: COLOR.skeleton },
    m: { type: "slime", w: 4, h: 2, hp: 2, score: 30, color: COLOR.slime },
    b: { type: "bat", w: 3, h: 1, hp: 1, score: 20, color: COLOR.bat },
    g: { type: "ghost", w: 5, h: 3, hp: 3, score: 60, color: COLOR.ghost },
    B: { type: "boss", w: 9, h: 5, hp: 14, score: 500, color: COLOR.boss },
  };

  const TITLE_LOGO = [
    "########    ###     ######    ##   ##",
    "   ##      ## ##    ##   ##   ##  ## ",
    "   ##     ##   ##   ######    #####  ",
    "   ##     #######   ##  ##    ##  ## ",
    "   ##     ##   ##   ##   ##   ##   ##",
  ];
  const TITLE_CASTLE = [
    "  [^]                           [^]  ",
    " _|_|_   _   _   _   _   _   _ _|_|_ ",
    "|_   _|_| |_| |_| |_| |_| |_| |_   _|",
    "  | |                           | |  ",
    "  | |          .-----.          | |  ",
    "  | |          |  |  |          | |  ",
    "__|_|__________|__|__|__________|_|__",
  ];

  const MIRROR = { "/": "\\", "\\": "/", "(": ")", ")": "(", "<": ">", ">": "<", "[": "]", "]": "[" };
  function mirror(lines) {
    return lines.map((line) =>
      line
        .split("")
        .reverse()
        .map((ch) => MIRROR[ch] || ch)
        .join("")
    );
  }

  function hash(x, y) {
    return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;
  }

  // --- Tuning (all "per 1/60s frame", in cells) ---------------------------
  const GRAVITY = 0.045;
  const MAX_FALL = 0.9;
  const RUN_SPEED = 0.35;
  const JUMP_SPEED = 0.7;
  const MAX_HP = 5;
  const ATTACK_FRAMES = 14;
  const ATTACK_COOLDOWN = 22;
  const HURT_INVULN = 70;
  const EPS = 0.001;

  function startTark(canvas) {
    // Same crisp-when-stretched backing store trick as the other cartridges.
    const W = COLS * CW;
    const H = ROWS * CH;
    const RENDER_SCALE = 2;
    canvas.width = W * RENDER_SCALE;
    canvas.height = H * RENDER_SCALE;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

    let running = true;
    let rafId = null;
    let state = "title"; // title | play | dead | clear | win
    let stateT = 0; // frames spent in the current state
    let frame = 0; // global animation clock
    let levelIndex = 0;
    let level = null;
    let hero = null;
    let enemies = [];
    let shots = [];
    let pickups = [];
    let particles = [];
    let camX = 0;
    let score = 0;
    let scoreAtRoomStart = 0;
    let swingId = 0;
    const keys = {};
    let jumpBuffer = 0;
    let attackQueued = false;

    // --- Sound: tiny synthesized bleeps, no audio files ------------------
    let audioCtx = null;
    function tone(freq, duration, type = "square", volume = 0.06, slideTo = null) {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
      } catch (e) {
        // Web Audio unavailable — the game is fully playable silent.
      }
    }
    const sfx = {
      jump: () => tone(300, 0.12, "square", 0.04, 520),
      swing: () => tone(900, 0.07, "sawtooth", 0.035, 300),
      hit: () => tone(180, 0.1, "square", 0.07, 90),
      kill: () => tone(240, 0.22, "sawtooth", 0.07, 60),
      hurt: () => tone(140, 0.25, "sawtooth", 0.08, 50),
      coin: () => tone(990, 0.09, "square", 0.04, 1480),
      potion: () => tone(520, 0.2, "triangle", 0.08, 1040),
      door: () => tone(330, 0.4, "triangle", 0.08, 660),
      roar: () => tone(90, 0.5, "sawtooth", 0.09, 45),
    };

    // --- Room loading ----------------------------------------------------
    function loadLevel(index) {
      const def = LEVELS[index];
      const interior = Math.max(COLS - 2, ...def.rows.map((row) => row.length + 4));
      const width = interior + 2;
      const grid = [];
      grid.push(new Array(width).fill("#"));
      for (let i = 0; i < VIEW_ROWS - 3; i++) {
        const row = ("#" + (def.rows[i] || "").padEnd(interior, " ") + "#").split("");
        grid.push(row);
      }
      grid.push(new Array(width).fill("#"));
      grid.push(new Array(width).fill("#"));

      level = { name: def.name, width, grid, torches: [], door: null };
      enemies = [];
      shots = [];
      pickups = [];
      particles = [];
      hero = null;

      for (let r = 0; r < VIEW_ROWS; r++) {
        for (let c = 0; c < width; c++) {
          const ch = grid[r][c];
          if (ch === "#" || ch === "=" || ch === "^" || ch === " ") continue;
          grid[r][c] = " ";
          if (ch === "P") {
            hero = makeHero(c, r - 2);
          } else if (ch === "D") {
            level.door = { x: c, y: r - 3, w: 4, h: 4 };
          } else if (ch === "T") {
            level.torches.push({ x: c, y: r });
          } else if (ch === "$" || ch === "+") {
            pickups.push({ x: c, y: r, w: 1, h: 1, ch });
          } else if (KINDS[ch]) {
            const kind = KINDS[ch];
            enemies.push({
              ...kind,
              maxHp: kind.hp,
              x: c,
              y: r + 1 - kind.h,
              homeY: r + 1 - kind.h,
              vx: 0,
              vy: 0,
              dir: -1,
              onGround: false,
              flash: 0,
              knock: 0,
              lastSwing: -1,
              awake: false,
              timer: 60 + (hash(c, r) % 60),
              mode: "walk",
            });
          }
        }
      }
      if (!hero) hero = makeHero(2, VIEW_ROWS - 5);
      levelIndex = index;
      scoreAtRoomStart = score;
      camX = clampCam(hero.x + 1.5 - COLS / 2);
      setState("play");
    }

    function makeHero(x, y) {
      return {
        x,
        y,
        w: 3,
        h: 3,
        vx: 0,
        vy: 0,
        dir: 1,
        hp: MAX_HP,
        onGround: false,
        onOneWay: false,
        dropT: 0,
        coyote: 0,
        attackT: 0,
        cooldown: 0,
        invuln: 0,
        knock: 0,
      };
    }

    function setState(next) {
      state = next;
      stateT = 0;
    }

    function newGame() {
      score = 0;
      loadLevel(0);
    }

    function clampCam(x) {
      return Math.max(0, Math.min(level.width - COLS, x));
    }

    // --- Tiles & collision ----------------------------------------------
    function tileAt(c, r) {
      if (r < 0 || r >= VIEW_ROWS || c < 0 || c >= level.width) return "#";
      return level.grid[r][c];
    }
    function isSolid(c, r) {
      return tileAt(c, r) === "#";
    }
    function isStandable(c, r) {
      const t = tileAt(c, r);
      return t === "#" || t === "=";
    }

    function overlap(a, b, pad = 0) {
      return a.x + pad < b.x + b.w && a.x + a.w - pad > b.x && a.y + pad < b.y + b.h && a.y + a.h - pad > b.y;
    }

    // Moves a body by its velocity one axis at a time, pushing it back out
    // of stone. Wooden ledges only catch a body that was above them and is
    // moving down. Returns true if it ran into a wall sideways.
    function moveBody(e, dt) {
      let hitWall = false;

      e.x += e.vx * dt;
      const r0 = Math.floor(e.y + EPS);
      const r1 = Math.ceil(e.y + e.h - EPS) - 1;
      if (e.vx > 0) {
        const c = Math.ceil(e.x + e.w - EPS) - 1;
        for (let r = r0; r <= r1; r++) {
          if (isSolid(c, r)) {
            e.x = c - e.w;
            hitWall = true;
            break;
          }
        }
      } else if (e.vx < 0) {
        const c = Math.floor(e.x + EPS);
        for (let r = r0; r <= r1; r++) {
          if (isSolid(c, r)) {
            e.x = c + 1;
            hitWall = true;
            break;
          }
        }
      }

      const prevBottom = e.y + e.h;
      e.y += e.vy * dt;
      e.onGround = false;
      e.onOneWay = false;
      const c0 = Math.floor(e.x + EPS);
      const c1 = Math.ceil(e.x + e.w - EPS) - 1;
      if (e.vy >= 0) {
        const r = Math.ceil(e.y + e.h - EPS) - 1;
        let stone = false;
        let ledge = false;
        for (let c = c0; c <= c1; c++) {
          const t = tileAt(c, r);
          if (t === "#") stone = true;
          else if (t === "=" && !(e.dropT > 0) && prevBottom <= r + EPS) ledge = true;
        }
        if (stone || ledge) {
          e.y = r - e.h;
          e.vy = 0;
          e.onGround = true;
          e.onOneWay = !stone;
        }
      } else {
        const r = Math.floor(e.y + EPS);
        for (let c = c0; c <= c1; c++) {
          if (isSolid(c, r)) {
            e.y = r + 1;
            e.vy = 0;
            break;
          }
        }
      }
      return hitWall;
    }

    // --- Particles ---------------------------------------------------------
    function burst(x, y, count, color, chars = "*.'+") {
      for (let i = 0; i < count; i++) {
        particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -Math.random() * 0.45,
          gravity: 0.03,
          ch: chars[(Math.random() * chars.length) | 0],
          color,
          life: 20 + Math.random() * 25,
        });
      }
    }
    function floatText(x, y, str, color) {
      particles.push({ x, y, vx: 0, vy: -0.06, gravity: 0, ch: str, color, life: 45 });
    }

    // --- Hero ----------------------------------------------------------------
    function swordBox() {
      const reach = 4.5;
      return {
        x: hero.dir > 0 ? hero.x + hero.w - 0.5 : hero.x - reach + 0.5,
        y: hero.y - 1,
        w: reach,
        h: hero.h + 1.5,
      };
    }

    function hurtHero(fromX) {
      if (hero.invuln > 0 || state !== "play") return;
      hero.hp -= 1;
      hero.invuln = HURT_INVULN;
      hero.knock = 10;
      hero.vx = (hero.x + hero.w / 2 < fromX ? -1 : 1) * 0.4;
      hero.vy = -0.4;
      hero.attackT = 0;
      sfx.hurt();
      burst(hero.x + 1.5, hero.y + 1, 6, COLOR.heart);
      if (hero.hp <= 0) setState("dead");
    }

    function updateHero(dt) {
      const left = keys.ArrowLeft || keys.a || touched("left");
      const right = keys.ArrowRight || keys.d || touched("right");
      const down = keys.ArrowDown || keys.s;
      const jumpHeld = keys.ArrowUp || keys.w || keys[" "] || keys.z || touched("jump");

      if (hero.knock > 0) {
        hero.knock -= dt;
      } else {
        hero.vx = ((right ? 1 : 0) - (left ? 1 : 0)) * RUN_SPEED;
        if (hero.vx !== 0 && hero.attackT <= 0) hero.dir = Math.sign(hero.vx);
      }

      // A jump pressed just before landing, or just after walking off a
      // ledge, still counts.
      hero.coyote = hero.onGround ? 6 : hero.coyote - dt;
      if (jumpBuffer > 0) jumpBuffer -= dt;
      if (down && hero.onGround && hero.onOneWay) {
        hero.dropT = 12;
        jumpBuffer = 0;
      } else if (jumpBuffer > 0 && hero.coyote > 0) {
        hero.vy = -JUMP_SPEED;
        hero.coyote = 0;
        jumpBuffer = 0;
        sfx.jump();
      }
      // Letting go of jump early cuts the jump short.
      if (!jumpHeld && hero.vy < -0.3) hero.vy = -0.3;
      if (hero.dropT > 0) hero.dropT -= dt;

      hero.vy = Math.min(MAX_FALL, hero.vy + GRAVITY * dt);
      moveBody(hero, dt);

      if (hero.cooldown > 0) hero.cooldown -= dt;
      if (hero.attackT > 0) hero.attackT -= dt;
      if (attackQueued && hero.cooldown <= 0) {
        hero.attackT = ATTACK_FRAMES;
        hero.cooldown = ATTACK_COOLDOWN;
        swingId++;
        sfx.swing();
      }
      attackQueued = false;

      if (hero.attackT > 0) {
        const box = swordBox();
        for (const e of enemies) {
          if (e.lastSwing === swingId || !overlap(box, e)) continue;
          e.lastSwing = swingId;
          damageEnemy(e);
        }
        for (const shot of shots) {
          if (overlap(box, { x: shot.x - 0.5, y: shot.y - 0.5, w: 1, h: 1 })) {
            shot.life = 0;
            burst(shot.x, shot.y, 4, COLOR.shot);
            sfx.hit();
          }
        }
      }

      if (hero.invuln > 0) hero.invuln -= dt;

      // Spikes: any spike cell the hero's body overlaps.
      const c0 = Math.floor(hero.x + 0.3);
      const c1 = Math.floor(hero.x + hero.w - 0.3);
      const feet = Math.floor(hero.y + hero.h - 0.2);
      for (let c = c0; c <= c1; c++) {
        if (tileAt(c, feet) === "^") {
          if (hero.invuln <= 0) hurtHero(hero.x + hero.w / 2);
          hero.vy = -0.5;
          break;
        }
      }

      for (const item of pickups) {
        if (item.taken || !overlap(hero, item)) continue;
        if (item.ch === "$") {
          item.taken = true;
          score += 10;
          sfx.coin();
          floatText(item.x - 1, item.y - 1, "+10", COLOR.coin);
        } else if (hero.hp < MAX_HP) {
          item.taken = true;
          hero.hp += 1;
          sfx.potion();
          floatText(item.x - 1, item.y - 1, "+HP", COLOR.potion);
        }
      }
      pickups = pickups.filter((item) => !item.taken);

      if (level.door && !bossAlive() && overlap(hero, level.door, 1)) {
        sfx.door();
        setState(levelIndex === LEVELS.length - 1 ? "win" : "clear");
      }
    }

    // --- Monsters --------------------------------------------------------------
    function bossAlive() {
      return enemies.some((e) => e.type === "boss");
    }

    function damageEnemy(e) {
      e.hp -= 1;
      e.flash = 8;
      e.knock = e.type === "boss" ? 0 : 9;
      if (e.type !== "boss") {
        e.vx = hero.dir * 0.45;
        if (e.type === "skeleton" || e.type === "slime") e.vy = -0.25;
      }
      e.awake = true;
      if (e.hp <= 0) {
        e.dead = true;
        score += e.score;
        sfx.kill();
        burst(e.x + e.w / 2, e.y + e.h / 2, e.type === "boss" ? 60 : 12, e.color, "*#+x.'");
        floatText(e.x, e.y - 1, "+" + e.score, COLOR.coin);
      } else {
        sfx.hit();
        burst(e.x + e.w / 2, e.y + e.h / 2, 3, COLOR.flash);
      }
    }

    function fireAt(e, speedPx) {
      const sx = e.x + e.w / 2;
      const sy = e.y + 1.5;
      const dx = (hero.x + 1.5 - sx) * CW;
      const dy = (hero.y + 1.5 - sy) * CH;
      const d = Math.hypot(dx, dy) || 1;
      shots.push({ x: sx, y: sy, vx: ((dx / d) * speedPx) / CW, vy: ((dy / d) * speedPx) / CH, life: 240 });
    }

    function updateEnemy(e, dt) {
      const dx = hero.x + hero.w / 2 - (e.x + e.w / 2);
      const dy = hero.y + hero.h / 2 - (e.y + e.h / 2);
      if (Math.abs(dx) > 70) return; // far off-screen monsters stay asleep
      if (e.flash > 0) e.flash -= dt;
      const knocked = e.knock > 0;
      if (knocked) e.knock -= dt;

      if (e.type === "skeleton") {
        if (!knocked && e.onGround) {
          const seen = Math.abs(dy) < 3 && Math.abs(dx) < 16;
          if (seen) e.dir = dx > 0 ? 1 : -1;
          const frontCol = Math.floor(e.dir > 0 ? e.x + e.w + 0.2 : e.x - 0.2);
          const footRow = Math.round(e.y + e.h);
          const blocked = !isStandable(frontCol, footRow) || isSolid(frontCol, footRow - 1);
          if (blocked && !seen) e.dir *= -1;
          e.vx = blocked ? 0 : e.dir * (seen ? 0.16 : 0.08);
        }
        e.vy = Math.min(MAX_FALL, e.vy + GRAVITY * dt);
        moveBody(e, dt);
      } else if (e.type === "slime") {
        if (e.onGround && !knocked) {
          e.vx = 0;
          e.timer -= dt;
          if (e.timer <= 0) {
            e.dir = Math.abs(dx) < 24 ? (dx > 0 ? 1 : -1) : Math.random() < 0.5 ? 1 : -1;
            e.vx = e.dir * 0.2;
            e.vy = -0.5;
            e.timer = 45 + Math.random() * 45;
          }
        }
        e.vy = Math.min(MAX_FALL, e.vy + GRAVITY * dt);
        if (moveBody(e, dt)) e.vx = 0;
      } else if (e.type === "bat") {
        // Hangs from its perch until the hero wanders close, then swoops.
        if (!e.awake && Math.abs(dx) < 18 && Math.abs(dy) < 16) e.awake = true;
        if (e.awake) {
          if (!knocked) {
            e.vx = Math.max(-0.2, Math.min(0.2, e.vx + Math.sign(dx) * 0.012 * dt));
            e.vy = Math.max(-0.11, Math.min(0.11, e.vy + Math.sign(dy) * 0.008 * dt));
          }
          e.x += e.vx * dt;
          e.y += (e.vy + Math.sin(frame / 9) * 0.04) * dt;
        }
      } else if (e.type === "ghost") {
        // Drifts straight through walls toward the hero.
        if (!e.awake && Math.abs(dx) < 34) e.awake = true;
        if (e.awake) {
          if (!knocked) {
            e.vx = Math.sign(dx) * 0.07;
            e.vy = Math.sign(dy) * 0.04;
            e.dir = dx > 0 ? 1 : -1;
          }
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }
      } else if (e.type === "boss") {
        updateBoss(e, dx, dt);
      }

      if (overlap(hero, e, 0.35)) hurtHero(e.x + e.w / 2);
    }

    // Walks the hero down, then alternates between a volley of aimed
    // fireballs and a leap that sends shockwaves along the floor. Gets
    // faster once it's lost half its health.
    function updateBoss(e, dx, dt) {
      const enraged = e.hp <= e.maxHp / 2;
      e.dir = dx > 0 ? 1 : -1;
      e.timer -= dt;

      if (e.mode === "walk") {
        e.vx = Math.abs(dx) > 3 ? e.dir * (enraged ? 0.15 : 0.09) : 0;
        if (e.timer <= 0) {
          if (Math.random() < 0.5) {
            e.mode = "volley";
            e.volley = enraged ? 5 : 3;
            e.timer = 20;
            sfx.roar();
          } else if (e.onGround) {
            e.mode = "leap";
            e.vy = -0.8;
            e.vx = e.dir * Math.min(0.4, Math.abs(dx) / 34);
            e.onGround = false;
          }
        }
      } else if (e.mode === "volley") {
        e.vx = 0;
        if (e.timer <= 0) {
          fireAt(e, enraged ? 4 : 3.2);
          e.volley -= 1;
          e.timer = 16;
          if (e.volley <= 0) {
            e.mode = "walk";
            e.timer = enraged ? 70 : 110;
          }
        }
      }

      e.vy = Math.min(MAX_FALL, e.vy + GRAVITY * dt);
      const wasAirborne = !e.onGround;
      if (moveBody(e, dt)) e.vx = 0;
      if (e.mode === "leap" && wasAirborne && e.onGround) {
        const y = e.y + e.h - 0.5;
        shots.push({ x: e.x, y, vx: -0.35, vy: 0, life: 200 });
        shots.push({ x: e.x + e.w, y, vx: 0.35, vy: 0, life: 200 });
        sfx.roar();
        burst(e.x + e.w / 2, e.y + e.h, 10, COLOR.dim, ".,'");
        e.mode = "walk";
        e.timer = enraged ? 60 : 100;
      }
    }

    // --- Update --------------------------------------------------------------
    function update(dt) {
      frame += dt;
      stateT += dt;

      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        p.life -= dt;
      }
      particles = particles.filter((p) => p.life > 0);

      if (state === "clear") {
        if (stateT > 80) loadLevel(levelIndex + 1);
        return;
      }
      if (state !== "play") return;

      updateHero(dt);
      for (const e of enemies) updateEnemy(e, dt);
      enemies = enemies.filter((e) => !e.dead);

      for (const shot of shots) {
        shot.x += shot.vx * dt;
        shot.y += shot.vy * dt;
        shot.life -= dt;
        if (isSolid(Math.floor(shot.x), Math.floor(shot.y))) shot.life = 0;
        else if (overlap(hero, { x: shot.x - 0.4, y: shot.y - 0.4, w: 0.8, h: 0.8 })) {
          shot.life = 0;
          hurtHero(shot.x);
        }
      }
      shots = shots.filter((shot) => shot.life > 0);

      camX += (clampCam(hero.x + 1.5 - COLS / 2) - camX) * Math.min(1, 0.2 * dt);
    }

    // --- Drawing -------------------------------------------------------------
    function put(col, row, ch, color) {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS || ch === " ") return;
      ctx.fillStyle = color;
      ctx.fillText(ch, col * CW + CW / 2, row * CH + CH / 2 + 1);
    }
    function text(str, col, row, color) {
      for (let i = 0; i < str.length; i++) put(col + i, row, str[i], color);
    }
    function center(str, row, color) {
      text(str, Math.floor((COLS - str.length) / 2), row, color);
    }
    function sprite(lines, col, row, color) {
      for (let i = 0; i < lines.length; i++) text(lines[i], col, row + i, color);
    }
    function block(lines, row, color) {
      const width = Math.max(...lines.map((line) => line.length));
      const col = Math.floor((COLS - width) / 2);
      for (let i = 0; i < lines.length; i++) text(lines[i], col, row + i, color);
    }

    function drawRoom(cam) {
      for (let r = 0; r < VIEW_ROWS; r++) {
        for (let sc = 0; sc < COLS; sc++) {
          const c = sc + cam;
          const t = tileAt(c, r);
          const h = hash(c, r);
          if (t === "#") {
            const color = !isSolid(c, r - 1) ? COLOR.wallTop : h % 3 === 0 ? COLOR.wallAlt : COLOR.wall;
            put(sc, r + HUD_ROWS, "#", color);
          } else if (t === "=") {
            put(sc, r + HUD_ROWS, "=", COLOR.wood);
          } else if (t === "^") {
            put(sc, r + HUD_ROWS, "^", COLOR.spike);
          } else if (h % 31 === 0) {
            // Sparse specks so the back wall isn't a flat black void.
            put(sc, r + HUD_ROWS, h % 2 ? "." : "'", COLOR.backdrop);
          }
        }
      }
      for (const torch of level.torches) {
        const flicker = "*^'*"[(Math.floor(frame / 7) + torch.x) % 4];
        put(torch.x - cam, torch.y - 1 + HUD_ROWS, flicker, COLOR.flame);
        put(torch.x - cam, torch.y + HUD_ROWS, "!", COLOR.torch);
      }
      if (level.door) {
        const locked = bossAlive();
        sprite(DOOR, level.door.x - cam, level.door.y + HUD_ROWS, locked ? COLOR.doorLocked : COLOR.door);
      }
      for (const item of pickups) {
        put(item.x - cam, item.y + HUD_ROWS, item.ch, item.ch === "$" ? COLOR.coin : COLOR.potion);
      }
    }

    function drawEnemy(e, cam) {
      const frames = SPRITES[e.type];
      let lines;
      if (e.type === "slime") lines = frames[e.onGround ? 0 : 1];
      else if (e.type === "bat") lines = e.awake ? frames[Math.floor(frame / 8) % 2] : ["'V'"];
      else if (e.type === "boss") lines = frames[e.mode === "walk" ? 0 : 1];
      else lines = frames[Math.floor(frame / 12) % 2];
      if (e.dir < 0 && e.type !== "boss") lines = mirror(lines);
      sprite(lines, Math.round(e.x) - cam, Math.round(e.y) + HUD_ROWS, e.flash > 0 ? COLOR.flash : e.color);
    }

    function drawHero(cam) {
      if (state !== "dead" && hero.invuln > 0 && Math.floor(frame / 4) % 2 === 0) return;
      const col = Math.round(hero.x) - cam;
      const row = Math.round(hero.y) + HUD_ROWS;
      let lines;
      if (state === "dead") lines = HERO.dead;
      else if (!hero.onGround) lines = HERO.jump;
      else if (hero.vx !== 0 && Math.floor(frame / 6) % 2 === 0) lines = HERO.walk;
      else lines = HERO.idle;
      sprite(hero.dir < 0 ? mirror(lines) : lines, col, row, COLOR.hero);
      if (state === "dead") return;

      // The sword: held upright at rest, then swept overhead -> straight
      // out -> down across the swing.
      const d = hero.dir;
      const ox = d > 0 ? col + 3 : col - 1;
      const up = d > 0 ? "/" : "\\";
      const dn = d > 0 ? "\\" : "/";
      if (hero.attackT <= 0) {
        put(ox, row, "|", COLOR.sword);
        put(ox, row + 1, "+", COLOR.sword);
      } else {
        const a = 1 - hero.attackT / ATTACK_FRAMES;
        if (a < 0.3) {
          put(ox, row, up, COLOR.sword);
          put(ox + d, row - 1, up, COLOR.sword);
        } else if (a < 0.75) {
          put(ox, row + 1, "=", COLOR.sword);
          put(ox + d, row + 1, "-", COLOR.sword);
          put(ox + 2 * d, row + 1, "-", COLOR.sword);
          put(ox + 3 * d, row + 1, "-", COLOR.sword);
          put(ox + 3 * d, row, d > 0 ? ")" : "(", COLOR.dim);
        } else {
          put(ox, row + 2, dn, COLOR.sword);
          put(ox + d, row + 2, "_", COLOR.sword);
        }
      }
    }

    function drawHud() {
      text("TARK", 1, 0, COLOR.title);
      text("HP", 8, 0, COLOR.hud);
      for (let i = 0; i < MAX_HP; i++) {
        text(i < hero.hp ? "<3" : "--", 11 + i * 3, 0, i < hero.hp ? COLOR.heart : COLOR.dim);
      }
      text("SCORE " + String(score).padStart(5, "0"), 28, 0, COLOR.hud);
      text("ROOM " + (levelIndex + 1) + "/" + LEVELS.length + "  " + level.name, 42, 0, COLOR.hud);

      const boss = enemies.find((e) => e.type === "boss");
      if (boss) {
        const width = 40;
        const filled = Math.ceil((boss.hp / boss.maxHp) * width);
        const col = Math.floor((COLS - width - 2) / 2);
        text("[" + "#".repeat(filled), col, 1, COLOR.boss);
        text("-".repeat(width - filled) + "]", col + 1 + filled, 1, COLOR.dim);
      }
    }

    function drawTouchUI() {
      if (!touchUI) return;
      text("[<]", 2, ROWS - 2, COLOR.hud);
      text("[>]", 9, ROWS - 2, COLOR.hud);
      text("[JUMP]", 58, ROWS - 2, COLOR.hud);
      text("[SWORD]", 70, ROWS - 2, COLOR.hud);
    }

    function draw() {
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const blink = Math.floor(frame / 30) % 2 === 0;

      if (state === "title") {
        block(TITLE_LOGO, 4, COLOR.title);
        block(TITLE_CASTLE, 12, COLOR.wall);
        sprite(HERO.idle, 15, 16, COLOR.hero);
        put(18, 16, "|", COLOR.sword);
        put(18, 17, "+", COLOR.sword);
        center("A castle full of monsters. One sword.", 21, COLOR.text);
        center("ARROWS / A D  move      UP / SPACE  jump      X / J  sword", 23, COLOR.hud);
        center("DOWN  drop through a ledge", 24, COLOR.hud);
        if (blink) center(touchUI ? "TAP TO START" : "PRESS ENTER", 27, COLOR.title);
        return;
      }

      if (state === "win") {
        block(TITLE_LOGO, 4, COLOR.title);
        center("THE CASTLE IS YOURS", 12, COLOR.coin);
        sprite(HERO.jump, 38, 15, COLOR.hero);
        put(41, 14, "|", COLOR.sword);
        put(41, 15, "+", COLOR.sword);
        center("FINAL SCORE  " + String(score).padStart(5, "0"), 20, COLOR.text);
        if (blink) center(touchUI ? "TAP TO PLAY AGAIN" : "PRESS ENTER TO PLAY AGAIN", 24, COLOR.title);
        return;
      }

      const cam = Math.round(camX);
      drawRoom(cam);
      for (const e of enemies) drawEnemy(e, cam);
      for (const shot of shots) {
        put(Math.floor(shot.x) - cam, Math.floor(shot.y) + HUD_ROWS, Math.floor(frame / 4) % 2 ? "*" : "o", COLOR.shot);
      }
      drawHero(cam);
      for (const p of particles) {
        text(p.ch, Math.round(p.x) - cam, Math.round(p.y) + HUD_ROWS, p.color);
      }
      drawHud();

      if (state === "play" && stateT < 110) {
        center("- " + level.name + " -", 9, COLOR.title);
      } else if (state === "clear") {
        center("ROOM CLEARED", 12, COLOR.coin);
      } else if (state === "dead") {
        center("YOU DIED", 12, COLOR.heart);
        if (blink && stateT > 40) center(touchUI ? "TAP TO TRY AGAIN" : "PRESS ENTER TO TRY AGAIN", 14, COLOR.text);
      }
      if (state === "play") drawTouchUI();
    }

    // --- Input ---------------------------------------------------------------
    const GAME_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter", "a", "d", "w", "s", "x", "j", "f", "z"];

    function confirm() {
      if (state === "title" || state === "win") newGame();
      else if (state === "dead" && stateT > 40) {
        score = scoreAtRoomStart;
        loadLevel(levelIndex);
      }
    }

    function onKeyDown(e) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (GAME_KEYS.includes(key)) e.preventDefault();
      keys[key] = true;
      if (e.repeat) return;
      if (key === "Enter") confirm();
      if (key === "ArrowUp" || key === "w" || key === " " || key === "z") jumpBuffer = 7;
      if (key === "x" || key === "j" || key === "f") attackQueued = true;
    }
    function onKeyUp(e) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys[key] = false;
    }

    // Touch: the bottom corners of the screen act as buttons — left/right
    // on the left side, jump and sword on the right. The on-screen labels
    // only appear once a finger has actually been used.
    const pointers = new Map(); // pointerId -> "left" | "right" | "jump" | "sword" | null
    let touchUI = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

    function touched(name) {
      for (const value of pointers.values()) if (value === name) return true;
      return false;
    }
    function zoneFor(e) {
      const rect = canvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      if (fx < 0.14) return "left";
      if (fx < 0.3) return "right";
      if (fx > 0.84) return "sword";
      if (fx > 0.68) return "jump";
      return null;
    }
    function onPointerDown(e) {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      touchUI = true;
      if (state !== "play") {
        confirm();
        return;
      }
      const zone = zoneFor(e);
      pointers.set(e.pointerId, zone);
      if (zone === "jump") jumpBuffer = 7;
      if (zone === "sword") attackQueued = true;
    }
    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      const zone = zoneFor(e);
      // Sliding a thumb between left and right switches direction.
      if (zone === "left" || zone === "right") pointers.set(e.pointerId, zone);
    }
    function onPointerUp(e) {
      pointers.delete(e.pointerId);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    // Same dt-scaling approach as cool-cars.js: every per-frame amount above
    // is "per 1/60s", scaled by how much real time actually passed, so the
    // game runs at the same speed on any refresh rate. Long frames are
    // split into sub-steps of at most one frame's worth so nothing can
    // skip through a one-cell-thick floor.
    const REFERENCE_MS = 1000 / 60;
    let lastTime = null;

    function loop(now) {
      if (!running) return;
      if (lastTime === null) lastTime = now;
      let delta = now - lastTime;
      lastTime = now;
      if (delta > 100) delta = 100; // don't lurch forward after a backgrounded tab
      const dt = delta / REFERENCE_MS;
      const steps = Math.max(1, Math.ceil(dt));
      for (let i = 0; i < steps; i++) update(dt / steps);
      draw();
      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    return {
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        if (audioCtx) audioCtx.close().catch(() => {});
      },
    };
  }

  window.STEGO_GAMES = window.STEGO_GAMES || {};
  window.STEGO_GAMES.tark = {
    title: "Tark",
    start: startTark,
    controlsHint: "Arrow keys / A D to move · Up / Space to jump · X / J to swing · Enter to start",
  };
})();
