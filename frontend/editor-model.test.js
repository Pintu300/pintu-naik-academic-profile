const assert = require("node:assert/strict");
const { test } = require("node:test");
const { editorSections, editorField, updateEditorRecord, createEditorSessionTracker } = require("./editor-model");

const sessionFixture = () => {
  let time = 0;
  let visible = true;
  let expired = 0;
  let renewed = 0;
  let callback;
  const tracker = createEditorSessionTracker({
    now: () => time, isVisible: () => visible,
    setTimer: (next) => { callback = next; return 1; }, clearTimer: () => {},
    onActivity: () => { renewed++; }, onIdle: () => { expired++; }
  });
  tracker.start();
  return { tracker, advance: (ms) => { time += ms; }, hide: () => { visible = false; }, show: () => { visible = true; },
    tick: () => callback(), state: () => ({ expired, renewed }) };
};

test("editor activity extends idle time without letting timer ticks or hidden pages renew sessions", () => {
  const session = sessionFixture();
  session.advance(40000);
  session.tracker.activity();
  assert.deepEqual(session.state(), { expired: 0, renewed: 1 });
  session.advance(1000);
  session.tracker.activity();
  assert.equal(session.state().renewed, 1);
  session.hide();
  session.advance(4 * 60000);
  session.tracker.activity();
  session.tick();
  assert.deepEqual(session.state(), { expired: 0, renewed: 1 });
  session.advance(60000);
  session.tick();
  assert.deepEqual(session.state(), { expired: 1, renewed: 1 });
  session.show();
  session.tracker.activity();
  assert.deepEqual(session.state(), { expired: 1, renewed: 1 });
});

test("returning after five idle minutes expires before interaction can renew the session", () => {
  const session = sessionFixture();
  session.advance(5 * 60000);
  session.tracker.activity();
  assert.deepEqual(session.state(), { expired: 1, renewed: 0 });
  session.tracker.start();
  session.advance(40000);
  session.tracker.activity();
  assert.deepEqual(session.state(), { expired: 1, renewed: 1 });
  session.tracker.stop();
  session.advance(10 * 60000);
  session.tick();
  assert.deepEqual(session.state(), { expired: 1, renewed: 1 });
});

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

test("publication editor accepts an optional code repository URL", () => {
  const field = editorSections.publications.fields.map(editorField).find((item) => item.name === "codeUrl");
  assert.equal(field.kind, "url");
  assert.equal(field.required, false);
  assert.equal(updateEditorRecord({ title: "Paper" }, { codeUrl: " https://example.com/code " }).codeUrl, "https://example.com/code");
});
