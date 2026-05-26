(function () {
  const canRegisterServiceWorker =
    "serviceWorker" in navigator &&
    (window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  if (!canRegisterServiceWorker) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then((registration) => {
        registration.update();

        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) {
            return;
          }

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((error) => {
        console.warn("Sai Sales service worker registration failed.", error);
      });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (sessionStorage.getItem("saiSalesPwaReloaded") === "1") {
        return;
      }

      sessionStorage.setItem("saiSalesPwaReloaded", "1");
      window.location.reload();
    });
  });
})();
