(function () {
  // Water Cooler Combat — a 32-bit-era 3D fighter about office workers
  // brawling over the last donut (or the last slice of pizza).
  //
  // The look comes from doing it the way a 1996 console did, rather than
  // from a filter on top: the whole scene is software-rasterised into a
  // 360x240 buffer (exactly half the console's 720x480, scaled up with hard
  // pixels), vertices are snapped to whole pixels so models jitter as they
  // move, textures are mapped affinely so the floor swims, and every pixel
  // is ordered-dithered down to 15-bit colour. Fighters are boxes on a
  // 2D skeleton — no art assets, everything is generated here.
  const W = 360;
  const H = 240;
  const CX = W / 2;
  const CY = H / 2;
  const FOCAL = 300;
  const NEAR = 0.35;
  const TAU = Math.PI * 2;

  const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  // Small seeded PRNG so the generated textures are identical every boot.
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- Framebuffer and rasteriser -----------------------------------------
  let fb = null; // Uint32Array view of the canvas ImageData, ABGR
  let zb = null; // 1/z per pixel; bigger is nearer, 0 is "nothing drawn"

  // 4x4 Bayer matrix scaled to 0..7 — one 5-bit colour step.
  const BAYER = [0, 4, 1, 5, 6, 2, 7, 3, 1, 5, 0, 4, 7, 3, 6, 2];
  const lut = new Uint32Array(16);

  // Pixel centres are sampled a hair off the true centre. Vertices sit on
  // whole pixels, so an exact centre can land precisely on an edge shared by
  // two triangles and be drawn by both (visible as a seam in the translucent
  // shadows). The irrational-ish nudge puts every sample strictly on one
  // side without the bookkeeping of a top-left fill rule.
  const D1 = 0.010132;
  const D2 = 0.0027183;

  // mode 0 = opaque, 1 = darken what's there (shadows), 2 = additive (sparks).
  // With a texture, r/g/b are light multipliers in 1/256ths; without one
  // they are the final colour.
  function tri(x0, y0, w0, u0, v0, x1, y1, w1, u1, v1, x2, y2, w2, u2, v2, r, g, b, tex, mode) {
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;
    if (area < 0) {
      let t = x1; x1 = x2; x2 = t;
      t = y1; y1 = y2; y2 = t;
      t = w1; w1 = w2; w2 = t;
      t = u1; u1 = u2; u2 = t;
      t = v1; v1 = v2; v2 = t;
      area = -area;
    }
    let minX = Math.min(x0, x1, x2);
    let maxX = Math.max(x0, x1, x2);
    let minY = Math.min(y0, y1, y2);
    let maxY = Math.max(y0, y1, y2);
    if (minX < 0) minX = 0;
    if (minY < 0) minY = 0;
    if (maxX > W - 1) maxX = W - 1;
    if (maxY > H - 1) maxY = H - 1;
    if (minX > maxX || minY > maxY) return;

    const inv = 1 / area;
    const a0 = y1 - y2, b0 = x2 - x1;
    const a1 = y2 - y0, b1 = x0 - x2;
    const a2 = y0 - y1, b2 = x1 - x0;
    const sx = minX + 0.5 + D1;
    const sy = minY + 0.5 + D2;
    let r0 = b0 * (sy - y1) + a0 * (sx - x1);
    let r1 = b1 * (sy - y2) + a1 * (sx - x2);
    let r2 = b2 * (sy - y0) + a2 * (sx - x0);

    const dwx = (a0 * w0 + a1 * w1 + a2 * w2) * inv;
    const dwy = (b0 * w0 + b1 * w1 + b2 * w2) * inv;
    let wr = (r0 * w0 + r1 * w1 + r2 * w2) * inv;
    let dux = 0, duy = 0, ur = 0, dvx = 0, dvy = 0, vr = 0;
    let td = null, tw = 0, th = 0, mw = 0, mh = 0;
    if (tex) {
      // Deliberately affine: u/v are interpolated straight across the
      // screen with no perspective divide, which is what makes big
      // surfaces warp and swim as the camera moves.
      td = tex.d; tw = tex.w; th = tex.h; mw = tw - 1; mh = th - 1;
      dux = (a0 * u0 + a1 * u1 + a2 * u2) * inv;
      duy = (b0 * u0 + b1 * u1 + b2 * u2) * inv;
      ur = (r0 * u0 + r1 * u1 + r2 * u2) * inv;
      dvx = (a0 * v0 + a1 * v1 + a2 * v2) * inv;
      dvy = (b0 * v0 + b1 * v1 + b2 * v2) * inv;
      vr = (r0 * v0 + r1 * v1 + r2 * v2) * inv;
    } else if (mode === 0) {
      for (let i = 0; i < 16; i++) {
        const d = BAYER[i];
        const rr = r + d > 255 ? 255 : r + d;
        const gg = g + d > 255 ? 255 : g + d;
        const bb = b + d > 255 ? 255 : b + d;
        lut[i] = (0xff000000 | ((bb & 0xf8) << 16) | ((gg & 0xf8) << 8) | (rr & 0xf8)) >>> 0;
      }
    }

    for (let y = minY; y <= maxY; y++) {
      let e0 = r0, e1 = r1, e2 = r2, ww = wr, uu = ur, vv = vr;
      let idx = y * W + minX;
      let inside = false;
      for (let x = minX; x <= maxX; x++, idx++) {
        if (e0 >= 0 && e1 >= 0 && e2 >= 0) {
          inside = true;
          if (ww > zb[idx]) {
            if (tex) {
              const texel = td[(((vv * th) | 0) & mh) * tw + (((uu * tw) | 0) & mw)];
              const d = BAYER[((y & 3) << 2) | (x & 3)];
              let rr = (((texel & 255) * r) >> 8) + d;
              let gg = ((((texel >> 8) & 255) * g) >> 8) + d;
              let bb = ((((texel >> 16) & 255) * b) >> 8) + d;
              if (rr > 255) rr = 255;
              if (gg > 255) gg = 255;
              if (bb > 255) bb = 255;
              fb[idx] = (0xff000000 | ((bb & 0xf8) << 16) | ((gg & 0xf8) << 8) | (rr & 0xf8)) >>> 0;
              zb[idx] = ww;
            } else if (mode === 0) {
              fb[idx] = lut[((y & 3) << 2) | (x & 3)];
              zb[idx] = ww;
            } else if (mode === 1) {
              fb[idx] = (((fb[idx] >>> 1) & 0x7f7f7f) | 0xff000000) >>> 0;
            } else {
              const p = fb[idx];
              let rr = (p & 255) + r;
              let gg = ((p >> 8) & 255) + g;
              let bb = ((p >> 16) & 255) + b;
              if (rr > 255) rr = 255;
              if (gg > 255) gg = 255;
              if (bb > 255) bb = 255;
              fb[idx] = (0xff000000 | (bb << 16) | (gg << 8) | rr) >>> 0;
            }
          }
        } else if (inside) break;
        e0 += a0; e1 += a1; e2 += a2;
        ww += dwx; uu += dux; vv += dvx;
      }
      r0 += b0; r1 += b1; r2 += b2;
      wr += dwy; ur += duy; vr += dvy;
    }
  }

  // --- Camera and geometry ------------------------------------------------
  let cpx = 0, cpy = 1.4, cpz = 5;
  let crx = 1, crz = 0; // right (always level, so no y component)
  let cux = 0, cuy = 1, cuz = 0; // up
  let cfx = 0, cfy = 0, cfz = -1; // forward

  function setCamera(px, py, pz, tx, ty, tz) {
    cpx = px; cpy = py; cpz = pz;
    let fx = tx - px, fy = ty - py, fz = tz - pz;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    crx = rx; crz = rz;
    cux = -rz * fy; cuy = rz * fx - rx * fz; cuz = rx * fy;
    cfx = fx; cfy = fy; cfz = fz;
  }

  // One directional light plus ambient, flat per face.
  const LX = -0.37, LY = 0.78, LZ = 0.5;
  const AMBIENT = 0.6;
  const DIFFUSE = 0.52;
  let dim = 1; // global scene brightness (dropped during a super's freeze)
  let tintR = 0, tintG = 0, tintB = 0; // added to body colours (hit flash)

  const QX = [0, 0, 0, 0];
  const QY = [0, 0, 0, 0];
  const QW = [0, 0, 0, 0];

  function flatQuad(a, b, c, d, r, g, bl, mode) {
    for (let i = 0; i < 4; i++) {
      const p = i === 0 ? a : i === 1 ? b : i === 2 ? c : d;
      const dx = p[0] - cpx, dy = p[1] - cpy, dz = p[2] - cpz;
      const z = dx * cfx + dy * cfy + dz * cfz;
      if (z < NEAR) return;
      const iz = 1 / z;
      // Rounding to whole pixels is the vertex "wobble".
      QX[i] = Math.round(CX + (dx * crx + dz * crz) * FOCAL * iz);
      QY[i] = Math.round(CY - (dx * cux + dy * cuy + dz * cuz) * FOCAL * iz);
      QW[i] = iz;
    }
    tri(QX[0], QY[0], QW[0], 0, 0, QX[1], QY[1], QW[1], 0, 0, QX[2], QY[2], QW[2], 0, 0, r, g, bl, null, mode);
    tri(QX[0], QY[0], QW[0], 0, 0, QX[2], QY[2], QW[2], 0, 0, QX[3], QY[3], QW[3], 0, 0, r, g, bl, null, mode);
  }

  // A lit, back-face-culled quad. `ref` is any point inside the solid the
  // quad belongs to; the normal is flipped to point away from it, so callers
  // never have to care about winding order (which mirroring a fighter would
  // otherwise reverse).
  function shadedQuad(a, b, c, d, col, ref) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = d[0] - a[0], e2y = d[1] - a[1], e2z = d[2] - a[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const mx = (a[0] + c[0]) * 0.5, my = (a[1] + c[1]) * 0.5, mz = (a[2] + c[2]) * 0.5;
    if (nx * (mx - ref[0]) + ny * (my - ref[1]) + nz * (mz - ref[2]) < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    if (nx * (mx - cpx) + ny * (my - cpy) + nz * (mz - cpz) >= 0) return;
    const l = Math.hypot(nx, ny, nz) || 1;
    let i = (nx * LX + ny * LY + nz * LZ) / l;
    i = (AMBIENT + DIFFUSE * (i > 0 ? i : 0)) * dim;
    const r = Math.min(255, col[0] * i + tintR) | 0;
    const g = Math.min(255, col[1] * i + tintG) | 0;
    const bl = Math.min(255, col[2] * i + tintB) | 0;
    flatQuad(a, b, c, d, r, g, bl, 0);
  }

  // Corner i of a box takes its three axes from the bits of i.
  const BOX_FACES = [[0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [0, 1, 3, 2], [4, 5, 7, 6]];
  const boxRef = [0, 0, 0];
  function box(c, col) {
    boxRef[0] = (c[0][0] + c[7][0]) * 0.5;
    boxRef[1] = (c[0][1] + c[7][1]) * 0.5;
    boxRef[2] = (c[0][2] + c[7][2]) * 0.5;
    for (let f = 0; f < 6; f++) {
      const q = BOX_FACES[f];
      shadedQuad(c[q[0]], c[q[1]], c[q[2]], c[q[3]], col, boxRef);
    }
  }

  function abox(x0, y0, z0, x1, y1, z1, col) {
    const c = [];
    for (let i = 0; i < 8; i++) c.push([i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0]);
    box(c, col);
  }

  // A box spun in the fight plane (thrown objects).
  function rbox(x, y, z, ang, len, th, wz, col) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const c = [];
    for (let i = 0; i < 8; i++) {
      const a = (i & 1 ? 0.5 : -0.5) * len;
      const n = (i & 2 ? 0.5 : -0.5) * th;
      c.push([x + dx * a - dy * n, y + dy * a + dx * n, z + (i & 4 ? 0.5 : -0.5) * wz]);
    }
    box(c, col);
  }

  // Large surfaces (floor, walls) are diced into a grid before drawing —
  // affine mapping across one huge quad is unusably warped, and the pieces
  // also need clipping against the near plane where the floor runs under
  // the camera.
  const G = new Float64Array(5 * 600);
  const CV = new Float64Array(5 * 6);

  function projTri(i0, i1, i2, r, g, b, tex, mode) {
    const z0 = CV[i0 + 2], z1 = CV[i1 + 2], z2 = CV[i2 + 2];
    tri(
      Math.round(CX + (CV[i0] * FOCAL) / z0), Math.round(CY - (CV[i0 + 1] * FOCAL) / z0), 1 / z0, CV[i0 + 3], CV[i0 + 4],
      Math.round(CX + (CV[i1] * FOCAL) / z1), Math.round(CY - (CV[i1 + 1] * FOCAL) / z1), 1 / z1, CV[i1 + 3], CV[i1 + 4],
      Math.round(CX + (CV[i2] * FOCAL) / z2), Math.round(CY - (CV[i2 + 1] * FOCAL) / z2), 1 / z2, CV[i2 + 3], CV[i2 + 4],
      r, g, b, tex, mode
    );
  }

  const clipIn = [0, 0, 0];
  function clipTri(ia, ib, ic, r, g, b, tex, mode) {
    const za = G[ia + 2], zbb = G[ib + 2], zc = G[ic + 2];
    if (za < NEAR && zbb < NEAR && zc < NEAR) return;
    clipIn[0] = ia; clipIn[1] = ib; clipIn[2] = ic;
    let n = 0;
    for (let e = 0; e < 3; e++) {
      const A = clipIn[e], B = clipIn[(e + 1) % 3];
      const zA = G[A + 2], zB = G[B + 2];
      const ain = zA >= NEAR, bin = zB >= NEAR;
      if (ain) {
        for (let k = 0; k < 5; k++) CV[n * 5 + k] = G[A + k];
        n++;
      }
      if (ain !== bin) {
        const t = (NEAR - zA) / (zB - zA);
        for (let k = 0; k < 5; k++) CV[n * 5 + k] = G[A + k] + (G[B + k] - G[A + k]) * t;
        n++;
      }
    }
    if (n < 3) return;
    projTri(0, 5, 10, r, g, b, tex, mode);
    if (n > 3) projTri(0, 10, 15, r, g, b, tex, mode);
  }

  // a→b runs along texture u, a→d along v.
  function bigQuad(a, b, c, d, o) {
    const nu = o.nu || 1, nv = o.nv || 1;
    const tex = o.tex || null;
    const lit = (o.lit === undefined ? 1 : o.lit) * dim;
    const col = o.col;
    let r, g, bl;
    if (tex) {
      r = Math.round((col ? col[0] / 255 : 1) * lit * 256);
      g = Math.round((col ? col[1] / 255 : 1) * lit * 256);
      bl = Math.round((col ? col[2] / 255 : 1) * lit * 256);
    } else {
      r = Math.min(255, col[0] * lit) | 0;
      g = Math.min(255, col[1] * lit) | 0;
      bl = Math.min(255, col[2] * lit) | 0;
    }
    const uv = o.uv || [0, 0, 1, 1];
    const n1 = nu + 1;
    let k = 0;
    for (let j = 0; j <= nv; j++) {
      const t = j / nv;
      for (let i = 0; i <= nu; i++) {
        const s = i / nu;
        const x = (a[0] * (1 - s) + b[0] * s) * (1 - t) + (d[0] * (1 - s) + c[0] * s) * t - cpx;
        const y = (a[1] * (1 - s) + b[1] * s) * (1 - t) + (d[1] * (1 - s) + c[1] * s) * t - cpy;
        const z = (a[2] * (1 - s) + b[2] * s) * (1 - t) + (d[2] * (1 - s) + c[2] * s) * t - cpz;
        G[k++] = x * crx + z * crz;
        G[k++] = x * cux + y * cuy + z * cuz;
        G[k++] = x * cfx + y * cfy + z * cfz;
        // +64 keeps u/v positive so truncating to a texel never mirrors at 0.
        G[k++] = uv[0] + (uv[2] - uv[0]) * s + 64;
        G[k++] = uv[1] + (uv[3] - uv[1]) * t + 64;
      }
    }
    const mode = o.mode || 0;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const i00 = (j * n1 + i) * 5, i10 = i00 + 5, i01 = i00 + n1 * 5, i11 = i01 + 5;
        clipTri(i00, i10, i11, r, g, bl, tex, mode);
        clipTri(i00, i11, i01, r, g, bl, tex, mode);
      }
    }
  }

  // --- 2D: bitmap font and HUD primitives ---------------------------------
  const FONT = {};
  (function buildFont() {
    const src = {
      A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
      C: "01110 10001 10000 10000 10000 10001 01110", D: "11110 10001 10001 10001 10001 10001 11110",
      E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
      G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
      I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
      K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
      M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001",
      O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
      Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
      S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
      U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
      W: "10001 10001 10001 10101 10101 11011 10001", X: "10001 10001 01010 00100 01010 10001 10001",
      Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
      0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110",
      2: "01110 10001 00001 00010 00100 01000 11111", 3: "11110 00001 00001 01110 00001 00001 11110",
      4: "00010 00110 01010 10010 11111 00010 00010", 5: "11111 10000 11110 00001 00001 10001 01110",
      6: "00110 01000 10000 11110 10001 10001 01110", 7: "11111 00001 00010 00100 01000 01000 01000",
      8: "01110 10001 10001 01110 10001 10001 01110", 9: "01110 10001 10001 01111 00001 00010 01100",
      ".": "00000 00000 00000 00000 00000 01100 01100", ",": "00000 00000 00000 00000 01100 00100 01000",
      "!": "00100 00100 00100 00100 00100 00000 00100", "?": "01110 10001 00001 00010 00100 00000 00100",
      "'": "00100 00100 01000 00000 00000 00000 00000", "-": "00000 00000 00000 11111 00000 00000 00000",
      ":": "00000 01100 01100 00000 01100 01100 00000", "/": "00001 00001 00010 00100 01000 10000 10000",
      "(": "00010 00100 01000 01000 01000 00100 00010", ")": "01000 00100 00010 00010 00010 00100 01000",
      "+": "00000 00100 00100 11111 00100 00100 00000", "<": "00010 00100 01000 10000 01000 00100 00010",
      ">": "01000 00100 00010 00001 00010 00100 01000", "^": "00100 01110 10101 00100 00100 00100 00100",
      "_": "00100 00100 00100 00100 10101 01110 00100", "*": "00000 10101 01110 11111 01110 10101 00000",
      "&": "01100 10010 10100 01000 10101 10010 01101", "%": "11000 11001 00010 00100 01000 10011 00011",
    };
    for (const ch in src) FONT[ch] = src[ch].split(" ").map((row) => parseInt(row, 2));
  })();

  // col is either one colour or an array of seven (one per glyph row, for
  // the gradient-filled logo lettering).
  function blit(buf, bw, bh, str, x, y, col, scale) {
    const grad = typeof col !== "number";
    for (let i = 0; i < str.length; i++, x += 6 * scale) {
      const glyph = FONT[str[i]];
      if (!glyph) continue;
      for (let row = 0; row < 7; row++) {
        const bits = glyph[row];
        if (!bits) continue;
        const c = grad ? col[row] : col;
        for (let cx = 0; cx < 5; cx++) {
          if (!(bits & (16 >> cx))) continue;
          const px0 = x + cx * scale, py0 = y + row * scale;
          for (let yy = py0; yy < py0 + scale; yy++) {
            if (yy < 0 || yy >= bh) continue;
            for (let xx = px0; xx < px0 + scale; xx++) {
              if (xx >= 0 && xx < bw) buf[yy * bw + xx] = c;
            }
          }
        }
      }
    }
  }

  const BLACK = rgb(0, 0, 0);
  const WHITE = rgb(248, 248, 248);
  const YELLOW = rgb(255, 216, 64);
  const ORANGE = rgb(250, 169, 104);
  const RED = rgb(248, 72, 40);
  const CYAN = rgb(120, 220, 232);
  const GRAY = rgb(150, 150, 160);
  const PINK = rgb(255, 130, 180);

  // align: 0 left, 1 centre, 2 right.
  function text(str, x, y, col, scale, align, shadow) {
    scale = scale || 1;
    const w = str.length * 6 * scale - scale;
    if (align === 1) x -= w >> 1;
    else if (align === 2) x -= w;
    if (shadow !== null) blit(fb, W, H, str, x + scale, y + scale, shadow === undefined ? BLACK : shadow, scale);
    blit(fb, W, H, str, x, y, col, scale);
  }

  const FIRE = [rgb(255, 248, 170), rgb(255, 232, 96), rgb(255, 208, 56), rgb(255, 170, 40), rgb(250, 124, 32), rgb(238, 80, 28), rgb(200, 44, 30)];
  const ICE = [rgb(240, 252, 255), rgb(200, 240, 255), rgb(150, 216, 250), rgb(104, 184, 240), rgb(72, 148, 226), rgb(52, 112, 204), rgb(40, 80, 170)];

  // Centred, outlined, gradient-filled lettering for announcements.
  function bigText(str, y, scale, cols, cx) {
    const x = (cx === undefined ? CX : cx) - ((str.length * 6 * scale - scale) >> 1);
    const o = Math.max(1, scale >> 1);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) blit(fb, W, H, str, x + dx * o, y + dy * o, BLACK, scale);
      }
    }
    blit(fb, W, H, str, x + o, y + o * 2, BLACK, scale);
    blit(fb, W, H, str, x, y, cols || FIRE, scale);
  }

  function rect(x, y, w, h, col) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) fb.fill(col, yy * W + x0, yy * W + Math.max(x0, x1));
  }

  function shadeRect(x, y, w, h) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) {
      for (let i = yy * W + x0; i < yy * W + x1; i++) fb[i] = (((fb[i] >>> 1) & 0x7f7f7f) | 0xff000000) >>> 0;
    }
  }

  function ring(cx, cy, rad, col, fill) {
    const r2 = rad * rad, in2 = (rad - 1.6) * (rad - 1.6);
    for (let y = -rad; y <= rad; y++) {
      for (let x = -rad; x <= rad; x++) {
        const d = x * x + y * y;
        const px = cx + x, py = cy + y;
        if (d > r2 || px < 0 || py < 0 || px >= W || py >= H) continue;
        if (d >= in2) fb[py * W + px] = col;
        else if (fill) fb[py * W + px] = (((fb[py * W + px] >>> 1) & 0x7f7f7f) | 0xff000000) >>> 0;
      }
    }
  }

  // --- Textures -----------------------------------------------------------
  function makeTex(w, h, fn) {
    const d = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = fn(x, y);
    return { d, w, h };
  }

  const TEX = (function buildTextures() {
    const rnd = mulberry(1997);
    const n = (amp) => (rnd() - 0.5) * amp;
    const c3 = (r, g, b, a) => {
      const k = a || 0;
      return rgb(clamp(r + k, 0, 255) | 0, clamp(g + k, 0, 255) | 0, clamp(b + k, 0, 255) | 0);
    };
    const T = {};
    T.carpet = makeTex(32, 32, (x, y) => (x === 0 || y === 0 ? c3(52, 62, 88, n(8)) : c3(74, 88, 122, n(26))));
    T.lino = makeTex(32, 32, (x, y) => ((x >> 4) ^ (y >> 4) ? c3(216, 208, 186, n(10)) : c3(142, 168, 160, n(10))));
    T.wood = makeTex(32, 32, (x, y) => (x % 8 === 0 ? c3(84, 52, 30, n(8)) : c3(150 + ((x >> 3) & 1) * 14, 98, 56, n(18) + Math.sin(y * 0.9 + x) * 5)));
    T.wall = makeTex(32, 32, (x, y) => (y >= 30 ? c3(104, 92, 78) : y === 20 ? c3(168, 158, 138) : c3(206, 196, 170, n(8))));
    T.wallGray = makeTex(32, 32, (x, y) => (y >= 30 ? c3(70, 74, 84) : c3(176, 182, 190, n(8))));
    T.panel = makeTex(32, 32, (x, y) => (x % 16 === 0 || y >= 30 ? c3(60, 36, 22) : c3(122, 76, 44, n(12) + (y < 2 ? 20 : 0))));
    T.ceil = makeTex(32, 32, (x, y) => {
      if (x > 8 && x < 24 && y > 10 && y < 22) return c3(255, 255, 236);
      return x === 0 || y === 0 ? c3(150, 150, 146) : c3(222, 222, 210, n(10));
    });
    T.cubicle = makeTex(32, 32, (x, y) => (y < 3 || x === 0 ? c3(88, 92, 100) : c3(128, 144, 164, n(22))));

    function skyline(night) {
      const heights = [];
      for (let i = 0; i < 8; i++) heights.push(18 + ((rnd() * 30) | 0));
      const lit = [];
      for (let i = 0; i < 64 * 64; i++) lit.push(rnd());
      return makeTex(64, 64, (x, y) => {
        if (x < 3 || x > 60 || y < 3 || y > 60 || x === 31 || x === 32 || y === 30) return c3(196, 196, 200);
        const top = 64 - heights[x >> 3];
        if (y >= top) {
          const win = x % 4 === 1 && y % 4 === 1;
          if (night) return win && lit[y * 64 + x] > 0.45 ? c3(255, 220, 110) : c3(26 + (x >> 3) * 3, 28, 52);
          return win ? c3(170, 200, 220) : c3(96 + (x >> 3) * 6, 112, 136);
        }
        if (night) return (x - 46) * (x - 46) + (y - 14) * (y - 14) < 30 ? c3(250, 244, 210) : c3(14, 18, 52 + y);
        return c3(100 + y * 2, 170 + y, 240);
      });
    }
    T.winDay = skyline(false);
    T.winNight = skyline(true);

    T.vend = makeTex(32, 64, (x, y) => {
      if (x < 2 || x > 29 || y < 2 || y > 61) return c3(96, 20, 26);
      if (x > 23) return y > 20 && y < 26 ? c3(30, 30, 34) : y > 28 && y < 31 ? c3(230, 220, 90) : c3(150, 30, 38);
      if (y < 42) {
        if (y % 8 === 7) return c3(60, 64, 70);
        const item = ((x >> 2) + (y >> 3) * 3) % 5;
        return x % 4 === 3 ? c3(18, 22, 30) : [c3(236, 96, 60), c3(250, 210, 70), c3(90, 190, 110), c3(110, 150, 240), c3(240, 130, 200)][item];
      }
      return y > 48 && y < 58 ? c3(24, 24, 28) : c3(150, 30, 38);
    });

    function poster(word, bg1, bg2) {
      const t = makeTex(64, 64, (x, y) => {
        if (x < 2 || x > 61 || y < 2 || y > 61) return c3(28, 28, 32);
        if (y > 44) return c3(20, 20, 26);
        const peak = 40 - Math.max(0, 22 - Math.abs(x - 32)) * 1.1;
        if (y > peak) return y < peak + 5 ? c3(244, 244, 250) : c3(70, 84, 104);
        return c3(lerp(bg1[0], bg2[0], y / 44), lerp(bg1[1], bg2[1], y / 44), lerp(bg1[2], bg2[2], y / 44));
      });
      blit(t.d, 64, 64, word, 32 - ((word.length * 6 - 1) >> 1), 50, WHITE, 1);
      return t;
    }
    T.poster1 = poster("SYNERGY", [40, 70, 160], [250, 170, 110]);
    T.poster2 = poster("TEAMWORK", [30, 120, 130], [240, 230, 160]);

    T.chart = makeTex(64, 64, (x, y) => {
      if (x < 2 || x > 61 || y < 2 || y > 61) return c3(60, 60, 66);
      if (x === 8 || y === 52) return c3(40, 40, 48);
      const line = 16 + (x - 8) * 0.62 + Math.sin(x * 0.7) * 3;
      if (x > 8 && y < 52 && Math.abs(y - line) < 1.3) return c3(220, 40, 40);
      return c3(244, 244, 238);
    });
    blit(T.chart.d, 64, 64, "PROFITS", 12, 5, rgb(40, 40, 48), 1);

    T.board = makeTex(64, 32, (x, y) => (x < 2 || x > 61 || y < 2 || y > 29 ? c3(120, 124, 130) : c3(246, 246, 240)));
    blit(T.board.d, 64, 32, "STAFF: 6", 6, 6, rgb(30, 60, 160), 1);
    blit(T.board.d, 64, 32, "SNACKS: 1", 6, 18, rgb(200, 40, 40), 1);

    T.sign = makeTex(64, 16, (x, y) => (x < 1 || x > 62 || y < 1 || y > 14 ? c3(120, 20, 20) : c3(255, 232, 90)));
    blit(T.sign.d, 64, 16, "LAST ONE!", 5, 4, rgb(180, 30, 30), 1);

    T.grid = makeTex(32, 32, (x, y) => (x === 0 || y === 0 ? c3(250, 169, 104) : c3(30, 26, 48)));
    return T;
  })();

  // --- The cast -----------------------------------------------------------
  const SKIN_A = [238, 190, 152];
  const SKIN_B = [176, 118, 82];
  const SKIN_C = [248, 212, 180];
  const SKIN_D = [124, 82, 58];

  // Specials: `type` picks the behaviour (proj = thrown object, lunge =
  // dash-through, splash = short-range burst, upper = rising swing).
  const ROSTER = [
    {
      id: "chad", name: "CHAD", full: "CHAD BRADSWORTH", title: "VP OF SALES",
      skin: SKIN_A, hair: "slick", hairCol: [226, 190, 96], jacket: [38, 52, 110], sleeve: "long", shirt: [240, 240, 244],
      tie: [214, 40, 44], legs: [34, 46, 98], shoes: [30, 24, 22],
      speed: 0.046, power: 1.0, pow: 3, spd: 3,
      quote: "LET'S CIRCLE BACK TO ME WINNING.",
      special: { name: "COLD CALL", type: "proj", kind: "phone", vx: 0.12, vy: 0, g: 0, dmg: 10, stun: 22, kb: 0.1, dur: 40, rel: 16, pose: "throw" },
    },
    {
      id: "linda", name: "LINDA", full: "LINDA FROM H.R.", title: "HUMAN RESOURCES",
      skin: SKIN_B, hair: "bun", hairCol: [46, 30, 26], jacket: [128, 60, 150], sleeve: "long", shirt: [250, 236, 220],
      skirt: [96, 42, 116], legs: [150, 98, 70], shoes: [60, 24, 70], glasses: true,
      speed: 0.052, power: 0.9, pow: 2, spd: 4,
      quote: "THIS IS GOING IN YOUR FILE.",
      special: { name: "PINK SLIP", type: "proj", kind: "slip", vx: 0.17, vy: 0, g: 0, dmg: 7, stun: 18, kb: 0.07, dur: 30, rel: 11, pose: "throw" },
    },
    {
      id: "gary", name: "GARY", full: "GARY FROM I.T.", title: "SYSTEMS ADMIN",
      skin: SKIN_C, hair: "headset", hairCol: [40, 40, 46], jacket: [232, 236, 240], sleeve: "short", lanyard: [40, 150, 220],
      legs: [176, 152, 110], shoes: [240, 240, 240], glasses: true, wide: true,
      speed: 0.038, power: 1.2, pow: 5, spd: 1,
      quote: "HAVE YOU TRIED NOT LOSING?",
      special: { name: "HARD REBOOT", type: "lunge", a: [10, 28], dash: 0.1, range: 1.0, lo: 0.4, hi: 1.6, dmg: 12, kb: 0.12, kd: true, dur: 44, pose: "lunge" },
    },
    {
      id: "barb", name: "BARB", full: "BARB IN ACCOUNTING", title: "SENIOR ACCOUNTANT",
      skin: SKIN_A, hair: "big", hairCol: [196, 62, 36], jacket: [52, 140, 96], sleeve: "long", shirt: [250, 240, 200],
      skirt: [70, 60, 56], legs: [222, 176, 140], shoes: [30, 90, 60],
      speed: 0.042, power: 1.05, pow: 4, spd: 2,
      quote: "YOUR EXPENSES ARE DENIED.",
      special: { name: "STAPLER TOSS", type: "proj", kind: "stapler", vx: 0.085, vy: 0.1, g: 0.0055, dmg: 11, stun: 22, kb: 0.1, dur: 42, rel: 17, pose: "throw" },
    },
    {
      id: "devon", name: "DEVON", full: "DEVON THE INTERN", title: "UNPAID INTERN",
      skin: SKIN_D, hair: "messy", hairCol: [24, 20, 22], jacket: [120, 190, 235], sleeve: "short", lanyard: [240, 90, 60],
      legs: [50, 56, 70], shoes: [232, 60, 60],
      speed: 0.055, power: 0.9, pow: 2, spd: 5,
      quote: "DOES THIS COUNT AS EXPERIENCE?",
      special: { name: "COFFEE RUN", type: "splash", kind: "coffee", a: [14, 22], range: 1.7, lo: 0.5, hi: 1.7, dmg: 13, stun: 24, kb: 0.13, dur: 46, pose: "splash" },
    },
    {
      id: "msv", name: "MS. V", full: "MS. VANDERHOLT", title: "CHIEF EXECUTIVE",
      skin: SKIN_C, hair: "bob", hairCol: [214, 216, 226], jacket: [244, 240, 232], sleeve: "long", shirt: [30, 30, 36],
      legs: [240, 236, 228], shoes: [200, 30, 40],
      speed: 0.044, power: 1.1, pow: 4, spd: 3,
      quote: "CONSIDER YOURSELF RESTRUCTURED.",
      special: { name: "GOLDEN PARACHUTE", type: "upper", kind: "case", a: [8, 22], dash: 0.03, hop: 0.085, range: 1.05, lo: 0.4, hi: 2.6, dmg: 14, kb: 0.1, kd: true, dur: 48, pose: "upper" },
    },
  ];

  const ITEMS = {
    phone: { col: [44, 44, 52], l: 0.2, t: 0.07, w: 0.06 },
    slip: { col: [255, 150, 190], l: 0.26, t: 0.02, w: 0.2 },
    stapler: { col: [206, 40, 40], l: 0.2, t: 0.08, w: 0.07 },
    coffee: { col: [244, 244, 236], l: 0.14, t: 0.1, w: 0.1 },
    case: { col: [112, 70, 40], l: 0.36, t: 0.26, w: 0.09 },
  };

  // --- Poses ----------------------------------------------------------------
  // Every joint is one angle in the fight plane. Limbs: 0 hangs straight
  // down, positive swings forward. Elbows (e*) bend the forearm further
  // forward; knees (k*) bend the shin back. "L" is the far side of the body
  // from the camera, "R" the near side — the near arm and leg do the
  // punching and kicking so the hits are always in view.
  const UL = 0.45; // thigh and shin length
  const POSE_KEYS = ["lean", "head", "sL", "eL", "sR", "eR", "hL", "kL", "hR", "kR", "rot", "hy", "ox"];
  const IDLE0 = { lean: 0.12, head: -0.05, sL: 0.75, eL: 1.6, sR: 0.45, eR: 1.95, hL: 0.5, kL: 0.75, hR: -0.3, kR: 0.25, rot: 0, ox: 0 };

  // Unless a pose pins the hip height itself (airborne, lying down), it is
  // derived from the legs so the lower foot always rests on the floor.
  function mk(base, o) {
    const p = Object.assign({}, base, o);
    if (!o || o.hy === undefined) {
      p.hy = Math.max(UL * Math.cos(p.hL) + UL * Math.cos(p.hL - p.kL), UL * Math.cos(p.hR) + UL * Math.cos(p.hR - p.kR)) + 0.07;
    }
    return p;
  }
  const P = (o) => mk(IDLE0, o);
  const IDLE = P();
  const CROUCH = P({ lean: 0.55, head: -0.4, sL: 0.9, eL: 1.7, sR: 0.6, eR: 2.0, hL: 1.35, kL: 2.3, hR: 0.85, kR: 2.2 });
  const PC = (o) => mk(CROUCH, o);

  const POSES = {
    jump: P({ lean: 0.2, sL: 1.2, eL: 1.2, sR: 0.9, eR: 1.4, hL: 1.1, kL: 1.7, hR: 0.5, kR: 1.5, hy: 0.75 }),
    punchW: P({ lean: 0.02, sR: -0.5, eR: 2.2 }),
    punchE: P({ lean: 0.36, head: -0.2, sR: 1.55, eR: 0.05, sL: 0.4, eL: 2.1, hL: 0.65, kL: 0.8, hR: -0.45, kR: 0.2 }),
    kickW: P({ lean: -0.1, hR: 1.2, kR: 1.8, hL: 0.1, kL: 0.15 }),
    kickE: P({ lean: -0.38, head: 0.25, hR: 1.6, kR: 0, hL: 0.05, kL: 0.1, sL: 0.3, eL: 1.2, sR: -0.6, eR: 0.8 }),
    lowpE: PC({ lean: 0.62, sR: 1.45, eR: 0.05 }),
    sweepW: PC({ lean: 0.3, hR: 1.2, kR: 1.6 }),
    sweepE: PC({ lean: 0.1, head: -0.1, hR: 1.5, kR: 0.05, sL: 0.2, eL: 0.8, sR: -0.7, eR: 0.5 }),
    airk: P({ lean: 0.1, hR: 1.25, kR: 0.05, hL: 1.0, kL: 1.9, sL: 1.0, eL: 1.0, sR: -0.3, eR: 0.6, hy: 0.75 }),
    hit: P({ lean: -0.36, head: -0.4, sL: 0.2, eL: 0.6, sR: -0.3, eR: 0.9, hL: 0.3, kL: 0.5, hR: -0.4, kR: 0.3, ox: -0.06 }),
    hitC: PC({ lean: 0.2, head: -0.6, sL: 0.2, eL: 0.6, sR: -0.3, eR: 0.9 }),
    block: P({ lean: -0.06, head: -0.12, sL: 1.25, eL: 1.7, sR: 1.1, eR: 1.9, hL: 0.45, kL: 0.7, hR: -0.35, kR: 0.3 }),
    blockC: PC({ lean: 0.4, sL: 1.25, eL: 1.7, sR: 1.1, eR: 1.9 }),
    fall: P({ lean: -0.3, head: -0.3, sL: 1.8, eL: 0.3, sR: 1.5, eR: 0.4, hL: 0.9, kL: 0.6, hR: 0.5, kR: 0.8, rot: 0.9, hy: 0.7 }),
    down: P({ lean: 0, head: 0.1, sL: 2.7, eL: 0.3, sR: 2.2, eR: 0.5, hL: 0.15, kL: 0.2, hR: -0.05, kR: 0.1, rot: 1.5, hy: 0.15 }),
    lose: P({ lean: 0.75, head: 0.5, sL: 0.3, eL: 0.2, sR: 0.2, eR: 0.2, hL: 1.4, kL: 2.4, hR: 0.9, kR: 2.3 }),
    throwW: P({ lean: -0.16, sR: -1.2, eR: 1.6, sL: 1.1, eL: 0.6 }),
    throwE: P({ lean: 0.42, head: -0.2, sR: 1.7, eR: 0.1, sL: -0.2, eL: 1.0, hL: 0.7, kL: 0.85, hR: -0.5, kR: 0.2 }),
    lungeW: PC({ lean: 0.7 }),
    lunge: P({ lean: 0.95, head: -0.6, sL: -0.5, eL: 0.3, sR: -0.6, eR: 0.3, hL: 0.9, kL: 0.9, hR: -0.6, kR: 0.2 }),
    splashW: P({ lean: -0.1, sL: 0.2, eL: 2.2, sR: 0.2, eR: 2.2 }),
    splashE: P({ lean: 0.34, head: -0.2, sL: 1.5, eL: 0.1, sR: 1.5, eR: 0.1, hL: 0.7, kL: 0.85, hR: -0.45, kR: 0.2 }),
    upper: P({ lean: -0.22, head: 0.3, sR: 2.8, eR: 0.1, sL: -0.4, eL: 0.8, hL: 0.2, kL: 0.2, hR: 0.6, kR: 1.2, hy: 0.92 }),
    stand: P({ lean: 0, head: 0, sL: 0.08, eL: 0.2, sR: 0.08, eR: 0.2, hL: 0.04, kL: 0.08, hR: -0.04, kR: 0.08 }),
  };

  function mixPose(a, b, t, out) {
    out = out || {};
    for (let i = 0; i < POSE_KEYS.length; i++) {
      const k = POSE_KEYS[i];
      out[k] = a[k] + (b[k] - a[k]) * t;
    }
    return out;
  }

  // Keyframes are [frame, pose]; frames are 60ths of a second.
  function sample(kf, t) {
    if (t <= kf[0][0]) return kf[0][1];
    for (let i = 1; i < kf.length; i++) {
      if (t <= kf[i][0]) return mixPose(kf[i - 1][1], kf[i][1], smooth((t - kf[i - 1][0]) / (kf[i][0] - kf[i - 1][0])));
    }
    return kf[kf.length - 1][1];
  }

  // a = active frames, lo/hi = the height band the attack occupies (so high
  // punches whiff over a croucher and sweeps can be jumped), lvl = how it
  // has to be blocked: "low" crouching, "high" standing, "mid" either.
  const MOVES = {
    punch: { dur: 17, a: [5, 9], range: 1.0, lo: 1.3, hi: 1.65, dmg: 5, stun: 18, kb: 0.06, lvl: "mid", cancel: true,
      kf: [[0, IDLE], [3, POSES.punchW], [6, POSES.punchE], [10, POSES.punchE], [17, IDLE]] },
    kick: { dur: 29, a: [10, 15], range: 1.25, lo: 0.7, hi: 1.3, dmg: 9, stun: 21, kb: 0.1, lvl: "mid",
      kf: [[0, IDLE], [6, POSES.kickW], [10, POSES.kickE], [16, POSES.kickE], [29, IDLE]] },
    lowp: { dur: 17, a: [5, 9], range: 0.95, lo: 0.4, hi: 1.0, dmg: 4, stun: 16, kb: 0.05, lvl: "mid", cancel: true, crouch: true,
      kf: [[0, CROUCH], [6, POSES.lowpE], [10, POSES.lowpE], [17, CROUCH]] },
    sweep: { dur: 35, a: [11, 16], range: 1.3, lo: 0, hi: 0.5, dmg: 8, stun: 20, kb: 0.08, lvl: "low", kd: true, crouch: true,
      kf: [[0, CROUCH], [7, POSES.sweepW], [11, POSES.sweepE], [17, POSES.sweepE], [35, CROUCH]] },
    airk: { dur: 999, a: [4, 60], range: 1.0, lo: -0.1, hi: 0.9, dmg: 8, stun: 20, kb: 0.08, lvl: "high", air: true,
      kf: [[0, POSES.jump], [4, POSES.airk]] },
  };
  const SPECIAL_KF = {
    throw: (m) => [[0, IDLE], [m.rel - 5, POSES.throwW], [m.rel, POSES.throwE], [m.rel + 8, POSES.throwE], [m.dur, IDLE]],
    lunge: (m) => [[0, IDLE], [8, POSES.lungeW], [12, POSES.lunge], [28, POSES.lunge], [m.dur, IDLE]],
    splash: (m) => [[0, IDLE], [10, POSES.splashW], [14, POSES.splashE], [24, POSES.splashE], [m.dur, IDLE]],
    upper: (m) => [[0, IDLE], [6, CROUCH], [10, POSES.upper], [24, POSES.upper], [m.dur, IDLE]],
  };
  for (const ch of ROSTER) {
    ch.special.kf = SPECIAL_KF[ch.special.pose](ch.special);
    ch.special.lvl = "mid";
    ch.special.special = true;
  }

  // --- Drawing a person ---------------------------------------------------
  // Built in the fighter's own 2D frame (u forward, v up from the hip) plus
  // a sideways w, then mirrored for facing and turned by `yaw` so the chest
  // angles toward the camera whichever way they face.
  let bodyZ = 0; // depth offset for people standing off the fight line
  function drawBody(ch, px, py, facing, p, yaw, o) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
    const hipY = p.hy, ox = p.ox;
    function fbox(ou, ov, du, dv, nu, nv, a0, a1, n0, n1, w0, w1, col) {
      const c = [];
      for (let i = 0; i < 8; i++) {
        const a = i & 1 ? a1 : a0, n = i & 2 ? n1 : n0, w = i & 4 ? w1 : w0;
        const u = ou + du * a + nu * n, v = ov + dv * a + nv * n;
        const ur = u * cr - v * sr + ox, vr = u * sr + v * cr + hipY;
        c.push([px + facing * (ur * cyw - w * syw), py + vr, bodyZ + ur * syw + w * cyw]);
      }
      box(c, col);
    }
    function limb(ou, ov, ang, len, th, wc, wz, col) {
      const du = Math.sin(ang), dv = -Math.cos(ang);
      fbox(ou, ov, du, dv, -dv, du, 0, len, -th / 2, th / 2, wc - wz / 2, wc + wz / 2, col);
      return [ou + du * len, ov + dv * len];
    }

    const skin = ch.skin;
    const wide = ch.wide ? 1.14 : 1;
    const legUp = ch.skirt ? ch.legs : ch.legs;

    // Legs.
    for (let side = -1; side <= 1; side += 2) {
      const h = side < 0 ? p.hL : p.hR, k = side < 0 ? p.kL : p.kR;
      const wc = side * 0.11 * wide;
      const knee = limb(0, 0, h, UL, 0.15, wc, 0.15, legUp);
      const ankle = limb(knee[0], knee[1], h - k, UL, 0.12, wc, 0.12, ch.legs);
      const a = h - k, du = Math.sin(a), dv = -Math.cos(a);
      fbox(ankle[0], ankle[1], du, dv, -dv, du, -0.02, 0.07, -0.07, 0.17, wc - 0.07, wc + 0.07, ch.shoes);
    }
    // Hips, and a skirt over the thighs for those who wear one.
    if (ch.skirt) fbox(0, 0, 0, 1, 1, 0, -0.34, 0.12, -0.15, 0.15, -0.22, 0.22, ch.skirt);
    else fbox(0, 0, 0, 1, 1, 0, -0.08, 0.12, -0.12, 0.12, -0.2 * wide, 0.2 * wide, ch.legs);

    // Torso.
    const tu = Math.sin(p.lean), tv = Math.cos(p.lean);
    const tw = 0.21 * wide;
    fbox(0, 0.08, tu, tv, tv, -tu, 0, 0.56, -0.12, 0.13 * wide, -tw, tw, ch.jacket);
    if (ch.shirt) fbox(0, 0.08, tu, tv, tv, -tu, 0.24, 0.56, 0.13, 0.14, -0.06, 0.06, ch.shirt);
    if (ch.tie) fbox(0, 0.08, tu, tv, tv, -tu, 0.18, 0.54, 0.14, 0.15, -0.025, 0.025, ch.tie);
    if (ch.lanyard) {
      fbox(0, 0.08, tu, tv, tv, -tu, 0.3, 0.56, 0.13 * wide, 0.13 * wide + 0.01, -0.02, 0.02, ch.lanyard);
      fbox(0, 0.08, tu, tv, tv, -tu, 0.2, 0.3, 0.13 * wide, 0.13 * wide + 0.015, -0.05, 0.05, [244, 244, 244]);
    }
    const shU = tu * 0.5, shV = 0.08 + tv * 0.5;
    const nkU = tu * 0.56, nkV = 0.08 + tv * 0.56;

    // Head.
    const ha = p.lean * 0.6 + p.head;
    const hu = Math.sin(ha), hv = Math.cos(ha);
    const hb = (a0, a1, n0, n1, w0, w1, col) => fbox(nkU, nkV, hu, hv, hv, -hu, a0, a1, n0, n1, w0, w1, col);
    hb(-0.02, 0.06, -0.05, 0.05, -0.05, 0.05, skin);
    hb(0.04, 0.3, -0.12, 0.12, -0.11, 0.11, skin);
    const dark = [26, 22, 26];
    hb(0.17, 0.21, 0.12, 0.126, -0.075, -0.035, dark);
    hb(0.17, 0.21, 0.12, 0.126, 0.035, 0.075, dark);
    hb(0.11, 0.16, 0.12, 0.15, -0.016, 0.016, [skin[0] * 0.86, skin[1] * 0.82, skin[2] * 0.8]);
    if (o && o.ouch) hb(0.055, 0.1, 0.12, 0.126, -0.04, 0.04, [90, 20, 24]);
    else hb(0.075, 0.09, 0.12, 0.126, -0.04, 0.04, [130, 50, 50]);
    if (ch.glasses) {
      hb(0.16, 0.225, 0.126, 0.134, -0.1, -0.015, [30, 30, 40]);
      hb(0.16, 0.225, 0.126, 0.134, 0.015, 0.1, [30, 30, 40]);
    }
    const hc = ch.hairCol;
    switch (ch.hair) {
      case "slick":
        hb(0.27, 0.35, -0.14, 0.13, -0.122, 0.122, hc);
        hb(0.1, 0.3, -0.15, -0.11, -0.122, 0.122, hc);
        break;
      case "bun":
        hb(0.27, 0.34, -0.14, 0.125, -0.122, 0.122, hc);
        hb(0.1, 0.3, -0.15, -0.11, -0.122, 0.122, hc);
        hb(0.3, 0.43, -0.2, -0.06, -0.065, 0.065, hc);
        break;
      case "bob":
        hb(0.27, 0.345, -0.14, 0.13, -0.13, 0.13, hc);
        hb(0.02, 0.3, -0.155, -0.11, -0.13, 0.13, hc);
        hb(0.03, 0.3, -0.12, 0.04, -0.138, -0.11, hc);
        hb(0.03, 0.3, -0.12, 0.04, 0.11, 0.138, hc);
        break;
      case "big":
        hb(0.25, 0.43, -0.18, 0.15, -0.17, 0.17, hc);
        hb(0.0, 0.3, -0.2, -0.1, -0.165, 0.165, hc);
        hb(0.02, 0.3, -0.12, 0.02, -0.17, -0.11, hc);
        hb(0.02, 0.3, -0.12, 0.02, 0.11, 0.17, hc);
        break;
      case "messy":
        hb(0.27, 0.37, -0.14, 0.13, -0.125, 0.125, hc);
        hb(0.12, 0.3, -0.15, -0.11, -0.122, 0.122, hc);
        hb(0.24, 0.3, 0.1, 0.15, -0.115, 0.115, hc);
        break;
      case "headset":
        hb(0.3, 0.32, -0.03, 0.03, -0.125, 0.125, hc);
        hb(0.12, 0.23, -0.05, 0.05, 0.11, 0.14, hc);
        hb(0.12, 0.23, -0.05, 0.05, -0.14, -0.11, hc);
        hb(0.08, 0.1, 0.02, 0.15, 0.12, 0.135, hc);
        break;
    }

    // Arms, far side first.
    for (let side = -1; side <= 1; side += 2) {
      const s = side < 0 ? p.sL : p.sR, e = side < 0 ? p.eL : p.eR;
      const wc = side * (tw + 0.06);
      const elbow = limb(shU, shV, s, 0.28, 0.115, wc, 0.115, ch.jacket);
      const wrist = limb(elbow[0], elbow[1], s + e, 0.2, 0.1, wc, 0.1, ch.sleeve === "short" ? skin : ch.jacket);
      const hand = limb(wrist[0], wrist[1], s + e, 0.1, 0.1, wc, 0.1, skin);
      if (side > 0 && o && o.item) {
        const it = ITEMS[o.item];
        const a = s + e, du = Math.sin(a), dv = -Math.cos(a);
        fbox(hand[0], hand[1], du, dv, -dv, du, -0.04, it.t, -it.l * 0.35, it.l * 0.65, wc - it.w / 2, wc + it.w / 2, it.col);
      }
    }
  }

  // --- The prize ----------------------------------------------------------
  function drawPrize(kind, x, y, z, spin, size) {
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const ct = Math.cos(0.5), st = Math.sin(0.5); // tipped toward the camera
    const pt = (lx, ly, lz) => {
      const x1 = lx * cs + lz * sn, z1 = -lx * sn + lz * cs;
      return [x + x1 * size, y + (ly * ct + z1 * st) * size, z + (z1 * ct - ly * st) * size];
    };
    if (kind === "donut") {
      const SEG = 10, RING = 6, R = 0.17, r = 0.08;
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * TAU, a1 = ((i + 1) / SEG) * TAU;
        const ref = pt(Math.cos((a0 + a1) / 2) * R, 0, Math.sin((a0 + a1) / 2) * R);
        for (let j = 0; j < RING; j++) {
          const b0 = (j / RING) * TAU, b1 = ((j + 1) / RING) * TAU;
          const v = (a, b) => pt(Math.cos(a) * (R + Math.cos(b) * r), Math.sin(b) * r, Math.sin(a) * (R + Math.cos(b) * r));
          // The upper half of the tube is icing, with the odd sprinkle.
          const top = Math.sin((b0 + b1) / 2) > 0.1;
          const col = top ? ((i * 3 + j) % 5 === 0 ? [255, 244, 150] : [250, 120, 176]) : [214, 160, 96];
          shadedQuad(v(a0, b0), v(a1, b0), v(a1, b1), v(a0, b1), col, ref);
        }
      }
    } else {
      const ref = pt(0, 0, 0);
      const tip = [0, 0.24], bl = [-0.17, -0.16], br = [0.17, -0.16];
      const T = (q) => pt(q[0], 0.025, q[1]);
      const B = (q) => pt(q[0], -0.025, q[1]);
      shadedQuad(T(tip), T(bl), T(br), T(br), [250, 204, 80], ref);
      shadedQuad(B(tip), B(bl), B(br), B(br), [206, 150, 84], ref);
      shadedQuad(T(tip), T(bl), B(bl), B(tip), [226, 170, 70], ref);
      shadedQuad(T(tip), T(br), B(br), B(tip), [226, 170, 70], ref);
      const cr0 = [pt(-0.19, -0.04, -0.22), pt(0.19, -0.04, -0.22), pt(-0.19, 0.06, -0.22), pt(0.19, 0.06, -0.22),
        pt(-0.19, -0.04, -0.14), pt(0.19, -0.04, -0.14), pt(-0.19, 0.06, -0.14), pt(0.19, 0.06, -0.14)];
      box(cr0, [200, 138, 72]);
      for (const q of [[0, 0.08], [-0.07, -0.07], [0.07, -0.05]]) {
        const c = [];
        for (let i = 0; i < 8; i++) c.push(pt(q[0] + (i & 1 ? 0.035 : -0.035), i & 2 ? 0.04 : 0.02, q[1] + (i & 4 ? 0.035 : -0.035)));
        box(c, [196, 44, 40]);
      }
    }
  }

  // --- Stages -------------------------------------------------------------
  const ROOM_X = 12, ROOM_BACK = -4, ROOM_FRONT = 7, ROOM_TOP = 3.4;
  const STAGES = [
    { name: "THE BREAK ROOM", floor: TEX.lino, wall: TEX.wall, win: TEX.winDay, sky: rgb(40, 36, 32) },
    { name: "THE CUBICLE FARM", floor: TEX.carpet, wall: TEX.wallGray, win: TEX.winDay, sky: rgb(34, 36, 42) },
    { name: "THE BOARDROOM", floor: TEX.wood, wall: TEX.panel, win: TEX.winNight, sky: rgb(22, 16, 14) },
  ];

  // A picture hung flat on the back wall.
  function hang(x0, y0, x1, y1, tex) {
    const z = ROOM_BACK + 0.03;
    bigQuad([x0, y1, z], [x1, y1, z], [x1, y0, z], [x0, y0, z], { tex, nu: 2, nv: 2, lit: 1 });
  }

  function drawPlant(x, z) {
    abox(x - 0.2, 0, z - 0.2, x + 0.2, 0.4, z + 0.2, [170, 96, 60]);
    abox(x - 0.05, 0.4, z - 0.05, x + 0.05, 0.9, z + 0.05, [90, 70, 40]);
    abox(x - 0.3, 0.8, z - 0.3, x + 0.3, 1.3, z + 0.3, [50, 140, 70]);
    abox(x - 0.18, 1.3, z - 0.18, x + 0.18, 1.65, z + 0.18, [66, 166, 84]);
  }

  function drawDesk(x, z) {
    abox(x - 0.7, 0.68, z - 0.35, x + 0.7, 0.74, z + 0.35, [196, 176, 140]);
    abox(x - 0.66, 0, z - 0.3, x - 0.6, 0.68, z + 0.3, [120, 120, 126]);
    abox(x + 0.6, 0, z - 0.3, x + 0.66, 0.68, z + 0.3, [120, 120, 126]);
    // A beige CRT, naturally.
    abox(x - 0.24, 0.74, z - 0.25, x + 0.24, 1.14, z + 0.15, [214, 204, 180]);
    abox(x - 0.19, 0.8, z + 0.15, x + 0.19, 1.09, z + 0.16, [70, 190, 170]);
  }

  function drawStage(index, time, prize, crowd, hype) {
    const s = STAGES[index];
    // Floor, ceiling, walls.
    bigQuad([-ROOM_X, 0, ROOM_BACK], [ROOM_X, 0, ROOM_BACK], [ROOM_X, 0, ROOM_FRONT], [-ROOM_X, 0, ROOM_FRONT],
      { tex: s.floor, uv: [0, 0, 24, 11], nu: 16, nv: 9, lit: 1.0 });
    bigQuad([-ROOM_X, ROOM_TOP, ROOM_FRONT], [ROOM_X, ROOM_TOP, ROOM_FRONT], [ROOM_X, ROOM_TOP, ROOM_BACK], [-ROOM_X, ROOM_TOP, ROOM_BACK],
      { tex: TEX.ceil, uv: [0, 0, 12, 6], nu: 8, nv: 4, lit: 1.05 });
    bigQuad([-ROOM_X, ROOM_TOP, ROOM_BACK], [ROOM_X, ROOM_TOP, ROOM_BACK], [ROOM_X, 0, ROOM_BACK], [-ROOM_X, 0, ROOM_BACK],
      { tex: s.wall, uv: [0, 0, 12, 1], nu: 12, nv: 2, lit: 0.95 });
    bigQuad([-ROOM_X, ROOM_TOP, ROOM_FRONT], [-ROOM_X, ROOM_TOP, ROOM_BACK], [-ROOM_X, 0, ROOM_BACK], [-ROOM_X, 0, ROOM_FRONT],
      { tex: s.wall, uv: [0, 0, 6, 1], nu: 6, nv: 2, lit: 0.8 });
    bigQuad([ROOM_X, ROOM_TOP, ROOM_BACK], [ROOM_X, ROOM_TOP, ROOM_FRONT], [ROOM_X, 0, ROOM_FRONT], [ROOM_X, 0, ROOM_BACK],
      { tex: s.wall, uv: [0, 0, 6, 1], nu: 6, nv: 2, lit: 0.8 });
    for (const wx of [-9.5, -6.2, 6.2, 9.5]) hang(wx - 1.2, 1.0, wx + 1.2, 2.9, s.win);

    if (index === 0) {
      hang(-3.4, 1.5, -2.1, 2.8, TEX.poster1);
      hang(2.6, 1.7, 4.4, 2.6, TEX.board);
      // Vending machine and fridge.
      abox(-5.0, 0, -3.9, -3.9, 2.1, -3.0, [150, 30, 38]);
      bigQuad([-5.0, 2.1, -2.99], [-3.9, 2.1, -2.99], [-3.9, 0, -2.99], [-5.0, 0, -2.99], { tex: TEX.vend, nu: 2, nv: 3 });
      abox(-6.3, 0, -3.9, -5.3, 1.9, -3.1, [232, 234, 238]);
      abox(-5.42, 0.9, -3.1, -5.36, 1.5, -3.04, [120, 124, 130]);
      // Counter with a microwave and coffee maker.
      abox(2.4, 0, -3.9, 6.0, 0.95, -3.1, [176, 150, 110]);
      abox(2.4, 0.95, -3.92, 6.0, 1.0, -3.06, [226, 226, 220]);
      abox(4.6, 1.0, -3.8, 5.5, 1.45, -3.3, [60, 62, 70]);
      abox(4.7, 1.08, -3.3, 5.2, 1.38, -3.29, [20, 26, 34]);
      abox(3.0, 1.0, -3.7, 3.35, 1.5, -3.35, [30, 30, 34]);
      abox(3.06, 1.05, -3.36, 3.29, 1.25, -3.3, [90, 50, 30]);
      drawPlant(7.4, -3.2);
    } else if (index === 1) {
      hang(-3.6, 1.6, -2.4, 2.8, TEX.poster2);
      for (const cx0 of [-7.6, -4.6, 3.2, 6.2]) {
        bigQuad([cx0 - 1.3, 1.5, -1.9], [cx0 + 1.3, 1.5, -1.9], [cx0 + 1.3, 0, -1.9], [cx0 - 1.3, 0, -1.9],
          { tex: TEX.cubicle, uv: [0, 0, 3, 1], nu: 3, nv: 2, lit: 0.95 });
        abox(cx0 - 1.3, 0, -3.6, cx0 - 1.22, 1.5, -1.9, [112, 126, 146]);
        abox(cx0 + 1.22, 0, -3.6, cx0 + 1.3, 1.5, -1.9, [112, 126, 146]);
        drawDesk(cx0, -2.9);
      }
      // The copier.
      abox(8.6, 0, -3.8, 9.9, 1.1, -2.9, [214, 208, 190]);
      abox(8.7, 1.1, -3.7, 9.8, 1.22, -3.0, [150, 150, 150]);
      abox(9.2, 0.75, -2.9, 9.7, 0.85, -2.6, [236, 236, 230]);
      drawPlant(-10.2, -3.2);
    } else {
      hang(-3.9, 1.3, -2.1, 3.0, TEX.chart);
      hang(2.3, 1.5, 3.6, 2.8, TEX.poster1);
      // The long table and its chairs.
      abox(-6.2, 0.74, -3.3, -2.0, 0.84, -2.2, [96, 56, 32]);
      abox(-6.0, 0, -3.1, -5.8, 0.74, -2.4, [60, 36, 22]);
      abox(-2.4, 0, -3.1, -2.2, 0.74, -2.4, [60, 36, 22]);
      abox(2.2, 0.74, -3.3, 6.4, 0.84, -2.2, [96, 56, 32]);
      abox(2.4, 0, -3.1, 2.6, 0.74, -2.4, [60, 36, 22]);
      abox(6.0, 0, -3.1, 6.2, 0.74, -2.4, [60, 36, 22]);
      for (const chx of [-5.2, -3.9, -2.8, 3.0, 4.3, 5.5]) {
        abox(chx - 0.25, 0.45, -1.9, chx + 0.25, 0.52, -1.45, [36, 36, 44]);
        abox(chx - 0.25, 0.52, -1.52, chx + 0.25, 1.2, -1.45, [36, 36, 44]);
        abox(chx - 0.04, 0, -1.72, chx + 0.04, 0.45, -1.64, [90, 90, 96]);
      }
      drawPlant(8.0, -3.2);
      drawPlant(-8.0, -3.2);
    }

    // The water cooler itself, with a slow bubble rising through the jug.
    abox(-0.24, 0, -3.3, 0.24, 1.02, -2.84, [226, 230, 234]);
    abox(-0.2, 0.62, -2.84, 0.2, 0.86, -2.82, [150, 156, 164]);
    abox(-0.12, 0.7, -2.82, -0.05, 0.78, -2.77, [60, 110, 230]);
    abox(0.05, 0.7, -2.82, 0.12, 0.78, -2.77, [226, 60, 50]);
    abox(-0.08, 1.02, -3.15, 0.08, 1.1, -2.99, [200, 220, 240]);
    abox(-0.19, 1.1, -3.26, 0.19, 1.62, -2.88, [96, 168, 240]);
    abox(-0.15, 1.62, -3.22, 0.15, 1.68, -2.92, [70, 140, 226]);
    const bub = (time * 0.006) % 1;
    abox(-0.05, 1.14 + bub * 0.4, -2.88, 0.01, 1.2 + bub * 0.4, -2.87, [214, 240, 255]);
    abox(0.07, 1.14 + ((bub + 0.5) % 1) * 0.4, -2.88, 0.11, 1.18 + ((bub + 0.5) % 1) * 0.4, -2.87, [214, 240, 255]);

    // The table the whole fight is about.
    abox(0.75, 0.82, -3.1, 1.65, 0.88, -2.3, [236, 232, 224]);
    abox(1.14, 0, -2.76, 1.26, 0.82, -2.64, [120, 122, 130]);
    abox(0.95, 0, -2.95, 1.45, 0.04, -2.45, [120, 122, 130]);
    if (prize === "donut") {
      abox(0.9, 0.88, -2.98, 1.5, 0.94, -2.42, [250, 150, 190]);
      abox(0.9, 0.94, -2.98, 1.5, 1.38, -2.94, [244, 132, 176]);
    } else {
      abox(0.86, 0.88, -3.0, 1.54, 0.93, -2.4, [220, 196, 150]);
      abox(0.86, 0.93, -3.0, 1.54, 1.5, -2.96, [206, 180, 134]);
    }
    drawPrize(prize, 1.2, 1.18 + Math.sin(time * 0.05) * 0.04, -2.66, time * 0.04, 1);
    bigQuad([0.72, 2.06, -2.9], [1.68, 2.06, -2.9], [1.68, 1.82, -2.9], [0.72, 1.82, -2.9], { tex: TEX.sign, lit: 1.05 });

    // Coworkers who stopped to watch.
    for (let i = 0; i < crowd.length; i++) {
      const c = crowd[i];
      const bob = Math.sin(time * (0.07 + hype * 0.1) + i * 1.9);
      const cheer = clamp(hype * 1.4 + (i % 2 ? bob : -bob) * hype, 0, 1);
      const pose = mk(POSES.stand, {
        lean: bob * 0.03,
        head: bob * 0.05,
        sL: lerp(0.08, 2.7, cheer), eL: lerp(0.2, 0.3, cheer),
        sR: lerp(0.08, 2.9, cheer * (0.6 + 0.4 * Math.abs(bob))), eR: 0.25,
        hL: 0.06 + hype * 0.12 * Math.max(0, bob), kL: 0.12 + hype * 0.24 * Math.max(0, bob),
        hR: 0.06 + hype * 0.12 * Math.max(0, bob), kR: 0.12 + hype * 0.24 * Math.max(0, bob),
      });
      bodyZ = c.z;
      drawBody(c.ch, c.x, 0, 1, pose, Math.PI / 2 + c.turn, hype > 0.5 ? { ouch: true } : null);
    }
    bodyZ = 0;
  }

  const CROWD_SPOTS = [[-2.4, -1.9, 0.25], [-1.35, -2.5, 0.12], [2.5, -2.0, -0.25], [3.6, -2.6, -0.3], [-3.7, -2.5, 0.3], [4.9, -1.8, -0.35]];

  // =========================================================================
  function startWaterCoolerCombat(canvas) {
    const prevW = canvas.width, prevH = canvas.height;
    const prevRendering = canvas.style.imageRendering;
    canvas.width = W;
    canvas.height = H;
    // The canvas really is 360x240; let the browser blow it up with hard
    // pixel edges instead of smoothing it.
    canvas.style.imageRendering = "pixelated";
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(W, H);
    fb = new Uint32Array(image.data.buffer);
    zb = new Float32Array(W * H);

    // --- Sound: everything is synthesised, no audio files ---------------
    let ac = null, master = null, musicGain = null, noiseBuf = null;
    let musicTimer = null, track = null, stepIdx = 0, nextStepT = 0, musicOn = true;

    function audio() {
      try {
        if (!ac) {
          ac = new (window.AudioContext || window.webkitAudioContext)();
          master = ac.createGain();
          master.gain.value = 0.55;
          master.connect(ac.destination);
          musicGain = ac.createGain();
          musicGain.gain.value = 0.5;
          musicGain.connect(master);
          noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ac.state === "suspended") ac.resume();
        return true;
      } catch (e) {
        return false; // Web Audio unavailable — the game is fully playable silent.
      }
    }
    function tone(type, f0, f1, dur, vol, when, dest) {
      if (!ac) return;
      const t = when || ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(dest || master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, freq, q, filterType, when, dest) {
      if (!ac) return;
      const t = when || ac.currentTime;
      const s = ac.createBufferSource();
      s.buffer = noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = filterType || "lowpass";
      f.frequency.value = freq;
      f.Q.value = q || 1;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f);
      f.connect(g);
      g.connect(dest || master);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur + 0.02);
    }
    const sfx = {
      blip: () => tone("square", 660, 0, 0.05, 0.05),
      ok: () => { tone("square", 520, 0, 0.07, 0.06); tone("square", 780, 0, 0.12, 0.06, ac && ac.currentTime + 0.07); },
      whoosh: () => noise(0.12, 0.1, 1800, 1.5, "bandpass"),
      jump: () => tone("triangle", 220, 440, 0.12, 0.07),
      hit: () => { noise(0.1, 0.35, 900); tone("sine", 160, 60, 0.12, 0.3); },
      heavy: () => { noise(0.2, 0.5, 600); tone("sine", 130, 40, 0.25, 0.45); tone("square", 90, 40, 0.12, 0.1); },
      block: () => { noise(0.05, 0.2, 3000, 2, "highpass"); tone("square", 300, 200, 0.05, 0.06); },
      thud: () => { noise(0.18, 0.3, 300); tone("sine", 90, 40, 0.2, 0.3); },
      throw: () => noise(0.18, 0.12, 1200, 2, "bandpass"),
      super: () => { tone("sawtooth", 200, 1600, 0.5, 0.12); noise(0.5, 0.1, 4000, 1, "highpass"); },
      ko: () => { noise(0.7, 0.5, 500); tone("sawtooth", 300, 40, 0.8, 0.25); },
      bell: () => { tone("sine", 880, 0, 0.9, 0.2); tone("sine", 1320, 0, 0.6, 0.1); tone("sine", 2640, 0, 0.3, 0.04); },
      announce: () => { tone("square", 392, 0, 0.1, 0.07); tone("square", 523, 0, 0.18, 0.07, ac && ac.currentTime + 0.1); },
      win: () => { if (!ac) return; [523, 659, 784, 1047].forEach((f, i) => tone("square", f, 0, 0.16, 0.07, ac.currentTime + i * 0.11)); },
      lose: () => { if (!ac) return; [392, 330, 262, 196].forEach((f, i) => tone("triangle", f, 0, 0.22, 0.1, ac.currentTime + i * 0.16)); },
      tick: () => tone("square", 880, 0, 0.04, 0.05),
    };

    // Two looping tracks off one 16-step sequencer: lounge muzak for the
    // menus, something more urgent for the fights.
    const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const TRACKS = {
      menu: {
        step: 60 / 104 / 4,
        chords: [[48, 64, 67, 71], [45, 60, 64, 67], [50, 60, 65, 69], [43, 59, 62, 65]],
        play(t, s, bar, ch) {
          if (s === 0 || s === 10) tone("triangle", midi(ch[0] - 12), 0, 0.3, 0.2, t, musicGain);
          if (s === 6) tone("triangle", midi(ch[0] - 5), 0, 0.2, 0.16, t, musicGain);
          if (s === 3 || s === 6 || s === 11 || s === 14) for (let i = 1; i < 4; i++) tone("sine", midi(ch[i]), 0, 0.16, 0.05, t, musicGain);
          const mel = [[76, -1, 74, 72, -1, 71, -1, 67], [72, -1, 69, -1, 67, 69, -1, -1], [77, -1, 76, 74, -1, 72, 69, -1], [74, 71, -1, 67, -1, 71, 74, -1]][bar];
          if (s % 2 === 0 && mel[s >> 1] > 0) tone("sine", midi(mel[s >> 1]), 0, 0.22, 0.08, t, musicGain);
          if (s % 2 === 0) noise(0.03, s % 4 === 2 ? 0.05 : 0.025, 7000, 1, "highpass", t, musicGain);
        },
      },
      fight: {
        step: 60 / 148 / 4,
        chords: [[45, 69, 72, 76], [41, 65, 69, 72], [43, 67, 71, 74], [40, 64, 68, 71]],
        play(t, s, bar, ch) {
          if (s % 2 === 0) tone("sawtooth", midi(ch[0] - (s % 8 === 4 ? 0 : 12)), 0, 0.1, 0.11, t, musicGain);
          tone("square", midi(ch[1 + [0, 1, 2, 1, 2, 0, 1, 2][s % 8]] + (s % 16 > 11 ? 12 : 0)), 0, 0.07, 0.03, t, musicGain);
          if (s % 4 === 0) { tone("sine", 150, 45, 0.12, 0.3, t, musicGain); }
          if (s === 4 || s === 12) noise(0.1, 0.18, 2200, 1, "bandpass", t, musicGain);
          if (s % 2 === 1) noise(0.025, 0.05, 8000, 1, "highpass", t, musicGain);
        },
      },
    };
    function music(name) {
      if (track === name) return;
      track = name;
      stepIdx = 0;
      if (ac) nextStepT = ac.currentTime + 0.08;
    }
    function pumpMusic() {
      if (!ac || !track || !musicOn) return;
      const tr = TRACKS[track];
      if (nextStepT < ac.currentTime) nextStepT = ac.currentTime + 0.05;
      while (nextStepT < ac.currentTime + 0.2) {
        const s = stepIdx % 16, bar = (stepIdx >> 4) % 4;
        tr.play(nextStepT, s, bar, tr.chords[bar]);
        nextStepT += tr.step;
        stepIdx++;
      }
    }
    musicTimer = setInterval(pumpMusic, 50);

    // --- Input -------------------------------------------------------------
    const keys = {};
    const pressed = new Set(); // edge-triggered, cleared after each sim tick
    const KEYSETS = [
      { l: ["KeyA"], r: ["KeyD"], u: ["KeyW"], d: ["KeyS"], p: ["KeyF"], k: ["KeyG"], s: ["KeyH"] },
      { l: ["ArrowLeft"], r: ["ArrowRight"], u: ["ArrowUp"], d: ["ArrowDown"], p: ["KeyJ", "Comma", "Numpad1"], k: ["KeyK", "Period", "Numpad2"], s: ["KeyL", "Slash", "Numpad3"] },
    ];
    // With one player at the keyboard, both layouts (plus Z/X/C and the
    // touch buttons) drive player one.
    const SOLO = { l: ["KeyA", "ArrowLeft"], r: ["KeyD", "ArrowRight"], u: ["KeyW", "ArrowUp"], d: ["KeyS", "ArrowDown"],
      p: ["KeyF", "KeyJ", "KeyZ", "T_P"], k: ["KeyG", "KeyK", "KeyX", "T_K"], s: ["KeyH", "KeyL", "KeyC", "T_S"] };
    const GAME_CODES = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter", "Slash", "Comma", "Period",
      "KeyA", "KeyD", "KeyW", "KeyS", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "KeyZ", "KeyX", "KeyC", "KeyM"]);
    const anyHeld = (codes) => codes.some((c) => keys[c]);
    const anyPressed = (codes) => codes.some((c) => pressed.has(c));
    const EMPTY = { l: false, r: false, u: false, d: false, pP: false, pK: false, pS: false };

    const pointers = new Map(); // pointerId -> {x, y} in game pixels
    let touchUI = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const PAD = { x: 46, y: 194 };
    const BTNS = [{ id: "T_P", x: 300, y: 206, label: "P" }, { id: "T_K", x: 334, y: 182, label: "K" }, { id: "T_S", x: 338, y: 220, label: "S" }];

    function touchDirs() {
      const o = { l: false, r: false, u: false, d: false };
      for (const p of pointers.values()) {
        const dx = p.x - PAD.x, dy = p.y - PAD.y;
        if (dx * dx + dy * dy > 62 * 62) continue;
        if (dx < -9) o.l = true;
        if (dx > 9) o.r = true;
        if (dy < -13) o.u = true;
        if (dy > 11) o.d = true;
      }
      return o;
    }

    function readInput(idx) {
      const set = mode === "arcade" ? SOLO : KEYSETS[idx];
      const o = { l: anyHeld(set.l), r: anyHeld(set.r), u: anyHeld(set.u), d: anyHeld(set.d), pP: anyPressed(set.p), pK: anyPressed(set.k), pS: anyPressed(set.s) };
      if (mode === "arcade" && pointers.size) {
        const t = touchDirs();
        o.l = o.l || t.l; o.r = o.r || t.r; o.u = o.u || t.u; o.d = o.d || t.d;
      }
      return o;
    }

    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (GAME_CODES.has(e.code)) e.preventDefault();
      keys[e.code] = true;
      if (e.repeat) return;
      audio();
      pressed.add(e.code);
      if (e.code === "KeyM") {
        musicOn = !musicOn;
      }
    }
    function onKeyUp(e) {
      keys[e.code] = false;
    }
    function pointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
    }
    function onPointerDown(e) {
      const pos = pointerPos(e);
      audio();
      if (e.pointerType !== "mouse") {
        e.preventDefault();
        touchUI = true;
      }
      if (scene !== "fight") {
        // Menus: tap the sides to move, the middle to confirm.
        if (scene === "select" && pos.x < 110) pressed.add("T_L");
        else if (scene === "select" && pos.x > 250) pressed.add("T_R");
        else if (scene === "title" && pos.y > 140 && pos.y < 188) {
          menuIdx = pos.y < 164 ? 0 : 1;
          pressed.add("T_OK");
        } else pressed.add("T_OK");
        return;
      }
      if (e.pointerType === "mouse") return;
      pointers.set(e.pointerId, pos);
      for (const b of BTNS) {
        if ((pos.x - b.x) * (pos.x - b.x) + (pos.y - b.y) * (pos.y - b.y) < 21 * 21) pressed.add(b.id);
      }
      if (pos.y < 60 && pos.x > 140 && pos.x < 220) pressed.add("Enter"); // tap the timer to pause
    }
    function onPointerMove(e) {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pointerPos(e));
    }
    function onPointerUp(e) {
      pointers.delete(e.pointerId);
    }

    // --- Game state ----------------------------------------------------------
    let scene = "boot", sceneT = 0, fade = 1;
    let mode = "arcade", menuIdx = 0;
    const sel = [0, 5];
    const locked = [false, false];
    let fighters = [], projectiles = [], particles = [], crowd = [];
    let round = 1, phase = "intro", phaseT = 0, timer = 0, roundWinner = -1, perfect = false, timeUp = false;
    let hitstop = 0, shake = 0, superFreeze = 0, banner = null, hype = 0, paused = false;
    let ladder = [], ladderIdx = 0, stage = 0, prize = "donut", matchWinner = 0, matchCount = 0;
    let time = 0;
    const cam = { x: 0, y: 1.45, z: 5, tx: 0, ty: 1, tz: 0 };

    const GRAV = 0.0062, JUMP_V = 0.115, BOUND = 4.3, MIN_GAP = 0.62, ROUND_FRAMES = 60 * 60;
    const YAW = 0.42;

    function goto(next) {
      scene = next;
      sceneT = 0;
      fade = 1;
      pressed.clear();
    }

    function makeFighter(idx, ch, cpu, level) {
      return {
        idx, ch, cpu, level: level || 0, wins: 0, meter: 0,
        x: 0, y: 0, vx: 0, vy: 0, facing: 1, hp: 100, shown: 100,
        state: "idle", t: 0, move: null, hitDone: false, connected: false, isSuper: false,
        stun: 0, combo: 0, comboT: 0, crouching: false, walking: false, walkPh: 0,
        holdBack: false, holdDown: false, airUsed: false, flash: 0, hurt: false,
        bufP: 0, bufK: 0, bufS: 0, pose: Object.assign({}, IDLE),
        ai: { timer: 20, hold: { l: false, r: false, u: false, d: false }, block: 0, blockLow: false, reacted: false, queue: [], airKick: false },
      };
    }

    function startMatch(c0, c1, cpu1, level) {
      fighters = [makeFighter(0, ROSTER[c0], false, 0), makeFighter(1, ROSTER[c1], cpu1, level)];
      stage = matchCount % STAGES.length;
      prize = matchCount % 2 === 0 ? "donut" : "pizza";
      matchCount++;
      // Whoever isn't fighting comes to watch.
      crowd = [];
      const others = ROSTER.filter((_, i) => i !== c0 && i !== c1);
      for (let i = 0; i < others.length && i < CROWD_SPOTS.length; i++) {
        crowd.push({ ch: others[i], x: CROWD_SPOTS[i][0], z: CROWD_SPOTS[i][1], turn: CROWD_SPOTS[i][2] });
      }
      round = 1;
      goto("vs");
      music("menu");
    }

    function startRound() {
      for (const f of fighters) {
        f.x = f.idx === 0 ? -1.5 : 1.5;
        f.facing = f.idx === 0 ? 1 : -1;
        f.y = 0; f.vx = 0; f.vy = 0; f.hp = 100; f.shown = 100;
        f.state = "idle"; f.t = 0; f.move = null; f.stun = 0; f.combo = 0; f.comboT = 0;
        f.crouching = false; f.walking = false; f.hurt = false; f.flash = 0;
        f.bufP = f.bufK = f.bufS = 0;
        f.pose = Object.assign({}, IDLE);
        f.ai.timer = 30; f.ai.block = 0; f.ai.queue = [];
      }
      projectiles = [];
      particles = [];
      phase = "intro";
      phaseT = 0;
      timer = ROUND_FRAMES;
      hitstop = 0; shake = 0; superFreeze = 0; banner = null; paused = false;
      roundWinner = -1;
      cam.x = 3.4; cam.z = 4.0; cam.y = 1.9;
    }

    // --- Effects -------------------------------------------------------------
    function spark(x, y, kind, count) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * TAU, sp = 0.03 + Math.random() * 0.07;
        const col = kind === "block" ? [70, 150, 255] : kind === "coffee" ? [130, 78, 40] : [255, 200 + Math.random() * 55, 60];
        particles.push({ kind, x, y, z: 0.25 + Math.random() * 0.2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 0.02, vz: (Math.random() - 0.5) * 0.05,
          life: 14 + Math.random() * 10, max: 24, s: 0.05 + Math.random() * 0.05, col, rot: 0, vr: 0 });
      }
    }
    // Loose paperwork knocked flying by a heavy hit.
    function papers(x, y, dir, count) {
      for (let i = 0; i < count; i++) {
        particles.push({ kind: "paper", x, y, z: (Math.random() - 0.5) * 0.6, vx: dir * (0.02 + Math.random() * 0.06), vy: 0.04 + Math.random() * 0.07,
          vz: (Math.random() - 0.5) * 0.06, life: 70 + Math.random() * 50, max: 120, s: 0.09, col: [244, 244, 238], rot: Math.random() * TAU, vr: 0.2 + Math.random() * 0.3 });
      }
    }

    // --- Fighting ------------------------------------------------------------
    function crouched(f) {
      return f.y === 0 && (f.state === "attack" ? !!f.move.crouch : f.crouching);
    }
    function hurtBand(f) {
      if (f.y > 0) return [f.y + 0.25, f.y + 1.7];
      return crouched(f) ? [0, 1.2] : [0, 1.85];
    }
    function vulnerable(f) {
      return f.state !== "fall" && f.state !== "down" && f.state !== "getup" && f.state !== "win" && f.state !== "lose";
    }
    function canBlock(f, lvl) {
      if ((f.state !== "idle" && f.state !== "block") || f.y !== 0 || !f.holdBack) return false;
      if (lvl === "low") return f.holdDown;
      if (lvl === "high") return !f.holdDown;
      return true;
    }

    function landHit(att, def, dir, dmg, stun, kb, kd, blocked, special, hx, hy) {
      if (blocked) {
        def.state = "block";
        def.t = 0;
        def.stun = Math.round(stun * 0.6) + 2;
        def.vx = dir * kb * 1.2;
        def.crouching = def.holdDown;
        if (special) def.hp = Math.max(1, def.hp - dmg * 0.2);
        att.meter = Math.min(100, att.meter + 3);
        hitstop = 3;
        spark(hx, hy, "block", 6);
        sfx.block();
        return;
      }
      att.combo = def.state === "hit" ? att.combo + 1 : 1;
      att.comboT = 85;
      // Each extra hit in a combo does a little less.
      dmg *= Math.max(0.45, 1 - 0.12 * (att.combo - 1));
      def.hp = Math.max(0, def.hp - dmg);
      def.hurt = true;
      att.meter = Math.min(100, att.meter + dmg * 1.4);
      def.meter = Math.min(100, def.meter + dmg * 0.8);
      def.flash = 7;
      def.move = null;
      const heavy = kd || dmg >= 8.5;
      if (kd || def.y > 0 || def.hp <= 0) {
        def.state = "fall";
        def.vy = 0.07 + (def.hp <= 0 ? 0.03 : 0);
        def.vx = dir * (kb * 0.6 + 0.03);
        if (def.y <= 0) def.y = 0.01;
      } else {
        def.state = "hit";
        def.stun = stun;
        def.vx = dir * kb;
      }
      def.t = 0;
      hitstop = heavy ? 8 : 5;
      shake = Math.max(shake, heavy ? 8 : 3);
      hype = Math.min(1, hype + (heavy ? 0.5 : 0.25));
      spark(hx, hy, "hit", heavy ? 14 : 8);
      if (heavy) papers(def.x, 1.2, dir, 5);
      if (heavy) sfx.heavy();
      else sfx.hit();
    }

    function tryHit(att, def, m) {
      const dx = (def.x - att.x) * att.facing;
      const range = m.range * (att.isSuper ? 1.15 : 1);
      if (dx < -0.3 || dx > range || !vulnerable(def)) return;
      const band = hurtBand(def);
      const base = m.air || m.type === "upper" ? att.y : 0;
      if (base + m.hi < band[0] || base + m.lo > band[1]) return;
      att.hitDone = true;
      const blocked = canBlock(def, m.lvl);
      const dmg = m.dmg * att.ch.power * (att.isSuper ? 1.8 : 1);
      const hy = clamp(base + (m.lo + m.hi) / 2, band[0] + 0.2, band[1] - 0.15);
      landHit(att, def, att.facing, dmg, m.stun || 20, m.kb || 0.08, m.kd || att.isSuper, blocked, !!m.special, def.x - att.facing * 0.2, hy);
      att.connected = !blocked;
    }

    function startMove(f, m, isSuper) {
      f.state = "attack";
      f.move = m;
      f.t = 0;
      f.hitDone = false;
      f.connected = false;
      f.isSuper = !!isSuper;
      if (m.type === "proj") sfx.throw();
      else sfx.whoosh();
    }

    function tryStartAttack(f) {
      if (f.bufS > 0) {
        f.bufS = 0;
        const sp = f.ch.special;
        if (!(sp.type === "proj" && projectiles.some((p) => p.owner === f.idx))) {
          const sup = f.meter >= 100;
          if (sup) {
            // A full Synergy meter turns the next special into a super:
            // everything stops for a beat while the name is called.
            f.meter = 0;
            superFreeze = 40;
            banner = { text: sp.name + "!", idx: f.idx, t: 0 };
            sfx.super();
          }
          startMove(f, sp, sup);
          return true;
        }
      }
      if (f.bufK > 0) {
        f.bufK = 0;
        startMove(f, f.crouching ? MOVES.sweep : MOVES.kick);
        return true;
      }
      if (f.bufP > 0) {
        f.bufP = 0;
        startMove(f, f.crouching ? MOVES.lowp : MOVES.punch);
        return true;
      }
      return false;
    }

    function updateFighter(f, o, inp) {
      if (f.flash > 0) f.flash--;
      if (f.comboT > 0 && --f.comboT === 0) f.combo = 0;
      // Presses are remembered for a few frames so a button hit slightly
      // early (during recovery, or mid-combo) still comes out.
      f.bufP = inp.pP ? 9 : Math.max(0, f.bufP - 1);
      f.bufK = inp.pK ? 9 : Math.max(0, f.bufK - 1);
      f.bufS = inp.pS ? 9 : Math.max(0, f.bufS - 1);
      const dir = o.x >= f.x ? 1 : -1;
      const fwd = dir > 0 ? inp.r : inp.l;
      const back = dir > 0 ? inp.l : inp.r;
      f.holdBack = back;
      f.holdDown = inp.d;
      f.t++;

      switch (f.state) {
        case "idle":
          f.facing = dir;
          f.crouching = inp.d;
          f.walking = false;
          if (tryStartAttack(f)) break;
          if (inp.u && !inp.d) {
            f.state = "jump";
            f.t = 0;
            f.vy = JUMP_V;
            f.vx = (fwd ? 1 : back ? -1 : 0) * dir * f.ch.speed * 1.15;
            f.airUsed = false;
            f.crouching = false;
            sfx.jump();
            break;
          }
          if (!f.crouching) {
            if (fwd) { f.x += dir * f.ch.speed; f.walking = true; f.walkPh += 0.24; }
            else if (back) { f.x -= dir * f.ch.speed * 0.78; f.walking = true; f.walkPh -= 0.2; }
          }
          break;
        case "jump":
          f.y += f.vy; f.vy -= GRAV; f.x += f.vx;
          if (!f.airUsed && (f.bufK > 0 || f.bufP > 0)) {
            f.bufK = f.bufP = 0;
            f.airUsed = true;
            startMove(f, MOVES.airk);
          } else if (f.y <= 0) {
            f.y = 0; f.vy = 0; f.state = "idle";
          }
          break;
        case "attack": {
          const m = f.move;
          if (m.air) {
            f.y += f.vy; f.vy -= GRAV; f.x += f.vx;
            if (f.y <= 0) { f.y = 0; f.vy = 0; f.state = "idle"; f.move = null; break; }
          }
          if (m.type === "lunge" && f.t >= m.a[0] && f.t <= m.a[1]) f.x += f.facing * m.dash * (f.isSuper ? 1.3 : 1);
          if (m.type === "upper" && f.t >= m.a[0]) {
            if (f.t === m.a[0]) f.vy = m.hop * (f.isSuper ? 1.2 : 1);
            f.y += f.vy; f.vy -= GRAV; f.x += f.facing * m.dash;
            if (f.y < 0) { f.y = 0; f.vy = 0; }
          }
          if (m.type === "proj" && f.t === m.rel) {
            const k = f.isSuper ? 1.35 : 1;
            projectiles.push({ owner: f.idx, kind: m.kind, x: f.x + f.facing * 0.6, y: 1.4, vx: f.facing * m.vx * k, vy: m.vy, g: m.g,
              dmg: m.dmg * f.ch.power * (f.isSuper ? 1.8 : 1), stun: m.stun, kb: m.kb, kd: f.isSuper, big: f.isSuper ? 1.9 : 1, rot: 0, vr: f.facing * -0.35 });
          }
          if (m.type === "splash" && f.t === m.a[0]) {
            for (let i = 0; i < 16; i++) {
              particles.push({ kind: "coffee", x: f.x + f.facing * 0.6, y: 1.35, z: 0.2, vx: f.facing * (0.05 + Math.random() * 0.07), vy: 0.01 + Math.random() * 0.05,
                vz: (Math.random() - 0.5) * 0.03, life: 18 + Math.random() * 8, max: 26, s: 0.07, col: [124, 74, 38], rot: 0, vr: 0 });
            }
          }
          if (m.type !== "proj" && !f.hitDone && f.t >= m.a[0] && f.t <= m.a[1]) tryHit(f, o, m);
          // Light attacks that connect can be cut short into something bigger.
          if (f.connected && m.cancel && f.t > m.a[0] + 1) {
            if (f.bufS > 0 || f.bufK > 0) { f.state = "idle"; f.move = null; if (tryStartAttack(f)) break; }
          }
          if (f.t >= m.dur && !(m.type === "upper" && f.y > 0)) { f.state = "idle"; f.move = null; }
          break;
        }
        case "hit":
        case "block":
          f.x += f.vx; f.vx *= 0.84;
          if (--f.stun <= 0) f.state = "idle";
          break;
        case "fall":
          f.y += f.vy; f.vy -= GRAV; f.x += f.vx;
          if (f.y <= 0 && f.vy < 0) {
            f.y = 0; f.vy = 0; f.state = "down"; f.t = 0;
            shake = Math.max(shake, 5);
            sfx.thud();
            papers(f.x, 0.3, -f.facing, 3);
          }
          break;
        case "down":
          f.x += f.vx; f.vx *= 0.8;
          if (f.hp > 0 && f.t > 34) { f.state = "getup"; f.t = 0; }
          break;
        case "getup":
          if (f.t > 22) f.state = "idle";
          break;
      }
      f.x = clamp(f.x, -BOUND, BOUND);
    }

    // The CPU plays through the same input struct a person does.
    function think(f, o) {
      const ai = f.ai, lv = f.level;
      const inp = { l: ai.hold.l, r: ai.hold.r, u: false, d: ai.hold.d, pP: false, pK: false, pS: false };
      const dir = o.x >= f.x ? 1 : -1;
      const dist = Math.abs(o.x - f.x);
      const setHold = (fwd, back, down) => {
        ai.hold.l = dir > 0 ? back : fwd;
        ai.hold.r = dir > 0 ? fwd : back;
        ai.hold.d = !!down;
        inp.l = ai.hold.l; inp.r = ai.hold.r; inp.d = ai.hold.d;
      };

      // Defence: notice an incoming attack once, then decide whether (and
      // how well) to deal with it.
      const incoming = projectiles.find((p) => p.owner !== f.idx && Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.x - f.x) < 2.0);
      const swing = o.state === "attack" && o.move && !o.hitDone && o.move.type !== "proj" && dist < (o.move.range || 1) + 0.5 && o.t <= o.move.a[1];
      if (incoming || swing) {
        if (!ai.reacted) {
          ai.reacted = true;
          const roll = Math.random();
          const blockP = 0.2 + lv * 0.6;
          if (roll < blockP) {
            ai.block = 20;
            const lvl = swing ? o.move.lvl : "mid";
            ai.blockLow = lvl === "low" ? Math.random() < 0.35 + lv * 0.55 : lvl === "high" ? Math.random() < 0.3 - lv * 0.25 : false;
          } else if (incoming && roll < blockP + 0.25 && f.state === "idle") {
            inp.u = true;
            setHold(true, false, false);
            ai.timer = 30;
            return inp;
          }
        }
      } else ai.reacted = false;
      if (ai.block > 0) {
        ai.block--;
        setHold(false, true, ai.blockLow);
        return inp;
      }

      if (f.state === "attack" && f.connected && f.move.cancel && Math.random() < 0.08 + lv * 0.25) {
        if (Math.random() < 0.6) inp.pK = true;
        else inp.pS = true;
      }
      if (ai.airKick && f.state === "jump" && f.vy < 0.02 && dist < 1.5) {
        inp.pK = true;
        ai.airKick = false;
      }
      if (f.state !== "idle") return inp;

      if (--ai.timer > 0) return inp;
      ai.timer = Math.round(lerp(34, 12, lv) + Math.random() * 14);
      setHold(false, false, false);
      if (!vulnerable(o)) {
        // Opponent is on the floor: back off a little rather than hover.
        if (dist < 1.2) setHold(false, true, false);
        return inp;
      }
      const sp = f.ch.special;
      const ranged = sp.type === "proj" || sp.type === "lunge";
      const pick = (opts) => {
        let total = 0;
        for (const o2 of opts) total += o2[1];
        let r = Math.random() * total;
        for (const o2 of opts) if ((r -= o2[1]) <= 0) return o2[0];
        return opts[0][0];
      };
      let act;
      if (dist > 2.4) act = pick([["approach", 5], ["special", ranged ? 1.5 + lv * 2 : 0], ["jumpIn", 0.8], ["wait", 1.2 - lv]]);
      else if (dist > 1.3) act = pick([["approach", 4], ["special", ranged ? 1 + lv : sp.type === "splash" ? 1.5 : 0.3], ["jumpIn", 1 + lv], ["retreat", 0.7], ["wait", 1 - lv * 0.6]]);
      else act = pick([["punch", dist < 1.0 ? 3 : 0.5], ["kick", 3], ["sweep", 1.5 + lv], ["special", ranged ? 0.6 : 2], ["retreat", 0.9], ["block", 0.8], ["wait", 0.8 - lv * 0.6]]);
      switch (act) {
        case "approach": setHold(true, false, false); break;
        case "retreat": setHold(false, true, false); break;
        case "block": ai.block = 24; ai.blockLow = Math.random() < 0.3; break;
        case "punch": inp.pP = true; break;
        case "kick": inp.pK = true; break;
        case "sweep": setHold(false, false, true); inp.pK = true; f.crouching = true; ai.timer = 14; break;
        case "special": inp.pS = true; break;
        case "jumpIn": inp.u = true; setHold(true, false, false); ai.airKick = true; break;
      }
      return inp;
    }

    function tickFight() {
      if (pressed.has("Enter") && phase === "fight") {
        paused = !paused;
        sfx.blip();
      }
      if (paused) return;
      time++;
      phaseT++;
      hype *= 0.985;
      if (shake > 0) shake--;
      if (banner && ++banner.t > 80) banner = null;

      let step = true;
      if (superFreeze > 0) { superFreeze--; step = false; }
      else if (hitstop > 0) { hitstop--; step = false; }
      // The knockout plays out in slow motion.
      if (phase === "ko" && phaseT < 50 && phaseT % 3 !== 0) step = false;

      if (phase === "intro") {
        if (phaseT === 24) sfx.announce();
        if (phaseT === 84) sfx.bell();
        if (phaseT >= 110) { phase = "fight"; phaseT = 0; music("fight"); }
      }

      if (step) {
        const f0 = fighters[0], f1 = fighters[1];
        const live = phase === "fight";
        const i0 = live ? (f0.cpu ? think(f0, f1) : readInput(0)) : EMPTY;
        const i1 = live ? (f1.cpu ? think(f1, f0) : readInput(1)) : EMPTY;
        updateFighter(f0, f1, i0);
        updateFighter(f1, f0, i1);

        // Two bodies can't share a spot unless one is clearing the other.
        if (Math.abs(f0.y - f1.y) < 0.9) {
          const dx = f1.x - f0.x;
          if (Math.abs(dx) < MIN_GAP) {
            const push = (MIN_GAP - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
            f0.x = clamp(f0.x - push, -BOUND, BOUND);
            f1.x = clamp(f1.x + push, -BOUND, BOUND);
            if (Math.abs(f1.x - f0.x) < MIN_GAP - 0.001) {
              if (f0.x <= -BOUND || f1.x <= -BOUND) (f0.x < f1.x ? f1 : f0).x = Math.min(f0.x, f1.x) + MIN_GAP;
              else (f0.x < f1.x ? f0 : f1).x = Math.max(f0.x, f1.x) - MIN_GAP;
            }
          }
        }

        for (const p of projectiles) {
          p.x += p.vx; p.y += p.vy; p.vy -= p.g; p.rot += p.vr;
          const def = fighters[1 - p.owner];
          if (Math.abs(p.x - def.x) < 0.38 && vulnerable(def)) {
            const band = hurtBand(def);
            if (p.y >= band[0] - 0.1 && p.y <= band[1] + 0.1) {
              landHit(fighters[p.owner], def, Math.sign(p.vx) || 1, p.dmg, p.stun, p.kb, p.kd, canBlock(def, "mid"), true, p.x, p.y);
              p.dead = true;
            }
          }
          for (const q of projectiles) {
            if (q !== p && q.owner !== p.owner && !q.dead && Math.abs(q.x - p.x) < 0.35 && Math.abs(q.y - p.y) < 0.45) {
              p.dead = q.dead = true;
              spark(p.x, p.y, "block", 8);
              sfx.block();
            }
          }
          if (Math.abs(p.x) > 7 || p.y < 0) p.dead = true;
        }
        projectiles = projectiles.filter((p) => !p.dead);

        for (const p of particles) {
          p.x += p.vx; p.y += p.vy; p.z += p.vz; p.rot += p.vr; p.life--;
          if (p.kind === "paper") { p.vy -= 0.0016; p.vx *= 0.96; p.vy = Math.max(p.vy, -0.02); if (p.y < 0.02) { p.y = 0.02; p.vx = 0; p.vr = 0; } }
          else p.vy -= 0.004;
        }
        particles = particles.filter((p) => p.life > 0);

        for (const f of fighters) f.shown = f.shown > f.hp ? Math.max(f.hp, f.shown - 0.5) : f.hp;

        if (phase === "fight") {
          timer--;
          if (timer > 0 && timer <= 600 && timer % 60 === 0) sfx.tick();
          const ko0 = f0.hp <= 0, ko1 = f1.hp <= 0;
          if (ko0 || ko1 || timer <= 0) {
            timeUp = !ko0 && !ko1;
            roundWinner = ko0 && ko1 ? -1 : ko0 ? 1 : ko1 ? 0 : f0.hp === f1.hp ? -1 : f0.hp > f1.hp ? 0 : 1;
            perfect = roundWinner >= 0 && !fighters[roundWinner].hurt;
            if (roundWinner >= 0) fighters[roundWinner].wins++;
            phase = "ko";
            phaseT = 0;
            hype = 1;
            music(null);
            if (timeUp) sfx.bell();
            else sfx.ko();
          }
        }
      }

      if (phase === "ko") {
        if (phaseT > 70) {
          for (const f of fighters) {
            if (f.state !== "idle") continue;
            if (f.idx === roundWinner) { f.state = "win"; f.t = 0; }
            else if (roundWinner >= 0) { f.state = "lose"; f.t = 0; }
          }
        }
        if (phaseT === 96 && roundWinner >= 0) (fighters[roundWinner].cpu ? sfx.lose : sfx.win)();
        if (phaseT > 230) {
          if (roundWinner >= 0 && fighters[roundWinner].wins >= 2) {
            matchWinner = roundWinner;
            goto("victory");
            music("menu");
          } else {
            round++;
            startRound();
            fade = 1;
          }
        }
      }

      // Camera: frame both fighters, pulling back as they separate.
      const f0 = fighters[0], f1 = fighters[1];
      let tx = clamp((f0.x + f1.x) / 2, -2.9, 2.9);
      let dist = 4.3 + Math.max(0, Math.abs(f0.x - f1.x) - 1.8) * 0.62;
      let ang = Math.sin(time * 0.004) * 0.2;
      const lift = Math.max(f0.y, f1.y);
      if (phase === "intro") ang += (1 - smooth(clamp(phaseT / 90, 0, 1))) * 0.9;
      if (phase === "ko" && phaseT > 60 && roundWinner >= 0) {
        tx = fighters[roundWinner].x;
        dist = 3.5;
        ang = fighters[roundWinner].facing * -0.35;
      }
      const k = phase === "intro" ? 0.07 : 0.1;
      cam.x = lerp(cam.x, tx + Math.sin(ang) * dist, k);
      cam.z = lerp(cam.z, Math.cos(ang) * dist, k);
      cam.y = lerp(cam.y, 1.45 + lift * 0.2, k);
      cam.tx = lerp(cam.tx, tx, k);
      cam.ty = lerp(cam.ty, 1.0 + lift * 0.35, k);
    }

    function confirmPressed() {
      return pressed.has("Enter") || pressed.has("Space") || pressed.has("T_OK") || anyPressed(SOLO.p);
    }

    function buildLadder(me) {
      // Everyone else in a random order, with the boss (or, if you ARE the
      // boss, the heir apparent) saved for last.
      const last = me === 5 ? 0 : 5;
      const rest = ROSTER.map((_, i) => i).filter((i) => i !== me && i !== last);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
      }
      ladder = rest.concat([last]);
      ladderIdx = 0;
    }
    const cpuLevel = () => 0.12 + (ladderIdx / Math.max(1, ladder.length - 1)) * 0.8;

    function tick() {
      sceneT++;
      if (fade > 0) fade = Math.max(0, fade - 0.06);
      switch (scene) {
        case "boot":
          time++;
          if (sceneT > 170 || (sceneT > 20 && (pressed.size > 0))) { goto("title"); music("menu"); }
          break;
        case "title":
          time++;
          music("menu");
          if (anyPressed(SOLO.u) || anyPressed(SOLO.d)) { menuIdx = 1 - menuIdx; sfx.blip(); }
          if (sceneT > 15 && confirmPressed()) {
            mode = menuIdx === 0 ? "arcade" : "versus";
            locked[0] = locked[1] = false;
            sfx.ok();
            goto("select");
          }
          break;
        case "select": {
          time++;
          const players = mode === "arcade" ? 1 : 2;
          for (let p = 0; p < players; p++) {
            if (locked[p]) continue;
            const set = mode === "arcade" ? SOLO : KEYSETS[p];
            const left = anyPressed(set.l) || (p === 0 && pressed.has("T_L"));
            const right = anyPressed(set.r) || (p === 0 && pressed.has("T_R"));
            if (left) { sel[p] = (sel[p] + ROSTER.length - 1) % ROSTER.length; sfx.blip(); }
            if (right) { sel[p] = (sel[p] + 1) % ROSTER.length; sfx.blip(); }
            const ok = anyPressed(set.p) || (p === 0 && (pressed.has("Enter") || pressed.has("Space") || pressed.has("T_OK")));
            if (sceneT > 12 && ok) { locked[p] = true; sfx.ok(); sceneT = 100; }
          }
          if (locked[0] && (players === 1 || locked[1]) && sceneT > 135) {
            if (mode === "arcade") {
              buildLadder(sel[0]);
              startMatch(sel[0], ladder[0], true, cpuLevel());
            } else startMatch(sel[0], sel[1], false, 0);
          }
          break;
        }
        case "vs":
          time++;
          if (sceneT === 30) sfx.announce();
          if (sceneT > 200 || (sceneT > 40 && confirmPressed())) {
            startRound();
            goto("fight");
            music(null);
          }
          break;
        case "fight":
          tickFight();
          break;
        case "victory":
          time++;
          hype = Math.max(hype * 0.99, 0.6);
          if (sceneT > 70 && (confirmPressed() || sceneT > 720)) {
            if (mode === "versus") { locked[0] = locked[1] = false; goto("select"); }
            else if (matchWinner === 0) {
              ladderIdx++;
              if (ladderIdx >= ladder.length) goto("ending");
              else startMatch(sel[0], ladder[ladderIdx], true, cpuLevel());
            } else goto("continue");
          }
          break;
        case "continue":
          time++;
          if (sceneT % 60 === 0 && sceneT < 600) sfx.tick();
          if (sceneT > 20 && confirmPressed()) { sfx.ok(); startMatch(sel[0], ladder[ladderIdx], true, cpuLevel()); }
          else if (sceneT > 630) goto("title");
          break;
        case "ending":
          time++;
          hype = 1;
          if (sceneT === 10) sfx.win();
          if (sceneT > 150 && confirmPressed()) goto("title");
          break;
      }
      pressed.clear();
    }

    // --- Rendering -------------------------------------------------------------
    function fighterTarget(f) {
      switch (f.state) {
        case "idle":
          if (f.crouching) return CROUCH;
          if (f.walking) {
            const s = Math.sin(f.walkPh), c = Math.cos(f.walkPh);
            return P({ lean: 0.16, hL: 0.15 + 0.5 * s, kL: 0.3 + 0.4 * Math.max(0, c), hR: 0.15 - 0.5 * s, kR: 0.3 + 0.4 * Math.max(0, -c) });
          }
          {
            const b = Math.sin(time * 0.11 + f.idx * 2);
            return P({ lean: 0.12 + b * 0.02, sL: 0.75 + b * 0.05, sR: 0.45 - b * 0.05, hL: 0.5 + b * 0.03, kL: 0.75 + b * 0.06, hR: -0.3 - b * 0.02, kR: 0.25 + b * 0.05 });
          }
        case "jump": return POSES.jump;
        case "attack": return sample(f.move.kf, f.t);
        case "hit": return f.crouching ? POSES.hitC : POSES.hit;
        case "block": return f.crouching ? POSES.blockC : POSES.block;
        case "fall": return POSES.fall;
        case "down": return POSES.down;
        case "getup": return f.t < 10 ? mixPose(POSES.down, CROUCH, f.t / 10) : mixPose(CROUCH, IDLE, smooth(clamp((f.t - 10) / 12, 0, 1)));
        case "win": {
          const b = Math.sin(f.t * 0.2);
          return P({ lean: -0.06, head: 0.2, sL: 2.8 + b * 0.25, eL: 0.25, sR: 2.7 - b * 0.25, eR: 0.3, hL: 0.2, kL: 0.3 + Math.max(0, b) * 0.3, hR: -0.1, kR: 0.2 + Math.max(0, b) * 0.3 });
        }
        case "lose": return POSES.lose;
      }
      return IDLE;
    }

    function drawFighter(f, frozen) {
      if (!frozen) mixPose(f.pose, fighterTarget(f), f.state === "attack" ? 0.6 : 0.32, f.pose);
      const sup = f.isSuper && f.state === "attack";
      if (f.flash > 0) { tintR = tintG = tintB = f.flash * 26; }
      else if (sup) { tintR = 70; tintG = 54; tintB = 0; }
      const o = { ouch: f.state === "hit" || f.state === "fall" || f.state === "down" || f.state === "lose", item: null };
      const m = f.move;
      if (f.state === "attack" && m.special) {
        if (m.type === "proj") o.item = f.t < m.rel ? m.kind : null;
        else if (m.kind) o.item = m.kind;
      }
      const savedDim = dim;
      if (sup) dim = 1.15;
      drawBody(f.ch, f.x, f.y, f.facing, f.pose, YAW, o);
      dim = savedDim;
      tintR = tintG = tintB = 0;
    }

    function drawShadow(x, y, size) {
      const s = size * clamp(1 - y * 0.25, 0.45, 1);
      const pts = [];
      for (let i = 0; i < 6; i++) pts.push([x + Math.cos((i / 6) * TAU) * s, 0.02, Math.sin((i / 6) * TAU) * s * 0.6]);
      flatQuad(pts[0], pts[1], pts[2], pts[3], 0, 0, 0, 1);
      flatQuad(pts[0], pts[3], pts[4], pts[5], 0, 0, 0, 1);
    }

    function drawParticles() {
      for (const p of particles) {
        const s = p.s * (p.kind === "paper" ? 1 : p.life / p.max + 0.3);
        // Billboards built from the camera's own right/up vectors; paper
        // also spins and folds as it flutters down.
        const c = Math.cos(p.rot), sn = Math.sin(p.rot);
        const fold = p.kind === "paper" ? 0.35 + 0.65 * Math.abs(Math.cos(p.rot * 0.7)) : 1;
        const ax = (crx * c + cux * sn) * s, ay = cuy * sn * s, az = (crz * c + cuz * sn) * s;
        const bx = (-crx * sn + cux * c) * s * fold, by = cuy * c * s * fold, bz = (-crz * sn + cuz * c) * s * fold;
        const q = (sa, sb) => [p.x + ax * sa + bx * sb, p.y + ay * sa + by * sb, p.z + az * sa + bz * sb];
        const fadeK = p.kind === "paper" ? 1 : clamp(p.life / 10, 0, 1);
        flatQuad(q(-1, -1), q(1, -1), q(1, 1), q(-1, 1), (p.col[0] * fadeK) | 0, (p.col[1] * fadeK) | 0, (p.col[2] * fadeK) | 0, p.kind === "hit" || p.kind === "block" ? 2 : 0);
      }
    }

    function clearTo(col) {
      fb.fill(col);
      zb.fill(0);
    }

    function hudBar(idx, f) {
      const BW = 138;
      const x0 = idx === 0 ? 18 : 204;
      rect(x0 - 2, 10, BW + 4, 13, WHITE);
      rect(x0 - 1, 11, BW + 2, 11, BLACK);
      rect(x0, 12, BW, 9, rgb(110, 22, 22));
      const lagW = Math.round((f.shown / 100) * BW), hpW = Math.round((f.hp / 100) * BW);
      const low = f.hp < 25 && (time >> 3) & 1;
      // Bars drain toward the outside edge, anchored at the timer.
      for (let i = 0; i < 9; i++) {
        const shade = i < 2 ? 40 : i > 6 ? -50 : 0;
        const col = low ? rgb(255, 90 + shade / 2, 60) : rgb(clamp(250 + shade, 0, 255), clamp(206 + shade, 0, 255), 40);
        if (idx === 0) { rect(x0 + BW - lagW, 12 + i, lagW, 1, rgb(250, 250, 250)); rect(x0 + BW - hpW, 12 + i, hpW, 1, col); }
        else { rect(x0, 12 + i, lagW, 1, rgb(250, 250, 250)); rect(x0, 12 + i, hpW, 1, col); }
      }
      text(f.ch.name, idx === 0 ? 18 : 342, 26, idx === 0 ? CYAN : ORANGE, 1, idx === 0 ? 0 : 2);
      for (let i = 0; i < 2; i++) {
        const px = idx === 0 ? 150 - i * 11 : 210 + i * 11;
        ring(px, 30, 4, i < f.wins ? (prize === "donut" ? PINK : YELLOW) : rgb(70, 70, 80), false);
      }
      // Synergy meter.
      const mx = idx === 0 ? 18 : 272, MW = 70;
      rect(mx - 1, 36, MW + 2, 5, BLACK);
      const mw = Math.round((f.meter / 100) * MW);
      const full = f.meter >= 100;
      const mcol = full ? ((time >> 2) & 1 ? WHITE : YELLOW) : rgb(80, 170, 250);
      if (idx === 0) rect(mx, 37, mw, 3, mcol);
      else rect(mx + MW - mw, 37, mw, 3, mcol);
      if (full) text("SYNERGY MAX!", idx === 0 ? 94 : 266, 35, YELLOW, 1, idx === 0 ? 0 : 2);
      if (f.combo >= 2 && f.comboT > 0) {
        text(f.combo + " HITS!", idx === 0 ? 18 : 342, 52, YELLOW, 2, idx === 0 ? 0 : 2);
      }
    }

    function drawTouch() {
      ring(PAD.x, PAD.y, 34, WHITE, true);
      text("<", PAD.x - 26, PAD.y - 3, WHITE, 1, 0);
      text(">", PAD.x + 21, PAD.y - 3, WHITE, 1, 0);
      text("^", PAD.x - 2, PAD.y - 28, WHITE, 1, 0);
      text("_", PAD.x - 2, PAD.y + 20, WHITE, 1, 0);
      for (const b of BTNS) {
        ring(b.x, b.y, 15, b.id === "T_S" ? YELLOW : WHITE, true);
        text(b.label, b.x - 2, b.y - 3, b.id === "T_S" ? YELLOW : WHITE, 1, 0);
      }
    }

    function renderFight() {
      clearTo(STAGES[stage].sky);
      const sh = shake > 0 ? shake * 0.012 : 0;
      setCamera(cam.x + (Math.random() - 0.5) * sh, cam.y + (Math.random() - 0.5) * sh, cam.z, cam.tx, cam.ty, 0);
      dim = superFreeze > 0 ? 0.42 : 1;
      drawStage(stage, time, prize, crowd, hype);
      for (const f of fighters) drawShadow(f.x, f.y, 0.42);
      for (const p of projectiles) drawShadow(p.x, p.y, 0.14);
      dim = 1;
      const frozen = paused || superFreeze > 0 || hitstop > 0;
      for (const f of fighters) drawFighter(f, frozen);
      for (const p of projectiles) {
        const it = ITEMS[p.kind];
        rbox(p.x, p.y, 0.25, p.rot, it.l * p.big, it.t * p.big, it.w * p.big, it.col);
      }
      drawParticles();

      hudBar(0, fighters[0]);
      hudBar(1, fighters[1]);
      const secs = Math.max(0, Math.ceil(timer / 60));
      rect(165, 8, 30, 21, BLACK);
      rect(166, 9, 28, 19, rgb(40, 34, 60));
      text((secs < 10 ? "0" : "") + secs, CX, 12, secs <= 10 ? RED : WHITE, 2, 1);

      if (banner) {
        const y = 196;
        shadeRect(0, y - 6, W, 26);
        const slide = Math.max(0, 12 - banner.t) * 20 * (banner.idx === 0 ? -1 : 1);
        bigText(banner.text, y, 2, banner.idx === 0 ? ICE : FIRE, CX + slide);
      }

      if (phase === "intro") {
        if (phaseT > 20 && phaseT < 80) bigText(round >= 3 ? "FINAL ROUND" : "ROUND " + round, 92, 4);
        else if (phaseT >= 84) bigText("FIGHT!", 84, 6);
        if (phaseT > 20 && phaseT < 80) text("FOR THE LAST " + (prize === "donut" ? "DONUT" : "SLICE"), CX, 132, WHITE, 1, 1);
      } else if (phase === "ko") {
        if (phaseT < 96) {
          if (timeUp) { bigText("MEETING", 76, 4, ICE); bigText("ADJOURNED", 112, 4, ICE); }
          else if (roundWinner < 0) bigText("DOUBLE K.O.", 96, 4);
          else if (fighters[roundWinner].wins >= 2) bigText("YOU'RE FIRED!", 92, 4);
          else bigText("K.O.!", 80, 8);
        } else if (roundWinner >= 0) {
          bigText(fighters[roundWinner].ch.name + " WINS", 78, 4, roundWinner === 0 ? ICE : FIRE);
          if (perfect) bigText("FLAWLESS REVIEW!", 118, 2);
        } else bigText("NO ONE EATS", 96, 4, ICE);
      }
      if (paused) {
        shadeRect(0, 0, W, H);
        shadeRect(60, 50, 240, 150);
        bigText("PAUSED", 60, 4, ICE);
        const sp = fighters[0].ch.special;
        const lines = mode === "arcade"
          ? ["MOVE   ARROWS OR WASD", "PUNCH  J  (ALSO Z, F)", "KICK   K  (ALSO X, G)", "SPECIAL L (ALSO C, H)", "", "HOLD BACK TO BLOCK", "DOWN+KICK SWEEPS, JUMP+KICK DIVES", "SPECIAL: " + sp.name, "FULL SYNERGY = SUPER " + sp.name]
          : ["P1  WASD  +  F  G  H", "P2  ARROWS  +  J  K  L", "    (OR  ,  .  /)", "", "PUNCH / KICK / SPECIAL", "HOLD BACK TO BLOCK", "DOWN+KICK SWEEPS, JUMP+KICK DIVES", "FULL SYNERGY = SUPER SPECIAL"];
        lines.forEach((l, i) => text(l, 76, 100 + i * 10, i > 4 ? YELLOW : WHITE, 1, 0));
        text("ENTER TO RESUME   M: MUSIC", CX, 204, GRAY, 1, 1);
      } else if (touchUI && mode === "arcade") drawTouch();
    }

    // A plain dark studio for the menus that show fighters off.
    function studio(col) {
      clearTo(col);
      setCamera(0, 1.3, 3.9, 0, 1.0, 0);
      dim = 1;
      bigQuad([-8, 0, -6], [8, 0, -6], [8, 0, 4], [-8, 0, 4], { tex: TEX.grid, uv: [time * 0.004, 0, 16 + time * 0.004, 10], nu: 10, nv: 8, lit: 1 });
    }

    function showcase(ch, x, facing, yaw, pose) {
      drawShadow(x, 0, 0.42);
      drawBody(ch, x, 0, facing, pose, yaw, null);
    }
    const breathing = () => {
      const b = Math.sin(time * 0.1);
      return P({ lean: 0.12 + b * 0.02, sL: 0.75 + b * 0.05, sR: 0.45 - b * 0.05, kL: 0.75 + b * 0.06, kR: 0.25 + b * 0.05 });
    };
    function statBar(label, v, x, y) {
      text(label, x, y, GRAY, 1, 0);
      for (let i = 0; i < 5; i++) rect(x + 30 + i * 9, y, 7, 7, i < v ? YELLOW : rgb(60, 54, 80));
    }

    function renderSelect() {
      studio(rgb(26, 20, 44));
      const versus = mode === "versus";
      const c0 = ROSTER[sel[0]], c1 = ROSTER[sel[1]];
      const winP = (t) => P({ lean: -0.06, head: 0.2, sL: 2.8 + Math.sin(t * 0.2) * 0.25, eL: 0.25, sR: 2.7 - Math.sin(t * 0.2) * 0.25, eR: 0.3, hL: 0.2, kL: 0.3, hR: -0.1, kR: 0.2 });
      showcase(c0, versus ? -1.25 : -1.05, 1, 0.7 + Math.sin(time * 0.02) * 0.5, locked[0] ? winP(time) : breathing());
      if (versus) showcase(c1, 1.25, -1, 0.7 + Math.sin(time * 0.02 + 2) * 0.5, locked[1] ? winP(time) : breathing());

      bigText("CHOOSE YOUR EMPLOYEE", 10, 2);
      if (versus) {
        text(c0.full, 12, 34, CYAN, 1, 0);
        text(c0.title, 12, 44, GRAY, 1, 0);
        text(c1.full, 348, 34, ORANGE, 1, 2);
        text(c1.title, 348, 44, GRAY, 1, 2);
        text("SPECIAL: " + c0.special.name, 12, 178, WHITE, 1, 0);
        text("SPECIAL: " + c1.special.name, 348, 178, WHITE, 1, 2);
        bigText("VS", 96, 4, ICE);
      } else {
        const x = 190;
        text(c0.full, x, 42, CYAN, 1, 0);
        text(c0.title, x, 53, GRAY, 1, 0);
        statBar("PWR", c0.pow, x, 72);
        statBar("SPD", c0.spd, x, 84);
        text("SPECIAL", x, 104, GRAY, 1, 0);
        text(c0.special.name, x, 115, YELLOW, 1, 0);
        // Word-wrap the win quote into the panel.
        const lines = [""];
        for (const word of ('"' + c0.quote + '"').split(" ")) {
          if (lines[lines.length - 1].length + word.length > 26) lines.push("");
          lines[lines.length - 1] += (lines[lines.length - 1] ? " " : "") + word;
        }
        lines.forEach((l, i) => text(l, x, 136 + i * 11, WHITE, 1, 0));
      }
      for (let i = 0; i < ROSTER.length; i++) {
        const x = 9 + i * 57, y = 196;
        const p1 = sel[0] === i, p2 = versus && sel[1] === i;
        rect(x, y, 54, 30, p1 && p2 ? WHITE : p1 ? CYAN : p2 ? ORANGE : rgb(70, 62, 96));
        rect(x + 2, y + 2, 50, 26, rgb(34, 28, 56));
        const ch = ROSTER[i];
        rect(x + 4, y + 4, 12, 12, rgb(ch.skin[0], ch.skin[1], ch.skin[2]));
        rect(x + 4, y + 4, 12, 3, rgb(ch.hairCol[0], ch.hairCol[1], ch.hairCol[2]));
        rect(x + 4, y + 16, 12, 8, rgb(ch.jacket[0], ch.jacket[1], ch.jacket[2]));
        text(ch.name, x + 20, y + 6, p1 || p2 ? WHITE : GRAY, 1, 0);
        if (p1) text(locked[0] ? "OK!" : "1P", x + 20, y + 17, CYAN, 1, 0);
        if (p2) text(locked[1] ? "OK!" : "2P", x + (p1 ? 38 : 20), y + 17, ORANGE, 1, 0);
      }
      if ((time >> 4) & 1) {
        const hint = touchUI ? "TAP SIDES TO CHOOSE - TAP CENTER TO CONFIRM" : versus ? "P1: A/D + F     P2: ARROWS + J" : "LEFT/RIGHT TO CHOOSE - ENTER TO CONFIRM";
        text(hint, CX, 230, WHITE, 1, 1);
      }
    }

    function renderVs() {
      studio(rgb(44, 16, 22));
      const f0 = fighters[0], f1 = fighters[1];
      const slide = Math.max(0, 30 - sceneT) * 0.12;
      showcase(f0.ch, -1.3 - slide, 1, 0.5, breathing());
      showcase(f1.ch, 1.3 + slide, -1, 0.5, breathing());
      text(f0.ch.full, 14, 20, CYAN, 1, 0);
      text(f0.ch.title, 14, 31, GRAY, 1, 0);
      text(f1.ch.full, 346, 20, ORANGE, 1, 2);
      text(f1.ch.title, 346, 31, GRAY, 1, 2);
      if (sceneT > 28) bigText("VS", 86, 8);
      if (mode === "arcade") text("MEETING " + (ladderIdx + 1) + " OF " + ladder.length, CX, 180, WHITE, 1, 1);
      text(STAGES[stage].name, CX, 194, YELLOW, 2, 1);
      text("AT STAKE: THE LAST " + (prize === "donut" ? "DONUT" : "SLICE OF PIZZA"), CX, 218, WHITE, 1, 1);
    }

    function renderTitle(boot) {
      clearTo(STAGES[0].sky);
      const a = time * 0.004;
      setCamera(Math.sin(a) * 3.2 + 0.5, 1.7, 2.4 + Math.cos(a) * 0.8, 0.6, 1.15, -2.8);
      dim = 0.6;
      drawStage(0, time, (time >> 9) & 1 ? "pizza" : "donut", titleCrowd, 0.15);
      dim = 1;
      if (boot) {
        // Fade the company card in and out over black, console-style.
        const k = clamp(Math.min(sceneT / 40, (170 - sceneT) / 40), 0, 1);
        fb.fill(BLACK);
        const c = (v) => rgb((v[0] * k) | 0, (v[1] * k) | 0, (v[2] * k) | 0);
        text("THAGOBYTE", CX, 92, c([250, 169, 104]), 4, 1, null);
        text("PRESENTS", CX, 132, c([246, 220, 172]), 1, 1, null);
        return;
      }
      shadeRect(0, 0, W, H);
      const bob = Math.round(Math.sin(time * 0.05) * 2);
      bigText("WATER COOLER", 26 + bob, 4, ICE);
      bigText("COMBAT", 62 + bob, 8, FIRE);
      text("BATTLE FOR THE LAST DONUT", CX, 126, WHITE, 1, 1);
      const items = ["ARCADE", "VERSUS  2P"];
      for (let i = 0; i < 2; i++) {
        const on = menuIdx === i;
        text((on ? "> " : "  ") + items[i], CX - 66, 146 + i * 21, on ? YELLOW : GRAY, 2, 0);
      }
      if ((time >> 4) & 1) text(touchUI ? "TAP TO START" : "PRESS ENTER", CX, 194, WHITE, 1, 1);
      text("MOVE: ARROWS/WASD   J PUNCH  K KICK  L SPECIAL", CX, 210, GRAY, 1, 1);
      text("(C) 2026 THAGOBYTE", CX, 228, rgb(110, 110, 124), 1, 1, null);
    }
    const titleCrowd = ROSTER.map((ch, i) => ({ ch, x: CROWD_SPOTS[i][0], z: CROWD_SPOTS[i][1], turn: CROWD_SPOTS[i][2] }));

    function renderVictory() {
      const w = fighters[matchWinner];
      clearTo(STAGES[stage].sky);
      const a = Math.sin(time * 0.01) * 0.5 + w.facing * -0.3;
      setCamera(w.x + Math.sin(a) * 3.4, 1.4, Math.cos(a) * 3.4, w.x, 1.0, 0);
      dim = 1;
      drawStage(stage, time, prize, crowd, hype);
      for (const f of fighters) { drawShadow(f.x, f.y, 0.42); drawFighter(f, false); }
      // The spoils, held aloft.
      drawPrize(prize, w.x, 2.25 + Math.sin(time * 0.08) * 0.05, 0.1, time * 0.06, 1.5);
      shadeRect(0, 162, W, 78);
      bigText(w.ch.name + " WINS!", 166, 3, matchWinner === 0 ? ICE : FIRE);
      text('"' + w.ch.quote + '"', CX, 196, WHITE, 1, 1);
      text(w.ch.full + " CLAIMS THE LAST " + (prize === "donut" ? "DONUT" : "SLICE"), CX, 209, YELLOW, 1, 1);
      if (sceneT > 70 && (time >> 4) & 1) text(touchUI ? "TAP TO CONTINUE" : "PRESS ENTER", CX, 226, WHITE, 1, 1);
    }

    function renderContinue() {
      studio(rgb(16, 12, 20));
      showcase(ROSTER[sel[0]], 0, 1, 1.0, POSES.lose);
      bigText("CONTINUE?", 30, 6);
      const n = Math.max(0, 9 - Math.floor(sceneT / 60));
      bigText(String(n), 96, 8, ICE);
      text("YOUR SNACK IS STILL OUT THERE", CX, 196, WHITE, 1, 1);
      if ((time >> 4) & 1) text(touchUI ? "TAP TO TRY AGAIN" : "PRESS ENTER TO TRY AGAIN", CX, 214, YELLOW, 1, 1);
    }

    function renderEnding() {
      const ch = ROSTER[sel[0]];
      clearTo(STAGES[0].sky);
      const a = time * 0.012;
      setCamera(Math.sin(a) * 3.4, 1.6, Math.cos(a) * 1.6 + 2.6, 0, 1.25, 0);
      dim = 1;
      drawStage(0, time, "donut", crowd, 1);
      drawShadow(0, 0, 0.42);
      const b = Math.sin(time * 0.2);
      drawBody(ch, 0, 0, 1, P({ lean: -0.06, head: 0.2, sL: 2.8 + b * 0.25, eL: 0.25, sR: 2.7 - b * 0.25, eR: 0.3, hL: 0.2, kL: 0.3 + Math.max(0, b) * 0.3, hR: -0.1, kR: 0.2 + Math.max(0, b) * 0.3 }), YAW, null);
      drawPrize("donut", -0.5, 2.3, 0.1, time * 0.06, 1.4);
      drawPrize("pizza", 0.5, 2.3, 0.1, -time * 0.06, 1.4);
      shadeRect(0, 0, W, 62);
      shadeRect(0, 176, W, 64);
      bigText("EMPLOYEE OF", 8, 4, ICE);
      bigText("THE MONTH", 36, 4, FIRE);
      text(ch.full, CX, 184, YELLOW, 2, 1);
      text("EVERY SNACK IN THE BUILDING IS YOURS.", CX, 206, WHITE, 1, 1);
      if (sceneT > 150 && (time >> 4) & 1) text("THANKS FOR PLAYING - PRESS ENTER", CX, 222, WHITE, 1, 1);
    }

    function render() {
      switch (scene) {
        case "boot": renderTitle(true); break;
        case "title": renderTitle(false); break;
        case "select": renderSelect(); break;
        case "vs": renderVs(); break;
        case "fight": renderFight(); break;
        case "victory": renderVictory(); break;
        case "continue": renderContinue(); break;
        case "ending": renderEnding(); break;
      }
      if (fade > 0) {
        const k = Math.round((1 - fade) * 256);
        for (let i = 0; i < fb.length; i++) {
          const p = fb[i];
          fb[i] = (0xff000000 | ((((p >> 16) & 255) * k) >> 8 << 16) | ((((p >> 8) & 255) * k) >> 8 << 8) | (((p & 255) * k) >> 8)) >>> 0;
        }
      }
      ctx.putImageData(image, 0, 0);
    }

    // The simulation runs at a fixed 60 steps a second however fast the
    // display refreshes — frame data (startup, hitstun) is counted in those
    // steps, so it has to mean the same thing on a 144Hz monitor.
    const STEP_MS = 1000 / 60;
    let running = true, rafId = null, lastTime = null, acc = 0;
    function loop(now) {
      if (!running) return;
      if (lastTime === null) lastTime = now;
      acc += Math.min(100, now - lastTime);
      lastTime = now;
      let steps = 0;
      while (acc >= STEP_MS && steps < 4) {
        tick();
        acc -= STEP_MS;
        steps++;
      }
      if (steps === 4) acc = 0;
      render();
      rafId = requestAnimationFrame(loop);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    audio(); // inserting the cartridge was a user gesture, so this may already be allowed
    rafId = requestAnimationFrame(loop);

    return {
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        clearInterval(musicTimer);
        if (ac) ac.close().catch(() => {});
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerUp);
        canvas.style.imageRendering = prevRendering;
        canvas.width = prevW;
        canvas.height = prevH;
      },
      // Test hooks: drive the simulation without a display.
      _debug: { tick, render, press: (code) => pressed.add(code), state: () => ({ scene, phase, round, fighters, ladderIdx, timer }), setCpu: (i) => { fighters[i].cpu = true; fighters[i].level = 0.6; } },
    };
  }

  window.STEGO_GAMES = window.STEGO_GAMES || {};
  window.STEGO_GAMES.waterCoolerCombat = {
    title: "Water Cooler Combat",
    start: startWaterCoolerCombat,
    controlsHint: "Arrows / WASD to move · J punch · K kick · L special · hold back to block · Enter to start / pause",
  };
})();
