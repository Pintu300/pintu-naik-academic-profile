const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");
const siteData = Object.fromEntries(["profile", "research", "education", "updates", "publications", "projects", "teaching", "skills", "achievements"]
  .map((name) => [name, JSON.parse(fs.readFileSync(path.join(__dirname, "..", "backend", "data", `${name}.json`), "utf8"))]));

class Element {
  constructor(tag = "DIV", dataset = {}) {
    this.tagName = tag;
    this.dataset = dataset;
    this.children = [];
    this.attributes = {};
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.tabIndex = 0;
    this.hidden = false;
    this.inert = false;
    this.events = {};
    this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
  }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.innerHTML = ""; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { this.events[name] = callback; }
  closest() { return this.hidden ? this : null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const loadPage = async ({ selectors = [], cv = false, failed = [], overrides = {}, modal = false } = {}) => {
  const nodes = new Map(selectors.map((selector) => [selector, [new Element(selector.includes("titles") ? "UL" : "DIV")]]));
  const fields = ["name", "title", "institution", "summary", "email", "academicService"].map((key) => new Element("SPAN", { profile: key }));
  const links = ["email", "linkedin", "department"].map((key) => new Element("A", { profileLink: key }));
  nodes.set("[data-profile]", fields);
  nodes.set("[data-profile-link]", links);
  const main = new Element("MAIN");
  nodes.set("main", [main]);
  const print = cv ? new Element("BUTTON") : null;
  if (print) { print.disabled = true; nodes.set("[data-print-cv]", [print]); }
  const all = (selector) => [...new Set(selector.split(",").flatMap((part) => nodes.get(part.trim()) || []))];
  const document = {
    querySelector: (selector) => all(selector)[0] || null,
    querySelectorAll: all,
    createElement: (tag) => new Element(tag.toUpperCase()),
    body: { dataset: { pageTitle: cv ? "Academic CV" : "Academic Profile" }, classList: { contains: (name) => cv && name === "cv-site", add() {}, remove() {} } },
    documentElement: { style: { setProperty() {} } },
    addEventListener() {}
  };
  let dialog;
  if (modal) {
    const modalNode = new Element();
    modalNode.hidden = true;
    const panel = new Element();
    const close = new Element("BUTTON");
    const link = new Element("A");
    const card = new Element("BUTTON", { achievementIndex: "0", achievement: JSON.stringify({ title: "Photo", image: "assets/photo.jpg", url: "https://example.com" }) });
    const gallery = new Element();
    const fields = new Map([
      [".achievement-detail__close", close], [".achievement-detail__panel", panel], ["[data-achievement-detail-link]", link],
      ...["image", "meta", "title", "description", "extra"].map((name) => [`[data-achievement-detail-${name}]`, new Element()])
    ]);
    modalNode.querySelector = (selector) => fields.get(selector) || null;
    modalNode.querySelectorAll = () => [close];
    panel.querySelectorAll = () => [close, link];
    panel.contains = (element) => [close, link].includes(element);
    for (const node of [close, link, card, panel]) node.focus = () => { document.activeElement = node; };
    nodes.set("[data-achievement-modal]", [modalNode]);
    nodes.set("[data-achievements-list]", [gallery]);
    nodes.set("body > main", [main]);
    dialog = { node: modalNode, gallery, close, link, card };
  }
  const calls = [];
  const errors = [];
  const fetch = async (url) => {
    const name = /data\/(.*)\.json/.exec(url)[1];
    calls.push(name);
    return { ok: !failed.includes(name), status: failed.includes(name) ? 503 : 200, json: async () => structuredClone(overrides[name] ?? siteData[name]) };
  };
  const keyEvents = {};
  const window = { setTimeout, clearTimeout, addEventListener(name, callback) { keyEvents[name] = callback; }, location: { reload() {} }, print() {} };
  const ready = vm.runInNewContext(source, { document, window, fetch, AbortController, URL, AcademicCatalog: require("./catalog"), console: { error: (...args) => errors.push(args) } });
  await ready;
  return { nodes, fields, links, calls, main, print, errors, dialog, keyEvents, document };
};

test("CV identity, contact details, interests, and education follow shared content", async () => {
  const profile = { ...siteData.profile, name: "Changed Researcher", email: "changed@example.com", summary: "Updated research summary.", academicService: "Updated reviewer role." };
  const page = await loadPage({ cv: true, selectors: ["[data-research-titles]", "[data-education-list]", "[data-publications-category]", "[data-teaching-list]", "[data-skills-list]"], overrides: { profile } });
  assert.equal(page.fields.find((field) => field.dataset.profile === "name").textContent, profile.name);
  assert.equal(page.fields.find((field) => field.dataset.profile === "summary").textContent, profile.summary);
  assert.equal(page.fields.find((field) => field.dataset.profile === "academicService").textContent, profile.academicService);
  assert.equal(page.links[0].href, "mailto:changed@example.com");
  assert.equal(page.links[2].href, profile.links.department);
  const interests = page.nodes.get("[data-research-titles]")[0].innerHTML;
  siteData.research.forEach((item) => assert.ok(interests.includes(item.title)));
  const education = page.nodes.get("[data-education-list]")[0].innerHTML;
  assert.ok(education.includes("PhD"));
  assert.ok(!education.includes("Classes 1–7"));
  assert.equal(page.print.disabled, false);
  assert.equal(page.errors.length, 0);
});

test("a publications page loads only profile and publications", async () => {
  const page = await loadPage({ selectors: ["[data-publications-category]"] });
  assert.deepEqual(page.calls.sort(), ["profile", "publications"]);
});

test("one failed resource does not prevent other sections from rendering", async () => {
  const page = await loadPage({ cv: true, selectors: ["[data-education-list]", "[data-skills-list]"], failed: ["education"] });
  assert.ok(page.nodes.get("[data-skills-list]")[0].innerHTML.includes("Programming"));
  assert.equal(page.main.children[0].attributes.role, "status");
  assert.match(page.main.children[0].children[0].textContent, /education/);
  assert.equal(page.main.children[0].children[1].textContent, "Reload page");
  assert.equal(page.print.disabled, true);
});

test("malformed content produces a recoverable error rather than an empty successful section", async () => {
  const page = await loadPage({ selectors: ["[data-projects-list]"], overrides: { projects: { invalid: true } } });
  assert.match(page.main.children[0].children[0].textContent, /projects/);
  assert.equal(page.errors.length, 1);
});

test("project contributions are escaped and unsafe links are omitted", async () => {
  const page = await loadPage({ selectors: ["[data-projects-list]"], overrides: { projects: [{ title: "Test", contribution: "<img src=x onerror=alert(1)>", codeUrl: "javascript:alert(1)", demoUrl: "https://example.com/demo" }] } });
  const html = page.nodes.get("[data-projects-list]")[0].innerHTML;
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes('href="https://example.com/demo"'));
});

test("homepage selected work excludes submissions and shows at most three items", async () => {
  const page = await loadPage({ selectors: ["[data-selected-publications]"] });
  const html = page.nodes.get("[data-selected-publications]")[0].innerHTML;
  assert.equal((html.match(/<article /g) || []).length, 3);
  assert.ok(!html.includes("Submitted"));
  assert.ok(!html.includes("SAFE-RT"));
});

test("publication code boxes support safe links and informative placeholders in full and selected lists", async () => {
  const publications = [
    { title: 'Code paper "A"', year: "2026", codeUrl: "https://example.com/research-code" },
    { title: "Paper without code", year: "2026" },
    { title: "Unsafe code URL", year: "2026", codeUrl: "javascript:alert(1)" }
  ];
  const page = await loadPage({ selectors: ["[data-publications-category]", "[data-selected-publications]"], overrides: { publications } });
  for (const selector of ["[data-publications-category]", "[data-selected-publications]"]) {
    const html = page.nodes.get(selector)[0].innerHTML;
    assert.equal((html.match(/class="publication-code(?: |")/g) || []).length, 3);
    assert.ok(html.includes('href="https://example.com/research-code"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
    assert.ok(html.includes("Code for Code paper &quot;A&quot;"));
    assert.equal((html.match(/Not linked/g) || []).length, 2);
    assert.ok(!html.includes("javascript:"));
  }
});


test("gallery dialog traps focus, disables the background, and restores focus on Escape", async () => {
  const page = await loadPage({ modal: true });
  const { dialog, keyEvents } = page;
  dialog.gallery.events.click({ target: { closest: () => dialog.card } });
  assert.equal(dialog.node.hidden, false);
  assert.equal(page.main.inert, true);
  assert.equal(page.document.activeElement, dialog.close);
  let prevented = 0;
  keyEvents.keydown({ key: "Tab", shiftKey: true, preventDefault: () => prevented++ });
  assert.equal(page.document.activeElement, dialog.link);
  keyEvents.keydown({ key: "Tab", shiftKey: false, preventDefault: () => prevented++ });
  assert.equal(page.document.activeElement, dialog.close);
  assert.equal(prevented, 2);
  keyEvents.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(dialog.node.hidden, true);
  assert.equal(page.main.inert, false);
  assert.equal(page.document.activeElement, dialog.card);
});
