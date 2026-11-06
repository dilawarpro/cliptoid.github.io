(() => {
  "use strict";

  const form = document.querySelector("#_gcaptcha_pt");
  const input = document.querySelector("#main_page_text");
  const submit = document.querySelector("#submit");
  const target = document.querySelector("#target");
  const adContainer = document.querySelector("#ad_main");
  let shareButton = document.querySelector("#cliptide-share");
  let shareRow = document.querySelector(".cliptide-share-row");
  const apiUrl = "https://www.tikwm.com/api/";
  const mediaHostPattern = /\.tiktokcdn(?:-[a-z]{2})?\.com$/i;
  const historyStorageKey = "cliptoid.downloadHistory.v1";
  const activityStorageKey = "cliptoid.activityStreak.v1";
  const downloadCountStorageKey = "cliptoid.downloadCount.v1";
  const milestoneLabels = { 1: "first", 10: "10th", 100: "100th", 1000: "1,000th", 100000: "100,000th" };
  let isLoading = false;
  let currentResult = { title: "", cover: "" };

  const getLocalDay = (date = new Date()) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const markActiveDay = () => {
    try {
      const today = getLocalDay();
      const activity = JSON.parse(localStorage.getItem(activityStorageKey) || "null") || {};
      if (activity.lastDay === today) return activity;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const previousStreak = Number.isSafeInteger(activity.streak) && activity.streak > 0 ? activity.streak : 0;
      const streak = activity.lastDay === getLocalDay(yesterday) ? previousStreak + 1 : 1;
      const updatedActivity = { streak, lastDay: today };
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
        viewBox: "0 0 16 16",
        filled: true,
        paths: ["M9 13.5V2l7-1.5v11M9 13.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm7-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"],
      },
      download: {
        paths: ["M12 3v12m0 0 5-5m-5 5-5-5M5 20h14"],
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

  if (!form || !input || !submit || !target) return;

  let selectedHistoryDays = 7;
  const historyPanel = createElement("section", "cliptoid-history");
  historyPanel.setAttribute("aria-labelledby", "cliptoid-history-title");
  const historyHeader = createElement("div", "cliptoid-history__header");
  const historyHeading = createElement("h2", "", "Your activity");
  historyHeading.id = "cliptoid-history-title";
  const streakLabel = createElement("p", "cliptoid-history__streak");
  const streakHint = createElement(
    "p",
    "cliptoid-history__hint",
    "Visit or download every day to keep your streak growing."
  );
  const historyActions = createElement("div", "cliptoid-history__actions");
  const clearHistoryButton = createElement("button", "cliptoid-history__action", "Clear history");
  clearHistoryButton.type = "button";
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
    streakLabel.classList.toggle("is-active", streakDays > 0);
    streakLabel.setAttribute("aria-label", `Current streak: ${streakDays} ${streakDays === 1 ? "day" : "days"}`);
    streakLabel.replaceChildren(
      createFlameIcon(),
      createElement("strong", "cliptoid-history__streak-count", String(streakDays)),
      createElement("span", "cliptoid-history__streak-label", "day streak")
    );
    historyFilters.replaceChildren();
    [1, 7, 30].forEach((days) => {
      const filter = createElement("button", "cliptoid-history__filter", `${days} day${days === 1 ? "" : "s"}`);
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
      historyList.append(createElement("li", "cliptoid-history__empty", "No downloads in this period."));
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
      const reloadButton = createElement("button", "cliptoid-history__action", "Reload");
      const deleteButton = createElement("button", "cliptoid-history__action", "Delete");
      reloadButton.type = deleteButton.type = "button";
      reloadButton.disabled = !entry.sourceUrl;
      reloadButton.addEventListener("click", () => {
        input.value = entry.sourceUrl;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        form.requestSubmit(submit);
      });
      deleteButton.addEventListener("click", () => {
        try {
          localStorage.setItem(historyStorageKey, JSON.stringify(readDownloadHistory().filter((savedEntry) => savedEntry.id !== entry.id)));
        } catch {}
        renderHistory();
      });
      controls.append(reloadButton, deleteButton);
      item.append(thumbnail, details, controls);
      historyList.append(item);
    });
  };

  clearHistoryButton.addEventListener("click", () => {
    if (!readDownloadHistory().length || !window.confirm("Clear all download history?")) return;
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

  let celebrationOpen = false;
  const showCelebration = (count) => {
    const label = milestoneLabels[count];
    if (!label || celebrationOpen) return;
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

    const context = canvas.getContext("2d");
    const colors = ["#00D2A8", "#00A6FB", "#635BFF", "#f97316", "#fde047"];
    let particles = [];
    let frame = 0;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const burst = (originX, count) => {
      for (let index = 0; index < count; index += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
        const speed = 7 + Math.random() * 11;
        particles.push({
          x: originX,
          y: window.innerHeight * 0.65,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 6 + Math.random() * 7,
          rotation: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 0.4,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    };
    const tick = () => {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles = particles.filter((particle) => particle.y < window.innerHeight + 20);
      particles.forEach((particle) => {
        particle.vx *= 0.99;
        particle.vy = particle.vy * 0.99 + 0.3;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.spin;
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.fillStyle = particle.color;
        context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
        context.restore();
      });
      if (particles.length) frame = window.requestAnimationFrame(tick);
    };
    const burstTimers = [];
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      resize();
      window.addEventListener("resize", resize, { passive: true });
      burst(window.innerWidth * 0.3, 90);
      burst(window.innerWidth * 0.7, 90);
      frame = window.requestAnimationFrame(tick);
      burstTimers.push(window.setTimeout(() => {
        burst(window.innerWidth * 0.5, 120);
        frame = window.requestAnimationFrame(tick);
      }, 450));
    }

    const focusable = [dismissButton, closeButton];
    const close = () => {
      window.cancelAnimationFrame(frame);
      burstTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", resize);
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
    markActiveDay();
    const downloadCount = incrementDownloadCount();
    const submittedUrl = sourceUrl.trim();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: info.title || "TikTok video",
      thumbnail: await createThumbnail(info.cover),
      sourceUrl: isTikTokUrl(submittedUrl) ? (/^https:\/\//i.test(submittedUrl) ? submittedUrl : `https://${submittedUrl}`) : "",
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

  if (!document.querySelector("#cliptoid-share-update") && isHomepage) {
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
  }

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

  const isTikTokUrl = (value) => {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return false;
    }
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      (url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com"))
    );
  };

  const getSharedTikTokUrl = () => {
    const params = new URLSearchParams(window.location.search);
    for (const sharedValue of params.values()) {
      if (!sharedValue) continue;
      const candidates =
        sharedValue.match(/https?:\/\/[^\s<>"']+/gi) ||
        sharedValue.match(/(?:[\w-]+\.)*tiktok\.com\/[^\s<>"']+/gi) ||
        [sharedValue.trim()];
      for (const candidate of candidates) {
        const cleanedCandidate = candidate.replace(/[.,!;:)\]}]+$/g, "");
        if (isTikTokUrl(cleanedCandidate)) {
          return /^https:\/\//i.test(cleanedCandidate)
            ? cleanedCandidate
            : `https://${cleanedCandidate}`;
        }
      }
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

  const safeMediaUrl = (value) => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !mediaHostPattern.test(url.hostname)) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  };

  const getDownloadFilename = (title, extension) => {
    const fallbackName = `TikTok-clip-${Math.random().toString(36).slice(2, 8) || Date.now().toString(36)}`;
    const safeTitle = (typeof title === "string" ? title : "")
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 100);
    const baseName = safeTitle || fallbackName;
    return `${baseName} - downloaded by cliptoid.com.${extension}`;
  };

  const addDownloadLink = (parent, url, label, filename, variant = "") => {
    const safeUrl = safeMediaUrl(url);
    if (!safeUrl) return false;
    const sourcePostUrl = input.value.trim();
    const resultInfo = { ...currentResult };
    const button = createElement(
      "button",
      `cliptide-button cliptide-download${variant ? ` cliptide-download--${variant}` : ""}`,
      label
    );
    button.type = "button";
    const isAudio = filename.endsWith(".mp3");
    addButtonIcon(
      button,
      isAudio ? "audio" : variant === "hd" ? "download" : "video",
      isAudio ? "MP3" : variant === "hd" ? "HD" : "MP4"
    );
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      const mediaType = filename.endsWith(".mp3") ? "audio" : "video";
      const status =
        parent.nextElementSibling?.classList.contains("cliptide-download-status")
          ? parent.nextElementSibling
          : createElement("p", "cliptide-download-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.textContent = `Preparing ${mediaType} download…`;
      if (!status.isConnected) parent.after(status);
      setButtonLabel(button, `Preparing ${mediaType}…`);
      const downloadController = new AbortController();
      const downloadTimeout = window.setTimeout(() => downloadController.abort(), 120000);

      try {
        const response = await fetch(safeUrl, {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          signal: downloadController.signal,
        });
        if (!response.ok) {
          throw new Error(`Media server returned HTTP ${response.status}. Try again shortly.`);
        }
        if (!response.body) throw new Error("This browser cannot stream the media download.");

        const declaredLength = Number(response.headers.get("content-length"));
        const maxDownloadBytes = 150 * 1024 * 1024;
        if (declaredLength > maxDownloadBytes) {
          throw new Error("This file is too large to prepare safely in your browser.");
        }

        const reader = response.body.getReader();
        const chunks = [];
        let receivedLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedLength += value.byteLength;
          if (receivedLength > maxDownloadBytes) {
            await reader.cancel();
            throw new Error("This file is too large to prepare safely in your browser.");
          }
          chunks.push(value);
          if (declaredLength > 0) {
            const progress = Math.min(99, Math.round((receivedLength / declaredLength) * 100));
            status.textContent = `Preparing ${mediaType} download… ${progress}%`;
            setButtonLabel(button, `Preparing… ${progress}%`);
          }
        }
        if (!receivedLength) throw new Error("The media server returned an empty file.");
        window.clearTimeout(downloadTimeout);

        const blob = new Blob(chunks, {
          type: filename.endsWith(".mp3") ? "audio/mpeg" : "video/mp4",
        });
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
        saveDownloadHistory(resultInfo, sourcePostUrl);
        status.textContent = "Your download has started.";
        setButtonLabel(button, "Download started");
        window.setTimeout(() => {
          setButtonLabel(button, label);
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }, 1800);
        return;
      } catch (error) {
        window.clearTimeout(downloadTimeout);
        status.textContent =
          error instanceof TypeError
            ? "Could not fetch this file directly. The media server may temporarily block downloads; please retry."
            : error.message || "Could not start the download. Please try again.";
      }
      setButtonLabel(button, label);
      button.disabled = false;
      button.removeAttribute("aria-busy");
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

  const renderResult = (data) => {
    target.replaceChildren();
    const card = createElement("article", "cliptide-result");
    card.setAttribute("aria-label", "TikTok download results");

    const title = typeof data.title === "string" ? data.title.trim() : "";
    const slideshowImages = Array.isArray(data.images)
      ? data.images
          .map((image) => (typeof image === "string" ? image : image?.url))
          .map(safeMediaUrl)
          .filter(Boolean)
      : [];
    const previewUrl = safeMediaUrl(data.cover || data.origin_cover || data.ai_dynamic_cover);
    currentResult = { title, cover: previewUrl || slideshowImages[0] || "" };
    const videoUrl = safeMediaUrl(data.hdplay || data.play);
    const creatorName =
      typeof data.author?.nickname === "string"
        ? data.author.nickname
        : typeof data.author?.unique_id === "string"
          ? data.author.unique_id
          : "";
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

    if (slideshowImages.length) {
      const preview = createElement("figure", "cliptide-preview");
      const image = createElement("img");
      image.src = slideshowImages[0];
      image.alt = "Preview of the TikTok slideshow";
      image.loading = "lazy";
      preview.append(image);
      preview.append(createElement("figcaption", "", "Slideshow preview"));
      card.append(preview);
    } else if (previewUrl) {
      const preview = createElement("figure", "cliptide-preview");
      const image = createElement("img");
      image.src = previewUrl;
      image.alt = videoUrl ? "TikTok video thumbnail" : "TikTok post preview";
      image.loading = "lazy";
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
    const playUrl = safeMediaUrl(data.play);
    const hdVideoUrl = safeMediaUrl(data.hdplay);
    const regularVideoUrl = playUrl || hdVideoUrl;
    const hdOnly = !playUrl && Boolean(hdVideoUrl);
    addDownloadLink(
      downloads,
      regularVideoUrl,
      "Download Video MP4 (No Watermark)",
      getDownloadFilename(title, "mp4"),
      hdOnly ? "hd" : "primary"
    );
    if (playUrl && hdVideoUrl && hdVideoUrl !== playUrl) {
      addDownloadLink(
        downloads,
        hdVideoUrl,
        "Download HD Video MP4 (No Watermark)",
        getDownloadFilename(title, "mp4"),
        "hd"
      );
    }
    addDownloadLink(
      downloads,
      data.music || data.music_info?.play,
      "Download Audio MP3",
      getDownloadFilename(title, "mp3")
    );
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
      anotherButton.addEventListener("click", () => {
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
        item.append(image);
        addDownloadLink(
          item,
          safeUrl,
          `Save image ${index + 1}`,
          getDownloadFilename(`${title || "TikTok-slideshow"}-slide-${index + 1}`, "jpg")
        );
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

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isLoading) return;

      const sourceUrl = input.value.trim();
      if (!isTikTokUrl(sourceUrl)) {
        showStatus("Enter a valid HTTPS TikTok link to continue.", "error");
        input.focus();
        return;
      }

      const normalizedUrl = /^https:\/\//i.test(sourceUrl)
        ? sourceUrl
        : `https://${sourceUrl}`;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 25000);
      isLoading = true;
      form.classList.add("htmx-request");
      submit.disabled = true;
      showLoadingSkeleton();

      try {
        const requestUrl = new URL(apiUrl);
        requestUrl.searchParams.set("url", normalizedUrl);
        requestUrl.searchParams.set("hd", "1");
        const response = await fetch(requestUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
          mode: "cors",
          credentials: "omit",
        });
        if (!response.ok) {
          throw new Error(`The download service returned HTTP ${response.status}. Try again shortly.`);
        }
        const payload = await response.json();
        if (Number(payload.code) !== 0 || !payload.data || typeof payload.data !== "object") {
          throw new Error(payload.msg || "The service could not process this TikTok link.");
        }
        renderResult(payload.data);
      } catch (error) {
        const message =
          error.name === "AbortError"
            ? "The request timed out. Please try again."
            : error instanceof TypeError
              ? "Could not reach the download service. Check your connection and try again."
              : error.message || "Something went wrong. Please try again.";
        showStatus(message, "error");
      } finally {
        window.clearTimeout(timeout);
        isLoading = false;
        form.classList.remove("htmx-request");
        submit.disabled = false;
      }
    },
    true
  );

  let autoFetchTimer = 0;
  input.addEventListener("input", () => {
    window.clearTimeout(autoFetchTimer);
    if (!isTikTokUrl(input.value.trim())) return;

    autoFetchTimer = window.setTimeout(() => {
      if (!isLoading && isTikTokUrl(input.value.trim())) form.requestSubmit();
    }, 100);
  });

  if (sharedTikTokUrl) form.requestSubmit();

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
