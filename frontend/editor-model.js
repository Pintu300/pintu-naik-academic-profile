/* Shared form definitions: data stays in the existing JSON files. */
const editorSections = {
  research: { label: "Research interests", fields: ["title!", "description:long"] },
  updates: { label: "Recent updates", fields: ["title!", "date", "description:long"] },
  publications: { label: "Publications", fields: ["title!", "authors", "venue", "year", "type:publication", "abstract:long", "keywords", "publisher", "pages", "volume", "number", "status", "url:url", "doi:url", "pdf", "codeUrl:url", "journalQuartile", "acceptanceRate"] },
  projects: { label: "Projects", fields: ["title!", "description:long", "contribution:long", "results:long", "stack", "url:url", "codeUrl:url", "demoUrl:url"] },
  achievements: { label: "Achievements and photos", fields: ["title!", "category", "date", "issuer", "description:long", "details:long", "image!", "alt!", "url:url"] },
  education: { label: "Education", fields: ["degree!", "institution", "period", "result", "details:long", "institutionLogo"] },
  skills: { label: "Technical skills", fields: ["title!", "description:long"] },
  teaching: { label: "Teaching and mentoring", fields: ["title!", "year", "description:long"] }
};

const editorField = (definition) => {
  const [name, kind = "text"] = definition.replace("!", "").split(":");
  const labels = {
    authors: "Authors (comma-separated names)", url: "Details URL", codeUrl: "Code URL", demoUrl: "Demo URL", doi: "DOI URL",
    pdf: "PDF URL or assets/ path", image: "Photo path (assets/…)", alt: "Photo description for accessibility",
    institutionLogo: "Institution logo path (assets/…)", journalQuartile: "Journal quartile", acceptanceRate: "Acceptance rate"
  };
  return { name, kind, required: definition.includes("!"), label: labels[name] || name[0].toUpperCase() + name.slice(1) };
};

const updateEditorRecord = (original, values) => {
  const record = { ...original };
  Object.entries(values).forEach(([key, value]) => {
    const text = value.trim();
    if (text) record[key] = text;
    else delete record[key];
  });
  return record;
};

if (typeof module !== "undefined") module.exports = { editorSections, editorField, updateEditorRecord };
