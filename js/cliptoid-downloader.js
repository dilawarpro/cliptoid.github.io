/**
 * TikTok Downloader API — Cloudflare Worker (independent, no third-party API)
 *
 * The Worker reads TikTok's own public video page, extracts the video data
 * embedded in it, and streams the file back with a download header.
 *
 * Endpoints:
 *   GET /                      -> API info
 *   GET /api/info?url=<tiktok> -> JSON (title, author, cover, video, hd, music, images)
 *   GET /api/download?url=<tiktok>&type=video|hd|music[&filename=name]
 */

const CACHE_TTL = 600;          // seconds
const TIMEOUT = 10000;          // ms for page fetch
const USE_THIRD_PARTY_FALLBACK = false; // keep false for fully independent mode

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PAGE_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.tiktok.com/",
};

// Hosts the /api/media image proxy may fetch from (covers, slideshow images).
const MEDIA_HOST =
  /(^|\.)(tiktok\.com|tiktokcdn(-[a-z]{2})?\.com|tiktokv\.com|byteoversea\.com|ibytedtos\.com|ibyteimg\.com|muscdn\.com)$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Disposition, Accept-Ranges",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });

const isTikTokUrl = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && /(^|\.)tiktok\.com$/i.test(x.hostname);
  } catch {
    return false;
  }
};

function cleanUrl(u) {
  const x = new URL(u);
  x.search = "";
  x.hash = "";
  return x.toString();
}

async function fetchTimeout(url, opts = {}, ms = TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function buildCookie(res) {
  const h = /** @type {any} */ (res.headers);
  const list = typeof h.getSetCookie === "function" ? h.getSetCookie() : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

/* ---------- Direct scraper (no third party) ---------- */

async function scrapeTikTok(inputUrl) {
  const res = await fetchTimeout(inputUrl, { headers: PAGE_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`page_http_${res.status}`);

  const cookie = buildCookie(res);
  const html = await res.text();

  const m = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("no_page_data (TikTok may be blocking this server)");

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    throw new Error("bad_page_json");
  }

  const detail = data?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  if (!detail) throw new Error("no_video_detail");
  if (detail.statusCode && detail.statusCode !== 0) throw new Error(`tiktok_status_${detail.statusCode}`);

  const item = detail.itemInfo?.itemStruct;
  if (!item) throw new Error("no_item");

  const v = item.video || {};
  const bitrates = Array.isArray(v.bitrateInfo) ? v.bitrateInfo : [];
  const best = bitrates
    .slice()
    .sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0))[0];
  const play = v.playAddr || bitrates[0]?.PlayAddr?.UrlList?.[0] || null;
  const hd = best?.PlayAddr?.UrlList?.[0] || play;

  const images = (item.imagePost?.images || [])
    .map((i) => i.imageURL?.urlList?.[0])
    .filter(Boolean);

  const a = item.author && typeof item.author === "object" ? item.author : {};

  return {
    id: item.id,
    title: item.desc || "tiktok-video",
    duration: v.duration || 0,
    cover: v.originCover || v.cover || null,
    author: {
      name: a.nickname || "",
      username: a.uniqueId || "",
      avatar: a.avatarThumb || null,
    },
    video: play,
    hd,
    music: item.music?.playUrl || null,
    images,
    stats: {
      plays: item.stats?.playCount,
      likes: item.stats?.diggCount,
      comments: item.stats?.commentCount,
      shares: item.stats?.shareCount,
    },
    _cookie: cookie, // internal only, never sent to clients
  };
}

/* ---------- Optional third-party fallback (disabled by default) ---------- */

