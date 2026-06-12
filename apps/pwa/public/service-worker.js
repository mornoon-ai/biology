const CACHE_NAME = "mother-topic-player-v5-mobile-assets-lite";
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const withBase = (path) => `${BASE_PATH}${path}`;
const pagePath = (pathname) => {
  if (!BASE_PATH) return pathname || "/";
  if (!pathname.startsWith(BASE_PATH)) return pathname || "/";
  return pathname.slice(BASE_PATH.length) || "/";
};
const CORE_ASSETS = [
  "/",
  "/icon.svg",
  "/manifest.webmanifest",
  "/data/topics.json",
  "/data/assets.json",
  "/data/gate_cards.json",
  "/data/training_units.json",
  "/data/variants.json",
  "/data/coach_rules.json",
  "/data/audio_segments.json",
  "/data/knowledge_cards.json",
  "/data/knowledge_card_overrides.json",
  "/data/topic_readiness_report.json",
  "/data/learning_readiness_report.json",
  "/data/chapter_mapping_report.json",
  "/data/knowledge_card_quality_report.json",
  "/data/diagram_matching_report.json",
  "/data/review_tasks.json",
  "/data/unmatched_assets.json",
  "/data/export_report.json"
].map(withBase);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const path = pagePath(url.pathname);
  if (event.request.headers.has("range") || path.startsWith("/assets/audio/")) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (path.startsWith("/data/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
