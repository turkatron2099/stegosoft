// Konami-code-style easter egg: Up Up Down Down Left Right Left Right B A
// Space. On success, a full-screen digital-rain takeover flashes "WAKE UP
// STEGO", then fades back to the homepage — permanently swapping the hero's
// starship-dogfight scene (starship-dogfight.js) for matrix rain via the
// "stegosoft-matrix-mode" localStorage flag both scripts share.
(function () {
  const SEQUENCE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a", " "];
  let progress = 0;

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === SEQUENCE[progress]) {
      e.preventDefault(); // arrows/space would otherwise scroll the page mid-sequence
      progress++;
      if (progress === SEQUENCE.length) {
        progress = 0;
        triggerWakeUp();
      }
    } else {
      // The mismatched key might itself be a fresh start of the sequence.
      progress = key === SEQUENCE[0] ? 1 : 0;
    }
  });

  const CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789";
  const FONT_SIZE = 18;
  const HOLD_MS = 3200; // how long the takeover stays fully up before fading out

  function triggerWakeUp() {
    if (document.querySelector(".matrix-overlay")) return; // already mid-animation

    const overlay = document.createElement("div");
    overlay.className = "matrix-overlay";
    const canvas = document.createElement("canvas");
    canvas.className = "matrix-overlay-canvas";
    const message = document.createElement("div");
    message.className = "matrix-overlay-message";
    message.textContent = "WAKE UP STEGO";
    overlay.appendChild(canvas);
    overlay.appendChild(message);
    document.body.appendChild(overlay);

    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, drops = [];

    function setup() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
      const cols = Math.ceil(W / FONT_SIZE);
      drops = new Array(cols).fill(0).map(() => Math.random() * (H / FONT_SIZE));
    }
    setup();
    window.addEventListener("resize", setup);

    let running = true;
    function frame() {
      if (!running) return;
      ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = FONT_SIZE + "px monospace";
      for (let i = 0; i < drops.length; i++) {
        ctx.fillStyle = Math.random() < 0.06 ? "#d6ffe0" : "#2fe86a";
        ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)], i * FONT_SIZE, drops[i] * FONT_SIZE);
        if (drops[i] * FONT_SIZE > H && Math.random() > 0.975) {
          drops[i] = 0;
        } else {
          drops[i]++;
        }
      }
      requestAnimationFrame(frame);
    }
    frame();

    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    setTimeout(() => message.classList.add("is-visible"), 250);

    setTimeout(() => {
      overlay.classList.remove("is-visible");
      message.classList.remove("is-visible");
      running = false;
      window.removeEventListener("resize", setup);

      // Swap the hero's space scene for matrix rain, now and on future loads.
      localStorage.setItem("stegosoft-matrix-mode", "1");
      window.dispatchEvent(new Event("stegosoft:matrix-mode-on"));

      setTimeout(() => overlay.remove(), 500); // let the fade-out transition finish
    }, HOLD_MS);
  }
})();
