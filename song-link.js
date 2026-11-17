// Spotify <-> Apple Music link converter. The matching runs on the Reader
// relay Worker (/song), since Spotify's pages don't send CORS headers and the
// Spotify search API needs a secret. Odesli used to do this for free but
// retired its keyless API in 2026.
(() => {
  const RELAY = "https://thagobyte-reader.thagobyte.workers.dev";

  const form = document.getElementById("songlink-form");
  const input = document.getElementById("songlink-input");
  const btn = document.getElementById("songlink-btn");
  const statusText = document.getElementById("status-text");
  const result = document.getElementById("songlink-result");
  const art = document.getElementById("songlink-art");
  const kindEl = document.getElementById("songlink-kind");
  const titleEl = document.getElementById("songlink-title");
  const artistEl = document.getElementById("songlink-artist");
  const warnEl = document.getElementById("songlink-warn");
  const urlEl = document.getElementById("songlink-url");
  const openBtn = document.getElementById("songlink-open");
  const copyBtn = document.getElementById("songlink-copy");

  const SERVICE_NAMES = { spotify: "Spotify", apple: "Apple Music" };

  function setStatus(message, isError) {
    if (!message) {
      statusText.hidden = true;
      return;
    }
    statusText.hidden = false;
    statusText.textContent = message;
    statusText.style.color = isError ? "var(--red)" : "";
  }

  function looksLikeMusicLink(text) {
    return /^https?:\/\/(open\.spotify\.com|spotify\.link|spotify\.app\.link|(geo\.)?music\.apple\.com|itunes\.apple\.com)\//i.test(text.trim());
  }

  function showResult(match) {
    const service = SERVICE_NAMES[match.service] || match.service;
    kindEl.textContent = `${match.kind === "album" ? "Album" : "Song"} on ${service}`;
    titleEl.textContent = match.title;
    artistEl.textContent = match.artist;
    warnEl.hidden = match.score >= 80;
    urlEl.textContent = match.url;
    urlEl.href = match.url;
    openBtn.href = match.url;
    openBtn.textContent = `Open in ${service}`;
    if (match.artwork) {
      art.src = match.artwork;
      art.hidden = false;
    } else {
      art.hidden = true;
    }
    result.hidden = false;
  }

  async function convert() {
    const link = input.value.trim();
    if (!link) return;
    if (!looksLikeMusicLink(link)) {
      setStatus("That's not a Spotify or Apple Music link.", true);
      result.hidden = true;
      return;
    }

    btn.disabled = true;
    result.hidden = true;
    setStatus("Looking it up…");

    try {
      const res = await fetch(`${RELAY}/song?url=${encodeURIComponent(link)}`);
      const data = await res.json().catch(() => null);
      if (!data) throw new Error("The relay sent back something unexpected — try again.");
      if (!data.ok) throw new Error(data.error || "Couldn't convert that link.");
      showResult(data.match);
      setStatus("");
    } catch (err) {
      setStatus(err.message === "Failed to fetch" ? "Couldn't reach the relay — check your connection." : err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    convert();
  });

  // Pasting a link is the whole interaction, so don't make them click too.
  input.addEventListener("paste", () => {
    setTimeout(() => {
      if (looksLikeMusicLink(input.value)) convert();
    }, 0);
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(urlEl.href);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy link"), 1200);
    } catch (e) {
      // Clipboard API unavailable/denied — the link is shown right there to
      // select by hand.
    }
  });

  // Allow thagobyte.com/song-link.html?url=… so a link can be handed straight in.
  const preset = new URLSearchParams(location.search).get("url");
  if (preset) {
    input.value = preset;
    convert();
  }
})();
