/* Enhancements are initialized after the shared content loader finishes. */
(() => {
  const download = (text, filename, type = "text/plain;charset=utf-8") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  const setOptions = (select, values) => {
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    });
  };
  const writeView = (values) => {
    const url = new URL(window.location.href);
    Object.entries(values).forEach(([key, value]) => {
      url.searchParams.delete(key);
      if (value) url.searchParams.set(key, value);
    });
    window.history.replaceState(null, "", url);
  };
  const setupPublications = () => {
    const controls = document.querySelector("[data-publication-controls]");
    if (!controls) return;
    const fields = Object.fromEntries(["query", "type", "year", "status"].map((key) => [key, document.querySelector(`[data-publication-${key}]`)]));
    setOptions(fields.year, [...new Set(publicationItems.map((item) => String(item.year || "")).filter(Boolean))].sort((a, b) => Number(b) - Number(a)));
    setOptions(fields.status, [...new Set(publicationItems.map(AcademicCatalog.publicationStatus))].sort());
    const sync = () => {
      publicationFilters = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value.trim()]));
      renderPublications();
      writeView({ q: publicationFilters.query, type: publicationFilters.type, year: publicationFilters.year, status: publicationFilters.status, order: publicationSortDescending ? "" : "oldest" });
      document.querySelector("[data-share-field]").hidden = true;
      document.querySelector("[data-share-status]").textContent = "";
    };
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      fields.query.value = (params.get("q") || "").slice(0, 200);
      for (const key of ["type", "year", "status"]) {
        const value = params.get(key) || "";
        fields[key].value = [...fields[key].options].some((option) => option.value === value) ? value : "";
      }
      publicationSortDescending = params.get("order") !== "oldest";
      sync();
    };
    for (const [key, field] of Object.entries(fields)) field.addEventListener(key === "query" ? "input" : "change", sync);
    document.querySelector("[data-publication-sort]").addEventListener("click", sync);
    document.querySelector("[data-publication-reset]").addEventListener("click", () => {
      Object.values(fields).forEach((field) => { field.value = ""; });
      publicationSortDescending = true;
      sync();
      fields.query.focus();
    });
    document.querySelector("[data-publication-export]").addEventListener("click", () => {
      const records = AcademicCatalog.filterPublications(publicationItems, { ...publicationFilters, order: publicationSortDescending ? "newest" : "oldest" });
      if (records.length) download(records.map(AcademicCatalog.bibtex).join("\n\n") + "\n", "publications.bib", "application/x-bibtex;charset=utf-8");
    });
    document.querySelector("[data-publication-share]").addEventListener("click", async () => {
      const status = document.querySelector("[data-share-status]");
      try {
        await navigator.clipboard.writeText(window.location.href);
        status.textContent = "Link copied. It includes your current filters.";
      } catch {
        const field = document.querySelector("[data-share-field]");
        const input = document.querySelector("[data-share-url]");
        field.hidden = false;
        input.value = window.location.href;
        input.focus();
        input.select();
        status.textContent = "Copy the link from the field shown here.";
      }
    });
    window.addEventListener("popstate", restore);
    setupCitationDialog();
    restore();
    controls.disabled = false;
  };
  const setupCitationDialog = () => {
    const dialog = document.querySelector("[data-citation-dialog]");
    const text = dialog.querySelector("[data-citation-text]");
    const format = dialog.querySelector("[data-citation-format]");
    const status = dialog.querySelector("[data-citation-status]");
    let record;
    let trigger;
    const update = () => {
      text.value = format.value === "bibtex" ? AcademicCatalog.bibtex(record) : AcademicCatalog.citationText(record);
      status.textContent = "";
    };
    document.querySelector("#publication-results").addEventListener("click", (event) => {
      const button = event.target.closest("[data-cite]");
      if (!button) return;
      record = publicationItems.find((item) => AcademicCatalog.publicationKey(item) === button.dataset.cite);
      if (!record) return;
      trigger = button;
      format.value = "text";
      dialog.querySelector("[data-citation-paper]").textContent = record.title;
      update();
      dialog.showModal();
    });
    dialog.querySelector("[data-citation-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => trigger?.focus());
    format.addEventListener("change", update);
    dialog.querySelector("[data-citation-copy]").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text.value);
        status.textContent = "Citation copied.";
      } catch {
        text.focus();
        text.select();
        status.textContent = "Copy the selected citation text using your keyboard or device menu.";
      }
    });
    dialog.querySelector("[data-citation-download]").addEventListener("click", () => {
      if (record) download(AcademicCatalog.bibtex(record) + "\n", `${AcademicCatalog.publicationKey(record)}.bib`, "application/x-bibtex;charset=utf-8");
    });
  };
  const setupProjects = () => {
    const controls = document.querySelector("[data-project-controls]");
    if (!controls) return;
    const query = document.querySelector("[data-project-query]");
    const technology = document.querySelector("[data-project-technology]");
    setOptions(technology, [...new Set(projectItems.flatMap((item) => String(item.stack || "").split(/[,;|]/).map((value) => value.trim()).filter(Boolean)))].sort());
    const sync = () => {
      projectFilters = { query: query.value.trim(), technology: technology.value };
      renderProjects();
      writeView({ q: projectFilters.query, technology: projectFilters.technology });
    };
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      query.value = (params.get("q") || "").slice(0, 200);
      const value = params.get("technology") || "";
      technology.value = [...technology.options].some((option) => option.value === value) ? value : "";
      sync();
    };
    query.addEventListener("input", sync);
    technology.addEventListener("change", sync);
    document.querySelector("[data-project-reset]").addEventListener("click", () => {
      query.value = "";
      technology.value = "";
      sync();
      query.focus();
    });
    window.addEventListener("popstate", restore);
    restore();
    controls.disabled = false;
  };
  window.academicDataReady?.then((data) => {
    if (data?.publications) setupPublications();
    if (data?.projects) setupProjects();
  }).catch((error) => console.error("Could not initialize catalogue tools.", error));
})();
