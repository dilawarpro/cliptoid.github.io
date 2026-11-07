(() => {
  "use strict";

  const header = document.querySelector(".cliptoid-seo-header");
  const main = document.querySelector(".cliptoid-seo-main");
  if (!header || !main) return;

  const title = main.querySelector("h1")?.textContent.trim() || "TikTok Downloader";
  main.querySelector("h1")?.remove();
  main.querySelector(".cliptoid-seo-cta")?.remove();

  header.replaceChildren();
  header.className = "home-menu pure-menu pure-menu-horizontal cliptoid-seo-header--downloader";
  const menuWrapper = document.createElement("div");
  menuWrapper.className = "menu-wrapper";

  const brand = document.createElement("a");
  brand.className = "pure-menu-heading cliptoid-seo-brand";
  brand.href = "/";
  brand.setAttribute("aria-label", "Cliptoid home");
  const brandContent = document.createElement("div");
  brandContent.className = "sss";
  const logo = document.createElement("img");
  logo.src = "/images/cliptoid-app.svg";
  logo.alt = "";
  logo.width = 32;
  logo.height = 32;
  const brandName = document.createElement("div");
  brandName.textContent = "Cliptoid";
  brandContent.append(logo, brandName);
  brand.append(brandContent);

  const nav = document.createElement("nav");
  nav.className = "cliptoid-seo-nav";
  nav.setAttribute("aria-label", "Cliptoid tools");
  [
    ["Downloader guide", "/tiktok-download-guide.html"],
    ["TikTok MP3", "/download-tiktok-mp3.html"],
    ["Slideshow images", "/download-tiktok-stories.html"],
    ["Help", "/tiktok-download-not-working.html"],
    ["Compare tools", "/cliptoid-vs-snaptik.html"],
    ["Updates", "/changelog.html"],
  ].forEach(([label, href]) => {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    nav.append(link);
  });

  const installButton = document.createElement("button");
  installButton.type = "button";
  installButton.id = "dwapp_image";
  installButton.className = "cliptide-button cliptoid-seo-install";
  installButton.textContent = "Install Cliptoid";
  menuWrapper.append(brand, installButton, nav);
  header.append(menuWrapper);

  const splash = document.createElement("section");
  splash.className = "splash-container";
  splash.id = "splash";
  splash.setAttribute("aria-label", "TikTok downloader");
  const wrapper = document.createElement("div");
  wrapper.className = "splash";
  wrapper.id = "splash_wrapper";
  wrapper.style.maxWidth = "1680px";
  const heading = document.createElement("h1");
  heading.className = "splash-head hide-after-request";
  heading.id = "bigmessage";
  heading.textContent = title;
  const errorContainer = document.createElement("div");
  errorContainer.className = "error-container-wrapper";
  errorContainer.append(Object.assign(document.createElement("div"), { id: "errorContainer" }));

  const form = document.createElement("form");
  form.className = "pure-form pure-g hide-after-request";
  form.id = "_gcaptcha_pt";
  form.rel = "nofollow";
  const inputWrapper = document.createElement("div");
  inputWrapper.className = "relative u-fw";
  const input = document.createElement("input");
  input.id = "main_page_text";
  input.name = "id";
  input.type = "text";
  input.className = "form-control input-lg";
  input.title = "https://www.tiktok.com/@username/video/1234567890";
  input.placeholder = "Paste a TikTok link here";
  input.required = true;
  const locale = document.createElement("input");
  locale.id = "locale";
  locale.name = "locale";
  locale.type = "hidden";
  locale.value = "en";
  const pasteButton = document.createElement("button");
  pasteButton.id = "paste";
  pasteButton.type = "button";
  pasteButton.textContent = "Paste";
  const clearButton = document.createElement("button");
  clearButton.id = "clear";
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  clearButton.hidden = true;
  const submitButton = document.createElement("button");
  submitButton.id = "submit";
  submitButton.type = "submit";
  submitButton.className = "vignette_active pure-button-primary";
  const submitLabel = document.createElement("span");
  submitLabel.textContent = "Download";
  const waitLabel = document.createElement("span");
  waitLabel.textContent = "Please wait";
  submitButton.append(submitLabel, waitLabel);
  inputWrapper.append(input, locale, pasteButton, clearButton, submitButton);
  form.append(inputWrapper);
  const target = document.createElement("div");
  target.id = "target";
  wrapper.append(heading, errorContainer, form, target);
  splash.append(wrapper);
  header.after(splash);

  const refreshInputControls = () => {
    const hasValue = Boolean(input.value.trim());
    pasteButton.hidden = hasValue;
    clearButton.hidden = !hasValue;
  };
  input.addEventListener("input", refreshInputControls);
  pasteButton.addEventListener("click", async () => {
    try {
      input.value = await navigator.clipboard.readText();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    } catch {
      errorContainer.firstElementChild.textContent = "Clipboard access is unavailable. Paste your TikTok link into the field.";
    }
  });
  clearButton.addEventListener("click", () => {
    input.value = "";
    target.replaceChildren();
    refreshInputControls();
    input.focus();
  });
})();
