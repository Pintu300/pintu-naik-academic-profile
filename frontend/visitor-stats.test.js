const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "visitor-stats.js"), "utf8");
const render = async (responseDate, configuredDate = "2026-11-10", renderOptions = {}) => {
  const nodes = new Map(["total", "period", "status", "list", "updated", "retry"].map((name) => [
    `[data-visitor-${name}]`, {
      textContent: name === "total" ? "—" : "", hidden: name === "retry", disabled: false,
      events: {}, replaceChildren() {},
      addEventListener(name, handler) { this.events[name] = handler; },
      focus() { document.activeElement = this; }
    }
  ]));
  const panel = {
    dataset: { endpoint: "https://stats.example.com/api/visitor-stats", startDate: configuredDate },
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
    querySelector: (selector) => nodes.get(selector)
  };
  const document = { querySelector: () => panel, activeElement: null, body: {} };
  const retry = nodes.get("[data-visitor-retry]");
  let disabled = false;
  Object.defineProperty(retry, "disabled", {
    get: () => disabled,
    set(value) {
      disabled = value;
      if (value && document.activeElement === retry) document.activeElement = document.body;
    }
  });
  const requests = [];
  const errors = [];
  const timers = new Map();
  let timerId = 0;
  await vm.runInNewContext(source, {
    document, window: {
      location: { href: "http://localhost:3000/" },
      setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout(id) { timers.delete(id); }
    }, URL, AbortController,
    console: { error: (...args) => errors.push(args) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (renderOptions.fetch) return renderOptions.fetch(options, requests.length, timers);
      return { ok: true, json: async () => ({ startDate: responseDate, totalVisitors: 3, countries: [], updatedAt: "2026-11-10T13:00:00Z" }) };
    }
  });
  return { nodes, requests, errors, panel, document, timers };
};
test("visitor requests use a date-specific URL and bypass browser caches", async () => {
  const { nodes, requests, errors } = await render("2026-11-10");
  assert.equal(new URL(requests[0].url).searchParams.get("since"), "2026-11-10");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(nodes.get("[data-visitor-period]").textContent, "Unique visitors since 2026-11-10");
  assert.equal(nodes.get("[data-visitor-total]").textContent, "3");
  assert.equal(errors.length, 0);
});
test("an old-period response cannot relabel historical counts as new visitors", async () => {
  const { nodes, errors } = await render("2020-01-01");
  assert.equal(nodes.get("[data-visitor-total]").textContent, "—");
  assert.equal(nodes.get("[data-visitor-period]").textContent, "");
  assert.match(nodes.get("[data-visitor-status]").textContent, /temporarily unavailable/);
  assert.equal(errors.length, 1);
});
test("changing the configured reporting date changes the request and displayed period together", async () => {
  const { nodes, requests } = await render("2026-11-11", "2026-11-11");
  assert.equal(new URL(requests[0].url).searchParams.get("since"), "2026-11-11");
  assert.equal(nodes.get("[data-visitor-period]").textContent, "Unique visitors since 2026-11-11");
});

const successfulResponse = () => ({
  ok: true,
  json: async () => ({ startDate: "2026-11-10", totalVisitors: 3, countries: [], updatedAt: "2026-11-10T13:00:00Z" })
});

test("a failed visitor request can be retried without reloading or leaving keyboard focus on a hidden button", async () => {
  const state = await render("2026-11-10", undefined, {
    fetch: async (_options, attempt) => {
      if (attempt === 1) throw new Error("Offline");
      return successfulResponse();
    }
  });
  const retry = state.nodes.get("[data-visitor-retry]");
  assert.equal(retry.hidden, false);
  state.document.activeElement = retry;
  await retry.events.click();
  assert.equal(state.requests.length, 2);
  assert.equal(state.requests[1].options.cache, "no-store");
  assert.equal(retry.hidden, true);
  assert.equal(state.nodes.get("[data-visitor-total]").textContent, "3");
  assert.equal(state.document.activeElement, state.nodes.get("[data-visitor-status]"));
  assert.equal(state.panel.attributes["aria-busy"], "false");
  assert.equal(state.timers.size, 0);
});

test("a stalled visitor request is aborted after ten seconds and offers retry", async () => {
  const state = await render("2026-11-10", undefined, {
    fetch: async ({ signal }, _attempt, timers) => {
      const timer = [...timers.values()][0];
      assert.equal(timer.delay, 10_000);
      timer.callback();
      assert.equal(signal.aborted, true);
      throw signal.reason;
    }
  });
  assert.match(state.nodes.get("[data-visitor-status]").textContent, /took too long/);
  assert.equal(state.nodes.get("[data-visitor-retry]").hidden, false);
  assert.equal(state.nodes.get("[data-visitor-total]").textContent, "—");
  assert.equal(state.panel.attributes["aria-busy"], "false");
  assert.equal(state.timers.size, 0);
});

test("repeated retry clicks cannot start overlapping visitor requests", async () => {
  let complete;
  const state = await render("2026-11-10", undefined, {
    fetch: async (_options, attempt) => {
      if (attempt === 1) throw new Error("Offline");
      return new Promise((resolve) => { complete = resolve; });
    }
  });
  const retry = state.nodes.get("[data-visitor-retry]");
  state.document.activeElement = retry;
  const pending = retry.events.click();
  assert.equal(retry.disabled, true);
  assert.equal(state.panel.attributes["aria-busy"], "true");
  await retry.events.click();
  assert.equal(state.requests.length, 2);
  const anotherControl = {};
  state.document.activeElement = anotherControl;
  complete(successfulResponse());
  await pending;
  assert.equal(retry.disabled, false);
  assert.equal(state.document.activeElement, anotherControl);
  assert.equal(state.timers.size, 0);
});
