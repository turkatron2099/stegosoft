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

  const PAGE_MARGIN_PT = 54; // 0.75in

  function setProgress(fraction) {
    progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  function newPdf() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: "pt", format: "letter" });
  }

  // --- plain text ---

  async function textToPdf(file) {
    const text = await file.text();
    const pdf = newPdf();
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

    return pdf;
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

  async function imageToPdf(file) {
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

    const pdf = newPdf();
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
    return pdf;
  }

  // --- docx (via mammoth → HTML → rasterized pages) ---

  async function docxToPdf(file) {
    statusText.textContent = "Reading document…";
    const arrayBuffer = await file.arrayBuffer();

    statusText.textContent = "Converting formatting…";
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
    docxRender.innerHTML = html || "<p></p>";

    statusText.textContent = "Rendering pages…";
    // scale 1.5 is still sharp enough for on-screen reading and light
    // printing — text rasterized at scale 2 and JPEG-compressed produces
    // multi-megabyte files fast, since sharp text edges compress far worse
    // under JPEG than photos do.
    const canvas = await html2canvas(docxRender, { scale: 1.5, backgroundColor: "#ffffff" });

    const pdf = newPdf();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const pxPerPage = Math.floor((pageHeight * canvas.width) / imgWidth);

    let renderedPx = 0;
    let firstPage = true;
    while (renderedPx < canvas.height) {
      const sliceHeight = Math.min(pxPerPage, canvas.height - renderedPx);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      pageCanvas
        .getContext("2d")
        .drawImage(canvas, 0, renderedPx, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      const sliceImgHeight = (sliceHeight * imgWidth) / canvas.width;
      if (!firstPage) pdf.addPage();
      pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.82), "JPEG", 0, 0, imgWidth, sliceImgHeight, undefined, "MEDIUM");

      renderedPx += sliceHeight;
      firstPage = false;
    }

    docxRender.innerHTML = "";
    return pdf;
  }

  // --- dispatch ---

  function converterFor(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".docx")) return docxToPdf;
    if (name.endsWith(".txt")) return textToPdf;
    if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return imageToPdf;
    return null;
  }

  async function handleFile(file) {
    resultBox.hidden = true;
    statusText.hidden = false;
    progressTrack.hidden = false;
    setProgress(0.15);
    dropLabel.textContent = file.name;

    const convert = converterFor(file);
    if (!convert) {
      statusText.textContent = "Unsupported file type — see the formats listed above.";
      progressTrack.hidden = true;
      return;
    }

    statusText.textContent = "Converting…";
    try {
      const pdf = await convert(file);
      setProgress(1);

      const outName = file.name.replace(/\.[^.]+$/, "") + ".pdf";
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);

      downloadLink.href = url;
      downloadLink.download = outName;
      resultInfo.textContent = `${outName} — ${(blob.size / 1024).toFixed(0)} KB`;
      resultBox.hidden = false;
      statusText.textContent = "Done!";
    } catch (err) {
      console.error(err);
      statusText.textContent = "Couldn't convert that file — it may be corrupted or in an unsupported variant.";
    } finally {
      progressTrack.hidden = true;
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
})();
