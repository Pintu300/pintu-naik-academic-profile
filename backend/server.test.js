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
let revision;
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
  revision = response.headers.get("etag");
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

test("never serves private configuration, credentials, or backups misplaced in the frontend", async () => {
  const frontend = path.join(temporaryDirectory, "frontend");
  await fs.mkdir(path.join(frontend, "assets"));
  const names = [".env", "credentials.json", "auth.js", "assets/.env", "assets/service-account.json", "assets/academic-site-backup-today.json", "assets/backup-notes.pdf", "assets/signing.pem", "assets/config.json"];
  for (const name of names) {
    await fs.writeFile(path.join(frontend, name), "Synthetic private fixture");
    const response = await fetch(`${baseUrl}/${name}`);
    assert.equal(response.status, 403, name);
    assert.ok(!(await response.text()).includes("Synthetic private fixture"));
  }
  await fs.writeFile(path.join(frontend, "assets", "photo.jpg"), "Public image fixture");
  assert.equal((await fetch(`${baseUrl}/assets/photo.jpg`)).status, 200);
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
      "X-CSRF-Token": csrfToken, "If-Match": revision,
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
      "X-CSRF-Token": csrfToken, "If-Match": revision,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ payload: "x".repeat(1_100) })
  });
  assert.equal(oversized.status, 413);
});

test("rejects oversized chunked requests before the client finishes uploading", async () => {
  const http = require("node:http");
  const unfinished = (route, size, headers = {}) => new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}${route}`, {
      method: route.includes("auth") ? "POST" : "PUT",
      headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked", ...headers }
    }, (response) => {
      response.resume();
      response.on("end", () => {
        clearTimeout(timer);
        request.destroy();
        resolve({ status: response.statusCode, connection: response.headers.connection });
      });
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error("The server waited for the client to finish an oversized body."));
    }, 2500);
    request.on("error", (error) => { clearTimeout(timer); reject(error); });
    // Deliberately do not call end(): exceeding the limit must be sufficient.
    request.write(Buffer.alloc(size, "x"));
  });
  for (const [route, size, headers] of [
    ["/api/auth/login", 4097, { "X-Requested-With": "admin-editor" }],
    ["/api/admin/site-data", 1001, { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "If-Match": revision }]
  ]) {
    assert.deepEqual(await unfinished(route, size, headers), { status: 413, connection: "close" });
  }
  assert.equal((await login()).status, 200);
});

test("unfinished login uploads cannot occupy all password-verification slots", async () => {
  const http = require("node:http");
  const held = [];
  let notifyReady;
  let arrivals = 0;
  const ready = new Promise((resolve) => { notifyReady = resolve; });
  const observe = (request) => {
    if (request.headers["x-upload-test"] && ++arrivals === 4) notifyReady();
  };
  server.on("request", observe);
  try {
    for (let index = 0; index < 4; index++) {
      const request = http.request(`${baseUrl}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "admin-editor", "X-Upload-Test": "held", "Transfer-Encoding": "chunked" }
      });
      request.on("error", () => {});
      held.push(request);
      request.write("{");
    }
    await ready;
    const response = await login();
    assert.equal(response.status, 200, "Slow body uploads must not exhaust the password-verification limit.");
  } finally {
    server.removeListener("request", observe);
    held.forEach((request) => request.destroy());
  }
});

test("rejects unknown backup roots and publication records that cannot appear in any category", async () => {
  for (const update of [
    (data) => { data.unexpected = "Must not be retained in browser backups"; },
    (data) => { Object.defineProperty(data, "__proto__", { value: {}, enumerable: true }); },
    (data) => { data.publications = [{ title: "Invisible paper", type: "unsupported" }]; },
    (data) => { data.publications = [{ title: "Paper with no type" }]; },
    (data) => { data.publications = [{ title: " ", type: "journal" }]; }
  ]) {
    const data = structuredClone(DATA);
    update(data);
    for (const [route, method] of [["site-data", "PUT"], ["validate-backup", "POST"]]) {
      const response = await fetch(`${baseUrl}/api/admin/${route}`, {
        method, headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "If-Match": revision, "Content-Type": "application/json" }, body: JSON.stringify(data)
      });
      assert.equal(response.status, 400, `${route} must reject invalid content`);
    }
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(temporaryDirectory, "data/profile.json"), "utf8")), DATA.profile);
});

test("saves valid admin updates and validates all required data", async () => {
  const updatedData = structuredClone(DATA);
  updatedData.skills[0].description = "C++, OpenMP, CUDA";

  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "X-CSRF-Token": csrfToken, "If-Match": revision,
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
      "X-CSRF-Token": csrfToken, "If-Match": revision,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(invalidData)
  });

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { error: "teaching must be an array." });
});

