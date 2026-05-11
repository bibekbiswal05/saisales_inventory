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
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Sai Sales service worker registration failed.", error);
    });
  });
})();
