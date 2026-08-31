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
  Cybersecurity: 6,
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
  const text = decodeEntities(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
  // Strip WordPress's auto-appended "The post X appeared first on Y." boilerplate,
  // re-marking the cut with an ellipsis if the excerpt didn't already end cleanly.
  const withoutBoilerplate = text.replace(/\s*(\[…\]\s*)?The post .+ appeared first on .+?\.?\s*$/i, "").trim();
  if (withoutBoilerplate !== text && withoutBoilerplate && !/[.!?…]$/.test(withoutBoilerplate)) {
    return withoutBoilerplate + "…";
  }
  return withoutBoilerplate;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
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

function parseRssItems(xml) {
  // The lookahead requires "item" to be followed by whitespace or ">" so this
  // doesn't also match "<items>" (RDF/RSS 1.0 feeds like Slashdot's use that
  // as a table-of-contents wrapper, distinct from the real <item> elements).
  const blocks = xml.match(/<item(?=[\s>])[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
    const title = decodeEntities(extractTag(block, "title"));
    const link = decodeEntities(extractTag(block, "link")).trim();
    const pubDateRaw = extractTag(block, "pubDate") || extractTag(block, "dc:date");
    const description = stripTags(extractTag(block, "description") || extractTag(block, "content:encoded"));
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
      headers: { "User-Agent": "StegosoftDigestBot/1.0 (+https://stegosoft.com)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const now = Date.now();
    return parseRssItems(xml)
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
    finalItems.push(...items.slice(0, TOPIC_LIMITS[topic] ?? DEFAULT_TOPIC_LIMIT));
  }

  if (finalItems.length === 0) {
    throw new Error("No items fetched from any feed — refusing to overwrite digest.json with an empty digest.");
  }

  shuffle(finalItems);

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
