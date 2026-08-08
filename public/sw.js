const CACHE = "gate-player-v13-web-stability";
const ASSETS = ["/", "/styles.css?v=0.5.2-web", "/app.js?v=0.5.2-web", "/gate-icon.svg", "/manifest.webmanifest", "/vendor/hls.min.js?v=0.5.2-web", "/vendor/mpegts.min.js?v=0.5.2-web"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || event.request.headers.has("range")) return;
  event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});
