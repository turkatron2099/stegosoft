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

  const editorBackdrop = document.getElementById("page-editor-backdrop");
  const editorStage = document.getElementById("page-editor-stage");
  const editorBg = document.getElementById("page-editor-bg");
  const annotLayer = document.getElementById("annot-layer");
  const addTextBtn = document.getElementById("add-text-btn");
  const addImageBtn = document.getElementById("add-image-btn");
  const annotImageInput = document.getElementById("annot-image-input");
  const editorDoneBtn = document.getElementById("page-editor-done-btn");

  const THUMB_TARGET_WIDTH = 240; // px, rendered once and reused at whatever CSS size the grid displays it
  const EDITOR_TARGET_WIDTH = 700; // px, the big page-editor background render

  // Loaded documents, one per PDF or image added. Each page below points
  // back into one of these by index rather than duplicating page data —
  // reordering/rotating/deleting only ever touches `pages`.
  let sources = []; // { pdfLibDoc, pdfjsDoc, name }
  // pages[i]: { sourceIndex, pageIndexInSource, rotation (0/90/180/270), thumbSrc, annotations }
  // annotations[j] is one of:
  //   { type: "text", x, y, w, h, text, fontSize, bold, color: {r,g,b} }
  //   { type: "image", x, y, w, h, bytes (Uint8Array), format: "png"|"jpeg", dataUrl }
  // x/y/w/h are always in PDF point units, top-left origin, y increasing
  // downward — i.e. plain CSS-style coordinates, NOT PDF's own bottom-left
  // convention. They get flipped once, at export time (see exportPdf).
  // Crucially this is the page's *native*, unrotated point space: the
  // editor always renders its background at an explicit rotation of 0
  // (see openEditor), regardless of the page's own `rotation` above or any
  // rotation already baked into the source PDF. That's what lets rotation
  // and annotations stay independent — PDF's /Rotate flag rotates a page's
  // entire content stream as one unit for display, annotations included,
  // so as long as everything is drawn in native space, whatever rotation
  // is set later (via the grid, before or after adding annotations) just
  // applies uniformly and correctly with no extra transform needed here.
  let pages = [];

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
      pages.push({ sourceIndex, pageIndexInSource: i, rotation: 0, thumbSrc, annotations: [] });
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

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "page-edit-btn";
      editBtn.textContent = p.annotations.length ? `Edit (${p.annotations.length})` : "Edit";
      editBtn.addEventListener("click", () => openEditor(i));

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
      card.append(frame, editBtn, footer);
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

  // --- page editor: add/move/resize/delete text & image overlays on one page ---

  let editingPageIndex = -1;
  let editorScale = 1; // display px per PDF point, measured after the background image loads
  let editorPageW = 0; // PDF points
  let editorPageH = 0;

  async function openEditor(pageIndex) {
    editingPageIndex = pageIndex;
    const p = pages[pageIndex];
    const src = sources[p.sourceIndex];
    const pdfjsPage = await src.pdfjsDoc.getPage(p.pageIndexInSource + 1);

    // rotation: 0 explicitly — the editor always shows/edits the page's
    // native orientation. See the big comment on `pages` near the top.
    const unscaled = pdfjsPage.getViewport({ scale: 1, rotation: 0 });
    editorPageW = unscaled.width;
    editorPageH = unscaled.height;

    const scale = EDITOR_TARGET_WIDTH / unscaled.width;
    const viewport = pdfjsPage.getViewport({ scale, rotation: 0 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pdfjsPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    editorBg.src = canvas.toDataURL("image/png");
    await new Promise((resolve) => {
      if (editorBg.complete) resolve();
      else editorBg.onload = resolve;
    });

    // Must un-hide before reading clientWidth/clientHeight below — an
    // element inside a display:none ancestor always reports 0 for both,
    // regardless of its actual (already-loaded) image size, which
    // previously collapsed the whole stage to 0x0.
    editorBackdrop.hidden = false;

    editorStage.style.width = editorBg.clientWidth + "px";
    editorStage.style.height = editorBg.clientHeight + "px";
    editorScale = editorBg.clientWidth / editorPageW;

    renderAnnotLayer();
  }

  function closeEditor() {
    editorBackdrop.hidden = true;
    editingPageIndex = -1;
    renderGrid(); // picks up any annotation-count change on the Edit button label
  }

  function currentAnnotations() {
    return pages[editingPageIndex].annotations;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function addTextAnnotation() {
    const w = 200, h = 40;
    currentAnnotations().push({
      type: "text",
      x: clamp((editorPageW - w) / 2, 0, Math.max(0, editorPageW - w)),
      y: clamp((editorPageH - h) / 2, 0, Math.max(0, editorPageH - h)),
      w,
      h,
      text: "Text",
      fontSize: 18,
      bold: false,
      color: { r: 0, g: 0, b: 0 },
    });
    renderAnnotLayer();
  }

  async function addImageAnnotationFromFile(file) {
    const img = await loadImageEl(file);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx2d = canvas.getContext("2d");
    ctx2d.drawImage(img, 0, 0);
    const transparent = hasTransparency(ctx2d, canvas.width, canvas.height);
    const format = transparent ? "png" : "jpeg";
    const dataUrl = transparent ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92);
    const bytes = dataUrlToBytes(dataUrl);
    URL.revokeObjectURL(img.src);

    const maxW = 250; // pt, default size — fit within this, preserving aspect ratio
    const ratio = Math.min(1, maxW / img.naturalWidth);
    const w = img.naturalWidth * ratio;
    const h = img.naturalHeight * ratio;

    currentAnnotations().push({
      type: "image",
      x: clamp((editorPageW - w) / 2, 0, Math.max(0, editorPageW - w)),
      y: clamp((editorPageH - h) / 2, 0, Math.max(0, editorPageH - h)),
      w,
      h,
      bytes,
      format,
      dataUrl,
    });
    renderAnnotLayer();
  }

  function removeAnnotation(annot) {
    const list = currentAnnotations();
    const idx = list.indexOf(annot);
    if (idx !== -1) list.splice(idx, 1);
    renderAnnotLayer();
  }

  function renderAnnotLayer() {
    annotLayer.innerHTML = "";
    currentAnnotations().forEach((annot) => annotLayer.appendChild(buildAnnotEl(annot)));
  }

  function positionAnnotEl(el, annot) {
    el.style.left = annot.x * editorScale + "px";
    el.style.top = annot.y * editorScale + "px";
    el.style.width = annot.w * editorScale + "px";
    el.style.height = annot.h * editorScale + "px";
  }

  function rgbToHex(c) {
    const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  }
  function hexToRgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16) / 255,
      g: parseInt(hex.slice(3, 5), 16) / 255,
      b: parseInt(hex.slice(5, 7), 16) / 255,
    };
  }

  function buildAnnotEl(annot) {
    const el = document.createElement("div");
    el.className = "annot";
    positionAnnotEl(el, annot);

    if (annot.type === "text") {
      const textarea = document.createElement("textarea");
      textarea.className = "annot-text-area";
      textarea.value = annot.text;
      textarea.style.fontSize = annot.fontSize * editorScale + "px";
      textarea.style.fontWeight = annot.bold ? "700" : "400";
      textarea.style.color = rgbToHex(annot.color);
      textarea.addEventListener("input", () => { annot.text = textarea.value; });
      textarea.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.appendChild(textarea);

      const tb = document.createElement("div");
      tb.className = "annot-toolbar";

      const sizeInput = document.createElement("input");
      sizeInput.type = "number";
      sizeInput.min = "6";
      sizeInput.max = "96";
      sizeInput.value = String(annot.fontSize);
      sizeInput.title = "Font size (pt)";
      sizeInput.addEventListener("pointerdown", (e) => e.stopPropagation());
      sizeInput.addEventListener("change", () => {
        annot.fontSize = clamp(parseInt(sizeInput.value, 10) || 18, 6, 96);
        textarea.style.fontSize = annot.fontSize * editorScale + "px";
      });

      const boldBtn = document.createElement("button");
      boldBtn.type = "button";
      boldBtn.className = "annot-bold-btn" + (annot.bold ? " is-active" : "");
      boldBtn.textContent = "B";
      boldBtn.title = "Bold";
      boldBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      boldBtn.addEventListener("click", () => {
        annot.bold = !annot.bold;
        boldBtn.classList.toggle("is-active", annot.bold);
        textarea.style.fontWeight = annot.bold ? "700" : "400";
      });

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = rgbToHex(annot.color);
      colorInput.title = "Text color";
      colorInput.addEventListener("pointerdown", (e) => e.stopPropagation());
      colorInput.addEventListener("input", () => {
        annot.color = hexToRgb(colorInput.value);
        textarea.style.color = colorInput.value;
      });

      tb.append(sizeInput, boldBtn, colorInput);
      el.appendChild(tb);
    } else {
      const img = document.createElement("img");
      img.className = "annot-img";
      img.src = annot.dataUrl;
      img.alt = "";
      el.appendChild(img);
    }

    const moveHandle = document.createElement("div");
    moveHandle.className = "annot-handle annot-move";
    moveHandle.textContent = "⠿";
    el.appendChild(moveHandle);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "annot-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "Remove");
    removeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    removeBtn.addEventListener("click", () => removeAnnotation(annot));
    el.appendChild(removeBtn);

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "annot-handle annot-resize";
    el.appendChild(resizeHandle);

    wireDrag(moveHandle, annot, el, "move");
    wireDrag(resizeHandle, annot, el, "resize");

    return el;
  }

  // Pointer capture keeps the drag/resize going even once the cursor moves
  // outside the small handle element — standard pattern, no library needed.
  function wireDrag(handle, annot, el, mode) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startX = annot.x, startY = annot.y, startW = annot.w, startH = annot.h;

      function onMove(ev) {
        const dx = (ev.clientX - startClientX) / editorScale;
        const dy = (ev.clientY - startClientY) / editorScale;
        if (mode === "move") {
          annot.x = clamp(startX + dx, 0, Math.max(0, editorPageW - annot.w));
          annot.y = clamp(startY + dy, 0, Math.max(0, editorPageH - annot.h));
        } else {
          annot.w = clamp(startW + dx, 20, editorPageW - annot.x);
          annot.h = clamp(startH + dy, 12, editorPageH - annot.y);
        }
        positionAnnotEl(el, annot);
      }
      function onUp(ev) {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
      }
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  addTextBtn.addEventListener("click", addTextAnnotation);
  addImageBtn.addEventListener("click", () => annotImageInput.click());
  annotImageInput.addEventListener("change", () => {
    if (annotImageInput.files[0]) addImageAnnotationFromFile(annotImageInput.files[0]);
    annotImageInput.value = "";
  });
  editorDoneBtn.addEventListener("click", closeEditor);
  editorBackdrop.addEventListener("click", (e) => {
    if (e.target === editorBackdrop) closeEditor();
  });

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
      const helvetica = await outDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      const helveticaBold = await outDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const src = sources[p.sourceIndex];
        const [copied] = await outDoc.copyPages(src.pdfLibDoc, [p.pageIndexInSource]);

        // Drawn in the page's native (unrotated) point space — see the big
        // comment on `pages` near the top for why this stays correct
        // regardless of the rotation applied just below.
        if (p.annotations.length) {
          const nativeH = copied.getSize().height;
          for (const annot of p.annotations) {
            if (annot.type === "text") {
              copied.drawText(annot.text || "", {
                x: annot.x,
                y: nativeH - annot.y - annot.fontSize,
                size: annot.fontSize,
                font: annot.bold ? helveticaBold : helvetica,
                color: PDFLib.rgb(annot.color.r, annot.color.g, annot.color.b),
                maxWidth: annot.w,
                lineHeight: annot.fontSize * 1.2,
              });
            } else {
              const embedded =
                annot.format === "png" ? await outDoc.embedPng(annot.bytes) : await outDoc.embedJpg(annot.bytes);
              copied.drawImage(embedded, {
                x: annot.x,
                y: nativeH - annot.y - annot.h,
                width: annot.w,
                height: annot.h,
              });
            }
          }
        }

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
