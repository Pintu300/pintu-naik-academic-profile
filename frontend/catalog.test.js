const assert = require("node:assert/strict");
const { test } = require("node:test");
const catalog = require("./catalog");
const papers = [
  { title: "GPU Maximum Flow", authors: "A. Researcher, B. Author", venue: "Conference", year: "2026", type: "conference", status: "Accepted" },
  { title: "GPU Memory Study", authors: "A. Researcher", venue: "Journal", year: "2025", type: "journal" },
  { title: "Étude of networks", authors: "B. Author", venue: "Conference", year: "2027", type: "conference", status: "Submitted" },
  { title: "Undated work", authors: "C. Author", venue: "Journal", type: "journal" }
];
test("publication filters combine keyword, type, year, and status without mutating source records", () => {
  const original = structuredClone(papers);
  const filtered = catalog.filterPublications(papers, { query: "GPU researcher", type: "conference", year: "2026", status: "accepted" });
  assert.deepEqual(filtered, [papers[0]]);
  assert.deepEqual(papers, original);
  assert.equal(catalog.filterPublications(papers, { query: "etude" })[0].title, "Étude of networks");
  assert.equal(catalog.filterPublications(papers, { status: "Published" }).length, 2);
  assert.equal(catalog.filterPublications(papers, { year: "1900" }).length, 0);
});
test("year sorting handles undated records and both directions", () => {
  assert.deepEqual(catalog.filterPublications(papers).map((paper) => paper.year), ["2027", "2026", "2025", undefined]);
  assert.deepEqual(catalog.filterPublications(papers, { order: "oldest" }).map((paper) => paper.year), ["2025", "2026", "2027", undefined]);
});
test("BibTeX preserves submission state, uses only supplied metadata, and escapes TeX control characters", () => {
  const pending = catalog.bibtex({ ...papers[0], title: "GPU {Flow} & Memory_Study", authors: "Pintu Naik, and Sidharth Maheswari" });
  assert.match(pending, /^@unpublished/);
  assert.match(pending, /note = \{Accepted\. Conference\}/);
  assert.ok(pending.includes("GPU \\{Flow\\} \\& Memory\\_Study"));
  assert.ok(pending.includes("Pintu Naik and Sidharth Maheswari"));
  assert.ok(!pending.includes("doi ="));
  assert.ok(!pending.includes("journal ="));
  assert.match(catalog.bibtex(papers[2]), /Submitted/);
  assert.match(catalog.bibtex({ ...papers[0], status: "Accepted for publication" }), /^@unpublished/);
  const published = catalog.bibtex({ ...papers[1], doi: "https://doi.org/10.1234/paper" });
  assert.match(published, /^@article/);
  assert.match(published, /doi = \{10\.1234\/paper\}/);
});
test("citation keys remain stable across sorting and distinguish different papers", () => {
  const keys = papers.map(catalog.publicationKey);
  assert.equal(new Set(keys).size, papers.length);
  assert.equal(catalog.publicationKey(structuredClone(papers[0])), keys[0]);
  assert.ok(catalog.filterPublications(papers).map(catalog.publicationKey).includes(keys[0]));
  assert.match(catalog.citationText(papers[2]), /Status: Submitted/);
});
test("project filtering combines technologies and contribution text", () => {
  const projects = [{ title: "Solver", stack: "CUDA, C++", contribution: "Parallel graph algorithm" }, { title: "Dashboard", stack: "JavaScript; SQL", results: "Faster analysis" }];
  assert.equal(catalog.filterProjects(projects, { query: "graph", technology: "cuda" }).length, 1);
  assert.equal(catalog.filterProjects(projects, { query: "graph", technology: "SQL" }).length, 0);
  assert.equal(catalog.filterProjects(projects, { technology: "SQL" })[0].title, "Dashboard");
  assert.deepEqual(catalog.filterProjects([], { query: "anything" }), []);
});
