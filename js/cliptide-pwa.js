(() => {
  "use strict";

  const installControlSelector = "#dwapp_image, #cliptoid-install-result, #cliptoid-install-link";
  const getInstallControls = () => [...document.querySelectorAll(installControlSelector)];
  const installedStorageKey = "cliptoid-pwa-installed";
  const isRunningInstalledApp = () =>
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const hasStoredInstallation = () => {
    try {
      return window.localStorage.getItem(installedStorageKey) === "true";
    } catch {
      return false;
    }
  };
  const rememberInstallation = () => {
    try {
      window.localStorage.setItem(installedStorageKey, "true");
    } catch {}
  };
  const clearRememberedInstallation = () => {
    try {
      window.localStorage.removeItem(installedStorageKey);
    } catch {}
  };
  const isAppInstalled = () => isRunningInstalledApp() || hasStoredInstallation();
  const hideInstallControls = () => {
    getInstallControls().forEach((control) => {
      control.hidden = true;
    });
  };
  const showInstallControls = () => {
    getInstallControls().forEach((control) => {
      control.hidden = false;
    });
  };
  let installPrompt = null;

  if (isRunningInstalledApp()) rememberInstallation();
  if (isAppInstalled()) hideInstallControls();

  const menuToggle = document.querySelector("#menu_toggler");
  const menuWrapper = menuToggle?.closest(".menu-wrapper");
  const primaryNav = document.querySelector(".cliptoid-primary-nav");
  if (menuToggle && menuWrapper && primaryNav) {
    menuToggle.setAttribute("aria-label", "Toggle main navigation");
    menuToggle.setAttribute("aria-controls", primaryNav.id);
    menuToggle.setAttribute("aria-expanded", "false");

    const closeNavigation = () => {
      menuToggle.checked = false;
      menuToggle.setAttribute("aria-expanded", "false");
      menuWrapper.classList.remove("cliptoid-nav-open");
    };

    menuToggle.addEventListener("change", () => {
      menuWrapper.classList.toggle("cliptoid-nav-open", menuToggle.checked);
      menuToggle.setAttribute("aria-expanded", String(menuToggle.checked));
    });

    menuToggle.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuToggle.checked) {
        closeNavigation();
      }
    });

    primaryNav.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a")) {
        closeNavigation();
      }
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    if (!getInstallControls().length) return;
    event.preventDefault();
    if (!isRunningInstalledApp()) {
      clearRememberedInstallation();
      showInstallControls();
    }
    installPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    rememberInstallation();
    hideInstallControls();
  });

  const showInstallStatus = (control, message) => {
    let status = document.querySelector(`#${control.id}-status`);
    if (!status) {
      status = document.createElement("p");
      status.id = `${control.id}-status`;
      status.className = "cliptide-install-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      control.after(status);
    }
    status.textContent = message;
  };

  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const installControl = event.target.closest(installControlSelector);
    if (!installControl) return;

    event.preventDefault();
    if (installPrompt) {
      try {
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        installPrompt = null;
        if (outcome === "accepted") {
          hideInstallControls();
        }
      } catch (error) {
        console.error("Cliptoid installation could not start:", error);
        showInstallStatus(installControl, "Your browser could not start installation. Try the browser menu instead.");
      }
      return;
    }

    let message = "Open your browser menu and choose Install app or Add to Home Screen.";
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
      message = "To install Cliptoid, tap Share in Safari, then choose Add to Home Screen.";
    } else if (window.matchMedia("(display-mode: standalone)").matches) {
      message = "Cliptoid is already installed on this device.";
    } else if (/Electron/i.test(navigator.userAgent)) {
      message = "This embedded browser cannot start Cliptoid installation. Open Cliptoid in Chrome or Edge, then choose Install Cliptoid from the browser menu.";
    }

    showInstallStatus(installControl, message);
  });

  const serviceWorkerSupported =
    "serviceWorker" in navigator &&
    window.isSecureContext &&
    (location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1");
  if (serviceWorkerSupported) {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.error("Cliptoid offline setup failed:", error);
    });
  }
})();
