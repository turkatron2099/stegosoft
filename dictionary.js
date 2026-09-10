// Dictionary + thesaurus lookup, right on the page — no iframe, no leaving
// the site. Uses the Datamuse API (three parallel, free, keyless,
// CORS-enabled calls: word definitions, synonyms, antonyms — all sourced
// from Princeton's WordNet). Originally built on api.dictionaryapi.dev,
// which returned definitions and synonyms/antonyms in one call, but that
// service's backend started timing out (Cloudflare 522s) shortly after
// launch — Datamuse has none of that flakiness and is a long-established,
// widely-used service, so it's the more durable foundation even though it
// takes three requests instead of one and drops the pronunciation-audio
// feature the other API had (Datamuse doesn't have audio).
(() => {
  const wordInput = document.getElementById("word-input");
  const lookupBtn = document.getElementById("lookup-btn");
  const statusText = document.getElementById("status-text");
  const resultBox = document.getElementById("result-box");
  const wordTitleEl = document.getElementById("word-title");
  const meaningsList = document.getElementById("meanings-list");
  const relationsBox = document.getElementById("relations-box");

  const POS_NAMES = { n: "noun", v: "verb", adj: "adjective", adv: "adverb", u: "other" };

  function setStatus(message) {
    if (!message) {
      statusText.hidden = true;
      return;
    }
    statusText.hidden = false;
    statusText.textContent = message;
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Lookup failed — try again.");
    return res.json();
  }

  async function fetchWord(word) {
    const encoded = encodeURIComponent(word);
    const [defResults, synonyms, antonyms] = await Promise.all([
      fetchJson(`https://api.datamuse.com/words?sp=${encoded}&md=d&max=1`),
      fetchJson(`https://api.datamuse.com/words?rel_syn=${encoded}&max=20`),
      fetchJson(`https://api.datamuse.com/words?rel_ant=${encoded}&max=15`),
    ]);

    const match = defResults[0];
    if (!match || match.word.toLowerCase() !== word.toLowerCase() || !match.defs || !match.defs.length) {
      throw new Error(`No definition found for "${word}".`);
    }

    return {
      word: match.word,
      defs: match.defs,
      synonyms: synonyms.map((w) => w.word),
      antonyms: antonyms.map((w) => w.word),
    };
  }

  // Groups Datamuse's flat "pos\tdefinition" list into part-of-speech
  // blocks, preserving first-seen order (defs for the same part of speech
  // aren't always contiguous in the source list).
  function groupByPartOfSpeech(defs) {
    const order = [];
    const groups = new Map();
    for (const raw of defs) {
      const tabIndex = raw.indexOf("\t");
      const abbrev = tabIndex === -1 ? "u" : raw.slice(0, tabIndex);
      const text = (tabIndex === -1 ? raw : raw.slice(tabIndex + 1)).trim();
      const pos = POS_NAMES[abbrev] || "other";
      if (!groups.has(pos)) {
        groups.set(pos, []);
        order.push(pos);
      }
      groups.get(pos).push(text);
    }
    return order.map((pos) => ({ pos, definitions: groups.get(pos) }));
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

  function renderMeaning(group) {
    const block = document.createElement("div");
    block.className = "meaning-block";

    const pos = document.createElement("span");
    pos.className = "part-of-speech";
    pos.textContent = group.pos;
    block.appendChild(pos);

    const list = document.createElement("ol");
    list.className = "definitions-list";
    for (const definition of group.definitions) {
      const li = document.createElement("li");
      li.textContent = definition;
      list.appendChild(li);
    }
    block.appendChild(list);

    return block;
  }

  function renderResult(result) {
    wordTitleEl.textContent = result.word;

    meaningsList.innerHTML = "";
    groupByPartOfSpeech(result.defs).forEach((group) => meaningsList.appendChild(renderMeaning(group)));

    relationsBox.innerHTML = "";
    const synonymsRow = relationsRow("Synonyms", result.synonyms);
    if (synonymsRow) relationsBox.appendChild(synonymsRow);
    const antonymsRow = relationsRow("Antonyms", result.antonyms);
    if (antonymsRow) relationsBox.appendChild(antonymsRow);
    relationsBox.hidden = !synonymsRow && !antonymsRow;

    resultBox.hidden = false;
  }

  async function lookup() {
    const word = wordInput.value.trim();
    if (!word) return;

    lookupBtn.disabled = true;
    resultBox.hidden = true;
    setStatus("Looking up…");

    try {
      const result = await fetchWord(word);
      setStatus(null);
      renderResult(result);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong — try again.");
    } finally {
      lookupBtn.disabled = false;
    }
  }

  lookupBtn.addEventListener("click", lookup);
  wordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") lookup();
  });
})();
