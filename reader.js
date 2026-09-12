/* Reader — paste a link, get the article.
 *
 * The fetching and article-extraction happen on a small relay you deploy
 * yourself (see reader/worker in the Reader project); this file handles the
 * reading experience: rendering into the Thagobyte theme, remembering where
 * you stopped, bookmarks, and the underline tool.
 *
 * Everything you save lives in this browser's localStorage. Nothing is
 * uploaded anywhere except the URL you paste, which goes to your own relay.
 */

const LS = {
  config: "thagobyte.reader.config",
  library: "thagobyte.reader.library",
  article: (id) => `thagobyte.reader.article.${id}`,
  state: (id) => `thagobyte.reader.state.${id}`,
};

const DEFAULT_SIZE = 1.12;
const SIZE_MIN = 0.9;
const SIZE_MAX = 1.75;

/* ------------------------------------------------------------- storage --- */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn("Reader: couldn't save", key, err);
    return false;
  }
}

// Short stable id per article URL, so state survives across sessions.
function articleId(url) {
  let h = 5381;
  const normalized = String(url).replace(/[#?].*$/, "").replace(/\/+$/, "");
  for (let i = 0; i < normalized.length; i++) h = ((h << 5) + h + normalized.charCodeAt(i)) >>> 0;
  return h.toString(36) + "-" + normalized.length.toString(36);
}

// The relay URL isn't a secret — the browser reveals it on every call anyway,
// and the token is what actually gates access. Defaulting it here saves
// typing it on each new device.
const DEFAULT_RELAY = "https://thagobyte-reader.thagobyte.workers.dev";

const config = Object.assign(
  { relay: DEFAULT_RELAY, token: "", size: DEFAULT_SIZE },
  readJSON(LS.config, {})
);
const saveConfig = () => writeJSON(LS.config, config);

let library = readJSON(LS.library, []);
const saveLibrary = () => writeJSON(LS.library, library);

/* --------------------------------------------------------------- state --- */

let current = null; // { id, article, state }

function loadState(id) {
  return Object.assign({ block: 0, ratio: 0, pct: 0, bookmarks: [], underlines: [] }, readJSON(LS.state(id), {}));
}

function saveState() {
  if (current) writeJSON(LS.state(current.id), current.state);
}

/* ----------------------------------------------------------------- DOM --- */

const $ = (id) => document.getElementById(id);

const homeView = $("reader-home");
const articleView = $("reader-article");
const form = $("reader-form");
const urlInput = $("url-input");
const readBtn = $("read-btn");
const statusText = $("status-text");
const settingsToggle = $("settings-toggle");
const settingsPanel = $("settings-panel");
const relayInput = $("relay-input");
const tokenInput = $("token-input");
const settingsResult = $("settings-result");
const libraryBox = $("library-box");
const libraryList = $("library-list");
const contentEl = $("article-content");
const marksPanel = $("marks-panel");
const marksCount = $("marks-count");
const underlineBtn = $("underline-btn");
const progressBar = $("reader-progress-bar");
const resumePill = $("resume-pill");

let underlineMode = false;

/* -------------------------------------------------------------- status --- */

function setStatus(message, isError = false) {
  if (!message) {
    statusText.hidden = true;
    statusText.textContent = "";
    return;
  }
  statusText.hidden = false;
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);
}

/* --------------------------------------------------------------- fetch --- */

function relayBase() {
  return (config.relay || "").trim().replace(/\/+$/, "");
}

async function callRelay(path, options = {}) {
  const base = relayBase();
  if (!base) throw new Error("NO_RELAY");
  const headers = Object.assign({}, options.headers);
  if (config.token) headers["X-Reader-Token"] = config.token;
  const res = await fetch(base + path, Object.assign({}, options, { headers }));
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`The relay returned something unreadable (HTTP ${res.status}).`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `The relay returned HTTP ${res.status}.`);
  }
  return body;
}

async function fetchArticle(url) {
  return callRelay(`/extract?url=${encodeURIComponent(url)}`);
}

/* ------------------------------------------------------------ underline --- */

