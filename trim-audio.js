(() => {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const dropLabel = document.getElementById("drop-label");
  const statusText = document.getElementById("status-text");
  const editor = document.getElementById("editor");
  const sourceAudio = document.getElementById("source-audio");
  const waveform = document.getElementById("waveform");
  const startInput = document.getElementById("start-input");
  const endInput = document.getElementById("end-input");
  const markStartBtn = document.getElementById("mark-start-btn");
  const markEndBtn = document.getElementById("mark-end-btn");
  const selectionInfo = document.getElementById("selection-info");
  const formatSelect = document.getElementById("format-select");
  const bitrateSelect = document.getElementById("bitrate-select");
  const trimBtn = document.getElementById("trim-btn");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");
  const resultBox = document.getElementById("result-box");
  const resultInfo = document.getElementById("result-info");
  const downloadLink = document.getElementById("download-link");
  const previewAudio = document.getElementById("preview-audio");

  const BLOCK_SIZE = 1152; // samples per MP3 frame — required by lamejs

  let audioBuffer = null;
  let sourceUrl = null;

  function setProgress(fraction) {
    progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(2);
    return `${m}:${s.padStart(5, "0")}`;
  }

  // --- waveform ---

  function drawWaveform() {
    const ctx = waveform.getContext("2d");
    const w = waveform.width;
    const h = waveform.height;
    ctx.clearRect(0, 0, w, h);

    if (!audioBuffer) return;

    const data = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / w));
    const mid = h / 2;

    ctx.fillStyle = "#3f8f8a";
    for (let x = 0; x < w; x++) {
      const start = x * samplesPerPixel;
      let min = 1;
      let max = -1;
      for (let i = 0; i < samplesPerPixel; i++) {
        const v = data[start + i] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = mid + min * mid;
      const y2 = mid + max * mid;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }

    // Shade the selected [start, end] range.
    const duration = audioBuffer.duration;
    const startFrac = Math.min(1, Math.max(0, parseFloat(startInput.value) / duration || 0));
    const endFrac = Math.min(1, Math.max(0, parseFloat(endInput.value) / duration || 0));
    ctx.fillStyle = "rgba(250, 169, 104, 0.25)";
    ctx.fillRect(startFrac * w, 0, (endFrac - startFrac) * w, h);
    ctx.strokeStyle = "#faa968";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startFrac * w, 0);
    ctx.lineTo(startFrac * w, h);
    ctx.moveTo(endFrac * w, 0);
    ctx.lineTo(endFrac * w, h);
    ctx.stroke();
  }

  function updateSelectionInfo() {
    const start = parseFloat(startInput.value) || 0;
    const end = parseFloat(endInput.value) || 0;
    const selected = Math.max(0, end - start);
    selectionInfo.textContent = `Selected: ${formatTime(start)} → ${formatTime(end)} (${selected.toFixed(2)}s)`;
    drawWaveform();
  }

  // --- loading ---

  async function handleFile(file) {
    resultBox.hidden = true;
    editor.hidden = true;
    statusText.hidden = false;
    statusText.textContent = "Decoding audio…";
    dropLabel.textContent = file.name;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      audioCtx.close();

      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      sourceUrl = URL.createObjectURL(file);
      sourceAudio.src = sourceUrl;

      startInput.max = audioBuffer.duration;
      endInput.max = audioBuffer.duration;
      startInput.value = 0;
      endInput.value = audioBuffer.duration.toFixed(2);

      statusText.hidden = true;
      editor.hidden = false;
      updateSelectionInfo();
    } catch (err) {
      console.error(err);
      statusText.textContent = "Couldn't decode that file — make sure it's a valid audio file.";
    }
  }

  // --- trim + encode ---

  function floatTo16BitPCM(floatSamples) {
    const out = new Int16Array(floatSamples.length);
    for (let i = 0; i < floatSamples.length; i++) {
      const s = Math.max(-1, Math.min(1, floatSamples[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function getTrimmedChannels(startSec, endSec) {
    const startSample = Math.floor(startSec * audioBuffer.sampleRate);
    const endSample = Math.min(audioBuffer.length, Math.ceil(endSec * audioBuffer.sampleRate));
    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channels.push(audioBuffer.getChannelData(c).subarray(startSample, endSample));
    }
    return channels;
  }

  function encodeWav(channels, sampleRate) {
    const numChannels = channels.length;
    const numFrames = channels[0].length;
    const blockAlign = numChannels * 2;
    const dataSize = numFrames * blockAlign;

    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    const int16Channels = channels.map(floatTo16BitPCM);
    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numChannels; c++) {
        view.setInt16(offset, int16Channels[c][i], true);
        offset += 2;
      }
    }

    return new Blob([buf], { type: "audio/wav" });
  }

  async function encodeMp3(channels, sampleRate, kbps) {
    const numChannels = Math.min(2, channels.length);
    const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
    const left = floatTo16BitPCM(channels[0]);
    const right = numChannels === 2 ? floatTo16BitPCM(channels[1]) : null;
    const mp3Chunks = [];

    for (let i = 0; i < left.length; i += BLOCK_SIZE) {
      const leftBlock = left.subarray(i, i + BLOCK_SIZE);
      const buf = numChannels === 2 ? encoder.encodeBuffer(leftBlock, right.subarray(i, i + BLOCK_SIZE)) : encoder.encodeBuffer(leftBlock);
      if (buf.length > 0) mp3Chunks.push(buf);
      if (i % (BLOCK_SIZE * 200) === 0) {
        setProgress(i / left.length);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    const finalBuf = encoder.flush();
    if (finalBuf.length > 0) mp3Chunks.push(finalBuf);
    setProgress(1);

    return new Blob(mp3Chunks, { type: "audio/mpeg" });
  }

  trimBtn.addEventListener("click", async () => {
    const start = Math.max(0, parseFloat(startInput.value) || 0);
    const end = Math.min(audioBuffer.duration, parseFloat(endInput.value) || 0);
    if (end <= start) {
      statusText.hidden = false;
      statusText.textContent = "End time has to be after the start time.";
      return;
    }

    trimBtn.disabled = true;
    resultBox.hidden = true;
    progressTrack.hidden = false;
    setProgress(0);
    statusText.hidden = false;
    statusText.textContent = "Trimming…";

    try {
      const channels = getTrimmedChannels(start, end);
      const format = formatSelect.value;
      let blob;
      let ext;

      if (format === "mp3") {
        statusText.textContent = "Encoding MP3…";
        blob = await encodeMp3(channels, audioBuffer.sampleRate, parseInt(bitrateSelect.value, 10));
        ext = "mp3";
      } else {
        blob = encodeWav(channels, audioBuffer.sampleRate);
        ext = "wav";
        setProgress(1);
      }

      const baseName = dropLabel.textContent.replace(/\.[^.]+$/, "") || "trimmed";
      const outName = `${baseName}-trimmed.${ext}`;
      const url = URL.createObjectURL(blob);

      downloadLink.href = url;
      downloadLink.download = outName;
      previewAudio.src = url;
      resultInfo.textContent = `${outName} — ${(blob.size / 1024).toFixed(0)} KB — ${(end - start).toFixed(2)}s`;
      resultBox.hidden = false;
      statusText.textContent = "Done!";
    } catch (err) {
      console.error(err);
      statusText.textContent = "Couldn't trim that file.";
    } finally {
      progressTrack.hidden = true;
      trimBtn.disabled = false;
    }
  });

  startInput.addEventListener("input", updateSelectionInfo);
  endInput.addEventListener("input", updateSelectionInfo);
  markStartBtn.addEventListener("click", () => {
    startInput.value = sourceAudio.currentTime.toFixed(2);
    updateSelectionInfo();
  });
  markEndBtn.addEventListener("click", () => {
    endInput.value = sourceAudio.currentTime.toFixed(2);
    updateSelectionInfo();
  });
  formatSelect.addEventListener("change", () => {
    bitrateSelect.hidden = formatSelect.value !== "mp3";
  });
  bitrateSelect.hidden = formatSelect.value !== "mp3";

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
