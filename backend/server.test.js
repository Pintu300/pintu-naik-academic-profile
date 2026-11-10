const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, test } = require("node:test");
const { createServer } = require("./server");

const DATA = {
  profile: {
    name: "Test User",
    title: "Researcher",
    institution: "Test Institute",
    department: "Computer Science",
    email: "test@example.com",
    summary: "A test profile."
  },
  research: [],
  updates: [],
  publications: [],
  projects: [],
  achievements: [],
  education: [],
  skills: [{ title: "Programming", description: "C++" }],
  teaching: []
};

let temporaryDirectory;
let server;
let baseUrl;
let csrfToken;
let adminCookie;
let testTime;

const login = (credentials = { username: "admin", password: "test-password" }, extraHeaders = {}) => fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Requested-With": "admin-editor", ...extraHeaders },
  body: JSON.stringify(credentials)
});

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "academic-profile-server-"));
  const dataDir = path.join(temporaryDirectory, "data");
  const frontendDir = path.join(temporaryDirectory, "frontend");
  await fs.mkdir(dataDir);
  await fs.mkdir(frontendDir);
  await fs.writeFile(path.join(frontendDir, "index.html"), "<h1>Test site</h1>");
  await Promise.all(["admin.html", "admin.js", "editor-model.js", "login.html", "login.js"].map((name) =>
    fs.copyFile(path.join(__dirname, "..", "frontend", name), path.join(frontendDir, name))
  ));

  await Promise.all(
    Object.entries(DATA).map(([name, value]) =>
      fs.writeFile(path.join(dataDir, `${name}.json`), `${JSON.stringify(value)}\n`)
    )
  );

  testTime = Date.now();
  server = createServer({
    adminPassword: "test-password",
    dataDir,
    frontendDir,
    maxBodyBytes: 1_000,
    now: () => testTime
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const signedIn = await login();
  assert.equal(signedIn.status, 200);
  adminCookie = signedIn.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } });
  csrfToken = response.headers.get("x-csrf-token");
});

