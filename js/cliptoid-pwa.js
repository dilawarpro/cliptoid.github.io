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
    let hasControlledPage = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    let waitingToReload = false;
    const reloadAfterCurrentWork = () => {
      if (refreshing) return;
      if (document.querySelector('[aria-busy="true"], form.htmx-request')) {
        if (!waitingToReload) {
          waitingToReload = true;
          window.setTimeout(() => {
            waitingToReload = false;
            reloadAfterCurrentWork();
          }, 1000);
        }
        return;
      }
      const input = document.querySelector("#main_page_text");
      if (input?.value) {
        try {
          sessionStorage.setItem("cliptoid.pendingUpdateInput", input.value);
        } catch {}
      }
      refreshing = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hasControlledPage) {
        hasControlledPage = true;
        return;
      }
      if (!refreshing) reloadAfterCurrentWork();
    });

    navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" })
      .then((registration) => {
        const checkForUpdates = () => registration.update().catch(() => {});
        const fingerprints = new Map();
        let fingerprintsReady = false;
        let checkingContent = false;
        const checkForContentChanges = async () => {
          if (checkingContent || !navigator.onLine || !window.crypto?.subtle) return;
          checkingContent = true;
          try {
            const resources = new Set([new URL(location.pathname, location.origin).href]);
            document.querySelectorAll("script[src], link[rel~='stylesheet'][href]").forEach((element) => {
              const resourceUrl = new URL(element.src || element.href, location.href);
              if (resourceUrl.origin === location.origin) resources.add(resourceUrl.href);
            });
            const results = await Promise.all([...resources].map(async (resourceUrl) => {
              try {
                const response = await fetch(resourceUrl, { cache: "no-cache", credentials: "same-origin" });
                if (!response.ok) return null;
                const digest = await window.crypto.subtle.digest("SHA-256", await response.arrayBuffer());
                const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
                return [resourceUrl, fingerprint];
              } catch {
                return null;
              }
            }));
            const validResults = results.filter(Boolean);
            const hasChanged = fingerprintsReady && validResults.some(([resourceUrl, fingerprint]) =>
              fingerprints.has(resourceUrl) && fingerprints.get(resourceUrl) !== fingerprint
            );
            validResults.forEach(([resourceUrl, fingerprint]) => fingerprints.set(resourceUrl, fingerprint));
            fingerprintsReady = true;
            if (hasChanged) reloadAfterCurrentWork();
          } finally {
            checkingContent = false;
          }
        };

        checkForUpdates();
        checkForContentChanges();
        document.addEventListener("visibilitychange", () => {
          if (!document.hidden) {
            checkForUpdates();
            checkForContentChanges();
          }
        });
        window.addEventListener("online", checkForContentChanges);
        window.setInterval(() => {
          checkForUpdates();
          checkForContentChanges();
        }, 5 * 60 * 1000);
      })
      .catch((error) => {
        console.error("Cliptoid offline setup failed:", error);
      });

    try {
      const pendingInput = sessionStorage.getItem("cliptoid.pendingUpdateInput");
      if (pendingInput) {
        sessionStorage.removeItem("cliptoid.pendingUpdateInput");
        const input = document.querySelector("#main_page_text");
        if (input) {
          input.value = pendingInput;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    } catch {}
  }
})();
