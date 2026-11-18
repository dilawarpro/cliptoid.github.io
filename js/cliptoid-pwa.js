"use strict";

// Change this on every deployment that should trigger an app update.
// Ideally inject a build ID automatically.
const BUILD = "2026-07-19-1";

const CACHE_PREFIX = "cliptoid-assets-";
const IMMUTABLE_CACHE = `${CACHE_PREFIX}immutable-${BUILD}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${BUILD}`;

const ACTIVE_CACHES = new Set([IMMUTABLE_CACHE, RUNTIME_CACHE]);

const MAX_IMMUTABLE_ENTRIES = 80;
const MAX_RUNTIME_ENTRIES = 40;

/*
 * Only PUBLIC, non-personalized static files belong here.
 *
 * Unversioned files use stale-while-revalidate:
 * cached response immediately, background refresh for the next request.
 *
 * Replace these examples with your actual paths.
 */
const PUBLIC_ASSETS = new Set([
  // "/css/site.css",
  // "/js/site.js",
  // "/images/logo.webp",
]);

/*
 * Recognizes fingerprinted assets in public /assets/ and /static/ folders:
 * /assets/app.a13f29cd.js
 * /static/styles-91ab32ef.css
 *
 * Adjust this to your build system. Never reuse a fingerprinted URL for
 * different content, and never put private/user-specific files here.
 */
const FINGERPRINTED_ASSET =
  /^\/(?:assets|static)\/.+[.-][a-f0-9]{8,}\.(?:js|mjs|css|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf)$/i;

const STATIC_DESTINATIONS = new Set([
  "script",
  "style",
  "image",
  "font",
]);

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cliptoid — Offline</title>
</head>
<body>
  <main>
    <h1>You’re offline</h1>
    <p>Reconnect to load this page. Previously cached app assets remain available.</p>
    <p><a href="">Try again</a></p>
  </main>
</body>
</html>`;

// Serialize writes so trimming does not race with other writes.
let writeQueue = Promise.resolve();

function mayCache(response) {
  if (
    !response ||
    response.status !== 200 ||
    response.type !== "basic" ||
    response.redirected
  ) {
    return false;
  }

  const cacheControl = response.headers.get("Cache-Control") || "";
  const vary = response.headers.get("Vary") || "";

  // Cache Storage does not enforce these headers automatically.
  if (/\b(?:private|no-store|no-cache)\b/i.test(cacheControl)) return false;
  if (/(?:^|,)\s*(?:\*|cookie|authorization)\s*(?:,|$)/i.test(vary)) {
    return false;
  }

  return true;
}

function writeCache(cacheName, request, response, maximumEntries) {
  if (!mayCache(response)) return Promise.resolve();

  const copy = response.clone();

  const operation = writeQueue.then(async () => {
    const cache = await caches.open(cacheName);
    await cache.put(request, copy);

    // Bounded insertion-order eviction, not a full LRU implementation.
    const keys = await cache.keys();
    const excess = keys.length - maximumEntries;

    if (excess > 0) {
      await Promise.all(
        keys.slice(0, excess).map((key) => cache.delete(key))
      );
    }
  });

  // Storage failures must not break successful network responses.
  writeQueue = operation.catch(() => {});
  return writeQueue;
}

async function readCache(cacheName, request) {
  try {
    const cache = await caches.open(cacheName);
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

async function fetchAndStore(cacheName, request, maximumEntries) {
  const response = await fetch(request);

  // Return the network response without waiting for the disk write.
  const stored = writeCache(
    cacheName,
    request,
    response,
    maximumEntries
  );

  return { response, stored };
}

function cacheFirst(event) {
  const result = (async () => {
    const cached = await readCache(IMMUTABLE_CACHE, event.request);

    if (cached) {
      return { response: cached, stored: Promise.resolve() };
    }

    return fetchAndStore(
      IMMUTABLE_CACHE,
      event.request,
      MAX_IMMUTABLE_ENTRIES
    );
  })();

  event.respondWith(result.then(({ response }) => response));

  // Register lifetime extension synchronously during the fetch event.
  event.waitUntil(
    result.then(({ stored }) => stored).catch(() => {})
  );
}

function staleWhileRevalidate(event) {
  const cached = readCache(RUNTIME_CACHE, event.request);

  // Only one network request is started for this fetch event.
  const network = fetchAndStore(
    RUNTIME_CACHE,
    event.request,
    MAX_RUNTIME_ENTRIES
  );

  event.respondWith(
    cached.then(async (response) => {
      if (response) return response;
      return (await network).response;
    })
  );

  event.waitUntil(
    network.then(({ stored }) => stored).catch(() => {})
  );
}

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    statusText: "Service Unavailable",
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

async function navigationResponse(event) {
  try {
    // Navigation preload starts the request while the worker boots.
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;

    return await fetch(event.request);
  } catch {
    return offlineResponse();
  }
}

self.addEventListener("install", () => {
  // Intentionally no automatic skipWaiting().
  // New versions wait for explicit user approval or all old tabs to close.
  //
  // Assets are cached on demand, avoiding a large install-time download.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();

      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(CACHE_PREFIX) &&
              !ACTIVE_CACHES.has(name)
          )
          .map((name) => caches.delete(name))
      );

      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {});
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Never cache mutations or requests with explicit authorization.
  if (request.method !== "GET") return;
  if (request.headers.has("Authorization")) return;
  if (request.headers.has("Range")) return;

  // HTMX responses may be fragments rather than complete documents.
  if (request.headers.has("HX-Request")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML is not persisted, avoiding stale/private page-cache problems.
  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(event));
    return;
  }

  // Respect explicit reload, revalidation, and no-store request modes.
  if (request.cache !== "default") return;

  // A fetch() API request should not accidentally become a static asset.
  if (!STATIC_DESTINATIONS.has(request.destination)) return;

  if (FINGERPRINTED_ASSET.test(url.pathname) && !url.search) {
    cacheFirst(event);
    return;
  }

  // Query strings are significant. Do not ignore them when matching.
  if (PUBLIC_ASSETS.has(url.pathname + url.search)) {
    staleWhileRevalidate(event);
  }

  // Everything else uses the browser's normal network/HTTP-cache behavior.
});