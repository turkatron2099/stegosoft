(() => {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const dropLabel = document.getElementById("drop-label");
  const bitrateSelect = document.getElementById("bitrate-select");
  const statusText = document.getElementById("status-text");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");
  const resultBox = document.getElementById("result-box");
  const resultInfo = document.getElementById("result-info");
  const downloadLink = document.getElementById("download-link");
  const previewAudio = document.getElementById("preview-audio");

  const BLOCK_SIZE = 1152; // samples per MP3 frame — required by the encoder

  function setProgress(fraction) {
    progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  function floatTo16BitPCM(floatSamples) {
    const out = new Int16Array(floatSamples.length);
    for (let i = 0; i < floatSamples.length; i++) {
      const s = Math.max(-1, Math.min(1, floatSamples[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  async function encodeMp3(audioBuffer, kbps) {
    const channels = audioBuffer.numberOfChannels >= 2 ? 2 : 1;
    const encoder = new lamejs.Mp3Encoder(channels, audioBuffer.sampleRate, kbps);
    const left = floatTo16BitPCM(audioBuffer.getChannelData(0));
    const right = channels === 2 ? floatTo16BitPCM(audioBuffer.getChannelData(1)) : null;
    const mp3Chunks = [];

    for (let i = 0; i < left.length; i += BLOCK_SIZE) {
      const leftBlock = left.subarray(i, i + BLOCK_SIZE);
      const buf = channels === 2 ? encoder.encodeBuffer(leftBlock, right.subarray(i, i + BLOCK_SIZE)) : encoder.encodeBuffer(leftBlock);
      if (buf.length > 0) mp3Chunks.push(buf);

      // Yield to the main thread periodically so the tab stays responsive
      // and the progress bar actually updates during longer encodes.
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

  async function handleFile(file) {
    resultBox.hidden = true;
    statusText.hidden = false;
    progressTrack.hidden = false;
    setProgress(0);
    statusText.textContent = "Reading file…";
    dropLabel.textContent = file.name;

    try {
      const arrayBuffer = await file.arrayBuffer();

      statusText.textContent = "Decoding audio…";
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      audioCtx.close();

      statusText.textContent = "Encoding MP3…";
      const kbps = parseInt(bitrateSelect.value, 10);
      const blob = await encodeMp3(audioBuffer, kbps);

      const outName = file.name.replace(/\.[^.]+$/, "") + ".mp3";
      const url = URL.createObjectURL(blob);

      downloadLink.href = url;
      downloadLink.download = outName;
      previewAudio.src = url;
      previewAudio.hidden = false;
      resultInfo.textContent = `${outName} — ${(blob.size / 1024).toFixed(0)} KB`;
      resultBox.hidden = false;
      statusText.textContent = "Done!";
    } catch (err) {
      console.error(err);
      statusText.textContent = "Couldn't convert that file — make sure it's a valid audio file.";
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