async function providerTikwm(url) {
  const r = await fetchTimeout(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const j = await r.json();
  if (!j || j.code !== 0 || !j.data) throw new Error(j?.msg || "upstream_error");
  const d = j.data;
  const abs = (u) => (!u ? null : u.startsWith("http") ? u : "https://www.tikwm.com" + u);
  return {
    id: d.id,
    title: d.title || "tiktok-video",
    duration: d.duration || 0,
    cover: abs(d.cover),
    author: { name: d.author?.nickname || "", username: d.author?.unique_id || "", avatar: abs(d.author?.avatar) },
    video: abs(d.play),
    hd: abs(d.hdplay) || abs(d.play),
    music: abs(d.music),
    images: Array.isArray(d.images) ? d.images : [],
    stats: {},
    _cookie: "",
  };
}

class ProviderError extends Error {
  /** @param {string} message @param {string[]} details */
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

async function resolveUpstream(url) {
  const errors = [];
  try {
    return await scrapeTikTok(url);
  } catch (e) {
    errors.push("direct: " + (e && e.message ? e.message : e));
  }
  if (USE_THIRD_PARTY_FALLBACK) {
    try {
      return await providerTikwm(url);
    } catch (e) {
      errors.push("fallback: " + (e && e.message ? e.message : e));
    }
  }
  throw new ProviderError("all_providers_failed", errors);
}

const publicInfo = (d) => {
  const rest = { ...d };
  delete rest._cookie;
  return rest;
};

async function resolveInfo(url, ctx) {
  const cache = caches.default;
  const key = new Request("https://cache.internal/v2/" + encodeURIComponent(url));
  const hit = await cache.match(key);
  if (hit) return { data: await hit.json(), cached: true };

  const data = await resolveUpstream(url);
  const res = new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL}` },
  });
  ctx.waitUntil(cache.put(key, res));
  return { data, cached: false };
}

/* ---------- Handlers ---------- */

async function handleInfo(request, ctx, url) {
  const target = url.searchParams.get("url");
  if (!target || !isTikTokUrl(target)) {
    return json({ ok: false, error: "Provide a valid https TikTok URL in ?url=" }, 400);
  }
  try {
    const { data, cached } = await resolveInfo(cleanUrl(target), ctx);
    return json({ ok: true, cached, data: publicInfo(data) }, 200, {
      "Cache-Control": `public, max-age=${CACHE_TTL}`,
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: "Could not fetch this video. Check the link and try again.",
        detail: /** @type {any} */ (e)?.details || String(/** @type {any} */ (e)?.message || e),
      },
      502
    );
  }
}

async function handleDownload(request, ctx, url) {
  const target = url.searchParams.get("url");
  const type = url.searchParams.get("type") || "video";
  if (!target || !isTikTokUrl(target)) {
    return json({ ok: false, error: "Provide a valid https TikTok URL in ?url=" }, 400);
  }
  if (!["video", "hd", "music"].includes(type)) {
    return json({ ok: false, error: "type must be video, hd or music" }, 400);
  }

  let info;
  try {
    info = (await resolveInfo(cleanUrl(target), ctx)).data;
  } catch (e) {
    return json({ ok: false, error: "Could not fetch this video.", detail: /** @type {any} */ (e)?.details }, 502);
  }

  const file = info[type];
  if (!file || !/^https:\/\//i.test(file)) {
    return json({ ok: false, error: "Requested file type not available." }, 404);
  }

  const headers = { "User-Agent": UA, Referer: "https://www.tiktok.com/" };
  if (info._cookie) headers.Cookie = info._cookie;
  const range = request.headers.get("Range");
  if (range) headers.Range = range;

  const upstream = await fetchTimeout(file, { headers }, 15000).catch(() => null);
  if (!upstream || !(upstream.ok || upstream.status === 206)) {
    return json(
      { ok: false, error: "Download source unavailable.", detail: upstream ? `http_${upstream.status}` : "timeout" },
      502
    );
  }

  const ext = type === "music" ? "mp3" : "mp4";
  const rawName = url.searchParams.get("filename") || `${info.title} downloaded by tiktokvideodownload.app`;
  const safe = rawName.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 120) || "tiktok";

  const out = new Headers(CORS);
  out.set("Content-Type", type === "music" ? "audio/mpeg" : "video/mp4");
  out.set(
    "Content-Disposition",
    `attachment; filename="tiktok.${ext}"; filename*=UTF-8''${encodeURIComponent(safe)}.${ext}`
  );
  out.set("Accept-Ranges", "bytes");
  for (const h of ["Content-Length", "Content-Range"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/* ---------- TikWM-compatible endpoint (drop-in for existing front-ends) ---------- */

async function handleCompat(request, ctx, url) {
  const target = url.searchParams.get("url");
  if (!target || !isTikTokUrl(target)) {
    return json({ code: -1, msg: "Enter a valid HTTPS TikTok link to continue." });
  }
  try {
    const clean = cleanUrl(target);
    const { data: d } = await resolveInfo(clean, ctx);
    const base = url.origin;
    const dl = (type) => `${base}/api/download?url=${encodeURIComponent(clean)}&type=${type}`;
    const media = (u) => (u ? `${base}/api/media?u=${encodeURIComponent(u)}` : null);
    const isSlideshow = d.images.length > 0;
    return json({
      code: 0,
      msg: "success",
      data: {
        id: d.id,
        title: d.title,
        duration: d.duration,
        cover: media(d.cover),
        origin_cover: media(d.cover),
        author: { nickname: d.author.name, unique_id: d.author.username },
        play: isSlideshow || !d.video ? null : dl("video"),
        hdplay: isSlideshow || !d.hd ? null : d.hd === d.video ? dl("video") : dl("hd"),
        music: d.music ? dl("music") : null,
        images: d.images.map(media).filter(Boolean),
      },
    });
  } catch (e) {
    return json({
      code: -1,
      msg: "Could not fetch this video. Check the link and try again.",
      detail: /** @type {any} */ (e)?.details || String(/** @type {any} */ (e)?.message || e),
    });
  }
}

// Image-only proxy so covers and slideshow images load with CORS headers.
async function handleMedia(request, url) {
  let target;
  try {
    target = new URL(url.searchParams.get("u") || "");
  } catch {
    return json({ ok: false, error: "Invalid media URL." }, 400);
  }
  if (target.protocol !== "https:" || !MEDIA_HOST.test(target.hostname)) {
    return json({ ok: false, error: "Host not allowed." }, 403);
  }
  const up = await fetchTimeout(target.href, {
    headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" },
  }, 15000).catch(() => null);
  if (!up || !up.ok) return json({ ok: false, error: "Media unavailable." }, 502);
  const type = up.headers.get("Content-Type") || "";
  if (!/^image\//i.test(type)) return json({ ok: false, error: "Only images are served here." }, 415);
  const out = new Headers(CORS);
  out.set("Content-Type", type);
  out.set("Cache-Control", "public, max-age=3600");
  const len = up.headers.get("Content-Length");
  if (len) out.set("Content-Length", len);
  return new Response(up.body, { status: 200, headers: out });
}

/* ---------- Router ---------- */

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!["GET", "HEAD"].includes(request.method)) return json({ ok: false, error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    // Tolerate "//api/info" and "/api/info/" (extra or trailing slashes)
    const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    switch (path) {
      case "/":
        return json({
          ok: true,
          name: "TikTok Downloader API",
          version: "3-compat",
          mode: USE_THIRD_PARTY_FALLBACK ? "direct+fallback" : "direct",
          endpoints: {
            info: "/api/info?url=<tiktok_url>",
            download: "/api/download?url=<tiktok_url>&type=video|hd|music&filename=<optional>",
            compat: "/api/compat?url=<tiktok_url>",
            media: "/api/media?u=<image_url>",
          },
        });
      case "/api/info":
        return handleInfo(request, ctx, url);
      case "/api/download":
        return handleDownload(request, ctx, url);
      case "/api/compat":
        return handleCompat(request, ctx, url);
      case "/api/media":
        return handleMedia(request, url);
      default:
        return json({ ok: false, error: "Not found", path: url.pathname }, 404);
    }
  },
};