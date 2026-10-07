(function () {
  const W = 720;
  const H = 480;
  // The world is drawn on a half-size canvas and scaled up 2x with smoothing
  // off, so everything in it lands on the same chunky pixel grid. All world
  // positions and speeds below are in those half-size "world pixels"; only
  // the HUD and text are drawn at the canvas's full resolution on top.
  const SCALE = 2;
  const VW = W / SCALE;
  const VH = H / SCALE;

  const GROUND_Y = 206;
  // Platforms sit on fixed tiers this far apart. A hop clears about 58, so
  // every tier is comfortably reachable from the one below it.
  const TIER_STEP = 40;
  const PLATFORM_H = 9;
  const NEEDED = 3;

  const WALK_SPEED = 1.9;
  const GRAVITY = 0.27;
  const JUMP_VELOCITY = -5.6;
  const MAX_FALL = 6;

  // Letters come up in a fresh random order each play, so a short session
  // isn't always A-B-C. Set false to walk the alphabet in order instead.
  const SHUFFLE_LETTERS = true;

  // --- pixel art: every sprite is drawn in code, one whole pixel at a time ---

  function inPolygon(points, x, y) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Shape helpers that only ever fill or clear whole pixels (tested at each
  // pixel's center), so nothing comes out anti-aliased. A null color erases.
  function pixelPen(ctx, w, h) {
    function put(x, y, pw, ph, color) {
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, pw, ph);
      } else {
        ctx.clearRect(x, y, pw, ph);
      }
    }
    function each(test, color) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (test(x + 0.5, y + 0.5)) put(x, y, 1, 1, color);
        }
      }
    }
    return {
      r: put,
      d(cx, cy, rad, color) {
        each((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad, color);
      },
      e(cx, cy, rx, ry, color) {
        each((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, color);
      },
      poly(points, color) {
        each((x, y) => inPolygon(points, x, y), color);
      },
      dots(color, points) {
        points.forEach(([x, y]) => put(x, y, 1, 1, color));
      },
    };
  }

  const OUTLINE = [43, 33, 24];

  // Builds a w x h sprite with a one-pixel dark outline traced around it
  // (hence the canvas being 2 bigger each way), which keeps pale things like
  // the egg readable against a pale sky.
  function makeSprite(w, h, draw) {
    const canvas = document.createElement("canvas");
    canvas.width = w + 2;
    canvas.height = h + 2;
    const ctx = canvas.getContext("2d");
    ctx.translate(1, 1);
    draw(pixelPen(ctx, w, h));

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const solid = (x, y) =>
      x >= 0 && y >= 0 && x < canvas.width && y < canvas.height && data[(y * canvas.width + x) * 4 + 3] > 0;
    const edge = [];
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) {
          edge.push((y * canvas.width + x) * 4);
        }
      }
    }
    edge.forEach((i) => {
      data[i] = OUTLINE[0];
      data[i + 1] = OUTLINE[1];
      data[i + 2] = OUTLINE[2];
      data[i + 3] = 255;
    });
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  const RED = "#e63946";
  const ORANGE = "#ff9f1c";
  const YELLOW = "#ffd60a";
  const GREEN = "#4caf50";
  const BLUE = "#3a86ff";
  const PURPLE = "#8e44ad";
  const PINK = "#ff7eb6";
  const BROWN = "#6b4423";
  const WHITE = "#ffffff";
  const BLACK = "#222222";
  const BUN = "#e0a04a";
  const WAFER = "#d9a066";

  // One thing per letter, each drawn on a 16x16 grid. Mostly food — it's a
  // hungry T-Rex — with a few silly ones where a letter has no good snack.
  const ALPHABET = [
    {
      letter: "A",
      name: "Apple",
      draw(p) {
        p.d(8, 9, 6, RED);
        p.r(4, 6, 2, 2, "#ff8a93");
        p.r(7, 1, 1, 3, BROWN);
        p.r(8, 1, 3, 2, GREEN);
      },
    },
    {
      letter: "B",
      name: "Banana",
      draw(p) {
        p.e(8, 5, 7.5, 8.5, YELLOW);
        p.e(8, 2.5, 7.5, 7.5, null);
        p.dots(BROWN, [[0, 5], [15, 5]]);
        p.r(5, 12, 6, 1, "#ffe566");
      },
    },
    {
      letter: "C",
      name: "Carrot",
      draw(p) {
        p.poly([[4, 5], [12, 5], [8, 16]], "#ff8c1a");
        p.r(5, 4, 6, 1, "#ff8c1a");
        p.r(6, 7, 2, 1, "#d96a00");
        p.r(8, 10, 2, 1, "#d96a00");
        p.r(7, 0, 2, 4, GREEN);
        p.r(5, 1, 1, 3, GREEN);
        p.r(10, 1, 1, 3, GREEN);
      },
    },
    {
      letter: "D",
      name: "Donut",
      draw(p) {
        p.d(8, 8, 7, WAFER);
        p.d(8, 8, 5.8, PINK);
        p.d(8, 8, 2, null);
        p.dots(WHITE, [[5, 4], [11, 10]]);
        p.dots(BLUE, [[10, 5], [7, 12]]);
        p.dots(YELLOW, [[4, 9], [8, 3]]);
      },
    },
    {
      letter: "E",
      name: "Egg",
      draw(p) {
        p.e(8, 9, 7.5, 5.5, WHITE);
        p.d(8, 9, 3, "#ffb703");
        p.r(7, 7, 1, 1, "#ffe08a");
      },
    },
    {
      letter: "F",
      name: "Fish",
      draw(p) {
        p.poly([[10, 8], [16, 3], [16, 13]], "#2a7de1");
        p.e(7, 8, 6.5, 4.5, "#4aa3ff");
        p.r(3, 6, 2, 2, WHITE);
        p.r(3, 7, 1, 1, BLACK);
        p.r(7, 8, 3, 1, "#2a7de1");
      },
    },
    {
      letter: "G",
      name: "Grapes",
      draw(p) {
        p.r(7, 0, 1, 3, BROWN);
        p.r(8, 1, 4, 2, GREEN);
        [[4, 6], [8, 6], [12, 6], [6, 10], [10, 10], [8, 13.5]].forEach(([x, y]) => {
          p.d(x, y, 2.6, "#6c3483");
          p.d(x, y, 1.9, PURPLE);
          p.r(Math.floor(x) - 1, Math.floor(y) - 1, 1, 1, "#c39bd3");
        });
      },
    },
    {
      letter: "H",
      name: "Hamburger",
      draw(p) {
        p.e(8, 7, 7.5, 5.5, BUN);
        p.r(0, 7, 16, 9, null);
        p.r(1, 7, 14, 1, GREEN);
        p.r(1, 8, 14, 1, YELLOW);
        p.r(1, 9, 14, 3, "#6b3a1e");
        p.r(1, 12, 14, 1, RED);
        p.r(1, 13, 14, 2, BUN);
        p.r(2, 15, 12, 1, BUN);
        p.dots("#fff3d6", [[5, 3], [9, 2], [11, 4], [7, 5]]);
      },
    },
    {
      letter: "I",
      name: "Ice Cream",
      draw(p) {
        p.poly([[3, 8], [13, 8], [8, 16]], WAFER);
        p.dots("#b07a3c", [[6, 10], [9, 10], [8, 12], [7, 13]]);
        p.d(8, 5.5, 5, "#ff9ecb");
        p.r(3, 7, 10, 2, "#ff9ecb");
        p.r(5, 3, 2, 1, WHITE);
      },
    },
    {
      letter: "J",
      name: "Juice",
      draw(p) {
        p.r(4, 4, 9, 12, ORANGE);
        p.r(4, 4, 9, 2, "#ffc56b");
        p.r(9, 0, 1, 4, WHITE);
        p.r(9, 0, 3, 1, WHITE);
        p.r(5, 8, 7, 5, WHITE);
        p.d(8.5, 10.5, 2, ORANGE);
        p.r(9, 8, 1, 1, GREEN);
      },
    },
    {
      letter: "K",
      name: "Kiwi",
      draw(p) {
        p.d(8, 8, 7, "#8a5a2b");
        p.d(8, 8, 6, "#9bd34a");
        p.d(8, 8, 2, "#f1f7c9");
        p.dots(BLACK, [[7, 4], [8, 11], [4, 8], [11, 7], [5, 5], [10, 5], [5, 10], [10, 10]]);
      },
    },
    {
      letter: "L",
      name: "Lemon",
      draw(p) {
        p.e(8, 8, 6.5, 5, "#ffe14d");
        p.r(0, 7, 2, 2, "#ffe14d");
        p.r(14, 7, 2, 2, "#ffe14d");
        p.r(5, 5, 3, 1, "#fff7b0");
      },
    },
    {
      letter: "M",
      name: "Mushroom",
      draw(p) {
        p.e(8, 8, 7.5, 7, RED);
        p.r(0, 9, 16, 7, null);
        p.r(5, 9, 6, 6, "#f3e9d2");
        p.r(6, 15, 4, 1, "#f3e9d2");
        p.d(5, 5, 1.5, WHITE);
        p.d(10.5, 4.5, 1.5, WHITE);
        p.dots(WHITE, [[8, 7], [2, 7], [13, 7]]);
      },
    },
    {
      letter: "N",
      name: "Nut",
      draw(p) {
        p.e(8, 10, 5, 5.5, "#c68642");
        p.e(8, 5.5, 6.5, 3.5, "#7a4a21");
        p.r(7, 0, 2, 2, "#7a4a21");
        p.dots("#5c3616", [[5, 5], [8, 4], [11, 5], [7, 7], [10, 7]]);
        p.r(6, 11, 1, 2, "#e0a868");
      },
    },
    {
      letter: "O",
      name: "Orange",
      draw(p) {
        p.d(8, 9, 6.5, ORANGE);
        p.r(5, 6, 2, 1, "#ffc56b");
        p.r(7, 1, 1, 2, BROWN);
        p.r(8, 1, 3, 2, GREEN);
      },
    },
    {
      letter: "P",
      name: "Pizza",
      draw(p) {
        p.r(1, 1, 14, 3, "#c98d4b");
        p.poly([[2, 4], [14, 4], [8, 16]], "#ffd166");
        p.d(6, 6.5, 1.6, "#d62828");
        p.d(10.5, 7, 1.6, "#d62828");
        p.d(8, 11, 1.4, "#d62828");
      },
    },
    {
      letter: "Q",
      name: "Quilt",
      draw(p) {
        const patches = [PINK, BLUE, YELLOW, GREEN];
        for (let j = 0; j < 4; j++) {
          for (let i = 0; i < 4; i++) p.r(i * 4, j * 4, 4, 4, patches[(i + 2 * j + (j > 1 ? 1 : 0)) % 4]);
        }
      },
    },
    {
      letter: "R",
      name: "Rainbow",
      draw(p) {
        p.d(8, 12, 8, RED);
        p.d(8, 12, 6.8, ORANGE);
        p.d(8, 12, 5.6, YELLOW);
        p.d(8, 12, 4.4, GREEN);
        p.d(8, 12, 3.2, BLUE);
        p.d(8, 12, 2, null);
        p.r(0, 12, 16, 4, null);
        p.d(2.5, 12, 2.4, WHITE);
        p.d(13.5, 12, 2.4, WHITE);
      },
    },
    {
      letter: "S",
      name: "Strawberry",
      draw(p) {
        p.e(8, 7, 6, 4, RED);
        p.poly([[2, 7], [14, 7], [8, 16]], RED);
        p.r(5, 2, 6, 2, GREEN);
        p.r(7, 0, 2, 2, GREEN);
        p.r(3, 3, 2, 1, GREEN);
        p.r(11, 3, 2, 1, GREEN);
        p.dots(YELLOW, [[5, 7], [8, 6], [11, 7], [6, 10], [10, 10], [8, 9], [8, 12]]);
      },
    },
    {
      letter: "T",
      name: "Taco",
      draw(p) {
        p.d(8, 10.5, 7.5, GREEN);
        p.d(8, 12, 7, "#f4b942");
        p.r(0, 12, 16, 4, null);
        p.dots(RED, [[5, 4], [8, 3], [11, 4], [3, 6], [13, 6]]);
        p.dots("#d99a2b", [[6, 9], [10, 8], [8, 10]]);
      },
    },
    {
      letter: "U",
      name: "Umbrella",
      draw(p) {
        p.d(8, 8, 7.5, RED);
        p.e(8, 8, 2.8, 7.5, WHITE);
        p.r(0, 8, 16, 8, null);
        p.r(8, 8, 1, 7, BROWN);
        p.r(9, 15, 2, 1, BROWN);
        p.r(11, 14, 1, 1, BROWN);
      },
    },
    {
      letter: "V",
      name: "Volcano",
      draw(p) {
        p.poly([[0, 16], [5, 5], [11, 5], [16, 16]], "#7a5c48");
        p.r(5, 5, 6, 2, "#ff4d00");
        p.r(5, 7, 1, 3, "#ff4d00");
        p.r(8, 7, 1, 2, "#ff4d00");
        p.r(10, 7, 1, 4, "#ff4d00");
        p.r(7, 2, 2, 3, "#ffb703");
        p.r(5, 1, 1, 2, "#ff4d00");
        p.r(10, 0, 1, 2, "#ff4d00");
      },
    },
    {
      letter: "W",
      name: "Watermelon",
      draw(p) {
        p.d(8, 5, 8, "#2e9e4f");
        p.d(8, 5, 6.8, "#f1f7c9");
        p.d(8, 5, 6, "#ff4d6d");
        p.r(0, 0, 16, 5, null);
        p.dots(BLACK, [[5, 7], [8, 8], [11, 7], [7, 10], [10, 9]]);
      },
    },
    {
      letter: "X",
      name: "Xylophone",
      draw(p) {
        p.r(0, 5, 16, 1, "#b0b0b0");
        p.r(0, 10, 16, 1, "#b0b0b0");
        [RED, ORANGE, YELLOW, GREEN, BLUE].forEach((color, i) => {
          const barH = 14 - i * 2;
          p.r(1 + i * 3, (16 - barH) / 2, 2, barH, color);
        });
      },
    },
    {
      letter: "Y",
      name: "Yo-yo",
      draw(p) {
        p.r(8, 0, 1, 5, WHITE);
        p.r(7, 0, 3, 1, WHITE);
        p.d(8, 10, 5.5, BLUE);
        p.d(8, 10, 3.5, "#6fa8ff");
        p.d(8, 10, 1.8, YELLOW);
      },
    },
    {
      letter: "Z",
      name: "Zucchini",
      draw(p) {
        p.poly([[1, 12], [4, 15], [14, 6], [11, 3]], "#3f8f3f");
        p.poly([[3, 12], [4, 13], [12, 6], [11, 5]], "#7cc47c");
        p.r(12, 2, 2, 2, "#8a6d3b");
      },
    },
  ];
  ALPHABET.forEach((entry) => {
    entry.sprite = makeSprite(16, 16, entry.draw);
  });

  // The T-Rex, facing right on a 34x28 grid, feet on the bottom row. The
  // pose only changes the legs; "open" drops the jaw to show the teeth.
  const DINO_W = 34;
  const DINO_H = 28;
  const DINO_GREEN = "#58b947";
  const DINO_DARK = "#2f7d32";
  const DINO_BELLY = "#d9f0a3";

  function drawDinoFrame(p, pose, open) {
    const G = DINO_GREEN;
    // tail
    p.r(4, 12, 5, 6, G);
    p.r(1, 13, 4, 4, G);
    p.r(0, 14, 2, 2, G);
    // legs
    const backUp = pose === "walkB" || pose === "jump";
    const frontUp = pose === "walkA" || pose === "jump";
    if (backUp) {
      p.r(10, 20, 5, 3, G);
      p.r(11, 23, 7, 2, G);
    } else {
      p.r(10, 20, 5, 6, G);
      p.r(10, 26, 7, 2, G);
    }
    if (frontUp) {
      p.r(17, 20, 4, 3, G);
      p.r(18, 23, 6, 2, G);
    } else {
      p.r(17, 20, 4, 6, G);
      p.r(17, 26, 6, 2, G);
    }
    // body and neck
    p.r(8, 10, 14, 11, G);
    p.r(14, 7, 9, 6, G);
    p.r(16, 14, 6, 7, DINO_BELLY);
    // head
    p.r(19, 1, 13, 8, G);
    p.r(31, 1, 1, 1, null);
    p.r(19, 1, 1, 1, null);
    p.r(22, 0, 4, 1, G);
    if (open) {
      p.r(21, 9, 10, 3, "#7a1c1c");
      p.dots(WHITE, [[24, 9], [26, 9], [28, 9], [30, 9], [25, 11], [27, 11], [29, 11]]);
      p.r(21, 11, 3, 1, "#ff7b9c");
      p.r(20, 12, 11, 2, G);
    } else {
      p.r(20, 9, 11, 2, G);
      p.dots(WHITE, [[25, 8], [27, 8], [29, 8]]);
    }
    p.r(23, 3, 3, 3, WHITE);
    p.r(25, 4, 1, 2, BLACK);
    p.r(30, 3, 1, 1, DINO_DARK);
    // tiny arms
    p.r(22, 16, 3, 2, DINO_DARK);
    p.r(25, 17, 1, 1, DINO_DARK);
    // stripes down the back
    p.r(15, 7, 2, 2, DINO_DARK);
    p.r(10, 10, 2, 2, DINO_DARK);
    p.r(6, 12, 2, 2, DINO_DARK);
    p.r(2, 13, 1, 1, DINO_DARK);
  }

  const DINO_FRAMES = {};
  ["idle", "walkA", "walkB", "jump"].forEach((pose) => {
    DINO_FRAMES[pose] = [false, true].map((open) => makeSprite(DINO_W, DINO_H, (p) => drawDinoFrame(p, pose, open)));
  });

  const DECOR = {
    palm: makeSprite(24, 40, (p) => {
      p.r(11, 12, 3, 28, "#8a5a2b");
      for (let y = 16; y < 40; y += 5) p.r(11, y, 3, 1, BROWN);
      p.e(6, 10, 6, 3, "#2e9e4f");
      p.e(18, 10, 6, 3, "#2e9e4f");
      p.e(3, 14, 3, 2, "#2e9e4f");
      p.e(21, 14, 3, 2, "#2e9e4f");
      p.e(12, 6, 5, 4, "#3fb55f");
      p.d(11, 13, 1.5, "#5c3616");
      p.d(14, 13, 1.5, "#5c3616");
    }),
    fern: makeSprite(14, 9, (p) => {
      p.e(3, 5, 3.5, 2, "#2e9e4f");
      p.e(11, 5, 3.5, 2, "#2e9e4f");
      p.e(7, 3, 2, 3, "#3fb55f");
      p.r(6, 5, 2, 4, "#3fb55f");
    }),
    rock: makeSprite(12, 7, (p) => {
      p.e(6, 6, 6, 5, "#9a9a9a");
      p.r(3, 3, 2, 1, "#c4c4c4");
    }),
  };

  // A different sky each level, cycling, so moving on feels like going
  // somewhere new.
  const THEMES = [
    { top: "#6ec6ff", bottom: "#d4f1ff", far: "#9db7d9", near: "#6cc070", sun: "#fff3a0" },
    { top: "#ff9e6d", bottom: "#ffe3b0", far: "#b5838d", near: "#7fb069", sun: "#fff1c1" },
    { top: "#7fdbda", bottom: "#e8fff4", far: "#84a9ac", near: "#58a55c", sun: "#fffbe0" },
    { top: "#a18cd1", bottom: "#fbc2eb", far: "#7d6aa8", near: "#5b9a68", sun: "#ffffff" },
  ];

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixHex(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    return "rgb(" + ca.map((v, i) => Math.round(v + (cb[i] - v) * t)).join(",") + ")";
  }

  // A skyline exactly one screen wide whose two ends meet (every wave fits
  // the width a whole number of times), so it can scroll past forever.
  function makeHills(color, base, waves) {
    const canvas = document.createElement("canvas");
    canvas.width = VW;
    canvas.height = VH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    for (let x = 0; x < VW; x++) {
      let height = base;
      waves.forEach(([cycles, amp, phase]) => {
        height += amp * Math.sin((x / VW) * Math.PI * 2 * cycles + phase);
      });
      ctx.fillRect(x, GROUND_Y - Math.round(height), 1, Math.round(height));
    }
    return canvas;
  }

  THEMES.forEach((theme, i) => {
    theme.farHills = makeHills(theme.far, 62, [[2, 22, i], [5, 9, i * 2.1]]);
    theme.nearHills = makeHills(theme.near, 26, [[3, 10, i * 1.3], [7, 4, i]]);
  });

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }
  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }
  // Cheap repeatable noise from a world position, for ground speckle that
  // stays put as the camera scrolls.
  function hash(n) {
    return (Math.imul(n | 0, 2654435761) >>> 0) >>> 8;
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

  // Lays out one level: a wide strip of solid ground (nowhere to fall, so
  // nothing can go wrong) with little staircases of platforms along it, and
  // three of the letter's item hidden one per third of the strip so finding
  // them means exploring the whole thing.
  function buildLevel(index, entry) {
    const worldW = 1000 + Math.min(index, 5) * 100;
    const platforms = [];
    const maxTiers = index === 0 ? 2 : 3;

    let x = 170;
    while (x < worldW - 170) {
      const tiers = 1 + Math.floor(Math.random() * maxTiers);
      const rising = Math.random() < 0.5;
      const cluster = [];
      let px = x;
      for (let t = 0; t < tiers; t++) {
        const w = Math.round(rand(52, 80));
        cluster.push({ x: Math.round(px), w, y: GROUND_Y - (rising ? t + 1 : tiers - t) * TIER_STEP });
        // Each step starts where the last one ends, give or take — never a
        // gap wider than a hop.
        px += w + rand(-8, 16);
      }
      const last = cluster[cluster.length - 1];
      if (last.x + last.w > worldW - 50) break;
      platforms.push(...cluster);
      x = last.x + last.w + rand(50, 110);
    }

    const spots = platforms.map((p) => ({ x: p.x + p.w / 2, y: p.y, high: true }));
    for (let gx = 150; gx < worldW - 40; gx += rand(60, 100)) {
      spots.push({ x: Math.round(gx), y: GROUND_Y, high: false });
    }

    const items = [];
    const from = 140;
    const span = (worldW - 40 - from) / NEEDED;
    for (let i = 0; i < NEEDED; i++) {
      const inThird = spots.filter((s) => s.x >= from + span * i && s.x < from + span * (i + 1));
      const high = inThird.filter((s) => s.high);
      const low = inThird.filter((s) => !s.high);
      const pool = high.length && (Math.random() < 0.7 || !low.length) ? high : low;
      const spot = pool.length ? pick(pool) : { x: from + span * (i + 0.5), y: GROUND_Y };
      items.push({ x: spot.x, y: spot.y - 13, eaten: false, phase: rand(0, 6) });
    }

    const decor = [];
    for (let dx = 30; dx < worldW; dx += rand(35, 90)) {
      const roll = Math.random();
      decor.push({ x: Math.round(dx), sprite: roll < 0.35 ? DECOR.palm : roll < 0.75 ? DECOR.fern : DECOR.rock });
    }

    return { entry, worldW, platforms, items, decor, theme: THEMES[index % THEMES.length] };
  }

  // --- sound: synthesized live via Web Audio, same tone() idiom as the rest of the site ---
  function makeSound() {
    let ctx = null;
    let master = null;
    let musicBus = null;
    let stopped = false;

    // The roar is the tiger clip Cool Cars already ships, played slow so it
    // drops into dinosaur range, over a synthesized growl. If the clip
    // hasn't loaded (or can't be decoded) the growl alone still roars.
    let roarBytes = null;
    let roarBuffer = null;
    fetch("games/sounds/tiger.mp3")
      .then((response) => response.arrayBuffer())
      .then((bytes) => {
        roarBytes = bytes;
        if (ctx) decodeRoar();
      })
      .catch(() => {});

    function decodeRoar() {
      if (!roarBytes || stopped) return;
      const bytes = roarBytes;
      roarBytes = null;
      // Callback form — older Safari has no promise-returning version.
      ctx.decodeAudioData(
        bytes,
        (buffer) => {
          roarBuffer = buffer;
        },
        () => {}
      );
    }

    function ensureCtx() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.connect(ctx.destination);
        musicBus = ctx.createGain();
        musicBus.gain.value = 1;
        musicBus.connect(master);
        decodeRoar();
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function tone(freq, dur, when, type, peakGain, dest) {
      const c = ensureCtx();
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(gain);
      gain.connect(dest || master);
      osc.start(when);
      osc.stop(when + dur + 0.02);
      return osc;
    }

    let noiseBuffer = null;
    function noise(when, dur, peakGain, filterType, filterHz) {
      const c = ensureCtx();
      if (!noiseBuffer) {
        noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const src = c.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = c.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterHz;
      const gain = c.createGain();
      gain.gain.setValueAtTime(peakGain, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(when);
      src.stop(when + dur + 0.02);
    }

    // --- background music: a plodding little dino march, sequenced live.
    // Kept very quiet so the spoken letters are never fighting it. ---
    const STEP_SEC = 60 / 104 / 2; // eighth notes at 104 bpm
    const BASS = [48, 48, 53, 55]; // C, C, F, G — one bar each
    const MELODY = [
      [72, 0, 76, 0, 79, 76, 72, 0],
      [74, 0, 76, 0, 72, 0, 0, 0],
      [77, 0, 81, 0, 84, 81, 77, 0],
      [79, 0, 77, 0, 74, 0, 71, 0],
    ];
    let musicTimerId = null;
    let nextStep = 0;
    let nextStepTime = 0;

    function midiHz(note) {
      return 440 * Math.pow(2, (note - 69) / 12);
    }
    function scheduleStep(index, when) {
      const bar = Math.floor(index / 8) % BASS.length;
      const step = index % 8;
      if (step % 2 === 0) tone(midiHz(BASS[bar] + (step % 4 === 0 ? 0 : 7)), STEP_SEC * 1.6, when, "triangle", 0.07, musicBus);
      const note = MELODY[bar][step];
      if (note) tone(midiHz(note), STEP_SEC * 0.9, when, "square", 0.022, musicBus);
    }
    function pumpMusic() {
      const c = ensureCtx();
      while (nextStepTime < c.currentTime + 0.3) {
        scheduleStep(nextStep, nextStepTime);
        nextStep++;
        nextStepTime += STEP_SEC;
      }
      musicTimerId = setTimeout(pumpMusic, 100);
    }
    // Timers are throttled in a background tab, which would otherwise let
    // the schedule fall behind and then machine-gun to catch up.
    function onVisibilityChange() {
      if (stopped) return;
      clearTimeout(musicTimerId);
      if (!document.hidden) {
        nextStepTime = ensureCtx().currentTime + 0.05;
        pumpMusic();
      }
    }
    function startMusic() {
      try {
        nextStepTime = ensureCtx().currentTime + 0.1;
        pumpMusic();
        document.addEventListener("visibilitychange", onVisibilityChange);
      } catch (e) {
        // Web Audio unavailable — the game just plays silently.
      }
    }

    // Spoken with the browser's built-in voice, as Lavalamp does, so all 26
    // letters and words are covered without shipping a recording for each.
    let sayTimerId = null;
    function say(text, delayMs) {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
      clearTimeout(sayTimerId);
      sayTimerId = setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        utterance.rate = 0.8;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }, delayMs);
    }

    function roar() {
      const c = ensureCtx();
      const now = c.currentTime;
      const dur = 1.5;

      if (roarBuffer) {
        const src = c.createBufferSource();
        src.buffer = roarBuffer;
        src.playbackRate.value = 0.7;
        const gain = c.createGain();
        gain.gain.setValueAtTime(0.9, now);
        gain.gain.setValueAtTime(0.9, now + 1.3);
        gain.gain.linearRampToValueAtTime(0, now + 1.9);
        src.connect(gain);
        gain.connect(master);
        src.start(now);
        src.stop(now + 2);
      }

      const peak = roarBuffer ? 0.16 : 0.4;
      const amp = c.createGain();
      amp.gain.setValueAtTime(0.0001, now);
      amp.gain.exponentialRampToValueAtTime(peak, now + 0.1);
      amp.gain.setValueAtTime(peak, now + dur * 0.55);
      amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      amp.connect(master);

      // A slow wobble on the volume is what turns a buzz into a growl.
      const wobble = c.createGain();
      wobble.gain.value = 0.7;
      wobble.connect(amp);
      const lfo = c.createOscillator();
      lfo.frequency.setValueAtTime(26, now);
      lfo.frequency.linearRampToValueAtTime(14, now + dur);
      const lfoDepth = c.createGain();
      lfoDepth.gain.value = 0.3;
      lfo.connect(lfoDepth);
      lfoDepth.connect(wobble.gain);
      lfo.start(now);
      lfo.stop(now + dur + 0.05);

      const lowpass = c.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.setValueAtTime(1100, now);
      lowpass.frequency.exponentialRampToValueAtTime(350, now + dur);
      lowpass.connect(wobble);

      const shaper = c.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 3);
      shaper.curve = curve;
      shaper.connect(lowpass);

      [
        [95, 52, "sawtooth"],
        [99, 50, "sawtooth"],
        [48, 30, "square"],
      ].forEach(([from, to, type]) => {
        const osc = c.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(from, now);
        osc.frequency.exponentialRampToValueAtTime(to, now + dur);
        osc.connect(shaper);
        osc.start(now);
        osc.stop(now + dur + 0.05);
      });

      // Step the music back so the roar owns the moment.
      musicBus.gain.cancelScheduledValues(now);
      musicBus.gain.setTargetAtTime(0.3, now, 0.03);
      musicBus.gain.setTargetAtTime(1, now + 1.6, 0.2);
    }

    return {
      startMusic,
      say,
      roar,
      // Already-queued notes would otherwise keep playing after the cartridge
      // is ejected, so fade out and drop the whole context.
      stop() {
        stopped = true;
        clearTimeout(sayTimerId);
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        clearTimeout(musicTimerId);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (!ctx) return;
        const c = ctx;
        master.gain.setTargetAtTime(0, c.currentTime, 0.05);
        setTimeout(() => c.close(), 300);
      },
      hop() {
        const c = ensureCtx();
        const now = c.currentTime;
        const osc = tone(300, 0.14, now, "sine", 0.12);
        osc.frequency.exponentialRampToValueAtTime(560, now + 0.12);
      },
      chomp() {
        const now = ensureCtx().currentTime;
        noise(now, 0.07, 0.35, "lowpass", 1400);
        noise(now + 0.11, 0.09, 0.3, "lowpass", 1000);
      },
      click() {
        tone(520, 0.09, ensureCtx().currentTime, "sine", 0.18);
      },
      fanfare(delaySec) {
        const now = ensureCtx().currentTime + delaySec;
        [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) => tone(f, 0.18, now + i * 0.11, "square", 0.1));
      },
    };
  }

  const ACCENTS = [RED, "#f3722c", "#2e9e4f", BLUE, PURPLE, "#e05299"];
  const FONT = "'Comic Sans MS', 'Chalkboard SE', sans-serif";

  function startDinosaurus(canvas) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const worldCanvas = document.createElement("canvas");
    worldCanvas.width = VW;
    worldCanvas.height = VH;
    const lo = worldCanvas.getContext("2d");
    lo.imageSmoothingEnabled = false;

    const sound = makeSound();

    let running = false;
    let rafId = null;
    let animFrame = 0;

    // title -> intro (the letter card) -> playing -> cheer -> intro ... and
    // "win" once the whole alphabet has been eaten.
    let state = "title";
    let stateT = 0;
    let order = [];
    let levelIndex = 0;
    let level = buildLevel(0, ALPHABET[0]);
    level.platforms = []; // the title screen is just open ground for the dino to hop on
    let eaten = 0;
    let camX = 0;
    let shake = 0;
    let particles = [];
    let floaters = [];
    let uiButtons = [];

    const dino = { x: 60, y: GROUND_Y, vx: 0, vy: 0, facing: 1, onGround: true, coyote: 0, walkPhase: 0, mouth: 0 };

    const keys = {};
    const pointers = new Map(); // pointerId -> "left" | "right" | "jump" | null
    let jumpBuffer = 0;
    // The on-screen buttons only appear for fingers — on first touch, or
    // straight away on a device whose main pointer is a finger.
    let touchUI = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

    function accentFor(entry) {
      return ACCENTS[ALPHABET.indexOf(entry) % ACCENTS.length];
    }

    function sayLetter(entry, delayMs) {
      sound.say(entry.letter + ". " + entry.name + ".", delayMs);
    }

    function startLevel(index) {
      levelIndex = index;
      level = buildLevel(index, ALPHABET[order[index]]);
      eaten = 0;
      particles = [];
      floaters = [];
      Object.assign(dino, { x: 60, y: GROUND_Y, vx: 0, vy: 0, facing: 1, onGround: true, mouth: 0 });
      camX = 0;
      state = "intro";
      stateT = 0;
      sayLetter(level.entry, 350);
    }

    function newGame() {
      order = ALPHABET.map((_, i) => i);
      if (SHUFFLE_LETTERS) {
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
      }
      sound.click();
      startLevel(0);
    }

    function beginPlaying() {
      state = "playing";
      stateT = 0;
    }

    function burst(x, y, colors, count) {
      for (let i = 0; i < count; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(0.6, 2.4);
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1,
          life: rand(22, 44),
          color: pick(colors),
          size: Math.random() < 0.4 ? 2 : 1,
          gravity: 0.08,
        });
      }
    }

    function eat(item) {
      item.eaten = true;
      eaten++;
      dino.mouth = 80;
      shake = 14;
      sound.chomp();
      sound.roar();
      burst(item.x, item.y, [YELLOW, WHITE, accentFor(level.entry)], 22);
      floaters.push({ text: "ROAR!", x: dino.x, y: dino.y - 40, life: 80 });

      if (eaten >= NEEDED) {
        state = "cheer";
        stateT = 0;
        sound.fanfare(1.1);
        sound.say(level.entry.letter + " is for " + level.entry.name + "!", 2100);
      } else {
        // Name it again once the roar has died down.
        sound.say(level.entry.name + "!", 1600);
      }
    }

    function updateDino(dt, left, right) {
      const move = (right ? 1 : 0) - (left ? 1 : 0);
      dino.vx = move * WALK_SPEED;
      if (move) dino.facing = move;
      dino.x = Math.max(12, Math.min(level.worldW - 12, dino.x + dino.vx * dt));

      if (jumpBuffer > 0 && (dino.onGround || dino.coyote > 0)) {
        dino.vy = JUMP_VELOCITY;
        dino.onGround = false;
        dino.coyote = 0;
        jumpBuffer = 0;
        sound.hop();
      }
      jumpBuffer -= dt;

      const wasOnGround = dino.onGround;
      const fallSpeed = dino.vy;
      dino.vy = Math.min(dino.vy + GRAVITY * dt, MAX_FALL);
      const prevY = dino.y;
      dino.y += dino.vy * dt;

      // Platforms only stop a fall, never a rise, so they can be hopped up
      // through from underneath and there's no ceiling to bonk.
      let landed = false;
      if (dino.vy >= 0) {
        if (dino.y >= GROUND_Y) {
          dino.y = GROUND_Y;
          landed = true;
        } else {
          for (const p of level.platforms) {
            if (prevY <= p.y + 0.01 && dino.y >= p.y && dino.x + 7 > p.x && dino.x - 7 < p.x + p.w) {
              dino.y = p.y;
              landed = true;
              break;
            }
          }
        }
      }

      if (landed) {
        if (!wasOnGround && fallSpeed > 2) burst(dino.x, dino.y, ["#e8d8b0", "#c9b48a"], 5);
        dino.vy = 0;
        dino.onGround = true;
        dino.coyote = 6; // a few frames' grace to still hop after walking off an edge
      } else {
        dino.onGround = false;
        dino.coyote -= dt;
      }

      if (dino.onGround && move) dino.walkPhase += dt * 0.16;
      if (dino.mouth > 0) dino.mouth -= dt;
    }

    function update(dt) {
      stateT += dt;
      if (shake > 0) shake -= dt;

      const touched = (name) => [...pointers.values()].includes(name);
      const left = keys.ArrowLeft || keys.a || keys.A || touched("left");
      const right = keys.ArrowRight || keys.d || keys.D || touched("right");

      if (state === "title") {
        // Just showing off: hop on the spot now and then, with a roar face.
        if (dino.onGround && Math.floor(stateT) % 150 > 140) jumpBuffer = 2;
        dino.x = 90; // left of the Play button, so a hop never ducks behind it
        updateDino(dt, false, false);
        dino.mouth = Math.floor(stateT / 90) % 2 ? 1 : 0;
      } else if (state === "intro") {
        updateDino(dt, false, false);
        if (stateT > 240) beginPlaying();
      } else if (state === "playing") {
        updateDino(dt, left, right);
        for (const item of level.items) {
          if (item.eaten) continue;
          const reach = (item.x - dino.x) * dino.facing; // how far in front of the dino
          if (reach > -16 && reach < 22 && item.y > dino.y - 34 && item.y < dino.y + 2) eat(item);
        }
      } else if (state === "cheer") {
        // A victory dance: bounce on the spot under falling confetti.
        if (dino.onGround && stateT > 60) jumpBuffer = 2;
        updateDino(dt, false, false);
        if (Math.random() < 0.5 * dt) {
          particles.push({
            x: camX + rand(0, VW),
            y: -4,
            vx: rand(-0.3, 0.3),
            vy: rand(0.8, 1.6),
            life: 220,
            color: pick(ACCENTS),
            size: 2,
            gravity: 0,
          });
        }
        if (stateT > 270) {
          if (levelIndex + 1 >= order.length) {
            state = "win";
            stateT = 0;
            sound.fanfare(0);
            sound.say("You ate the whole alphabet!", 800);
          } else {
            startLevel(levelIndex + 1);
          }
        }
      } else if (state === "win") {
        if (dino.onGround) jumpBuffer = 2;
        updateDino(dt, false, false);
      }

      // The camera leads a little in the direction the dino is facing.
      const target = state === "title" ? 0 : dino.x - VW * 0.45 + dino.facing * 24;
      const clamped = Math.max(0, Math.min(level.worldW - VW, target));
      camX += (clamped - camX) * Math.min(1, 0.1 * dt);

      particles.forEach((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        p.life -= dt;
      });
      particles = particles.filter((p) => p.life > 0 && p.y < GROUND_Y + 2);
      floaters.forEach((f) => {
        f.y -= 0.35 * dt;
        f.life -= dt;
      });
      floaters = floaters.filter((f) => f.life > 0);
    }

    // --- drawing: the world, in world pixels ---

    function drawBackdrop(cam) {
      const theme = level.theme;
      const bands = 12;
      const bandH = Math.ceil(GROUND_Y / bands);
      for (let i = 0; i < bands; i++) {
        lo.fillStyle = mixHex(theme.top, theme.bottom, i / (bands - 1));
        lo.fillRect(0, i * bandH, VW, bandH);
      }

      const sun = pixelPen(lo, VW, 70);
      lo.fillStyle = theme.sun;
      lo.fillRect(292, 22, 22, 22);
      sun.r(292, 22, 3, 3, mixHex(theme.top, theme.bottom, 0.15));
      sun.r(311, 22, 3, 3, mixHex(theme.top, theme.bottom, 0.15));
      sun.r(292, 41, 3, 3, mixHex(theme.top, theme.bottom, 0.3));
      sun.r(311, 41, 3, 3, mixHex(theme.top, theme.bottom, 0.3));

      // Clouds drift on their own, and slide past a touch as you walk.
      lo.fillStyle = "rgba(255,255,255,0.85)";
      for (let i = 0; i < 4; i++) {
        const span = VW + 60;
        const cx = ((((i * 131 + animFrame * 0.05 - cam * 0.08) % span) + span) % span) - 40;
        const cy = 20 + ((i * 37) % 50);
        lo.fillRect(Math.round(cx), cy, 30, 6);
        lo.fillRect(Math.round(cx) + 6, cy - 4, 16, 4);
        lo.fillRect(Math.round(cx) + 4, cy + 6, 20, 2);
      }

      // Hills further away slide past more slowly.
      [
        [theme.farHills, 0.15],
        [theme.nearHills, 0.4],
      ].forEach(([hills, parallax]) => {
        const offset = -Math.round((cam * parallax) % VW);
        lo.drawImage(hills, offset, 0);
        lo.drawImage(hills, offset + VW, 0);
      });
    }

    function drawGround(cam) {
      lo.fillStyle = "#a8713a";
      lo.fillRect(0, GROUND_Y, VW, VH - GROUND_Y);
      lo.fillStyle = "#5fcf5f";
      lo.fillRect(0, GROUND_Y, VW, 4);
      lo.fillStyle = "#3fa64a";
      lo.fillRect(0, GROUND_Y + 4, VW, 1);
      for (let wx = Math.floor(cam / 6) * 6; wx < cam + VW; wx += 6) {
        const h = hash(wx);
        lo.fillStyle = "#8a5a2b";
        lo.fillRect(wx - cam, GROUND_Y + 8 + (h % 22), 2, 1);
        if (h % 3 === 0) {
          lo.fillStyle = "#5fcf5f";
          lo.fillRect(wx - cam, GROUND_Y - 1, 1, 1);
        }
      }
    }

    function drawPlatform(p, cam) {
      const x = p.x - cam;
      if (x > VW || x + p.w < 0) return;
      lo.fillStyle = "#2b2118";
      lo.fillRect(x + 1, p.y - 1, p.w - 2, PLATFORM_H + 2);
      lo.fillRect(x - 1, p.y + 1, p.w + 2, PLATFORM_H - 2);
      lo.fillStyle = "#a8713a";
      lo.fillRect(x, p.y, p.w, PLATFORM_H);
      lo.fillStyle = "#8a5a2b";
      lo.fillRect(x, p.y + PLATFORM_H - 2, p.w, 2);
      lo.fillStyle = "#5fcf5f";
      lo.fillRect(x, p.y, p.w, 3);
      lo.fillStyle = "#3fa64a";
      for (let gx = 3; gx < p.w - 2; gx += 7) lo.fillRect(x + gx, p.y + 3, 2, 1);
    }

    function drawItems(cam) {
      for (const item of level.items) {
        if (item.eaten) continue;
        const x = Math.round(item.x - cam);
        if (x < -20 || x > VW + 20) continue;
        const y = Math.round(item.y + Math.sin(animFrame * 0.06 + item.phase) * 2);
        lo.drawImage(level.entry.sprite, x - 9, y - 9);
        // A twinkle that hops around the item, so it catches the eye.
        const tick = Math.floor(animFrame / 10 + item.phase) % 6;
        const twinkles = [[-11, -8], [10, -10], [12, 5], [-12, 7]];
        if (tick < 4) {
          const [tx, ty] = twinkles[tick];
          lo.fillStyle = WHITE;
          lo.fillRect(x + tx - 1, y + ty, 3, 1);
          lo.fillRect(x + tx, y + ty - 1, 1, 3);
        }
      }
    }

    function drawDino(cam) {
      const pose = !dino.onGround
        ? "jump"
        : dino.vx !== 0
          ? Math.floor(dino.walkPhase) % 2
            ? "walkA"
            : "walkB"
          : "idle";
      const frame = DINO_FRAMES[pose][dino.mouth > 0 ? 1 : 0];
      lo.save();
      lo.translate(Math.round(dino.x - cam), 0);
      if (dino.facing < 0) lo.scale(-1, 1);
      // The sprite's body, not its nose-to-tail middle, sits over dino.x.
      lo.drawImage(frame, -16, Math.round(dino.y) - (DINO_H + 1));
      lo.restore();
    }

    function drawWorld() {
      const cam = Math.round(camX);
      drawBackdrop(cam);
      for (const d of level.decor) {
        const x = d.x - cam;
        if (x > VW || x + d.sprite.width < 0) continue;
        lo.drawImage(d.sprite, x, GROUND_Y - d.sprite.height + 2);
      }
      drawGround(cam);
      level.platforms.forEach((p) => drawPlatform(p, cam));
      if (state !== "title" && state !== "win") drawItems(cam);
      drawDino(cam);
      particles.forEach((p) => {
        lo.fillStyle = p.color;
        lo.fillRect(Math.round(p.x - cam), Math.round(p.y), p.size, p.size);
      });

      ctx.fillStyle = level.theme.top;
      ctx.fillRect(0, 0, W, H);
      const jolt = shake > 0 ? Math.round(Math.sin(animFrame * 1.9) * Math.min(4, shake * 0.4)) : 0;
      ctx.drawImage(worldCanvas, jolt, 0, W, H);
    }

    // --- drawing: HUD and text, at full canvas resolution ---

    function outlinedText(text, x, y, fill, strokeWidth) {
      ctx.lineJoin = "round";
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = "#2b2118";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    }

    function panel(x, y, w, h, r) {
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = "rgba(255, 250, 235, 0.94)";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#2b2118";
      ctx.stroke();
    }

    function drawIcon(entry, x, y, scale, alpha) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(entry.sprite, x, y, entry.sprite.width * scale, entry.sprite.height * scale);
      ctx.globalAlpha = 1;
    }

    function button(x, y, w, h, action) {
      uiButtons.push({ x, y, w, h, action });
    }

    function drawPlayButton(label, y, action) {
      const w = 230;
      const x = (W - w) / 2;
      const bob = Math.round(Math.sin(animFrame * 0.08) * 3);
      roundRect(ctx, x, y + bob, w, 72, 20);
      ctx.fillStyle = "#3fb55f";
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#2b2118";
      ctx.stroke();
      ctx.font = "bold 36px " + FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = WHITE;
      ctx.fillText(label, W / 2 + 22, y + bob + 38);
      // Drawn rather than typed as a "play" glyph, which not every font has.
      const arrowX = W / 2 + 22 - ctx.measureText(label).width / 2 - 44;
      ctx.beginPath();
      ctx.moveTo(arrowX, y + bob + 20);
      ctx.lineTo(arrowX + 28, y + bob + 36);
      ctx.lineTo(arrowX, y + bob + 52);
      ctx.closePath();
      ctx.fill();
      button(x, y - 6, w, 84, action);
    }

    function drawTitle() {
      ctx.font = "bold 84px " + FONT;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const title = "DINOSAURUS";
      let x = (W - ctx.measureText(title).width) / 2;
      [...title].forEach((ch, i) => {
        const y = 110 + Math.round(Math.sin(animFrame * 0.07 + i * 0.6) * 6);
        outlinedText(ch, x, y, ACCENTS[i % ACCENTS.length], 12);
        x += ctx.measureText(ch).width;
      });

      drawPlayButton("PLAY", 200, newGame);

      ctx.font = "bold 20px " + FONT;
      ctx.textAlign = "center";
      outlinedText("\u2190  \u2192  walk      SPACE  hop", W / 2, 452, WHITE, 5);
    }

    function drawIntroCard() {
      const entry = level.entry;
      const accent = accentFor(entry);
      ctx.fillStyle = "rgba(20, 16, 10, 0.4)";
      ctx.fillRect(0, 0, W, H);

      // Pops in rather than just appearing.
      const pop = Math.min(1, stateT / 14);
      const grow = 1 - Math.pow(1 - pop, 3);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(grow, grow);
      ctx.translate(-W / 2, -H / 2);

      panel(90, 50, 540, 380, 28);

      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = "bold 150px " + FONT;
      outlinedText(entry.letter + entry.letter.toLowerCase(), 245, 185, accent, 10);

      const bob = Math.round(Math.sin(animFrame * 0.08) * 4);
      drawIcon(entry, 400, 96 + bob, 9, 1);

      // The word, with its first letter picked out in the letter's color.
      ctx.font = "bold 64px " + FONT;
      ctx.textAlign = "left";
      const first = entry.name[0];
      const rest = entry.name.slice(1);
      const firstW = ctx.measureText(first).width;
      const wordX = (W - ctx.measureText(entry.name).width) / 2;
      outlinedText(first, wordX, 350, accent, 8);
      ctx.fillStyle = "#2b2118";
      ctx.fillText(rest, wordX + firstW, 350);

      ctx.restore();
      if (stateT > 40) button(0, 0, W, H, beginPlaying);
    }

    function drawHud() {
      const entry = level.entry;
      const accent = accentFor(entry);

      // Left: what we're looking for. Tap it to hear it again.
      ctx.font = "bold 30px " + FONT;
      const wordW = ctx.measureText(entry.name).width;
      const leftW = 62 + 60 + wordW + 22;
      panel(12, 12, leftW, 66, 16);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = "bold 50px " + FONT;
      outlinedText(entry.letter, 44, 47, accent, 6);
      drawIcon(entry, 74, 18, 3, 1);
      ctx.font = "bold 30px " + FONT;
      ctx.textAlign = "left";
      ctx.fillStyle = "#2b2118";
      ctx.fillText(entry.name, 136, 47);
      button(12, 12, leftW, 66, () => sayLetter(entry, 0));

      // Right: three to find, filling in as they're eaten. The panel blinks
      // when play starts so it gets noticed.
      const slotsW = NEEDED * 58 + 14;
      const slotsX = W - 12 - slotsW;
      panel(slotsX, 12, slotsW, 66, 16);
      if (state === "playing" && stateT < 150 && Math.floor(stateT / 15) % 2 === 0) {
        roundRect(ctx, slotsX, 12, slotsW, 66, 16);
        ctx.strokeStyle = YELLOW;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      for (let i = 0; i < NEEDED; i++) drawIcon(entry, slotsX + 9 + i * 58, 18, 3, i < eaten ? 1 : 0.22);
    }

    const TOUCH_BUTTONS = [
      { name: "left", x: 68, y: 408, r: 46, angle: Math.PI },
      { name: "right", x: 186, y: 408, r: 46, angle: 0 },
      { name: "jump", x: 644, y: 404, r: 52, angle: -Math.PI / 2 },
    ];

    function drawTouchButtons() {
      const held = [...pointers.values()];
      TOUCH_BUTTONS.forEach((b) => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = held.includes(b.name) ? "rgba(255, 214, 10, 0.75)" : "rgba(255, 255, 255, 0.5)";
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(43, 33, 24, 0.7)";
        ctx.stroke();
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.beginPath();
        ctx.moveTo(22, 0);
        ctx.lineTo(-14, -22);
        ctx.lineTo(-14, 22);
        ctx.closePath();
        ctx.fillStyle = "rgba(43, 33, 24, 0.75)";
        ctx.fill();
        ctx.restore();
      });
    }

    // Much bigger than the drawn circles, since small fingers aren't precise:
    // the bottom-left corner is split into left/right, the bottom-right is hop.
    function touchButtonAt(p) {
      if (p.y < 290) return null;
      if (p.x < 127) return "left";
      if (p.x < 270) return "right";
      if (p.x > W - 180) return "jump";
      return null;
    }

    function drawFloaters() {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      floaters.forEach((f) => {
        ctx.globalAlpha = Math.min(1, f.life / 20);
        ctx.font = "bold 44px " + FONT;
        outlinedText(f.text, (f.x - camX) * SCALE, f.y * SCALE, "#ffb703", 9);
      });
      ctx.globalAlpha = 1;
    }

    function drawCheer() {
      if (stateT < 70) return;
      const entry = level.entry;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 64px " + FONT;
      const hop = Math.round(Math.abs(Math.sin(animFrame * 0.1)) * -10);
      outlinedText(entry.letter + " is for " + entry.name + "!", W / 2, 170 + hop, accentFor(entry), 12);
    }

    function drawWin() {
      panel(60, 40, 600, 300, 28);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 36px " + FONT;
      outlinedText("You ate the whole alphabet!", W / 2, 84, "#3fb55f", 7);
      ALPHABET.forEach((entry, i) => {
        const col = i % 13;
        const row = Math.floor(i / 13);
        const x = 82 + col * 43;
        const y = 122 + row * 104;
        drawIcon(entry, x, y, 2, 1);
        ctx.font = "bold 26px " + FONT;
        ctx.fillStyle = accentFor(entry);
        ctx.fillText(entry.letter, x + 18, y + 58);
      });
      drawPlayButton("AGAIN", 370, newGame);
    }

    function draw() {
      uiButtons = [];
      drawWorld();
      if (state === "title") {
        drawTitle();
        return;
      }
      if (state === "win") {
        drawWin();
        return;
      }
      drawHud();
      if (state === "playing" && touchUI) drawTouchButtons();
      drawFloaters();
      if (state === "cheer") drawCheer();
      if (state === "intro") drawIntroCard();
    }

    // --- input ---

    function pointFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) * W) / rect.width, y: ((e.clientY - rect.top) * H) / rect.height };
    }

    function onPointerDown(e) {
      e.preventDefault();
      canvas.focus();
      if (e.pointerType === "touch") touchUI = true;
      const p = pointFromEvent(e);

      for (const b of uiButtons) {
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          b.action();
          return;
        }
      }
      if (state !== "playing" || !touchUI) return;

      const name = touchButtonAt(p);
      pointers.set(e.pointerId, name);
      if (name === "jump") jumpBuffer = 8;
      // Keep getting this finger's moves even if it slides off the canvas.
      if (canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (err) {
          // Pointer already gone — nothing to capture.
        }
      }
    }

    function onPointerMove(e) {
      if (pointers.has(e.pointerId)) {
        // A held finger can slide between left and right without lifting.
        const name = touchButtonAt(pointFromEvent(e));
        if (name === "jump" && pointers.get(e.pointerId) !== "jump") jumpBuffer = 8;
        pointers.set(e.pointerId, name);
        return;
      }
      const p = pointFromEvent(e);
      canvas.style.cursor = uiButtons.some((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
        ? "pointer"
        : "default";
    }

    function onPointerUp(e) {
      pointers.delete(e.pointerId);
    }

    const JUMP_KEYS = [" ", "ArrowUp", "w", "W"];

    function onKeyDown(e) {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
        e.preventDefault(); // arrows/space would otherwise scroll the page
      }
      keys[e.key] = true;
      if (e.repeat) return;
      const go = JUMP_KEYS.includes(e.key) || e.key === "Enter";
      if (!go) return;
      if (state === "title" || (state === "win" && stateT > 60)) newGame();
      else if (state === "intro" && stateT > 40) beginPlaying();
      else if (state === "playing" && e.key !== "Enter") jumpBuffer = 8;
    }
    function onKeyUp(e) {
      keys[e.key] = false;
    }

    const previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = "none"; // or dragging on the buttons scrolls the page
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

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
    // Music from the title screen on. Inserting the cartridge was a click or
    // drag, which is normally all a browser needs to allow audio.
    sound.startMusic();

    return {
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        sound.stop();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        canvas.style.touchAction = previousTouchAction;
        canvas.style.cursor = "default";
      },
    };
  }

  window.STEGO_GAMES = window.STEGO_GAMES || {};
  window.STEGO_GAMES.dinosaurus = {
    title: "Dinosaurus",
    start: startDinosaurus,
    controlsHint: "Arrow keys to walk, Space to hop — find and eat three of each letter's snack",
  };
})();