afterEach(async () => {
  if (server?.listening) {
    const closed = new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server.closeAllConnections();
    await closed;
  }
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

test("serves health checks without depending on data files", async () => {
  await fs.rm(path.join(temporaryDirectory, "data"), { recursive: true });
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("serves public data and static pages", async () => {
  const profileResponse = await fetch(`${baseUrl}/api/profile`);
  assert.equal(profileResponse.status, 200);
  assert.deepEqual(await profileResponse.json(), DATA.profile);

  const skillsResponse = await fetch(`${baseUrl}/data/skills.json`);
  assert.equal(skillsResponse.status, 200);
  assert.deepEqual(await skillsResponse.json(), DATA.skills);

  const pageResponse = await fetch(baseUrl);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /Test site/);
});

test("returns clear errors for unknown paths, methods, and traversal attempts", async () => {
  const missingResponse = await fetch(`${baseUrl}/api/missing`);
  assert.equal(missingResponse.status, 404);

  const methodResponse = await fetch(`${baseUrl}/api/profile`, { method: "POST" });
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("allow"), "GET, HEAD");

  const traversalResponse = await fetch(`${baseUrl}/%2e%2e/backend/server.js`);
  assert.notEqual(traversalResponse.status, 200);
});

test("protects the admin API and rejects malformed or oversized updates", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/admin/site-data`);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("www-authenticate"), null);

  const malformed = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json"
    },
    body: "{invalid"
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Request body must contain valid JSON." });

  const oversized = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ payload: "x".repeat(1_100) })
  });
  assert.equal(oversized.status, 413);
});

test("saves valid admin updates and validates all required data", async () => {
  const updatedData = structuredClone(DATA);
  updatedData.skills[0].description = "C++, OpenMP, CUDA";

  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(updatedData)
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "saved" });

  const savedSkills = JSON.parse(
    await fs.readFile(path.join(temporaryDirectory, "data", "skills.json"), "utf8")
  );
  assert.deepEqual(savedSkills, updatedData.skills);

  const invalidData = { ...updatedData, teaching: "not-an-array" };
  const invalidResponse = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(invalidData)
  });

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { error: "teaching must be an array." });
});

test("rolls back a data update when a file cannot be replaced", async () => {
  const dataDir = path.join(temporaryDirectory, "data");
  await fs.unlink(path.join(dataDir, "skills.json"));

  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "X-CSRF-Token": csrfToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(DATA)
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error." });

  const savedProfile = JSON.parse(await fs.readFile(path.join(dataDir, "profile.json"), "utf8"));
  assert.deepEqual(savedProfile, DATA.profile);

  const remainingFiles = await fs.readdir(dataDir);
  assert.equal(remainingFiles.some((filename) => filename.endsWith(".tmp") || filename.endsWith(".bak")), false);
});


test("protects normalized and encoded admin paths", async () => {
  for (const route of ["/admin.html", "/admin.js", "/%61dmin.html", "/%61dmin.js", "/assets/../admin.html", "/%61pi/admin/site-data"]) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: "manual" });
    assert.equal(response.status, route.endsWith("admin.html") || route.endsWith("dmin.html") ? 303 : 401, route);
    if (response.status === 303) assert.equal(response.headers.get("location"), "/login.html");
  }
});

test("blocks admin updates without a token and from foreign origins", async () => {
  for (const headers of [
    {},
    { "X-CSRF-Token": "wrong" },
    { "X-CSRF-Token": csrfToken, Origin: "https://attacker.example" },
    { "X-CSRF-Token": csrfToken, "Sec-Fetch-Site": "cross-site" }
  ]) {
    const response = await fetch(`${baseUrl}/api/admin/site-data`, {
      method: "PUT",
      headers: { Cookie: adminCookie, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(DATA)
    });
    assert.equal(response.status, 403);
  }
  const response = await fetch(`${baseUrl}/api/profile`);
  assert.deepEqual(await response.json(), DATA.profile);
});

test("throttles login guesses without trusting forwarded addresses", async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await login({ username: "admin", password: "wrong" }, { "X-Forwarded-For": `192.0.2.${attempt}` });
    assert.equal(response.status, 401);
  }
  const blocked = await login();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await fetch(`${baseUrl}/api/profile`)).status, 200);
  // Existing authenticated sessions stay usable while guesses are blocked.
  assert.equal((await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } })).status, 200);
  testTime += 15 * 60 * 1000;
  assert.equal((await login()).status, 200);
});

test("rejects hidden files, symlinks, and malformed paths", async () => {
  const frontendDir = path.join(temporaryDirectory, "frontend");
  await fs.writeFile(path.join(frontendDir, ".env"), "secret");
  await fs.symlink(path.join(temporaryDirectory, "data", "profile.json"), path.join(frontendDir, "leak.json"));
  await fs.writeFile(path.join(frontendDir, "admin.html"), "private editor");
  await fs.symlink(path.join(frontendDir, "admin.html"), path.join(frontendDir, "alias.html"));
  for (const route of ["/.env", "/%2eenv", "/leak.json", "/alias.html", "/%00", "/%ZZ", "/assets/%2e%2e%2fadmin.html"]) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.ok([400, 403].includes(response.status), route);
  }
  assert.equal((await fetch(`${baseUrl}/data/constructor.json`)).status, 404);
});

test("rejects unsafe stored URLs, asset paths, and nested values", async () => {
  const { validateSiteData } = require("./server");
  for (const update of [
    (data) => { data.profile.photo = "https://tracker.example/photo.jpg"; },
    (data) => { data.profile.links = { department: "javascript:alert(1)" }; },
    (data) => { data.profile.about = [ {} ]; },
    (data) => { data.publications = [{ title: "Paper", url: "javascript:alert(1)" }]; },
    (data) => { data.achievements = [{ image: "assets/../admin.html" }]; },
    (data) => { data.projects = [{ title: {} }]; }
  ]) {
    const data = structuredClone(DATA);
    update(data);
    assert.equal(typeof validateSiteData(data), "string");
    const response = await fetch(`${baseUrl}/api/admin/site-data`, {
      method: "PUT",
      headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    assert.equal(response.status, 400);
  }
});

test("sends browser security headers on pages and errors", async () => {
  for (const route of ["/", "/missing.html", "/admin.html"]) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.match(response.headers.get("content-security-policy"), /script-src-attr 'none'/);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.match(response.headers.get("permissions-policy"), /camera=\(\)/);
  }
});

test("current website content passes security validation", async () => {
  const { validateSiteData } = require("./server");
  const entries = await Promise.all(Object.keys(DATA).map(async (name) => [
    name, JSON.parse(await fs.readFile(path.join(__dirname, "data", `${name}.json`), "utf8"))
  ]));
  assert.equal(validateSiteData(Object.fromEntries(entries)), null);
});

test("serializes simultaneous admin saves without mixing content or leaving staging files", async () => {
  const versions = ["First version", "Second version", "Third version"].map((name) => {
    const data = structuredClone(DATA);
    data.profile.name = name;
    data.skills[0].description = name;
    return data;
  });
  const responses = await Promise.all(versions.map((data) => fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(data)
  })));
  responses.forEach((response) => assert.equal(response.status, 200));
  const saved = await (await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } })).json();
  assert.equal(saved.profile.name, saved.skills[0].description);
  const files = await fs.readdir(path.join(temporaryDirectory, "data"));
  assert.equal(files.some((name) => name.endsWith(".tmp") || name.endsWith(".bak")), false);
});

test("static pages carry the same script restrictions as the server", async () => {
  const frontendDir = path.join(__dirname, "..", "frontend");
  const response = await fetch(baseUrl);
  const headerPolicy = response.headers.get("content-security-policy");
  for (const name of (await fs.readdir(frontendDir)).filter((name) => name.endsWith(".html"))) {
    const html = await fs.readFile(path.join(frontendDir, name), "utf8");
    const metaPolicy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
    assert.equal(metaPolicy, headerPolicy.replace("; frame-ancestors 'none'", ""), name);
    assert.doesNotMatch(html, /\son\w+\s*=/i, name);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>\s*\S/i, name);
  }
});

test("login issues a protected session cookie and rejects incorrect credentials", async () => {
  const response = await login();
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^admin_session=[a-f0-9]{64};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=28800/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), { status: "signed-in" });
  assert.equal((await login({ username: "wrong", password: "test-password" })).status, 401);
  assert.equal((await login({ username: "admin", password: "wrong" })).status, 401);
  const basic = await fetch(`${baseUrl}/api/admin/site-data`, {
    headers: { Authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}` }
  });
  assert.equal(basic.status, 401);
  const forged = await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: `admin_session=${"a".repeat(64)}` } });
  assert.equal(forged.status, 401);
});

