(() => {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js";

  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const dropLabel = document.getElementById("drop-label");
  const statusText = document.getElementById("status-text");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");
  const toolbar = document.getElementById("toolbar");
  const addBtn = document.getElementById("add-btn");
  const resetBtn = document.getElementById("reset-btn");
  const exportBtn = document.getElementById("export-btn");
  const pageGrid = document.getElementById("page-grid");
  const emptyMsg = document.getElementById("empty-msg");
  const resultBox = document.getElementById("result-box");
  const resultInfo = document.getElementById("result-info");
  const downloadLink = document.getElementById("download-link");

  const THUMB_TARGET_WIDTH = 240; // px, rendered once and reused at whatever CSS size the grid displays it

  // Loaded documents, one per PDF or image added. Each page below points
  // back into one of these by index rather than duplicating page data —
  // reordering/rotating/deleting only ever touches `pages`.
  let sources = []; // { pdfLibDoc, pdfjsDoc, name }
  let pages = []; // { sourceIndex, pageIndexInSource, rotation (0/90/180/270), thumbSrc }

  function setProgress(fraction) {
    progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  function setStatus(msg) {
    statusText.hidden = !msg;
    statusText.textContent = msg || "";
  }

  // --- image -> single-page PDF, for files that aren't already a PDF ---
  // Mirrors doc-to-pdf.js's approach: draw through a canvas regardless of
  // source format (normalizes GIF/WEBP/BMP, which pdf-lib can't embed
  // directly, into PNG/JPEG, which it can), keeping PNG only when the
  // image actually needs its alpha channel.

  function loadImageEl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function hasTransparency(ctx, width, height) {
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function imageFileToPdfBytes(file) {
    const img = await loadImageEl(file);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx2d = canvas.getContext("2d");
    ctx2d.drawImage(img, 0, 0);

    const transparent = hasTransparency(ctx2d, canvas.width, canvas.height);
    const doc = await PDFLib.PDFDocument.create();
    const embedded = transparent
      ? await doc.embedPng(dataUrlToBytes(canvas.toDataURL("image/png")))
      : await doc.embedJpg(dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)));

    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    URL.revokeObjectURL(img.src);
    return doc.save();
  }

  function bytesForFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) return file.arrayBuffer().then((b) => new Uint8Array(b));
    if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return imageFileToPdfBytes(file);
    return Promise.resolve(null);
  }

  // --- thumbnails ---

  async function renderThumbnail(pdfjsDoc, pageNumber) {
    const page = await pdfjsDoc.getPage(pageNumber);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = THUMB_TARGET_WIDTH / unscaled.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas.toDataURL("image/png");
  }

  // --- ingest a file's bytes as a new source, one page entry per page ---

  async function loadBytesAsSource(bytes, name) {
    // pdf-lib and pdf.js each get their own copy — no reason to risk one
    // library's internal handling of the buffer affecting the other's.
    const pdfLibDoc = await PDFLib.PDFDocument.load(bytes.slice());
    const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

    const sourceIndex = sources.length;
    sources.push({ pdfLibDoc, pdfjsDoc, name });

    const pageCount = pdfLibDoc.getPageCount();
    for (let i = 0; i < pageCount; i++) {
      const thumbSrc = await renderThumbnail(pdfjsDoc, i + 1);
      pages.push({ sourceIndex, pageIndexInSource: i, rotation: 0, thumbSrc });
      setProgress((i + 1) / pageCount);
    }
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;

    setStatus("Loading…");
    progressTrack.hidden = false;
    setProgress(0);

    let added = 0;
    let skipped = 0;
    for (const file of files) {
      try {
        const bytes = await bytesForFile(file);
        if (!bytes) {
          skipped++;
          continue;
        }
        await loadBytesAsSource(bytes, file.name);
        added++;
      } catch (err) {
        console.error(err);
        skipped++;
      }
    }

    progressTrack.hidden = true;
    if (skipped > 0 && added === 0) {
      setStatus(`Couldn't load ${skipped === 1 ? "that file" : "those files"} — is it a valid PDF or image?`);
    } else if (skipped > 0) {
      setStatus(`Added ${added} file${added === 1 ? "" : "s"}, skipped ${skipped} (unreadable or unsupported).`);
    } else {
      setStatus(null);
    }

    dropZone.hidden = true;
    toolbar.hidden = false;
    renderGrid();
  }

  // --- page grid ---

  function moveLeft(i) {
    if (i === 0) return;
    [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]];
    renderGrid();
  }
  function moveRight(i) {
    if (i === pages.length - 1) return;
    [pages[i], pages[i + 1]] = [pages[i + 1], pages[i]];
    renderGrid();
  }
  function rotate(i, delta) {
    pages[i].rotation = ((pages[i].rotation + delta) % 360 + 360) % 360;
    renderGrid();
  }
  function removePage(i) {
    pages.splice(i, 1);
    renderGrid();
  }

  function renderGrid() {
    pageGrid.innerHTML = "";

    pages.forEach((p, i) => {
      const card = document.createElement("div");
      card.className = "page-card";

      const frame = document.createElement("div");
      frame.className = "thumb-frame";
      const img = document.createElement("img");
      img.src = p.thumbSrc;
      img.style.transform = `rotate(${p.rotation}deg)`;
      img.alt = `Page ${i + 1}`;
      frame.appendChild(img);

      const footer = document.createElement("div");
      footer.className = "page-card-footer";

      const number = document.createElement("span");
      number.className = "page-number";
      number.textContent = String(i + 1);

      const controls = document.createElement("div");
      controls.className = "page-card-controls";

      const leftBtn = mkBtn("←", `Move page ${i + 1} left`, i === 0, () => moveLeft(i));
      const ccwBtn = mkBtn("↺", `Rotate page ${i + 1} left`, false, () => rotate(i, -90));
      const cwBtn = mkBtn("↻", `Rotate page ${i + 1} right`, false, () => rotate(i, 90));
      const rightBtn = mkBtn("→", `Move page ${i + 1} right`, i === pages.length - 1, () => moveRight(i));
      const removeBtn = mkBtn("×", `Remove page ${i + 1}`, false, () => removePage(i));
      removeBtn.classList.add("page-btn-remove");

      controls.append(leftBtn, ccwBtn, cwBtn, rightBtn, removeBtn);
      footer.append(number, controls);
      card.append(frame, footer);
      pageGrid.appendChild(card);
    });

    const hasPages = pages.length > 0;
    pageGrid.hidden = !hasPages;
    emptyMsg.hidden = hasPages;
    exportBtn.disabled = !hasPages;
    resultBox.hidden = true;
  }

  function mkBtn(label, ariaLabel, disabled, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-btn";
    btn.textContent = label;
    btn.setAttribute("aria-label", ariaLabel);
    btn.disabled = disabled;
    btn.addEventListener("click", onClick);
    return btn;
  }

  resetBtn.addEventListener("click", () => {
    sources = [];
    pages = [];
    dropZone.hidden = false;
    toolbar.hidden = true;
    pageGrid.hidden = true;
    pageGrid.innerHTML = "";
    emptyMsg.hidden = true;
    resultBox.hidden = true;
    setStatus(null);
    dropLabel.textContent = "Drag a PDF here, or click to choose one";
  });

  // --- export ---

  async function exportPdf() {
    if (pages.length === 0) return;

    resultBox.hidden = true;
    setStatus("Building PDF…");
    progressTrack.hidden = false;
    setProgress(0);
    exportBtn.disabled = true;

    try {
      const outDoc = await PDFLib.PDFDocument.create();
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const src = sources[p.sourceIndex];
        const [copied] = await outDoc.copyPages(src.pdfLibDoc, [p.pageIndexInSource]);
        if (p.rotation) {
          const current = copied.getRotation().angle || 0;
          copied.setRotation(PDFLib.degrees((current + p.rotation) % 360));
        }
        outDoc.addPage(copied);
        setProgress((i + 1) / pages.length);
      }

      const bytes = await outDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      downloadLink.href = url;
      downloadLink.download = "edited.pdf";
      resultInfo.textContent = `edited.pdf — ${pages.length} page${pages.length === 1 ? "" : "s"}, ${(blob.size / 1024).toFixed(0)} KB`;
      resultBox.hidden = false;
      setStatus("Done!");
    } catch (err) {
      console.error(err);
      setStatus("Couldn't build the PDF — try again.");
    } finally {
      progressTrack.hidden = true;
      exportBtn.disabled = pages.length === 0;
    }
  }

  exportBtn.addEventListener("click", exportPdf);
  addBtn.addEventListener("click", () => fileInput.click());

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
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = ""; // allow re-adding a file after it's been removed
  });
})();
