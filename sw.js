// Atril sin conexión: guarda la app al instalar y los sonidos a medida que se usan.
const CACHE = "atril-v1";
const CORE = [
  "./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png",
  "./fonts/fonts.css",
  "./vendor/vexflow.js", "./vendor/jspdf.umd.min.js", "./vendor/jszip.min.js", "./vendor/lame.min.js",
  "./vendor/mp4-muxer.js", "./vendor/webm-muxer.js", "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
