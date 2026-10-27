// Learn Something: shows the daily article from learn.json (written once a
// day by scripts/learn/generate.py) plus an archive of past days. The
// article text is model-written from Wikipedia, so it is only ever put on
// the page with textContent, and the source link is checked to be an
// en.wikipedia.org article URL before it becomes an href.
(() => {
  const $ = (id) => document.getElementById(id);
  const message = $("ls-message");
  const content = $("ls-content");
  const pager = $("ls-pager");
  const newerBtn = $("ls-newer");
  const olderBtn = $("ls-older");
  const latestBtn = $("ls-today");
  const archiveSection = $("ls-archive-section");
  const archiveList = $("ls-archive");

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";
  const WORDS_PER_MINUTE = 230;
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  const shortFmt = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });

  let articles = [];
  let current = -1;

  const str = (v, max) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

  // Keep only well-formed entries, so a bad record can't break the page.
  function sanitize(raw) {
    if (!raw || typeof raw.date !== "string" || !DATE_RE.test(raw.date)) return null;
    const title = str(raw.title, 200);
    const category = str(raw.category, 60) || "";
    if (!title || !Array.isArray(raw.paragraphs)) return null;
    const paragraphs = raw.paragraphs.map((p) => str(p, 3000)).filter(Boolean).slice(0, 12);
    if (!paragraphs.length) return null;
    const source = raw.source && typeof raw.source === "object" ? raw.source : {};
    const sourceUrl = wikipediaUrl(source.url);
    return {
      date: raw.date,
      title,
      category,
      paragraphs,
      sourceTitle: str(source.title, 200),
      sourceUrl,
      historyUrl: historyUrl(sourceUrl),
    };
  }

  function externalLink(href, text) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    return link;
  }

  // The page-history link is derived from the already-validated article
  // URL rather than read from the JSON.
  function historyUrl(articleUrl) {
    if (!articleUrl) return null;
    const title = new URL(articleUrl).pathname.slice("/wiki/".length);
    if (!title) return null;
    return `https://en.wikipedia.org/w/index.php?title=${title}&action=history`;
  }

  function wikipediaUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "en.wikipedia.org") return null;
      if (!url.pathname.startsWith("/wiki/") || url.username || url.password || url.port) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function formatDate(iso, fmt) {
    return fmt.format(new Date(iso + "T12:00:00Z"));
  }

  function showMessage(text) {
    message.textContent = text;
    message.hidden = false;
    content.hidden = true;
  }

  function render(index) {
    const a = articles[index];
    current = index;
    message.hidden = true;
    content.hidden = false;

    $("ls-category").textContent = a.category;
    $("ls-category").hidden = !a.category;
    const dateEl = $("ls-date");
    dateEl.textContent = formatDate(a.date, dateFmt);
    dateEl.dateTime = a.date;
    const words = a.paragraphs.join(" ").split(/\s+/).length;
    $("ls-read").textContent = `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min read`;
    $("ls-title").textContent = a.title;

    const body = $("ls-body");
    body.replaceChildren(...a.paragraphs.map((p) => {
      const el = document.createElement("p");
      el.textContent = p;
      return el;
    }));

    // Attribution wording agreed with legal (CC BY-SA 4.0 adaptation).
    const source = $("ls-source");
    source.replaceChildren();
    if (a.sourceTitle) {
      const quoted = `‘${a.sourceTitle}’`;
      source.append("Adapted from the Wikipedia article ");
      source.append(a.sourceUrl ? externalLink(a.sourceUrl, quoted) : quoted);
      if (a.historyUrl) {
        source.append(" (text by ", externalLink(a.historyUrl, "Wikipedia contributors"), ")");
      } else {
        source.append(" (text by Wikipedia contributors)");
      }
      source.append(
        ", licensed under ",
        externalLink(LICENSE_URL, "CC BY-SA 4.0"),
        ". Changes were made: this version was summarized and rewritten by AI (Claude) and may contain errors, " +
          "so check the original. This article is also available under CC BY-SA 4.0."
      );
    }
    source.hidden = !a.sourceTitle;

    newerBtn.disabled = index === 0;
    latestBtn.disabled = index === 0;
    olderBtn.disabled = index === articles.length - 1;

    for (const link of archiveList.querySelectorAll("a")) {
      link.setAttribute("aria-current", link.dataset.date === a.date ? "true" : "false");
    }
    document.title = index === 0 ? "Learn Something — Thagobyte" : `${a.title} — Learn Something — Thagobyte`;
  }

  function buildArchive() {
    archiveList.replaceChildren(...articles.map((a) => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${a.date}`;
      link.dataset.date = a.date;
      const date = document.createElement("span");
      date.className = "ls-archive-date";
      date.textContent = formatDate(a.date, shortFmt);
      const title = document.createElement("span");
      title.className = "ls-archive-title";
      title.textContent = a.title;
      link.append(date, title);
      if (a.category) {
        const cat = document.createElement("span");
        cat.className = "ls-archive-cat";
        cat.textContent = a.category;
        link.append(cat);
      }
      li.append(link);
      return li;
    }));
    archiveSection.hidden = articles.length < 2;
  }

  function indexFromHash() {
    let date = "";
    try {
      date = decodeURIComponent(location.hash.slice(1));
    } catch {}
    const i = DATE_RE.test(date) ? articles.findIndex((a) => a.date === date) : -1;
    return i >= 0 ? i : 0;
  }

  function go(index, scroll) {
    if (index < 0 || index >= articles.length) return;
    const hash = index === 0 ? "" : `#${articles[index].date}`;
    history.replaceState(null, "", location.pathname + location.search + hash);
    render(index);
    if (scroll) $("ls-article").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  newerBtn.addEventListener("click", () => go(current - 1));
  olderBtn.addEventListener("click", () => go(current + 1));
  latestBtn.addEventListener("click", () => go(0));
  archiveList.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-date]");
    if (!link) return;
    e.preventDefault();
    go(articles.findIndex((a) => a.date === link.dataset.date), true);
  });
  window.addEventListener("hashchange", () => articles.length && render(indexFromHash()));

  async function load() {
    try {
      const res = await fetch("learn.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      const seen = new Set();
      articles = (Array.isArray(data.articles) ? data.articles : [])
        .map(sanitize)
        .filter((a) => a && !seen.has(a.date) && seen.add(a.date))
        .sort((x, y) => (x.date < y.date ? 1 : -1));
    } catch {
      showMessage("Couldn’t load today’s article. Try again in a moment.");
      return;
    }
    if (!articles.length) {
      showMessage("No articles yet. Check back tomorrow.");
      return;
    }
    buildArchive();
    pager.hidden = articles.length < 2;
    render(indexFromHash());
  }

  load();
})();
