#!/usr/bin/env node
// Fetches RSS feeds for each topic, merges/dedupes/sorts them, and writes
// digest.json — a single static snapshot the News page reads. Run every
// 4 hours by .github/workflows/daily-digest.yml, or manually to refresh
// locally.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FEEDS = [
  { topic: "Technology", source: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { topic: "Technology", source: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { topic: "Technology", source: "Slashdot", url: "http://rss.slashdot.org/Slashdot/slashdotMain" },
  { topic: "Gaming", source: "Polygon", url: "https://www.polygon.com/rss/index.xml" },
  { topic: "Gaming", source: "IGN", url: "https://feeds.ign.com/ign/games-all" },
  { topic: "Biblical Archaeology", source: "Biblical Archaeology Society", url: "https://www.biblicalarchaeology.org/feed/" },
  { topic: "Comics", source: "Bleeding Cool", url: "https://bleedingcool.com/feed/" },
  { topic: "Comics", source: "ComicBook.com", url: "https://comicbook.com/feed/" },
  { topic: "Cybersecurity", source: "Krebs on Security", url: "https://krebsonsecurity.com/feed/" },
  { topic: "Cybersecurity", source: "The Hacker News", url: "https://feeds.feedburner.com/TheHackersNews" },
  {
    topic: "Cybersecurity",
    source: "Simply Cyber Newsletter",
    url: "https://rss.beehiiv.com/feeds/sdyjKjX6eY.xml",
    // <description> here is just the same one-line tagline on every issue;
    // the real per-issue content (news analysis, "what to do" advice) is
    // in <content:encoded>, after a boilerplate pitch paragraph this marker
    // skips past. If a future issue omits the marker (it's already
    // inconsistently present/misspelled as "HIGHIGHTS" in the source), this
    // just falls back to the boilerplate opening rather than failing.
    preferContentEncoded: true,
    contentStartMarker: "CYBER NEWS HIGHIGHTS",
  },
  { topic: "Cybersecurity", source: "Dark Reading", url: "https://www.darkreading.com/rss.xml" },
  { topic: "Top News", source: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  { topic: "Top News", source: "BBC News", url: "http://feeds.bbci.co.uk/news/rss.xml" },
];

// Per-topic cap on the final digest. "Top News" is general-interest filler,
// not one of the actual interests, so it only gets a couple of items.
const TOPIC_LIMITS = {
  Technology: 6,
  Gaming: 6,
  "Biblical Archaeology": 6,
  Comics: 6,
  // Bumped from 6 now that there are 4 sources sharing this topic — at 6,
  // The Hacker News's high posting frequency alone filled every slot with
  // its own last ~3 days of posts, before Krebs, Dark Reading, or Simply
  // Cyber ever got ranked by recency.
  Cybersecurity: 9,
  "Top News": 2,
};
const DEFAULT_TOPIC_LIMIT = 6;
const SUMMARY_MAX_LEN = 220;

const NAMED_ENTITIES = {
  mdash: "—",
  ndash: "–",
  hellip: "…",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decodeEntities(str) {
  // &amp; goes first: some feeds (e.g. Slashdot) double-encode, writing
  // "&amp;mdash;" for what should be "&mdash;". Decoding &amp; first turns
  // that back into a normal single-encoded entity the rest of this can read.
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (full, name) => NAMED_ENTITIES[name.toLowerCase()] ?? full);
}

function stripTags(html) {
  // <style>/<script> blocks carry real text content between their tags —
  // a naive tag-only strip leaves that text (CSS rules, JS) behind as if
  // it were article content, so these have to go before the generic strip.
  const withoutEmbedded = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ");
  const text = decodeEntities(withoutEmbedded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
  // Strip WordPress's auto-appended "The post X appeared first on Y." boilerplate,
  // re-marking the cut with an ellipsis if the excerpt didn't already end cleanly.
  const withoutBoilerplate = text.replace(/\s*(\[…\]\s*)?The post .+ appeared first on .+?\.?\s*$/i, "").trim();
  if (withoutBoilerplate !== text && withoutBoilerplate && !/[.!?…]$/.test(withoutBoilerplate)) {
    return withoutBoilerplate + "…";
  }
  return withoutBoilerplate;
}

function truncate(text, maxLen) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  const raw = match[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1].trim() : raw;
}

function parseRssItems(xml, feed = {}) {
  // The lookahead requires "item" to be followed by whitespace or ">" so this
  // doesn't also match "<items>" (RDF/RSS 1.0 feeds like Slashdot's use that
  // as a table-of-contents wrapper, distinct from the real <item> elements).
  const blocks = xml.match(/<item(?=[\s>])[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
    const title = decodeEntities(extractTag(block, "title"));
    const link = decodeEntities(extractTag(block, "link")).trim();
    const pubDateRaw = extractTag(block, "pubDate") || extractTag(block, "dc:date");
    // Most feeds' <description> is already a short, hand-written summary —
    // the right thing to show. A few (this newsletter included) instead
    // leave <description> as a generic one-line tagline and put the real,
    // per-issue body in <content:encoded>; feed.preferContentEncoded opts
    // a source into using that instead.
    const rawBody = feed.preferContentEncoded
      ? extractTag(block, "content:encoded") || extractTag(block, "description")
      : extractTag(block, "description") || extractTag(block, "content:encoded");
    let description = stripTags(rawBody);
    // Some newsletter templates always open with the same boilerplate
    // pitch before the actual per-issue content — skip to a marker string
    // that reliably starts the real content, when the source has one.
    if (feed.contentStartMarker) {
      const idx = description.indexOf(feed.contentStartMarker);
      if (idx !== -1) description = description.slice(idx + feed.contentStartMarker.length).trim();
    }
    return {
      title,
      link,
      description,
      date: pubDateRaw ? new Date(pubDateRaw) : null,
    };
  });
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "ThagobyteDigestBot/1.0 (+https://thagobyte.com)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const now = Date.now();
    return parseRssItems(xml, feed)
      .filter((item) => item.title && item.link)
      // Some feeds (e.g. recurring webinar/event listings) date an entry by
      // its event date rather than publish date, which can be in the future
      // and would otherwise falsely rank as the "most recent" item.
      .filter((item) => !item.date || item.date.getTime() <= now)
      .map((item) => ({
        title: item.title,
        link: item.link,
        summary: truncate(item.description, SUMMARY_MAX_LEN),
        source: feed.source,
        topic: feed.topic,
        date: item.date && !Number.isNaN(item.date.getTime()) ? item.date.toISOString() : null,
      }));
  } catch (err) {
    console.error(`Failed to fetch ${feed.source} (${feed.url}): ${err.message}`);
    return [];
  }
}

async function main() {
  const results = await Promise.all(FEEDS.map(fetchFeed));

  const byTopic = new Map();
  for (const items of results) {
    for (const item of items) {
      if (!byTopic.has(item.topic)) byTopic.set(item.topic, []);
      byTopic.get(item.topic).push(item);
    }
  }

  const finalItems = [];
  for (const [topic, items] of byTopic.entries()) {
    items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const limit = TOPIC_LIMITS[topic] ?? DEFAULT_TOPIC_LIMIT;

    // Pure cross-source recency would let a high-frequency source (several
    // posts/day) fill every slot in a topic before a lower-frequency one
    // (e.g. a once-a-weekday show) ever got ranked in, even though both
    // belong there. Guarantee each source's single most recent item a
    // slot first, then fill whatever's left by recency across the rest.
    const mostRecentBySource = new Map();
    for (const item of items) {
      if (!mostRecentBySource.has(item.source)) mostRecentBySource.set(item.source, item);
    }
    const guaranteed = [...mostRecentBySource.values()];
    const guaranteedSet = new Set(guaranteed);
    const rest = items.filter((item) => !guaranteedSet.has(item));
    const picked = [...guaranteed, ...rest].slice(0, limit);
    picked.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    finalItems.push(...picked);
  }

  if (finalItems.length === 0) {
    throw new Error("No items fetched from any feed — refusing to overwrite digest.json with an empty digest.");
  }

  // Each topic's own block above is already recency-sorted, but the
  // topics themselves were just appended in Map insertion order — sort
  // the whole combined list by date too, so the page reads most-recent-
  // first overall instead of one topic's block, then the next's. This
  // also has the side effect of interleaving topics rather than showing
  // rigid same-topic blocks, since different topics' stories land at
  // different times.
  finalItems.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const digest = {
    generatedAt: new Date().toISOString(),
    items: finalItems,
  };

  const outPath = fileURLToPath(new URL("../digest.json", import.meta.url));
  await writeFile(outPath, JSON.stringify(digest, null, 2) + "\n");
  console.log(`Wrote ${outPath} with ${finalItems.length} items.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
