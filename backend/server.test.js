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

const adminAuthorization = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "academic-profile-server-"));
  const dataDir = path.join(temporaryDirectory, "data");
  const frontendDir = path.join(temporaryDirectory, "frontend");
  await fs.mkdir(dataDir);
  await fs.mkdir(frontendDir);
  await fs.writeFile(path.join(frontendDir, "index.html"), "<h1>Test site</h1>");

  await Promise.all(
    Object.entries(DATA).map(([name, value]) =>
      fs.writeFile(path.join(dataDir, `${name}.json`), `${JSON.stringify(value)}\n`)
    )
  );

  server = createServer({
    adminPassword: "test-password",
    dataDir,
    frontendDir,
    maxBodyBytes: 1_000
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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
  assert.match(unauthorized.headers.get("www-authenticate"), /^Basic/);

  const malformed = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Authorization: adminAuthorization,
      "Content-Type": "application/json"
    },
    body: "{invalid"
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Request body must contain valid JSON." });

  const oversized = await fetch(`${baseUrl}/api/admin/site-data`, {
    method: "PUT",
    headers: {
      Authorization: adminAuthorization,
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
      Authorization: adminAuthorization,
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
      Authorization: adminAuthorization,
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
      Authorization: adminAuthorization,
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
