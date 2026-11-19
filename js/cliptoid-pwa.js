(() => {
  "use strict";

  /* ───────────── Config ───────────── */
  const CFG = {
    swUrl: "/service-worker.js",
    updateCheckMs: 15 * 60 * 1000,
    minUpdateGapMs: 60 * 1000,
    firstVisitDelayMs: 5000,      // first visit: delay worker registration so it never competes with the page
    errorEndpoint: null,          // e.g. "/api/client-errors" (sendBeacon)
    maxErrorReports: 5,
    installSelector: "#dwapp_image, #cliptoid-install-result",
    inputSelector: "#main_page_text",
    pendingKey: "cliptoid.pendingUpdateInput",
    // Set to your Cloudflare Worker origin, e.g. "https://api.cliptoid.com".
    // The connection (DNS + TLS) is opened as soon as the user touches the input,
    // so the first download request starts ~100-300 ms faster.
    apiOrigin: null,
    maxPrefetch: 8,               // max pages prefetched per visit
    maxMemCache: 100,             // max entries kept by smartFetch
    maxReloadWaits: 15,           // update reload waits at most ~15 s for a busy request
    healKey: "cliptoid.lastHeal",
    healWindowMs: 30 * 60 * 1000, // self-heal at most once per 30 min, so it can never loop
    storageWarnRatio: 0.8,        // ask the worker to trim caches above 80% of the storage quota
  };

  const onReady = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  const idle = (fn) =>
    "requestIdleCallback" in window
      ? requestIdleCallback(fn, { timeout: 3000 })
      : setTimeout(fn, 1);

  const isStandalone = () =>
    matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  // Low-memory / low-core phones: smaller in-memory cache and no speculative prefetching.
  const lowEnd =
    (navigator.deviceMemory > 0 && navigator.deviceMemory <= 2) ||
    (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2);
  if (lowEnd) CFG.maxMemCache = 30;

  // localStorage can throw (private mode, blocked, full): never let that break anything.
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  /* ───────────── Error reporting (deduped, capped) ───────────── */
  const seenErrors = new Set();
  const report = (context, err) => {
    const message = String(err?.message || err);
    const key = `${context}:${message}`;
    if (seenErrors.has(key) || seenErrors.size >= CFG.maxErrorReports) return;
    seenErrors.add(key);
    console.error(`[Cliptoid] ${context}:`, err);
    if (CFG.errorEndpoint && navigator.sendBeacon) {
      navigator.sendBeacon(
        CFG.errorEndpoint,
        JSON.stringify({ context, message, url: location.href })
      );
    }
  };
  addEventListener("error", (e) => report("window.error", e.error || e.message));
  addEventListener("unhandledrejection", (e) => report("unhandledrejection", e.reason));

  /* ───────────── Toast helper (accessible, one at a time) ───────────── */
  let toast, toastTimer, sticky = null;   // sticky = last toast that needs a tap (update / reload)
  const notify = (message, opts = {}) => {
    const { actionLabel, onAction, timeout = 4000 } = opts;
    if (!timeout && actionLabel && onAction) sticky = { message, opts };
    if (!toast) {
      toast = document.createElement("div");
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.style.cssText =
        "position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:9999;" +
        "max-width:90vw;padding:.75rem 1rem;border-radius:.5rem;background:#222;color:#fff;" +
        "font:14px/1.4 system-ui,sans-serif;align-items:center;gap:.75rem;" +
        "box-shadow:0 4px 16px rgba(0,0,0,.3);display:none";
      document.body.append(toast);
    }
    clearTimeout(toastTimer);
    toast.replaceChildren(document.createTextNode(message));
    if (actionLabel && onAction) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = actionLabel;
      btn.style.cssText = "cursor:pointer;border:0;border-radius:.25rem;padding:.35rem .7rem;font:inherit;font-weight:600";
      btn.addEventListener("click", () => {
        if (sticky && sticky.message === message) sticky = null;
        toast.style.display = "none";
        onAction();
      }, { once: true });
      toast.append(btn);
    }
    toast.style.display = "flex";
    if (timeout) {
      toastTimer = setTimeout(() => {
        toast.style.display = "none";
        // A short message must never permanently hide "A new version is ready" etc.
        if (sticky && sticky.message !== message) notify(sticky.message, sticky.opts);
      }, timeout);
    }
  };

  /* ───────────── smartFetch: TTL cache + stale-while-revalidate + dedupe + retry + timeout ───────────── */
  const memCache = new Map();
  const inflight = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const remember = (key, data) => {
    memCache.delete(key);                              // re-insert = most recent
    memCache.set(key, { data, time: Date.now() });
    if (memCache.size > CFG.maxMemCache) memCache.delete(memCache.keys().next().value); // drop oldest
  };

  // Every error carries .kind: "offline" | "timeout" | "network" | "http" | "parse" | "aborted"
  // (plus .status for "http"), so the UI can show the right message instead of a generic one.
  const tag = (e, kind, extra) => Object.assign(e instanceof Error || e instanceof DOMException ? e : new Error(String(e)), { kind }, extra);

  async function fetchWithRetry(url, { retries, timeout, parse, init, signal }) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) throw tag(new DOMException("Aborted", "AbortError"), "aborted", { fatal: true });
      if (navigator.onLine === false) throw tag(new Error("You're offline"), "offline", { fatal: true });  // fail instantly, don't wait 2 x timeout

      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);
      let wait = 2 ** attempt * 300 + Math.random() * 200;               // backoff + jitter
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        if (res.ok) {
          try {
            return await res[parse]();
          } catch (e) {
            // A malformed body won't fix itself on retry; a timeout while reading will.
            if (e.name === "AbortError") throw e;
            throw tag(e, "parse", { fatal: true });
          }
        }
        const err = tag(new Error(`HTTP ${res.status}`), "http", { status: res.status });
        // Only retry transient failures
        if (res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
        const ra = Number(res.headers?.get?.("Retry-After"));
        if (ra > 0) wait = Math.min(ra * 1000, 5000);                    // respect the server, capped
        lastErr = err;
      } catch (e) {
        if (signal?.aborted) throw tag(e, "aborted", { fatal: true });
        if (e.fatal) throw e;
        lastErr = timedOut ? tag(e, "timeout") : e.kind ? e : tag(e, "network");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
      if (attempt < retries) await sleep(wait);
    }
    throw lastErr;
  }

  const smartFetch = async (url, opts = {}) => {
    const {
      ttl = 60_000,          // fresh window
      staleTtl = 600_000,    // serve stale + revalidate within this window
      retries = 1,           // worst case ≈ 2 × timeout, never an endless spinner
      timeout = 7000,
      parse = "json",
      init = {},
      force = false,
      signal,                // optional AbortSignal, e.g. cancel when the user starts a new download
    } = opts;
    const key = `${init.method || "GET"}:${url}`;
    const hit = memCache.get(key);
    const age = hit ? Date.now() - hit.time : Infinity;

    const refresh = () => {
      if (!signal && inflight.has(key)) return inflight.get(key);   // dedupe concurrent calls
      const p = fetchWithRetry(url, { retries, timeout, parse, init, signal })
        .then((data) => { remember(key, data); return data; })      // only successes are cached
        .finally(() => { if (!signal) inflight.delete(key); });
      if (!signal) inflight.set(key, p);
      return p;
    };

    if (!force && hit && age < ttl) return hit.data;
    if (!force && hit && age < staleTtl) { refresh().catch(() => {}); return hit.data; }
    try {
      return await refresh();
    } catch (err) {
      if (hit && err.kind !== "aborted") return hit.data;           // graceful degradation: stale data beats an error
      throw err;
    }
  };

  /* ───────────── Warm the API connection when the user is about to use it ───────────── */
  if (CFG.apiOrigin) {
    let warmed = false;
    const warm = () => {
      if (warmed) return;
      warmed = true;
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = CFG.apiOrigin;
      link.crossOrigin = "anonymous";
      document.head.append(link);
    };
    onReady(() => {
      const input = document.querySelector(CFG.inputSelector);
      if (!input) return;
      ["focus", "pointerdown", "input", "paste"].forEach((t) =>
        input.addEventListener(t, warm, { once: true, passive: true })
      );
    });
  }

  /* ───────────── Navigation menu ───────────── */
  onReady(() => {
    const toggle = document.querySelector("#menu_toggler");
    const wrapper = toggle?.closest(".menu-wrapper");
    const nav = document.querySelector(".cliptoid-primary-nav");
    if (!toggle || !wrapper || !nav) return;

    toggle.setAttribute("aria-label", "Toggle main navigation");
    if (nav.id) toggle.setAttribute("aria-controls", nav.id);
    toggle.setAttribute("aria-expanded", "false");

    const setOpen = (open) => {
      toggle.checked = open;
      toggle.setAttribute("aria-expanded", String(open));
      wrapper.classList.toggle("cliptoid-nav-open", open);
    };
    toggle.addEventListener("change", () => setOpen(toggle.checked));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && toggle.checked) { setOpen(false); toggle.focus(); }
    });
    document.addEventListener("click", (e) => {
      if (!toggle.checked || !(e.target instanceof Element)) return;
      if (e.target.closest("a") && nav.contains(e.target)) setOpen(false);
      else if (!wrapper.contains(e.target)) setOpen(false);
    });
  });

  /* ───────────── PWA install ───────────── */
  let installPrompt = null;
  const installButtons = () => [...document.querySelectorAll(CFG.installSelector)];
  const hideInstallButtons = () => installButtons().forEach((b) => { b.hidden = true; });

  onReady(() => { if (isStandalone()) hideInstallButtons(); });

  addEventListener("beforeinstallprompt", (e) => {
    // The event can fire before the DOM is parsed, so only bail out once buttons can be known.
    if (document.readyState !== "loading" && !installButtons().length) return;
    e.preventDefault();
    installPrompt = e;
  });
  addEventListener("appinstalled", () => { installPrompt = null; hideInstallButtons(); });

  document.addEventListener("click", async (e) => {
    if (!(e.target instanceof Element) || !e.target.closest(CFG.installSelector)) return;
    e.preventDefault();

    if (installPrompt) {
      const promptEvent = installPrompt;
      installPrompt = null;                       // prompt() is single-use
      try {
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === "accepted") hideInstallButtons();
      } catch (err) {
        report("install", err);
        notify("Couldn't start installation. Try your browser menu instead.");
      }
      return;
    }
    if (isStandalone()) return notify("Cliptoid is already installed on this device.");
    if (/iphone|ipad|ipod/i.test(navigator.userAgent))
      return notify("Tap Share, then “Add to Home Screen”.", { timeout: 6000 });
    notify("Use your browser menu → “Install app” or “Add to Home Screen”.", { timeout: 6000 });
  });

  /* ───────────── Link prefetch on intent (faster navigations, no markup changes) ───────────── */
  const conn = navigator.connection;
  const canPrefetch = !(lowEnd || conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType || ""));
  if (canPrefetch) {
    const done = new Set();
    let hoverTimer;
    const prefetch = (a) => {
      if (done.size >= CFG.maxPrefetch || document.hidden) return;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || "noPrefetch" in a.dataset) return;
      let url;
      try { url = new URL(a.href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page / #hash
      if (done.has(url.href)) return;
      done.add(url.href);
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "document";
      link.href = url.href;
      document.head.append(link);
    };
    const linkFrom = (e) => (e.target instanceof Element ? e.target.closest("a[href]") : null);
    document.addEventListener("pointerover", (e) => {
      if (e.pointerType === "touch") return;
      const a = linkFrom(e);
      if (a) hoverTimer = setTimeout(() => prefetch(a), 65);
    }, { passive: true });
    document.addEventListener("pointerout", () => clearTimeout(hoverTimer), { passive: true });
    document.addEventListener("pointerdown", (e) => prefetch(linkFrom(e)), { passive: true }); // mouse + touch, ~100 ms before click
  }

  /* ───────────── htmx friendly errors ───────────── */
  document.addEventListener("htmx:sendError", () =>
    notify(navigator.onLine ? "Couldn't reach the server. Please try again." : "You're offline. Reconnect and try again."));
  document.addEventListener("htmx:timeout", () => notify("The request timed out. Please try again."));
  document.addEventListener("htmx:responseError", (e) => {
    const s = e.detail?.xhr?.status;
    notify(s === 429 ? "Too many requests. Please wait a moment." :
           s >= 500 ? "Server hiccup. Please try again shortly." :
           "Something went wrong with that request.");
  });

  /* ───────────── Preserve input across updates ───────────── */
  const saveInput = () => {
    const input = document.querySelector(CFG.inputSelector);
    if (input?.value) try { sessionStorage.setItem(CFG.pendingKey, input.value); } catch {}
  };
  onReady(() => {
    try {
      const saved = sessionStorage.getItem(CFG.pendingKey);
      if (!saved) return;
      sessionStorage.removeItem(CFG.pendingKey);
      const input = document.querySelector(CFG.inputSelector);
      if (input && !input.value) {
        input.value = saved;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch {}
  });

  // Reload once, after a running download finishes. If something stays "busy" (a stuck
  // request), stop waiting after maxReloadWaits so the user's Update tap always completes.
  let reloading = false, reloadQueued = false, reloadWaits = 0;
  const reloadWhenIdle = () => {
    if (reloading) return;
    const busy = document.querySelector('[aria-busy="true"], form.htmx-request');
    if (busy && reloadWaits++ < CFG.maxReloadWaits) {
      if (!reloadQueued) {
        reloadQueued = true;
        setTimeout(() => { reloadQueued = false; reloadWhenIdle(); }, 1000);
      }
      return;
    }
    saveInput();
    reloading = true;
    location.reload();
  };

  /* ───────────── Self-healing: never leave the user on a broken page ───────────── */
  const isAppAsset = (u) => {
    try { const x = new URL(u, location.href); return x.origin === location.origin && /^\/(js|css)\//.test(x.pathname); }
    catch { return false; }
  };

  const clearAppCaches = async (everything = false) => {
    if (!("caches" in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith("cliptoid-static-") || (everything && k.startsWith("cliptoid-")))
      .map((k) => caches.delete(k)));
  };

  // Is the file reachable and sane straight from the server? If yes, OUR local copy is the problem.
  const serverCopyIsGood = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, { cache: "reload", signal: ctrl.signal, credentials: "same-origin" });
      return res.ok && !/text\/html/i.test(res.headers.get("Content-Type") || "");
    } catch { return false; } finally { clearTimeout(timer); }
  };

  let healing = false, failToast = false;
  const onAssetFailure = async (url) => {
    if (healing || reloading || failToast) return;
    healing = true;
    try {
      const allowed = navigator.onLine && Date.now() - Number(lsGet(CFG.healKey) || 0) > CFG.healWindowMs;
      if (allowed && (await serverCopyIsGood(url))) {
        lsSet(CFG.healKey, String(Date.now()));   // set BEFORE reloading: guarantees no loop
        await clearAppCaches();
        reloading = true;
        location.reload();
        return;
      }
    } catch (err) { report("self-heal", err); }
    healing = false;
    failToast = true;                              // one calm message per page, with a way out
    notify("Some parts of the page didn't load.", { actionLabel: "Reload", onAction: () => location.reload(), timeout: 0 });
  };

  // Capture phase: resource "error" events don't bubble. A JS file that arrives as HTML throws
  // a SyntaxError instead of an element error, so both are handled.
  addEventListener("error", (e) => {
    const t = e.target;
    if (t && t !== window && t.nodeType === 1) {
      const url = t.tagName === "SCRIPT" ? t.src : t.tagName === "LINK" && /stylesheet/i.test(t.rel) ? t.href : "";
      if (url && isAppAsset(url)) onAssetFailure(url);
    } else if (e.error instanceof SyntaxError && e.filename && isAppAsset(e.filename)) {
      onAssetFailure(e.filename);
    }
  }, true);

  addEventListener("offline", () => notify("You're offline. Downloads need an internet connection."));

  // Storage pressure: ask the worker to drop the oldest cached files before the browser errors out.
  const checkStorage = async () => {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (quota && usage / quota > CFG.storageWarnRatio) navigator.serviceWorker.controller?.postMessage({ type: "TRIM" });
    } catch {}
  };

  /* ───────────── Diagnostics + manual repair (run in the browser console) ───────────── */
  const diagnose = async () => {
    const mb = (n) => Math.round((n / 1048576) * 10) / 10;
    const out = {
      online: navigator.onLine,
      controlled: Boolean(navigator.serviceWorker?.controller),
      workerVersion: null,
      lowEnd, deviceMemoryGB: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null,
      connection: conn ? { type: conn.effectiveType, saveData: conn.saveData, rttMs: conn.rtt } : null,
      caches: {}, storage: null, jsHeapMB: null,
      memCacheEntries: memCache.size, lastHealAt: lsGet(CFG.healKey),
    };
    try {
      if ("caches" in window)
        for (const k of await caches.keys()) out.caches[k] = (await (await caches.open(k)).keys()).length;
    } catch {}
    try {
      const e = await navigator.storage?.estimate?.();
      if (e) out.storage = { usedMB: mb(e.usage), quotaMB: mb(e.quota) };
    } catch {}
    if (performance.memory) out.jsHeapMB = { used: mb(performance.memory.usedJSHeapSize), limit: mb(performance.memory.jsHeapSizeLimit) };
    const ctl = navigator.serviceWorker?.controller;
    if (ctl) {
      out.workerVersion = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 1500);
        const h = (ev) => {
          if (ev.data?.type !== "VERSION") return;
          clearTimeout(t); navigator.serviceWorker.removeEventListener("message", h); resolve(ev.data.version);
        };
        navigator.serviceWorker.addEventListener("message", h);
        ctl.postMessage({ type: "GET_VERSION" });
      });
    }
    console.log("[Cliptoid] diagnostics", out);
    return out;
  };

  // Last resort: remove every Cliptoid cache and the worker itself, then reload clean.
  const repair = async () => {
    reloading = true;                              // stops registration / update prompts racing this
    try { await clearAppCaches(true); } catch {}
    try { (await navigator.serviceWorker?.getRegistrations?.() || []).forEach((r) => r.unregister()); } catch {}
    location.reload();
  };
  // Support link: https://cliptoid.com/?cliptoid_repair=1
  onReady(() => {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get("cliptoid_repair") !== "1") return;
      u.searchParams.delete("cliptoid_repair");
      history.replaceState(null, "", u.pathname + u.search + u.hash);   // strip it first: no repair loop
      repair();
    } catch {}
  });

  /* ───────────── Service worker ───────────── */
  const swOk = "serviceWorker" in navigator && isSecureContext;
  if (swOk) {
    const hadController = Boolean(navigator.serviceWorker.controller);

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) reloadWhenIdle();       // only after user accepted the update
    });

    let contentNotified = false;
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type !== "CONTENT_UPDATED" || contentNotified) return;
      contentNotified = true;
      notify("Fresh content is available.", { actionLabel: "Refresh", onAction: reloadWhenIdle, timeout: 0 });
    });

    const start = async () => {
      if (reloading) return;                       // a repair / reload is in progress
      try {
        const reg = await navigator.serviceWorker.register(CFG.swUrl, { updateViaCache: "none" });

        const promptUpdate = (worker) =>
          notify("A new version is ready.", {
            actionLabel: "Update",
            onAction: () => worker.postMessage({ type: "SKIP_WAITING" }),
            timeout: 0,
          });

        // Follow a worker until it is installed. Handles a worker that is ALREADY installing
        // (or waiting) when register() resolves: its "updatefound" event has already fired,
        // so listening for that event alone would miss it and the toast would never appear.
        const watch = (w) => {
          if (!w) return;
          const ready = () => w.state === "installed" && navigator.serviceWorker.controller;
          if (ready()) return promptUpdate(w);
          w.addEventListener("statechange", () => { if (ready()) promptUpdate(w); });
        };

        watch(reg.waiting);
        watch(reg.installing);
        reg.addEventListener("updatefound", () => watch(reg.installing));
        idle(checkStorage);

        let last = 0;
        const check = () => {
          if (!navigator.onLine || Date.now() - last < CFG.minUpdateGapMs) return;
          last = Date.now();
          reg.update()
            .then(() => { if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting); })
            .catch(() => {});
        };
        document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
        addEventListener("online", check);
        setInterval(() => { if (!document.hidden) check(); }, CFG.updateCheckMs);
      } catch (err) {
        report("service-worker", err);
      }
    };

    // Don't compete with LCP: register after load, when idle
    // First visit (no worker yet): wait a few seconds so the worker's install never competes with
    // the page, the thumbnails or the user's first download request for bandwidth.
    const kickoff = () => (hadController ? idle(start) : setTimeout(() => idle(start), CFG.firstVisitDelayMs));
    if (document.readyState === "complete") kickoff();
    else addEventListener("load", kickoff, { once: true });
  }

  window.Cliptoid = Object.freeze({ smartFetch, notify, diagnose, repair });
})();