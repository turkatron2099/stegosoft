// Spotify <-> Apple Music link converter. Odesli used to do this for free
// but retired its keyless API in 2026, so the matching happens here:
//
//   - Apple data comes straight from the iTunes Search/Lookup APIs, which
//     are keyless and CORS-enabled. (Calling them from the Worker hit 429s:
//     Workers share egress IPs, so the per-IP limit is never really ours.)
//   - Spotify data goes through the Reader relay Worker (/song/*), since
//     Spotify's embed pages have no CORS and its search API needs a secret.
//
// Neither side exposes a shared ID publicly (no ISRC from Apple), so matches
// are scored on normalized title + artist + duration / track count.
(() => {
  const RELAY = "https://thagobyte-reader.thagobyte.workers.dev";
  const MIN_SCORE = 60;

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

  /* ---------------------------------------------------------- parsing */

  function parseLink(raw) {
    let u;
    try {
      u = new URL(raw.trim());
    } catch {
      return null;
    }
    const host = u.hostname.replace(/^www\./, "");
    if (/^(open|play)\.spotify\.com$|^spotify\.(app\.)?link$/.test(host)) return { service: "spotify" };
    if (!/^(geo\.)?music\.apple\.com$|^itunes\.apple\.com$/.test(host)) return null;

    const parts = u.pathname.split("/").filter(Boolean);
    const country = /^[a-z]{2}$/.test(parts[0] || "") ? parts[0] : "us";
    const trackParam = u.searchParams.get("i");
    const idMatch = (parts[parts.length - 1] || "").match(/^(?:id)?(\d+)$/);
    if (parts.includes("album") && /^\d+$/.test(trackParam || "")) return { service: "apple", kind: "track", id: trackParam, country };
    if (parts.includes("song") && idMatch) return { service: "apple", kind: "track", id: idMatch[1], country };
    if (parts.includes("album") && idMatch) return { service: "apple", kind: "album", id: idMatch[1], country };
    return null;
  }

  /* --------------------------------------------------------- matching */

  // Strip the decorations that differ between stores: "(Remastered 2009)",
  // "- Single", "[feat. X]", punctuation, accents.
  function norm(text) {
    return String(text || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s[-–—]\s.*(remaster|version|edit|mix|live|mono|stereo|single|ep|deluxe|anniversary).*$/i, "")
      .replace(/[([][^)\]]*(remaster|version|edit|mix|live|mono|stereo|single|ep|deluxe|anniversary|feat|ft\.|with )[^)\]]*[)\]]/gi, "")
      .replace(/\b(feat|ft)\.?\s.*$/, "")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function textScore(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return 0.6;
    // Token overlap for reorderings / small differences.
    const xs = new Set(x.split(" "));
    const ys = y.split(" ");
    const hit = ys.filter((t) => xs.has(t)).length;
    return (hit / Math.max(xs.size, ys.length)) * 0.5;
  }

  function artistScore(wanted, candidate) {
    // `wanted` is the primary artist; candidates may list several ("A & B").
    const w = norm(wanted);
    const c = norm(candidate);
    if (!w || !c) return 0;
    if (w === c) return 1;
    if (c.includes(w) || w.includes(c)) return 0.8;
    return textScore(wanted, candidate);
  }

  function score(src, cand) {
    let s = textScore(src.title, cand.title) * 50 + artistScore(src.artist, cand.artist) * 35;
    if (src.kind === "track" && src.durationMs && cand.durationMs) {
      const diff = Math.abs(src.durationMs - cand.durationMs) / 1000;
      s += diff <= 2 ? 15 : diff <= 6 ? 8 : diff > 30 ? -15 : 0;
    }
    if (src.kind === "album" && src.trackCount && cand.trackCount) {
      s += src.trackCount === cand.trackCount ? 15 : -5;
    }
    if (src.explicit != null && cand.explicit != null && src.explicit === cand.explicit) s += 3;
    return Math.round(s);
  }

  function best(src, candidates) {
    let top = null;
    for (const cand of candidates) {
      const s = score(src, cand);
      if (!top || s > top.score) top = { ...cand, score: s };
    }
    return top && top.score >= MIN_SCORE ? top : null;
  }

  /* ------------------------------------------------------------ apple */

  function fromItunes(it, kind) {
    return {
      service: "apple",
      kind,
      title: kind === "track" ? it.trackName : it.collectionName,
      artist: it.artistName,
      durationMs: it.trackTimeMillis || null,
      trackCount: it.trackCount || null,
      explicit: kind === "track" ? it.trackExplicitness === "explicit" : null,
      url: ((kind === "track" ? it.trackViewUrl : it.collectionViewUrl) || "").replace(/[?&]uo=\d+/, "") || null,
      artwork: it.artworkUrl100 ? it.artworkUrl100.replace("100x100bb", "600x600bb") : null,
    };
  }

  async function itunes(path, params) {
    const res = await fetch(`https://itunes.apple.com/${path}?${new URLSearchParams(params)}`);
    if (res.status === 429 || res.status === 403) {
      throw new Error("Apple's search is rate-limiting you — wait a minute and try again.");
    }
    if (!res.ok) throw new Error(`Apple search failed (${res.status}).`);
    return (await res.json()).results || [];
  }

  async function appleLookup({ kind, id, country }) {
    const [it] = await itunes("lookup", { id, country });
    if (!it) throw new Error("Apple Music couldn't find that link.");
    return fromItunes(it, kind);
  }

  async function appleSearch(src, country) {
    const entity = src.kind === "track" ? "song" : "album";
    const results = await itunes("search", { term: `${norm(src.title)} ${norm(src.artist)}`, entity, limit: 25, country });
    const found = best(src, results.map((it) => fromItunes(it, src.kind)));
    if (found || src.kind !== "album") return found;

    // iTunes Search leaves some big albums out of its album index (The Dark
    // Side of the Moon, for one) while still indexing their songs. Search a
    // few of the album's tracks and score the albums those songs belong to.
    const albums = new Map();
    for (const title of (src.trackTitles || []).slice(0, 3)) {
      const songs = await itunes("search", { term: `${norm(title)} ${norm(src.artist)}`, entity: "song", limit: 25, country });
      for (const it of songs) {
        if (it.collectionId && !albums.has(it.collectionId)) {
          albums.set(it.collectionId, {
            ...fromItunes(it, "album"),
            title: it.collectionName,
            url: `https://music.apple.com/${country}/album/${it.collectionId}`,
          });
        }
      }
      const hit = best(src, [...albums.values()]);
      if (hit) return hit;
    }
    return null;
  }

  /* ---------------------------------------------------------- spotify */

  async function relay(path, params) {
    const res = await fetch(`${RELAY}${path}?${new URLSearchParams(params)}`);
    const data = await res.json().catch(() => null);
    if (!data) throw new Error("The relay sent back something unexpected — try again.");
    if (!data.ok) throw new Error(data.error || "The relay couldn't handle that.");
    return data;
  }

  async function spotifySearch(src, market) {
    const field = src.kind === "track" ? "track" : "album";
    const strict = await relay("/song/spotify-search", {
      kind: src.kind,
      q: `${field}:${norm(src.title)} artist:${norm(src.artist)}`,
      market,
    });
    const found = best(src, strict.items);
    if (found) return found;
    const loose = await relay("/song/spotify-search", { kind: src.kind, q: `${src.title} ${src.artist}`, market });
    return best(src, loose.items);
  }

  async function lookup(link) {
    const parsed = parseLink(link);
    if (!parsed) throw new Error("That's not a Spotify or Apple Music link.");
    if (parsed.service === "spotify") {
      const { source } = await relay("/song/spotify", { url: link });
      return { source, match: await appleSearch(source, "us") };
    }
    const source = await appleLookup(parsed);
    return { source, match: await spotifySearch(source, parsed.country) };
  }

  /* --------------------------------------------------------------- ui */


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
      const { source, match } = await lookup(link);
      if (!match) {
        const other = source.service === "spotify" ? "Apple Music" : "Spotify";
        throw new Error(`Couldn't find "${source.title}" by ${source.artist} on ${other}.`);
      }
      showResult(match);
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
