/**
 * Cliptoid service worker (v58)
 *
 * - No offline.html: when a page can't be loaded the browser shows its OWN default error page.
 * - CACHE_PAGES = false  -> page navigations are never intercepted, so this worker cannot break
 *   or delay opening cliptoid.com. Only static assets are cached.
 *   Set it to true to also keep a copy of the main pages for slow/offline use.
 * - Scripts / styles are NETWORK-FIRST, so a deploy is live on the next load (no stale JS).
 * - Cross-origin requests (your Cloudflare Worker API, ads, analytics) are never touched.
 */

const VERSION = "v58";                       // bump on every deploy
const CACHE = `cliptoid-${VERSION}`;
const CACHE_PAGES = false;
const NAV_TIMEOUT = 3500;                    // only used when CACHE_PAGES = true
const ASSET_TIMEOUT = 3000;                  // ms before a slow script/style falls back to its cached copy
const RUNTIME_LIMIT = 80;                    // max non-shell entries

const SHELL_ASSETS = [
  "/site.webmanifest",
  "/images/cliptoid-app.svg",
  "/images/cliptoid-192.png",
  "/images/cliptoid-512.png",
  "/css/cliptoid/style.min.v_21may2026.css",
  "/css/cliptoid/cliptoid.css",
  "/js/cliptoid-downloader.js",
  "/js/cliptoid-pwa.js",
];
const SHELL_PAGES = [
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
];
const APP_SHELL = CACHE_PAGES ? [...SHELL_ASSETS, ...SHELL_PAGES] : SHELL_ASSETS;
const SHELL_PATHS = new Set([...SHELL_ASSETS, ...SHELL_PAGES]);

/* ───────── helpers ───────── */
const cacheable = (res) =>
  res && res.status === 200 && res.type === "basic" && !res.redirected &&
  !/no-store/i.test(res.headers.get("Cache-Control") || "");

// A redirected response can't be served to a navigation, so re-wrap it.
// The body is already decoded, so drop the encoding/length headers.
async function clean(res) {
  const headers = new Headers(res.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

async function trim() {
  const cache = await caches.open(CACHE);
  const extra = (await cache.keys()).filter((r) => !SHELL_PATHS.has(new URL(r.url).pathname));
  await Promise.all(extra.slice(0, Math.max(0, extra.length - RUNTIME_LIMIT)).map((r) => cache.delete(r)));
}

async function store(key, response) {
  const cache = await caches.open(CACHE);
  await cache.put(key, response);
  await trim();
}

const isShellPage = (url) =>
  url.pathname === "/" || SHELL_PATHS.has(url.pathname) || SHELL_PATHS.has(`${url.pathname}.html`);

/* ───────── lifecycle ───────── */
self.addEventListener("install", (event) => {
  // TEMPORARY: replaces the previous worker (v57) right away so nobody stays on it.
  // Remove this line in the next deploy; after that, updates wait for the "Update" tap again.
  self.skipWaiting();

  event.waitUntil((async () => {
    // Chromium only: let page navigations go straight to the network without waking this worker.
    if (!CACHE_PAGES && typeof event.addRoutes === "function") {
      try { await event.addRoutes({ condition: { requestMode: "navigate" }, source: "network" }); } catch { /* optional */ }
    }

    // Fault tolerant: one missing file never breaks installation.
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
    // Navigation preload is remembered across versions, so set it explicitly every time.
    try {
      if (CACHE_PAGES) await self.registration.navigationPreload?.enable();
      else await self.registration.navigationPreload?.disable();
    } catch { /* not supported */ }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

/* ───────── strategies ───────── */

// Pages (only when CACHE_PAGES = true): network first, cached copy if the network is slow or down.
// With no cached copy the error is passed on, so the browser shows its own default error page.
async function navigate(event, url) {
  const key = url.origin + url.pathname;
  let cached = null;
  try {
    cached = await (await caches.open(CACHE)).match(key);
  } catch { /* storage unavailable: just use the network */ }

  const network = (async () => (await event.preloadResponse) || (await fetch(event.request)))();
  event.waitUntil(network.then((res) => (cacheable(res) ? store(key, res.clone()) : null)).catch(() => {}));

  try {
    const res = cached ? await withTimeout(network, NAV_TIMEOUT) : await network;
    return res.status >= 500 && cached ? cached : res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

// JS / CSS / manifest: network first (so deploys show up immediately), cache as a safety net.
async function networkFirst(event) {
  const { request } = event;
  const network = fetch(request);
  event.waitUntil(network.then((res) => (cacheable(res) ? store(request, res.clone()) : null)).catch(() => {}));

  let cached = null;
  try {
    cached = await (await caches.open(CACHE)).match(request);
  } catch { /* storage unavailable */ }

  try {
    return cached ? await withTimeout(network, ASSET_TIMEOUT) : await network;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

// Images / fonts: cache first (they rarely change).
async function cacheFirst(event) {
  const { request } = event;
  try {
    const cached = await (await caches.open(CACHE)).match(request);
    if (cached) return cached;
  } catch { /* storage unavailable */ }
  const res = await fetch(request);
  if (cacheable(res)) event.waitUntil(store(request, res.clone()).catch(() => {}));
  return res;
}

/* ───────── routing ───────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;         // API Worker, ads, analytics: untouched
  if (url.pathname === "/service-worker.js" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    if (CACHE_PAGES && isShellPage(url)) event.respondWith(navigate(event, url));
    return;                                                // otherwise the browser handles the page itself
  }

  switch (request.destination) {
    case "script":
    case "style":
    case "manifest":
      return event.respondWith(networkFirst(event));
    case "image":
    case "font":
      return event.respondWith(cacheFirst(event));
    // Everything else (fetch / XHR / htmx) is left to the browser untouched
  }
});