/**
 * Cliptoid service worker (v60), fast + lightweight + fail-safe
 *
 * Strategy
 *  - Page navigations: never touched by default (CACHE_PAGES = false), so this worker can't
 *    slow down or break opening the site. Chromium also skips waking the worker for them.
 *  - Versioned static files (?v=... or .v_xxx. in the name): CACHE-FIRST -> instant, no network wait.
 *  - Unversioned JS/CSS/manifest: STALE-WHILE-REVALIDATE -> instant from cache, revalidated in the
 *    background at most once per SWR_MAX_AGE (conditional request, Cloudflare/ETag friendly).
 *  - Images/fonts: CACHE-FIRST in a separate long-lived cache that is NOT wiped on deploy,
 *    refreshed in the background once an entry is older than MEDIA_MAX_AGE.
 *  - Never caches HTML/error pages under a JS/CSS/image URL, never caches no-store or redirects.
 *  - Cross-origin requests (Cloudflare Worker API, ads, analytics), /api/ and /cdn-cgi/ are never touched.
 *  - A slow/failed network can never abort a legitimate first download of a file.
 *
 * Deploy: bump VERSION. Only the static cache is replaced; media is kept.
 */
"use strict";

const VERSION = "v60";
const STATIC = `cliptoid-static-${VERSION}`;   // JS / CSS / manifest (replaced on deploy)
const MEDIA = "cliptoid-media-v1";             // images / fonts (kept across deploys)

const CACHE_PAGES = false;                     // true = also keep copies of main pages
const NAV_TIMEOUT = 3500;                      // ms, only when CACHE_PAGES = true
const FETCH_TIMEOUT = 8000;                    // ms, limit for BACKGROUND refreshes / precache
const MEDIA_LIMIT = 120;                       // max entries in the media cache
const PAGE_LIMIT = 20;                         // max cached pages (CACHE_PAGES = true)
const MAX_MEDIA_BYTES = 1.5 * 1024 * 1024;     // larger images are left to the browser cache
const SWR_MAX_AGE = 5 * 60 * 1000;             // don't revalidate unversioned files more often than this
const MEDIA_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // refresh cached images/fonts after 7 days
const STAMP = "x-sw-time";                     // when WE stored the entry (Date header is unreliable behind a CDN)

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

const MEDIA_RE = /\.(png|jpe?g|webp|avif|gif|svg|ico|woff2?)$/i;

/* ───────── helpers ───────── */
const isVersioned = (url) =>
  url.searchParams.has("v") || /\.v_[\w-]+\./.test(url.pathname);

// Is this response safe to store? (200, not no-store, and not an HTML page posing as an asset)
function valid(res, allowHtml = false, maxBytes = 0) {
  if (!res || res.status !== 200) return false;
  if (/no-store/i.test(res.headers.get("Cache-Control") || "")) return false;
  if (!allowHtml && /text\/html/i.test(res.headers.get("Content-Type") || "")) return false;
  if (maxBytes && Number(res.headers.get("Content-Length")) > maxBytes) return false;
  return true;
}
const cacheable = (res, allowHtml, maxBytes) =>
  valid(res, allowHtml, maxBytes) && res.type === "basic" && !res.redirected;

