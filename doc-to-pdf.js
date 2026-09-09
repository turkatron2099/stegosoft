(() => {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const dropLabel = document.getElementById("drop-label");
  const statusText = document.getElementById("status-text");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");
  const resultBox = document.getElementById("result-box");
  const resultInfo = document.getElementById("result-info");
  const downloadLink = document.getElementById("download-link");
  const docxRender = document.getElementById("docx-render");
  const queueList = document.getElementById("queue-list");
  const queueActions = document.getElementById("queue-actions");
  const clearBtn = document.getElementById("clear-btn");
  const combineBtn = document.getElementById("combine-btn");

  const PAGE_MARGIN_PT = 54; // 0.75in

  // Files the user has added, in the order they'll appear in the combined
  // PDF. Each entry keeps its own convert function so converterFor() only
  // ever needs to run once per file, at add-time.
  let queue = [];
  let nextId = 1;

  function setProgress(fraction) {
    progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  function newPdf() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: "pt", format: "letter" });
  }

  // --- plain text ---
  // Draws onto whatever page `pdf` is currently on — the caller (combine())
  // is responsible for having already called addPage() between files, so
  // this only ever calls it for its own internal overflow onto more pages.

  async function textToPdf(pdf, file) {
    const text = await file.text();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const usableWidth = pageWidth - PAGE_MARGIN_PT * 2;
    const lineHeight = 14;

    pdf.setFont("Courier", "normal");
    pdf.setFontSize(10.5);

    const lines = pdf.splitTextToSize(text || " ", usableWidth);
    let y = PAGE_MARGIN_PT;
    lines.forEach((line) => {
      if (y > pageHeight - PAGE_MARGIN_PT) {
        pdf.addPage();
        y = PAGE_MARGIN_PT;
      }
      pdf.text(line, PAGE_MARGIN_PT, y);
      y += lineHeight;
    });
  }

  // --- images ---

  function loadImage(file) {
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

  async function imageToPdf(pdf, file) {
    const img = await loadImage(file);

    // Draw through a canvas regardless of source format — normalizes GIF/
    // WEBP/BMP (which jsPDF can't embed directly) into something it can.
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx2d = canvas.getContext("2d");
    ctx2d.drawImage(img, 0, 0);

    // Only keep PNG (larger) when the image actually needs its alpha
    // channel — otherwise JPEG at high quality is far smaller. jsPDF also
    // embeds images uncompressed unless a compression level is passed
    // explicitly, so that's required either way.
    const transparent = hasTransparency(ctx2d, canvas.width, canvas.height);
    const format = transparent ? "PNG" : "JPEG";
    const dataUrl = transparent ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92);

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const maxW = pageWidth - PAGE_MARGIN_PT * 2;
    const maxH = pageHeight - PAGE_MARGIN_PT * 2;
    const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    const x = (pageWidth - w) / 2;
    const y = (pageHeight - h) / 2;

    pdf.addImage(dataUrl, format, x, y, w, h, undefined, "MEDIUM");
    URL.revokeObjectURL(img.src);
  }

  // --- docx (via mammoth → HTML → rasterized pages) ---

  async function docxToPdf(pdf, file) {
    statusText.textContent = `Reading ${file.name}…`;
    const arrayBuffer = await file.arrayBuffer();

    statusText.textContent = `Converting ${file.name}…`;
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
    docxRender.innerHTML = html || "<p></p>";

    statusText.textContent = `Rendering ${file.name}…`;
    // scale 1.5 is still sharp enough for on-screen reading and light
    // printing — text rasterized at scale 2 and JPEG-compressed produces
    // multi-megabyte files fast, since sharp text edges compress far worse
    // under JPEG than photos do.
    const canvas = await html2canvas(docxRender, { scale: 1.5, backgroundColor: "#ffffff" });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const pxPerPage = Math.floor((pageHeight * canvas.width) / imgWidth);

    let renderedPx = 0;
    let firstSlice = true;
    while (renderedPx < canvas.height) {
      const sliceHeight = Math.min(pxPerPage, canvas.height - renderedPx);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      pageCanvas
        .getContext("2d")
        .drawImage(canvas, 0, renderedPx, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      const sliceImgHeight = (sliceHeight * imgWidth) / canvas.width;
      if (!firstSlice) pdf.addPage();
      pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.82), "JPEG", 0, 0, imgWidth, sliceImgHeight, undefined, "MEDIUM");

      renderedPx += sliceHeight;
      firstSlice = false;
    }

    docxRender.innerHTML = "";
  }

  // --- dispatch ---

  function converterFor(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".docx")) return { convert: docxToPdf, label: "Document" };
    if (name.endsWith(".txt")) return { convert: textToPdf, label: "Text" };
    if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return { convert: imageToPdf, label: "Image" };
    return null;
  }

  // --- queue management ---

  function addFiles(fileList) {
    let added = 0;
    let skipped = 0;
    Array.from(fileList).forEach((file) => {
      const info = converterFor(file);
      if (!info) {
        skipped++;
        return;
      }
      queue.push({ id: nextId++, file, label: info.label, convert: info.convert });
      added++;
    });

    renderQueue();

    if (skipped > 0) {
      statusText.hidden = false;
      statusText.textContent = `${added} file${added === 1 ? "" : "s"} added, ${skipped} skipped (unsupported type — see the formats listed above).`;
    } else {
      statusText.hidden = true;
    }
  }

  function moveItem(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= queue.length) return;
    const [item] = queue.splice(index, 1);
    queue.splice(target, 0, item);
    renderQueue();
  }

  function removeItem(index) {
    queue.splice(index, 1);
    renderQueue();
  }

  function renderQueue() {
    queueList.innerHTML = "";

    queue.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "queue-item";

      const index = document.createElement("span");
      index.className = "queue-item-index";
      index.textContent = String(i + 1);

      const name = document.createElement("span");
      name.className = "queue-item-name";
      name.textContent = item.file.name;

      const type = document.createElement("span");
      type.className = "queue-item-type";
      type.textContent = item.label;

      const controls = document.createElement("div");
      controls.className = "queue-item-controls";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "queue-btn";
      upBtn.textContent = "↑";
      upBtn.setAttribute("aria-label", `Move ${item.file.name} up`);
      upBtn.disabled = i === 0;
      upBtn.addEventListener("click", () => moveItem(i, -1));

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "queue-btn";
      downBtn.textContent = "↓";
      downBtn.setAttribute("aria-label", `Move ${item.file.name} down`);
      downBtn.disabled = i === queue.length - 1;
      downBtn.addEventListener("click", () => moveItem(i, 1));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "queue-btn queue-btn-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `Remove ${item.file.name}`);
      removeBtn.addEventListener("click", () => removeItem(i));

      controls.append(upBtn, downBtn, removeBtn);
      li.append(index, name, type, controls);
      queueList.appendChild(li);
    });

    const hasItems = queue.length > 0;
    queueList.hidden = !hasItems;
    queueActions.hidden = !hasItems;
    dropLabel.textContent = hasItems
      ? "Drag more files here, or click to add more"
      : "Drag files here, or click to choose — add as many as you like";
  }

  clearBtn.addEventListener("click", () => {
    queue = [];
    renderQueue();
    resultBox.hidden = true;
    statusText.hidden = true;
  });

  // --- combine everything in the queue into one PDF ---

  async function combine() {
    if (queue.length === 0) return;

    resultBox.hidden = true;
    statusText.hidden = false;
    progressTrack.hidden = false;
    setProgress(0.05);
    combineBtn.disabled = true;
    clearBtn.disabled = true;

    try {
      const pdf = newPdf();
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (i > 0) pdf.addPage(); // start each new file on its own fresh page
        statusText.textContent = `Converting ${item.file.name} (${i + 1}/${queue.length})…`;
        await item.convert(pdf, item.file);
        setProgress((i + 1) / queue.length);
      }

      const outName =
        queue.length === 1 ? queue[0].file.name.replace(/\.[^.]+$/, "") + ".pdf" : "combined.pdf";
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const pageCount = pdf.getNumberOfPages();

      downloadLink.href = url;
      downloadLink.download = outName;
      resultInfo.textContent = `${outName} — ${pageCount} page${pageCount === 1 ? "" : "s"}, ${(blob.size / 1024).toFixed(0)} KB`;
      resultBox.hidden = false;
      statusText.textContent = "Done!";
    } catch (err) {
      console.error(err);
      statusText.textContent = "Couldn't build the PDF — one of the files may be corrupted or in an unsupported variant.";
    } finally {
      progressTrack.hidden = true;
      combineBtn.disabled = false;
      clearBtn.disabled = false;
    }
  }

  combineBtn.addEventListener("click", combine);

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
