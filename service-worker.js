const CACHE_NAME = "cliptoid-shell-v33";
const APP_SHELL = [
  "/",
  "/index.html",
  "/tiktok-caption.html",
  "/about.html",
  "/contacts.html",
  "/privacy.html",
  "/cookie-policy.html",
  "/terms.html",
  "/disclaimer.html",
  "/copyright.html",
  "/sitemap.html",
  "/sitemap.xml",
  "/site.webmanifest",
  "/images/cliptide-app.svg",
  "/images/cliptide-192.png",
  "/images/cliptide-512.png",
  "/css/cliptoid/style.min.v_21may2026.css",
  "/css/cliptoid/cliptide.css",
  "/js/script_ssstik.min.v_2026oct16.3.js",
  "/js/cliptide-downloader.js",
  "/js/cliptide-pwa.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => /^(cliptide|cliptoid)-shell-/.test(key) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(async () => (await caches.match(request)) || (await caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
