/**
 * TikTok Downloader API — Cloudflare Worker (v5)
 *
 *   GET /api/info?url=<anything TikTok>
 *        -> { ok, cached, data }   data.type = "video" | "photo" | "music"
 *   GET /api/download?url=...&type=video|hd|music|image|zip[&index=0][&filename=name]
 *        - video/hd/music : the media file
 *        - image          : ONE slideshow picture (index = 0-based)
 *        - zip            : ALL slideshow pictures in one ZIP
 *        - no type        : "zip" for slideshows, "video" for everything else
 *   GET /api/image/<name>.<ext>?u=<cdn url>      (thumbnail / avatar / slide proxy)
 *
 * Errors are JSON: { ok:false, code, error, retryable, detail }
 * ...except when the browser is *navigating* straight to /api/download. Then a small
 * friendly HTML page is returned that retries by itself, so people never land on raw JSON.
 *
 * Optional env var ENABLE_TIKWM="1" adds a third-party fallback source (off by default).
 */

const CACHE_TTL = 600;
const MEM_TTL_MS = 5 * 60 * 1000;
const MEM_MAX = 300;
const INFO_BROWSER_TTL = 300;
const PAGE_TIMEOUT_MS = 7000;
const HEDGE_DELAY_MS = 2500;
const MEDIA_TIMEOUT_MS = 12000;
const IMAGE_TIMEOUT_MS = 8000;
const IMAGE_CACHE_TTL = 86400;
const MAX_HTML_CHARS = 4000000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_BYTES = 60 * 1024 * 1024;
const ZIP_BATCH = 6;
const MAX_AUTO_RETRIES = 3;

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

const pageHeaders = (ua) => ({
  "User-Agent": ua,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.tiktok.com/",
});

// Every host TikTok serves pictures from (covers, avatars, slideshow slides).
const IMAGE_HOSTS =
  /(^|\.)(tiktokcdn(?:-[a-z0-9]+)?\.com|tiktokv\.(?:com|us|eu)|tiktokw\.(?:us|eu)|tiktok\.com|ibytedtos\.com|ibyteimg\.com|byteimg\.com|byteoversea\.com|bytednsdoc\.com|muscdn\.com|ttwstatic\.com|tikwm\.com)$/i;
const IMG_ACCEPT = "image/webp,image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5"; // no avif/heic on purpose

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, Accept",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Disposition, Accept-Ranges",
  "Access-Control-Max-Age": "86400",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Timing-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra },
  });

/* ---------- Errors ---------- */

const ERRORS = {
  INVALID_URL: [400, "This doesn't look like a valid TikTok link. Copy it from TikTok's Share button and try again."],
  VIDEO_REMOVED: [404, "This video was removed, or the link is wrong."],
  VIDEO_PRIVATE: [403, "This video is private or restricted, so it can't be downloaded."],
  REGION_BLOCKED: [403, "This video isn't available in the server's region."],
  TEMPORARY: [503, "TikTok didn't respond in time. Please try again in a few seconds."],
  NO_FILE: [404, "This file type isn't available for this post."],
  DOWNLOAD_FAILED: [502, "The download server didn't respond. Please try again."],
};
const DEFINITIVE = new Set(["VIDEO_REMOVED", "VIDEO_PRIVATE", "REGION_BLOCKED"]);

class AppError extends Error {
  constructor(code, message, opts = {}) {
    super(message || ERRORS[code][1]);
    this.code = code;
    this.status = opts.status ?? ERRORS[code][0];
    this.retryable = opts.retryable ?? (code === "TEMPORARY" || code === "DOWNLOAD_FAILED");
    this.details = opts.details || [];
  }
}

const scrapeErr = (message, code = null) => Object.assign(new Error(message), { code });

const toAppError = (e) =>
  e instanceof AppError ? e : new AppError("TEMPORARY", null, { details: [String(e?.message || e)] });

function failure(e) {
  const err = toAppError(e);
  return json(
    { ok: false, code: err.code, error: err.message, retryable: err.retryable, detail: err.details },
    err.status,
    err.retryable ? { "Retry-After": "2" } : {}
  );
}

