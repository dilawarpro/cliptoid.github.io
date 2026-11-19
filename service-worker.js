/**
 * Cliptoid service worker (v59), fast + lightweight
 *
 * Strategy
 *  - Page navigations: never touched by default (CACHE_PAGES = false), so this worker can't
 *    slow down or break opening the site. Chromium also skips waking the worker for them.
 *  - Versioned static files (?v=... or .v_xxx. in the name): CACHE-FIRST -> instant, no network wait.
 *  - Unversioned JS/CSS/manifest: STALE-WHILE-REVALIDATE -> instant from cache, refreshed in background.
 *  - Images/fonts: CACHE-FIRST in a separate long-lived cache that is NOT wiped on deploy.
 *  - Every network wait has a timeout, so nothing can hang on a loading screen.
 *  - Cross-origin requests (Cloudflare Worker API, ads, analytics) and /api/ are never touched.
 *
 * Deploy: bump VERSION. Only the static cache is replaced; media is kept.
 */

const VERSION = "v59";
const STATIC = `cliptoid-static-${VERSION}`;   // JS / CSS / manifest (replaced on deploy)
const MEDIA = "cliptoid-media-v1";             // images / fonts (kept across deploys)

const CACHE_PAGES = false;                     // true = also keep copies of main pages
const NAV_TIMEOUT = 3500;                      // ms, only when CACHE_PAGES = true
const FETCH_TIMEOUT = 8000;                    // ms, hard limit for any network wait
const MEDIA_LIMIT = 120;                       // max entries in the media cache
const PAGE_LIMIT = 20;                         // max cached pages (CACHE_PAGES = true)

// IMPORTANT: use the EXACT same URLs (including ?v=...) that your HTML uses.
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
  "/", "/index.html", "/tiktok-caption.html", "/about.html", "/contacts.html",
  "/privacy.html", "/cookie-policy.html", "/terms.html", "/disclaimer.html",
  "/copyright.html", "/sitemap.html",
];
const SHELL_PATHS = new Set([...SHELL_ASSETS, ...SHELL_PAGES]);

/* ───────── helpers ───────── */
const isVersioned = (url) =>
  url.searchParams.has("v") || /\.v_[\w-]+\./.test(url.pathname);

const cacheable = (res) =>
  res && res.status === 200 && res.type === "basic" && !res.redirected &&
  !/no-store/i.test(res.headers.get("Cache-Control") || "");

