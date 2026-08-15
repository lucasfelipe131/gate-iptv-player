const CACHE_PREFIX = "gate-player-";
const CACHE = "gate-player-v18-tv-ui-2-1";
const ASSETS = [
  "/",
  "/styles.css?v=0.6.1-web",
  "/webos.css?v=1.0.2",
  "/pro-ui.css?v=1.0.0",
  "/ui-polish.css?v=2.1.0",
  "/web-ui.css?v=2.0.0",
  "/app.js?v=0.6.1-web",
  "/tizen-loader.js?v=0.6.0",
  "/platform-player.js?v=0.6.0",
  "/webos-remote.js?v=1.0.2",
  "/pro-ui.js?v=1.0.0",
  "/gate-icon.svg",
  "/manifest.webmanifest",
  "/vendor/hls.min.js?v=0.6.0",
  "/vendor/mpegts.min.js?v=0.6.0"
];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || event.request.headers.has("range")) return;
  event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === "navigate" ? caches.match("/") : undefined))));
});
