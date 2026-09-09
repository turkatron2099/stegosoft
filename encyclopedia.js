// Wikipedia lookup, right on the page — no iframe, no leaving the site.
// Two calls: the classic "opensearch" action API resolves whatever the user
// typed to a real article title (it does fuzzy/prefix matching; the REST
// summary endpoint below needs an exact title), then the REST API's
// page-summary endpoint returns a clean, already-plain-text extract plus a
// thumbnail and the canonical article URL. Both are free, keyless, and
// CORS-enabled for browser fetches (the action API needs the explicit
// origin=*; the REST API allows cross-origin by default).
(() => {
  const topicInput = document.getElementById("topic-input");
  const searchBtn = document.getElementById("search-btn");
  const statusText = document.getElementById("status-text");
  const resultBox = document.getElementById("result-box");
  const thumbEl = document.getElementById("article-thumb");
  const titleEl = document.getElementById("article-title");
  const descriptionEl = document.getElementById("article-description");
  const extractEl = document.getElementById("article-extract");
  const linkEl = document.getElementById("article-link");

  function setStatus(message) {
    if (!message) {
      statusText.hidden = true;
      return;
    }
    statusText.hidden = false;
    statusText.textContent = message;
  }

  async function findTitle(query) {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Search failed — try again.");
    const [, titles] = await res.json();
    if (!titles || !titles.length) {
      throw new Error(`No article found for "${query}".`);
    }
    return titles[0];
  }

  async function fetchSummary(title) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Couldn't load that article — try again.");
    return res.json();
  }

  function renderSummary(summary) {
    titleEl.textContent = summary.title;

    descriptionEl.hidden = !summary.description;
    descriptionEl.textContent = summary.description || "";

    extractEl.textContent = summary.extract || "No summary available for this article.";

    if (summary.thumbnail && summary.thumbnail.source) {
      thumbEl.src = summary.thumbnail.source;
      thumbEl.alt = summary.title;
      thumbEl.hidden = false;
    } else {
      thumbEl.hidden = true;
      thumbEl.removeAttribute("src");
    }

    const pageUrl =
      (summary.content_urls && summary.content_urls.desktop && summary.content_urls.desktop.page) ||
      `https://en.wikipedia.org/wiki/${encodeURIComponent(summary.title.replace(/ /g, "_"))}`;
    linkEl.href = pageUrl;

    resultBox.hidden = false;
  }

  async function search() {
    const query = topicInput.value.trim();
    if (!query) return;

    searchBtn.disabled = true;
    resultBox.hidden = true;
    setStatus("Searching…");

    try {
      const title = await findTitle(query);
      setStatus("Loading article…");
      const summary = await fetchSummary(title);
      setStatus(null);
      renderSummary(summary);
    } catch (err) {
      console.error(err);
      setStatus(err.message || "Something went wrong — try again.");
    } finally {
      searchBtn.disabled = false;
    }
  }

  searchBtn.addEventListener("click", search);
  topicInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });
})();
