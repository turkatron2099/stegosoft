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

  // digest.json changes throughout the day (the news digest), so it needs
  // network-first — stale-while-revalidate below would otherwise always
  // hand back whatever was cached on a *previous* visit first, and only
  // catch up in the background for the visit after that. news.js already
  // fetches it with {cache: "no-store"}, but that only controls the
  // browser's own HTTP cache and does nothing against a service worker
  // sitting in front of it, so the bypass has to live here instead.
  if (url.pathname.endsWith("/digest.json")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw new Error("digest.json unavailable and not cached");
        }
      })
    );
    return;
  }

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