test("login rejects cross-site requests, malformed bodies, and excessive bodies", async () => {
  assert.equal((await login(undefined, { Origin: "https://attacker.example" })).status, 403);
  assert.equal((await login(undefined, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await login(undefined, { "X-Requested-With": "" })).status, 403);
  assert.equal((await login(undefined, { "Content-Type": "text/plain" })).status, 415);
  const malformed = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "admin-editor" }, body: "{"
  });
  assert.equal(malformed.status, 400);
  assert.equal((await login({ username: [], password: "test-password" })).status, 400);
  assert.equal((await login({ username: "admin", password: "a".repeat(5000) })).status, 413);
  assert.equal((await fetch(`${baseUrl}/api/auth/login`)).status, 405);
});

test("logout requires the session CSRF token and invalidates the cookie", async () => {
  const logout = (token) => fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST", headers: { Cookie: adminCookie, "X-Requested-With": "admin-editor", "X-CSRF-Token": token }
  });
  assert.equal((await logout("wrong")).status, 403);
  assert.equal((await logout("é".repeat(64))).status, 403);
  const response = await logout(csrfToken);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } })).status, 401);
  assert.equal((await logout(csrfToken)).status, 401);
});

test("sessions expire after inactivity and cannot outlive the absolute timeout", async () => {
  const request = () => fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } });
  testTime += 30 * 60 * 1000;
  assert.equal((await request()).status, 401);
  const signedIn = await login();
  adminCookie = signedIn.headers.get("set-cookie").split(";")[0];
  for (let count = 0; count < 16; count++) {
    testTime += 29 * 60 * 1000;
    assert.equal((await request()).status, 200);
  }
  testTime += 16 * 60 * 1000;
  assert.equal((await request()).status, 401);
});

