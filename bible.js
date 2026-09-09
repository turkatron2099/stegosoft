// Bible lookup, right on the page — same pattern as encyclopedia.js. One
// call to bible-api.com's reference endpoint: free, keyless, CORS-enabled,
// and every translation it serves is public domain, so there's nothing to
// license or attribute beyond a link back to the source.
(() => {
  const refInput = document.getElementById("ref-input");
  const translationSelect = document.getElementById("translation-select");
  const searchBtn = document.getElementById("search-btn");
  const statusText = document.getElementById("status-text");
  const resultBox = document.getElementById("result-box");
  const passageReference = document.getElementById("passage-reference");
  const passageTranslation = document.getElementById("passage-translation");
  const passageText = document.getElementById("passage-text");

  function setStatus(message) {
    if (!message) {
      statusText.hidden = true;
      return;
    }
    statusText.hidden = false;
    statusText.textContent = message;
  }

  async function fetchPassage(reference, translation) {
    const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=${encodeURIComponent(translation)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`Couldn't find "${reference}" — check the reference and try again.`);
    }
    return data;
  }

  function renderPassage(data) {
    passageReference.textContent = data.reference;
    passageTranslation.textContent = data.translation_name;

    passageText.innerHTML = "";
    data.verses.forEach((v) => {
      const p = document.createElement("p");
      const num = document.createElement("span");
      num.className = "passage-verse-num";
      num.textContent = v.verse;
      p.appendChild(num);
      p.appendChild(document.createTextNode(v.text.trim()));
      passageText.appendChild(p);
    });

    resultBox.hidden = false;
  }

  async function search() {
    const reference = refInput.value.trim();
    if (!reference) return;

    searchBtn.disabled = true;
    resultBox.hidden = true;
    setStatus("Looking up…");

    try {
      const data = await fetchPassage(reference, translationSelect.value);
      setStatus(null);
      renderPassage(data);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong — try again.");
    } finally {
      searchBtn.disabled = false;
    }
  }

  searchBtn.addEventListener("click", search);
  refInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });
})();
