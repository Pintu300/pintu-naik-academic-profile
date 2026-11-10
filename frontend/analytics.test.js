const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const script = fs.readFileSync(path.join(__dirname, "analytics.js"), "utf8");
const run = (hostname) => {
  const scripts = [];
  const window = { location: { hostname } };
  const document = { createElement: () => ({}), head: { append: (node) => scripts.push(node) } };
  vm.runInNewContext(script, { window, document });
  return { window, scripts };
};
test("local development never sends analytics page views", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const { window, scripts } = run(host);
    assert.equal(scripts.length, 0);
    assert.equal(window.dataLayer, undefined);
  }
});
test("published website still initializes analytics", () => {
  const { window, scripts } = run("pintu300.github.io");
  assert.equal(scripts.length, 1);
  assert.match(scripts[0].src, /^https:\/\/www.googletagmanager.com\/gtag\/js/);
  assert.equal(window.dataLayer.length, 2);
});
