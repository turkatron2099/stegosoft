(function () {
  // A classic "Visitors: N" counter, persisted server-side (no backend of our
  // own — this static site has nowhere to store it) via Abacus, a free,
  // no-signup hit-counter API (https://jasoncameron.dev/abacus/): GET
  // /hit/<namespace>/<key> increments and returns the count, GET
  // /get/<namespace>/<key> reads it without incrementing.
  //
  // To make "Visitors" mean something closer to unique visitors rather than
  // every page reload, each browser only ever calls /hit once (tracked via
  // localStorage) and calls the non-incrementing /get on every visit after
  // that.
  const NAMESPACE = "thagobyte-com";
  const KEY = "visitors";
  const SEEN_KEY = "thagobyte-visitor-counted";
  const BASE = "https://abacus.jasoncameron.dev";

  // Lives inside the Contact section (bottom-right corner of it), not as a
  // fixed viewport overlay — it scrolls normally with the page and is only
  // on screen once you've scrolled down that far, rather than following you
  // around the whole time like the click counter does.
  const contact = document.querySelector(".contact");
  if (!contact) return;

  const counter = document.createElement("div");
  counter.className = "visitor-counter";
  counter.textContent = "Visitors: …";
  contact.appendChild(counter);

  let alreadyCounted = false;
  try {
    alreadyCounted = localStorage.getItem(SEEN_KEY) === "1";
  } catch (e) {
    // private browsing / storage disabled — just treat every visit as a hit
  }

  const endpoint = `${BASE}/${alreadyCounted ? "get" : "hit"}/${NAMESPACE}/${KEY}`;

  fetch(endpoint)
    .then((r) => r.json())
    .then((data) => {
      counter.textContent = `Visitors: ${data.value}`;
      if (!alreadyCounted) {
        try {
          localStorage.setItem(SEEN_KEY, "1");
        } catch (e) {
          // no persistence available — next visit will just count again
        }
      }
    })
    .catch(() => {
      counter.textContent = "Visitors: —";
    });
})();
