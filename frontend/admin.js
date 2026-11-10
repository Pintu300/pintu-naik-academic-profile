const form = document.querySelector("[data-editor-form]");
const statusElement = document.querySelector("[data-editor-status]");

let siteData = null;
let csrfToken = "";
const fieldGroup = document.querySelector("[data-editor-fields]");
const saveButtons = [...document.querySelectorAll("[data-editor-save], [data-editor-form] [type='submit']")];
saveButtons.forEach((button) => { button.disabled = true; });
const requireSignIn = (response) => {
  if (response.status !== 401) return false;
  window.location.replace("/login.html");
  return true;
};

const setStatus = (message, type = "info") => {
  statusElement.textContent = message;
  statusElement.dataset.status = type;
};

const getValue = (path) => path.split(".").reduce((value, key) => value?.[key], siteData);

const setValue = (target, path, value) => {
  const keys = path.split(".");
  const lastKey = keys.pop();
  const parent = keys.reduce((current, key) => (current[key] ||= {}), target);
  parent[lastKey] = value;
};

const originals = new WeakMap();
const collectionHost = document.querySelector("[data-editor-collections]");
const collectionNodes = new Map();
let dirty = false;

const readCollection = (container) => [...container.querySelectorAll("[data-record]")].map((entry) => {
  const values = Object.fromEntries([...entry.querySelectorAll("[data-record-field]")]
    .map((field) => [field.dataset.recordField, field.value]));
  return updateEditorRecord(originals.get(entry), values);
});

const renderCollection = (key, items) => {
  const { list, undoButton } = collectionNodes.get(key);
  list.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "editor-help";
    empty.textContent = `No ${editorSections[key].label.toLowerCase()} yet. Use Add entry to create one.`;
    list.append(empty);
  }
  items.forEach((record, index) => {
    const entry = document.createElement("details");
    entry.className = "editor-entry";
    entry.dataset.record = "";
    originals.set(entry, record);
    const summary = document.createElement("summary");
    const title = () => `${index + 1}. ${entry.querySelector("[data-record-field='title'], [data-record-field='degree']")?.value || "New entry"}`;
    summary.textContent = `${index + 1}. ${record.title || record.degree || "New entry"}`;
    const fields = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Entry details";
    fields.append(legend);
    editorSections[key].fields.map(editorField).forEach(({ name, kind, label, required }) => {
      const wrapper = document.createElement("label");
      const caption = document.createElement("span");
      caption.textContent = label + (required ? " (required)" : "");
      const field = document.createElement(kind === "long" ? "textarea" : kind === "publication" ? "select" : "input");
      field.dataset.recordField = name;
      field.required = required;
      if (kind === "publication") {
        const choices = [["", "Choose type"], ["conference", "Conference"], ["journal", "Journal"], ["bookChapter", "Book chapter"]];
        if (record[name] && !choices.some(([value]) => value === record[name])) choices.push([record[name], record[name]]);
        choices.forEach(([value, text]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          field.append(option);
        });
        field.required = true;
      } else if (kind === "long") field.rows = 3;
      else field.type = kind === "url" ? "url" : "text";
      field.value = record[name] || "";
      field.maxLength = 20_000;
      field.addEventListener("input", () => { summary.textContent = title(); });
      field.addEventListener("invalid", () => {
        entry.hidden = false;
        entry.open = true;
        const state = collectionNodes.get(key);
        state.search.value = "";
        filterCollection(key);
      });
      wrapper.append(caption, field);
      fields.append(wrapper);
    });
    const actions = document.createElement("div");
    actions.className = "editor-entry__actions";
    [["Move up", -1], ["Move down", 1], ["Remove", 0]].forEach(([label, direction]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button neutral";
      button.textContent = label;
      button.setAttribute("aria-label", `${label}: ${record.title || record.degree || "new entry"}`);
      button.disabled = direction === -1 && index === 0 || direction === 1 && index === items.length - 1;
      button.addEventListener("click", () => {
        const current = readCollection(list);
        if (direction) [current[index], current[index + direction]] = [current[index + direction], current[index]];
        else {
          collectionNodes.get(key).removed = { record: current[index], index };
          current.splice(index, 1);
          undoButton.hidden = false;
        }
        dirty = true;
        collectionNodes.get(key).search.value = "";
        renderCollection(key, current);
        const target = list.querySelectorAll("[data-record]")[Math.max(0, Math.min(current.length - 1, index + direction))];
        if (target) { target.open = true; target.querySelector("summary").focus(); }
        else collectionNodes.get(key).addButton.focus();
        setStatus(direction ? "Entry moved. Save to apply your changes." : "Entry removed. Use Undo removal to restore it before saving.");
      });
      actions.append(button);
    });
    fields.append(actions);
    entry.append(summary, fields);
    list.append(entry);
  });
  filterCollection(key);
};

const filterCollection = (key) => {
  const state = collectionNodes.get(key);
  const query = state.search.value.toLocaleLowerCase().trim();
  const entries = [...state.list.querySelectorAll("[data-record]")];
  let visible = 0;
  for (const entry of entries) {
    const text = [...entry.querySelectorAll("[data-record-field]")].map((field) => field.value).join(" ").toLocaleLowerCase();
    entry.hidden = !text.includes(query);
    if (!entry.hidden) visible++;
  }
  state.count.textContent = `${visible} of ${entries.length} entries`;
};

