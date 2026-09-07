// Simple meme maker: drag/resize one or more lines of white-with-black-border
// text over an uploaded picture or GIF. Static images render to PNG directly
// on a canvas. Animated GIFs are decoded frame-by-frame with gifuct-js
// (composited per the GIF disposal spec — see compositeFrames below), the
// text is baked onto each composited frame, and the result is re-encoded
// with gifenc. Everything runs client-side; nothing is uploaded anywhere.
import { parseGIF, decompressFrames } from "https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm";
import { GIFEncoder, quantize, applyPalette } from "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js";

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const dropLabel = document.getElementById("drop-label");
const statusText = document.getElementById("status-text");
const editor = document.getElementById("editor");
const stage = document.getElementById("stage");
const memeImage = document.getElementById("meme-image");
const textLayersEl = document.getElementById("text-layers");
const addLineBtn = document.getElementById("add-line-btn");
const createBtn = document.getElementById("create-btn");
const resultBox = document.getElementById("result-box");
const resultInfo = document.getElementById("result-info");
const resultPreview = document.getElementById("result-preview");
const downloadLink = document.getElementById("download-link");

const MAX_LAYERS = 5;
// Pleasant starting spot for each new line so it doesn't land on top of the
// last one — top, bottom, then fan out from the middle. Purely a default;
// every line is still freely draggable afterward.
const DEFAULT_Y_PCT = [15, 85, 50, 30, 70];

const state = {
  layers: [],
  isGif: false,
  naturalWidth: 0,
  naturalHeight: 0,
  gifFrames: null, // precomputed {width, height, frames:[{imageData, delay}]} for GIFs
  sourceName: "meme",
};

let nextLayerId = 0;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function renderLayer(layer) {
  layer.overlayEl.style.left = layer.xPct + "%";
  layer.overlayEl.style.top = layer.yPct + "%";
  layer.overlayEl.style.fontSize = (layer.sizePct / 100) * stage.clientWidth + "px";
  layer.overlayEl.textContent = layer.text;
}

function render() {
  state.layers.forEach(renderLayer);
}

function addLayer() {
  if (state.layers.length >= MAX_LAYERS) return;

  const id = nextLayerId++;
  const layer = {
    id,
    text: "",
    xPct: 50,
    yPct: DEFAULT_Y_PCT[state.layers.length % DEFAULT_Y_PCT.length],
    sizePct: 9,
  };

  // --- Draggable overlay on the image itself ---
  const overlayEl = document.createElement("div");
  overlayEl.className = "meme-text-overlay";
  stage.appendChild(overlayEl);
  layer.overlayEl = overlayEl;

  let dragOffsetX = 0;
  let dragOffsetY = 0;
  overlayEl.addEventListener("pointerdown", (e) => {
    overlayEl.setPointerCapture(e.pointerId);
    const rect = stage.getBoundingClientRect();
    dragOffsetX = e.clientX - (rect.left + (layer.xPct / 100) * rect.width);
    dragOffsetY = e.clientY - (rect.top + (layer.yPct / 100) * rect.height);
  });
  overlayEl.addEventListener("pointermove", (e) => {
    if (!overlayEl.hasPointerCapture(e.pointerId)) return;
    const rect = stage.getBoundingClientRect();
    const x = e.clientX - dragOffsetX - rect.left;
    const y = e.clientY - dragOffsetY - rect.top;
    layer.xPct = clamp((x / rect.width) * 100, 0, 100);
    layer.yPct = clamp((y / rect.height) * 100, 0, 100);
    renderLayer(layer);
  });
  overlayEl.addEventListener("pointerup", (e) => {
    if (overlayEl.hasPointerCapture(e.pointerId)) overlayEl.releasePointerCapture(e.pointerId);
  });

  // --- Its control row: text box + size slider + remove button ---
  const row = document.createElement("div");
  row.className = "text-layer-row";

  const textarea = document.createElement("textarea");
  textarea.className = "text-layer-input";
  textarea.rows = 2;
  textarea.placeholder = "Your text here";
  textarea.id = `text-input-${id}`;
  textarea.addEventListener("input", () => {
    layer.text = textarea.value;
    renderLayer(layer);
  });

  const sizeRow = document.createElement("div");
  sizeRow.className = "size-row";
  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = "Text size";
  sizeLabel.htmlFor = `size-input-${id}`;
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.id = `size-input-${id}`;
  sizeInput.min = "3";
  sizeInput.max = "30";
  sizeInput.step = "0.5";
  sizeInput.value = String(layer.sizePct);
  sizeInput.addEventListener("input", () => {
    layer.sizePct = parseFloat(sizeInput.value);
    renderLayer(layer);
  });
  sizeRow.append(sizeLabel, sizeInput);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-line-btn";
  removeBtn.setAttribute("aria-label", "Remove this line");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => removeLayer(layer));

  row.append(removeBtn, textarea, sizeRow);
  textLayersEl.appendChild(row);
  layer.rowEl = row;

  state.layers.push(layer);
  updateAddButton();
  renderLayer(layer);
}

function removeLayer(layer) {
  layer.overlayEl.remove();
  layer.rowEl.remove();
  state.layers = state.layers.filter((l) => l !== layer);
  updateAddButton();
}

function updateAddButton() {
  addLineBtn.disabled = state.layers.length >= MAX_LAYERS;
}

addLineBtn.addEventListener("click", addLayer);
window.addEventListener("resize", render);