// Keep the stored list sorted and non-overlapping. Makes add, remove and
// render all trivially correct.
function normalizeRanges(ranges) {
  const sorted = ranges
    .filter((r) => r.e > r.s)
    .sort((a, b) => (a.b - b.b) || (a.s - b.s));
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.b === r.b && r.s <= last.e) {
      last.e = Math.max(last.e, r.e);
    } else {
      out.push({ b: r.b, s: r.s, e: r.e });
    }
  }
  return out;
}

function rangesForBlock(index) {
  if (!current) return [];
  return current.state.underlines.filter((r) => r.b === index);
}

// Character offset of (node, offset) within container's text.
function offsetWithin(container, node, offset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  let n;
  while ((n = walker.nextNode())) {
    if (n === node) return total + offset;
    total += n.nodeValue.length;
  }
  return null;
}

function fillText(host, text, ranges) {
  host.textContent = "";
  if (!ranges.length) {
    host.textContent = text;
    return;
  }
  let cursor = 0;
  for (const r of ranges) {
    const start = Math.max(0, Math.min(r.s, text.length));
    const end = Math.max(start, Math.min(r.e, text.length));
    if (start > cursor) host.appendChild(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement("span");
    mark.className = "reader-underline";
    mark.dataset.s = String(start);
    mark.dataset.e = String(end);
    mark.textContent = text.slice(start, end);
    host.appendChild(mark);
    cursor = end;
  }
  if (cursor < text.length) host.appendChild(document.createTextNode(text.slice(cursor)));
}

function repaintBlock(index) {
  const block = contentEl.querySelector(`.reader-block[data-i="${index}"]`);
  if (!block) return;
  const host = block.querySelector(".reader-text");
  if (!host) return;
  const text = current.article.blocks[index].text || "";
  fillText(host, text, rangesForBlock(index));
}

function handleSelectionUnderline() {
  if (!underlineMode || !current) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const startBlock = range.startContainer.parentElement?.closest(".reader-block");
  const endBlock = range.endContainer.parentElement?.closest(".reader-block");
  if (!startBlock || startBlock !== endBlock) {
    // Underlining across paragraphs would need per-block splitting; keep it
    // to one block and tell the reader why nothing happened.
    if (startBlock && endBlock) flashMessage("Underline one paragraph at a time.");
    return;
  }
  const host = startBlock.querySelector(".reader-text");
  if (!host) return;

  const s = offsetWithin(host, range.startContainer, range.startOffset);
  const e = offsetWithin(host, range.endContainer, range.endOffset);
  if (s === null || e === null || e <= s) return;

  const index = Number(startBlock.dataset.i);
  current.state.underlines = normalizeRanges(current.state.underlines.concat([{ b: index, s, e }]));
  saveState();
  repaintBlock(index);
  renderMarks();
  sel.removeAllRanges();
}

function removeUnderlineAt(span) {
  if (!current) return;
  const block = span.closest(".reader-block");
  if (!block) return;
  const index = Number(block.dataset.i);
  const s = Number(span.dataset.s);
  const e = Number(span.dataset.e);
  current.state.underlines = current.state.underlines.filter(
    (r) => !(r.b === index && r.s === s && r.e === e)
  );
  saveState();
  repaintBlock(index);
  renderMarks();
}

/* ------------------------------------------------------------ bookmarks --- */

function toggleBookmark(index) {
  if (!current) return;
  const existing = current.state.bookmarks.findIndex((b) => b.b === index);
  if (existing >= 0) {
    current.state.bookmarks.splice(existing, 1);
  } else {
    const block = current.article.blocks[index];
    const label = block.type === "img" ? (block.alt || "Image") : (block.text || "").slice(0, 90);
    current.state.bookmarks.push({ b: index, label, at: new Date().toISOString() });
    current.state.bookmarks.sort((a, z) => a.b - z.b);
  }
  saveState();
  const el = contentEl.querySelector(`.reader-block[data-i="${index}"]`);
  if (el) el.classList.toggle("is-bookmarked", current.state.bookmarks.some((b) => b.b === index));
  renderMarks();
}

function topVisibleBlockIndex() {
  const blocks = contentEl.querySelectorAll(".reader-block");
  const threshold = 90; // below the sticky toolbar
  let best = 0;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.bottom > threshold) {
      best = Number(block.dataset.i);
      break;
    }
  }
  return best;
}

