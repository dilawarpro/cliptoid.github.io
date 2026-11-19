(() => {
  "use strict";

  const form = document.querySelector("#_gcaptcha_pt");
  const input = document.querySelector("#main_page_text");
  const submit = document.querySelector("#submit");
  const target = document.querySelector("#target");
  const adContainer = document.querySelector("#ad_main");
  let shareButton = document.querySelector("#cliptide-share");
  let shareRow = document.querySelector(".cliptide-share-row");

  // API (Cloudflare Worker).
  //   GET /api/info?url=<tiktok link>[&fresh=1]  -> { ok, data: { title, cover, author, video, hd, music, images, tokens, ... } }
  //   GET /api/download?token=<signed token>&filename=<name>   (fast path, no lookup)
  //   GET /api/download?url=<link>&type=video|hd|music|image|zip&filename=<name>   (fallback path)
  const API_BASE = "https://tiktok-dl-api.dilawargithub.workers.dev";
  const apiUrl = `${API_BASE}/api/info`;
  const downloadApiUrl = `${API_BASE}/api/download`;
  const apiHost = new URL(API_BASE).hostname;
  const mediaHostPattern = /\.tiktokcdn(?:-[a-z]{2})?\.com$/i;
  const historyStorageKey = "cliptoid.downloadHistory.v1";
  const activityStorageKey = "cliptoid.activityStreak.v1";
  const downloadCountStorageKey = "cliptoid.downloadCount.v1";
  const milestoneLabels = { 1: "first", 10: "10th", 100: "100th", 1000: "1,000th", 100000: "100,000th" };
  const historyTranslations = {
    en: { title: "Download History", hint: "Use Cliptoid or download content to grow your streak and earn points.", streak: "day streak", points: "points", day: "day", days: "days", clear: "Clear history", confirm: "Clear all download history?", empty: "No downloads in this period.", reload: "Reload", delete: "Delete" },
    ar: { title: "سجل التنزيلات", hint: "استخدم Cliptoid أو نزّل المحتوى لزيادة سلسلة نشاطك وكسب النقاط.", streak: "يوم متتالٍ", points: "نقاط", day: "يوم", days: "أيام", clear: "مسح السجل", confirm: "هل تريد مسح سجل التنزيلات بالكامل؟", empty: "لا توجد تنزيلات في هذه الفترة.", reload: "إعادة التحميل", delete: "حذف" },
    de: { title: "Download-Verlauf", hint: "Nutze Cliptoid oder lade Inhalte herunter, um deine Serie auszubauen und Punkte zu sammeln.", streak: "Tage in Folge", points: "Punkte", day: "Tag", days: "Tage", clear: "Verlauf löschen", confirm: "Den gesamten Downloadverlauf löschen?", empty: "Keine Downloads in diesem Zeitraum.", reload: "Erneut laden", delete: "Löschen" },
    es: { title: "Historial de descargas", hint: "Usa Cliptoid o descarga contenido para mantener tu racha y ganar puntos.", streak: "días seguidos", points: "puntos", day: "día", days: "días", clear: "Borrar historial", confirm: "¿Borrar todo el historial de descargas?", empty: "No hay descargas en este período.", reload: "Volver a cargar", delete: "Eliminar" },
    fr: { title: "Historique des téléchargements", hint: "Utilisez Cliptoid ou téléchargez du contenu pour faire durer votre série et gagner des points.", streak: "jours d’affilée", points: "points", day: "jour", days: "jours", clear: "Effacer l’historique", confirm: "Effacer tout l’historique des téléchargements ?", empty: "Aucun téléchargement pour cette période.", reload: "Recharger", delete: "Supprimer" },
    id: { title: "Riwayat Unduhan", hint: "Gunakan Cliptoid atau unduh konten untuk menjaga rentetan dan mendapatkan poin.", streak: "hari berturut-turut", points: "poin", day: "hari", days: "hari", clear: "Hapus riwayat", confirm: "Hapus semua riwayat unduhan?", empty: "Tidak ada unduhan dalam periode ini.", reload: "Muat ulang", delete: "Hapus" },
    it: { title: "Cronologia download", hint: "Usa Cliptoid o scarica contenuti per continuare la serie e ottenere punti.", streak: "giorni di fila", points: "punti", day: "giorno", days: "giorni", clear: "Cancella cronologia", confirm: "Cancellare tutta la cronologia dei download?", empty: "Nessun download in questo periodo.", reload: "Ricarica", delete: "Elimina" },
    ja: { title: "ダウンロード履歴", hint: "Cliptoidを使ったりコンテンツをダウンロードしたりして、連続記録を伸ばしポイントを獲得しましょう。", streak: "日連続", points: "ポイント", day: "日", days: "日", clear: "履歴を消去", confirm: "すべてのダウンロード履歴を消去しますか？", empty: "この期間のダウンロードはありません。", reload: "再読み込み", delete: "削除" },
    ko: { title: "다운로드 기록", hint: "Cliptoid를 사용하거나 콘텐츠를 다운로드해 연속 기록을 이어가고 포인트를 받으세요.", streak: "일 연속", points: "포인트", day: "일", days: "일", clear: "기록 지우기", confirm: "다운로드 기록을 모두 지울까요?", empty: "이 기간에는 다운로드가 없습니다.", reload: "다시 불러오기", delete: "삭제" },
    ms: { title: "Sejarah Muat Turun", hint: "Gunakan Cliptoid atau muat turun kandungan untuk mengekalkan rentetan dan memperoleh mata.", streak: "hari berturut-turut", points: "mata", day: "hari", days: "hari", clear: "Kosongkan sejarah", confirm: "Kosongkan semua sejarah muat turun?", empty: "Tiada muat turun dalam tempoh ini.", reload: "Muat semula", delete: "Padam" },
    nl: { title: "Downloadgeschiedenis", hint: "Gebruik Cliptoid of download content om je reeks voort te zetten en punten te verdienen.", streak: "dagen op rij", points: "punten", day: "dag", days: "dagen", clear: "Geschiedenis wissen", confirm: "De volledige downloadgeschiedenis wissen?", empty: "Geen downloads in deze periode.", reload: "Opnieuw laden", delete: "Verwijderen" },
    pl: { title: "Historia pobierania", hint: "Korzystaj z Cliptoid lub pobieraj treści, aby utrzymać serię i zdobywać punkty.", streak: "dni z rzędu", points: "punkty", day: "dzień", days: "dni", clear: "Wyczyść historię", confirm: "Wyczyścić całą historię pobierania?", empty: "Brak pobrań w tym okresie.", reload: "Wczytaj ponownie", delete: "Usuń" },
    pt: { title: "Histórico de transferências", hint: "Use o Cliptoid ou transfira conteúdo para manter a sequência e ganhar pontos.", streak: "dias seguidos", points: "pontos", day: "dia", days: "dias", clear: "Limpar histórico", confirm: "Limpar todo o histórico de transferências?", empty: "Não há transferências neste período.", reload: "Recarregar", delete: "Eliminar" },
    ro: { title: "Istoricul descărcărilor", hint: "Folosește Cliptoid sau descarcă materiale pentru a continua seria și a câștiga puncte.", streak: "zile consecutive", points: "puncte", day: "zi", days: "zile", clear: "Șterge istoricul", confirm: "Ștergi tot istoricul descărcărilor?", empty: "Nu există descărcări în această perioadă.", reload: "Reîncarcă", delete: "Șterge" },
    ru: { title: "История загрузок", hint: "Пользуйтесь Cliptoid или загружайте материалы, чтобы поддерживать серию и получать баллы.", streak: "дней подряд", points: "баллов", day: "день", days: "дней", clear: "Очистить историю", confirm: "Очистить всю историю загрузок?", empty: "За этот период загрузок нет.", reload: "Обновить", delete: "Удалить" },
    th: { title: "ประวัติการดาวน์โหลด", hint: "ใช้ Cliptoid หรือดาวน์โหลดเนื้อหาเพื่อรักษาสถิติและรับคะแนน", streak: "วันติดต่อกัน", points: "คะแนน", day: "วัน", days: "วัน", clear: "ล้างประวัติ", confirm: "ล้างประวัติการดาวน์โหลดทั้งหมดหรือไม่", empty: "ไม่มีการดาวน์โหลดในช่วงนี้", reload: "โหลดใหม่", delete: "ลบ" },
    tr: { title: "İndirme Geçmişi", hint: "Serinizi sürdürmek ve puan kazanmak için Cliptoid'i kullanın veya içerik indirin.", streak: "günlük seri", points: "puan", day: "gün", days: "gün", clear: "Geçmişi temizle", confirm: "Tüm indirme geçmişi temizlensin mi?", empty: "Bu dönemde indirme yok.", reload: "Yenile", delete: "Sil" },
    uk: { title: "Історія завантажень", hint: "Користуйтеся Cliptoid або завантажуйте матеріали, щоб підтримувати серію та заробляти бали.", streak: "днів поспіль", points: "балів", day: "день", days: "днів", clear: "Очистити історію", confirm: "Очистити всю історію завантажень?", empty: "За цей період завантажень немає.", reload: "Оновити", delete: "Видалити" },
  };
  const historyLanguage = (document.documentElement.lang || "en").toLowerCase().split("-")[0];
  const historyCopy = historyTranslations[historyLanguage] || historyTranslations.en;

  // ---------------------------------------------------------------------------
  // Performance tuning constants
  // ---------------------------------------------------------------------------
  const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024; // hard cap for in-browser slideshow video building
  const API_HEDGE_MS = 2500; // start a parallel backup request if no answer by then
  const API_DEADLINE_MS = 15000; // give up on the whole lookup after this
  const INFO_STORAGE_KEY = "cliptoid.infoCache.v4"; // v4: adds signed download tokens
  const API_RATE_LIMIT_DELAY_MS = 1100; // wait before retrying after a rate-limit response
  const INFO_CACHE_TTL_MS = 10 * 60 * 1000; // CDN links expire, keep cache short
  const INFO_CACHE_MAX = 50;
  const infoCache = new Map(); // normalized post URL -> { data, time }

  // true  = the browser starts the download itself, instantly. The user can leave the page.
  //         (The page cannot read a native download's progress, so the fill is an estimate
  //          until the download is handed to the browser. The label says "Starting…", not "Downloading…".)
  // false = the file is fetched inside the page: real percentage, but the user must stay.
  const NATIVE_DOWNLOADS = true;
  const NATIVE_GRACE_MS = 2000; // how long we wait for an error before showing the checkmark

  let isLoading = false;
  let currentResult = { title: "", cover: "", tokens: null };
  let activeController = null; // AbortController for the in-flight API request
  let activeUrl = ""; // URL being fetched right now
  let lastRenderedUrl = ""; // URL whose result is currently on screen

  // Debug timing: open the site with ?debug=1 (or run localStorage.setItem("cliptoid.debug", "1"))
  // to see how long each step takes after a link is pasted.
  const DEBUG = (() => {
    try {
      return /[?&]debug=1(?:&|$)/.test(location.search) || localStorage.getItem("cliptoid.debug") === "1";
    } catch {
      return false;
    }
  })();
  let timingBase = 0;
  const startTiming = () => {
    timingBase = performance.now();
  };
  const logStep = (step) => {
    if (DEBUG) console.log(`[cliptoid] ${step}: +${Math.round(performance.now() - timingBase)} ms`);
  };

  // Non-critical page setup (SEO schema, guide text) runs when the browser is idle,
  // so it never competes with the first lookup.
  const runWhenIdle = (task) => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(task, { timeout: 2000 });
    else window.setTimeout(task, 200);
  };

  // Open the connection to the API early so the first request skips DNS + TLS setup.
  const preconnectedOrigins = new Set();
  const preconnect = (href) => {
    try {
      const origin = new URL(href).origin;
      if (preconnectedOrigins.has(origin)) return;
      preconnectedOrigins.add(origin);
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      link.crossOrigin = "";
      document.head.append(link);
    } catch {}
  };
  preconnect(apiUrl);

  const getLocalDay = (date = new Date()) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const markActiveDay = (pointsToAdd = 0) => {
    try {
      const today = getLocalDay();
      const activity = JSON.parse(localStorage.getItem(activityStorageKey) || "null") || {};
      const points = Number.isSafeInteger(activity.points) && activity.points >= 0 ? activity.points : 0;
      if (activity.lastDay === today && pointsToAdd === 0) return { ...activity, points };
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const previousStreak = Number.isSafeInteger(activity.streak) && activity.streak > 0 ? activity.streak : 0;
      const streak = activity.lastDay === today ? previousStreak : activity.lastDay === getLocalDay(yesterday) ? previousStreak + 1 : 1;
      const updatedActivity = { streak, lastDay: today, points: points + pointsToAdd };
      localStorage.setItem(activityStorageKey, JSON.stringify(updatedActivity));
      return updatedActivity;
    } catch {
      return { streak: 0, lastDay: "" };
    }
  };

  markActiveDay();
  document.querySelectorAll(".cliptoid-related-links").forEach((section) => section.remove());

  const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const createIcon = (name) => {
    const iconDefinitions = {
      lightning: {
        viewBox: "0 0 16 16",
        filled: true,
        paths: ["M11.3 0 1.5 9.7h5.2L6 16l8.5-10H9.3z"],
      },
      video: {
        paths: [
          "M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
          "m16 10 6-3v10l-6-3",
        ],
      },
      share: {
        paths: [
          "M8.6 11.1 15.4 7.3M8.6 12.9l6.8 3.8",
          "M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm8-7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 14a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
        ],
      },
      install: {
        paths: ["M12 3v10m0 0 4-4m-4 4-4-4M4 15v5h16v-5"],
      },
      audio: {
        paths: ["M11 5 6 9H3v6h3l5 4V5Z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14"],
      },
      download: {
        paths: ["M12 3v12m0 0 5-5m-5 5-5-5M5 20h14"],
      },
      coins: {
        paths: ["M12 2.75a9.25 9.25 0 1 0 0 18.5 9.25 9.25 0 0 0 0-18.5Z", "M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z", "M14.8 8.5c-.5-.8-1.4-1.2-2.8-1.2-1.5 0-2.7.7-2.7 1.8s1.2 1.8 2.7 1.8 2.7.7 2.7 1.8-1.2 1.8-2.7 1.8c-1.3 0-2.4-.5-2.9-1.4", "M12 6v12"],
      },
      copy: {
        paths: ["M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3", "M5 8h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"],
      },
      trash: {
        paths: ["M3 6h18", "M8 6V4h8v2", "m19 6-1 14H6L5 6", "M10 11v6", "M14 11v6"],
      },
      reload: {
        paths: ["M20 11a8 8 0 1 0 2 5", "M20 4v7h-7"],
      },
      repeat: {
        paths: ["m17 2 4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "m7 22-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
      },
    };
    const definition = iconDefinitions[name] || iconDefinitions.install;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", definition.viewBox || "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("cliptoid-icon");
    if (definition.filled) svg.classList.add("cliptoid-icon--filled");
    definition.paths.forEach((pathData) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.append(path);
    });
    return svg;
  };

  const addButtonIcon = (button, name, badge = "") => {
    const label = button.textContent.trim();
    const icon = createIcon(name);
    let iconElement = icon;
    if (name === "lightning") {
      const lightning = createElement("i", "bi bi-lightning-charge-fill");
      lightning.setAttribute("aria-hidden", "true");
      lightning.append(icon);
      iconElement = lightning;
    } else if (badge) {
      const iconWrap = createElement("span", "cliptoid-icon-wrap");
      iconWrap.setAttribute("aria-hidden", "true");
      iconWrap.append(icon, createElement("span", "cliptoid-format-badge", badge));
      iconElement = iconWrap;
    }
    button.replaceChildren(iconElement, createElement("span", "cliptoid-button__label", label));
  };

  const createFlameIcon = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("cliptoid-flame");
    [
      ["cliptoid-flame__outer", "M12 2c.8 3.2 5.5 5.6 5.5 12.5a5.5 5.5 0 0 1-11 0c0-2.4.9-4.2 2.2-5.4.2 1.5.9 2.5 1.8 2.9C10.2 8.6 10.6 4.8 12 2Z"],
      ["cliptoid-flame__inner", "M12 20a2.8 2.8 0 0 1-2.8-2.8c0-1.6 1.3-2.5 2.8-4 1.5 1.5 2.8 2.4 2.8 4A2.8 2.8 0 0 1 12 20Z"],
    ].forEach(([className, pathData]) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", className);
      path.setAttribute("d", pathData);
      svg.append(path);
    });
    return svg;
  };

  const setButtonLabel = (button, label) => {
    const labelElement = button.querySelector(".cliptoid-button__label");
    if (labelElement) labelElement.textContent = label;
    else button.textContent = label;
  };

  runWhenIdle(() => {
  const applicationUrl = new URL(window.location.href);
  applicationUrl.search = "";
  applicationUrl.hash = "";
  let hasSoftwareApplication = false;
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const schema = JSON.parse(script.textContent);
      const entries = Array.isArray(schema["@graph"]) ? schema["@graph"] : [schema];
      entries.forEach((entry) => {
        if (entry["@type"] === "WebApplication") entry["@type"] = "SoftwareApplication";
        if (entry["@type"] === "SoftwareApplication") hasSoftwareApplication = true;
      });
      script.textContent = JSON.stringify(schema);
    } catch {}
  });
  if (!hasSoftwareApplication) {
    const applicationSchema = createElement("script");
    applicationSchema.type = "application/ld+json";
    applicationSchema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${applicationUrl.href}#softwareapplication`,
      name: `${document.title.split("|")[0].trim()} | Cliptoid`,
      url: applicationUrl.href,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      description: document.querySelector('meta[name="description"]')?.content || "A browser-based TikTok link tool.",
    });
    document.head.append(applicationSchema);
  }

  const faqDetails = [...document.querySelectorAll("main details")];
  const hasFaqSchema = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .some((script) => script.textContent.includes('"FAQPage"'));
  if (faqDetails.length && !hasFaqSchema && !document.querySelector('[itemtype="https://schema.org/FAQPage"]')) {
    const mainEntity = faqDetails.map((details) => {
      const summary = details.querySelector("summary");
      const answer = details.cloneNode(true);
      answer.querySelector("summary")?.remove();
      return {
        "@type": "Question",
        name: summary?.textContent.trim() || "",
        acceptedAnswer: { "@type": "Answer", text: answer.textContent.trim() },
      };
    }).filter((question) => question.name && question.acceptedAnswer.text);
    if (mainEntity.length) {
      const pageUrl = new URL(window.location.href);
      pageUrl.search = "";
      pageUrl.hash = "";
      const schema = createElement("script");
      schema.type = "application/ld+json";
      schema.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", "@id": `${pageUrl.href}#faq`, mainEntity });
      document.head.append(schema);
    }
  }

  const hasHowToSchema = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .some((script) => script.textContent.includes('"HowTo"'));
  const howToHeading = [...document.querySelectorAll("main h2, main h3")]
    .find((heading) => /^how to\b/i.test(heading.textContent.trim()));
  const howToList = howToHeading?.nextElementSibling;
  if (!hasHowToSchema && howToHeading && howToList?.tagName === "OL") {
    const steps = [...howToList.querySelectorAll(":scope > li")].map((item, index) => {
      const text = item.textContent.trim();
      return { "@type": "HowToStep", position: index + 1, name: text, text };
    }).filter((step) => step.text);
    if (steps.length > 1) {
      const schema = createElement("script");
      schema.type = "application/ld+json";
      schema.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: howToHeading.textContent.trim(),
        step: steps,
      });
      document.head.append(schema);
    }
  }

  });

  if (!form || !input || !submit || !target) return;

  let selectedHistoryDays = 7;
  const historyPanel = createElement("section", "cliptoid-history");
  historyPanel.setAttribute("aria-labelledby", "cliptoid-history-title");
  const historyHeader = createElement("div", "cliptoid-history__header");
  const historyHeading = createElement("h2", "", historyCopy.title);
  historyHeading.id = "cliptoid-history-title";
  const streakLabel = createElement("p", "cliptoid-history__streak");
  const streakHint = createElement(
    "p",
    "cliptoid-history__hint",
    historyCopy.hint
  );
  const historyActions = createElement("div", "cliptoid-history__actions");
  const clearHistoryButton = createElement("button", "cliptoid-history__action", historyCopy.clear);
  clearHistoryButton.type = "button";
  addButtonIcon(clearHistoryButton, "trash");
  historyActions.append(clearHistoryButton);
  const historyTitleGroup = createElement("div", "cliptoid-history__title");
  historyTitleGroup.append(historyHeading, streakHint);
  historyHeader.append(historyTitleGroup, streakLabel, historyActions);

  const historyFilters = createElement("div", "cliptoid-history__filters");
  historyFilters.setAttribute("role", "group");
  historyFilters.setAttribute("aria-label", "Filter download history by date");
  const historyList = createElement("ul", "cliptoid-history__list");
  historyPanel.append(historyHeader, historyFilters, historyList);

  const readDownloadHistory = () => {
    try {
      const history = JSON.parse(localStorage.getItem(historyStorageKey) || "[]");
      return Array.isArray(history) ? history : [];
    } catch {
      return [];
    }
  };

  const renderHistory = () => {
    const activity = (() => {
      try {
        return JSON.parse(localStorage.getItem(activityStorageKey) || "null") || { streak: 0 };
      } catch {
        return { streak: 0 };
      }
    })();
    const streakDays = Number.isSafeInteger(activity.streak) && activity.streak > 0 ? activity.streak : 0;
    const points = Number.isSafeInteger(activity.points) && activity.points >= 0 ? activity.points : 0;
    streakLabel.classList.toggle("is-active", streakDays > 0);
    streakLabel.setAttribute("aria-label", `${streakDays} ${historyCopy.streak}, ${points} ${historyCopy.points}`);
    const pointsDisplay = createElement("span", "cliptoid-history__points");
    pointsDisplay.append(createIcon("coins"), createElement("span", "", `${points} ${historyCopy.points}`));
    streakLabel.replaceChildren(
      createFlameIcon(),
      createElement("strong", "cliptoid-history__streak-count", String(streakDays)),
      createElement("span", "cliptoid-history__streak-label", historyCopy.streak),
      pointsDisplay
    );
    historyFilters.replaceChildren();
    [1, 7, 30].forEach((days) => {
      const filter = createElement("button", "cliptoid-history__filter", `${days} ${days === 1 ? historyCopy.day : historyCopy.days}`);
      filter.type = "button";
      filter.setAttribute("aria-pressed", String(selectedHistoryDays === days));
      filter.addEventListener("click", () => {
        selectedHistoryDays = days;
        renderHistory();
      });
      historyFilters.append(filter);
    });

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - selectedHistoryDays + 1);
    const recentHistory = readDownloadHistory().filter((entry) => {
      const timestamp = Date.parse(entry.downloadedAt);
      return Number.isFinite(timestamp) && timestamp >= start.getTime();
    });
    historyList.replaceChildren();
    if (!recentHistory.length) {
      historyList.append(createElement("li", "cliptoid-history__empty", historyCopy.empty));
      return;
    }

    recentHistory.forEach((entry) => {
      const item = createElement("li", "cliptoid-history__item");
      const thumbnail = createElement("div", "cliptoid-history__thumb");
      if (typeof entry.thumbnail === "string" && /^(data:image\/jpeg;base64,|https:\/\/)/.test(entry.thumbnail)) {
        const image = createElement("img");
        image.src = entry.thumbnail;
        image.alt = "";
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => image.remove());
        thumbnail.append(image);
      }
      const details = createElement("div", "cliptoid-history__details");
      details.append(createElement("strong", "", entry.title || "TikTok video"));
      details.append(createElement("time", "", new Date(entry.downloadedAt).toLocaleString()));
      const controls = createElement("div", "cliptoid-history__item-actions");
      const reloadButton = createElement("button", "cliptoid-history__action", historyCopy.reload);
      const deleteButton = createElement("button", "cliptoid-history__action", historyCopy.delete);
      reloadButton.type = deleteButton.type = "button";
      addButtonIcon(reloadButton, "reload");
      addButtonIcon(deleteButton, "trash");
      reloadButton.disabled = !entry.sourceUrl;
      reloadButton.addEventListener("click", () => {
        input.value = entry.sourceUrl;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        runLookup(entry.sourceUrl);
      });
      deleteButton.addEventListener("click", () => {
        try {
          localStorage.setItem(historyStorageKey, JSON.stringify(readDownloadHistory().filter((savedEntry) => savedEntry.id !== entry.id)));
        } catch {}
        renderHistory();
      });
      controls.append(deleteButton, reloadButton);
      item.append(thumbnail, details, controls);
      historyList.append(item);
    });
  };

  clearHistoryButton.addEventListener("click", () => {
    if (!readDownloadHistory().length || !window.confirm(historyCopy.confirm)) return;
    try {
      localStorage.removeItem(historyStorageKey);
    } catch {}
    renderHistory();
  });
  const toolSection = target.closest("section");
  (toolSection || target).after(historyPanel);
  renderHistory();

  const createThumbnail = async (url) => {
    if (!url) return "";
    try {
      const response = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!response.ok) throw new Error("Thumbnail unavailable");
      const bitmap = await createImageBitmap(await response.blob());
      const width = 96;
      const height = 128;
      const canvas = createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const scale = Math.max(width / bitmap.width, height / bitmap.height);
      const drawWidth = bitmap.width * scale;
      const drawHeight = bitmap.height * scale;
      canvas.getContext("2d").drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      bitmap.close?.();
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return url;
    }
  };

  const incrementDownloadCount = () => {
    try {
      const stored = Number(localStorage.getItem(downloadCountStorageKey));
      const previous = Number.isSafeInteger(stored) && stored > 0 ? stored : readDownloadHistory().length;
      const count = previous + 1;
      localStorage.setItem(downloadCountStorageKey, String(count));
      return count;
    } catch {
      return 0;
    }
  };

  const startConfettiAnimation = (canvas) => {
    const context = canvas.getContext("2d");
    if (!context || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};

    const colors = ["#00D2A8", "#00A6FB", "#635BFF", "#f97316", "#fde047"];
    let particles = [];
    let frame = 0;
    let running = true;
    const timers = [];
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const burst = (originX, count) => {
      for (let index = 0; index < count; index += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
        const speed = 7 + Math.random() * 10;
        const size = 5 + Math.random() * 8;
        particles.push({
          x: originX,
          y: window.innerHeight * 0.72,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size,
          width: size * (1.2 + Math.random() * 1.8),
          rotation: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 0.42,
          age: 0,
          shape: Math.random() > 0.78 ? "circle" : Math.random() > 0.52 ? "ribbon" : "rect",
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    };
    const tick = () => {
      if (!running) return;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles = particles.filter((particle) => particle.y < window.innerHeight + 30 && particle.age < 175);
      particles.forEach((particle) => {
        particle.age += 1;
        particle.vx = particle.vx * 0.994 + Math.sin(particle.age / 15) * 0.045;
        particle.vy = particle.vy * 0.997 + 0.18;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.spin;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.globalAlpha = Math.max(0, 1 - particle.age / 175);
        context.fillStyle = particle.color;
        if (particle.shape === "circle") {
          context.beginPath();
          context.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
          context.fill();
        } else if (particle.shape === "ribbon") {
          context.fillRect(-particle.width / 2, -particle.size / 5, particle.width, particle.size * 0.4);
        } else {
          context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
        }
        context.restore();
      });
      frame = particles.length ? window.requestAnimationFrame(tick) : 0;
    };
    const scheduleTick = () => {
      if (!frame && running) frame = window.requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    const isSmallScreen = window.matchMedia("(max-width: 600px)").matches;
    const sideBurstCount = isSmallScreen ? 38 : 76;
    burst(window.innerWidth * 0.18, sideBurstCount);
    burst(window.innerWidth * 0.82, sideBurstCount);
    scheduleTick();
    timers.push(window.setTimeout(() => {
      burst(window.innerWidth * 0.5, isSmallScreen ? 58 : 112);
      scheduleTick();
    }, 240));
    timers.push(window.setTimeout(() => {
      burst(window.innerWidth * 0.32, isSmallScreen ? 24 : 44);
      burst(window.innerWidth * 0.68, isSmallScreen ? 24 : 44);
      scheduleTick();
    }, 720));
    timers.push(window.setTimeout(stopConfetti, 3100));

    function stopConfetti() {
      if (!running) return;
      running = false;
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", resize);
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    return stopConfetti;
  };

  const showFirstDownloadToast = () => {
    const canvas = createElement("canvas", "cliptoid-first-download-toast__confetti");
    canvas.setAttribute("aria-hidden", "true");
    document.body.append(canvas);
    const stopConfetti = startConfettiAnimation(canvas);
    const toast = createElement("div", "cliptoid-first-download-toast");
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.append(createElement("span", "", "Your first download is complete. Keep using Cliptoid to grow your streak and points."));
    const cancelButton = createElement("button", "", "Cancel");
    cancelButton.type = "button";
    toast.append(cancelButton);
    const dismiss = () => {
      window.clearTimeout(timer);
      stopConfetti();
      canvas.remove();
      toast.remove();
    };
    cancelButton.addEventListener("click", dismiss);
    document.body.append(toast);
    const timer = window.setTimeout(dismiss, 6500);
  };

  let celebrationOpen = false;
  const showCelebration = (count) => {
    const label = milestoneLabels[count];
    if (!label || celebrationOpen) return;
    if (count === 1) {
      showFirstDownloadToast();
      return;
    }
    celebrationOpen = true;
    const previousFocus = document.activeElement;
    const overlay = createElement("div", "cliptoid-celebration");
    const canvas = createElement("canvas", "cliptoid-celebration__confetti");
    canvas.setAttribute("aria-hidden", "true");
    const card = createElement("div", "cliptoid-celebration__card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "cliptoid-celebration-title");
    const badge = createElement("span", "cliptoid-celebration__badge");
    badge.append(createIcon("download"));
    const title = createElement("h2", "", `Congratulations on your ${label} download from Cliptoid.com`);
    title.id = "cliptoid-celebration-title";
    const detail = createElement(
      "p",
      "",
      `You have completed ${count.toLocaleString()} download${count === 1 ? "" : "s"}. Thanks for choosing Cliptoid!`
    );
    const closeButton = createElement("button", "cliptide-button cliptoid-celebration__close", "Close");
    closeButton.type = "button";
    const dismissButton = createElement("button", "cliptoid-celebration__dismiss", "\u00d7");
    dismissButton.type = "button";
    dismissButton.setAttribute("aria-label", "Close celebration");
    card.append(dismissButton, badge, title, detail, closeButton);
    overlay.append(canvas, card);
    document.body.append(overlay);

    const stopConfetti = startConfettiAnimation(canvas);

    const focusable = [dismissButton, closeButton];
    const close = () => {
      stopConfetti();
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      celebrationOpen = false;
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    };
    function onKeydown(event) {
      if (event.key === "Escape") {
        close();
      } else if (event.key === "Tab") {
        event.preventDefault();
        const index = focusable.indexOf(document.activeElement);
        const step = event.shiftKey ? -1 : 1;
        focusable[(index + step + focusable.length) % focusable.length].focus();
      }
    }
    document.addEventListener("keydown", onKeydown);
    closeButton.addEventListener("click", close);
    dismissButton.addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    closeButton.focus({ preventScroll: true });
  };

  const saveDownloadHistory = async (info, sourceUrl) => {
    markActiveDay(1);
    const downloadCount = incrementDownloadCount();
    const submittedUrl = String(sourceUrl || "").trim();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: info.title || "TikTok video",
      thumbnail: await createThumbnail(info.cover),
      sourceUrl: extractTikTokUrl(submittedUrl) || "",
      downloadedAt: new Date().toISOString(),
    };
    const history = [entry, ...readDownloadHistory()].slice(0, 100);
    try {
      localStorage.setItem(historyStorageKey, JSON.stringify(history));
    } catch {
      try {
        const trimmed = history.map((savedEntry, index) => (index < 10 ? savedEntry : { ...savedEntry, thumbnail: "" }));
        localStorage.setItem(historyStorageKey, JSON.stringify(trimmed));
      } catch {}
    }
    renderHistory();
    showCelebration(downloadCount);
  };

  const inputSpinner = createElement("span", "cliptide-input-spinner");
  inputSpinner.setAttribute("role", "status");
  inputSpinner.setAttribute("aria-label", "Fetching TikTok video");
  inputSpinner.append(
    createElement("span", "cliptide-input-spinner__arc cliptide-input-spinner__arc--outer"),
    createElement("span", "cliptide-input-spinner__arc cliptide-input-spinner__arc--inner")
  );
  input.parentElement.append(inputSpinner);
  const positionInputSpinner = () => {
    inputSpinner.style.top = `${input.offsetTop + input.offsetHeight / 2}px`;
  };
  positionInputSpinner();
  window.addEventListener("resize", positionInputSpinner, { passive: true });

  const isHomepage = location.pathname === "/" || location.pathname === "/index.html";

  if (!document.querySelector("#cliptoid-share-update") && isHomepage) runWhenIdle(() => {
    const updateSection = createElement("section", "cliptide-guide");
    updateSection.setAttribute("aria-labelledby", "cliptoid-share-update");
    const updateHeading = createElement(
      "h2",
      "",
      "What Makes Cliptoid Different from Other No-Watermark TikTok Downloaders?"
    );
    updateHeading.id = "cliptoid-share-update";
    updateSection.append(updateHeading);

    const guideList = createElement("ol");
    const guideItems = [
      '<a href="https://cliptoid.com">Install Cliptoid</a> as a PWA, then open TikTok and tap Share on the post you want to download.',
      "Tap the three-dot menu, then select Cliptoid.",
      "Tap the Cliptoid icon. Review the post link, then tap Download to save the video without a watermark directly from TikTok's share menu."
    ];

    guideItems.forEach((item) => {
      const listItem = createElement("li");
      listItem.innerHTML = item;
      guideList.append(listItem);
    });

    updateSection.append(guideList);
    updateSection.append(
      createElement(
        "p",
        "",
        "Our in-depth research found that other TikTok downloader tools do not offer this feature. It is currently available on Cliptoid.com."
      )
    );
    updateSection.append(
      createElement(
        "p",
        "",
        "If SSSTik, SnapTik, TikMate, or another TikTok downloader does not work for you, try Cliptoid.com instead."
      )
    );
    document.querySelector("main")?.append(updateSection);
  });

  form.classList.remove("htmx-request");
  submit.disabled = false;

  if (adContainer && adContainer.parentElement === target.parentElement) {
    adContainer.before(target);
  }

  if (!submit.querySelector(".bi-lightning-charge-fill")) {
    const submitLabel = submit.querySelector("span");
    const lightning = createElement("i", "bi bi-lightning-charge-fill");
    lightning.setAttribute("aria-hidden", "true");
    lightning.append(createIcon("lightning"));
    if (submitLabel) submit.insertBefore(lightning, submitLabel);
    else submit.prepend(lightning);
  }

  if (!shareButton) {
    shareRow = createElement("div", "cliptide-share-row");
    shareButton = createElement("button", "cliptide-button", "Share Cliptoid");
    shareButton.id = "cliptide-share";
    shareButton.type = "button";
    shareRow.append(shareButton);
  }
  if (!shareButton.querySelector(".cliptoid-icon")) addButtonIcon(shareButton, "share");

  const installResultButton = createElement(
    "button",
    "cliptide-button cliptide-install-result",
    "Install Cliptoid"
  );
  installResultButton.id = "cliptoid-install-result";
  installResultButton.type = "button";
  addButtonIcon(installResultButton, "install");
  shareRow.append(installResultButton);

  // ---------------------------------------------------------------------------
  // TikTok / TikTok Lite link detection
  // Accepts: bare links, links inside share text, links without https://, http://,
  // percent-encoded links, vm./vt./m./lite. hosts, /t/CODE short links,
  // /@user/video/ID, /@user/photo/ID, /share/video/ID, /embed/v2/ID, tiktokv.com/.us/.eu
  // ---------------------------------------------------------------------------
  const TIKTOK_HOST = /(?:^|\.)(?:tiktok\.com|tiktokv\.(?:com|us|eu))$/i;
  const TIKTOK_LINK = /(?:^|[^\w.-])((?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:tiktok\.com|tiktokv\.(?:com|us|eu))\/[^\s"'<>]*)/i;

  const extractTikTokUrl = (value) => {
    if (typeof value !== "string") return null;
    let text = value.trim();
    if (/^https?%3A/i.test(text)) {
      try { text = decodeURIComponent(text); } catch {}
    }
    const match = text.match(TIKTOK_LINK);
    if (!match) return null;
    const cleaned = match[1].replace(/[)\]}>.,;!?'"]+$/, "");
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
    } catch {
      return null;
    }
    if (!TIKTOK_HOST.test(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) return null;
    url.protocol = "https:";
    url.port = "";
    return url.href;
  };

  const isTikTokUrl = (value) => Boolean(extractTikTokUrl(value));

  const isTikTokSoundUrl = (value) => {
    const href = extractTikTokUrl(value);
    try {
      return href ? /\/(?:music|sound)\//i.test(new URL(href).pathname) : false;
    } catch {
      return false;
    }
  };

  const getSharedTikTokUrl = () => {
    const params = new URLSearchParams(window.location.search);
    for (const sharedValue of params.values()) {
      if (!sharedValue) continue;
      const found = extractTikTokUrl(sharedValue);
      if (found) return found;
    }
    return null;
  };

  const sharedTikTokUrl = getSharedTikTokUrl();
  if (sharedTikTokUrl) {
    input.value = sharedTikTokUrl;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const cleanUrl = new URL(window.location.href);
    ["share", "url", "text", "title"].forEach((key) => cleanUrl.searchParams.delete(key));
    window.history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }
  input.focus({ preventScroll: true });

  // Media URLs that the browser fetches directly (slideshow images) must be
  // https and come from TikTok's CDN or from the API Worker itself.
  const safeMediaUrl = (value) => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !(mediaHostPattern.test(url.hostname) || url.hostname === apiHost)) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  };

  // Display-only images (thumbnail preview) just need to be https.
  const safeImageUrl = (value) => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  };

  const getDownloadFilename = (title, extension) => {
    const digits = new Uint8Array(10);
    try {
      window.crypto.getRandomValues(digits);
    } catch {
      digits.forEach((value, index) => {
        digits[index] = Math.floor(Math.random() * 256);
      });
    }
    const uniqueNumber = `${digits[0] % 9 + 1}${Array.from(digits.slice(1), (digit) => digit % 10).join("")}`;
    return `cliptoid.com_${uniqueNumber}.${extension}`;
  };

  // File name without extension, for the Worker's /api/download?filename=... parameter.
  const getDownloadBaseName = () => getDownloadFilename("", "bin").replace(/\.bin$/, "");

  // Saves a Blob to disk through a temporary anchor element.
  const saveBlob = (blob, filename) => {
    const blobUrl = URL.createObjectURL(blob);
    const downloadLink = createElement("a");
    downloadLink.href = blobUrl;
    downloadLink.download = filename;
    downloadLink.style.position = "fixed";
    downloadLink.style.left = "-10000px";
    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  };

  // ---------------------------------------------------------------------------
  // Download helpers: signed fast links, native + in-page downloads, image fallbacks
  // ---------------------------------------------------------------------------
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  // Status line under a row of buttons.
  const dlStatusFor = (parent) => {
    const status = parent.nextElementSibling?.classList.contains("cliptide-download-status")
      ? parent.nextElementSibling
      : createElement("p", "cliptide-download-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    if (!status.isConnected) parent.after(status);
    return status;
  };

  // Uses the signed token when the Worker provided one (no lookup, starts instantly),
  // otherwise the plain link.
  const buildDownloadUrl = (postUrl, type, baseName, tokens) => {
    const url = new URL(downloadApiUrl);
    if (tokens && tokens[type]) {
      url.searchParams.set("token", tokens[type]);
    } else {
      url.searchParams.set("url", postUrl);
      url.searchParams.set("type", type);
    }
    url.searchParams.set("filename", baseName);
    return url.href;
  };

  // Image load recovery: retry once, then try TikTok's CDN directly, then give up quietly.
  const attachImageFallback = (image, onGiveUp) => {
    let step = 0;
    image.addEventListener("error", () => {
      step += 1;
      const current = image.currentSrc || image.src;
      if (step === 1) {
        image.src = current + (current.includes("?") ? "&" : "?") + "r=1";
        return;
      }
      if (step === 2) {
        try {
          const raw = new URL(current).searchParams.get("u");
          if (raw && /^https:\/\//i.test(raw)) {
            image.referrerPolicy = "no-referrer";
            image.src = raw;
            return;
          }
        } catch {}
      }
      onGiveUp?.();
    });
  };

  // Fresh lookup (new signed links) when a download link has expired.
  const refreshInfo = async (postUrl) => {
    const requestUrl = new URL(apiUrl);
    requestUrl.searchParams.set("url", postUrl);
    requestUrl.searchParams.set("fresh", "1");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const data = await requestInfo(requestUrl, controller.signal);
      const entry = { data, time: Date.now() };
      infoCache.set(postUrl, entry);
      writeStoredInfo(postUrl, entry);
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  };

  const BLOB_LIMIT = 120 * 1024 * 1024;

  // Downloads the file inside the page with progress (only used when NATIVE_DOWNLOADS is false).
  // Shows the Worker's real error message.
  const fetchMediaBlob = async (href, onProgress) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch(href, { mode: "cors", credentials: "omit", cache: "no-store", signal: controller.signal });
      const type = (response.headers.get("content-type") || "").split(";")[0];
      if (!response.ok || /json|html/i.test(type)) {
        let body = {};
        try { body = await response.json(); } catch {}
        const error = new Error(body.error || `The download service returned HTTP ${response.status}.`);
        error.retryable = body.retryable !== false;
        error.expired = response.status === 410 || body.code === "LINK_EXPIRED";
        throw error;
      }
      const total = Number(response.headers.get("content-length")) || 0;
      if (!response.body || total > BLOB_LIMIT) throw Object.assign(new Error("large"), { tooLarge: true });
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (received > BLOB_LIMIT) {
          await reader.cancel();
          throw Object.assign(new Error("large"), { tooLarge: true });
        }
        onProgress(received, total);
      }
      if (!received) throw new Error("The server returned an empty file.");
      return new Blob(chunks, { type: type || "application/octet-stream" });
    } finally {
      window.clearTimeout(timer);
    }
  };

  /* ---------------------------------------------------------------------
     Progress button: fill animation, percentage, animated checkmark
     --------------------------------------------------------------------- */

  const injectProgressStyles = () => {
    if (document.getElementById("cliptoid-progress-styles")) return;
    const style = createElement("style");
    style.id = "cliptoid-progress-styles";
    // Tweak the fill colour with:  .cliptide-download { --cliptoid-fill: rgba(255,255,255,.28); }
    style.textContent = `
  .cliptide-download{position:relative;isolation:isolate}
  .cliptide-download>.cliptoid-fill{position:absolute;top:0;bottom:0;left:0;width:0;z-index:-1;border-radius:inherit;background:var(--cliptoid-fill,rgba(255,255,255,.28));transition:width .22s linear;pointer-events:none}
  .cliptide-download.is-progress{cursor:progress}
  .cliptide-download .cliptoid-button__label{font-variant-numeric:tabular-nums}
  .cliptide-download.is-done{animation:cliptoid-pop .38s ease-out}
  .cliptide-download.is-done>.cliptoid-fill{transition:width .2s ease-out}
  .cliptoid-icon.cliptoid-check{fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
  .cliptoid-check path{stroke-dasharray:22;stroke-dashoffset:22;animation:cliptoid-check-draw .42s cubic-bezier(.65,0,.35,1) .08s forwards}
  @keyframes cliptoid-check-draw{to{stroke-dashoffset:0}}
  @keyframes cliptoid-pop{40%{transform:scale(1.03)}}
  @media (prefers-reduced-motion:reduce){
    .cliptide-download>.cliptoid-fill{transition:none}
    .cliptide-download.is-done{animation:none}
    .cliptoid-check path{animation:none;stroke-dashoffset:0}
  }`;
    document.head.append(style);
  };
  injectProgressStyles();

  const createCheckIcon = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("cliptoid-icon", "cliptoid-check");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m5 12.5 4.5 4.5L19 7.5");
    svg.append(path);
    return svg;
  };

  // Call AFTER addButtonIcon(button, ...). Returns the controller for that button.
  const createProgressButton = (button, idleLabel) => {
    const fill = createElement("span", "cliptoid-fill");
    fill.setAttribute("aria-hidden", "true");
    const idleIcon = button.firstElementChild; // the icon addButtonIcon() put there
    button.prepend(fill);
    let shown = 0;
    let resetTimer = 0;

    const setFill = (value) => {
      fill.style.width = `${value}%`;
    };
    const restore = () => {
      window.clearTimeout(resetTimer);
      button.classList.remove("is-progress", "is-done");
      button.removeAttribute("aria-busy");
      const check = button.querySelector(":scope > .cliptoid-check");
      if (check && idleIcon) check.replaceWith(idleIcon);
      fill.style.transition = "none"; // snap back instead of animating backwards
      setFill(0);
      void fill.offsetWidth;
      fill.style.transition = "";
      shown = 0;
      setButtonLabel(button, idleLabel);
    };

    const api = {
      get busy() {
        return button.classList.contains("is-progress") || button.classList.contains("is-done");
      },
      start() {
        restore();
        button.classList.add("is-progress");
        button.setAttribute("aria-busy", "true");
        api.set(0, "Starting…");
      },
      // 0–99 only; 100 is reserved for done(). Never moves backwards.
      set(percent, verb = "Downloading…") {
        const p = Math.max(shown, Math.min(99, Math.round(percent)));
        shown = p;
        setFill(p);
        setButtonLabel(button, `${verb} ${p}%`);
      },
      done(text = "Download started") {
        window.clearTimeout(resetTimer);
        button.classList.remove("is-progress");
        button.classList.add("is-done");
        button.removeAttribute("aria-busy");
        setFill(100);
        if (idleIcon && idleIcon.parentNode === button) idleIcon.replaceWith(createCheckIcon());
        setButtonLabel(button, text);
        resetTimer = window.setTimeout(restore, 2600);
      },
      fail() {
        restore();
      },
    };
    return api;
  };

  // Smooth eased fill while the browser takes over the download (see NATIVE_DOWNLOADS).
  const startSimulatedProgress = (progress, durationMs) => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      const x = Math.min(1, (performance.now() - started) / durationMs);
      progress.set(94 * (1 - Math.pow(1 - x, 2.4)), "Starting…");
    }, 80);
    return () => window.clearInterval(timer);
  };


  /* ---------------------------------------------------------------------
     Native download: the browser's own download manager does the work
     --------------------------------------------------------------------- */

  // Points a hidden iframe at the Worker's /api/download URL. The Worker answers with
  // "Content-Disposition: attachment", so the browser starts a normal download immediately
  // and keeps going even if the page is closed. If the Worker has to fail, `frame=1` makes it
  // post the error back to this page instead of showing raw JSON.
  const startNativeDownload = (href, onError) => {
    const url = new URL(href);
    url.searchParams.set("frame", "1");
    const frame = createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";

    const onMessage = (event) => {
      if (event.source !== frame.contentWindow || event.data?.type !== "cliptoid-download-error") return;
      window.removeEventListener("message", onMessage);
      const data = event.data;
      onError?.(
        Object.assign(new Error(data.error || "The download could not be started."), {
          code: data.code,
          retryable: data.retryable !== false,
          expired: data.code === "LINK_EXPIRED",
        })
      );
    };
    window.addEventListener("message", onMessage);
    window.setTimeout(() => window.removeEventListener("message", onMessage), 45000);
    window.setTimeout(() => frame.remove(), 10 * 60 * 1000);
    document.body.append(frame);
    frame.src = url.href;
  };

  // Resolves after `graceMs` without an error (download handed to the browser).
  // Rejects if the Worker reports an error first. A later error goes to onLateError.
  const nativeHandoff = (href, progress, { graceMs = NATIVE_GRACE_MS, onLateError } = {}) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const stopProgress = startSimulatedProgress(progress, graceMs * 0.95);
      startNativeDownload(href, (error) => {
        stopProgress();
        if (settled) {
          onLateError?.(error);
        } else {
          settled = true;
          reject(error);
        }
      });
      window.setTimeout(() => {
        if (settled) return;
        settled = true;
        stopProgress();
        resolve();
      }, graceMs);
    });

  // Fallback mode (NATIVE_DOWNLOADS = false): fetch inside the page with REAL progress.
  const inPageDownload = async (href, filename, progress) => {
    const blob = await fetchMediaBlob(href, (received, total) => {
      const percent = total ? (received / total) * 100 : 90 * (1 - Math.exp(-received / 6e6));
      progress.set(percent, "Downloading…");
    });
    saveBlob(blob, filename);
  };

  // One download from click to checkmark. `buildHref(tokens)` returns the Worker URL.
  // If the link has expired (or TikTok hiccuped) it fetches fresh links once and retries.
  const runDownload = async ({ progress, status, resultInfo, postUrl, buildHref, filename, graceMs }) => {
    progress.start();
    status.textContent = "Starting your download…";
    const lateError = (error) => {
      status.textContent = error.message || "The download could not be started. Please try again.";
      progress.fail();
    };
    const attemptOnce = async (href) => {
      if (NATIVE_DOWNLOADS) return nativeHandoff(href, progress, { graceMs, onLateError: lateError });
      try {
        await inPageDownload(href, filename, progress);
      } catch (error) {
        if (!error.tooLarge) throw error; // very large file: let the browser do it
        await nativeHandoff(href, progress, { graceMs, onLateError: lateError });
      }
    };

    for (let attempt = 0; ; attempt += 1) {
      const href = buildHref(resultInfo.tokens);
      try {
        await attemptOnce(href);
        saveDownloadHistory(resultInfo, postUrl);
        status.textContent = NATIVE_DOWNLOADS
          ? "Your download has started. You can keep browsing."
          : "Your download is complete.";
        progress.done(NATIVE_DOWNLOADS ? "Download started" : "Downloaded");
        return;
      } catch (error) {
        const retryable = error.expired || error.retryable || error instanceof TypeError;
        if (attempt === 0 && retryable) {
          status.textContent = "Refreshing the download link…";
          try {
            const fresh = await refreshInfo(postUrl);
            resultInfo.tokens = fresh.tokens || null;
            continue;
          } catch {
            /* fall through to the error message */
          }
        }
        status.textContent =
          error instanceof TypeError
            ? "Could not reach the download service. Check your connection and try again."
            : error.message || "Could not start the download. Please try again.";
        progress.fail();
        return;
      }
    }
  };


  /* ---------------------------------------------------------------------
     Buttons: Video / HD / MP3
     --------------------------------------------------------------------- */

  const addApiDownloadLink = (parent, type, label, postUrl, variant = "") => {
    const isAudio = type === "music";
    const ext = isAudio ? "mp3" : "mp4";
    const button = createElement(
      "button",
      `cliptide-button cliptide-download${variant ? ` cliptide-download--${variant}` : ""}`,
      label
    );
    button.type = "button";
    addButtonIcon(
      button,
      isAudio ? "audio" : variant === "hd" ? "download" : "video",
      isAudio ? "MP3" : variant === "hd" ? "HD" : "MP4"
    );
    const progress = createProgressButton(button, label);
    const resultInfo = { ...currentResult };

    button.addEventListener("click", () => {
      if (progress.busy) return;
      const base = getDownloadBaseName();
      runDownload({
        progress,
        status: dlStatusFor(parent),
        resultInfo,
        postUrl,
        filename: `${base}.${ext}`,
        buildHref: (tokens) => buildDownloadUrl(postUrl, type, base, tokens),
      });
    });
    parent.append(button);
    return true;
  };


  /* ---------------------------------------------------------------------
     Photos: all photos as one ZIP (or the single photo), and one-by-one saves
     These use the Worker's /api/download?type=zip and ?type=image&index=N.
     --------------------------------------------------------------------- */

  const addImageDownloadLink = (parent, imageUrls, postUrl) => {
    const many = imageUrls.length > 1;
    const label = many ? `Download Photos (${imageUrls.length}, ZIP)` : "Download Photo";
    const button = createElement("button", "cliptide-button cliptide-download", label);
    button.type = "button";
    addButtonIcon(button, "download");
    const progress = createProgressButton(button, label);
    const resultInfo = { ...currentResult };

    button.addEventListener("click", () => {
      if (progress.busy) return;
      const base = getDownloadBaseName();
      runDownload({
        progress,
        status: dlStatusFor(parent),
        resultInfo,
        postUrl,
        filename: `${base}.${many ? "zip" : "jpg"}`,
        // The Worker collects every slide before it answers, so give a ZIP a little longer.
        graceMs: many ? Math.min(7000, 1500 + 300 * imageUrls.length) : NATIVE_GRACE_MS,
        buildHref: () => buildDownloadUrl(postUrl, many ? "zip" : "image", base, null),
      });
    });
    parent.append(button);
    return true;
  };

  // "Save image N" under each gallery thumbnail.
  const addImageSaveButton = (item, index, postUrl) => {
    const label = `Save image ${index + 1}`;
    const button = createElement("button", "cliptide-button cliptide-download", label);
    button.type = "button";
    addButtonIcon(button, "download");
    const progress = createProgressButton(button, label);
    const resultInfo = { ...currentResult };
    const status = createElement("p", "cliptide-download-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    button.addEventListener("click", () => {
      if (progress.busy) return;
      if (!status.isConnected) item.append(status);
      const base = getDownloadBaseName();
      runDownload({
        progress,
        status,
        resultInfo,
        postUrl,
        filename: `${base}.jpg`,
        buildHref: () => {
          const link = new URL(buildDownloadUrl(postUrl, "image", base, null));
          link.searchParams.set("index", String(index));
          return link.href;
        },
      });
    });
    item.append(button);
  };


  /* ---------------------------------------------------------------------
     Slideshow video (built in the browser). Same logic as before; the button now
     shows real progress: loading images 0–30 %, recording 30–98 %, then the checkmark.
     Note: the browser records the slideshow in real time, so a 30 s sound takes ~30 s.
     --------------------------------------------------------------------- */

  const addSlideshowVideoLink = (parent, imageUrls, audioUrl, title, postDurationSeconds = 0) => {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return false;
    const VIDEO_LABEL = "Download as Video (with sound)";
    const supportedTypes = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm",
    ];
    const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return false;
    const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    const button = createElement("button", "cliptide-button cliptide-download cliptide-download--primary", VIDEO_LABEL);
    button.type = "button";
    addButtonIcon(button, "video");
    const progress = createProgressButton(button, VIDEO_LABEL);

    button.addEventListener("click", async () => {
      if (progress.busy) return;
      progress.start();
      const filename = getDownloadFilename(title, extension);
      const status = dlStatusFor(parent);
      status.textContent = "Starting slideshow video…";

      let audioContext = null;
      let audioSource = null;
      let audioDurationSeconds = 0;
      let audioFailed = false;
      let recorder;
      let stream;
      const slideBitmaps = [];
      try {
        const canvas = createElement("canvas");
        canvas.width = 720;
        canvas.height = 1280;
        const context = canvas.getContext("2d");
        stream = canvas.captureStream(24);

        // Audio and images are fetched in parallel instead of one after another.
        const loadAudio = async () => {
          if (!audioUrl) return;
          if (!(window.AudioContext || window.webkitAudioContext)) {
            audioFailed = true;
            return;
          }
          try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const resumed = audioContext.resume(); // started inside the click gesture
            const audioResponse = await fetch(audioUrl, { mode: "cors", credentials: "omit" });
            if (!audioResponse.ok) {
              audioFailed = true;
              return;
            }
            const audioBuffer = await audioContext.decodeAudioData(await audioResponse.arrayBuffer());
            await resumed;
            audioDurationSeconds = audioBuffer.duration;
            const audioDestination = audioContext.createMediaStreamDestination();
            audioSource = audioContext.createBufferSource();
            audioSource.buffer = audioBuffer;
            audioSource.connect(audioDestination);
            audioDestination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
          } catch {
            audioFailed = true;
            audioSource = null;
            if (audioContext) await audioContext.close().catch(() => {});
            audioContext = null;
          }
        };

        let receivedImageBytes = 0;
        let loadedImages = 0;
        const loadSlide = async (imageUrl) => {
          let response = null;
          for (let attempt = 0; attempt < 2 && !(response && response.ok); attempt += 1) {
            try {
              response = await fetch(imageUrl, { mode: "cors", credentials: "omit" });
            } catch {
              response = null;
            }
            if (!(response && response.ok) && attempt === 0) await sleep(600);
          }
          if (!response || !response.ok) throw new Error("A slideshow image could not be loaded.");
          const imageBlob = await response.blob();
          receivedImageBytes += imageBlob.size;
          if (receivedImageBytes > MAX_DOWNLOAD_BYTES) {
            throw new Error("These slideshow images are too large to combine safely in your browser.");
          }
          const bitmap = await createImageBitmap(imageBlob);
          loadedImages += 1;
          status.textContent = `Loading slideshow images… ${loadedImages}/${imageUrls.length}`;
          progress.set((loadedImages / imageUrls.length) * 30, "Loading…");
          return bitmap;
        };
        const loadSlides = async () => {
          const results = await Promise.allSettled(imageUrls.map(loadSlide));
          results.forEach((result) => {
            if (result.status === "fulfilled") slideBitmaps.push(result.value);
          });
          const failure = results.find((result) => result.status === "rejected");
          if (failure) throw failure.reason;
        };

        await Promise.all([loadAudio(), loadSlides()]);

        // Video length: the sound's real duration if it loaded, else the post's duration,
        // else 2.2 seconds per image. Slides share the total time equally.
        const postDuration = Number(postDurationSeconds);
        const validPostDuration = Number.isFinite(postDuration) && postDuration > 0 && postDuration <= 600;
        const validAudioDuration = Number.isFinite(audioDurationSeconds) && audioDurationSeconds > 0 && audioDurationSeconds <= 600;
        const totalDurationSeconds = validAudioDuration
          ? audioDurationSeconds
          : validPostDuration
            ? postDuration
            : imageUrls.length * 2.2;
        const slideDurationMs = (totalDurationSeconds * 1000) / slideBitmaps.length;
        const chunks = [];
        recorder = new MediaRecorder(stream, { mimeType });
        const recordingFinished = new Promise((resolve, reject) => {
          recorder.addEventListener("dataavailable", (event) => {
            if (event.data.size) chunks.push(event.data);
          });
          recorder.addEventListener("error", () => reject(new Error("The browser could not encode this slideshow.")), { once: true });
          recorder.addEventListener("stop", resolve, { once: true });
        });
        const drawSlide = (bitmap) => {
          context.fillStyle = "#000";
          context.fillRect(0, 0, canvas.width, canvas.height);
          const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
          const width = bitmap.width * scale;
          const height = bitmap.height * scale;
          context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        };
        drawSlide(slideBitmaps[0]);
        recorder.start(500);
        audioSource?.start();

        const recordingStarted = performance.now();
        const ticker = window.setInterval(() => {
          const x = Math.min(1, (performance.now() - recordingStarted) / (totalDurationSeconds * 1000));
          progress.set(30 + 68 * x, "Creating video…");
        }, 120);
        try {
          for (let index = 0; index < slideBitmaps.length; index += 1) {
            if (index > 0) drawSlide(slideBitmaps[index]);
            status.textContent = `Creating slideshow video… slide ${index + 1} of ${imageUrls.length}`;
            await new Promise((resolve) => window.setTimeout(resolve, slideDurationMs));
          }
        } finally {
          window.clearInterval(ticker);
        }
        recorder.stop();
        await recordingFinished;
        const blob = new Blob(chunks, { type: mimeType });
        saveBlob(blob, filename);
        saveDownloadHistory({ ...currentResult, title }, input.value.trim());
        status.textContent =
          `Your slideshow video download has started.` +
          (extension === "webm" ? " This browser generated WebM instead of MP4." : "") +
          (audioFailed && audioUrl ? " The sound could not be loaded, so this video has no audio." : "");
        progress.done("Download started");
      } catch (error) {
        if (recorder?.state === "recording") recorder.stop();
        status.textContent = error.name === "AbortError" ? "Download cancelled." : error.message || "Could not create the slideshow video.";
        progress.fail();
      } finally {
        slideBitmaps.forEach((bitmap) => bitmap.close?.());
        stream?.getTracks().forEach((track) => track.stop());
        if (audioContext) await audioContext.close().catch(() => {});
      }
    });
    parent.append(button);
    return true;
  };


  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const temporaryInput = createElement("textarea");
    temporaryInput.value = text;
    temporaryInput.setAttribute("readonly", "");
    temporaryInput.style.position = "fixed";
    temporaryInput.style.opacity = "0";
    document.body.append(temporaryInput);
    temporaryInput.select();
    const copied = document.execCommand("copy");
    temporaryInput.remove();
    if (!copied) throw new Error("Clipboard access is unavailable.");
  };

  const addCopySection = (container, heading, text, buttonLabel) => {
    const section = createElement("section", "cliptide-copy-section");
    section.append(createElement("h3", "", heading));
    const content = createElement("p", "cliptide-copy-text", text || "None found.");
    section.append(content);
    if (text) {
      const button = createElement("button", "cliptide-button cliptide-copy", buttonLabel);
      button.type = "button";
      addButtonIcon(button, "copy");
      button.addEventListener("click", async () => {
        try {
          await copyText(text);
          button.textContent = "Copied!";
          window.setTimeout(() => {
            button.textContent = buttonLabel;
          }, 1600);
        } catch (error) {
          showStatus(error.message, "error");
        }
      });
      section.append(button);
    }
    container.append(section);
  };

  const showStatus = (message, status) => {
    target.replaceChildren();
    const notice = createElement("p", `cliptide-status cliptide-status--${status}`, message);
    notice.setAttribute("role", status === "error" ? "alert" : "status");
    notice.setAttribute("aria-live", "polite");
    target.append(notice);
  };

  const showLoadingSkeleton = () => {
    target.replaceChildren();
    const skeleton = createElement("div", "cliptide-skeleton");
    skeleton.setAttribute("role", "status");
    skeleton.setAttribute("aria-live", "polite");
    skeleton.setAttribute("aria-busy", "true");
    skeleton.append(createElement("span", "cliptide-skeleton__sr", "Fetching TikTok content…"));

    const layout = createElement("div", "cliptide-skeleton__layout");
    const preview = createElement("div", "cliptide-skeleton__preview");
    preview.setAttribute("aria-hidden", "true");
    layout.append(preview);

    const details = createElement("div", "cliptide-skeleton__details");
    details.setAttribute("aria-hidden", "true");
    const eyebrow = createElement("div", "cliptide-skeleton__line cliptide-skeleton__line--eyebrow");
    const title = createElement("div", "cliptide-skeleton__line cliptide-skeleton__line--title");
    const author = createElement("div", "cliptide-skeleton__line cliptide-skeleton__line--short");
    details.append(eyebrow, title, author);

    const downloads = createElement("div", "cliptide-skeleton__section");
    downloads.append(createElement("div", "cliptide-skeleton__line cliptide-skeleton__line--label"));
    const actions = createElement("div", "cliptide-skeleton__actions");
    actions.append(createElement("div", "cliptide-skeleton__button"));
    actions.append(createElement("div", "cliptide-skeleton__button"));
    downloads.append(actions);
    details.append(downloads);
    layout.append(details);
    skeleton.append(layout);

    const copySections = createElement("div", "cliptide-skeleton__copy-grid");
    for (let index = 0; index < 2; index += 1) {
      const section = createElement("div", "cliptide-skeleton__section");
      section.setAttribute("aria-hidden", "true");
      section.append(createElement("div", "cliptide-skeleton__line cliptide-skeleton__line--label"));
      section.append(createElement("div", "cliptide-skeleton__line cliptide-skeleton__line--copy"));
      section.append(createElement("div", "cliptide-skeleton__button"));
      copySections.append(section);
    }
    skeleton.append(copySections);
    target.append(skeleton);
  };

  const getCaption = (title) => {
    const hashtags = [...new Set((title.match(/#[\p{L}\p{N}_]+/gu) || []))];
    const caption = title
      .replace(/#[\p{L}\p{N}_]+/gu, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.;!?])/g, "$1")
      .trim();
    return { caption, hashtags: hashtags.join(" ") };
  };

  // ---------------------------------------------------------------------------
  // API lookup: two-level cache (memory + localStorage), hedged parallel request,
  // rate-limit aware retry. Only lightweight metadata is fetched here; the video
  // itself is never downloaded until the user clicks a download button.
  // ---------------------------------------------------------------------------
  const isRateLimitError = (error) => error?.status === 429 || /limit/i.test(error?.message || "");

  // Converts the Worker's /api/info payload into the shape the UI uses.
  // Also tolerates tikwm-style field names (play / hdplay / origin_cover / ...).
  const normalizeInfo = (raw) => {
    const author = raw.author && typeof raw.author === "object" ? raw.author : {};
    const asUrl = (value) => (typeof value === "string" && /^https?:\/\//i.test(value) ? value : "");
    const play = raw.video ?? raw.play;
    const hd = raw.hd ?? raw.hdplay;
    const music = raw.music ?? raw.music_info?.play;
    const duration = Number(raw.duration);
    return {
      title: typeof raw.title === "string" ? raw.title.trim() : "",
      cover: asUrl(raw.cover || raw.origin_cover || raw.thumbnail),
      creator: String(author.username || author.unique_id || author.nickname || ""),
      images: Array.isArray(raw.images)
        ? raw.images.map((image) => (typeof image === "string" ? image : image?.url)).filter(Boolean)
        : [],
      duration: Number.isFinite(duration) ? duration : 0,
      hasVideo: Boolean(play),
      hasHd: Boolean(hd) && !(typeof hd === "string" && hd === play),
      hasAudio: Boolean(music),
      tokens: raw.tokens && typeof raw.tokens === "object" ? raw.tokens : null,
    };
  };

  const readStoredInfo = (key) => {
    try {
      const all = JSON.parse(localStorage.getItem(INFO_STORAGE_KEY) || "{}");
      const entry = all[key];
      return entry && Date.now() - entry.time < INFO_CACHE_TTL_MS ? entry : null;
    } catch {
      return null;
    }
  };

  const writeStoredInfo = (key, entry) => {
    try {
      const all = JSON.parse(localStorage.getItem(INFO_STORAGE_KEY) || "{}");
      all[key] = entry;
      const fresh = Object.entries(all)
        .filter(([, value]) => value && Date.now() - value.time < INFO_CACHE_TTL_MS)
        .sort((a, b) => b[1].time - a[1].time)
        .slice(0, 20);
      localStorage.setItem(INFO_STORAGE_KEY, JSON.stringify(Object.fromEntries(fresh)));
    } catch {}
  };

  const requestInfo = async (requestUrl, signal) => {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
      mode: "cors",
      credentials: "omit",
    });
    if (!response.ok) {
      let message = `The download service returned HTTP ${response.status}. Try again shortly.`;
      try {
        const body = await response.json();
        if (typeof body?.error === "string") message = body.error;
      } catch {}
      const httpError = new Error(message);
      httpError.status = response.status;
      httpError.fatal = response.status >= 400 && response.status < 500 && response.status !== 429;
      throw httpError;
    }
    const payload = await response.json();
    if (!payload || payload.ok !== true || !payload.data || typeof payload.data !== "object") {
      if (payload?.detail) console.debug("[cliptoid] API detail:", payload.detail);
      const apiError = new Error(payload?.error || "The service could not process this TikTok link.");
      apiError.fatal = !isRateLimitError(apiError);
      throw apiError;
    }
    return normalizeInfo(payload.data);
  };

  const fetchInfo = (normalizedUrl, signal) => {
    let cached = infoCache.get(normalizedUrl);
    if (!cached || Date.now() - cached.time >= INFO_CACHE_TTL_MS) {
      infoCache.delete(normalizedUrl);
      cached = readStoredInfo(normalizedUrl);
      if (cached) infoCache.set(normalizedUrl, cached);
    }
    if (cached) {
      logStep("API result served from cache");
      return Promise.resolve(cached.data);
    }

    const requestUrl = new URL(apiUrl);
    requestUrl.searchParams.set("url", normalizedUrl);
    const startedAt = performance.now();
    logStep("sending API request");

    return new Promise((resolve, reject) => {
      const controllers = [];
      let launched = 0;
      let pending = 0;
      let settled = false;
      let lastError;
      let hedgeTimer = 0;

      const finish = (settle, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(hedgeTimer);
        window.clearTimeout(deadlineTimer);
        controllers.forEach((controller) => controller.abort());
        settle(value);
      };
      const deadlineTimer = window.setTimeout(
        () => finish(reject, new DOMException("Timed out", "AbortError")),
        API_DEADLINE_MS
      );

      const launch = () => {
        if (settled || launched >= 2) return;
        launched += 1;
        pending += 1;
        window.clearTimeout(hedgeTimer);
        const controller = new AbortController();
        controllers.push(controller);
        const onAbort = () => controller.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        requestInfo(requestUrl, controller.signal).then(
          (data) => {
            signal.removeEventListener("abort", onAbort);
            console.debug(`[cliptoid] API lookup took ${Math.round(performance.now() - startedAt)} ms (request ${launched})`);
            const entry = { data, time: Date.now() };
            infoCache.set(normalizedUrl, entry);
            if (infoCache.size > INFO_CACHE_MAX) infoCache.delete(infoCache.keys().next().value);
            writeStoredInfo(normalizedUrl, entry);
            finish(resolve, data);
          },
          (error) => {
            signal.removeEventListener("abort", onAbort);
            pending -= 1;
            lastError = error;
            if (settled) return;
            if (signal.aborted || error.fatal) return finish(reject, error);
            if (launched < 2) {
              // First request failed fast (network error or rate limit): try again.
              window.setTimeout(launch, isRateLimitError(error) ? API_RATE_LIMIT_DELAY_MS : 0);
              return;
            }
            if (pending === 0) finish(reject, lastError);
          }
        );
        // Slow first request: start a backup in parallel; the first answer wins.
        if (launched === 1) hedgeTimer = window.setTimeout(launch, API_HEDGE_MS);
      };

      if (signal.aborted) return finish(reject, new DOMException("Aborted", "AbortError"));
      launch();
    });
  };

  const renderResult = (info, postUrl) => {
    target.replaceChildren();
    const card = createElement("article", "cliptide-result");
    card.setAttribute("aria-label", "TikTok download results");

    const title = info.title;
    const soundOnly = isTikTokSoundUrl(postUrl);
    const slideshowImages = info.images.map(safeMediaUrl).filter(Boolean);
    const previewUrl = safeImageUrl(info.cover);
    currentResult = { title, cover: previewUrl || slideshowImages[0] || "", tokens: info.tokens || null };
    const creatorName = info.creator;
    const details = createElement("div", "cliptide-result__details");
    const heading = createElement(
      "h2",
      "cliptide-result__title",
      title || "Your TikTok is ready"
    );
    details.append(heading);
    if (creatorName) {
      details.append(createElement("p", "cliptide-result__creator", `@${creatorName.replace(/^@/, "")}`));
    }

    // The main preview is above the fold, so it must not be lazy-loaded.
    if (slideshowImages.length) {
      const preview = createElement("figure", "cliptide-preview");
      const image = createElement("img");
      image.src = slideshowImages[0];
      image.alt = "Preview of the TikTok slideshow";
      image.decoding = "async";
      image.setAttribute("fetchpriority", "high");
      attachImageFallback(image, () => preview.remove());
      preview.append(image);
      preview.append(createElement("figcaption", "", "Slideshow preview"));
      card.append(preview);
    } else if (previewUrl) {
      const preview = createElement("figure", "cliptide-preview");
      const image = createElement("img");
      image.addEventListener("load", () => logStep("thumbnail loaded"), { once: true });
      image.src = previewUrl;
      image.alt = soundOnly ? "TikTok sound cover" : info.hasVideo || info.hasHd ? "TikTok video thumbnail" : "TikTok post preview";
      image.decoding = "async";
      image.setAttribute("fetchpriority", "high");
      attachImageFallback(image, () => preview.remove());
      preview.append(image);
      card.append(preview);
    }

    const top = createElement("section", "cliptide-result__content");
    top.setAttribute("aria-label", "Content preview");
    const preview = card.querySelector(".cliptide-preview");
    if (preview) top.append(preview);
    top.append(details);
    card.append(top);

    const downloads = createElement("div", "cliptide-downloads");
    if (soundOnly) {
      addApiDownloadLink(downloads, "music", "Download Sound MP3", postUrl);
    } else if (slideshowImages.length) {
      // Slideshow / image post: video with sound, photo(s), MP3 sound.
      const slideshowAudio = info.hasAudio ? buildDownloadUrl(postUrl, "music", getDownloadBaseName(), info.tokens) : null;
      if (!addSlideshowVideoLink(downloads, slideshowImages, slideshowAudio, title || "TikTok-slideshow", info.duration)) {
        downloads.append(createElement("p", "cliptide-status cliptide-status--info", "Video creation is not supported by this browser. You can still download the photos and the audio."));
      }
      addImageDownloadLink(downloads, slideshowImages, postUrl);
    } else {
      if (info.hasVideo) {
        addApiDownloadLink(downloads, "video", "Download Video MP4 (No Watermark)", postUrl, "primary");
      }
      if (info.hasHd) {
        addApiDownloadLink(
          downloads,
          "hd",
          info.hasVideo ? "Download HD Video MP4 (No Watermark)" : "Download Video MP4 (No Watermark)",
          postUrl,
          "hd"
        );
      }
    }
    if (!soundOnly && info.hasAudio) {
      addApiDownloadLink(downloads, "music", "Download Audio MP3", postUrl);
    }
    if (downloads.childElementCount) {
      const downloadSection = createElement("div", "cliptide-download-section");
      downloadSection.append(createElement("h3", "", "Download your content"));
      downloadSection.append(downloads);
      const anotherButton = createElement(
        "button",
        "cliptide-another",
        "Download another video"
      );
      anotherButton.type = "button";
      addButtonIcon(anotherButton, "repeat");
      anotherButton.addEventListener("click", () => {
        lastRenderedUrl = "";
        target.replaceChildren();
        input.value = "";
        input.focus();
      });
      downloadSection.append(anotherButton);
      card.append(downloadSection);
    }
    const resultActions = createElement("section", "cliptide-result__actions");
    resultActions.setAttribute("aria-label", "Share and install");
    if (shareRow) resultActions.append(shareRow);
    if (resultActions.childElementCount) card.append(resultActions);

    const { caption, hashtags } = getCaption(title);
    const copyGrid = createElement("div", "cliptide-copy-grid");
    addCopySection(copyGrid, "Caption", caption, "Copy caption");
    addCopySection(copyGrid, "Hashtags", hashtags, "Copy hashtags");
    card.append(copyGrid);

    if (slideshowImages.length) {
      const gallery = createElement("section", "cliptide-gallery");
      gallery.append(createElement("h3", "", `Slideshow images (${slideshowImages.length})`));
      const grid = createElement("div", "cliptide-gallery__grid");
      slideshowImages.forEach((safeUrl, index) => {
        const item = createElement("div", "cliptide-gallery__item");
        const image = createElement("img");
        image.src = safeUrl;
        image.alt = `TikTok slideshow image ${index + 1}`;
        image.loading = "lazy";
        image.decoding = "async";
        attachImageFallback(image, () => image.remove());
        item.append(image);
        addImageSaveButton(item, index, postUrl);
        grid.append(item);
      });
      if (grid.childElementCount) {
        gallery.append(grid);
        card.append(gallery);
      }
    }

    if (!downloads.childElementCount && !slideshowImages.length) {
      card.append(
        createElement(
          "p",
          "cliptide-status cliptide-status--error",
          "The API returned no downloadable media for this post."
        )
      );
    }

    target.append(card);
  };

  // Runs a lookup for the given link. It is called directly (not through the form's submit
  // event), so other scripts hooked to the form (captcha, ads, htmx) cannot delay it.
  const runLookup = async (rawValue) => {
    const normalizedUrl = extractTikTokUrl(String(rawValue || ""));
    if (!normalizedUrl) {
      showStatus("Enter a valid TikTok link to continue.", "error");
      input.focus();
      return;
    }
    // Same link already being fetched: nothing to do.
    if (isLoading && activeUrl === normalizedUrl) return;

    if (!timingBase || performance.now() - timingBase > 10000) startTiming();
    logStep("lookup started");
    markActiveDay();
    // A different link supersedes whatever was in flight (instead of being ignored).
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    activeUrl = normalizedUrl;
    isLoading = true;
    form.classList.add("htmx-request");
    submit.disabled = true;
    showLoadingSkeleton();

    try {
      const data = await fetchInfo(normalizedUrl, controller.signal);
      if (controller.signal.aborted) return;
      logStep("API data received");
      renderResult(data, normalizedUrl);
      lastRenderedUrl = normalizedUrl;
      logStep("result card rendered");
    } catch (error) {
      if (controller.signal.aborted) return; // superseded by a newer request
      lastRenderedUrl = "";
      const message =
        error.name === "AbortError"
          ? "The request timed out. Please try again."
          : error instanceof TypeError
            ? "Could not reach the download service. Check your connection and try again."
            : error.message || "Something went wrong. Please try again.";
      showStatus(message, "error");
    } finally {
      if (controller === activeController) {
        activeController = null;
        activeUrl = "";
        isLoading = false;
        form.classList.remove("htmx-request");
        submit.disabled = false;
      }
    }
  };

  // Intercept at the window in the capture phase: this runs before any handler that other
  // scripts attached to the form or the button, so nothing can hold the lookup back.
  window.addEventListener(
    "submit",
    (event) => {
      if (event.target !== form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runLookup(input.value);
    },
    true
  );
  window.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element) || !submit.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runLookup(input.value);
    },
    true
  );

  // Auto-fetch: pasted links fire immediately, typed links wait briefly so a
  // half-typed URL does not trigger a wasted request.
  let autoFetchTimer = 0;
  const autoFetch = () => {
    const current = input.value.trim();
    const normalized = extractTikTokUrl(current);
    if (!normalized) return;
    if (normalized === lastRenderedUrl) return;
    if (isLoading && activeUrl === normalized) return;
    runLookup(current);
  };
  input.addEventListener("input", (event) => {
    window.clearTimeout(autoFetchTimer);
    if (!isTikTokUrl(input.value.trim())) return;
    startTiming();
    const inputType = event.inputType || "";
    const isTyping = inputType !== "" && !/paste|drop/i.test(inputType);
    if (isTyping) autoFetchTimer = window.setTimeout(autoFetch, 200);
    else autoFetch(); // pasted: start right now, in the same event
  });

  if (sharedTikTokUrl) runLookup(sharedTikTokUrl);

  if (shareButton) {
    shareButton.addEventListener("click", async () => {
      const shareData = {
        title: document.title,
        text: "Download TikTok videos, audio, captions, and slideshow images with Cliptoid.",
        url: window.location.href,
      };
      try {
        if (navigator.share) {
          await navigator.share(shareData);
          return;
        }
        await copyText(shareData.url);
        setButtonLabel(shareButton, "Link copied!");
        window.setTimeout(() => {
          setButtonLabel(shareButton, "Share Cliptoid");
        }, 1600);
      } catch (error) {
        if (error.name !== "AbortError") {
          showStatus("Sharing is unavailable in this browser.", "error");
        }
      }
    });
  }

})();