// Dictionary + thesaurus lookup, right on the page — no iframe, no leaving
// the site. One call to the Free Dictionary API's v2 endpoint returns both
// definitions (grouped by part of speech, each with an optional example)
// and synonyms/antonyms per meaning, sourced from Wiktionary — so one free,
// keyless, CORS-enabled request covers both halves of "dictionary and
// thesaurus" instead of needing two separate services.
(() => {
  const wordInput = document.getElementById("word-input");
  const lookupBtn = document.getElementById("lookup-btn");
  const statusText = document.getElementById("status-text");
  const resultBox = document.getElementById("result-box");
  const wordTitleEl = document.getElementById("word-title");
  const wordPhoneticEl = document.getElementById("word-phonetic");
  const playBtn = document.getElementById("play-btn");
  const meaningsList = document.getElementById("meanings-list");

  let pronunciationAudio = null;

  function setStatus(message) {
    if (!message) {
      statusText.hidden = true;
      return;
    }
    statusText.hidden = false;
    statusText.textContent = message;
  }

  async function fetchEntries(word) {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (res.status === 404) {
      throw new Error(`No definition found for "${word}".`);
    }
    if (!res.ok) throw new Error("Lookup failed — try again.");
    return res.json();
  }

  // Protocol-relative audio URLs ("//ssl.gstatic.com/...") show up in some
  // entries — the API predates every page it's embedded on being https.
  function normalizeAudioUrl(url) {
    return url.startsWith("//") ? `https:${url}` : url;
  }

  function firstPhonetic(entries) {
    for (const entry of entries) {
      if (entry.phonetic) return entry.phonetic;
    }
    for (const entry of entries) {
      for (const p of entry.phonetics || []) {
        if (p.text) return p.text;
      }
    }
    return "";
  }

  function firstAudioUrl(entries) {
    for (const entry of entries) {
      for (const p of entry.phonetics || []) {
        if (p.audio) return normalizeAudioUrl(p.audio);
      }
    }
    return null;
  }

  function relationsRow(label, words) {
    if (!words || !words.length) return null;
    const row = document.createElement("div");
    row.className = "word-relations";
    const labelEl = document.createElement("span");
    labelEl.className = "relation-label";
    labelEl.textContent = `${label}:`;
    row.appendChild(labelEl);
    for (const w of words) {
      const chip = document.createElement("span");
      chip.className = "relation-chip";
      chip.textContent = w;
      row.appendChild(chip);
    }
    return row;
  }

  function renderMeaning(meaning) {
    const block = document.createElement("div");
    block.className = "meaning-block";

    const pos = document.createElement("span");
    pos.className = "part-of-speech";
    pos.textContent = meaning.partOfSpeech || "other";
    block.appendChild(pos);

    const list = document.createElement("ol");
    list.className = "definitions-list";
    for (const def of meaning.definitions || []) {
      const li = document.createElement("li");
      li.textContent = def.definition;
      if (def.example) {
        const ex = document.createElement("p");
        ex.className = "definition-example";
        ex.textContent = `"${def.example}"`;
        li.appendChild(ex);
      }
      list.appendChild(li);
    }
    block.appendChild(list);

    const synonymsRow = relationsRow("Synonyms", meaning.synonyms);
    if (synonymsRow) block.appendChild(synonymsRow);
    const antonymsRow = relationsRow("Antonyms", meaning.antonyms);
    if (antonymsRow) block.appendChild(antonymsRow);

    return block;
  }

  function renderEntries(entries, fallbackWord) {
    wordTitleEl.textContent = entries[0].word || fallbackWord;

    const phonetic = firstPhonetic(entries);
    wordPhoneticEl.hidden = !phonetic;
    wordPhoneticEl.textContent = phonetic;

    const audioUrl = firstAudioUrl(entries);
    pronunciationAudio = audioUrl ? new Audio(audioUrl) : null;
    playBtn.hidden = !audioUrl;

    meaningsList.innerHTML = "";
    const meanings = entries.flatMap((entry) => entry.meanings || []);
    meanings.forEach((meaning) => meaningsList.appendChild(renderMeaning(meaning)));

    resultBox.hidden = false;
  }

  async function lookup() {
    const word = wordInput.value.trim();
    if (!word) return;

    lookupBtn.disabled = true;
    resultBox.hidden = true;
    setStatus("Looking up…");

    try {
      const entries = await fetchEntries(word);
      setStatus(null);
      renderEntries(entries, word);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong — try again.");
    } finally {
      lookupBtn.disabled = false;
    }
  }

  playBtn.addEventListener("click", () => {
    if (!pronunciationAudio) return;
    pronunciationAudio.currentTime = 0;
    pronunciationAudio.play().catch(() => {});
  });

  lookupBtn.addEventListener("click", lookup);
  wordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") lookup();
  });
})();