test("logging in rotates the session and prevents cross-session CSRF token reuse", async () => {
  const oldCookie = adminCookie;
  const signedIn = await login(undefined, { Cookie: oldCookie });
  const newCookie = signedIn.headers.get("set-cookie").split(";")[0];
  assert.notEqual(oldCookie, newCookie);
  assert.equal((await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: oldCookie } })).status, 401);
  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT", headers: { Cookie: newCookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json" }, body: JSON.stringify(DATA)
  });
  assert.equal(response.status, 403);
});

test("serves the login publicly and serves the editor only with a session", async () => {
  const redirect = await fetch(`${baseUrl}/admin.html`, { redirect: "manual" });
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get("location"), "/login.html");
  const loginPage = await fetch(`${baseUrl}/login.html`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /autocomplete="current-password"/);
  assert.equal((await fetch(`${baseUrl}/login.js`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/admin.js`)).status, 401);
  const editor = await fetch(`${baseUrl}/admin.html`, { headers: { Cookie: adminCookie } });
  assert.equal(editor.status, 200);
  assert.match(await editor.text(), /data-logout/);
  assert.equal((await fetch(`${baseUrl}/admin.js`, { headers: { Cookie: adminCookie } })).status, 200);
});

test("HTTPS proxy configuration enables Secure cookies and checks its exact origin", async () => {
  const proxyServer = createServer({ adminUser: "owner", adminPassword: "test-password", adminOrigin: "https://example.com" });
  await new Promise((resolve, reject) => {
    proxyServer.once("error", reject);
    proxyServer.listen(0, "127.0.0.1", resolve);
  });
  try {
    const url = `http://127.0.0.1:${proxyServer.address().port}/api/auth/login`;
    const headers = { "Content-Type": "application/json", "X-Requested-With": "admin-editor", Origin: "https://example.com" };
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ username: "owner", password: "test-password" }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /; Secure/);
    const rejected = await fetch(url, { method: "POST", headers: { ...headers, Origin: baseUrl }, body: "{}" });
    assert.equal(rejected.status, 403);
  } finally {
    await new Promise((resolve) => { proxyServer.close(resolve); proxyServer.closeAllConnections(); });
  }
});

test("login stays disabled without a configured password", async () => {
  const disabledServer = createServer({ adminPassword: "" });
  await new Promise((resolve, reject) => {
    disabledServer.once("error", reject);
    disabledServer.listen(0, "127.0.0.1", resolve);
  });
  try {
    const url = `http://127.0.0.1:${disabledServer.address().port}`;
    const response = await fetch(`${url}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "admin-editor" }, body: JSON.stringify({ username: "admin", password: "" })
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await fetch(`${url}/api/admin/site-data`)).status, 401);
  } finally {
    await new Promise((resolve) => { disabledServer.close(resolve); disabledServer.closeAllConnections(); });
  }
});

test("compresses text responses and honors clients that disable gzip", async () => {
  const css = "body { color: navy; background: white; }\n".repeat(100);
  await fs.writeFile(path.join(temporaryDirectory, "frontend", "styles.css"), css);
  const compressed = await fetch(`${baseUrl}/styles.css`, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.equal(compressed.headers.get("vary"), "Accept-Encoding");
  assert.equal(await compressed.text(), css);
  const uncompressed = await fetch(`${baseUrl}/styles.css`, { headers: { "Accept-Encoding": "gzip;q=0" } });
  assert.equal(uncompressed.headers.get("content-encoding"), null);
  assert.equal(await uncompressed.text(), css);
});

test("revalidates public assets without serving stale edits or caching admin content", async () => {
  const file = path.join(temporaryDirectory, "frontend", "styles.css");
  await fs.writeFile(file, "body { color: navy; }");
  const first = await fetch(`${baseUrl}/styles.css`);
  const etag = first.headers.get("etag");
  assert.ok(etag);
  assert.match(first.headers.get("cache-control"), /must-revalidate/);
  const cached = await fetch(`${baseUrl}/styles.css`, { headers: { "If-None-Match": etag } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), "");
  await fs.writeFile(file, "body { color: teal; }");
  const changed = await fetch(`${baseUrl}/styles.css`, { headers: { "If-None-Match": etag } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
  assert.match(await changed.text(), /teal/);
  for (const route of ["/admin.html", "/admin.js", "/api/admin/site-data"]) {
    const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: adminCookie } });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), null);
  }
});
