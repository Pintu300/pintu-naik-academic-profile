(() => {
  const panel = document.querySelector("[data-visitor-stats]");
  if (!panel) return;

  const endpoint = panel.dataset.endpoint.trim();
  if (!endpoint) return;

  const startDate = panel.dataset.startDate || "2026-11-10";
  const requestUrl = new URL(endpoint, window.location.href);
  // A new reporting period must not reuse a response cached under the old URL.
  requestUrl.searchParams.set("since", startDate);

  const total = panel.querySelector("[data-visitor-total]");
  const period = panel.querySelector("[data-visitor-period]");
  const status = panel.querySelector("[data-visitor-status]");
  const list = panel.querySelector("[data-visitor-list]");
  const updated = panel.querySelector("[data-visitor-updated]");
  const retry = panel.querySelector("[data-visitor-retry]");
  const numberFormat = new Intl.NumberFormat();
  let loading = false;

  const flagForCountry = (countryCode) => {
    if (!/^[A-Z]{2}$/.test(countryCode)) return "🌐";

    return String.fromCodePoint(
      ...[...countryCode].map((letter) => letter.charCodeAt(0) + 127397)
    );
  };

  const makeCountryRow = (country) => {
    const row = document.createElement("li");
    row.className = "visitor-stats__country";

    const flag = document.createElement("span");
    flag.className = "visitor-stats__flag";
    flag.setAttribute("aria-hidden", "true");
    flag.textContent = flagForCountry(country.countryCode);

    const name = document.createElement("span");
    name.className = "visitor-stats__country-name";
    name.textContent = country.country;

    const count = document.createElement("strong");
    count.className = "visitor-stats__country-count";
    count.textContent = numberFormat.format(country.visitors);

    row.append(flag, name, count);
    return row;
  };

  const loadVisitorStats = async () => {
    if (loading) return;
    loading = true;
    const restoreFocus = retry && document.activeElement === retry;
    panel.setAttribute("aria-busy", "true");
    status.hidden = false;
    status.textContent = "Loading visitor statistics…";
    if (retry) retry.disabled = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(requestUrl.href, {
        signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        throw new Error(`Visitor statistics request failed with status ${response.status}.`);
      }

      const data = await response.json();
      if (
        !Number.isSafeInteger(data.totalVisitors) ||
        data.totalVisitors < 0 ||
        !Array.isArray(data.countries)
      ) {
        throw new Error("Visitor statistics response has an invalid format.");
      }

      if (data.startDate !== startDate) {
        throw new Error("Visitor statistics do not match the configured reporting period.");
      }

      const countries = data.countries.filter(
        (country) =>
          typeof country.country === "string" &&
          typeof country.countryCode === "string" &&
          Number.isSafeInteger(country.visitors) &&
          country.visitors >= 0
      );

      total.textContent = numberFormat.format(data.totalVisitors);
      if (typeof data.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.startDate)) {
        period.textContent = `Unique visitors since ${data.startDate}`;
      }

      list.replaceChildren(...countries.map(makeCountryRow));
      list.hidden = countries.length === 0;
      status.hidden = countries.length > 0;
      status.textContent =
        countries.length > 0 ? "" : "No country totals are available for this period yet.";

      const updatedAt = new Date(data.updatedAt);
      if (!Number.isNaN(updatedAt.valueOf())) {
        updated.textContent = `Last updated ${new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short"
        }).format(updatedAt)}`;
      }
      if (retry) {
        retry.hidden = true;
      }
    } catch (error) {
      console.error("Could not load visitor statistics.", error);
      status.hidden = false;
      status.textContent = controller.signal.aborted
        ? "Visitor statistics took too long to load. Please try again."
        : "Visitor statistics are temporarily unavailable. Please try again.";
      if (retry) retry.hidden = false;
    } finally {
      window.clearTimeout(timeout);
      loading = false;
      panel.setAttribute("aria-busy", "false");
      if (retry) retry.disabled = false;
      // Disabling a focused button can move focus to body. Restore it only
      // if the visitor has not moved to another control while waiting.
      if (restoreFocus && (document.activeElement === retry || document.activeElement === document.body)) {
        if (retry.hidden) {
          status.hidden = false;
          if (!status.textContent) status.textContent = "Visitor statistics updated.";
          status.tabIndex = -1;
          status.focus();
        } else {
          retry.focus();
        }
      }
    }
  };

  retry?.addEventListener("click", loadVisitorStats);
  return loadVisitorStats();
})();
