// Atril sin conexión: guarda la app al instalar y los sonidos a medida que se usan.
// - La página (index.html) y el manifiesto: primero la red, para que una versión nueva llegue al recargar;
//   sin conexión, la copia guardada.
// - Sonidos (snd/): de la caché si ya están; no cambian.
// - Lo demás (vendor/, fonts/, íconos): de la caché al tiro y se actualiza por detrás para la próxima vez.
const CACHE = "atril-v2";
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

const store = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };
const cached = (req) => caches.match(req, { ignoreSearch: true });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (req.mode === "navigate" || path === "" || path === "index.html" || path === "manifest.webmanifest") {
    e.respondWith(fetch(req, { cache: "no-cache" }).then((res) => store(req, res))
      .catch(() => cached(req).then((hit) => hit || cached("./index.html"))));
  } else if (path.startsWith("snd/")) {
    e.respondWith(cached(req).then((hit) => hit || fetch(req).then((res) => store(req, res))));
  } else {
    const net = fetch(req).then((res) => store(req, res));
    e.waitUntil(net.catch(() => {}));
    e.respondWith(cached(req).then((hit) => hit || net));
  }
});