/* A browser that *navigates* to /api/download (plain link, window.open, redirect) would show raw
   JSON on failure. For those requests return a friendly page that retries on its own. */
const isNavigation = (request) => {
  const dest = request.headers.get("Sec-Fetch-Dest");
  if (dest) return dest === "document" || dest === "iframe";
  return /text\/html/i.test(request.headers.get("Accept") || "");
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function failureFor(request, url, e) {
  if (!isNavigation(request)) return failure(e);
  const err = toAppError(e);
  const tries = parseInt(url.searchParams.get("_r") || "0", 10) || 0;
  const retry = err.retryable && tries < MAX_AUTO_RETRIES;
  let refresh = "";
  if (retry) {
    const next = new URL(url.href);
    next.searchParams.set("_r", String(tries + 1));
    refresh = `<meta http-equiv="refresh" content="2;url=${esc(next.href)}">`;
  }
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${refresh}
<title>${retry ? "Preparing your download…" : "Download failed"}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8eaf0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
.c{max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{color:#aab0be;line-height:1.5}
a{display:inline-block;margin-top:14px;padding:10px 18px;border-radius:10px;background:#fe2c55;color:#fff;text-decoration:none}</style></head>
<body><div class="c"><h1>${retry ? "Preparing your download…" : "We couldn't download this"}</h1>
<p>${retry ? "TikTok is slow to respond. Retrying automatically (" + (tries + 1) + "/" + MAX_AUTO_RETRIES + ")…" : esc(err.message)}</p>
${retry ? "" : '<a href="javascript:history.back()">Go back</a>'}</div></body></html>`;
  return new Response(body, {
    status: retry ? 503 : err.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

/* ---------- URL handling: every TikTok / TikTok Lite link shape ---------- */

const TT_HOST = /(^|\.)(tiktok\.com|tiktokv\.(?:com|us|eu))$/i;
const URL_RE = /(?<![\w.-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:tiktok\.com|tiktokv\.(?:com|us|eu))\/[^\s"'<>]*/i;

// Accepts a bare link, a link inside share text, http://, no scheme, or a percent-encoded link.
function parseTikTokInput(raw) {
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  if (/^https?%3A/i.test(text)) {
    try { text = decodeURIComponent(text); } catch { /* keep */ }
  }
  const m = text.match(URL_RE);
  if (!m) return null;
  let s = m[0].replace(/[)\]}>.,;!?'"]+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!TT_HOST.test(u.hostname)) return null;
  u.protocol = "https:";
  u.port = "";
  u.username = "";
  u.password = "";
  return u;
}

// Finds the id in: /@u/video/ID, /@u/photo/ID, m.tiktok.com/v/ID.html,
// /share/video/ID, /embed/v2/ID, ?share_item_id=ID, ?item_id=ID
function extractIdentity(u) {
  const p = u.pathname;
  const id =
    p.match(/\/(?:video|photo|v|embed\/v\d|embed|share\/video|share\/photo)\/(\d{8,})/)?.[1] ||
    [u.searchParams.get("share_item_id"), u.searchParams.get("item_id"), u.searchParams.get("aweme_id")].find((x) => /^\d{8,}$/.test(x || ""));
  if (!id) return null;
  return { id, user: p.match(/^\/@([^/]+)/)?.[1] || "_", kind: /\/photo\//.test(p) ? "photo" : "video" };
}

const canonicalFor = ({ id, user, kind }) => `https://www.tiktok.com/@${user}/${kind}/${id}`;

const shortMem = new Map();

// vm./vt. short links and /t/CODE links: follow redirects by hand (max 5 hops).
async function followShortLink(u) {
  const hit = shortMem.get(u.href);
  if (hit && hit.exp > Date.now()) return hit.url;

  let current = u.href;
  for (let hop = 0; hop < 5; hop++) {
    let res;
    try {
      res = await fetch(current, { redirect: "manual", headers: pageHeaders(MOBILE_UA), signal: AbortSignal.timeout(5000) });
    } catch {
      return null;
    }
    const loc = res.headers.get("Location");
    res.body?.cancel().catch(() => {});
    if (!(res.status >= 300 && res.status < 400 && loc)) break;

    let next;
    try { next = new URL(loc, current); } catch { break; }
    const inner = next.searchParams.get("redirect_url"); // TikTok sometimes bounces through /login?redirect_url=
    if (inner) {
      try { next = new URL(inner, next); } catch { /* ignore */ }
    }
    if (!TT_HOST.test(next.hostname)) break;

    const ident = extractIdentity(next);
    if (ident) {
      const url = canonicalFor(ident);
      if (shortMem.size > 500) shortMem.clear();
      shortMem.set(u.href, { url, exp: Date.now() + 3600000 });
      return url;
    }
    current = next.href;
  }

  // Last resort: let fetch follow every redirect and read the final address.
  try {
    const res = await fetch(u.href, { redirect: "follow", headers: pageHeaders(MOBILE_UA), signal: AbortSignal.timeout(6000) });
    res.body?.cancel().catch(() => {});
    const ident = extractIdentity(new URL(res.url));
    if (ident) {
      const url = canonicalFor(ident);
      if (shortMem.size > 500) shortMem.clear();
      shortMem.set(u.href, { url, exp: Date.now() + 3600000 });
      return url;
    }
  } catch { /* give up below */ }
  return null;
}

async function resolveTarget(raw) {
  const u = parseTikTokInput(raw);
  if (!u) throw new AppError("INVALID_URL");
  const ident = extractIdentity(u);
  if (ident) return canonicalFor(ident);
  if (/^\/music\//.test(u.pathname)) {
    u.search = "";
    u.hash = "";
    return u.href;
  }
  if (u.hostname !== "www.tiktok.com" || /^\/t\//.test(u.pathname)) {
    const resolved = await followShortLink(u);
    if (resolved) return resolved;
  }
  throw new AppError("INVALID_URL");
}

const cacheKeyFor = (u) => {
  const id = u.match(/\/(?:video|photo)\/(\d{8,})/)?.[1];
  return id ? `id:${id}` : `url:${u}`;
};

/* ---------- URL helpers ---------- */

const httpsUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u.replace(/^http:\/\//i, "https://") : null);
const firstUrl = (...c) => c.map(httpsUrl).find(Boolean) || null;
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return ""; } };
const notHeic = (u) => !/\.hei[cf]$/i.test(pathOf(u));
const isJpeg = (u) => /\.jpe?g$/i.test(pathOf(u));

// Prefer an image every browser can show: jpeg first, then anything but .heic/.heif.
const bestImage = (...c) => {
  const list = c.map(httpsUrl).filter(Boolean);
  return list.find((u) => notHeic(u) && isJpeg(u)) || list.find(notHeic) || list[0] || null;
};

function buildCookie(res) {
  const h = /** @type {any} */ (res.headers);
  const list = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

/* ---------- Source 1: TikTok's own page ---------- */

const SCRIPT_OPEN = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"';

// Stream-parse: keep only what is needed, stop as soon as the data script is complete.
async function readRehydrationJson(res) {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let inScript = false;
  let scanned = 0;
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        total += value.length;
        buf += decoder.decode(value, { stream: true });
      }
      if (!inScript) {
        const open = buf.indexOf(SCRIPT_OPEN);
        if (open === -1) {
          buf = buf.slice(-SCRIPT_OPEN.length);
        } else {
          const gt = buf.indexOf(">", open);
          if (gt === -1) buf = buf.slice(open);
          else {
            buf = buf.slice(gt + 1);
            inScript = true;
            scanned = 0;
          }
        }
      }
      if (inScript) {
        const end = buf.indexOf("</script>", scanned);
        if (end !== -1) return buf.slice(0, end);
        scanned = Math.max(0, buf.length - 8);
      }
      if (done || total > MAX_HTML_CHARS) return null;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// Only these statuses mean "really gone". Anything else (captcha, throttling...) is retried.
const STATUS_CODES = { 10204: "VIDEO_REMOVED", 10216: "VIDEO_PRIVATE", 10222: "VIDEO_PRIVATE", 10231: "REGION_BLOCKED" };

function checkStatus(detail) {
  const s = detail.statusCode;
  if (s && s !== 0) {
    throw scrapeErr(`tiktok_status_${s}${detail.statusMsg ? ` (${detail.statusMsg})` : ""}`, STATUS_CODES[s] || null);
  }
}

// Slideshow slides: take the best displayable URL of each slide; keep order, drop duplicates.
function extractSlides(item) {
  const raw = item.imagePost?.images || [];
  const out = [];
  for (const i of raw) {
    const u = bestImage(...(i.imageURL?.urlList || []), ...(i.displayImage?.urlList || []));
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

function parseVideo(detail, cookie) {
  checkStatus(detail);
  const item = detail.itemInfo?.itemStruct;
  if (!item) throw scrapeErr("no_item");

  const v = item.video || {};
  const bitrates = Array.isArray(v.bitrateInfo) ? v.bitrateInfo : [];
  const best = bitrates.slice().sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0))[0];
  const images = extractSlides(item);
  const isPhoto = images.length > 0;

  // Slideshows have no real video file; don't expose the silent placeholder as a "video".
  const play = isPhoto
    ? null
    : firstUrl(v.playAddr, ...(bitrates[0]?.PlayAddr?.UrlList || []), v.downloadAddr);
  const hd = isPhoto ? null : firstUrl(...(best?.PlayAddr?.UrlList || [])) || play;

  const a = item.author && typeof item.author === "object" ? item.author : {};

  return {
    id: item.id,
    kind: isPhoto ? "photo" : "video",
    title: item.desc || "",
    duration: v.duration || 0,
    cover: bestImage(
      v.originCover,
      v.cover,
      v.zoomCover?.["480"],
      v.zoomCover?.["240"],
      v.dynamicCover,
      ...(item.imagePost?.cover?.imageURL?.urlList || []),
      images[0]
    ),
    author: {
      name: a.nickname || "",
      username: a.uniqueId || "",
      avatar: bestImage(a.avatarThumb, a.avatarMedium, a.avatarLarger),
    },
    files: { video: play, hd, music: firstUrl(item.music?.playUrl) },
    images,
    stats: {
      plays: item.stats?.playCount,
      likes: item.stats?.diggCount,
      comments: item.stats?.commentCount,
      shares: item.stats?.shareCount,
    },
    cookie,
    source: "tiktok",
  };
}

function parseMusic(detail, cookie) {
  checkStatus(detail);
  const m = detail.musicInfo?.music;
  if (!m) throw scrapeErr("no_music");
  return {
    id: m.id,
    kind: "music",
    title: m.title || "",
    duration: m.duration || 0,
    cover: bestImage(m.coverLarge, m.coverMedium, m.coverThumb),
    author: { name: m.authorName || "", username: m.authorName || "", avatar: null },
    files: { video: null, hd: null, music: firstUrl(m.playUrl) },
    images: [],
    stats: {},
    cookie,
    source: "tiktok",
  };
}

async function scrapeTikTok(inputUrl, ua, signal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(inputUrl, { headers: pageHeaders(ua), redirect: "follow", signal: ctrl.signal });
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      throw scrapeErr(`page_http_${res.status}`, res.status === 404 ? "VIDEO_REMOVED" : null);
    }
    const cookie = buildCookie(res);
    const raw = await readRehydrationJson(res);
    if (!raw) throw scrapeErr("no_page_data (TikTok may be blocking this server)");

    let data;
    try { data = JSON.parse(raw); } catch { throw scrapeErr("bad_page_json"); }

    const scope = data?.__DEFAULT_SCOPE__ || {};
    if (scope["webapp.video-detail"]) return parseVideo(scope["webapp.video-detail"], cookie);
    if (scope["webapp.music-detail"]) return parseMusic(scope["webapp.music-detail"], cookie);
    throw scrapeErr("no_video_detail");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/* ---------- Source 2 (optional, ENABLE_TIKWM=1): third-party fallback ---------- */

async function fetchTikwm(url, signal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch("https://www.tikwm.com/api/?hd=1&url=" + encodeURIComponent(url), {
      headers: { "User-Agent": DESKTOP_UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw scrapeErr(`tikwm_http_${res.status}`);
    const j = await res.json();
    if (j.code !== 0 || !j.data) throw scrapeErr(`tikwm_${j.msg || j.code}`);
    const d = j.data;
    const abs = (u) => (!u ? null : u.startsWith("/") ? "https://www.tikwm.com" + u : httpsUrl(u));
    const images = (d.images || []).map(abs).filter(Boolean);
    const isPhoto = images.length > 0;
    return {
      id: d.id,
      kind: isPhoto ? "photo" : "video",
      title: d.title || "",
      duration: d.duration || 0,
      cover: abs(d.origin_cover) || abs(d.cover),
      author: { name: d.author?.nickname || "", username: d.author?.unique_id || "", avatar: abs(d.author?.avatar) },
      files: {
        video: isPhoto ? null : abs(d.play),
        hd: isPhoto ? null : abs(d.hdplay) || abs(d.play),
        music: abs(d.music),
      },
      images,
      stats: { plays: d.play_count, likes: d.digg_count, comments: d.comment_count, shares: d.share_count },
      cookie: "",
      source: "tikwm",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/* ---------- Hedged resolver: start the next source early, first success wins ---------- */

function firstSuccess(tasks, delayMs) {
  return new Promise((resolve, reject) => {
    const errors = [];
    const ctrls = [];
    let started = 0;
    let finished = 0;
    let settled = false;
    let timer = 0;

    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctrls.forEach((c) => c.abort()); // stop the losers
      fn(v);
    };
    const giveUp = () => {
      const def = errors.find((e) => DEFINITIVE.has(e.code));
      const details = errors.map((e) => (e?.name === "AbortError" ? "timeout" : e?.message || String(e)));
      finish(reject, new AppError(def ? def.code : "TEMPORARY", null, { details }));
    };
    const launch = () => {
      clearTimeout(timer);
      if (settled || started >= tasks.length) return;
      const run = tasks[started++];
      const c = new AbortController();
      ctrls.push(c);
      if (started < tasks.length) timer = setTimeout(launch, delayMs);
      run(c.signal).then(
        (v) => finish(resolve, v),
        (e) => {
          errors.push(e);
          finished++;
          if (settled) return;
          // "removed/private" needs two independent confirmations, or all sources done
          if (errors.filter((x) => DEFINITIVE.has(x.code)).length >= 2) return giveUp();
          if (finished === tasks.length) return giveUp();
          launch();
        }
      );
    };
    launch();
  });
}

function resolveUpstream(url, env) {
  const tasks = [
    (s) => scrapeTikTok(url, DESKTOP_UA, s),
    (s) => scrapeTikTok(url, MOBILE_UA, s),
  ];
  if (env?.ENABLE_TIKWM === "1" && /\/(video|photo)\//.test(url)) tasks.push((s) => fetchTikwm(url, s));
  tasks.push((s) => scrapeTikTok(url, ANDROID_UA, s));
  return firstSuccess(tasks, HEDGE_DELAY_MS);
}

/* ---------- Caching: memory -> edge cache (custom domains only) -> upstream ----------
   Concurrent requests for the same post (info + download fired together) share ONE scrape. */

const mem = new Map();
const inflight = new Map();
const edgeKey = (key) => new Request("https://cache.internal/v5/" + encodeURIComponent(key));

function remember(key, data, ctx) {
  const keys = new Set([key]);
  if (data.id) keys.add(`id:${data.id}`);
  for (const k of keys) {
    mem.delete(k);
    if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value);
    mem.set(k, { data, exp: Date.now() + MEM_TTL_MS });
    const res = new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` },
    });
    ctx.waitUntil(caches.default.put(edgeKey(k), res).catch(() => {}));
  }
}

async function resolveInfo(canonical, env, ctx, fresh = false) {
  const key = cacheKeyFor(canonical);

  if (!fresh) {
    const hot = mem.get(key);
    if (hot && hot.exp > Date.now()) return { data: hot.data, cached: true };
    try {
      const hit = await caches.default.match(edgeKey(key));
      if (hit) {
        const data = await hit.json();
        mem.set(key, { data, exp: Date.now() + MEM_TTL_MS });
        return { data, cached: true };
      }
    } catch { /* cache unavailable */ }
    const pending = inflight.get(key);
    if (pending) return { data: await pending, cached: true };
  }

  const p = resolveUpstream(canonical, env);
  if (!fresh) {
    inflight.set(key, p);
    const clear = () => { if (inflight.get(key) === p) inflight.delete(key); };
    p.then(clear, clear);
  }
  const data = await p;
  remember(key, data, ctx);
  return { data, cached: false };
}

/* ---------- Public shape ---------- */

const proxyImage = (origin, raw) => {
  if (!raw) return null;
  const ext = pathOf(raw).match(/\.(jpe?g|png|webp|avif)$/i)?.[1]?.toLowerCase() || "jpeg";
  return `${origin}/api/image/img.${ext}?u=${encodeURIComponent(raw)}`;
};

const publicInfo = (d, origin) => ({
  id: d.id,
  type: d.kind || "video",
  title: d.title,
  duration: d.duration,
  cover: proxyImage(origin, d.cover),
  author: {
    name: d.author?.name || "",
    username: d.author?.username || "",
    avatar: proxyImage(origin, d.author?.avatar),
  },
  video: Boolean(d.files.video),
  hd: Boolean(d.files.hd) && d.files.hd !== d.files.video,
  music: Boolean(d.files.music),
  photo: d.images.length > 0,
  imageCount: d.images.length,
  images: d.images.map((u) => proxyImage(origin, u)),
  stats: d.stats,
});

/* ---------- ZIP (store-only, no dependencies) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (b) => {
  let c = ~0;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};

function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const size = f.data.length;
    const crc = crc32(f.data);

    const lh = new DataView(new ArrayBuffer(30)); // local file header
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(12, 0x21, true);  // DOS date 1980-01-01
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);

    const ch = new DataView(new ArrayBuffer(46)); // central directory entry
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

/* ---------- Pictures: fetch with three different "identities" ---------- */

async function fetchImage(href, attempt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  try {
    const headers =
      attempt === 0
        ? { "User-Agent": DESKTOP_UA, Referer: "https://www.tiktok.com/", Accept: IMG_ACCEPT }
        : attempt === 1
        ? { "User-Agent": MOBILE_UA, Accept: IMG_ACCEPT } // different identity, no referer
        : { "User-Agent": ANDROID_UA, Accept: "*/*" };    // last resort: generic
    const res = await fetch(href, { headers, signal: ctrl.signal });
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    const type = res.headers.get("Content-Type") || "";
    if (/hei[cf]|text\/html|json/i.test(type)) {
      res.body?.cancel().catch(() => {});
      return null; // not displayable (or a block page) -> try the next identity
    }
    const bytes = await res.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return { bytes, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchImageAny(href) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await fetchImage(href, attempt);
    if (got) return got;
  }
  return null;
}

const imageMime = (t) => (/^image\//i.test(t) ? t.split(";")[0] : "image/jpeg");
const extFromType = (t) => (/png/i.test(t) ? "png" : /webp/i.test(t) ? "webp" : /gif/i.test(t) ? "gif" : "jpg");

async function handleImage(request, ctx, url) {
  let target;
  try {
    target = new URL(url.searchParams.get("u"));
  } catch {
    return json({ ok: false, code: "BAD_IMAGE", error: "Invalid image URL", retryable: false }, 400);
  }
  if (
    target.protocol !== "https:" ||
    (target.port && target.port !== "443") ||
    target.username ||
    target.password ||
    !IMAGE_HOSTS.test(target.hostname)
  ) {
    return json({ ok: false, code: "BAD_IMAGE", error: "Image host not allowed", retryable: false }, 400);
  }

  const key = new Request("https://cache.internal/img/" + encodeURIComponent(target.hostname + target.pathname));
  try {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  } catch { /* ignore */ }

  const got = await fetchImageAny(target.href);
  if (!got) {
    // Server-side fetch failed. For a plain <img> let the visitor's own browser try the CDN
    // directly. fetch() callers (slideshow video, "Save image") can't follow a redirect to a
    // CDN without CORS, so they get a normal JSON error they can retry on.
    if (request.headers.get("Sec-Fetch-Dest") === "image") {
      return new Response(null, {
        status: 302,
        headers: { Location: target.href, "Cache-Control": "no-store", ...CORS },
      });
    }
    return json({ ok: false, code: "IMAGE_FAILED", error: "Image source unavailable.", retryable: true }, 502);
  }

  const res = new Response(got.bytes, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": imageMime(got.type),
      "Cache-Control": `public, max-age=${IMAGE_CACHE_TTL}`,
    },
  });
  ctx.waitUntil(caches.default.put(key, res.clone()).catch(() => {}));
  return res;
}

/* ---------- Downloads ---------- */

function contentDisposition(name, ext) {
  const base =
    String(name)
      .replace(/\.(mp4|mp3|m4a|jpe?g|png|webp|zip)$/i, "")
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "tiktok";
  const ascii = base.replace(/[^\x20-\x7e]/g, "").replace(/["%;\\]/g, "").trim() || "tiktok";
  const encoded = encodeURIComponent(base).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encoded}.${ext}`;
}

const pickFile = (info, type) =>
  type === "music" ? info.files.music : type === "hd" ? info.files.hd || info.files.video : info.files.video || info.files.hd;

async function fetchMedia(file, info, range) {
  const headers = { Accept: "*/*", "Accept-Encoding": "identity", "User-Agent": DESKTOP_UA };
  if (info.source !== "tikwm") {
    headers.Referer = "https://www.tiktok.com/";
    if (info.cookie) headers.Cookie = info.cookie;
  }
  if (range) headers.Range = range;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MEDIA_TIMEOUT_MS);
  try {
    return await fetch(file, { headers, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handleImageDownload(info, type, url, rawName) {
  if (!info.images?.length) throw new AppError("NO_FILE");
  const base = String(rawName).replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "tiktok";

  if (type === "image") {
    const i = Math.max(0, Math.min(info.images.length - 1, parseInt(url.searchParams.get("index") || "0", 10) || 0));
    const got = await fetchImageAny(info.images[i]);
    if (!got) throw new AppError("DOWNLOAD_FAILED", null, { details: ["image_fetch"] });
    return new Response(got.bytes, {
      headers: {
        ...CORS,
        "Content-Type": imageMime(got.type),
        "Content-Disposition": contentDisposition(`${base} ${i + 1}`, extFromType(got.type)),
        "Content-Length": String(got.bytes.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  }

  // zip: fetch in small batches to keep memory and subrequests under control
  const slides = [];
  let total = 0;
  for (let s = 0; s < info.images.length; s += ZIP_BATCH) {
    const batch = info.images.slice(s, s + ZIP_BATCH);
    const got = await Promise.all(batch.map(fetchImageAny));
    got.forEach((g, j) => {
      if (!g || total + g.bytes.byteLength > MAX_ZIP_BYTES) return;
      total += g.bytes.byteLength;
      slides.push({ index: s + j + 1, g });
    });
  }
  if (!slides.length) throw new AppError("DOWNLOAD_FAILED", null, { details: ["zip_images"] });

  const stem = base.slice(0, 40).trim() || "tiktok";
  const pad = String(info.images.length).length;
  const files = slides.map(({ index, g }) => ({
    name: `${stem}-${String(index).padStart(Math.max(2, pad), "0")}.${extFromType(g.type)}`,
    data: new Uint8Array(g.bytes),
  }));
  const zip = buildZip(files);
  return new Response(zip, {
    headers: {
      ...CORS,
      "Content-Type": "application/zip",
      "Content-Length": String(zip.size),
      "Content-Disposition": contentDisposition(base, "zip"),
      "Cache-Control": "private, no-store",
    },
  });
}

async function handleDownload(request, env, ctx, url) {
  const wanted = url.searchParams.get("type");
  if (wanted && !["video", "hd", "music", "image", "zip"].includes(wanted)) {
    return json({ ok: false, code: "BAD_TYPE", error: "type must be video, hd, music, image or zip", retryable: false }, 400);
  }

  try {
    const canonical = await resolveTarget(url.searchParams.get("url"));
    let info = (await resolveInfo(canonical, env, ctx)).data;

    // Slideshow without an explicit type -> everything as a ZIP.
    const type = wanted || (info.images?.length ? "zip" : "video");
    const rawName = url.searchParams.get("filename") || `${info.title || "tiktok"} downloaded by tiktokvideodownload.app`;

    if (type === "image" || type === "zip") {
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { ...CORS, "Content-Type": type === "zip" ? "application/zip" : "image/jpeg", "Cache-Control": "private, no-store" },
        });
      }
      return await handleImageDownload(info, type, url, rawName);
    }

    const ext = type === "music" ? "mp3" : "mp4";
    const out = new Headers(CORS);
    out.set("Content-Type", type === "music" ? "audio/mpeg" : "video/mp4");
    out.set("Content-Disposition", contentDisposition(rawName, ext));
    out.set("Accept-Ranges", "bytes");
    out.set("Cache-Control", "private, no-store");

    if (request.method === "HEAD") return new Response(null, { status: 200, headers: out });

    const range = request.headers.get("Range");
    let upstream = null;
    let detail = "";

    // attempt 0 uses cached data; attempt 1 re-resolves (the cached media link may have expired)
    for (let attempt = 0; attempt < 2; attempt++) {
      const file = pickFile(info, type);
      if (!file || !/^https:\/\//i.test(file)) throw new AppError("NO_FILE");

      const res = await fetchMedia(file, info, range);
      const ctype = res?.headers.get("Content-Type") || "";
      if (res && (res.ok || res.status === 206) && !/text\/html|json/i.test(ctype)) {
        upstream = res;
        break;
      }
      detail = res ? `http_${res.status}` : "timeout";
      res?.body?.cancel().catch(() => {});
      if (attempt === 1) break;
      try {
        info = (await resolveInfo(canonical, env, ctx, true)).data;
      } catch (e) {
        if (e instanceof AppError && DEFINITIVE.has(e.code)) throw e;
      }
    }

    if (!upstream) throw new AppError("DOWNLOAD_FAILED", null, { details: [detail] });

    for (const h of ["Content-Length", "Content-Range"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers: out });
  } catch (e) {
    return failureFor(request, url, e);
  }
}

async function handleInfo(request, env, ctx, url) {
  try {
    const canonical = await resolveTarget(url.searchParams.get("url"));
    const { data, cached } = await resolveInfo(canonical, env, ctx);
    return json({ ok: true, cached, data: { ...publicInfo(data, url.origin), url: canonical } }, 200, {
      "Cache-Control": `public, max-age=${INFO_BROWSER_TTL}`,
    });
  } catch (e) {
    return failure(e);
  }
}

/* ---------- Router ---------- */

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!["GET", "HEAD"].includes(request.method)) return json({ ok: false, error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";

    try {
      if (path === "/api/image" || path.startsWith("/api/image/")) return await handleImage(request, ctx, url);
      switch (path) {
        case "/":
          return json({
            ok: true,
            name: "TikTok Downloader API",
            endpoints: {
              info: "/api/info?url=<tiktok_url_or_share_text>",
              download: "/api/download?url=<tiktok_url>&type=video|hd|music|image|zip&index=<n>&filename=<optional>",
              image: "/api/image/img.jpg?u=<tiktok_cdn_image_url>",
            },
          });
        case "/api/info":
          return await handleInfo(request, env, ctx, url);
        case "/api/download":
          return await handleDownload(request, env, ctx, url);
        default:
          return json({ ok: false, error: "Not found", path: url.pathname }, 404);
      }
    } catch (e) {
      return failure(e); // never let an unexpected exception become Cloudflare's error page
    }
  },
};