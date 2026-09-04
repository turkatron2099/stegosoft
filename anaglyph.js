(() => {
  const leftZone = document.getElementById("left-zone");
  const rightZone = document.getElementById("right-zone");
  const leftInput = document.getElementById("left-input");
  const rightInput = document.getElementById("right-input");
  const leftThumb = document.getElementById("left-thumb");
  const rightThumb = document.getElementById("right-thumb");
  const leftHint = document.getElementById("left-hint");
  const rightHint = document.getElementById("right-hint");
  const statusText = document.getElementById("status-text");
  const editor = document.getElementById("editor");
  const methodSelect = document.getElementById("method-select");
  const swapBtn = document.getElementById("swap-btn");
  const shiftInput = document.getElementById("shift-input");
  const shiftValue = document.getElementById("shift-value");
  const preview = document.getElementById("preview");
  const downloadBtn = document.getElementById("download-btn");

  const MAX_DIM = 900; // cap the working canvas size so re-rendering on slider drag stays fast

  let leftImg = null;
  let rightImg = null;

  function setupZone(zone, input, thumb, hint, onLoaded) {
    async function handleFile(file) {
      if (!file || !window.looksLikeImageFile(file)) return;
      statusText.hidden = false;
      statusText.textContent = /\.hei[cf]$/i.test(file.name) ? "Converting HEIC…" : "Loading…";
      try {
        const { img, url } = await window.loadImageFile(file);
        thumb.src = url;
        thumb.hidden = false;
        hint.textContent = file.name;
        statusText.hidden = true;
        onLoaded(img);
      } catch (err) {
        console.error(err);
        statusText.hidden = false;
        statusText.textContent = err.message || "Couldn't load that image — try a different file.";
      }
    }

    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("is-dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-dragover");
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    input.addEventListener("change", () => {
      if (input.files[0]) handleFile(input.files[0]);
    });
  }

  function maybeReady() {
    if (leftImg && rightImg) {
      statusText.hidden = true;
      editor.hidden = false;
      render();
    }
  }

  setupZone(leftZone, leftInput, leftThumb, leftHint, (img) => {
    leftImg = img;
    maybeReady();
  });
  setupZone(rightZone, rightInput, rightThumb, rightHint, (img) => {
    rightImg = img;
    maybeReady();
  });

  // Draws `img` into a w x h canvas with object-fit: cover, offset horizontally
  // by `shiftX` px (used to fine-tune left/right alignment for depth).
  function drawCover(ctx, img, w, h, shiftX) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    const dx = (w - drawW) / 2 + shiftX;
    const dy = (h - drawH) / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, dx, dy, drawW, drawH);
  }

  function render() {
    if (!leftImg || !rightImg) return;

    const aspect = leftImg.naturalWidth / leftImg.naturalHeight;
    let w = Math.min(MAX_DIM, leftImg.naturalWidth);
    let h = Math.round(w / aspect);
    if (h > MAX_DIM) {
      h = MAX_DIM;
      w = Math.round(h * aspect);
    }
    preview.width = w;
    preview.height = h;

    const shift = parseInt(shiftInput.value, 10) || 0;

    const leftCanvas = document.createElement("canvas");
    leftCanvas.width = w;
    leftCanvas.height = h;
    drawCover(leftCanvas.getContext("2d"), leftImg, w, h, 0);

    const rightCanvas = document.createElement("canvas");
    rightCanvas.width = w;
    rightCanvas.height = h;
    drawCover(rightCanvas.getContext("2d"), rightImg, w, h, shift);

    const leftData = leftCanvas.getContext("2d").getImageData(0, 0, w, h).data;
    const rightData = rightCanvas.getContext("2d").getImageData(0, 0, w, h).data;

    const outCtx = preview.getContext("2d");
    const out = outCtx.createImageData(w, h);
    const method = methodSelect.value;

    for (let i = 0; i < out.data.length; i += 4) {
      const lr = leftData[i], lg = leftData[i + 1], lb = leftData[i + 2];
      const rr = rightData[i], rg = rightData[i + 1], rb = rightData[i + 2];

      if (method === "color") {
        out.data[i] = lr;
        out.data[i + 1] = rg;
        out.data[i + 2] = rb;
      } else if (method === "gray") {
        const lLum = 0.299 * lr + 0.587 * lg + 0.114 * lb;
        const rLum = 0.299 * rr + 0.587 * rg + 0.114 * rb;
        out.data[i] = lLum;
        out.data[i + 1] = rLum;
        out.data[i + 2] = rLum;
      } else {
        // half-color: left luminance carries the red channel (cuts ghosting
        // versus full-color red), right image supplies green/blue as usual.
        const lLum = 0.299 * lr + 0.587 * lg + 0.114 * lb;
        out.data[i] = lLum;
        out.data[i + 1] = rg;
        out.data[i + 2] = rb;
      }
      out.data[i + 3] = 255;
    }

    outCtx.putImageData(out, 0, 0);
  }

  methodSelect.addEventListener("change", render);
  shiftInput.addEventListener("input", () => {
    shiftValue.textContent = `${shiftInput.value}px`;
    render();
  });

  swapBtn.addEventListener("click", () => {
    [leftImg, rightImg] = [rightImg, leftImg];
    const tmpSrc = leftThumb.src;
    leftThumb.src = rightThumb.src;
    rightThumb.src = tmpSrc;
    const tmpHint = leftHint.textContent;
    leftHint.textContent = rightHint.textContent;
    rightHint.textContent = tmpHint;
    render();
  });

  downloadBtn.addEventListener("click", () => {
    preview.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "anaglyph.png";
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  });
})();
