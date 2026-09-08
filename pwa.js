// Registers the service worker (sw.js) that makes the site installable and
// gives visited pages offline support. See sw.js for the caching strategy.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}
