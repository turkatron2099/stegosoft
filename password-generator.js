// Password / passphrase generator. All randomness comes from
// crypto.getRandomValues with rejection sampling, so every character or
// word is equally likely. Nothing leaves the browser.
(() => {
  const SETS = {
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower: "abcdefghijklmnopqrstuvwxyz",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
  };
  const LOOK_ALIKES = /[Il1O0o]/g;

  const $ = (id) => document.getElementById(id);
  const output = $("pw-output");
  const meterFill = $("pw-meter-fill");
  const strengthText = $("pw-strength-text");
  const copyBtn = $("pw-copy");
  const lengthInput = $("pw-length");
  const wordsInput = $("pp-words");
  const setBoxes = { upper: $("pw-upper"), lower: $("pw-lower"), digits: $("pw-digits"), symbols: $("pw-symbols") };

  let mode = "password";
  let words = null;

  // Uniform random integer in [0, n).
  function randomInt(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do {
      crypto.getRandomValues(buf);
    } while (buf[0] >= limit);
    return buf[0] % n;
  }

  function pick(list) {
    return list[randomInt(list.length)];
  }

  function makePassword() {
    const length = Number(lengthInput.value);
    const sets = Object.keys(SETS)
      .filter((name) => setBoxes[name].checked)
      .map((name) => ($("pw-similar").checked ? SETS[name].replace(LOOK_ALIKES, "") : SETS[name]));
    const pool = sets.join("");

    // Retry until every chosen kind of character appears at least once.
    let password;
    do {
      password = Array.from({ length }, () => pick(pool)).join("");
    } while (!sets.every((set) => [...password].some((ch) => set.includes(ch))));

    return { text: password, bits: length * Math.log2(pool.length) };
  }

  function makePassphrase() {
    const count = Number(wordsInput.value);
    const chosen = Array.from({ length: count }, () => pick(words));
    if ($("pp-capitalize").checked) {
      for (let i = 0; i < count; i++) chosen[i] = chosen[i][0].toUpperCase() + chosen[i].slice(1);
    }
    let bits = count * Math.log2(words.length);
    if ($("pp-number").checked) {
      chosen[randomInt(count)] += randomInt(10);
      bits += Math.log2(count * 10);
    }
    return { text: chosen.join($("pp-separator").value), bits };
  }

  function showStrength(bits) {
    const levels = [
      [40, "Weak", "var(--red)"],
      [60, "Fair", "var(--accent)"],
      [80, "Strong", "var(--cyan)"],
      [Infinity, "Very strong", "var(--green)"],
    ];
    const [, label, color] = levels.find(([max]) => bits < max);
    meterFill.style.width = Math.min(100, (bits / 128) * 100) + "%";
    meterFill.style.background = color;
    strengthText.textContent = `${label} · about ${Math.round(bits)} bits of randomness`;
  }

  function generate() {
    copyBtn.textContent = "Copy";
    if (mode === "passphrase" && !words) {
      output.textContent = "Loading words…";
      strengthText.textContent = " ";
      meterFill.style.width = "0";
      return;
    }
    const result = mode === "password" ? makePassword() : makePassphrase();
    output.textContent = result.text;
    showStrength(result.bits);
  }

  function setMode(next) {
    mode = next;
    for (const btn of document.querySelectorAll(".pw-mode")) {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    }
    $("opts-password").hidden = mode !== "password";
    $("opts-passphrase").hidden = mode !== "passphrase";
    generate();
  }

  async function loadWords() {
    try {
      const response = await fetch("password-words.txt");
      if (!response.ok) throw new Error(response.statusText);
      words = (await response.text()).split("\n").map((w) => w.trim()).filter(Boolean);
      if (mode === "passphrase") generate();
    } catch {
      if (mode === "passphrase") output.textContent = "Couldn't load the word list. Check your connection and reload.";
    }
  }

  for (const btn of document.querySelectorAll(".pw-mode")) {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  }

  // Never let every character type be switched off.
  for (const box of Object.values(setBoxes)) {
    box.addEventListener("input", () => {
      if (!Object.values(setBoxes).some((b) => b.checked)) box.checked = true;
    });
  }

  lengthInput.addEventListener("input", () => ($("pw-length-value").textContent = lengthInput.value));
  wordsInput.addEventListener("input", () => ($("pp-words-value").textContent = wordsInput.value));
  for (const el of document.querySelectorAll(".pw-options input, .pw-options select")) {
    el.addEventListener("input", generate);
  }
  $("pw-new").addEventListener("click", generate);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(output.textContent);
      copyBtn.textContent = "Copied!";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(output);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      copyBtn.textContent = "Press Ctrl+C";
    }
  });

  generate();
  loadWords();
})();