function renderMarks() {
  const bookmarkList = $("bookmark-list");
  const underlineList = $("underline-list");
  bookmarkList.innerHTML = "";
  underlineList.innerHTML = "";

  if (!current.state.bookmarks.length) {
    bookmarkList.innerHTML = '<li class="reader-marks-empty">No bookmarks yet — click the dot beside a paragraph, or press Bookmark.</li>';
  }
  current.state.bookmarks.forEach((bm) => {
    bookmarkList.appendChild(markRow(bm.label, () => jumpToBlock(bm.b), () => toggleBookmark(bm.b)));
  });

  if (!current.state.underlines.length) {
    underlineList.innerHTML = '<li class="reader-marks-empty">No underlines yet — turn on Underline, then select some text.</li>';
  }
  current.state.underlines.forEach((r) => {
    const text = (current.article.blocks[r.b]?.text || "").slice(r.s, r.e);
    underlineList.appendChild(
      markRow(text, () => jumpToBlock(r.b), () => {
        current.state.underlines = current.state.underlines.filter(
          (x) => !(x.b === r.b && x.s === r.s && x.e === r.e)
        );
        saveState();
        repaintBlock(r.b);
        renderMarks();
      })
    );
  });

  const total = current.state.bookmarks.length + current.state.underlines.length;
  marksCount.textContent = total ? `(${total})` : "";
}

function markRow(label, onJump, onRemove) {
  const li = document.createElement("li");
  const jump = document.createElement("button");
  jump.type = "button";
  jump.className = "reader-marks-jump";
  jump.textContent = label || "(untitled)";
  jump.addEventListener("click", onJump);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "reader-marks-remove";
  remove.textContent = "×";
  remove.title = "Remove";
  remove.addEventListener("click", onRemove);
  li.append(jump, remove);
  return li;
}

function jumpToBlock(index) {
  const el = contentEl.querySelector(`.reader-block[data-i="${index}"]`);
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 100;
  window.scrollTo({ top: y, behavior: "smooth" });
  el.classList.remove("reader-flash");
  void el.offsetWidth; // restart the animation
  el.classList.add("reader-flash");
}

/* --------------------------------------------------------------- render --- */

function renderArticle() {
  const { article, state } = current;

  $("article-title").textContent = article.title || "Untitled";
  const metaBits = [article.siteName, article.byline, formatDate(article.publishedTime)].filter(Boolean);
  if (article.wordCount) metaBits.push(`${article.wordCount.toLocaleString()} words`);
  $("article-meta").textContent = metaBits.join("  ·  ");
  $("article-source").href = article.finalUrl || article.url;
  $("article-source-foot").href = article.finalUrl || article.url;

  contentEl.innerHTML = "";
  contentEl.style.setProperty("--reader-size", `${config.size}rem`);

  let list = null;
  article.blocks.forEach((block, index) => {
    if (block.type === "li") {
      if (!list) {
        list = document.createElement("ul");
        contentEl.appendChild(list);
      }
    } else {
      list = null;
    }
    const el = buildBlock(block, index, state);
    (list || contentEl).appendChild(el);
  });

  renderMarks();
}

