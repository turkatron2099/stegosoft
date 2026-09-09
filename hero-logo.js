(function () {
  const logo = document.querySelector(".hero-logo");
  if (!logo) return;
  const heroHeading = logo.parentElement; // the <h1> wrapping the logo
  const ORIGINAL_SRC = logo.getAttribute("src");

  let audioCtx = null;

  // Same two-note chime as Cool Cars' number-pickup sound (synthesized,
  // no audio file — ported from games/cool-cars.js's coinPickup()/tone()).
  function playCoinPickup() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;

    function tone(freq, dur, when, type, peakGain) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + dur + 0.02);
    }

    const now = ctx.currentTime;
    tone(988, 0.08, now, "square", 0.2);
    tone(1319, 0.18, now + 0.07, "square", 0.2);
  }

  // --- Click counter, persisted per-browser so the escalation survives reloads ---
  const STORAGE_KEY = "stegosoft-logo-clicks";
  const ROAM_AT = 100; // logo starts bouncing around the screen, DVD-screensaver style
  const FALL_AT = 200; // logo starts falling under gravity — click it to keep it up
  const ANAGLYPH_AT = 300; // the chaos stops — logo settles back in place, reskinned in anaglyph

  // Shared with starship-dogfight.js (same pattern as matrix-mode.js's own
  // flag/event pair) so the dogfight scene switches into its own red/cyan
  // anaglyph render style in lockstep with the logo, both immediately and on
  // future page loads.
  const ANAGLYPH_MODE_KEY = "stegosoft-anaglyph-mode";

  let clicks = parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0;

  const counter = document.createElement("div");
  counter.className = "logo-click-counter";
  document.body.appendChild(counter);

  function renderCounter() {
    counter.textContent = String(clicks);
  }
  renderCounter();

  // Touch devices have no keyboard to press "r" on, so give them a tappable
  // equivalent — shown only on coarse-pointer (touch) devices via CSS, since
  // desktop already has the key. Dispatching the same synthetic keydown (rather
  // than calling resetLogo() directly) also fires starship-dogfight.js's "r"
  // handler, so one tap clears every reset-on-"r" easter egg, not just this one.
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "logo-reset-btn";
  resetBtn.setAttribute("aria-label", "Reset homepage easter eggs");
  resetBtn.textContent = "↺";
  document.body.appendChild(resetBtn);

  resetBtn.addEventListener("click", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
  });

  // --- DVD-bounce / keepy-uppy physics ---
  // SPEED/GRAVITY/CLICK_IMPULSE/MAX_FALL_SPEED are all tuned per 60fps-equivalent
  // frame; tick() scales position/velocity updates by dtScale (real elapsed time
  // vs that reference) so the logo moves at the same real-world speed regardless
  // of the display's refresh rate.
  const SPEED = 3; // px per 60fps-equivalent frame, horizontal & (pre-gravity) vertical drift
  const GRAVITY = 0.35;
  const CLICK_IMPULSE = -11; // upward kick applied on each click once falling
  const MAX_FALL_SPEED = 14;
  const REFERENCE_FRAME_MS = 1000 / 60;
  const MAX_DT_MS = 50; // clamp so a stall/tab-switch hiccup doesn't teleport it

  let roaming = false;
  let falling = false;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let logoW = 0;
  let logoH = 0;
  let rafId = null;
  let lastTime = null;

  function startRoaming() {
    if (roaming) return;
    roaming = true;
    const rect = logo.getBoundingClientRect();
    logoW = rect.width;
    logoH = rect.height;
    x = rect.left;
    y = rect.top;
    vx = SPEED * (Math.random() < 0.5 ? 1 : -1);
    vy = SPEED * (Math.random() < 0.5 ? 1 : -1);
    // Lock the heading's current height before pulling the logo out of flow
    // (position: fixed), so the hero section — and the page — doesn't shrink.
    heroHeading.style.minHeight = heroHeading.getBoundingClientRect().height + "px";
    logo.classList.add("logo-roaming");
    lastTime = null;
    tick();
  }

  function tick() {
    const now = performance.now();
    const dt = lastTime === null ? REFERENCE_FRAME_MS : Math.min(now - lastTime, MAX_DT_MS);
    lastTime = now;
    const dtScale = dt / REFERENCE_FRAME_MS;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (falling) {
      vy = Math.min(vy + GRAVITY * dtScale, MAX_FALL_SPEED);
    }

    x += vx * dtScale;
    y += vy * dtScale;

    if (x <= 0) {
      x = 0;
      vx = Math.abs(vx);
    } else if (x + logoW >= vw) {
      x = vw - logoW;
      vx = -Math.abs(vx);
    }

    if (falling) {
      if (y + logoH >= vh) {
        // Landed — it stays put until the next click launches it back up.
        y = vh - logoH;
        vy = 0;
      } else if (y <= 0) {
        y = 0;
        vy = Math.abs(vy) || 1;
      }
    } else if (y <= 0) {
      y = 0;
      vy = Math.abs(vy);
    } else if (y + logoH >= vh) {
      y = vh - logoH;
      vy = -Math.abs(vy);
    }

    logo.style.transform = "translate(" + x + "px, " + y + "px)";
    rafId = requestAnimationFrame(tick);
  }

  // Traces the artwork down to just its edges — a Sobel filter over
  // grayscale luminance, thresholded to a hard line/no-line cutoff — then
  // draws only the "line" pixels, opaque, onto an otherwise fully
  // transparent canvas. That transparency is what makes this a genuinely
  // different anaglyph technique from a plain color-photo one (see
  // buildAnaglyphLogoSrc below): once color is gone, alpha *is* the
  // drawing, the same as starship-dogfight.js's vector shapes.
  //
  // Works from a downscaled copy (with a touch of blur) rather than the
  // full-resolution source: edges from a photo/JPEG at full detail come out
  // thin and noisy (compression artifacts, fine gradients), where working
  // at a fraction of the size acts as a cheap low-pass filter first, giving
  // fewer, bolder, more genuinely "line art" lines — plenty of resolution
  // either way for a ~140px on-screen logo.
  function buildLineArtCanvas() {
    const workW = 480;
    const workH = Math.round(workW * (logo.naturalHeight / logo.naturalWidth));

    const small = document.createElement("canvas");
    small.width = workW;
    small.height = workH;
    const smallCtx = small.getContext("2d");
    smallCtx.filter = "blur(1px)";
    smallCtx.drawImage(logo, 0, 0, workW, workH);

    const src = smallCtx.getImageData(0, 0, workW, workH).data;
    const gray = new Float32Array(workW * workH);
    for (let i = 0, o = 0; i < gray.length; i++, o += 4) {
      gray[i] = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
    }

    const THRESHOLD = 340; // tuned against this specific artwork for ~8% ink coverage — a clean line-art density, not a noisy near-solid fill
    const line = document.createElement("canvas");
    line.width = workW;
    line.height = workH;
    const lineCtx = line.getContext("2d");
    const out = lineCtx.createImageData(workW, workH);
    for (let y = 1; y < workH - 1; y++) {
      for (let x = 1; x < workW - 1; x++) {
        const i = y * workW + x;
        // Standard 3x3 Sobel kernels for the horizontal/vertical gradients.
        const gx =
          -gray[i - workW - 1] + gray[i - workW + 1] -
          2 * gray[i - 1] + 2 * gray[i + 1] -
          gray[i + workW - 1] + gray[i + workW + 1];
        const gy =
          -gray[i - workW - 1] - 2 * gray[i - workW] - gray[i - workW + 1] +
          gray[i + workW - 1] + 2 * gray[i + workW] + gray[i + workW + 1];
        if (Math.sqrt(gx * gx + gy * gy) > THRESHOLD) {
          const o = i * 4;
          out.data[o] = 255;
          out.data[o + 1] = 255;
          out.data[o + 2] = 255;
          out.data[o + 3] = 255; // opaque line pixel — everything else stays alpha 0
        }
      }
    }
    lineCtx.putImageData(out, 0, 0);
    return { canvas: line, w: workW, h: workH };
  }

  // Builds a red/cyan anaglyph from the line art above: two copies, shifted
  // a few pixels in opposite directions, each clipped to a flat fill color
  // via "destination-in" (which keys off alpha — correct here since the
  // line art's only content *is* its alpha), combined with "lighter"
  // (additive) blending. That's the same red/cyan separation a pair of
  // anaglyph glasses splits apart. Built once and cached as a data URL — the
  // artwork never changes, so there's no reason to redo the canvas work
  // (edge detection included) on every settle.
  let anaglyphLogoSrc = null;

  function buildAnaglyphLogoSrc() {
    const { canvas: scene, w, h } = buildLineArtCanvas();
    // ~2.8% of width lands the fringing somewhere clearly visible once the
    // logo is scaled down to its ~140px on-screen size, without it reading
    // as blurry double vision at full resolution.
    const offset = Math.max(2, Math.round(w * 0.028));

    const eye = document.createElement("canvas");
    eye.width = w;
    eye.height = h;
    const eyeCtx = eye.getContext("2d");
    function layer(color, dx) {
      eyeCtx.clearRect(0, 0, w, h);
      eyeCtx.globalCompositeOperation = "source-over";
      eyeCtx.fillStyle = color;
      eyeCtx.fillRect(0, 0, w, h);
      eyeCtx.globalCompositeOperation = "destination-in";
      eyeCtx.drawImage(scene, dx, 0, w, h);
      eyeCtx.globalCompositeOperation = "source-over";
    }

    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const outCtx = out.getContext("2d");
    layer("rgb(255, 0, 0)", -offset);
    outCtx.drawImage(eye, 0, 0);
    outCtx.globalCompositeOperation = "lighter";
    layer("rgb(0, 255, 255)", offset);
    outCtx.drawImage(eye, 0, 0);
    outCtx.globalCompositeOperation = "source-over";

    return out.toDataURL("image/png");
  }

  function anaglyphSrc() {
    if (!anaglyphLogoSrc) anaglyphLogoSrc = buildAnaglyphLogoSrc();
    return anaglyphLogoSrc;
  }

  // Ends the roam/fall chaos for good and puts the logo back exactly where
  // it started in the page flow — just wearing the anaglyph skin now.
  function settleAsAnaglyph() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    roaming = false;
    falling = false;
    logo.classList.remove("logo-roaming");
    logo.style.transform = "";
    heroHeading.style.minHeight = "";

    // The generator draws from `logo` itself, so it needs the original
    // artwork actually loaded first — true almost always in practice (it's
    // on screen from page load), but guard for the rare case someone
    // reaches this before that finishes (e.g. a slow connection plus the
    // testing shortcut below).
    if (logo.complete && logo.naturalWidth) {
      logo.src = anaglyphSrc();
    } else {
      logo.addEventListener("load", () => { logo.src = anaglyphSrc(); }, { once: true });
    }

    if (localStorage.getItem(ANAGLYPH_MODE_KEY) !== "1") {
      localStorage.setItem(ANAGLYPH_MODE_KEY, "1");
      window.dispatchEvent(new Event("stegosoft:anaglyph-mode-on"));
    }
  }

  logo.addEventListener("click", () => {
    clicks++;
    localStorage.setItem(STORAGE_KEY, String(clicks));
    renderCounter();
    playCoinPickup();

    if (clicks >= ANAGLYPH_AT) {
      settleAsAnaglyph();
    } else if (clicks >= FALL_AT) {
      falling = true;
      vy = CLICK_IMPULSE; // bop it back up, keepy-uppy style
      startRoaming();
    } else if (clicks >= ROAM_AT) {
      startRoaming();
    }
  });

  function resetLogo() {
    clicks = 0;
    localStorage.removeItem(STORAGE_KEY);
    renderCounter();

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    roaming = false;
    falling = false;
    logo.classList.remove("logo-roaming");
    logo.style.transform = "";
    heroHeading.style.minHeight = "";
    logo.src = ORIGINAL_SRC;

    if (localStorage.getItem(ANAGLYPH_MODE_KEY) === "1") {
      localStorage.removeItem(ANAGLYPH_MODE_KEY);
      window.dispatchEvent(new Event("stegosoft:anaglyph-mode-off"));
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "r") return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }
    resetLogo();
  });

  // Enters whichever state the current click count corresponds to — shared
  // by the reload-resume check below and the testing shortcut further down.
  function applyClickState() {
    if (clicks >= ANAGLYPH_AT) {
      settleAsAnaglyph();
    } else if (clicks >= FALL_AT) {
      falling = true;
      startRoaming();
    } else if (clicks >= ROAM_AT) {
      startRoaming();
    }
  }

  // TODO(testing): remove this block — press 1-9 to jump straight to that
  // many hundred clicks (100/200/300/...) instead of actually clicking
  // through each threshold by hand.
  document.addEventListener("keydown", (e) => {
    if (!/^[1-9]$/.test(e.key)) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }
    resetLogo(); // clean slate so downgrading (e.g. anaglyph -> roaming) works too
    clicks = Number(e.key) * 100;
    localStorage.setItem(STORAGE_KEY, String(clicks));
    renderCounter();
    applyClickState();
  });
  // end TODO(testing) block

  // Resume the right behavior immediately on reload, rather than waiting
  // for the next click, if the stored count already crossed a threshold.
  applyClickState();
})();