// fetch with a real timeout (aborts the request, doesn't just stop waiting for it)
function timedFetch(request, ms = FETCH_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// A redirected response can't be served to a navigation, so re-wrap it.
async function clean(res) {
  const headers = new Headers(res.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

// Same ETag / Last-Modified => no need to rewrite the cache entry.
const unchanged = (a, b) => {
  if (!a || !b) return false;
  const ea = a.headers.get("ETag"), eb = b.headers.get("ETag");
  if (ea && eb) return ea === eb;
  const la = a.headers.get("Last-Modified"), lb = b.headers.get("Last-Modified");
  return !!(la && lb && la === lb);
};

// Oldest-first trim; only runs occasionally so it never slows normal requests.
let putCount = 0;
async function trim(cacheName, limit, keep = null) {
  const cache = await caches.open(cacheName);
  let keys = await cache.keys();
  if (keep) keys = keys.filter((r) => !keep.has(new URL(r.url).pathname));
  const extra = keys.length - limit;
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((r) => cache.delete(r)));
}

async function put(cacheName, request, response, limit, keep) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  if (limit && ++putCount % 10 === 0) await trim(cacheName, limit, keep);
}

const isShellPage = (url) =>
  url.pathname === "/" || SHELL_PATHS.has(url.pathname) || SHELL_PATHS.has(`${url.pathname}.html`);

/* ───────── lifecycle ───────── */
self.addEventListener("install", (event) => {
  // No automatic skipWaiting(): the new version waits until the user taps "Update"
  // (cliptoid-pwa.js sends SKIP_WAITING). This prevents old HTML running new JS.

  event.waitUntil((async () => {
    // Chromium only: navigations go straight to the network without waking this worker.
    if (!CACHE_PAGES && typeof event.addRoutes === "function") {
      try { await event.addRoutes({ condition: { requestMode: "navigate" }, source: "network" }); } catch { /* optional */ }
    }

    const list = CACHE_PAGES ? [...SHELL_ASSETS, ...SHELL_PAGES] : SHELL_ASSETS;
    const staticCache = await caches.open(STATIC);
    const mediaCache = await caches.open(MEDIA);

    // Fault tolerant: one missing file never breaks installation.
    await Promise.allSettled(list.map(async (path) => {
      const isMedia = /\.(png|jpe?g|webp|avif|gif|svg|ico|woff2?)$/i.test(path);
      const target = isMedia ? mediaCache : staticCache;

      // Media is kept across deploys, so don't download it again if already stored.
      if (isMedia && (await target.match(path))) return;

      const res = await timedFetch(new Request(path, { cache: "reload" }));
      if (!res.ok) throw new Error(`${path} → ${res.status}`);
      await target.put(path, res.redirected ? await clean(res) : res);
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Remove old static caches (including the legacy "cliptoid-vNN" ones); keep MEDIA.
    const old = (await caches.keys()).filter(
      (k) => k.startsWith("cliptoid-") && k !== STATIC && k !== MEDIA
    );
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

// Versioned file or image/font: cache first, network only on a miss (with timeout).
async function cacheFirst(event, cacheName, limit) {
  const { request } = event;
  let cache = null;
  try {
    cache = await caches.open(cacheName);
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch { /* storage unavailable: use network */ }

  const res = await timedFetch(request);
  if (cache && cacheable(res)) {
    event.waitUntil(put(cacheName, request, res.clone(), limit).catch(() => {}));
  }
  return res;
}

// Unversioned JS/CSS/manifest: answer instantly from cache, refresh in the background.
async function staleWhileRevalidate(event) {
  const { request } = event;
  let cache = null, hit = null;
  try {
    cache = await caches.open(STATIC);
    hit = await cache.match(request);
  } catch { /* storage unavailable */ }

  const refresh = timedFetch(request)
    .then(async (res) => {
      if (cache && cacheable(res) && !unchanged(hit, res)) await cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  if (hit) {
    event.waitUntil(refresh);          // update quietly for next time
    return hit;                        // respond immediately
  }

  const res = await refresh;           // no cached copy: wait (bounded by the timeout)
  return res || Response.error();
}

// Pages (only when CACHE_PAGES = true): network first, cached copy if slow, down or 5xx.
async function navigate(event, url) {
  const key = url.origin + url.pathname;
  let cached = null;
  try { cached = await (await caches.open(STATIC)).match(key); } catch { /* ignore */ }

  const network = (async () => (await event.preloadResponse) || (await fetch(event.request)))();
  event.waitUntil(
    network
      .then((res) => (cacheable(res) ? put(STATIC, key, res.clone(), PAGE_LIMIT + SHELL_ASSETS.length, SHELL_PATHS) : null))
      .catch(() => {})
  );

  try {
    const res = cached
      ? await Promise.race([
          network,
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), NAV_TIMEOUT)),
        ])
      : await network;
    return res.status >= 500 && cached ? cached : res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

/* ───────── routing ───────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;          // API Worker, ads, analytics: untouched
  if (url.pathname === "/service-worker.js" || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    if (CACHE_PAGES && isShellPage(url)) event.respondWith(navigate(event, url));
    return;                                                 // otherwise the browser loads the page itself
  }

  switch (request.destination) {
    case "script":
    case "style":
    case "manifest":
      return event.respondWith(
        isVersioned(url) ? cacheFirst(event, STATIC) : staleWhileRevalidate(event)
      );
    case "image":
    case "font":
      return event.respondWith(cacheFirst(event, MEDIA, MEDIA_LIMIT));
    // fetch / XHR / htmx: left to the browser untouched
  }
});