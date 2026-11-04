(() => {
  "use strict";

  const installControlSelector = "#dwapp_image, #cliptoid-install-result";
  const getInstallControls = () => [...document.querySelectorAll(installControlSelector)];
  const isRunningInstalledApp = () =>
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let installationCompleted = false;
  let installInProgress = false;
  const isSecureInstallContext = () =>
    window.isSecureContext &&
    (location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1");
  const isAppInstalled = () => isRunningInstalledApp() || installationCompleted;
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
    installationCompleted = false;
    setInstalledStep(false);
    installPrompt = event;
    setInstallAvailability(true);
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installationCompleted = true;
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
  if (installInProgress) return;
    if (isAppInstalled()) {
      setInstallAvailability(false);
      setInstalledStep(true);
      return;
    }
    if (installPrompt) {
      const promptEvent = installPrompt;
      installPrompt = null;
      installInProgress = true;
      try {
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === "accepted") {
          installationCompleted = true;
          setInstallAvailability(false);
          setInstalledStep(true);
        } else {
          showInstallStatus(installControl, "Installation was cancelled. You can try again from the browser menu.");
        }
      } catch (error) {
        console.error("Cliptoid installation could not start:", error);
        showInstallStatus(installControl, "Your browser could not start installation. Try the browser menu instead.");
      } finally {
        installInProgress = false;
      }
      return;
    }

    if (!isSecureInstallContext()) {
      showInstallStatus(
        installControl,
        "Open Cliptoid from a secure HTTPS page, then use your browser menu to install it."
      );
      return;
    }

    showInstallStatus(installControl, "Use your browser menu to install Cliptoid.");
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
