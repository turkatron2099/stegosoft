// Draws a 1-bit-per-pixel sprite in the exact layout the Thagomizer VM
// expects (see docs/vm-spec.md "Sprite assets" and toolchain/text-to-sprite.js):
// row-major, MSB-first, each row padded out to a whole byte. Sprites carry no
// color of their own — SET_COLOR picks the color right before SPRITE draws
// one — so this tool only ever produces a shape, and the palette swatches
// below are a preview aid, not part of the exported line.
(() => {
  const PALETTE = [
    "#000000", "#ffffff", "#e8e85c", "#fce08c", "#d0d050", "#6c9850",
    "#5c9c5c", "#a03c88", "#9c2020", "#05182e", "#d0805c", "#ffd166",
    "#6874d0", "#90b4ec", "#68b494", "#c8c8c8",
  ];
  const RESERVED_INDICES = new Set([9, 11]); // boot/menu chrome only

  const nameInput = document.getElementById("name-input");
  const widthInput = document.getElementById("width-input");
  const heightInput = document.getElementById("height-input");
  const gridCanvas = document.getElementById("grid-canvas");
  const gridCtx = gridCanvas.getContext("2d");
  const truesizeCanvas = document.getElementById("truesize-canvas");
  const truesizeCtx = truesizeCanvas.getContext("2d");
  const paletteGrid = document.getElementById("palette-grid");
  const eraseToggle = document.getElementById("erase-toggle");
  const clearBtn = document.getElementById("clear-btn");
  const invertBtn = document.getElementById("invert-btn");
  const outputLine = document.getElementById("output-line");
  const copyBtn = document.getElementById("copy-btn");
  const downloadBtn = document.getElementById("download-btn");
  const downloadLink = document.getElementById("download-link");
  const copyStatus = document.getElementById("copy-status");

  let width = clampSize(widthInput.value);
  let height = clampSize(heightInput.value);
  let pixels = new Uint8Array(width * height); // 1 = on, row-major
  let previewColorIndex = 1; // white
  let eraseMode = false;

  function clampSize(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 1;
    return Math.min(64, Math.max(1, n));
  }

  function cellSize() {
    const target = 480;
    return Math.min(28, Math.max(6, Math.floor(target / width)));
  }

  function resizePixels(newWidth, newHeight) {
    const next = new Uint8Array(newWidth * newHeight);
    const copyW = Math.min(width, newWidth);
    const copyH = Math.min(height, newHeight);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        next[y * newWidth + x] = pixels[y * width + x];
      }
    }
    width = newWidth;
    height = newHeight;
    pixels = next;
  }

  function buildPalette() {
    paletteGrid.innerHTML = "";
    PALETTE.forEach((hex, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-swatch" + (RESERVED_INDICES.has(i) ? " is-reserved" : "");
      btn.style.background = hex;
      btn.title = RESERVED_INDICES.has(i)
        ? `Index ${i} — reserved for boot/menu chrome`
        : `Index ${i}`;
      btn.setAttribute("aria-pressed", String(i === previewColorIndex));
      if (i === previewColorIndex) btn.classList.add("is-selected");
      btn.addEventListener("click", () => {
        previewColorIndex = i;
        paletteGrid.querySelectorAll(".palette-swatch").forEach((el, j) => {
          el.classList.toggle("is-selected", j === i);
          el.setAttribute("aria-pressed", String(j === i));
        });
        drawGrid();
        drawTruesize();
      });
      paletteGrid.appendChild(btn);
    });
  }

  function drawGrid() {
    const cs = cellSize();
    gridCanvas.width = width * cs;
    gridCanvas.height = height * cs;
    gridCtx.fillStyle = "#000";
    gridCtx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);

    gridCtx.fillStyle = PALETTE[previewColorIndex];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x]) {
          gridCtx.fillRect(x * cs, y * cs, cs, cs);
        }
      }
    }

    if (cs >= 8) {
      gridCtx.strokeStyle = "rgba(167, 201, 198, 0.15)";
      gridCtx.lineWidth = 1;
      gridCtx.beginPath();
      for (let x = 0; x <= width; x++) {
        gridCtx.moveTo(x * cs + 0.5, 0);
        gridCtx.lineTo(x * cs + 0.5, height * cs);
      }
      for (let y = 0; y <= height; y++) {
        gridCtx.moveTo(0, y * cs + 0.5);
        gridCtx.lineTo(width * cs, y * cs + 0.5);
      }
      gridCtx.stroke();
    }
  }

  function drawTruesize() {
    truesizeCanvas.width = width;
    truesizeCanvas.height = height;
    const scale = 3;
    truesizeCanvas.style.width = `${width * scale}px`;
    truesizeCanvas.style.height = `${height * scale}px`;
    truesizeCtx.clearRect(0, 0, width, height);
    truesizeCtx.fillStyle = PALETTE[previewColorIndex];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[y * width + x]) truesizeCtx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Same packing as toolchain/text-to-sprite.js: row-major, MSB-first,
  // ceil(width/8) bytes per row.
  function packSprite() {
    const rowBytes = Math.ceil(width / 8);
    const packed = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!pixels[y * width + x]) continue;
        const byteIdx = y * rowBytes + (x >> 3);
        const bit = 7 - (x & 7);
        packed[byteIdx] |= 1 << bit;
      }
    }
    return packed;
  }

  function toHex(bytes) {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }

  function sanitizedName() {
    let n = nameInput.value.replace(/[^A-Za-z0-9_]/g, "");
    if (!/^[A-Za-z_]/.test(n)) n = `_${n}`;
    return n || "sprite";
  }

  function updateOutput() {
    const hex = toHex(packSprite());
    outputLine.value = `.sprite ${sanitizedName()} ${width} ${height} ${hex}`;
    copyStatus.hidden = true;
  }

  function renderAll() {
    drawGrid();
    drawTruesize();
    updateOutput();
  }

  // --- pixel painting -------------------------------------------------
  let painting = false;
  let paintValue = 1;

  function cellFromEvent(e) {
    const rect = gridCanvas.getBoundingClientRect();
    const cs = cellSize();
    const x = Math.floor(((e.clientX - rect.left) * (gridCanvas.width / rect.width)) / cs);
    const y = Math.floor(((e.clientY - rect.top) * (gridCanvas.height / rect.height)) / cs);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return { x, y };
  }

  function setCell(x, y, value) {
    const idx = y * width + x;
    if (pixels[idx] === value) return false;
    pixels[idx] = value;
    return true;
  }

  gridCanvas.addEventListener("pointerdown", (e) => {
    const cell = cellFromEvent(e);
    if (!cell) return;
    try {
      gridCanvas.setPointerCapture(e.pointerId);
    } catch {
      // capture isn't available for this pointer — painting still works,
      // it just won't keep tracking if the pointer leaves the canvas.
    }
    painting = true;
    paintValue = eraseMode ? 0 : pixels[cell.y * width + cell.x] ? 0 : 1;
    if (setCell(cell.x, cell.y, paintValue)) renderAll();
  });

  gridCanvas.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    if (setCell(cell.x, cell.y, paintValue)) renderAll();
  });

  function stopPainting(e) {
    if (!painting) return;
    painting = false;
    try {
      gridCanvas.releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released — nothing to clean up
    }
  }
  gridCanvas.addEventListener("pointerup", stopPainting);
  gridCanvas.addEventListener("pointercancel", stopPainting);

  // --- controls ---------------------------------------------------------
  eraseToggle.addEventListener("click", () => {
    eraseMode = !eraseMode;
    eraseToggle.setAttribute("aria-pressed", String(eraseMode));
  });

  clearBtn.addEventListener("click", () => {
    pixels.fill(0);
    renderAll();
  });

  invertBtn.addEventListener("click", () => {
    for (let i = 0; i < pixels.length; i++) pixels[i] = pixels[i] ? 0 : 1;
    renderAll();
  });

  widthInput.addEventListener("change", () => {
    const w = clampSize(widthInput.value);
    widthInput.value = w;
    resizePixels(w, height);
    renderAll();
  });

  heightInput.addEventListener("change", () => {
    const h = clampSize(heightInput.value);
    heightInput.value = h;
    resizePixels(width, h);
    renderAll();
  });

  nameInput.addEventListener("input", updateOutput);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(outputLine.value);
      copyStatus.textContent = "Copied.";
    } catch {
      outputLine.select();
      copyStatus.textContent = "Couldn't use the clipboard — line is selected, copy it manually.";
    }
    copyStatus.hidden = false;
  });

  downloadBtn.addEventListener("click", () => {
    const blob = new Blob([outputLine.value + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.download = `${sanitizedName()}.sprite.txt`;
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  buildPalette();
  renderAll();
})();
