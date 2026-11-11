/* Shared form definitions for the website content document. */
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

// Only genuine interaction renews the session; timers/background tabs never do.
const createEditorSessionTracker = ({ onActivity, onIdle, isVisible, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, idleMs = 5 * 60 * 1000, pingMs = 30000 }) => {
  let running = false;
  let lastActivity = 0;
  let lastPing = 0;
  let timer;
  const stop = () => { running = false; clearTimer(timer); };
  const check = () => {
    if (!running) return false;
    if (now() - lastActivity >= idleMs) { stop(); onIdle(); return false; }
    return true;
  };
  const schedule = () => { clearTimer(timer); timer = setTimer(() => { if (check()) schedule(); }, Math.max(1, idleMs - (now() - lastActivity))); };
  const start = () => { running = true; lastActivity = lastPing = now(); schedule(); };
  const activity = () => {
    if (!check() || !isVisible()) return;
    lastActivity = now();
    schedule();
    if (now() - lastPing >= pingMs) { lastPing = now(); onActivity(); }
  };
  return { start, stop, activity, check };
};

if (typeof module !== "undefined") module.exports = { editorSections, editorField, updateEditorRecord, createEditorSessionTracker };
