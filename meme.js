// Simple meme maker: drag/resize one line of white-with-black-border text
// over an uploaded picture or GIF. Static images render to PNG directly on
// a canvas. Animated GIFs are decoded frame-by-frame with gifuct-js
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
const textOverlay = document.getElementById("meme-text");
const textInput = document.getElementById("text-input");
const sizeInput = document.getElementById("size-input");
const createBtn = document.getElementById("create-btn");
const resultBox = document.getElementById("result-box");
const resultInfo = document.getElementById("result-info");
const resultPreview = document.getElementById("result-preview");
const downloadLink = document.getElementById("download-link");

const state = {
  text: "",
  xPct: 50,
  yPct: 50,
  sizePct: 9,
  isGif: false,
  naturalWidth: 0,
  naturalHeight: 0,
  gifFrames: null, // precomputed {width, height, frames:[{imageData, delay}]} for GIFs
  sourceName: "meme",
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function render() {
  textOverlay.style.left = state.xPct + "%";
  textOverlay.style.top = state.yPct + "%";
  textOverlay.style.fontSize = (state.sizePct / 100) * stage.clientWidth + "px";
  textOverlay.textContent = state.text;
}

// --- Dragging the text with pointer events (mouse + touch) ---
let dragOffsetX = 0;
let dragOffsetY = 0;

textOverlay.addEventListener("pointerdown", (e) => {
  textOverlay.setPointerCapture(e.pointerId);
  const rect = stage.getBoundingClientRect();
  dragOffsetX = e.clientX - (rect.left + (state.xPct / 100) * rect.width);
  dragOffsetY = e.clientY - (rect.top + (state.yPct / 100) * rect.height);
});

textOverlay.addEventListener("pointermove", (e) => {
  if (!textOverlay.hasPointerCapture(e.pointerId)) return;
  const rect = stage.getBoundingClientRect();
  const x = e.clientX - dragOffsetX - rect.left;
  const y = e.clientY - dragOffsetY - rect.top;
  state.xPct = clamp((x / rect.width) * 100, 0, 100);
  state.yPct = clamp((y / rect.height) * 100, 0, 100);
  render();
});

textOverlay.addEventListener("pointerup", (e) => {
  if (textOverlay.hasPointerCapture(e.pointerId)) textOverlay.releasePointerCapture(e.pointerId);
});

textInput.addEventListener("input", () => {
  state.text = textInput.value;
  render();
});

sizeInput.addEventListener("input", () => {
  state.sizePct = parseFloat(sizeInput.value);
  render();
});

window.addEventListener("resize", render);

// --- Drawing the text onto an export canvas (matches the live overlay's
// center-anchored position, but with real stroke/fill text instead of the
// CSS approximation used for the live preview). ---
function drawTextOnCanvas(ctx, w, h) {
  const text = state.text;
  if (!text.trim()) return;

  const fontPx = (state.sizePct / 100) * w;
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
  const cx = (state.xPct / 100) * w;
  const cy = (state.yPct / 100) * h;

  lines.forEach((line, i) => {
    const ly = cy - totalHeight / 2 + i * lineHeight;
    ctx.strokeText(line, cx, ly);
    ctx.fillText(line, cx, ly);
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
