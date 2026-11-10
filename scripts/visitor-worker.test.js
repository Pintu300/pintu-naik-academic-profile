const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { generateKeyPairSync, verify, webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../cloudflare/visitor-stats/worker.mjs"), "utf8");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const secrets = {
  GA_CLIENT_EMAIL: "test@example.invalid",
  GA_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }),
  GA_PROPERTY_ID: "123456",
  GA_REPORT_START_DATE: "2026-11-10"
};
const report = {
  totals: [{ metricValues: [{ value: "3" }] }],
  rows: [{ dimensionValues: [{ value: "India" }, { value: "IN" }], metricValues: [{ value: "3" }] }]
};
const harness = (options = {}) => {
  const calls = [];
  const errors = [];
  const context = {
    crypto: webcrypto, TextEncoder, URL, URLSearchParams, Request, Response, atob, btoa,
    console: { error: (...args) => errors.push(args) },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) return Response.json(options.tokenBody || { access_token: "temporary-test-token" }, { status: options.tokenStatus || 200 });
      return Response.json(options.report || report, { status: options.reportStatus || 200 });
    }
  };
  vm.runInNewContext(source.replace("export default {", "globalThis.worker = {"), context);
  return {
    calls, errors,
    request: (pathname = "/api/visitor-stats", method = "GET", env = secrets) =>
      context.worker.fetch(new Request(`https://stats.example.invalid${pathname}`, { method }), env)
  };
};

test("visitor Worker handles preflight, unknown paths, and disallowed methods without contacting Google", async () => {
  const h = harness();
  assert.equal((await h.request("/api/visitor-stats", "OPTIONS")).status, 204);
  assert.equal((await h.request("/missing")).status, 404);
  const response = await h.request("/api/visitor-stats", "POST");
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, OPTIONS");
  assert.equal(h.calls.length, 0);
});

test("visitor Worker signs its OAuth assertion and requests the configured reporting period", async () => {
  const h = harness();
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const data = await response.json();
  assert.equal(data.startDate, secrets.GA_REPORT_START_DATE);
  assert.equal(data.totalVisitors, 3);
  assert.deepEqual(data.countries, [{ country: "India", countryCode: "IN", visitors: 3 }]);
  const assertion = h.calls[0].init.body.get("assertion");
  const [header, payload, signature] = assertion.split(".");
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, secrets.GA_CLIENT_EMAIL);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(h.calls[1].init.headers.Authorization, "Bearer temporary-test-token");
  assert.deepEqual(JSON.parse(h.calls[1].init.body).dateRanges, [{ startDate: secrets.GA_REPORT_START_DATE, endDate: "today" }]);
});

test("visitor Worker defaults to the new start date and accepts escaped PEM newlines", async () => {
  const h = harness();
  const env = { ...secrets, GA_PRIVATE_KEY: secrets.GA_PRIVATE_KEY.replace(/\n/g, "\\n") };
  delete env.GA_REPORT_START_DATE;
  const response = await h.request("/api/visitor-stats?since=2020-01-01", "GET", env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).startDate, "2026-11-10");
});

test("visitor Worker rejects missing secrets and malformed configuration before network calls", async () => {
  for (const env of [{}, { ...secrets, GA_PROPERTY_ID: "not-an-id" }, { ...secrets, GA_REPORT_START_DATE: "10/11/2026" }]) {
    const h = harness();
    const response = await h.request("/api/visitor-stats", "GET", env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(h.calls.length, 0);
    assert.deepEqual(await response.json(), { error: "Visitor statistics are temporarily unavailable." });
  }
});

test("visitor Worker returns a generic noncached error on OAuth and Analytics failures", async () => {
  for (const options of [{ tokenStatus: 401 }, { tokenBody: {} }, { reportStatus: 429 }]) {
    const h = harness(options);
    const response = await h.request();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.text();
    assert.ok(!body.includes("temporary-test-token"));
    assert.ok(!body.includes(secrets.GA_CLIENT_EMAIL));
  }
});

test("visitor Worker rejects missing, negative, and unsafe aggregate visitor counts", async () => {
  for (const value of [undefined, "-1", "1.5", "9007199254740992"]) {
    const h = harness({ report: { ...report, totals: [{ metricValues: [{ value }] }] } });
    assert.equal((await h.request()).status, 503);
  }
});

test("visitor Worker handles an empty reporting period as zero visitors", async () => {
  const h = harness({ report: {} });
  const response = await h.request();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.totalVisitors, 0);
  assert.deepEqual(data.countries, []);
});

test("visitor Worker filters invalid country rows without replacing the aggregate total", async () => {
  const h = harness({ report: { ...report, rows: [...report.rows, {}, { dimensionValues: [{ value: "Invalid" }, { value: "XX" }], metricValues: [{ value: "-1" }] }] } });
  const response = await h.request();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.totalVisitors, 3);
  assert.equal(data.countries.length, 1);
});
