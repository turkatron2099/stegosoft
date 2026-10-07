// Space Force — a hand port of a GameMaker: Studio 1.4 game to the browser.
//
// The original was only available as a compiled Windows build, so this was
// rebuilt from its decompiled data: the room layouts, sprites and sounds are
// the game's own, and each object's events below are transcribed from its
// GML. A small engine underneath reproduces the parts of GameMaker's step
// that the game relies on (event order, speed/direction motion, alarms,
// bounding-box collisions, solid walls, views).
(function () {
  const ASSET = "games/space-force/";

  // --- data lifted from the original ---------------------------------------

  // Bounding boxes are [left, top, right, bottom] in sprite pixels, inclusive,
  // exactly as GameMaker stored them.
  const SPRITES = {
    spr_player: { w: 32, h: 32, ox: 16, oy: 16, bbox: [0, 0, 31, 31] },
    spr_bullet: { w: 4, h: 4, ox: 2, oy: 2, bbox: [0, 0, 3, 3] },
    spr_enemybullet: { w: 32, h: 32, ox: 16, oy: 16, bbox: [0, 3, 31, 30] },
    spr_asteroid: { w: 32, h: 32, ox: 32, oy: 32, bbox: [0, 0, 31, 31] },
    spr_astroid_s: { w: 32, h: 32, ox: 9, oy: 9, bbox: [0, 0, 31, 31] },
    spr_wall: { w: 32, h: 32, ox: 16, oy: 16, bbox: [0, 0, 31, 31] },
    spr_portal: { w: 32, h: 32, ox: 16, oy: 16, bbox: [0, 0, 31, 31] },
    spr_boss: { w: 64, h: 64, ox: 32, oy: 32, bbox: [0, 19, 63, 42] },
    spr_firewall: { w: 32, h: 32, ox: 0, oy: 0, bbox: [0, 0, 31, 31] },
    // Fully transparent in the original: an invisible barrier, so no image.
    spr_stopfirewall: { w: 32, h: 32, ox: 16, oy: 16, bbox: [0, 0, 31, 31], blank: true },
    spr_menu1: { w: 282, h: 256, ox: 0, oy: 0, bbox: [0, 0, 281, 255] },
    spr_menu2: { w: 282, h: 257, ox: 0, oy: 0, bbox: [0, 0, 281, 256] },
  };
  const BACKGROUNDS = ["bg_space", "bg_gameover", "bg_win"];
  // Two images that aren't the original game's as shipped. The title's
  // lettering, cut out of its old purple background so it can sit on the
  // same starfield as the splash (the offset is where it sat in that
  // background); and the Thagobyte logo in its Virtual Boy skin, as
  // hero-logo.js draws it, shown on the splash screen.
  const EXTRAS = ["title_words", "thagobyte_vb"];
  const TITLE_WORDS_X = 68;
  const TITLE_WORDS_Y = 229;
  const SPLASH_LOGO_H = 400;
  const SOUNDS = [
    "snd_shoot",
    "snd_explode",
    "snd_musictitle",
    "snd_musicgame1",
    "snd_redemption",
    "snd_hall1",
    "snd_portal",
    "snd_timeout",
    "snd_hellocommander",
  ];

  const OBJECTS = {
    obj_player: { sprite: "spr_player" },
    obj_bullet: { sprite: "spr_bullet" },
    obj_enemybullet: { sprite: "spr_enemybullet" },
    obj_asteroid: { sprite: "spr_asteroid" },
    obj_asteroid_s: { sprite: "spr_astroid_s", parent: "obj_asteroid" },
    obj_score: {},
    obj_score2: {},
    obj_wall: { sprite: "spr_wall", solid: true },
    obj_startgame: {},
    obj_cup: { sprite: "spr_portal" },
    obj_portal: { sprite: "spr_portal" },
    obj_sidescroll: {},
    obj_boss: { sprite: "spr_boss" },
    obj_noboss: {},
    obj_firewall: { sprite: "spr_firewall" },
    obj_redemptionalarm: {},
    obj_musichall1: {},
    obj_musictitle: {},
    obj_musicgame1: {},
    obj_musicredemption: {},
    obj_stopfirewall: { sprite: "spr_stopfirewall" },
    obj_nextroom: {},
    obj_splash: {},
    obj_menu1: { sprite: "spr_menu1" },
    obj_menu2: { sprite: "spr_menu2" },
    obj_timer: {},
    obj_hellocommander: {},
  };

  // Room layouts. `inst` entries are [object, x, y, xscale?, yscale?];
  // walls / firewalls / stops are flat x,y lists of those three objects,
  // which make up most of every room.
  const ROOMS = {
    rm_splash: {
      w: 1024, h: 768, speed: 30, color: "#c0c0c0", bg: "bg_space", stretch: false,
      view: null,
      inst: [["obj_splash", 288, 224], ["obj_hellocommander", 32, 64]],
      walls: [],
      firewalls: [],
      stops: [],
    },
    rm_0: {
      w: 1024, h: 768, speed: 30, color: "#c0c0c0", bg: "bg_space", stretch: false,
      view: null,
      inst: [["obj_startgame", 96, 96], ["obj_musictitle", 320, 128]],
      walls: [],
      firewalls: [],
      stops: [],
    },
    rm_menu: {
      w: 1024, h: 768, speed: 30, color: "#c0c0c0", bg: "bg_space", stretch: false,
      view: null,
      inst: [["obj_menu1", 128, 160, 0.79432625, 0.75], ["obj_menu2", 416, 160, 0.79432625, 0.75], ["obj_menu2", 128, 416, 0.79432625, 0.75], ["obj_menu2", 704, 160, 0.79432625, 0.75], ["obj_menu2", 416, 416, 0.79432625, 0.75], ["obj_menu2", 704, 416, 0.79432625, 0.75], ["obj_score", 64, 64]],
      walls: [],
      firewalls: [],
      stops: [],
    },
    rm_game1: {
      w: 1024, h: 768, speed: 60, color: "#000000", bg: "bg_space", stretch: false,
      view: null,
      inst: [["obj_player", 288, 416], ["obj_asteroid", 448, 160], ["obj_asteroid", 608, 352], ["obj_asteroid", 544, 480], ["obj_asteroid", 160, 256], ["obj_asteroid", 832, 640], ["obj_asteroid", 288, 640], ["obj_asteroid", 896, 128], ["obj_musicgame1", 352, 288], ["obj_nextroom", 192, 288], ["obj_score2", 64, 64], ["obj_timer", 64, 128]],
      walls: [960,32,896,32,864,32,832,32,800,32,768,32,736,32,704,32,672,32,640,32,608,32,544,32,576,32,512,32,480,32,448,32,416,32,384,32,320,32,352,32,288,32,224,32,256,32,192,32,160,32,128,32,96,32,64,32,32,32,32,736,64,736,96,736,128,736,160,736,192,736,224,736,256,736,288,736,320,736,352,736,384,736,416,736,448,736,480,736,512,736,544,736,576,736,640,736,608,736,672,736,704,736,736,736,768,736,800,736,832,736,864,736,896,736,928,736,960,736,992,736,992,32,928,32,32,96,32,64,32,128,32,160,32,192,32,224,32,256,32,288,32,320,32,352,32,384,32,448,32,416,32,480,32,512,32,544,32,576,32,608,32,640,32,672,32,704,992,64,992,96,992,128,992,160,992,192,992,224,992,256,992,288,992,320,992,352,992,384,992,416,992,448,992,480,992,512,992,544,992,576,992,608,992,640,992,672,992,704,704,448,704,480,704,512,704,544,288,224,288,128,288,160,288,192],
      firewalls: [],
      stops: [],
    },
    rm_redemption: {
      w: 1024, h: 768, speed: 60, color: "#c0c0c0", bg: "bg_space", stretch: false,
      view: null,
      inst: [["obj_cup", 480, 352, 2.0, 2.0], ["obj_player", 96, 128], ["obj_redemptionalarm", 352, 320], ["obj_musicredemption", 352, 96]],
      walls: [32,0,64,0,96,0,128,0,160,0,192,0,224,0,256,0,288,0,320,0,352,0,384,0,416,0,448,0,480,0,512,0,544,0,576,0,608,0,640,0,704,0,672,0,736,0,768,0,800,0,832,0,864,0,896,0,928,0,960,0,992,0,992,32,992,64,992,96,992,128,992,160,992,192,992,256,992,224,992,288,992,352,992,320,992,384,992,448,992,416,992,480,992,512,992,544,992,576,992,608,992,640,992,672,992,704,992,736,960,736,928,736,864,736,896,736,832,736,800,736,768,736,736,736,704,736,672,736,640,736,576,736,608,736,544,736,512,736,448,736,480,736,416,736,352,736,384,736,288,736,320,736,256,736,224,736,192,736,160,736,128,736,96,736,64,736,32,736,32,704,32,672,32,640,32,608,32,576,32,544,32,512,32,480,32,448,32,416,32,384,32,352,32,320,32,288,32,256,32,224,32,160,32,128,32,192,32,96,32,64,32,32],
      firewalls: [],
      stops: [],
    },
    rm_hall1: {
      w: 3000, h: 768, speed: 60, color: "#000000", bg: "bg_space", stretch: true,
      view: {"w": 1024, "h": 768, "bx": 32, "by": 32, "follow": "obj_sidescroll"},
      inst: [["obj_player", 256, 320], ["obj_portal", 2912, 224, 2.0, 2.0], ["obj_asteroid", 672, 448], ["obj_asteroid", 1184, 256], ["obj_asteroid", 2016, 448], ["obj_asteroid", 2208, 608], ["obj_sidescroll", 1056, 224], ["obj_musichall1", 192, 224]],
      walls: [64,160,32,160,128,160,96,160,160,160,192,160,224,160,256,160,320,160,288,160,384,160,352,160,416,160,448,160,480,160,512,160,576,160,544,160,608,160,640,160,672,160,704,160,736,160,768,160,800,160,896,0,928,0,960,0,992,0,1024,0,1056,0,832,160,864,160,832,192,832,224,864,192,864,224,864,128,864,96,864,64,864,32,1088,0,1120,0,1152,0,1184,0,1216,0,1248,0,1280,0,1312,0,1344,0,1376,0,1408,0,1440,0,1472,0,1536,0,1504,0,1568,0,1600,0,1632,0,1664,0,1696,0,1728,0,1760,0,1792,256,1824,256,1856,256,1888,256,1984,256,2496,0,2528,0,2560,0,2624,0,2592,0,2656,0,2688,0,2720,0,2752,0,2784,0,2848,0,2816,0,2880,0,2912,0,2944,0,2976,0,2976,32,2976,64,2976,96,2976,128,2976,192,2976,160,2976,224,2976,256,2976,288,2976,320,2976,352,2976,384,2976,416,2976,480,2976,448,2944,480,2912,480,2880,480,2848,480,2816,480,2752,480,2784,480,2720,480,2688,480,2624,480,2656,480,2592,480,2560,480,2528,480,2496,480,2464,736,2432,736,2368,736,2400,736,2336,736,2272,736,2240,736,2208,736,2176,736,2144,736,2112,736,2048,736,2080,736,2016,736,1984,736,1952,736,1888,736,1856,736,1792,736,1760,736,1728,480,1696,480,1664,480,1632,480,1568,480,1536,480,1600,480,1504,480,1472,480,1408,480,1440,480,1376,480,1280,480,1344,480,1312,480,1120,480,1184,480,1152,480,1216,480,1248,480,1088,480,1056,480,1024,480,992,480,960,480,896,480,928,480,864,480,832,480,800,480,768,576,736,576,704,576,672,576,640,576,608,576,576,576,544,576,512,576,480,576,448,576,416,576,384,576,352,576,320,576,288,576,256,576,224,576,192,576,160,576,128,576,96,576,64,576,32,576,384,544,384,512,384,448,384,480,384,416,384,384,384,352,416,352,416,384,416,416,416,448,416,480,416,512,416,544,2496,32,2496,64,2496,96,2496,160,2496,128,2496,416,2496,448,768,544,768,512,768,480,1824,736,1920,736,1760,704,1760,672,1760,640,1760,576,1760,608,1760,544,1760,512,1760,480,1920,256,1952,256,2304,736,1792,160,1792,128,1792,96,1792,64,1792,0,1792,32,2016,256,1792,192,1792,224,2048,256,2080,256,2112,256,2144,256,2176,256,2208,256,2240,256,2272,256,2304,256,2336,256,2368,256,2400,256,2496,192,2496,224,2496,256,2432,256,2464,256,2496,384,1408,448,1408,416,1408,384,1408,352,1408,320,1408,256,1408,288,1408,224,1408,192,1440,192,1440,224,1440,256,1440,288,1440,320,1440,352,1440,384,1440,416,1440,448,2144,288,2144,320,2144,384,2144,352,2144,416,2176,416,2176,384,2176,352,2176,320,2176,288,2464,384,2464,416,2464,448,2464,480,2464,512,2464,544,2464,576,2464,608,2464,640,2464,672,2464,704,2144,448,2176,448,2144,480,2176,480,1408,160,1440,160,1760,448,1760,416,1728,416,1728,448,864,256,832,256,832,288,864,288,832,320,864,320,864,0],
      firewalls: [0,192,0,224,0,256,0,288,0,384,0,320,0,352,0,416,0,448,0,480,0,512,0,544,0,608,0,640,0,672,0,704,0,128,0,96,0,64,0,0,0,32,0,160,0,576],
      stops: [2048,0,2048,32,2048,32,2048,64,2048,96,2048,128,2048,160,2048,192,2048,224,2048,256,2048,288,2048,320,2048,352,2048,352,2048,384,2048,416,2048,448,2048,480,2048,512,2048,544,2048,576,2048,608,2048,640,2048,672,2048,704,1824,128,1792,128,1792,160,1856,32,1856,64,1856,96,1856,128,1856,160,1856,192,1856,192,1856,224,1856,288,1856,288,1856,320,1856,352,1856,384,1856,416,1856,448,1856,480,1856,512,1856,544,1856,576,1856,608,1856,640,1856,640,1856,672,1856,704,1856,736,1856,736],
    },
    rm_boss1: {
      w: 1024, h: 768, speed: 60, color: "#000000", bg: "bg_space", stretch: false,
      view: null,
      inst: [["obj_player", 512, 416], ["obj_boss", 608, 128], ["obj_boss", 384, 672], ["obj_noboss", 448, 384], ["obj_musicgame1", 416, 256], ["obj_score2", 256, 288]],
      walls: [352,0,384,0,416,0,448,0,480,0,512,0,544,0,576,0,608,0,672,32,704,64,736,96,768,128,800,160,832,192,640,736,608,736,576,736,512,736,544,736,480,736,448,736,416,736,384,736,352,736,320,736,864,224,896,256,928,288,960,320,992,352,320,32,288,64,256,96,224,128,192,160,160,192,128,224,96,256,64,288,32,320,0,352,992,384,0,384,0,416,992,416,960,448,928,480,896,512,864,544,832,576,800,608,768,640,736,672,704,704,672,736,0,448,32,480,64,512,96,544,128,576,160,608,192,640,224,672,256,704,288,736,640,0],
      firewalls: [],
      stops: [],
    },
    rm_gameover: {
      w: 1024, h: 768, speed: 30, color: "#ff0000", bg: "bg_gameover", stretch: false,
      view: null,
      inst: [["obj_startgame", 96, 256], ["obj_musictitle", 256, 224]],
      walls: [],
      firewalls: [],
      stops: [],
    },
    rm_win: {
      w: 1024, h: 768, speed: 30, color: "#00ff00", bg: "bg_win", stretch: false,
      view: null,
      inst: [["obj_startgame", 320, 352], ["obj_musictitle", 160, 288]],
      walls: [],
      firewalls: [],
      stops: [],
    },
  };
  const FIRST_ROOM = "rm_splash";

  // GameMaker virtual key codes the game listens for, by KeyboardEvent.code.
  // WASD is an addition alongside the original arrow keys.
  const VK = {
    ArrowLeft: 37,
    KeyA: 37,
    ArrowUp: 38,
    KeyW: 38,
    ArrowRight: 39,
    KeyD: 39,
    Space: 32,
    Enter: 13,
    NumpadEnter: 13,
    KeyR: 82,
  };

  const DEG = Math.PI / 180;

  // Images and sounds are shared across inserts of the cartridge.
  const IMAGES = {};
  [...Object.keys(SPRITES).filter((n) => !SPRITES[n].blank).map((n) => [n, n + ".png"]), ...BACKGROUNDS.map((n) => [n, n + ".jpg"]), ...EXTRAS.map((n) => [n, n + ".png"])].forEach(
    ([name, file]) => {
      IMAGES[name] = new Image();
      IMAGES[name].src = ASSET + file;
    }
  );
  const AUDIO = {};
  SOUNDS.forEach((name) => {
    AUDIO[name] = new Audio(ASSET + name + ".mp3");
    AUDIO[name].preload = "auto";
  });

  function startSpaceForce(canvas) {
    // The console's screen is 720x480 (3:2) and the game is 1024x768 (4:3),
    // so the game is scaled to the full height and centered, with black bars
    // either side.
    const W = 720;
    const H = 480;
    const RENDER_SCALE = 2;
    const VIEW_W = 1024;
    const VIEW_H = 768;
    const SCALE = H / VIEW_H;
    const OFFSET_X = (W - VIEW_W * SCALE) / 2;
    canvas.width = W * RENDER_SCALE;
    canvas.height = H * RENDER_SCALE;
    const ctx = canvas.getContext("2d");

    // --- sound ---------------------------------------------------------------

    const activeAudio = new Set();
    function audio_play_sound(name, loop) {
      // Loops reuse the one shared element (so they can be stopped by name);
      // one-shots get a clone so the same effect can overlap itself.
      const el = loop ? AUDIO[name] : AUDIO[name].cloneNode();
      el.loop = loop;
      el.currentTime = 0;
      activeAudio.add(el);
      if (!loop) el.addEventListener("ended", () => activeAudio.delete(el));
      el.play().catch(() => {});
    }
    function audio_stop_sound(name) {
      AUDIO[name].pause();
      activeAudio.delete(AUDIO[name]);
    }
    function audio_stop_all() {
      activeAudio.forEach((el) => el.pause());
      activeAudio.clear();
    }

    // --- game state ----------------------------------------------------------

    let roomName = null;
    let room = null;
    let pendingRoom = null;
    let instances = []; // everything except walls and enemy bullets
    let lists = {}; // object name -> its live instances (and its children's)
    let walls = []; // static, so kept out of the per-step loops
    let wallGrid = new Map();
    let enemyBullets = [];
    let enemyGrid = new Map();
    let deadEnemyBullets = 0;
    let viewX = 0;
    let health = 100; // GameMaker's built-in global
    const global = { points: 0, wallhit: 0 };
    const keysDown = new Set();
    let keysPressed = new Set();
    let clicks = [];

    // --- instances and motion -----------------------------------------------

    function isA(objName, ancestor) {
      for (let o = objName; o; o = OBJECTS[o].parent) if (o === ancestor) return true;
      return false;
    }
    // An object's handler for an event, inherited from its parent if it
    // doesn't define its own — GameMaker's parent/child event inheritance.
    function eventOf(objName, kind, key) {
      for (let o = objName; o; o = OBJECTS[o].parent) {
        const ev = EVENTS[o] && EVENTS[o][kind];
        if (ev === undefined) continue;
        if (key === undefined) return ev;
        if (ev[key] !== undefined) return ev[key];
      }
      return undefined;
    }
    // Every collision target an object (or its ancestors) has an event for.
    const collisionTargetsCache = {};
    function collisionTargets(objName) {
      if (!collisionTargetsCache[objName]) {
        const targets = new Set();
        for (let o = objName; o; o = OBJECTS[o].parent) {
          Object.keys((EVENTS[o] && EVENTS[o].collision) || {}).forEach((t) => targets.add(t));
        }
        collisionTargetsCache[objName] = [...targets];
      }
      return collisionTargetsCache[objName];
    }

    function makeInstance(objName, x, y) {
      return {
        obj: objName,
        sprite: SPRITES[OBJECTS[objName].sprite] || null,
        x,
        y,
        xprevious: x,
        yprevious: y,
        speed: 0,
        direction: 0,
        image_angle: 0,
        xscale: 1,
        yscale: 1,
        alarm: {},
        dead: false,
      };
    }
    function addInstance(inst) {
      instances.push(inst);
      for (let o = inst.obj; o; o = OBJECTS[o].parent) (lists[o] = lists[o] || []).push(inst);
    }
    function instance_create(x, y, objName) {
      const inst = makeInstance(objName, x, y);
      if (objName === "obj_enemybullet") {
        enemyBullets.push(inst);
        gridAdd(enemyGrid, inst, shapeOf(inst, x, y));
      } else {
        addInstance(inst);
      }
      const create = eventOf(objName, "create");
      if (create) create(inst);
      return inst;
    }
    function instance_destroy(inst) {
      if (inst.dead) return;
      const destroy = eventOf(inst.obj, "destroy");
      if (destroy) destroy(inst);
      inst.dead = true;
      if (inst.obj === "obj_enemybullet") deadEnemyBullets++;
    }
    function all(objName) {
      return lists[objName] || [];
    }
    function instance_exists(objName) {
      return all(objName).some((i) => !i.dead);
    }
    function first(objName) {
      return all(objName).find((i) => !i.dead);
    }

    function hspeed(inst) {
      return inst.speed * Math.cos(inst.direction * DEG);
    }
    function vspeed(inst) {
      return -inst.speed * Math.sin(inst.direction * DEG);
    }
    function motion_add(inst, dir, amount) {
      const h = hspeed(inst) + amount * Math.cos(dir * DEG);
      const v = vspeed(inst) - amount * Math.sin(dir * DEG);
      inst.speed = Math.hypot(h, v);
      if (inst.speed > 0) inst.direction = Math.atan2(-v, h) / DEG;
    }
    function point_distance(x1, y1, x2, y2) {
      return Math.hypot(x2 - x1, y2 - y1);
    }
    function move_towards_point(inst, x, y, speed) {
      inst.direction = Math.atan2(-(y - inst.y), x - inst.x) / DEG;
      inst.speed = speed;
    }
    function random(n) {
      return Math.random() * n;
    }
    function irandom(n) {
      return Math.floor(Math.random() * (n + 1));
    }
    function room_goto(name) {
      pendingRoom = name;
    }

    // --- collision -----------------------------------------------------------

    // Where an instance's mask would be if it stood at (x, y): its bounding
    // box, plus the rotated rectangle's corners when the sprite is turned
    // (only the player's ever is in a way that matters; bullets are 4px).
    function shapeOf(inst, x, y) {
      const s = inst.sprite;
      if (!s) return null;
      const l = (s.bbox[0] - s.ox) * inst.xscale;
      const r = (s.bbox[2] + 1 - s.ox) * inst.xscale;
      const t = (s.bbox[1] - s.oy) * inst.yscale;
      const b = (s.bbox[3] + 1 - s.oy) * inst.yscale;
      if (inst.image_angle % 360 === 0 || s.w <= 4) return { l: x + l, t: y + t, r: x + r, b: y + b, poly: null };
      const cos = Math.cos(inst.image_angle * DEG);
      const sin = Math.sin(inst.image_angle * DEG);
      const poly = [
        [l, t],
        [r, t],
        [r, b],
        [l, b],
      ].map(([px, py]) => [x + px * cos + py * sin, y - px * sin + py * cos]);
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys), poly };
    }
    function cornersOf(shape) {
      return (
        shape.poly || [
          [shape.l, shape.t],
          [shape.r, shape.t],
          [shape.r, shape.b],
          [shape.l, shape.b],
        ]
      );
    }
    function overlap(a, b) {
      if (!a || !b) return false;
      if (a.l >= b.r || b.l >= a.r || a.t >= b.b || b.t >= a.b) return false;
      if (!a.poly && !b.poly) return true;
      // Separating-axis test for the rotated case.
      const pa = cornersOf(a);
      const pb = cornersOf(b);
      for (const poly of [pa, pb]) {
        for (let i = 0; i < poly.length; i++) {
          const [x1, y1] = poly[i];
          const [x2, y2] = poly[(i + 1) % poly.length];
          const nx = y2 - y1;
          const ny = x1 - x2;
          let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
          for (const [px, py] of pa) {
            const d = px * nx + py * ny;
            if (d < minA) minA = d;
            if (d > maxA) maxA = d;
          }
          for (const [px, py] of pb) {
            const d = px * nx + py * ny;
            if (d < minB) minB = d;
            if (d > maxB) maxB = d;
          }
          if (maxA <= minB || maxB <= minA) return false;
        }
      }
      return true;
    }

    // Walls never move and the boss room fills with thousands of stationary
    // enemy bullets, so both live in coarse grids instead of being compared
    // against everything every step.
    const CELL = 64;
    function gridAdd(grid, inst, shape) {
      inst.shape = shape;
      for (let cx = Math.floor(shape.l / CELL); cx <= Math.floor(shape.r / CELL); cx++) {
        for (let cy = Math.floor(shape.t / CELL); cy <= Math.floor(shape.b / CELL); cy++) {
          const key = cx * 4096 + cy;
          let cell = grid.get(key);
          if (!cell) grid.set(key, (cell = []));
          cell.push(inst);
        }
      }
    }
    function gridQuery(grid, shape) {
      const found = [];
      for (let cx = Math.floor(shape.l / CELL); cx <= Math.floor(shape.r / CELL); cx++) {
        for (let cy = Math.floor(shape.t / CELL); cy <= Math.floor(shape.b / CELL); cy++) {
          const cell = grid.get(cx * 4096 + cy);
          if (!cell) continue;
          for (const inst of cell) {
            if (!inst.dead && !found.includes(inst) && overlap(shape, inst.shape)) found.push(inst);
          }
        }
      }
      return found;
    }
    function touching(inst, x, y, objName) {
      const shape = shapeOf(inst, x, y);
      if (!shape) return [];
      if (objName === "obj_wall") return gridQuery(wallGrid, shape);
      if (objName === "obj_enemybullet") return gridQuery(enemyGrid, shape);
      return all(objName).filter((o) => o !== inst && !o.dead && overlap(shape, shapeOf(o, o.x, o.y)));
    }
    function place_meeting(inst, x, y, objName) {
      return touching(inst, x, y, objName).length > 0;
    }

    // --- the game's own event code, transcribed from its GML -----------------

    // The same bounce is pasted into nearly every wall collision event in the
    // original, always testing against obj_wall.
    function bounceOffWalls(self, reach) {
      if (place_meeting(self, self.x + hspeed(self) + reach, self.y, "obj_wall")) self.direction = -self.direction + 180;
      if (place_meeting(self, self.x, self.y + vspeed(self) + reach, "obj_wall")) self.direction = -self.direction;
    }
    const bounce = (self) => bounceOffWalls(self, 0);
    function hurtPlayer() {
      health -= 1;
      if (health === 0) room_goto("rm_redemption");
    }
    const playMusic = (name) => () => {
      audio_stop_all();
      audio_play_sound(name, true);
    };

    const EVENTS = {
      obj_player: {
        step(self) {
          self.speed = Math.max(self.speed - 0.01, 0);
          if (random(10) >= 8 && roomName === "rm_redemption") {
            self.speed = random(10);
            self.image_angle += 10;
          }
        },
        keyboard: {
          37: (self) => (self.image_angle += 2),
          39: (self) => (self.image_angle -= 2),
          38(self) {
            motion_add(self, self.image_angle, 0.2);
            if (self.speed > 5) self.speed = 5;
          },
        },
        keypress: {
          32(self) {
            global.wallhit = 0;
            const bullet = instance_create(self.x, self.y, "obj_bullet");
            bullet.direction = self.image_angle;
            bullet.image_angle = self.image_angle;
            bullet.speed = 15;
            audio_play_sound("snd_shoot", false);
          },
          82: () => room_goto("rm_0"),
        },
        collision: { obj_wall: bounce },
      },
      obj_bullet: {
        collision: {
          obj_wall(self) {
            bounce(self);
            global.wallhit = 1;
          },
          // A bullet only turns on its owner once any bullet has bounced.
          obj_player(self) {
            if (global.wallhit !== 1) return;
            health -= 1;
            instance_destroy(self);
            if (health === 0) room_goto("rm_redemption");
          },
        },
      },
      obj_enemybullet: {
        collision: {
          obj_player: () => room_goto("rm_redemption"),
          obj_bullet: (self) => instance_destroy(self),
        },
      },
      obj_asteroid: {
        create(self) {
          self.direction = random(360);
          self.speed = 0.5 + random(2);
        },
        destroy(self) {
          instance_create(self.x, self.y, "obj_asteroid_s");
          instance_create(self.x, self.y, "obj_asteroid_s");
          global.points += 50;
          audio_play_sound("snd_explode", false);
        },
        collision: {
          obj_player(self) {
            hurtPlayer();
            instance_destroy(self);
          },
          obj_bullet(self, other) {
            instance_destroy(self);
            instance_destroy(other);
          },
          obj_asteroid: bounce,
          obj_asteroid_s: bounce,
          obj_wall: bounce,
        },
        // action_wrap in both directions.
        outside(self) {
          const s = self.sprite;
          if (hspeed(self) < 0 && self.x < 0) self.x += room.w + s.w;
          if (hspeed(self) > 0 && self.x > room.w) self.x -= room.w + s.w;
          if (vspeed(self) < 0 && self.y < 0) self.y += room.h + s.h;
          if (vspeed(self) > 0 && self.y > room.h) self.y -= room.h + s.h;
        },
      },
      obj_asteroid_s: {
        create(self) {
          self.direction = random(360);
          self.speed = 0.5 + random(2);
          self.alarm[2] = room.speed;
        },
        destroy() {
          global.points += 75;
          audio_play_sound("snd_explode", false);
        },
        // A second after splitting off, each fragment turns on the player.
        alarm: {
          2(self) {
            const player = first("obj_player");
            if (player && point_distance(self.x, self.y, player.x, player.y) > 5) move_towards_point(self, player.x, player.y, 5);
          },
        },
      },
      obj_score: {
        create() {
          global.points = 0;
          health = 7;
        },
      },
      obj_score2: {
        draw() {
          draw_text(64, 64, "Score: " + global.points);
          draw_text(64, 96, "HP: " + health);
        },
      },
      obj_startgame: {
        // Also sits in the game-over and win rooms, whose backgrounds
        // already carry their own text.
        draw() {
          const words = IMAGES.title_words;
          if (roomName === "rm_0" && words.complete && words.naturalWidth) ctx.drawImage(words, TITLE_WORDS_X, TITLE_WORDS_Y);
        },
        keypress: {
          13() {
            audio_stop_sound("snd_musictitle");
            room_goto("rm_menu");
          },
        },
      },
      obj_cup: {
        create: (self) => (self.alarm[1] = 5 * room.speed),
        alarm: {
          1(self) {
            move_random(self, 32, 32);
            self.alarm[1] = 5 * room.speed;
          },
        },
        collision: {
          obj_player() {
            health = 7;
            audio_play_sound("snd_portal", false);
            room_goto("rm_game1");
          },
        },
      },
      obj_portal: {
        collision: {
          obj_player() {
            audio_play_sound("snd_portal", false);
            room_goto("rm_boss1");
          },
        },
      },
      obj_sidescroll: { step: (self) => (self.speed = 3) },
      obj_boss: {
        create: (self) => (self.bosshealth = 6),
        step(self) {
          const player = first("obj_player");
          if (player && point_distance(self.x, self.y, player.x, player.y) > 5) move_towards_point(self, player.x, player.y, 2);
          instance_create(self.x, self.y, "obj_enemybullet");
          if (self.bosshealth === 0) {
            global.points += 1000;
            instance_destroy(self);
          }
        },
        collision: {
          obj_player: () => room_goto("rm_redemption"),
          obj_bullet: (self) => (self.bosshealth -= 1),
          obj_wall: bounce,
        },
      },
      obj_noboss: {
        step() {
          if (!instance_exists("obj_boss")) room_goto("rm_win");
        },
      },
      obj_firewall: {
        step: (self) => (self.speed = 3),
        collision: {
          obj_player: () => room_goto("rm_gameover"),
          obj_stopfirewall: (self) => instance_destroy(self),
        },
      },
      obj_redemptionalarm: {
        create: (self) => (self.alarm[0] = 20 * room.speed),
        alarm: { 0: () => room_goto("rm_gameover") },
      },
      obj_musichall1: { create: playMusic("snd_hall1") },
      obj_musictitle: { create: playMusic("snd_musictitle") },
      obj_musicgame1: { create: playMusic("snd_musicgame1") },
      obj_musicredemption: { create: playMusic("snd_redemption") },
      obj_nextroom: {
        step() {
          if (!instance_exists("obj_asteroid")) room_goto("rm_hall1");
        },
      },
      obj_splash: {
        create: (self) => (self.alarm[4] = 5 * room.speed),
        // The logo's red line art, centered, straight onto the starfield.
        draw() {
          const logo = IMAGES.thagobyte_vb;
          if (!logo.complete || !logo.naturalWidth) return;
          const h = SPLASH_LOGO_H;
          const w = h * (logo.naturalWidth / logo.naturalHeight);
          ctx.drawImage(logo, (room.w - w) / 2, (room.h - h) / 2, w, h);
        },
        alarm: { 4: () => room_goto("rm_0") },
      },
      obj_menu1: { mouse: () => room_goto("rm_game1") },
      obj_timer: {
        create(self) {
          self.alarm[4] = 90 * room.speed;
          self.alarm[5] = 80 * room.speed;
        },
        alarm: {
          4: () => room_goto("rm_redemption"),
          5: () => audio_play_sound("snd_timeout", true),
        },
        draw(self) {
          draw_text(64, 128, "Time: " + self.alarm[4]);
        },
      },
      obj_hellocommander: {
        create() {
          audio_stop_all();
          audio_play_sound("snd_hellocommander", false);
        },
      },
    };

    // Jump to a random spot on a 32px grid that isn't inside a wall.
    function move_random(inst, hsnap, vsnap) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const x = Math.floor(random(room.w) / hsnap) * hsnap;
        const y = Math.floor(random(room.h) / vsnap) * vsnap;
        if (!place_meeting(inst, x, y, "obj_wall")) {
          inst.x = x;
          inst.y = y;
          return;
        }
      }
    }

    // --- rooms ---------------------------------------------------------------

    function enterRoom(name) {
      roomName = name;
      room = ROOMS[name];
      instances = [];
      lists = {};
      walls = [];
      wallGrid = new Map();
      enemyBullets = [];
      enemyGrid = new Map();
      deadEnemyBullets = 0;
      viewX = 0;

      for (let i = 0; i < room.walls.length; i += 2) {
        const wall = makeInstance("obj_wall", room.walls[i], room.walls[i + 1]);
        walls.push(wall);
        gridAdd(wallGrid, wall, shapeOf(wall, wall.x, wall.y));
      }
      // As in GameMaker, every instance exists before any Create event runs.
      const created = [];
      const place = (objName, x, y, xscale = 1, yscale = 1) => {
        const inst = makeInstance(objName, x, y);
        inst.xscale = xscale;
        inst.yscale = yscale;
        addInstance(inst);
        created.push(inst);
      };
      for (let i = 0; i < room.stops.length; i += 2) place("obj_stopfirewall", room.stops[i], room.stops[i + 1]);
      for (let i = 0; i < room.firewalls.length; i += 2) place("obj_firewall", room.firewalls[i], room.firewalls[i + 1]);
      room.inst.forEach((entry) => place(...entry));
      created.forEach((inst) => {
        const create = eventOf(inst.obj, "create");
        if (create) create(inst);
      });
      updateView();
    }

    function updateView() {
      if (!room.view) return;
      const target = first(room.view.follow);
      if (target) {
        if (target.x > viewX + VIEW_W - room.view.bx) viewX = target.x - (VIEW_W - room.view.bx);
        if (target.x < viewX + room.view.bx) viewX = target.x - room.view.bx;
      }
      viewX = Math.max(0, Math.min(room.w - VIEW_W, viewX));
    }

    // --- one step, in GameMaker's event order --------------------------------

    function step() {
      const live = instances.slice();

      // Alarms
      for (const inst of live) {
        if (inst.dead) continue;
        for (const n in inst.alarm) {
          if (inst.alarm[n] > 0 && --inst.alarm[n] === 0) {
            inst.alarm[n] = -1;
            const fn = eventOf(inst.obj, "alarm", n);
            if (fn) fn(inst);
          }
        }
      }

      // Keys held, keys newly pressed, mouse
      for (const inst of live) {
        if (inst.dead) continue;
        keysDown.forEach((code) => {
          const fn = eventOf(inst.obj, "keyboard", code);
          if (fn) fn(inst);
        });
        keysPressed.forEach((code) => {
          const fn = eventOf(inst.obj, "keypress", code);
          if (fn) fn(inst);
        });
        const mouse = eventOf(inst.obj, "mouse");
        if (mouse && clicks.some((p) => overlap({ l: p.x, t: p.y, r: p.x + 1, b: p.y + 1, poly: null }, shapeOf(inst, inst.x, inst.y)))) {
          mouse(inst);
        }
      }
      // The original's level menu is mouse-only; Enter also picks the one
      // unlocked level so the game can be played from the keyboard alone.
      if (roomName === "rm_menu" && keysPressed.has(13)) room_goto("rm_game1");
      keysPressed = new Set();
      clicks = [];

      // Step events
      for (const inst of live) {
        if (inst.dead) continue;
        const fn = eventOf(inst.obj, "step");
        if (fn) fn(inst);
      }

      // Movement, then "outside room"
      for (const inst of instances) {
        if (inst.dead) continue;
        inst.xprevious = inst.x;
        inst.yprevious = inst.y;
        if (inst.speed !== 0) {
          inst.x += hspeed(inst);
          inst.y += vspeed(inst);
        }
        const outside = eventOf(inst.obj, "outside");
        if (outside) {
          const s = shapeOf(inst, inst.x, inst.y);
          if (s.r < 0 || s.l > room.w || s.b < 0 || s.t > room.h) outside(inst);
        }
      }

      // Collisions
      for (const self of instances.slice()) {
        if (self.dead) continue;
        for (const target of collisionTargets(self.obj)) {
          if (self.dead) break;
          const fn = eventOf(self.obj, "collision", target);
          for (const other of touching(self, self.x, self.y, target)) {
            if (self.dead) break;
            if (other.dead) continue;
            if (OBJECTS[other.obj].solid) {
              // Against a solid: step back to where it was, run the event,
              // then carry on along its (possibly new) heading if that's clear.
              self.x = self.xprevious;
              self.y = self.yprevious;
              fn(self, other);
              const nx = self.x + hspeed(self);
              const ny = self.y + vspeed(self);
              if (!place_meeting(self, nx, ny, "obj_wall")) {
                self.x = nx;
                self.y = ny;
              }
            } else {
              fn(self, other);
            }
          }
        }
      }
      // Enemy bullets sit in their own grid, so their two collision events
      // are driven from the other side: by the player and by the player's shots.
      if (enemyBullets.length) {
        for (const objName of ["obj_player", "obj_bullet"]) {
          const fn = EVENTS.obj_enemybullet.collision[objName];
          for (const other of all(objName)) {
            if (other.dead) continue;
            for (const eb of touching(other, other.x, other.y, "obj_enemybullet")) fn(eb, other);
          }
        }
      }

      // Sweep out the dead
      if (instances.some((i) => i.dead)) {
        instances = instances.filter((i) => !i.dead);
        for (const name in lists) lists[name] = lists[name].filter((i) => !i.dead);
      }
      if (deadEnemyBullets > 500) {
        enemyBullets = enemyBullets.filter((i) => !i.dead);
        enemyGrid.forEach((cell, key) => enemyGrid.set(key, cell.filter((i) => !i.dead)));
        deadEnemyBullets = 0;
      }

      updateView();
      if (pendingRoom) {
        const next = pendingRoom;
        pendingRoom = null;
        enterRoom(next);
      }
    }

    // --- drawing -------------------------------------------------------------

    function draw_text(x, y, text) {
      ctx.fillStyle = "#fff";
      ctx.font = "16px Arial, sans-serif"; // GameMaker's default font, 12pt Arial
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(text, x + viewX, y);
    }

    function drawSprite(inst) {
      const s = inst.sprite;
      const img = s && !s.blank && IMAGES[OBJECTS[inst.obj].sprite];
      if (!img || !img.complete || !img.naturalWidth) return;
      if (inst.image_angle === 0 && inst.xscale === 1 && inst.yscale === 1) {
        ctx.drawImage(img, inst.x - s.ox, inst.y - s.oy);
        return;
      }
      ctx.save();
      ctx.translate(inst.x, inst.y);
      ctx.rotate(-inst.image_angle * DEG);
      ctx.scale(inst.xscale, inst.yscale);
      ctx.drawImage(img, -s.ox, -s.oy);
      ctx.restore();
    }

    function draw() {
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.beginPath();
      ctx.rect(OFFSET_X, 0, VIEW_W * SCALE, H);
      ctx.clip();
      ctx.translate(OFFSET_X, 0);
      ctx.scale(SCALE, SCALE);
      ctx.translate(-viewX, 0);

      ctx.fillStyle = room.color;
      ctx.fillRect(viewX, 0, VIEW_W, VIEW_H);
      const bg = IMAGES[room.bg];
      if (bg && bg.complete && bg.naturalWidth) {
        if (room.stretch) ctx.drawImage(bg, 0, 0, room.w, room.h);
        else for (let x = 0; x < room.w; x += bg.naturalWidth) ctx.drawImage(bg, x, 0);
      }

      const visible = (inst) => inst.x > viewX - 80 && inst.x < viewX + VIEW_W + 80;
      for (const wall of walls) if (visible(wall)) drawSprite(wall);
      for (const inst of instances) {
        if (inst.dead) continue;
        const custom = eventOf(inst.obj, "draw");
        if (custom) custom(inst);
        else if (visible(inst) || inst.xscale !== 1) drawSprite(inst);
      }
      // Newer instances draw over older ones in GameMaker, so each boss's
      // trail of shots covers whatever was in the room before it.
      for (const eb of enemyBullets) if (!eb.dead) drawSprite(eb);
      ctx.restore();
    }

    // --- input ---------------------------------------------------------------

    function onKeyDown(e) {
      const code = VK[e.code];
      if (code === undefined) return;
      e.preventDefault();
      if (!keysDown.has(code)) keysPressed.add(code);
      keysDown.add(code);
    }
    function onKeyUp(e) {
      const code = VK[e.code];
      if (code !== undefined) keysDown.delete(code);
    }
    function onBlur() {
      keysDown.clear();
    }
    function onClick(e) {
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      clicks.push({ x: (px - OFFSET_X) / SCALE + viewX, y: py / SCALE });
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("click", onClick);

    // --- main loop -----------------------------------------------------------

    // Rooms run at their own fixed speed (30 or 60 steps a second), whatever
    // the display's refresh rate.
    let running = true;
    let rafId = null;
    let lastTime = null;
    let owed = 0;
    function loop(now) {
      if (!running) return;
      if (lastTime === null) lastTime = now;
      owed += Math.min(now - lastTime, 250);
      lastTime = now;
      let budget = 8; // don't spiral if a frame runs long
      while (owed >= 1000 / room.speed && budget-- > 0) {
        owed -= 1000 / room.speed;
        step();
      }
      if (budget <= 0) owed = 0;
      draw();
      rafId = requestAnimationFrame(loop);
    }

    enterRoom(FIRST_ROOM);
    rafId = requestAnimationFrame(loop);

    return {
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        audio_stop_all();
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
        canvas.removeEventListener("click", onClick);
      },
    };
  }

  window.STEGO_GAMES = window.STEGO_GAMES || {};
  window.STEGO_GAMES.spaceForce = {
    title: "Space Force",
    start: startSpaceForce,
    controlsHint: "Enter to start · ←/→ turn · ↑ thrust · Space to fire · R to restart",
  };
})();