test("admin saves automatically snapshot the previous content outside public files", async () => {
  const next = structuredClone(DATA);
  next.profile.name = "New content";
  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT", headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "If-Match": revision, "Content-Type": "application/json" }, body: JSON.stringify(next)
  });
  assert.equal(response.status, 200);
  const directory = path.join(temporaryDirectory, "backups");
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, files[0]), "utf8")), DATA);
  const currentSnapshot = await server.createBackup();
  assert.equal(JSON.parse(await fs.readFile(currentSnapshot, "utf8")).profile.name, next.profile.name);
  assert.notEqual((await fetch(`${baseUrl}/backups/${path.basename(currentSnapshot)}`)).status, 200);
});

test("an unavailable snapshot directory cancels the save without changing website content", async () => {
  await fs.writeFile(path.join(temporaryDirectory, "backups"), "Not a directory");
  const next = structuredClone(DATA);
  next.profile.name = "Must not be saved";
  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT", headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "If-Match": revision, "Content-Type": "application/json" }, body: JSON.stringify(next)
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Save cancelled/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(temporaryDirectory, "data/profile.json"), "utf8")), DATA.profile);
});

test("rolls back a data update when a file cannot be replaced", async (t) => {
  const dataDir = path.join(temporaryDirectory, "data");
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, "rename", async (from, to) => {
    if (from === path.join(dataDir, "skills.json") && to.endsWith(".bak")) throw new Error("Simulated replacement failure");
    return rename(from, to);
  });

  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Cookie: adminCookie,
      "X-CSRF-Token": csrfToken, "If-Match": revision,
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
    { "X-CSRF-Token": csrfToken, "If-Match": revision, Origin: "https://attacker.example" },
    { "X-CSRF-Token": csrfToken, "If-Match": revision, "Sec-Fetch-Site": "cross-site" }
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
      headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "If-Match": revision, "Content-Type": "application/json" },
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
    headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "If-Match": revision, "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(data)
  })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 412, 412]);
  const saved = await (await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } })).json();
  assert.equal(saved.profile.name, saved.skills[0].description);
  const files = await fs.readdir(path.join(temporaryDirectory, "data"));
  assert.equal(files.some((name) => name.endsWith(".tmp") || name.endsWith(".bak")), false);
});

test("public content requests wait until an in-progress admin transaction finishes", async (t) => {
  const rename = fs.rename.bind(fs);
  let notifyMoved;
  let finishWrite;
  const moved = new Promise((resolve) => { notifyMoved = resolve; });
  const resume = new Promise((resolve) => { finishWrite = resolve; });
  t.mock.method(fs, "rename", async (from, to) => {
    await rename(from, to);
    if (from === path.join(temporaryDirectory, "data/profile.json") && to.endsWith(".bak")) {
      notifyMoved();
      await resume;
    }
  });
  const next = structuredClone(DATA);
  next.profile.name = "Updated public profile";
  const save = fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT", headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "If-Match": revision, "Content-Type": "application/json" }, body: JSON.stringify(next)
  });
  await moved;
  try {
    const reads = Promise.all(["/api/profile", "/data/profile.json"].map((route) => fetch(`${baseUrl}${route}`)));
    setTimeout(finishWrite, 50);
    for (const response of await reads) {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).name, next.profile.name);
    }
    assert.equal((await save).status, 200);
  } finally {
    finishWrite();
    await save;
  }
});

test("admin saves require an exact current revision and return the next revision", async () => {
  const put = (version, data = DATA) => fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT", headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "Content-Type": "application/json", ...(version === undefined ? {} : { "If-Match": version }) },
    body: JSON.stringify(data)
  });
  assert.match(revision, /^"[a-f0-9]{64}"$/);
  assert.equal((await put()).status, 428);
  assert.equal((await put("*")).status, 412);
  const updated = structuredClone(DATA);
  updated.profile.name = "New saved name";
  const saved = await put(revision, updated);
  assert.equal(saved.status, 200);
  const next = saved.headers.get("etag");
  assert.notEqual(next, revision);
  assert.equal((await put(revision)).status, 412);
  const response = await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } });
  assert.equal(response.headers.get("etag"), next);
  assert.equal((await response.json()).profile.name, updated.profile.name);
  assert.equal((await put(next)).status, 200);
});

test("external JSON edits invalidate an older editor revision", async () => {
  await fs.writeFile(path.join(temporaryDirectory, "data/profile.json"), JSON.stringify({ ...DATA.profile, name: "Changed in terminal" }));
  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT", headers: { Cookie: adminCookie, "X-CSRF-Token": csrfToken, "If-Match": revision, "Content-Type": "application/json" }, body: JSON.stringify(DATA)
  });
  assert.equal(response.status, 412);
  assert.match((await response.json()).error, /Download your draft/);
});

