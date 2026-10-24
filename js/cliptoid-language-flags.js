(function () {
  const languages = {
    en: { name: "English" },
    ar: { name: "Arabic" },
    de: { name: "German" },
    es: { name: "Spanish" },
    fr: { name: "French" },
    id: { name: "Indonesian" },
    it: { name: "Italian" },
    ja: { name: "Japanese" },
    ko: { name: "Korean" },
    ms: { name: "Malay" },
    nl: { name: "Dutch" },
    pl: { name: "Polish" },
    pt: { name: "Portuguese" },
    ro: { name: "Romanian" },
    ru: { name: "Russian" },
    th: { name: "Thai" },
    tr: { name: "Turkish" },
    uk: { name: "Ukrainian" }
  };
  const languageOrder = Object.keys(languages);
  const flagMarkup = {
    en: '<rect width="36" height="24" fill="#012169"/><path d="M0 0 36 24M36 0 0 24" stroke="#fff" stroke-width="6"/><path d="M0 0 36 24M36 0 0 24" stroke="#c8102e" stroke-width="2.5"/><path d="M18 0v24M0 12h36" stroke="#fff" stroke-width="8"/><path d="M18 0v24M0 12h36" stroke="#c8102e" stroke-width="4.5"/>',
    ar: '<rect width="36" height="24" fill="#006c35"/><path d="M8 16h20l3-2" fill="none" stroke="#fff" stroke-width="1.5"/><text x="18" y="10" fill="#fff" font-size="5" text-anchor="middle">الله</text>',
    de: '<path d="M0 0h36v8H0z" fill="#111"/><path d="M0 8h36v8H0z" fill="#d00"/><path d="M0 16h36v8H0z" fill="#ffce00"/>',
    es: '<path d="M0 0h36v6H0z" fill="#aa151b"/><path d="M0 6h36v12H0z" fill="#f1bf00"/><path d="M0 18h36v6H0z" fill="#aa151b"/>',
    fr: '<path d="M0 0h12v24H0z" fill="#0055a4"/><path d="M12 0h12v24H12z" fill="#fff"/><path d="M24 0h12v24H24z" fill="#ef4135"/>',
    id: '<path d="M0 0h36v12H0z" fill="#ce1126"/><path d="M0 12h36v12H0z" fill="#fff"/>',
    it: '<path d="M0 0h12v24H0z" fill="#009246"/><path d="M12 0h12v24H12z" fill="#fff"/><path d="M24 0h12v24H24z" fill="#ce2b37"/>',
    ja: '<rect width="36" height="24" fill="#fff"/><circle cx="18" cy="12" r="7" fill="#bc002d"/>',
    ko: '<rect width="36" height="24" fill="#fff"/><path d="M18 5a7 7 0 0 1 0 14 3.5 3.5 0 0 0 0-7 3.5 3.5 0 0 1 0-7" fill="#cd2e3a"/><path d="M18 19a7 7 0 0 1 0-14 3.5 3.5 0 0 0 0 7 3.5 3.5 0 0 1 0 7" fill="#0047a0"/><path d="m5 5 5 2M4 8l5 2m17 6 5 2m-4 1 5 2" stroke="#111" stroke-width="1.5"/>',
    ms: '<path d="M0 0h36v3H0zm0 6h36v3H0zm0 6h36v3H0zm0 6h36v3H0z" fill="#cc0001"/><rect width="16" height="13" fill="#010066"/><circle cx="7" cy="6.5" r="4" fill="#ffcc00"/><circle cx="8.5" cy="5.5" r="3.3" fill="#010066"/><path d="m11 2 .8 1.8 2-.1-1.5 1.3.5 1.9-1.8-1-1.7 1 .4-1.9-1.5-1.3 2 .1z" fill="#ffcc00"/>',
    nl: '<path d="M0 0h36v8H0z" fill="#ae1c28"/><path d="M0 8h36v8H0z" fill="#fff"/><path d="M0 16h36v8H0z" fill="#21468b"/>',
    pl: '<path d="M0 0h36v12H0z" fill="#fff"/><path d="M0 12h36v12H0z" fill="#dc143c"/>',
    pt: '<rect width="14" height="24" fill="#006600"/><rect x="14" width="22" height="24" fill="#ff0000"/><circle cx="14" cy="12" r="5" fill="#ffcc00"/><circle cx="14" cy="12" r="3.2" fill="#fff"/>',
    ro: '<path d="M0 0h12v24H0z" fill="#002b7f"/><path d="M12 0h12v24H12z" fill="#fcd116"/><path d="M24 0h12v24H24z" fill="#ce1126"/>',
    ru: '<path d="M0 0h36v8H0z" fill="#fff"/><path d="M0 8h36v8H0z" fill="#0039a6"/><path d="M0 16h36v8H0z" fill="#d52b1e"/>',
    th: '<path d="M0 0h36v4H0z" fill="#a51931"/><path d="M0 4h36v4H0z" fill="#fff"/><path d="M0 8h36v8H0z" fill="#2d2a4a"/><path d="M0 16h36v4H0z" fill="#fff"/><path d="M0 20h36v4H0z" fill="#a51931"/>',
    tr: '<rect width="36" height="24" fill="#e30a17"/><circle cx="14" cy="12" r="7" fill="#fff"/><circle cx="17" cy="10.5" r="5.6" fill="#e30a17"/><path d="m23 8 1.3 2.8 3-.3-2.2 2  .7 3-2.8-1.5-2.6 1.5.5-3-2.2-2 3 .3z" fill="#fff"/>',
    uk: '<path d="M0 0h36v12H0z" fill="#0057b7"/><path d="M0 12h36v12H0z" fill="#ffd700"/>'
  };

  function createFlag(code) {
    const flag = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    flag.setAttribute("class", "language-flag-icon");
    flag.setAttribute("viewBox", "0 0 36 24");
    flag.setAttribute("focusable", "false");
    flag.setAttribute("aria-hidden", "true");
    flag.innerHTML = flagMarkup[code];
    return flag;
  }

  const currentLanguage = document.documentElement.lang.toLowerCase().split("-")[0];
  const footerLinks = Array.from(
    document.querySelectorAll("#language-switcher a[lang]")
  );
  const alternateLinks = Array.from(
    document.querySelectorAll('link[rel="alternate"][hreflang]')
  );
  const destinations = new Map();

  footerLinks.forEach((link) => {
    const code = link.lang.toLowerCase().split("-")[0];
    if (languages[code] && !destinations.has(code)) {
      destinations.set(code, link.getAttribute("href"));
    }
  });

  alternateLinks.forEach((link) => {
    const code = link.hreflang.toLowerCase().split("-")[0];
    if (languages[code] && !destinations.has(code)) {
      destinations.set(code, link.href);
    }
  });

  const siteRoot = new URL(
    "../",
    document.querySelector('script[src*="cliptoid-language-flags.js"]').src
  );
  const translatedPage = window.location.pathname.match(
    /\/(?:ar|de|es|fr|id|it|ja|ko|ms|nl|pl|pt|ro|ru|th|tr|uk)\/(.+)$/
  );
  languageOrder.forEach((code) => {
    if (destinations.has(code)) {
      return;
    }

    const href = translatedPage
      ? `${code === "en" ? "" : `${code}/`}${translatedPage[1]}`
      : `${code}.html`;
    destinations.set(code, new URL(href, siteRoot).href);
  });

  if (languages[currentLanguage]) {
    destinations.set(
      currentLanguage,
      window.location.pathname + window.location.search + window.location.hash
    );
  }

  footerLinks.forEach((link) => {
    const code = link.lang.toLowerCase().split("-")[0];
    if (!languages[code] || link.querySelector(".language-flag")) {
      return;
    }

    const flag = document.createElement("span");
    flag.className = "language-flag";
    flag.setAttribute("aria-hidden", "true");
    flag.append(createFlag(code));
    link.prepend(flag);
  });

  const selectedLanguage = document.querySelector("#language-switcher #menuLink1");
  if (languages[currentLanguage] && selectedLanguage && !selectedLanguage.querySelector(".language-flag")) {
    const flag = document.createElement("span");
    flag.className = "language-flag";
    flag.setAttribute("aria-hidden", "true");
    flag.append(createFlag(currentLanguage));
    selectedLanguage.prepend(flag);
  }

  const menuWrapper = document.querySelector(".menu-wrapper");
  const menuToggle = menuWrapper?.querySelector("#menu__toggle__wrapper");
  if (!menuWrapper || !menuToggle || menuWrapper.querySelector(".language-picker")) {
    return;
  }

  const picker = document.createElement("div");
  picker.className = "language-picker";

  const toggle = document.createElement("button");
  toggle.className = "language-picker__toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", `Language: ${languages[currentLanguage]?.name || "Choose language"}`);
  toggle.setAttribute("aria-expanded", "false");
  toggle.title = languages[currentLanguage]?.name || "Choose language";
  if (languages[currentLanguage]) {
    toggle.append(createFlag(currentLanguage));
  } else {
    toggle.textContent = "Language";
  }

  const navigation = document.createElement("nav");
  navigation.className = "language-picker__menu";
  navigation.id = "language-picker-menu";
  navigation.setAttribute("aria-label", "Choose language");
  navigation.hidden = true;
  toggle.setAttribute("aria-controls", navigation.id);

  languageOrder.forEach((code) => {
    const href = destinations.get(code);
    if (!href) {
      return;
    }

    const link = document.createElement("a");
    link.href = href;
    link.lang = code;
    link.title = languages[code].name;
    link.setAttribute("aria-label", languages[code].name);
    link.append(createFlag(code));
    navigation.append(link);
  });

  if (navigation.childElementCount) {
    picker.append(toggle, navigation);
    menuWrapper.insertBefore(picker, menuToggle);

    toggle.addEventListener("click", () => {
      const isExpanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!isExpanded));
      navigation.hidden = isExpanded;
    });

    document.addEventListener("click", (event) => {
      if (!picker.contains(event.target)) {
        toggle.setAttribute("aria-expanded", "false");
        navigation.hidden = true;
      }
    });

    picker.addEventListener("focusout", (event) => {
      if (!picker.contains(event.relatedTarget)) {
        toggle.setAttribute("aria-expanded", "false");
        navigation.hidden = true;
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !navigation.hidden) {
        toggle.setAttribute("aria-expanded", "false");
        navigation.hidden = true;
        toggle.focus();
      }
    });
  }
})();
