// Thagobyte's Christmas theme for the homepage. It switches itself on every
// year from Nov 1 to Dec 31 (visitor's local time) and off again on Jan 1,
// so it never needs putting up or taking down: a Santa hat on the logo's
// stegosaurus (follows the logo wherever hero-logo.js sends it), string
// lights under the top bar, a clickable line-drawn nutcracker bottom-left,
// and snow over the page. somafm-player.js plays SomaFM's Christmas Lounge
// over the same dates. Keep this file and its <script> tag in index.html.
(function () {
  if (new Date().getMonth() < 10) return; // only November (10) and December (11)

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

  // --- String lights along the bottom of the top bar ------------------------
  const header = document.querySelector(".site-header");
  if (header) {
    const lights = document.createElement("div");
    lights.className = "xmas-lights";
    lights.setAttribute("aria-hidden", "true");
    header.appendChild(lights);
    const COLOURS = ["#ff4d4d", "#ffd23f", "#3fd17a", "#4da3ff", "#ff8c3f", "#d46bff"];
    const GAP = 46; // px between bulbs

    const hang = () => {
      const width = header.clientWidth;
      const n = Math.max(2, Math.round(width / GAP));
      const step = width / n;
      let wire = "M0 2";
      let bulbs = "";
      for (let i = 0; i < n; i++) {
        const x = i * step + step / 2;
        wire += " Q" + (i * step + step / 2) + " 16 " + (i + 1) * step + " 2";
        const c = COLOURS[i % COLOURS.length];
        bulbs +=
          '<g class="bulb" style="animation-delay:' + ((i * 0.37) % 2.2).toFixed(2) + 's">' +
          '<rect x="' + (x - 2.5) + '" y="8" width="5" height="5" rx="1" fill="#2b3a2b"/>' +
          '<ellipse cx="' + x + '" cy="19" rx="4.5" ry="7" fill="' + c + '"/>' +
          '<ellipse cx="' + x + '" cy="19" rx="9" ry="11" fill="' + c + '" opacity=".25"/></g>';
      }
      lights.innerHTML =
        '<svg width="' + width + '" height="32" viewBox="0 0 ' + width + ' 32">' +
        '<path d="' + wire + '" fill="none" stroke="#2b3a2b" stroke-width="2"/>' + bulbs + "</svg>";
    };
    window.addEventListener("resize", hang);
    hang();
  }

  // --- Nutcracker standing guard bottom-left, above the radio player --------
  const nutcracker = document.createElement("img");
  nutcracker.src = "images/nutcracker.svg";
  nutcracker.alt = "Nutcracker";
  nutcracker.className = "nutcracker";
  nutcracker.title = "Click me";
  nutcracker.tabIndex = 0;
  document.body.appendChild(nutcracker);
  new Image().src = "images/nutcracker-open.svg"; // preload, so the first click is instant

  // Click (or Enter/Space) and he opens his mouth for a moment.
  let shutTimer = null;
  const crack = () => {
    nutcracker.src = "images/nutcracker-open.svg";
    clearTimeout(shutTimer);
    shutTimer = setTimeout(() => (nutcracker.src = "images/nutcracker.svg"), 600);
  };
  nutcracker.addEventListener("click", crack);
  nutcracker.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      crack();
    }
  });

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
