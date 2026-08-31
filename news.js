const RSS_TO_JSON = "https://api.rss2json.com/v1/api.json?rss_url=";
const ITEMS_PER_COLUMN = 8;

const COLUMNS = [
  {
    id: "feed-technology",
    feeds: [
      { source: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
      { source: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
    ],
  },
  {
    id: "feed-gaming",
    feeds: [
      { source: "Polygon", url: "https://www.polygon.com/rss/index.xml" },
      { source: "IGN", url: "https://feeds.ign.com/ign/games-all" },
    ],
  },
  {
    id: "feed-archaeology",
    feeds: [
      { source: "Biblical Archaeology Society", url: "https://www.biblicalarchaeology.org/feed/" },
    ],
  },
];

async function fetchFeed(feed) {
  const res = await fetch(RSS_TO_JSON + encodeURIComponent(feed.url));
  if (!res.ok) throw new Error(`${feed.source}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "ok") throw new Error(`${feed.source}: ${data.message || "feed error"}`);
  return data.items.map((item) => ({
    title: item.title,
    link: item.link,
    source: feed.source,
    date: item.pubDate ? new Date(item.pubDate) : null,
  }));
}

function renderItems(listEl, items) {
  listEl.innerHTML = "";
  listEl.dataset.status = "ready";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "feed-item";

    const a = document.createElement("a");
    a.href = item.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = item.title;
    li.appendChild(a);

    const meta = document.createElement("span");
    meta.className = "feed-meta";
    meta.textContent = item.date
      ? `${item.source} · ${item.date.toLocaleDateString()}`
      : item.source;
    li.appendChild(meta);

    listEl.appendChild(li);
  });
}

async function loadColumn(column) {
  const listEl = document.querySelector(`#${column.id} .feed-list`);
  const results = await Promise.allSettled(column.feeds.map(fetchFeed));

  const items = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, ITEMS_PER_COLUMN);

  if (items.length === 0) {
    listEl.innerHTML = '<li class="feed-status feed-error">Couldn\'t load this feed right now.</li>';
    listEl.dataset.status = "error";
    return;
  }

  renderItems(listEl, items);
}

COLUMNS.forEach((column) => {
  loadColumn(column).catch((err) => {
    console.error(err);
    const listEl = document.querySelector(`#${column.id} .feed-list`);
    listEl.innerHTML = '<li class="feed-status feed-error">Couldn\'t load this feed right now.</li>';
    listEl.dataset.status = "error";
  });
});
