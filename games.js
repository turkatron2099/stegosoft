(function () {
  const slot = document.getElementById("console-slot");
  const placeholder = document.getElementById("screen-placeholder");
  const placeholderOff = document.getElementById("placeholder-off");
  const placeholderBoot = document.getElementById("placeholder-boot");
  const bootLogoCanvas = document.getElementById("boot-logo-canvas");
  const canvas = document.getElementById("game-canvas");
  const hud = document.getElementById("hud");
  const hudTitle = document.getElementById("hud-title");
  const powerBtn = document.getElementById("power-btn");
  const resetBtn = document.getElementById("reset-btn");
  const fullscreenBtn = document.getElementById("fullscreen-btn");
  const consoleScreen = document.querySelector(".console-screen");
  const shelf = document.getElementById("cartridge-shelf");
  const consoleEl = document.getElementById("console");
  const controlsHint = document.getElementById("controls-hint");
  const defaultControlsHint = controlsHint.textContent;

  let current = null; // { id, controller }
  let poweredOnIdle = false; // powered on via the Power button, no cartridge inserted

  // Pixelated boot logo: downsample the real logo to a tiny grid, then draw
  // it back out scaled with smoothing off, for a blocky "8-bit" look. Built
  // once and cached, same lazy-build-once pattern as cool-cars.js's grass
  // pattern.
  const BOOT_LOGO_IMAGE = new Image();
  BOOT_LOGO_IMAGE.src = "images/stegosoft-logo.jpg";
  const PIXEL_GRID = 40;
  let pixelLogoCanvas = null;

  function getPixelLogo() {
    if (pixelLogoCanvas) return pixelLogoCanvas;
    if (!BOOT_LOGO_IMAGE.complete || BOOT_LOGO_IMAGE.naturalWidth === 0) return null;
    const tiny = document.createElement("canvas");
    tiny.width = PIXEL_GRID;
    tiny.height = PIXEL_GRID;
    tiny.getContext("2d").drawImage(BOOT_LOGO_IMAGE, 0, 0, PIXEL_GRID, PIXEL_GRID);
    pixelLogoCanvas = tiny;
    return pixelLogoCanvas;
  }

  function drawBootLogo() {
    const tiny = getPixelLogo();
    const ctx = bootLogoCanvas.getContext("2d");
    ctx.clearRect(0, 0, bootLogoCanvas.width, bootLogoCanvas.height);
    if (!tiny) {
      // Logo not loaded yet — try again once it is.
      BOOT_LOGO_IMAGE.addEventListener("load", drawBootLogo, { once: true });
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tiny, 0, 0, bootLogoCanvas.width, bootLogoCanvas.height);
  }

  // Synthesized boot chime + a slow, low-pitched voice line, evoking a
  // classic console startup jingle without reusing anyone else's actual
  // audio.
  function playStegoBoot() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.65);
    } catch (e) {
      // Web Audio unavailable — the voice line below can still play alone.
    }

    if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
      window.speechSynthesis.cancel();
      // "eh"/"oh" (not "ee"/"oo") spelled with trailing h's rather than
      // repeated vowels, so the vowel quality stays "Stego" and only the
      // duration stretches — repeating the vowel letter itself would drift
      // toward "ee"/"oo" (as in "meet"/"moon") instead.
      const utter = new SpeechSynthesisUtterance("Stehhh gohhh");
      utter.pitch = 0.3;
      utter.rate = 0.6;
      window.speechSynthesis.speak(utter);
    }
  }

  // Safari still needs the -webkit- prefixed names.
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function requestFullscreen(el) {
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) return;
    // Can reject (denied by the browser/OS, disallowed in this context) —
    // nothing else depends on it succeeding, so just let it be a no-op.
    const result = request.call(el);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

  function exitFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  }

  ["fullscreenchange", "webkitfullscreenchange"].forEach((evt) => {
    document.addEventListener(evt, () => {
      fullscreenBtn.textContent = isFullscreen() ? "EXIT FULLSCREEN" : "FULLSCREEN";
    });
  });

  function insertCartridge(gameId) {
    if (current && current.id === gameId) {
      canvas.focus();
      return;
    }

    const game = window.STEGO_GAMES && window.STEGO_GAMES[gameId];
    if (!game) return;

    if (current) {
      current.controller.stop();
      current = null;
    }
    poweredOnIdle = false;

    placeholder.hidden = true;
    canvas.hidden = false;
    hud.hidden = false;
    hudTitle.textContent = game.title;
    controlsHint.textContent = game.controlsHint || defaultControlsHint;
    consoleEl.classList.add("powered-on");

    const controller = game.start(canvas);
    current = { id: gameId, controller };

    // Move focus off the cartridge/slot so Space/Enter control the game,
    // not re-trigger insertion of the cartridge that was just activated.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    canvas.focus();
  }

  function eject() {
    if (isFullscreen()) exitFullscreen();
    if (current) {
      current.controller.stop();
      current = null;
    }
    poweredOnIdle = false;
    canvas.hidden = true;
    hud.hidden = true;
    placeholder.hidden = false;
    placeholderBoot.hidden = true;
    placeholderOff.hidden = false;
    controlsHint.textContent = defaultControlsHint;
    consoleEl.classList.remove("powered-on");
  }

  function powerOnIdle() {
    poweredOnIdle = true;
    placeholderOff.hidden = true;
    placeholderBoot.hidden = false;
    consoleEl.classList.add("powered-on");
    drawBootLogo();
    playStegoBoot();
  }

  powerBtn.addEventListener("click", () => {
    if (current) {
      // A cartridge is running — Power behaves exactly like the old Eject.
      eject();
    } else if (poweredOnIdle) {
      eject(); // already idle-on with no cartridge — this powers fully off
    } else {
      powerOnIdle();
    }
  });

  resetBtn.addEventListener("click", () => {
    if (!current) return;
    const gameId = current.id;
    current.controller.stop();
    current = null;
    insertCartridge(gameId);
  });

  fullscreenBtn.addEventListener("click", () => {
    if (!current) return;
    if (isFullscreen()) {
      exitFullscreen();
    } else {
      requestFullscreen(consoleScreen);
    }
    canvas.focus();
  });

  shelf.querySelectorAll(".cartridge").forEach((cartridge) => {
    cartridge.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", cartridge.dataset.game);
      e.dataTransfer.effectAllowed = "copy";
      cartridge.classList.add("dragging");
    });

    cartridge.addEventListener("dragend", () => {
      cartridge.classList.remove("dragging");
    });

    // Click / keyboard fallback for touch and accessibility.
    cartridge.addEventListener("click", () => insertCartridge(cartridge.dataset.game));
    cartridge.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        insertCartridge(cartridge.dataset.game);
      }
    });
  });

  slot.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    slot.classList.add("slot-hover");
  });

  slot.addEventListener("dragleave", () => {
    slot.classList.remove("slot-hover");
  });

  slot.addEventListener("drop", (e) => {
    e.preventDefault();
    slot.classList.remove("slot-hover");
    const gameId = e.dataTransfer.getData("text/plain");
    if (gameId) insertCartridge(gameId);
  });
})();
