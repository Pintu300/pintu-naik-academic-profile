/* Pure catalogue helpers shared by browser interactions and regression tests. */
(() => {
  const normalize = (value) => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const matches = (item, query, fields) => {
    const text = normalize(fields.map((field) => item[field] || "").join(" "));
    return normalize(query).split(/\s+/).filter(Boolean).every((term) => text.includes(term));
  };
  const publicationStatus = (item) => String(item.status || "Published").trim();
  const filterPublications = (items, filters = {}) => items.filter((item) =>
    matches(item, filters.query, ["title", "authors", "venue", "abstract", "keywords", "year"])
    && (!filters.type || item.type === filters.type)
    && (!filters.year || String(item.year || "") === filters.year)
    && (!filters.status || normalize(publicationStatus(item)) === normalize(filters.status))
  ).sort((a, b) => {
    const first = Number.parseInt(a.year, 10);
    const second = Number.parseInt(b.year, 10);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return Number.isFinite(first) ? -1 : Number.isFinite(second) ? 1 : 0;
    return filters.order === "oldest" ? first - second : second - first;
  });
  const filterProjects = (items, filters = {}) => items.filter((item) =>
    matches(item, filters.query, ["title", "description", "contribution", "results", "stack"])
    && (!filters.technology || String(item.stack || "").split(/[,;|]/).some((value) => normalize(value) === normalize(filters.technology)))
  );
  const publicationKey = (item) => {
    const text = [item.title, item.authors, item.year, item.doi].join("|");
    let hash = 2166136261;
    for (const letter of text) hash = Math.imul(hash ^ letter.codePointAt(0), 16777619) >>> 0;
    return `publication${String(item.year || "").replace(/\D/g, "")}-${hash.toString(16)}`;
  };
  const citationText = (item) => [
    item.authors, item.year ? `(${item.year}).` : "", item.title ? `${item.title}.` : "", item.venue ? `${item.venue}.` : "",
    item.status ? `Status: ${item.status}.` : "", item.doi || item.url
  ].filter(Boolean).join(" ");
  const bibEscape = (value) => String(value || "").replace(/[\\{}%&#_$~^]/g, (character) => ({
    "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&", "#": "\\#", "_": "\\_", "$": "\\$", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}"
  })[character]).replace(/[\r\n]+/g, " ");
  const bibtex = (item) => {
    const pending = !!item.status && !/^published(?:\s+online)?$/i.test(String(item.status).trim());
    const type = pending ? "unpublished" : ({ conference: "inproceedings", journal: "article", bookChapter: "incollection" })[item.type] || "misc";
    const fields = { title: item.title, author: item.authors ? item.authors.split(/,\s*|\s+and\s+/i).map((author) => author.replace(/^and\s+/i, "").trim()).filter(Boolean).join(" and ") : "", year: item.year };
    if (pending) fields.note = [item.status, item.venue].filter(Boolean).join(". ");
    else {
      fields[type === "article" ? "journal" : type === "misc" ? "howpublished" : "booktitle"] = item.venue;
      if (item.status) fields.note = item.status;
    }
    for (const key of ["publisher", "pages", "volume", "number"]) if (item[key]) fields[key] = item[key];
    if (typeof item.doi === "string") fields.doi = item.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    if (item.url) fields.url = item.url;
    return `@${type}{${publicationKey(item)},\n${Object.entries(fields).filter(([, value]) => value).map(([key, value]) => `  ${key} = {${key === "title" ? `{${bibEscape(value)}}` : bibEscape(value)}}`).join(",\n")}\n}`;
  };
  const api = { normalize, matches, publicationStatus, filterPublications, filterProjects, publicationKey, citationText, bibtex };
  if (typeof module !== "undefined") module.exports = api;
  else globalThis.AcademicCatalog = api;
})();
