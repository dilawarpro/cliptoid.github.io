(() => {
  "use strict";

  /* ───────────── Config ───────────── */
  const CFG = {
    swUrl: "/service-worker.js",
    updateCheckMs: 15 * 60 * 1000,
    minUpdateGapMs: 60 * 1000,
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
  let toast, toastTimer;
  const notify = (message, { actionLabel, onAction, timeout = 4000 } = {}) => {
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
      btn.addEventListener("click", () => { toast.style.display = "none"; onAction(); }, { once: true });
      toast.append(btn);
    }
    toast.style.display = "flex";
    if (timeout) toastTimer = setTimeout(() => { toast.style.display = "none"; }, timeout);
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

  async function fetchWithRetry(url, { retries, timeout, parse, init }) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        if (res.ok) {
          try {
            return await res[parse]();
          } catch (e) {
            // A malformed body won't fix itself on retry; a timeout while reading will.
            throw e.name === "AbortError" ? e : Object.assign(e, { fatal: true });
          }
        }
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        // Only retry transient failures
        if (res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
        lastErr = err;
      } catch (e) {
        if (e.fatal) throw e;
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < retries) await sleep(2 ** attempt * 300 + Math.random() * 200); // backoff + jitter
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
    } = opts;
    const key = `${init.method || "GET"}:${url}`;
    const hit = memCache.get(key);
    const age = hit ? Date.now() - hit.time : Infinity;

    const refresh = () => {
      if (inflight.has(key)) return inflight.get(key);   // dedupe concurrent calls
      const p = fetchWithRetry(url, { retries, timeout, parse, init })
        .then((data) => { remember(key, data); return data; })   // only successes are cached
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    };

    if (!force && hit && age < ttl) return hit.data;
    if (!force && hit && age < staleTtl) { refresh().catch(() => {}); return hit.data; }
    try {
      return await refresh();
    } catch (err) {
      if (hit) return hit.data;                          // graceful degradation: stale data beats an error
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
  const canPrefetch = !(conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType || ""));
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

  let reloading = false, reloadQueued = false;
  const reloadWhenIdle = () => {
    if (reloading) return;
    if (document.querySelector('[aria-busy="true"], form.htmx-request')) {
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
      try {
        const reg = await navigator.serviceWorker.register(CFG.swUrl, { updateViaCache: "none" });

        const promptUpdate = (worker) =>
          notify("A new version is ready.", {
            actionLabel: "Update",
            onAction: () => worker.postMessage({ type: "SKIP_WAITING" }),
            timeout: 0,
          });

        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) promptUpdate(w);
          });
        });

        let last = 0;
        const check = () => {
          if (!navigator.onLine || Date.now() - last < CFG.minUpdateGapMs) return;
          last = Date.now();
          reg.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
        addEventListener("online", check);
        setInterval(() => { if (!document.hidden) check(); }, CFG.updateCheckMs);
      } catch (err) {
        report("service-worker", err);
      }
    };

    // Don't compete with LCP: register after load, when idle
    if (document.readyState === "complete") idle(start);
    else addEventListener("load", () => idle(start), { once: true });
  }

  window.Cliptoid = Object.freeze({ smartFetch, notify });
})();