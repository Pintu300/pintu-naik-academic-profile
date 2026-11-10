(() => {
  const panel = document.querySelector("[data-visitor-stats]");
  if (!panel) return;

  const endpoint = panel.dataset.endpoint.trim();
  if (!endpoint) return;

  const total = panel.querySelector("[data-visitor-total]");
  const period = panel.querySelector("[data-visitor-period]");
  const status = panel.querySelector("[data-visitor-status]");
  const list = panel.querySelector("[data-visitor-list]");
  const updated = panel.querySelector("[data-visitor-updated]");
  const numberFormat = new Intl.NumberFormat();

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
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
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
    } catch (error) {
      console.error("Could not load visitor statistics.", error);
      status.hidden = false;
      status.textContent = "Visitor statistics are temporarily unavailable. Please try again later.";
    }
  };

  loadVisitorStats();
})();
