// Holiday decorations for the homepage, on until New Year's Day 2027
// (visitor's local time): a Santa hat that follows the hero logo wherever
// hero-logo.js sends it, and snow falling over the page. Delete this file
// and its <script> tag in index.html once the season is over.
(function () {
  if (new Date() >= new Date(2027, 0, 1)) return;

  // --- Santa hat -----------------------------------------------------------
  const logo = document.querySelector(".hero-logo");
  if (logo) {
    const hat = document.createElement("img");
    hat.src = "images/santa-hat.svg";
    hat.alt = "";
    hat.setAttribute("aria-hidden", "true");
    hat.className = "santa-hat";
    document.body.appendChild(hat);

    // Follow the logo every frame: it grows on hover, roams, falls and gets
    // reskinned by hero-logo.js, so a fixed CSS position wouldn't keep up.
    const follow = () => {
      const r = logo.getBoundingClientRect();
      const visible = r.width > 0 && getComputedStyle(logo).visibility !== "hidden";
      hat.style.display = visible ? "block" : "none";
      if (visible) {
        // Sit the brim (40% across, 80% down the hat image) on top of the
        // stegosaurus's head, towards the back: about 14% across and 36% down the logo,
        // tipped back so it stays clear of his eye.
        const w = r.width * 0.24;
        hat.style.width = w + "px";
        hat.style.transform =
          "translate(" + (r.left + r.width * 0.14 - w * 0.4) + "px," +
          (r.top + r.height * 0.36 - w * 0.667) + "px) rotate(18deg)";
      }
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }

  // --- Snow ----------------------------------------------------------------
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.className = "snow";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let flakes = [];
  let width = 0;
  let height = 0;

  function flake(anywhere) {
    return {
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : -5,
      r: 1 + Math.random() * 2.5,
      speed: 0.4 + Math.random() * 1.1,
      drift: Math.random() * Math.PI * 2,
    };
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(160, Math.round((width * height) / 9000));
    while (flakes.length < count) flakes.push(flake(true));
    flakes.length = count;
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(3, (now - last) / 16.7); // steady speed at any frame rate
    last = now;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    for (const f of flakes) {
      f.drift += 0.01 * dt;
      f.y += f.speed * dt;
      f.x += Math.sin(f.drift) * 0.4 * dt;
      if (f.y > height + 5) Object.assign(f, flake(false));
      if (f.x < -5) f.x = width + 5;
      if (f.x > width + 5) f.x = -5;
      ctx.moveTo(f.x + f.r, f.y);
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    }
    ctx.fill();
    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(tick);
})();