// --- Drawing the text onto an export canvas (matches the live overlay's
// center-anchored position, but with real stroke/fill text instead of the
// CSS approximation used for the live preview). ---
function drawTextOnCanvas(ctx, w, h) {
  state.layers.forEach((layer) => {
    const text = layer.text;
    if (!text.trim()) return;

    const fontPx = (layer.sizePct / 100) * w;
    ctx.font = `bold ${fontPx}px Impact, "Arial Black", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = fontPx * 0.12;
    ctx.strokeStyle = "#000";
    ctx.fillStyle = "#fff";

    const lines = text.split("\n");
    const lineHeight = fontPx * 1.15;
    const totalHeight = lineHeight * (lines.length - 1);
    const cx = (layer.xPct / 100) * w;
    const cy = (layer.yPct / 100) * h;

    lines.forEach((line, i) => {
      const ly = cy - totalHeight / 2 + i * lineHeight;
      ctx.strokeText(line, cx, ly);
      ctx.fillText(line, cx, ly);
    });
  });
}

// --- GIF frame decoding & compositing ---
// gifuct-js hands back each frame as a small RGBA "patch" positioned at
// dims.left/top within the logical screen. Per the GIF89a spec, what's
// visible during frame i depends on how frame i-1 was disposed of:
//   0/1 (none/do-not-dispose): leave the canvas as-is, then draw the patch
//   2   (restore-to-background): clear that frame's rect first
//   3   (restore-to-previous): revert to the snapshot taken just before it
function compositeFrames(frames) {
  const width = Math.max(...frames.map((f) => f.dims.left + f.dims.width));
  const height = Math.max(...frames.map((f) => f.dims.top + f.dims.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  let previousSnapshot = null;
  const out = [];

  frames.forEach((frame, i) => {
    if (i > 0) {
      const prev = frames[i - 1];
      if (prev.disposalType === 2) {
        ctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
      } else if (prev.disposalType === 3 && previousSnapshot) {
        ctx.putImageData(previousSnapshot, 0, 0);
      }
    }

    if (frame.disposalType === 3) {
      previousSnapshot = ctx.getImageData(0, 0, width, height);
    }

    const patchCanvas = document.createElement("canvas");
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    patchCanvas.getContext("2d").putImageData(new ImageData(frame.patch, frame.dims.width, frame.dims.height), 0, 0);
    ctx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

    out.push({ imageData: ctx.getImageData(0, 0, width, height), delay: frame.delay || 100 });
  });

  return { width, height, frames: out };
}

async function decodeGif(file) {
  const buffer = await file.arrayBuffer();
  const gif = parseGIF(buffer);
  const frames = decompressFrames(gif, true);
  return compositeFrames(frames);
}

// --- Export ---
function renderStaticPNG() {
  const canvas = document.createElement("canvas");
  canvas.width = state.naturalWidth;
  canvas.height = state.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(memeImage, 0, 0, canvas.width, canvas.height);
  drawTextOnCanvas(ctx, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    if (!blob) {
      statusText.hidden = false;
      statusText.textContent = "Couldn't render that — try a different picture.";
      return;
    }
    showResult(blob, "png", `${canvas.width} × ${canvas.height} PNG`);
  }, "image/png");
}

function renderAnimatedGif() {
  const { width, height, frames } = state.gifFrames;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const encoder = GIFEncoder();
  frames.forEach((frame) => {
    ctx.putImageData(frame.imageData, 0, 0);
    drawTextOnCanvas(ctx, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    encoder.writeFrame(index, width, height, { palette, delay: frame.delay });
  });
  encoder.finish();

  const blob = new Blob([encoder.bytes()], { type: "image/gif" });
  showResult(blob, "gif", `${width} × ${height} GIF — ${frames.length} frames`);
}

function showResult(blob, ext, info) {
  const url = URL.createObjectURL(blob);
  resultPreview.src = url;
  downloadLink.href = url;
  downloadLink.download = `${state.sourceName}.${ext}`;
  resultInfo.textContent = info;
  resultBox.hidden = false;
}

createBtn.addEventListener("click", async () => {
  createBtn.disabled = true;
  resultBox.hidden = true;
  statusText.hidden = true;

  try {
    if (state.isGif) {
      statusText.hidden = false;
      statusText.textContent = "Rendering GIF… this can take a few seconds.";
      await new Promise((r) => setTimeout(r, 20)); // let the status message paint before the sync work below
      renderAnimatedGif();
      statusText.hidden = true;
    } else {
      renderStaticPNG();
    }
  } catch (err) {
    console.error(err);
    statusText.hidden = false;
    statusText.textContent = "Something went wrong rendering that — try a different file.";
  } finally {
    createBtn.disabled = false;
  }
});

// --- File loading ---
async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;

  resultBox.hidden = true;
  editor.hidden = true;
  statusText.hidden = false;
  statusText.textContent = "Loading…";
  dropLabel.textContent = file.name;

  state.isGif = file.type === "image/gif" || /\.gif$/i.test(file.name);
  state.sourceName = file.name.replace(/\.[^.]+$/, "") || "meme";
  state.gifFrames = null;

  const url = URL.createObjectURL(file);

  try {
    await new Promise((resolve, reject) => {
      memeImage.onload = resolve;
      memeImage.onerror = () => reject(new Error("Couldn't load that file — try a different picture."));
      memeImage.src = url;
    });

    state.naturalWidth = memeImage.naturalWidth;
    state.naturalHeight = memeImage.naturalHeight;

    if (state.isGif) {
      statusText.textContent = "Decoding GIF…";
      state.gifFrames = await decodeGif(file);
    }

    statusText.hidden = true;
    editor.hidden = false;
    render();
  } catch (err) {
    console.error(err);
    statusText.textContent = err.message || "Couldn't load that file — try a different picture.";
  }
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("is-dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("is-dragover");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// Start with one line, same as before — "+ Add another line" grows from here.
addLayer();