function buildBlock(block, index, state) {
  let el;
  if (block.type === "img") {
    el = document.createElement("figure");
    const img = document.createElement("img");
    img.src = block.src;
    img.alt = block.alt || "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    // A dead image link shouldn't leave a broken-icon hole in the article.
    img.addEventListener("error", () => el.remove());
    el.appendChild(img);
    if (block.alt) {
      const cap = document.createElement("figcaption");
      cap.textContent = block.alt;
      el.appendChild(cap);
    }
  } else {
    const tag =
      block.type === "h2" ? "h2" :
      block.type === "h3" ? "h3" :
      block.type === "quote" ? "blockquote" :
      block.type === "li" ? "li" :
      block.type === "pre" ? "pre" :
      block.type === "caption" ? "p" : "p";
    el = document.createElement(tag);
    if (block.type === "caption") el.className = "reader-caption";
    const host = document.createElement("span");
    host.className = "reader-text";
    fillText(host, block.text || "", rangesForBlock(index));
    el.appendChild(host);
  }

  el.classList.add("reader-block");
  el.dataset.i = String(index);
  if (state.bookmarks.some((b) => b.b === index)) el.classList.add("is-bookmarked");

  const dot = document.createElement("button");
  dot.type = "button";
  dot.className = "reader-mark-dot";
  dot.title = "Bookmark here";
  dot.setAttribute("aria-label", "Bookmark here");
  dot.addEventListener("click", (ev) => {
    ev.stopPropagation();
    toggleBookmark(index);
  });
  el.insertBefore(dot, el.firstChild);

  return el;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/* ------------------------------------------------------ reading position --- */

let scrollThrottle = null;
let saveTimer = null;

// Measure where we are, and remember it.
//
// Deliberately NOT driven by requestAnimationFrame: rAF is paused outright
// while a tab is hidden, so a scroll that lands in that window would latch the
// throttle flag on and silently stop the position ever being recorded again.
// A timer still fires in a background tab (throttled, but it fires).
function measurePosition() {
  if (!current || articleView.hidden) return;
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const pct = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  progressBar.style.width = `${(pct * 100).toFixed(1)}%`;

  current.state.block = topVisibleBlockIndex();
  current.state.pct = pct;

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!current) return; // reader went back to the list mid-debounce
    saveState();
    const entry = library.find((a) => a.id === current.id);
    if (entry) {
      entry.pct = current.state.pct;
      entry.readAt = new Date().toISOString();
      saveLibrary();
    }
  }, 500);
}

function onScroll() {
  if (!current || articleView.hidden || scrollThrottle) return;
  scrollThrottle = setTimeout(() => {
    scrollThrottle = null;
    measurePosition();
  }, 100);
}

function restorePosition() {
  const { state } = current;
  if (!state.block || state.pct < 0.02) {
    window.scrollTo(0, 0);
    return;
  }
  const el = contentEl.querySelector(`.reader-block[data-i="${state.block}"]`);
  if (el) {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 100);
  }
  resumePill.hidden = false;
  resumePill.textContent = `Resumed at ${Math.round(state.pct * 100)}% · Start from the top`;
  clearTimeout(restorePosition.timer);
  restorePosition.timer = setTimeout(() => {
    resumePill.hidden = true;
  }, 7000);
}

/* -------------------------------------------------------------- library --- */

function renderLibrary() {
  libraryBox.hidden = library.length === 0;
  libraryList.innerHTML = "";
  library
    .slice()
    .sort((a, z) => new Date(z.readAt || z.savedAt) - new Date(a.readAt || a.savedAt))
    .forEach((entry) => {
      const li = document.createElement("li");
      li.className = "reader-library-item";

      const main = document.createElement("div");
      main.className = "reader-library-main";
      main.setAttribute("role", "button");
      main.tabIndex = 0;

      const title = document.createElement("span");
      title.className = "reader-library-title";
      title.textContent = entry.title;

      const meta = document.createElement("span");
      meta.className = "reader-library-meta";
      const bits = [entry.siteName];
      if (entry.wordCount) bits.push(`${entry.wordCount.toLocaleString()} words`);
      meta.textContent = bits.filter(Boolean).join("  ·  ") + "  ";
      if (entry.pct > 0.02) {
        const prog = document.createElement("span");
        prog.className = "reader-library-progress";
        prog.textContent = entry.pct > 0.95 ? "· finished" : `· ${Math.round(entry.pct * 100)}% read`;
        meta.appendChild(prog);
      }

      main.append(title, meta);
      const open = () => openSaved(entry.id);
      main.addEventListener("click", open);
      main.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          open();
        }
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "reader-library-remove";
      remove.textContent = "×";
      remove.title = "Remove from list";
      remove.setAttribute("aria-label", `Remove ${entry.title}`);
      remove.addEventListener("click", (ev) => {
        ev.stopPropagation();
        library = library.filter((a) => a.id !== entry.id);
        saveLibrary();
        try {
          localStorage.removeItem(LS.article(entry.id));
          localStorage.removeItem(LS.state(entry.id));
        } catch { /* ignore */ }
        renderLibrary();
      });

      li.append(main, remove);
      libraryList.appendChild(li);
    });
}

