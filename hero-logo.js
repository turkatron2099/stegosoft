(function () {
  const logo = document.querySelector(".hero-logo");
  if (!logo) return;
  const heroHeading = logo.parentElement; // the <h1> wrapping the logo

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

  let clicks = parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0;

  const counter = document.createElement("div");
  counter.className = "logo-click-counter";
  document.body.appendChild(counter);

  function renderCounter() {
    counter.textContent = String(clicks);
  }
  renderCounter();

  // --- DVD-bounce / keepy-uppy physics ---
  const SPEED = 3; // px/frame horizontal & (pre-gravity) vertical drift
  const GRAVITY = 0.35;
  const CLICK_IMPULSE = -11; // upward kick applied on each click once falling
  const MAX_FALL_SPEED = 14;

  let roaming = false;
  let falling = false;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let logoW = 0;
  let logoH = 0;
  let rafId = null;

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
    tick();
  }

  function tick() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (falling) {
      vy = Math.min(vy + GRAVITY, MAX_FALL_SPEED);
    }

    x += vx;
    y += vy;

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

  logo.addEventListener("click", () => {
    clicks++;
    localStorage.setItem(STORAGE_KEY, String(clicks));
    renderCounter();
    playCoinPickup();

    if (clicks >= FALL_AT) {
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
  }

  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "r") return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }
    resetLogo();
  });

  // Resume the right behavior immediately on reload, rather than waiting
  // for the next click, if the stored count already crossed a threshold.
  if (clicks >= FALL_AT) {
    falling = true;
    startRoaming();
  } else if (clicks >= ROAM_AT) {
    startRoaming();
  }
})();
