// Text translation via the MyMemory Translation API — free, keyless,
// CORS-enabled, same "no backend needed" approach as weather.js (Open-Meteo)
// and dictionary.js (Datamuse). Anonymous usage caps out around 500
// characters per request and ~5000 words/day per IP, which is plenty for
// occasional lookups but not a replacement for a real translation service.
(() => {
  const fromSelect = document.getElementById("translate-from");
  const toSelect = document.getElementById("translate-to");
  const swapBtn = document.getElementById("translate-swap");
  const input = document.getElementById("translate-input");
  const output = document.getElementById("translate-output");
  const countEl = document.getElementById("translate-count");
  const copyBtn = document.getElementById("translate-copy");
  const translateBtn = document.getElementById("translate-btn");
  const statusText = document.getElementById("status-text");

  const MAX_CHARS = 500;

  // MyMemory's language codes are plain ISO 639-1 (a couple use a
  // region-qualified BCP-47 form, e.g. Chinese, where a bare code is
  // ambiguous between scripts).
  const LANGUAGES = [
    ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"],
    ["it", "Italian"], ["pt", "Portuguese"], ["ru", "Russian"], ["ja", "Japanese"],
    ["ko", "Korean"], ["zh-CN", "Chinese (Simplified)"], ["zh-TW", "Chinese (Traditional)"],
    ["ar", "Arabic"], ["hi", "Hindi"], ["nl", "Dutch"], ["sv", "Swedish"],
    ["no", "Norwegian"], ["da", "Danish"], ["fi", "Finnish"], ["pl", "Polish"],
    ["tr", "Turkish"], ["vi", "Vietnamese"], ["th", "Thai"], ["el", "Greek"],
    ["he", "Hebrew"], ["id", "Indonesian"], ["uk", "Ukrainian"], ["cs", "Czech"],
    ["ro", "Romanian"], ["hu", "Hungarian"], ["sw", "Swahili"],
  ];

  function populateSelect(select, defaultCode) {
    LANGUAGES.forEach(([code, name]) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = name;
      select.appendChild(opt);
    });
    select.value = defaultCode;
  }

  populateSelect(fromSelect, "en");
  populateSelect(toSelect, "es");

  function setStatus(message, isError) {
    if (!message) {
      statusText.hidden = true;
      return;
    }
    statusText.hidden = false;
    statusText.textContent = message;
    statusText.style.color = isError ? "var(--red)" : "";
  }

  function updateCount() {
    countEl.textContent = `${input.value.length} / ${MAX_CHARS}`;
  }
  input.addEventListener("input", updateCount);
  updateCount();

  async function translate() {
    const text = input.value.trim();
    if (!text) {
      setStatus("Type something to translate first.", true);
      return;
    }
    const from = fromSelect.value;
    const to = toSelect.value;
    if (from === to) {
      output.textContent = text;
      copyBtn.hidden = false;
      setStatus("");
      return;
    }

    translateBtn.disabled = true;
    setStatus("Translating…");
    output.textContent = "";
    copyBtn.hidden = true;

    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Translation request failed.");
      const data = await res.json();
      const translated = data && data.responseData && data.responseData.translatedText;

      if (!translated || /MYMEMORY WARNING/i.test(translated) || data.responseStatus === 403) {
        throw new Error("Translation service is temporarily unavailable (daily free limit may be reached) — try again later.");
      }

      output.textContent = translated;
      copyBtn.hidden = false;
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Something went wrong — try again.", true);
    } finally {
      translateBtn.disabled = false;
    }
  }

  translateBtn.addEventListener("click", translate);

  swapBtn.addEventListener("click", () => {
    const tmpLang = fromSelect.value;
    fromSelect.value = toSelect.value;
    toSelect.value = tmpLang;

    const outputText = output.textContent;
    if (outputText) {
      input.value = outputText;
      updateCount();
    }
    output.textContent = "";
    copyBtn.hidden = true;
    setStatus("");
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(output.textContent);
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = original), 1200);
    } catch (e) {
      // Clipboard API unavailable/denied — nothing else to do here, the
      // translated text is still right there to select and copy by hand.
    }
  });
})();