function rememberArticle(article) {
  const id = articleId(article.finalUrl || article.url);
  writeJSON(LS.article(id), article);
  const entry = {
    id,
    url: article.finalUrl || article.url,
    title: article.title,
    siteName: article.siteName,
    wordCount: article.wordCount,
    savedAt: new Date().toISOString(),
    readAt: new Date().toISOString(),
    pct: 0,
  };
  const existing = library.findIndex((a) => a.id === id);
  if (existing >= 0) library[existing] = Object.assign(library[existing], entry, { pct: library[existing].pct });
  else library.push(entry);
  saveLibrary();
  return id;
}

/* ----------------------------------------------------------------- views --- */

function showArticle(id, article) {
  current = { id, article, state: loadState(id) };
  homeView.hidden = true;
  articleView.hidden = false;
  marksPanel.hidden = true;
  $("marks-btn").setAttribute("aria-expanded", "false");
  renderArticle();
  restorePosition();
  measurePosition();
  document.title = `${article.title} — Reader`;
}

function showHome() {
  saveState();
  current = null;
  articleView.hidden = true;
  homeView.hidden = false;
  resumePill.hidden = true;
  document.title = "Reader — Thagobyte";
  renderLibrary();
  window.scrollTo(0, 0);
}

function openSaved(id) {
  const article = readJSON(LS.article(id), null);
  if (!article) {
    setStatus("That article's text is no longer saved in this browser. Paste the link again to refetch it.", true);
    library = library.filter((a) => a.id !== id);
    saveLibrary();
    renderLibrary();
    return;
  }
  showArticle(id, article);
}

async function loadUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return;

  // Already saved? Open instantly and skip the network entirely.
  const knownId = articleId(url);
  if (library.some((a) => a.id === knownId) && readJSON(LS.article(knownId), null)) {
    openSaved(knownId);
    return;
  }

  if (!relayBase()) {
    setStatus("Set your relay URL first — open Relay settings below.", true);
    settingsPanel.hidden = false;
    settingsToggle.setAttribute("aria-expanded", "true");
    relayInput.focus();
    return;
  }

  readBtn.disabled = true;
  readBtn.textContent = "Reading...";
  setStatus("Fetching the article...");
  try {
    const article = await fetchArticle(url);
    const id = rememberArticle(article);
    setStatus("");
    urlInput.value = "";
    showArticle(id, article);
  } catch (err) {
    const message =
      err.message === "NO_RELAY"
        ? "Set your relay URL first — open Relay settings below."
        : err.message;
    setStatus(message, true);
  } finally {
    readBtn.disabled = false;
    readBtn.textContent = "Read";
  }
}

function flashMessage(text) {
  // Reuse the resume pill as a transient toast inside the article view.
  resumePill.hidden = false;
  resumePill.textContent = text;
  clearTimeout(flashMessage.timer);
  flashMessage.timer = setTimeout(() => {
    resumePill.hidden = true;
  }, 2500);
}

/* --------------------------------------------------------------- wiring --- */

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  loadUrl(urlInput.value);
});

settingsToggle.addEventListener("click", () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute("aria-expanded", String(open));
});

$("save-settings").addEventListener("click", () => {
  config.relay = relayInput.value.trim();
  config.token = tokenInput.value.trim();
  saveConfig();
  settingsResult.hidden = false;
  settingsResult.classList.remove("is-error");
  settingsResult.textContent = "Saved in this browser.";
});

