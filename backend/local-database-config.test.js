const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { readLocalDatabaseState, databaseConnectionString } = require("./local-database-config");

const fixture = (run) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-settings-test-"));
  const filename = path.join(directory, "settings.json");
  const state = { version: 1, port: 15432, binaryDirectory: "/usr/lib/postgresql/16/bin",
    passwords: Object.fromEntries(["bootstrap", "owner", "application"].map((role) => [role, randomBytes(32).toString("hex")])) };
  try { run({ directory, filename, state }); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
};

test("local database settings require private regular files and valid generated credentials", () => fixture(({ directory, filename, state }) => {
  assert.equal(readLocalDatabaseState(filename), null);
  fs.writeFileSync(filename, JSON.stringify(state), { mode: 0o600 });
  assert.deepEqual(readLocalDatabaseState(filename), state);
  fs.chmodSync(filename, 0o644);
  assert.throws(() => readLocalDatabaseState(filename), /owner-only/);
  fs.chmodSync(filename, 0o600);
  const link = path.join(directory, "link.json");
  fs.symlinkSync(filename, link);
  assert.throws(() => readLocalDatabaseState(link), /regular/);
  fs.writeFileSync(filename, JSON.stringify({ ...state, port: 1 }));
  assert.throws(() => readLocalDatabaseState(filename), /incomplete/);
  fs.writeFileSync(filename, "invalid-json");
  assert.throws(() => readLocalDatabaseState(filename), /invalid/);
}));

test("database commands select application and migration roles with explicit environment precedence", () => fixture(({ filename, state }) => {
  fs.writeFileSync(filename, JSON.stringify(state), { mode: 0o600 });
  const application = new URL(databaseConnectionString({ env: {}, filename }));
  const owner = new URL(databaseConnectionString({ migration: true, env: {}, filename }));
  assert.equal(application.username, "portfolio_app");
  assert.equal(owner.username, "portfolio_owner");
  assert.equal(application.password === state.passwords.application, true);
  assert.equal(owner.password === state.passwords.owner, true);
  assert.equal(application.hostname, "127.0.0.1");
  assert.equal(application.searchParams.get("sslmode"), "disable");
  const env = { DATABASE_URL: "application-override", DATABASE_MIGRATION_URL: "migration-override" };
  assert.equal(databaseConnectionString({ env, filename }), env.DATABASE_URL);
  assert.equal(databaseConnectionString({ migration: true, env, filename }), env.DATABASE_MIGRATION_URL);
  assert.equal(databaseConnectionString({ migration: true, env: { DATABASE_URL: env.DATABASE_URL }, filename }), env.DATABASE_URL);
}));
