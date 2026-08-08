const CACHE = "gate-player-v11";
const ASSETS = ["/", "/styles.css?v=0.5.0", "/app.js?v=0.5.0", "/gate-icon.svg", "/manifest.webmanifest", "/vendor/hls.min.js?v=0.5.0", "/vendor/mpegts.min.js?v=0.5.0"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});
