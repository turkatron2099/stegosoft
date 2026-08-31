const listEl = document.getElementById("digest-list");
const updatedEl = document.getElementById("digest-updated");
const summaryEl = document.getElementById("digest-summary");

function formatUpdated(iso) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function renderSummary(summary) {
  summaryEl.innerHTML = "";
  if (!summary) return;

  const counts = document.createElement("p");
  counts.className = "digest-counts";
  const breakdown = Object.entries(summary.counts)
    .map(([topic, count]) => `${count} ${topic}`)
    .join(" · ");
  counts.textContent = `${summary.totalCount} stories today — ${breakdown}`;
  summaryEl.appendChild(counts);

  if (summary.topHeadlines && summary.topHeadlines.length > 0) {
    const top = document.createElement("div");
    top.className = "digest-top";

    const label = document.createElement("span");
    label.className = "digest-top-label";
    label.textContent = "Top stories:";
    top.appendChild(label);

    summary.topHeadlines.forEach((headline) => {
      const a = document.createElement("a");
      a.className = "digest-top-link";
      a.href = headline.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = headline.title;
      top.appendChild(a);
    });

    summaryEl.appendChild(top);
  }
}

function renderDigest(digest) {
  updatedEl.textContent = `Updated ${formatUpdated(digest.generatedAt)}`;
  renderSummary(digest.summary);

  listEl.innerHTML = "";
  listEl.dataset.status = "ready";

  digest.items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "digest-item";

    const title = document.createElement("a");
    title.className = "digest-title";
    title.href = item.link;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = item.title;
    li.appendChild(title);

    if (item.summary) {
      const summary = document.createElement("p");
      summary.className = "digest-summary";
      summary.textContent = item.summary;
      li.appendChild(summary);
    }

    const meta = document.createElement("span");
    meta.className = "digest-meta";
    const date = item.date ? new Date(item.date).toLocaleDateString() : null;
    meta.textContent = date ? `${item.source} · ${date}` : item.source;
    li.appendChild(meta);

    listEl.appendChild(li);
  });
}

async function loadDigest() {
  const res = await fetch("digest.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const digest = await res.json();
  if (!digest.items || digest.items.length === 0) throw new Error("empty digest");
  renderDigest(digest);
}

loadDigest().catch((err) => {
  console.error(err);
  listEl.innerHTML = '<li class="digest-status digest-error">Couldn\'t load today\'s digest right now.</li>';
  listEl.dataset.status = "error";
  updatedEl.textContent = "";
  summaryEl.innerHTML = "";
});
