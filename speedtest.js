(() => {
  const BASE = "https://speed.cloudflare.com";

  const startBtn = document.getElementById("start-btn");
  const statusText = document.getElementById("status-text");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");

  const pingValue = document.getElementById("ping-value");
  const jitterValue = document.getElementById("jitter-value");
  const downloadValue = document.getElementById("download-value");
  const uploadValue = document.getElementById("upload-value");

  const meterPing = document.getElementById("meter-ping");
  const meterJitter = document.getElementById("meter-jitter");
  const meterDownload = document.getElementById("meter-download");
  const meterUpload = document.getElementById("meter-upload");

  function setActive(meter) {
    [meterPing, meterJitter, meterDownload, meterUpload].forEach((m) =>
      m.classList.toggle("is-active", m === meter)
    );
  }

  function setProgress(fraction) {
    progressFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  function median(nums) {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  async function measureLatency() {
    setActive(meterPing);
    statusText.textContent = "Measuring ping…";
    const samples = [];
    const rounds = 12;
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      await fetch(`${BASE}/__down?bytes=0&cache=${Math.random()}`, { cache: "no-store" });
      samples.push(performance.now() - t0);
      setProgress((i + 1) / rounds);
    }
    // Drop the first sample (connection setup) before computing stats.
    const warm = samples.slice(1);
    const latency = median(warm);
    const diffs = warm.slice(1).map((v, i) => Math.abs(v - warm[i]));
    const jitter = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;

    pingValue.textContent = latency.toFixed(0);
    jitterValue.textContent = jitter.toFixed(1);
  }

  async function measureDownload() {
    setActive(meterDownload);
    statusText.textContent = "Testing download speed…";
    setProgress(0);

    // Small warm-up request to ramp up the TCP window before the timed run.
    await fetch(`${BASE}/__down?bytes=1000000&cache=${Math.random()}`, { cache: "no-store" });

    const testBytes = 26214400; // 25 MB
    const t0 = performance.now();
    const res = await fetch(`${BASE}/__down?bytes=${testBytes}&cache=${Math.random()}`, {
      cache: "no-store",
    });
    const reader = res.body.getReader();
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      setProgress(received / testBytes);
      const elapsed = (performance.now() - t0) / 1000;
      if (elapsed > 0.2) {
        downloadValue.textContent = ((received * 8) / 1e6 / elapsed).toFixed(1);
      }
    }

    const duration = (performance.now() - t0) / 1000;
    downloadValue.textContent = ((received * 8) / 1e6 / duration).toFixed(1);
  }

  function randomBlob(sizeBytes) {
    const chunkSize = 65536;
    const chunks = [];
    let remaining = sizeBytes;
    while (remaining > 0) {
      const size = Math.min(chunkSize, remaining);
      const arr = new Uint8Array(size);
      crypto.getRandomValues(arr);
      chunks.push(arr);
      remaining -= size;
    }
    return new Blob(chunks);
  }

  async function measureUpload() {
    setActive(meterUpload);
    statusText.textContent = "Testing upload speed…";
    setProgress(0);

    const size = 8 * 1024 * 1024; // 8 MB
    const blob = randomBlob(size);

    const t0 = performance.now();
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/__up`, true);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(e.loaded / e.total);
      };
      xhr.onload = resolve;
      xhr.onerror = reject;
      xhr.send(blob);
    });
    const duration = (performance.now() - t0) / 1000;
    uploadValue.textContent = ((size * 8) / 1e6 / duration).toFixed(1);
    setProgress(1);
  }

  async function runTest() {
    startBtn.disabled = true;
    progressTrack.hidden = false;
    pingValue.textContent = "--";
    jitterValue.textContent = "--";
    downloadValue.textContent = "--";
    uploadValue.textContent = "--";

    try {
      await measureLatency();
      await measureDownload();
      await measureUpload();
      statusText.textContent = "Done. Run it again anytime.";
    } catch (err) {
      statusText.textContent = "Test failed — check your connection and try again.";
      console.error(err);
    } finally {
      setActive(null);
      progressTrack.hidden = true;
      setProgress(0);
      startBtn.disabled = false;
    }
  }

  startBtn.addEventListener("click", runTest);
})();
