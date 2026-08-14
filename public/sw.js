const CACHE = "gate-player-v15-pro-ui";
const ASSETS = [
  "/",
  "/styles.css?v=0.5.4-ui",
  "/webos.css?v=1.0.2",
  "/pro-ui.css?v=1.0.0",
  "/app.js?v=0.5.4-ui",
  "/webos-remote.js?v=1.0.2",
  "/pro-ui.js?v=1.0.0",
  "/gate-icon.svg",
  "/manifest.webmanifest",
  "/vendor/hls.min.js?v=0.5.3",
  "/vendor/mpegts.min.js?v=0.5.3"
];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || event.request.headers.has("range")) return;
  event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});
