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
  let isLoading = false;

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

  const setButtonLabel = (button, label) => {
    const labelElement = button.querySelector(".cliptoid-button__label");
    if (labelElement) labelElement.textContent = label;
    else button.textContent = label;
  };

  if (!form || !input || !submit || !target) return;

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
    } else if (videoUrl) {
      const preview = createElement("div", "cliptide-preview");
      const video = createElement("video", "cliptide-preview__video");
      video.controls = true;
      video.preload = "none";
      video.playsInline = true;
      video.src = videoUrl;
      if (previewUrl) video.poster = previewUrl;
      preview.append(video);
      card.append(preview);
    } else if (previewUrl) {
      const preview = createElement("figure", "cliptide-preview");
      const image = createElement("img");
      image.src = previewUrl;
      image.alt = "TikTok post preview";
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
