const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const { databaseConfiguration, createDatabasePool, migrateDatabase, checkDatabase, backupDatabase } = require("./database");
const { createContentStore } = require("./content-store");
const { createServer, readSiteData } = require("./server");
const { createHash } = require("node:crypto");
const revision = (data) => `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;
const exec = promisify(execFile);
const connection = (host = "127.0.0.1", query = "") => `postgresql://test_user@${host}/portfolio${query}`;

test("PostgreSQL configuration requires private settings and verified TLS for remote hosts", () => {
  assert.throws(() => databaseConfiguration({ connectionString: "" }), /DATABASE_URL/);
  assert.throws(() => databaseConfiguration({ connectionString: "not a database URL" }), /valid PostgreSQL/);
  assert.throws(() => databaseConfiguration({ connectionString: "https://example.com/data" }), /PostgreSQL URL/);
  assert.equal(databaseConfiguration({ connectionString: connection() }).ssl, false);
  const remote = databaseConfiguration({ connectionString: connection("db.example.invalid", "?sslmode=require") });
  assert.equal(remote.ssl.rejectUnauthorized, true);
  assert.throws(() => databaseConfiguration({ connectionString: connection("db.example.invalid", "?sslmode=disable") }), /verified TLS/);
  assert.throws(() => databaseConfiguration({ connectionString: connection("db.example.invalid", "?sslmode=no-verify") }), /verified TLS/);
  assert.throws(() => databaseConfiguration({ connectionString: connection("db.example.invalid", "?sslmode=require&sslmode=disable") }), /Only the sslmode/);
  assert.throws(() => databaseConfiguration({ connectionString: connection("db.example.invalid", "?sslrootcert=untrusted") }), /Only the sslmode/);
});

test("PostgreSQL URL parsing handles encoded fields without exposing them in errors", () => {
  const value = randomBytes(12).toString("hex") + "@/?";
  const url = new URL(connection());
  url.password = value;
  const configuration = databaseConfiguration({ connectionString: url.href });
  assert.equal(configuration.password, value);
  url.searchParams.set("unexpected", "value");
  assert.throws(() => databaseConfiguration({ connectionString: url.href }), (error) => !error.message.includes(value) && !error.message.includes(url.href));
});

const integrationTest = (name, run) => test(name, { skip: process.env.TEST_DATABASE_URL ? false : "Use npm run test:db for isolated PostgreSQL integration tests." }, async () => {
  const base = process.env.TEST_DATABASE_URL;
  const settings = databaseConfiguration({ connectionString: base });
  if (!["127.0.0.1", "localhost", "::1"].includes(settings.host)) throw new Error("Database integration tests only run against a loopback server.");
  const administrator = createDatabasePool({ connectionString: base });
  const name = `academic_${randomBytes(8).toString("hex")}_test`;
  const pools = [];
  let created = false;
  try {
    await administrator.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(base);
    url.pathname = `/${name}`;
    const pool = createDatabasePool({ connectionString: url.href });
    pools.push(pool);
    await run({ pool, connectionString: url.href, createPool: () => {
      const extra = createDatabasePool({ connectionString: url.href });
      pools.push(extra);
      return extra;
    } });
  } finally {
    for (const pool of pools) await pool.end();
    if (created) await administrator.query(`DROP DATABASE "${name}"`);
    await administrator.end();
  }
});
const addUser = async (pool) => (await pool.query("INSERT INTO portfolio.users(email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id", ["visitor@example.invalid", "Test Visitor", "Test fixture, not an authenticating hash"])).rows[0].id;

