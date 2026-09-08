// Simple countdown timer. Tracks a real end-of-block timestamp (rather than
// just decrementing a counter every tick) so the displayed time stays correct
// even if the tab is backgrounded and setInterval gets throttled.
(() => {
  const picker = document.getElementById("timeblock-picker");
  const running = document.getElementById("timeblock-running");
  const clockEl = document.getElementById("timeblock-clock");
  const labelEl = document.getElementById("timeblock-label");
  const cancelBtn = document.getElementById("timeblock-cancel");
  const doneBox = document.getElementById("timeblock-done");
  const dismissBtn = document.getElementById("timeblock-dismiss");

  const ORIGINAL_TITLE = document.title;

  let endAt = null;
  let intervalId = null;
  let audioCtx = null;

  function formatClock(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function tick() {
    const remainingMs = endAt - Date.now();
    if (remainingMs <= 0) {
      finish();
      return;
    }
    const remainingSeconds = remainingMs / 1000;
    const text = formatClock(remainingSeconds);
    clockEl.textContent = text;
    document.title = `${text} — Time Block`;
  }

  function start(minutes) {
    endAt = Date.now() + minutes * 60 * 1000;
    labelEl.textContent = `${minutes} minute block`;
    picker.hidden = true;
    doneBox.hidden = true;
    running.hidden = false;

    // Create (and unlock) the AudioContext now, inside this click handler,
    // so it's already running when we need to play the ding later without
    // a fresh user gesture.
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } else if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    tick();
    intervalId = setInterval(tick, 250);
  }

  function stop() {
    clearInterval(intervalId);
    intervalId = null;
    endAt = null;
    document.title = ORIGINAL_TITLE;
  }

  function finish() {
    stop();
    running.hidden = true;
    doneBox.hidden = false;
    document.title = "Time's up! — Time Block";
    playDing();
  }

  function cancel() {
    stop();
    running.hidden = true;
    picker.hidden = false;
  }

  function dismiss() {
    doneBox.hidden = true;
    picker.hidden = false;
    document.title = ORIGINAL_TITLE;
  }

  // Three short ascending beeps.
  function playDing() {
    if (!audioCtx) return;
    const notes = [880, 1046.5, 1318.5]; // A5, C6, E6
    notes.forEach((freq, i) => {
      const startTime = audioCtx.currentTime + i * 0.22;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  }

  picker.addEventListener("click", (e) => {
    const btn = e.target.closest(".timeblock-btn");
    if (!btn) return;
    start(parseInt(btn.dataset.minutes, 10));
  });

  cancelBtn.addEventListener("click", cancel);
  dismissBtn.addEventListener("click", dismiss);
})();
