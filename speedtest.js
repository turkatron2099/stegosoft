(() => {
  const BASE = "https://speed.cloudflare.com";
  const PARALLEL_STREAMS = 8;
  const TEST_DURATION_MS = 9000;
  const RAMP_UP_MS = 1000; // exclude the TCP slow-start window from the final figure
  const DOWNLOAD_CHUNK_BYTES = 20000000; // 20 MB — big enough that fast connections don't idle between chunks
  const UPLOAD_CHUNK_BYTES = 4000000; // 4 MB per upload request, repeated for the test window

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
    const rounds = 16;
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      await fetch(`${BASE}/__down?bytes=0&cache=${Math.random()}`, { cache: "no-store" });
      samples.push(performance.now() - t0);
      setProgress((i + 1) / rounds);
    }
    // Drop the first couple of samples (connection/TLS setup) before computing stats.
    const warm = samples.slice(2);
    const latency = median(warm);
    const diffs = warm.slice(1).map((v, i) => Math.abs(v - warm[i]));
    const jitter = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;

    pingValue.textContent = latency.toFixed(0);
    jitterValue.textContent = jitter.toFixed(1);
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

  // Runs several parallel streams for a fixed duration and reports aggregate
  // throughput — a single connection can't saturate a fast link before a
  // fixed-size transfer finishes, so real speed tests always use several.
  async function measureThroughput({ kind, meter, valueEl, durationMs }) {
    setActive(meter);
    statusText.textContent =
      kind === "download" ? "Testing download speed…" : "Testing upload speed…";
    setProgress(0);

    let totalBytes = 0;
    let stopFlag = false;
    let bytesAtRampEnd = null;
    let rampEndTime = null;
    const startTime = performance.now();

    async function downloadWorker() {
      while (!stopFlag) {
        const res = await fetch(`${BASE}/__down?bytes=${DOWNLOAD_CHUNK_BYTES}&cache=${Math.random()}`, {
          cache: "no-store",
        });
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          if (stopFlag) {
            reader.cancel().catch(() => {});
            return;
          }
        }
      }
    }

    function uploadChunk() {
      return new Promise((resolve, reject) => {
        const blob = randomBlob(UPLOAD_CHUNK_BYTES);
        const xhr = new XMLHttpRequest();
        let lastLoaded = 0;
        xhr.open("POST", `${BASE}/__up`, true);
        xhr.upload.onprogress = (e) => {
          totalBytes += e.loaded - lastLoaded;
          lastLoaded = e.loaded;
        };
        xhr.onload = () => resolve();
        xhr.onerror = () => reject(new Error("upload failed"));
        xhr.send(blob);
      });
    }

    async function uploadWorker() {
      while (!stopFlag) {
        await uploadChunk();
      }
    }

    const worker = kind === "download" ? downloadWorker : uploadWorker;
    const workers = Array.from({ length: PARALLEL_STREAMS }, () => worker());

    const progressTimer = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - startTime) / 1000;
      setProgress(Math.min(1, elapsed / (durationMs / 1000)));

      // Mark the point where slow-start ramp-up ends, so the final figure
      // can be computed from the steady-state window only.
      if (bytesAtRampEnd === null && now - startTime >= RAMP_UP_MS) {
        bytesAtRampEnd = totalBytes;
        rampEndTime = now;
      }

      if (elapsed > 0.3) {
        valueEl.textContent = ((totalBytes * 8) / 1e6 / elapsed).toFixed(1);
      }
    }, 200);

    await new Promise((r) => setTimeout(r, durationMs));
    stopFlag = true;
    // Snapshot bytes/time now — measuring the transfer window, not the
    // cleanup that follows. In-flight requests are still allowed to unwind
    // below, but they no longer count toward the reported duration.
    const stopTime = performance.now();
    const bytesAtStop = totalBytes;
    clearInterval(progressTimer);

    // Let in-flight reads/uploads unwind, but don't block the UI indefinitely.
    await Promise.race([Promise.allSettled(workers), new Promise((r) => setTimeout(r, 1500))]);

    const measuredBytes = bytesAtStop - (bytesAtRampEnd ?? 0);
    const measuredSeconds = (stopTime - (rampEndTime ?? startTime)) / 1000;
    valueEl.textContent = (measuredSeconds > 0 ? (measuredBytes * 8) / 1e6 / measuredSeconds : 0).toFixed(1);
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
      await measureThroughput({
        kind: "download",
        meter: meterDownload,
        valueEl: downloadValue,
        durationMs: TEST_DURATION_MS,
      });
      await measureThroughput({
        kind: "upload",
        meter: meterUpload,
        valueEl: uploadValue,
        durationMs: TEST_DURATION_MS,
      });
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
