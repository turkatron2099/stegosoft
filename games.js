(function () {
  const slot = document.getElementById("console-slot");
  const placeholder = document.getElementById("screen-placeholder");
  const canvas = document.getElementById("game-canvas");
  const hud = document.getElementById("hud");
  const hudTitle = document.getElementById("hud-title");
  const ejectBtn = document.getElementById("eject-btn");
  const resetBtn = document.getElementById("reset-btn");
  const fullscreenBtn = document.getElementById("fullscreen-btn");
  const consoleScreen = document.querySelector(".console-screen");
  const shelf = document.getElementById("cartridge-shelf");
  const consoleEl = document.getElementById("console");
  const controlsHint = document.getElementById("controls-hint");
  const defaultControlsHint = controlsHint.textContent;

  let current = null; // { id, controller }

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
    canvas.hidden = true;
    hud.hidden = true;
    placeholder.hidden = false;
    controlsHint.textContent = defaultControlsHint;
    consoleEl.classList.remove("powered-on");
  }

  ejectBtn.addEventListener("click", eject);

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
