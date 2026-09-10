// Thagobyte service worker — makes the site installable as a PWA and lets
// pages you've already visited keep working offline. Strategy is
// stale-while-revalidate for same-origin GETs only: serve straight from
// cache when we have it (instant, and works with no connection), while
// always re-fetching in the background to keep the cache fresh for next
// time. There's no fixed precache list to maintain — the cache just fills
// in as pages get visited, so new tools work offline automatically after
// their first visit.
//
// Cross-origin requests (archive.org video streams, the weather/geocoding
// APIs, CDN libraries) are left alone — those need a live network anyway,
// and the video files are far too large to want in a browser cache.
const CACHE_NAME = "thagobyte-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
