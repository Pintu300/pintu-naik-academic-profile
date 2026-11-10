const assert = require("node:assert/strict");
const { test } = require("node:test");
const { editorSections, editorField, updateEditorRecord } = require("./editor-model");

test("form edits preserve extra stored fields and leave original data unchanged", () => {
  const original = { title: "Old", customField: "Keep me", url: "https://example.com" };
  const updated = updateEditorRecord(original, { title: " Updated ", url: "" });
  assert.deepEqual(updated, { title: "Updated", customField: "Keep me" });
  assert.equal(original.title, "Old");
  assert.equal(original.url, "https://example.com");
});

test("project editor supports contributions, results, code, and demo links", () => {
  const fields = editorSections.projects.fields.map(editorField);
  for (const key of ["title", "contribution", "results", "codeUrl", "demoUrl"]) assert.ok(fields.some((field) => field.name === key));
  assert.equal(fields.find((field) => field.name === "title").required, true);
  assert.equal(fields.find((field) => field.name === "codeUrl").kind, "url");
});
