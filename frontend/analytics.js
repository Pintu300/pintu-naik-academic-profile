(() => {
  // Local development and automated browser checks must not inflate public visitor totals.
  if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
  const measurementId = "G-1QX3DKVS0G";

  if (!/^G-[A-Z0-9]+$/i.test(measurementId)) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.onerror = () => console.error("Google Analytics could not be loaded.");
  document.head.append(script);
})();
