const CACHE_NAME = "cliptoid-shell-v56";
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
  "/images/cliptoid-app.svg",
  "/images/cliptoid-192.png",
  "/images/cliptoid-512.png",
  "/css/cliptoid/style.min.v_21may2026.css",
  "/css/cliptoid/cliptoid.css",
  "/js/cliptoid-downloader.js",
  "/js/cliptoid-pwa.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  const cacheableRequest = request.mode === "navigate" || ["script", "style", "image", "font", "manifest"].includes(request.destination);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, { cache: "no-cache" });
      if (cacheableRequest && response.ok && response.type === "basic") {
        try {
          await cache.put(request, response.clone());
        } catch {}
      }
      return response;
    } catch {
      const cachedResponse =
        (await cache.match(request)) ||
        (await cache.match(`${url.origin}${url.pathname}`)) ||
        (request.mode === "navigate" ? await cache.match("/index.html") : null);
      return cachedResponse || Response.error();
    }
  })());
});
