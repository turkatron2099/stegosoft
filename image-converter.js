(() => {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const dropLabel = document.getElementById("drop-label");
  const statusText = document.getElementById("status-text");
  const editor = document.getElementById("editor");
  const sourcePreview = document.getElementById("source-preview");
  const sourceInfo = document.getElementById("source-info");
  const formatSelect = document.getElementById("format-select");
  const qualityField = document.getElementById("quality-field");
  const qualityInput = document.getElementById("quality-input");
  const qualityValue = document.getElementById("quality-value");
  const convertBtn = document.getElementById("convert-btn");
  const resultBox = document.getElementById("result-box");
  const resultInfo = document.getElementById("result-info");
  const resultPreview = document.getElementById("result-preview");
  const downloadLink = document.getElementById("download-link");

  const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

  let sourceImg = null;
  let sourceName = "image";
  let sourceOriginalSize = 0;

  function formatBytes(n) {
    return n > 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`;
  }

  function updateQualityVisibility() {
    qualityField.hidden = formatSelect.value === "image/png";
  }

  async function handleFile(file) {
    if (!file || !window.looksLikeImageFile(file)) return;

    resultBox.hidden = true;
    editor.hidden = true;
    statusText.hidden = false;
    statusText.textContent = /\.hei[cf]$/i.test(file.name) ? "Converting HEIC…" : "Loading…";
    dropLabel.textContent = file.name;

    try {
      const { img, url } = await window.loadImageFile(file);
      sourceImg = img;
      sourceName = file.name.replace(/\.[^.]+$/, "") || "image";
      sourceOriginalSize = file.size;

      sourcePreview.src = url;
      sourceInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} — ${formatBytes(file.size)} — ${file.type || "unknown type"}`;

      statusText.hidden = true;
      editor.hidden = false;
      updateQualityVisibility();
    } catch (err) {
      console.error(err);
      statusText.textContent = err.message || "Couldn't load that image — try a different file.";
    }
  }

  convertBtn.addEventListener("click", () => {
    if (!sourceImg) return;

    convertBtn.disabled = true;
    resultBox.hidden = true;

    const canvas = document.createElement("canvas");
    canvas.width = sourceImg.naturalWidth;
    canvas.height = sourceImg.naturalHeight;
    const ctx = canvas.getContext("2d");
    // JPEG has no alpha channel — flatten onto white so transparent source
    // images (e.g. a PNG) don't turn black.
    if (formatSelect.value === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(sourceImg, 0, 0);

    const mimeType = formatSelect.value;
    const quality = mimeType === "image/png" ? undefined : parseFloat(qualityInput.value);

    canvas.toBlob(
      (blob) => {
        convertBtn.disabled = false;
        if (!blob) {
          statusText.hidden = false;
          statusText.textContent = "Conversion failed — try a different format.";
          return;
        }
        const ext = EXTENSIONS[mimeType];
        const outName = `${sourceName}.${ext}`;
        const url = URL.createObjectURL(blob);

        downloadLink.href = url;
        downloadLink.download = outName;
        resultPreview.src = url;
        const changePct = sourceOriginalSize ? (((blob.size - sourceOriginalSize) / sourceOriginalSize) * 100).toFixed(0) : null;
        resultInfo.textContent = `${outName} — ${formatBytes(blob.size)}${changePct !== null ? ` (${changePct > 0 ? "+" : ""}${changePct}% vs. original)` : ""}`;
        resultBox.hidden = false;
      },
      mimeType,
      quality
    );
  });

  formatSelect.addEventListener("change", updateQualityVisibility);
  qualityInput.addEventListener("input", () => {
    qualityValue.textContent = `${Math.round(qualityInput.value * 100)}%`;
  });

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
})();
