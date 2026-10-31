// Registers the service worker (sw.js) that makes the site installable and
// gives visited pages offline support. See sw.js for the caching strategy.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}

// Keep the footer's "© 2026 Thagobyte™" current: from Jan 1 each year the
// year shown becomes the visitor's current year (the HTML says 2026 as a
// fallback). pwa.js is loaded on every page, so this covers the whole site.
(function () {
  const year = new Date().getFullYear();
  document.querySelectorAll("footer span").forEach((span) => {
    const match = span.textContent.match(/^© (\d{4}) Thagobyte/);
    if (match && Number(match[1]) < year) {
      span.textContent = span.textContent.replace(match[1], String(year));
    }
  });
})();
