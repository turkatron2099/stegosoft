const listEl = document.getElementById("digest-list");
const updatedEl = document.getElementById("digest-updated");

function formatUpdated(iso) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function renderDigest(digest) {
  updatedEl.textContent = `Updated ${formatUpdated(digest.generatedAt)}`;

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
});
