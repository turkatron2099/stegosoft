(function () {
  const slot = document.getElementById("console-slot");
  const placeholder = document.getElementById("screen-placeholder");
  const canvas = document.getElementById("game-canvas");
  const hud = document.getElementById("hud");
  const hudTitle = document.getElementById("hud-title");
  const ejectBtn = document.getElementById("eject-btn");
  const resetBtn = document.getElementById("reset-btn");
  const shelf = document.getElementById("cartridge-shelf");
  const consoleEl = document.getElementById("console");

  let current = null; // { id, controller }

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
    if (current) {
      current.controller.stop();
      current = null;
    }
    canvas.hidden = true;
    hud.hidden = true;
    placeholder.hidden = false;
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