test("backup validation requires authentication and CSRF protection and never writes data", async () => {
  const route = `${baseUrl}/api/admin/validate-backup`;
  const backup = structuredClone(DATA);
  backup.profile.name = "Backup name";
  const submit = (headers, body = JSON.stringify(backup)) => fetch(route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
  assert.equal((await submit({})).status, 401);
  assert.equal((await submit({ Cookie: adminCookie })).status, 403);
  const headers = { Cookie: adminCookie, "X-CSRF-Token": csrfToken };
  assert.equal((await submit({ ...headers, Origin: "https://attacker.example" })).status, 403);
  assert.equal((await fetch(route, { headers: { Cookie: adminCookie } })).status, 405);
  const before = await Promise.all(Object.keys(DATA).map((key) => fs.readFile(path.join(temporaryDirectory, `data/${key}.json`), "utf8")));
  const response = await submit(headers);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "valid" });
  assert.deepEqual(await Promise.all(Object.keys(DATA).map((key) => fs.readFile(path.join(temporaryDirectory, `data/${key}.json`), "utf8"))), before);
  assert.equal((await submit(headers, "{invalid")).status, 400);
  assert.equal((await submit(headers, JSON.stringify({ profile: {} }))).status, 400);
  assert.equal((await submit(headers, JSON.stringify({ ...DATA, profile: { ...DATA.profile, photo: "../../secret" } }))).status, 400);
  assert.equal((await submit(headers, " ".repeat(1001))).status, 413);
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
  const editor = await fetch(`${baseUrl}/admin.html`, { headers: { Cookie: adminCookie }, redirect: "manual" });
  assert.equal(editor.status, 303);
  assert.equal(editor.headers.get("location"), "/login.html");
  assert.equal((await logout(csrfToken)).status, 401);
});

test("sessions expire after inactivity and cannot outlive the absolute timeout", async () => {
  const request = () => fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } });
  testTime += 5 * 60 * 1000;
  assert.equal((await request()).status, 401);
  const signedIn = await login();
  adminCookie = signedIn.headers.get("set-cookie").split(";")[0];
  for (let count = 0; count < 119; count++) {
    testTime += 4 * 60 * 1000;
    assert.equal((await request()).status, 200);
  }
  testTime += 4 * 60 * 1000;
  assert.equal((await request()).status, 401);
});

test("trusted editor activity renews the five-minute idle window and cannot revive expired sessions", async () => {
  const activity = (extra = {}) => fetch(`${baseUrl}/api/auth/activity`, {
    method: "POST", headers: { Cookie: adminCookie, "X-Requested-With": "admin-editor", "X-CSRF-Token": csrfToken, ...extra }
  });
  assert.equal((await fetch(`${baseUrl}/api/auth/activity`)).status, 405);
  assert.equal((await activity({ Cookie: "" })).status, 401);
  assert.equal((await activity({ "X-CSRF-Token": "wrong" })).status, 403);
  assert.equal((await activity({ Origin: "https://untrusted.invalid" })).status, 403);
  testTime += 4 * 60 * 1000;
  assert.equal((await activity()).status, 200);
  testTime += 4 * 60 * 1000;
  assert.equal((await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: adminCookie } })).status, 200);
  testTime += 5 * 60 * 1000;
  assert.equal((await activity()).status, 401);
});

test("invalid activity requests cannot extend an idle admin session", async () => {
  testTime += 4 * 60 * 1000;
  assert.equal((await fetch(`${baseUrl}/api/auth/activity`, { method: "POST", headers: {
    Cookie: adminCookie, "X-Requested-With": "admin-editor", "X-CSRF-Token": "wrong"
  } })).status, 403);
  testTime += 60 * 1000;
  assert.equal((await fetch(`${baseUrl}/admin.html`, { headers: { Cookie: adminCookie }, redirect: "manual" })).status, 303);
});

test("logging in rotates the session and prevents cross-session CSRF token reuse", async () => {
  const oldCookie = adminCookie;
  const signedIn = await login(undefined, { Cookie: oldCookie });
  const newCookie = signedIn.headers.get("set-cookie").split(";")[0];
  assert.notEqual(oldCookie, newCookie);
  assert.equal((await fetch(`${baseUrl}/api/admin/site-data`, { headers: { Cookie: oldCookie } })).status, 401);
  const response = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT", headers: { Cookie: newCookie, "X-CSRF-Token": csrfToken, "If-Match": revision, "Content-Type": "application/json" }, body: JSON.stringify(DATA)
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
    if (route === "/api/admin/site-data") {
      assert.equal(response.headers.get("etag"), revision);
      const recheck = await fetch(`${baseUrl}${route}`, { headers: { Cookie: adminCookie, "If-None-Match": revision } });
      assert.equal(recheck.status, 200);
    } else assert.equal(response.headers.get("etag"), null);
  }
});
