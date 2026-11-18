const VERSION = "v57";                       // bump on every deploy
const CACHE = `cliptoid-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const NAV_TIMEOUT = 3500;                    // ms before falling back to a cached page
const RUNTIME_LIMIT = 80;                    // max non-shell entries

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
  "/site.webmanifest",
  "/offline.html",
  "/images/cliptoid-app.svg",
  "/images/cliptoid-192.png",
  "/images/cliptoid-512.png",
  "/css/cliptoid/style.min.v_21may2026.css",
  "/css/cliptoid/cliptoid.css",
  "/js/cliptoid-downloader.js",
  "/js/cliptoid-pwa.js",
];
const SHELL_PATHS = new Set(APP_SHELL);

/* ───────── helpers ───────── */
const cacheable = (res) =>
  res && res.status === 200 && res.type === "basic" && !res.redirected &&
  !/no-store/i.test(res.headers.get("Cache-Control") || "");

// Redirected responses can't be served to navigations, so re-wrap them
const clean = async (res) =>
  new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

async function trim() {
  const cache = await caches.open(CACHE);
  const extra = (await cache.keys()).filter((r) => !SHELL_PATHS.has(new URL(r.url).pathname));
  await Promise.all(extra.slice(0, Math.max(0, extra.length - RUNTIME_LIMIT)).map((r) => cache.delete(r)));
}

async function store(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
  await trim();
}

const changed = (a, b) => {
  const ea = a.headers.get("ETag"), eb = b.headers.get("ETag");
  if (ea && eb) return ea !== eb;
  const la = a.headers.get("Last-Modified"), lb = b.headers.get("Last-Modified");
  return Boolean(la && lb && la !== lb);
};

async function notifyClients(message) {
  for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage(message);
}

/* ───────── lifecycle ───────── */
self.addEventListener("install", (event) => {
  // Fault tolerant: a missing file or redirect no longer breaks installation.
  // No skipWaiting() here: the page asks for it when the user taps "Update".
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(APP_SHELL.map(async (url) => {
      const res = await fetch(new Request(url, { cache: "reload" }));
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      await cache.put(url, res.redirected ? await clean(res) : res);
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k.startsWith("cliptoid-") && k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.registration.navigationPreload?.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/* ───────── strategies ───────── */

// Pages: network-first (always fresh), fall back to cache, then offline page
async function navigate(event) {
  const { request } = event;

  const network = (async () => (await event.preloadResponse) || (await fetch(request)))()
    .then((res) => {
      if (cacheable(res)) event.waitUntil(store(request, res.clone()));  // not blocking the response
      return res;
    });

  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });

  try {
    // With a cached copy, don't wait forever on a slow network
    const res = cached ? await withTimeout(network, NAV_TIMEOUT) : await network;
    if (res.status >= 500 && cached) return cached;
    return res;
  } catch {
    return cached ||
           (await cache.match(OFFLINE_URL)) ||
           new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

// JS / CSS / manifest: instant from cache, revalidate in background
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const update = fetch(request, { cache: "no-cache" })       // cheap conditional request (304)
    .then(async (res) => {
      if (cacheable(res)) {
        if (cached && changed(cached, res)) await notifyClients({ type: "CONTENT_UPDATED", url: request.url });
        await store(request, res.clone());
      }
      return res;
    })
    .catch(() => null);

  event.waitUntil(update);
  return cached || (await update) || Response.error();
}

// Images / fonts: cache-first (they rarely change)
async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (cacheable(res)) event.waitUntil(store(request, res.clone()));
  return res;
}

/* ───────── routing ───────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/service-worker.js") return;

  if (request.mode === "navigate") return event.respondWith(navigate(event));

  switch (request.destination) {
    case "script":
    case "style":
    case "manifest":
      return event.respondWith(staleWhileRevalidate(event));
    case "image":
    case "font":
      return event.respondWith(cacheFirst(event));
    // Anything else (fetch/XHR/htmx/API calls) is left to the browser untouched
  }
});