$("test-relay").addEventListener("click", async () => {
  config.relay = relayInput.value.trim();
  config.token = tokenInput.value.trim();
  saveConfig();
  settingsResult.hidden = false;
  settingsResult.classList.remove("is-error");
  settingsResult.textContent = "Testing...";
  try {
    const health = await callRelay("/health");
    settingsResult.textContent = health.inbox
      ? "Relay is up, and the share inbox is configured."
      : "Relay is up. (No share inbox configured — phone sharing won't queue.)";
  } catch (err) {
    settingsResult.classList.add("is-error");
    settingsResult.textContent =
      err.message === "NO_RELAY" ? "Enter a relay URL first." : `Couldn't reach it: ${err.message}`;
  }
});

$("clear-library").addEventListener("click", () => {
  for (const entry of library) {
    try {
      localStorage.removeItem(LS.article(entry.id));
      localStorage.removeItem(LS.state(entry.id));
    } catch { /* ignore */ }
  }
  library = [];
  saveLibrary();
  renderLibrary();
});

$("back-btn").addEventListener("click", showHome);

underlineBtn.addEventListener("click", () => {
  underlineMode = !underlineMode;
  underlineBtn.setAttribute("aria-pressed", String(underlineMode));
  contentEl.classList.toggle("tool-underline", underlineMode);
  if (underlineMode) flashMessage("Underline on — select text to mark it, tap a mark to remove.");
});

$("bookmark-btn").addEventListener("click", () => {
  if (!current) return;
  const index = topVisibleBlockIndex();
  toggleBookmark(index);
  const on = current.state.bookmarks.some((b) => b.b === index);
  flashMessage(on ? "Bookmark added here." : "Bookmark removed.");
});

$("marks-btn").addEventListener("click", () => {
  const open = marksPanel.hidden;
  marksPanel.hidden = !open;
  $("marks-btn").setAttribute("aria-expanded", String(open));
});

$("smaller-btn").addEventListener("click", () => {
  config.size = Math.max(SIZE_MIN, Math.round((config.size - 0.06) * 100) / 100);
  saveConfig();
  contentEl.style.setProperty("--reader-size", `${config.size}rem`);
});

$("larger-btn").addEventListener("click", () => {
  config.size = Math.min(SIZE_MAX, Math.round((config.size + 0.06) * 100) / 100);
  saveConfig();
  contentEl.style.setProperty("--reader-size", `${config.size}rem`);
});

resumePill.addEventListener("click", () => {
  resumePill.hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// Underline: finish a selection, or click an existing mark to clear it.
contentEl.addEventListener("mouseup", () => setTimeout(handleSelectionUnderline, 0));
contentEl.addEventListener("touchend", () => setTimeout(handleSelectionUnderline, 0));
contentEl.addEventListener("click", (ev) => {
  if (!underlineMode) return;
  const mark = ev.target.closest(".reader-underline");
  if (mark && window.getSelection()?.isCollapsed) removeUnderlineAt(mark);
});

window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("beforeunload", saveState);

document.addEventListener("keydown", (ev) => {
  if (articleView.hidden) return;
  if (ev.target.matches("input, textarea")) return;
  if (ev.key === "Escape") showHome();
  if (ev.key === "b" && current) toggleBookmark(topVisibleBlockIndex());
  if (ev.key === "u") underlineBtn.click();
});

/* ----------------------------------------------------------------- boot --- */

// A share from the phone arrives as ?url=, or as ?text= with the link inside.
function sharedUrlFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const direct = params.get("url");
  if (direct) return direct;
  const text = params.get("text") || "";
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : "";
}

function boot() {
  relayInput.value = config.relay || "";
  tokenInput.value = config.token || "";
  contentEl.style.setProperty("--reader-size", `${config.size}rem`);
  renderLibrary();

  const shared = sharedUrlFromLocation();
  if (shared) {
    // Clean the URL so a refresh doesn't re-trigger the share.
    history.replaceState(null, "", window.location.pathname);
    urlInput.value = shared;
    loadUrl(shared);
  } else if (!config.token) {
    setStatus("First time here? Open Relay settings and paste your relay token.");
  }
}

boot();