// fetch with a real timeout (aborts the request). ms = 0 means no timeout.
function timedFetch(input, init = {}, ms = FETCH_TIMEOUT) {
  if (!ms) return fetch(input, init);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// A redirected response can't be served to a navigation, so re-wrap it.
async function clean(res) {
  const headers = new Headers(res.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

// Copy of a response with our timestamp. Streams the body (no big buffers on low-memory phones).
// Content-Encoding/Length are dropped because the body is already decoded; Vary is dropped so
// `Vary: *` can never make cache.put() throw (lookups use ignoreVary).
function stamp(res) {
  const headers = new Headers(res.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.delete("Vary");
  headers.set(STAMP, String(Date.now()));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
const ageOf = (res) => {
  const t = Number(res.headers.get(STAMP));
  return t ? Date.now() - t : Infinity;      // unknown age (older entries) = treat as stale
};

// Cache reads never throw: if storage is unavailable we simply behave like there is no cache.
async function lookup(cacheName, request, loose = false) {
  try {
    const cache = await caches.open(cacheName);
    return (await cache.match(request, { ignoreVary: true, ignoreSearch: loose })) || null;
  } catch { return null; }
}

// Oldest-first trim (Cache.keys() is in insertion order).
async function trim(cacheName, limit, keep = null) {
  const cache = await caches.open(cacheName);
  let keys = await cache.keys();
  if (keep) keys = keys.filter((r) => !keep.has(new URL(r.url).pathname));
  const extra = keys.length - limit;
  if (extra > 0) await Promise.all(keys.slice(0, extra).map((r) => cache.delete(r)));
}

// Storage full? Media is always re-downloadable, so drop the older half of it.
async function freeSpace() {
  try {
    const cache = await caches.open(MEDIA);
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.ceil(keys.length / 2)).map((r) => cache.delete(r)));
  } catch { /* nothing more we can do */ }
}

// Never throws. On a quota error it frees space (the next request caches normally). Trim is
// stateless (random 1-in-8) because Android kills idle workers, which would reset a counter.
async function put(cacheName, key, response, limit = 0, keep = null) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(key, response);
    if (limit && Math.random() < 0.125) await trim(cacheName, limit, keep);
  } catch (err) {
    if (err && err.name === "QuotaExceededError") await freeSpace();
    // any other error: skip caching, never break the page
  }
}

const isShellPage = (url) =>
  url.pathname === "/" || SHELL_PATHS.has(url.pathname) || SHELL_PATHS.has(`${url.pathname}.html`);

/* ───────── lifecycle ───────── */
self.addEventListener("install", (event) => {
  // No automatic skipWaiting(): the new version waits until the user taps "Update"
  // (cliptoid-pwa.js sends SKIP_WAITING). This prevents old HTML running new JS.

  // Chromium only: navigations go straight to the network without waking this worker.
  // Registered synchronously, as early as possible in the install event.
  let routes = Promise.resolve();
  if (!CACHE_PAGES && typeof event.addRoutes === "function") {
    try {
      routes = Promise.resolve(event.addRoutes({ condition: { requestMode: "navigate" }, source: "network" }))
        .catch(() => {});
    } catch { /* optional */ }
  }

  event.waitUntil((async () => {
    await routes;
    const list = CACHE_PAGES ? [...SHELL_ASSETS, ...SHELL_PAGES] : SHELL_ASSETS;

    // Fault tolerant: one missing file never breaks installation.
    await Promise.allSettled(list.map(async (path) => {
      const isMedia = MEDIA_RE.test(path);
      const target = isMedia ? MEDIA : STATIC;
      const isPage = SHELL_PAGES.includes(path);

      // Media is kept across deploys, so don't download it again if already stored.
      if (isMedia && (await lookup(MEDIA, path))) return;

      let res = await timedFetch(path, { cache: "reload" });
      if (res.redirected) res = await clean(res);
      if (!valid(res, isPage, isMedia ? MAX_MEDIA_BYTES : 0)) throw new Error(`${path} -> ${res.status}`);
      await put(target, path, stamp(res), isMedia ? MEDIA_LIMIT : 0);
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
    await trim(MEDIA, MEDIA_LIMIT).catch(() => {});   // housekeeping after the important work
  })());
});

self.addEventListener("message", (event) => {
  const type = event.data?.type || event.data;
  if (type === "SKIP_WAITING") self.skipWaiting();
  else if (type === "GET_VERSION") event.source?.postMessage({ type: "VERSION", version: VERSION });
});

/* ───────── strategies ─────────
 * Every strategy gets `track(promise)` for background work. The fetch handler registers
 * event.waitUntil() synchronously, so background writes/refreshes are never "late". */

const inflight = new Set();                       // avoid duplicate background refreshes of one URL

// Conditional re-download in the background. `no-cache` = revalidate with ETag/Last-Modified,
// so a long Cloudflare/browser max-age can't keep serving the same stale copy.
async function refresh(request, cacheName, limit, maxBytes) {
  const key = request.url;
  if (inflight.has(key)) return;
  inflight.add(key);
  try {
    const res = await timedFetch(key, { cache: "no-cache", credentials: "same-origin" });
    if (cacheable(res, false, maxBytes)) await put(cacheName, request, stamp(res), limit);
  } catch { /* offline / slow: keep the copy we have */ }
  finally { inflight.delete(key); }
}

// No cached copy: get it from the network and store it. A first download is never aborted
// by a timer (slow mobile networks); a loose cached copy is only used if the network FAILS.
async function fetchAndStore(request, track, cacheName, limit, maxBytes) {
  const fallback = cacheName === STATIC ? await lookup(STATIC, request, true) : null;
  try {
    const res = await timedFetch(request, {}, fallback ? 6000 : 0);
    if (cacheable(res, false, maxBytes)) track(put(cacheName, request, stamp(res.clone()), limit));
    return res;
  } catch (err) {
    if (fallback) return fallback;               // e.g. same file, previous ?v= -> better than a white screen
    throw err;
  }
}

// Versioned file or image/font: cache first, network only on a miss.
async function cacheFirst(request, track, cacheName, limit = 0) {
  const hit = await lookup(cacheName, request);
  if (hit) {
    if (cacheName === MEDIA && ageOf(hit) > MEDIA_MAX_AGE) track(refresh(request, MEDIA, limit, MAX_MEDIA_BYTES));
    return hit;
  }
  return fetchAndStore(request, track, cacheName, limit, cacheName === MEDIA ? MAX_MEDIA_BYTES : 0);
}

// Unversioned JS/CSS/manifest: answer instantly from cache, refresh quietly when it is old.
async function staleWhileRevalidate(request, track) {
  const hit = await lookup(STATIC, request);
  if (hit) {
    if (ageOf(hit) > SWR_MAX_AGE) track(refresh(request, STATIC, 0, 0));
    return hit;
  }
  return fetchAndStore(request, track, STATIC, 0, 0);
}

// Pages (only when CACHE_PAGES = true): network first, cached copy if slow, down or 5xx.
async function navigate(event, url, track) {
  const key = url.origin + url.pathname;
  const network = (async () => (await event.preloadResponse) || (await fetch(event.request)))();
  track(network.then((res) =>
    cacheable(res, true)
      ? put(STATIC, key, stamp(res.clone()), PAGE_LIMIT + SHELL_ASSETS.length, SHELL_PATHS)
      : null));

  const cached = await lookup(STATIC, key);
  let timer;
  try {
    const res = cached
      ? await Promise.race([
          network,
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), NAV_TIMEOUT); }),
        ])
      : await network;
    return res.status >= 500 && cached ? cached : res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  } finally { clearTimeout(timer); }
}

/* ───────── routing ───────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("range")) return;
  // Chrome DevTools quirk: only-if-cached is only legal for same-origin mode.
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;          // API Worker, ads, analytics: untouched
  if (url.pathname === "/service-worker.js" ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/cdn-cgi/")) return;         // Cloudflare internals must never be cached

  let run = null;
  if (request.mode === "navigate") {
    if (CACHE_PAGES && isShellPage(url)) run = (track) => navigate(event, url, track);
  } else {
    switch (request.destination) {
      case "script":
      case "style":
      case "manifest":
        run = (track) => isVersioned(url)
          ? cacheFirst(request, track, STATIC)
          : staleWhileRevalidate(request, track);
        break;
      case "image":
      case "font":
        run = (track) => cacheFirst(request, track, MEDIA, MEDIA_LIMIT);
        break;
      // fetch / XHR / htmx: left to the browser untouched
    }
  }
  if (!run) return;                                         // the browser loads it itself

  const tasks = [];
  const track = (p) => { tasks.push(Promise.resolve(p).catch(() => {})); };
  const response = run(track);
  event.respondWith(response);
  // Registered synchronously, in the same tick as respondWith: never late.
  event.waitUntil(response.then(() => Promise.all(tasks), () => Promise.all(tasks)));
});