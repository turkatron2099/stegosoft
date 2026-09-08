// Live filter for the tools grid. Reads whatever .tool-card elements exist at
// load time, so new tools just need a card added to tools.html and get search
// for free — nothing here needs to change as the list grows.
(() => {
  const searchInput = document.getElementById("tool-search");
  const cards = Array.from(document.querySelectorAll("#tools-grid .tool-card"));
  const emptyMsg = document.getElementById("tools-empty");
  const emptyQuery = document.getElementById("tools-empty-query");

  function filter() {
    const query = searchInput.value.trim().toLowerCase();
    let visibleCount = 0;

    cards.forEach((card) => {
      const title = card.querySelector(".tool-card-title").textContent.toLowerCase();
      const match = !query || title.includes(query);
      card.hidden = !match;
      if (match) visibleCount++;
    });

    emptyQuery.textContent = searchInput.value.trim();
    emptyMsg.hidden = visibleCount !== 0;
  }

  searchInput.addEventListener("input", filter);
})();
