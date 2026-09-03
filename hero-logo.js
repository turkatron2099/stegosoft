(function () {
  const logo = document.querySelector(".hero-logo");
  if (!logo) return;

  let audioCtx = null;

  // Same two-note chime as Cool Cars' number-pickup sound (synthesized,
  // no audio file — ported from games/cool-cars.js's coinPickup()/tone()).
  function playCoinPickup() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;

    function tone(freq, dur, when, type, peakGain) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peakGain, when + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + dur + 0.02);
    }

    const now = ctx.currentTime;
    tone(988, 0.08, now, "square", 0.2);
    tone(1319, 0.18, now + 0.07, "square", 0.2);
  }

  logo.addEventListener("click", playCoinPickup);
})();