const setupCollections = () => {
  Object.entries(editorSections).forEach(([key, definition]) => {
    const section = document.createElement("section");
    section.className = "editor-card";
    const heading = document.createElement("h2");
    heading.id = `editor-${key}`;
    heading.textContent = definition.label;
    section.setAttribute("aria-labelledby", heading.id);
    const list = document.createElement("div");
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "button neutral";
    addButton.textContent = `Add ${key === "projects" ? "project" : "entry"}`;
    const undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.className = "button neutral";
    undoButton.textContent = "Undo removal";
    undoButton.hidden = true;
    const toolbar = document.createElement("div");
    toolbar.className = "editor-collection-tools";
    const searchLabel = document.createElement("label");
    searchLabel.textContent = `Search ${definition.label.toLowerCase()}`;
    const search = document.createElement("input");
    search.type = "search";
    search.maxLength = 200;
    search.dataset.editorSearch = key;
    searchLabel.append(search);
    const count = document.createElement("p");
    count.setAttribute("role", "status");
    count.setAttribute("aria-live", "polite");
    toolbar.append(searchLabel);
    for (const [label, open] of [["Expand all", true], ["Collapse all", false]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button neutral";
      button.textContent = label;
      button.addEventListener("click", () => list.querySelectorAll("[data-record]").forEach((entry) => { if (!entry.hidden) entry.open = open; }));
      toolbar.append(button);
    }
    collectionNodes.set(key, { list, addButton, undoButton, search, count, removed: null });
    search.addEventListener("input", () => filterCollection(key));
    addButton.addEventListener("click", () => {
      const current = readCollection(list);
      current.push(key === "publications" ? { type: "conference" } : {});
      dirty = true;
      search.value = "";
      renderCollection(key, current);
      const entry = [...list.querySelectorAll("[data-record]")].pop();
      entry.open = true;
      entry.querySelector("input, textarea, select").focus();
    });
    undoButton.addEventListener("click", () => {
      const state = collectionNodes.get(key);
      if (!state.removed) return;
      const current = readCollection(list);
      current.splice(state.removed.index, 0, state.removed.record);
      state.removed = null;
      undoButton.hidden = true;
      dirty = true;
      search.value = "";
      renderCollection(key, current);
      setStatus("Entry restored. Save to apply your changes.");
    });
    section.append(heading);
    if (key === "achievements") {
      const help = document.createElement("p");
      help.textContent = "Place photos in frontend/assets/ and enter their assets/ path. Suggested categories: Achievements, Fun & Memories, Travel & Outdoors.";
      section.append(help);
    }
    section.append(toolbar, count, list, addButton, undoButton);
    collectionHost.append(section);
    renderCollection(key, siteData[key] || []);
  });
};

const fillForm = () => {
  form.querySelectorAll("[name^='profile.']").forEach((field) => {
    field.value = field.name === "profile.about" ? (siteData.profile.about || []).join("\n\n") : getValue(field.name) || "";
  });
  setupCollections();
  const nav = document.querySelector("[data-editor-nav]");
  for (const [id, label] of [["profile-heading", "Profile"], ["links-heading", "Links"], ["about-heading", "About"], ...Object.entries(editorSections).map(([key, value]) => [`editor-${key}`, value.label])]) {
    const link = document.createElement("a");
    link.href = `#${id}`;
    link.textContent = label;
    nav.append(link);
  }
  document.querySelector("[data-editor-backup]").disabled = false;
};

const readForm = () => {
  const next = structuredClone(siteData);
  form.querySelectorAll("[name^='profile.']").forEach((field) => {
    const value = field.name === "profile.about" ? field.value.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean) : field.value.trim();
    setValue(next, field.name, value);
  });
  collectionNodes.forEach(({ list }, key) => { next[key] = readCollection(list); });
  return next;
};

form.addEventListener("input", (event) => {
  if (!event.target.matches("[data-editor-search]")) dirty = true;
});
window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

const loadData = async () => {
  const response = await fetch("/api/admin/site-data");

  if (requireSignIn(response)) return;
  if (!response.ok) {
    throw new Error("Could not load website details.");
  }

  csrfToken = response.headers.get("X-CSRF-Token") || "";
  siteData = await response.json();
  fillForm();
  fieldGroup.disabled = false;
  saveButtons.forEach((button) => { button.disabled = false; });
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!siteData) return;
  saveButtons.forEach((button) => { button.disabled = true; });
  fieldGroup.disabled = true;
  setStatus("Saving...");

  try {
    const nextData = readForm();

    const response = await fetch("/api/admin/site-data", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify(nextData)
    });

    if (requireSignIn(response)) return;
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Save failed.");
    }

    siteData = nextData;
    dirty = false;
    collectionNodes.forEach((state) => { state.removed = null; state.undoButton.hidden = true; });
    setStatus("Saved. Refresh the main website to see your changes.", "success");
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    fieldGroup.disabled = false;
    saveButtons.forEach((button) => { button.disabled = false; });
  }
});

loadData().catch((error) => {
  setStatus(`Error: ${error.message}`, "error");
});


document.querySelector("[data-logout]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "X-Requested-With": "admin-editor", "X-CSRF-Token": csrfToken }
    });
    if (response.ok || response.status === 401) {
      dirty = false;
      window.location.replace("/login.html");
      return;
    }
    throw new Error("Could not sign out. Reload the editor and try again.");
  } catch (error) {
    setStatus(error.message, "error");
    button.disabled = false;
  }
});


document.querySelector("[data-editor-backup]").addEventListener("click", () => {
  if (!siteData) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(siteData, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `academic-site-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  setStatus("Saved content backup downloaded. Unsaved changes were not included.");
});