integrationTest("PostgreSQL content preserves imports, serializes concurrent edits, and rolls back failed backups", async ({ pool, createPool }) => {
  await migrateDatabase(pool);
  const store = createContentStore(pool);
  await assert.rejects(store.load(), /not initialized/);
  const data = { profile: { name: "Researcher" }, publications: [] };
  assert.equal(await store.import(data), true);
  assert.equal(await store.import({ profile: { name: "Overwrite" } }), false);
  assert.deepEqual(await store.load(), data);
  const current = await store.load();
  const updated = { ...current, projects: [{ title: "New project" }] };
  await assert.rejects(store.save(updated, revision(current), async () => { throw new Error("Backup failed"); }), /Backup failed/);
  assert.deepEqual(await store.load(), current);
  const other = createContentStore(createPool());
  const saves = await Promise.allSettled([store.save(updated, revision(current), async () => {}), other.save(updated, revision(current), async () => {})]);
  assert.equal(saves.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(saves.find((item) => item.status === "rejected").reason.statusCode, 412);
  assert.deepEqual(await other.load(), updated);
});

integrationTest("PostgreSQL powers public API, authenticated editor saves, and content backups", async ({ pool }) => {
  await migrateDatabase(pool);
  const store = createContentStore(pool);
  const data = await readSiteData(path.join(__dirname, "data"));
  await store.import(data);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-db-http-"));
  const server = createServer({ contentStore: store, adminPassword: "test-password", backupDirectory: directory });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await (await fetch(`${base}/api/publications`)).json(), data.publications);
    assert.deepEqual(await (await fetch(`${base}/data/profile.json`)).json(), data.profile);
    assert.equal((await fetch(`${base}/api/admin/site-data`)).status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "admin-editor" }, body: JSON.stringify({ username: "admin", password: "test-password" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const editor = await fetch(`${base}/api/admin/site-data`, { headers: { Cookie: cookie } });
    assert.equal(editor.status, 200);
    const document = await editor.json();
    document.profile.summary = "Saved through PostgreSQL integration test.";
    const headers = { Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": editor.headers.get("x-csrf-token"), "If-Match": editor.headers.get("etag") };
    const save = await fetch(`${base}/api/admin/site-data`, { method: "PUT", headers, body: JSON.stringify(document) });
    assert.equal(save.status, 200);
    assert.equal((await store.load()).profile.summary, document.profile.summary);
    assert.equal((await fetch(`${base}/api/admin/site-data`, { method: "PUT", headers, body: JSON.stringify(document) })).status, 412);
    await server.createBackup();
    const snapshots = await fs.readdir(directory);
    assert.ok(snapshots.length >= 2);
    const savedSnapshots = await Promise.all(snapshots.map(async (name) => JSON.parse(await fs.readFile(path.join(directory, name), "utf8"))));
    assert.ok(savedSnapshots.some((snapshot) => snapshot.profile.summary === document.profile.summary));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

integrationTest("PostgreSQL migrations are atomic, idempotent, and safe under concurrent setup", async ({ pool, createPool }) => {
  await Promise.all([migrateDatabase(pool), migrateDatabase(createPool())]);
  await checkDatabase(pool);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM portfolio.users")).rows[0].count, 0);
  await addUser(pool);
  await migrateDatabase(pool);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM portfolio.users")).rows[0].count, 1);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM portfolio.schema_migrations")).rows[0].count, 2);
});

integrationTest("PostgreSQL constraints enforce ownership, uniqueness, moderation, and bound content", async ({ pool }) => {
  await migrateDatabase(pool);
  const id = await addUser(pool);
  await assert.rejects(pool.query("INSERT INTO portfolio.users(email, display_name, password_hash) VALUES ($1, $2, $3)", ["VISITOR@example.invalid", "Duplicate", "Test fixture"]), (error) => error.code === "23505");
  await assert.rejects(pool.query("INSERT INTO portfolio.comments(user_id, resource_slug, body) VALUES ($1, $2, $3)", ["999999", "paper", "Test"]), (error) => error.code === "23503");
  const body = "'); DROP TABLE portfolio.users; --";
  await pool.query("INSERT INTO portfolio.comments(user_id, resource_slug, body) VALUES ($1, $2, $3)", [id, "paper", body]);
  const comment = (await pool.query("SELECT body, status FROM portfolio.comments")).rows[0];
  assert.equal(comment.body, body);
  assert.equal(comment.status, "pending");
  await assert.rejects(pool.query("UPDATE portfolio.comments SET status=$1", ["unknown"]), (error) => error.code === "23514");
  await assert.rejects(pool.query("INSERT INTO portfolio.comments(user_id, resource_slug, body) VALUES ($1, $2, $3)", [id, "paper", "x".repeat(5001)]), (error) => error.code === "23514");
  await pool.query("INSERT INTO portfolio.contact_messages(name,email,subject,body) VALUES ($1,$2,$3,$4)", ["Visitor", "visitor@example.invalid", "Research", "Test message"]);
  assert.equal((await pool.query("SELECT status FROM portfolio.contact_messages")).rows[0].status, "new");
  await pool.query("DELETE FROM portfolio.users WHERE id=$1", [id]);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM portfolio.comments")).rows[0].count, 0);
});

integrationTest("PostgreSQL migration tampering and unrelated portfolio tables are refused", async ({ pool }) => {
  await pool.query("CREATE SCHEMA portfolio; CREATE TABLE portfolio.keep_me(value text)");
  await assert.rejects(migrateDatabase(pool), /refusing to adopt/);
  assert.ok((await pool.query("SELECT to_regclass('portfolio.keep_me') AS name")).rows[0].name);
  await pool.query("DROP TABLE portfolio.keep_me");
  await migrateDatabase(pool);
  await pool.query("UPDATE portfolio.schema_migrations SET checksum=$1", ["changed"]);
  await assert.rejects(migrateDatabase(pool), /history changed/);
  assert.equal((await pool.query("SELECT checksum FROM portfolio.schema_migrations")).rows[0].checksum, "changed");
});

integrationTest("PostgreSQL CLI checks and private backups round-trip without overwriting files", async ({ pool, connectionString }) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-pg-backup-"));
  try {
    await migrateDatabase(pool);
    await addUser(pool);
    const env = { ...process.env, DATABASE_URL: connectionString, DATABASE_MIGRATION_URL: connectionString };
    await exec(process.execPath, ["scripts/database-cli.js", "check"], { env });
    const filename = path.join(temporary, "copy.pgdump");
    await backupDatabase({ connectionString, filename });
    assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
    await assert.rejects(backupDatabase({ connectionString, filename }), (error) => error.code === "EEXIST");
    const configuration = databaseConfiguration({ connectionString });
    await pool.query("DROP SCHEMA portfolio CASCADE");
    await exec(process.env.PG_RESTORE || "pg_restore", ["--no-owner", "--no-privileges", "--no-password", "--dbname", configuration.database, filename], {
      env: { ...process.env, PGHOST: configuration.host, PGPORT: String(configuration.port), PGUSER: configuration.user, PGPASSWORD: configuration.password, PGSSLMODE: "disable" }
    });
    await checkDatabase(pool);
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM portfolio.users")).rows[0].count, 1);
    await assert.rejects(backupDatabase({ connectionString, filename: path.join(__dirname, "../frontend/assets/private.pgdump") }), /outside/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
