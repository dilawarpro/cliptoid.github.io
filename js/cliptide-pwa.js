(() => {
  "use strict";

  const installControlSelector = "#dwapp_image, #cliptoid-install-result";
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
  const headerInstallButton = document.querySelector("#dwapp_image");
  const originalInstallButtonContent = headerInstallButton?.innerHTML || "";
  const setInstalledStep = (installed) => {
    const installStep = document.querySelector("#cliptoid-install-step");
    const installedStep = document.querySelector("#cliptoid-installed-step");
    if (installStep) installStep.hidden = installed;
    if (installedStep) installedStep.hidden = !installed;
  };
  const setInstallAvailability = (available) => {
    const installed = isAppInstalled();
    const canInstall = available && !installed;
    if (headerInstallButton) {
      headerInstallButton.hidden = installed;
      headerInstallButton.disabled = false;
      headerInstallButton.innerHTML = originalInstallButtonContent;
      headerInstallButton.setAttribute("aria-label", "Install Cliptoid");
    }
    getInstallControls().forEach((control) => {
      if (control !== headerInstallButton) control.hidden = !canInstall;
    });
  };
  const installedControlsObserver = new MutationObserver((mutations) => {
    if (isAppInstalled()) {
      rememberInstallation();
      setInstallAvailability(false);
      setInstalledStep(true);
      return;
    }
    mutations.forEach(({ addedNodes }) => {
      addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches("#cliptoid-install-result")) node.hidden = !installPrompt;
        node.querySelectorAll("#cliptoid-install-result").forEach((control) => {
          control.hidden = !installPrompt;
        });
      });
    });
  });
  installedControlsObserver.observe(document.body, { childList: true, subtree: true });
  let installPrompt = null;

  if (isRunningInstalledApp()) rememberInstallation();
  setInstallAvailability(false);
  setInstalledStep(isAppInstalled());

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
    if (isRunningInstalledApp()) return;
    clearRememberedInstallation();
    setInstalledStep(false);
    installPrompt = event;
    setInstallAvailability(true);
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    rememberInstallation();
    setInstallAvailability(false);
    setInstalledStep(true);
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
    if (isAppInstalled()) {
      setInstallAvailability(false);
      setInstalledStep(true);
      return;
    }
    if (installPrompt) {
      try {
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        installPrompt = null;
        if (outcome === "accepted") {
          rememberInstallation();
          setInstallAvailability(false);
          setInstalledStep(true);
        } else {
          setInstallAvailability(false);
        }
      } catch (error) {
        console.error("Cliptoid installation could not start:", error);
        installPrompt = null;
        setInstallAvailability(false);
        showInstallStatus(installControl, "Your browser could not start installation. Try the browser menu instead.");
      }
      return;
    }

    showInstallStatus(installControl, "Installable only in Chrome browsers.");
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
