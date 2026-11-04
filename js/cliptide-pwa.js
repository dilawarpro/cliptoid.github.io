(() => {
  "use strict";

  const installButtonSelector = "#dwapp_image, #cliptoid-install-result";
  const getInstallButtons = () => [...document.querySelectorAll(installButtonSelector)];
  let installPrompt = null;

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
    if (!getInstallButtons().length) return;
    event.preventDefault();
    installPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    getInstallButtons().forEach((button) => {
      button.hidden = true;
    });
  });

  const installStatusTimers = new WeakMap();

  const showInstallStatus = (button, message, timeoutMs = 2000) => {
    const statusId = `${button.id || "cliptoid-install-button"}-status`;
    let status = document.getElementById(statusId);
    if (!status) {
      status = document.createElement("p");
      status.id = statusId;
      status.className = "cliptide-install-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      button.after(status);
    }

    const existingTimer = installStatusTimers.get(button);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    status.textContent = message;
    status.hidden = false;

    const timer = window.setTimeout(() => {
      status.textContent = "";
      status.hidden = true;
      status.remove();
      installStatusTimers.delete(button);
    }, timeoutMs);

    installStatusTimers.set(button, timer);
  };

  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const installButton = event.target.closest(installButtonSelector);
    if (!installButton) return;

    event.preventDefault();
    if (installPrompt) {
      try {
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        installPrompt = null;
        if (outcome === "accepted") {
          getInstallButtons().forEach((button) => {
            button.hidden = true;
          });
        }
      } catch (error) {
        console.error("Cliptoid installation could not start:", error);
        showInstallStatus(installButton, "Your browser could not start installation. Try the browser menu instead.");
      }
      return;
    }

    if (window.matchMedia("(display-mode: standalone)").matches) {
      showInstallStatus(installButton, "Cliptoid is already installed on this device.");
    } else {
      showInstallStatus(installButton, "Installable only in chrome browser");
    }
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
