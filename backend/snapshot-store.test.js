const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createBackupStore } = require("./snapshot-store");

test("snapshots are private, directly restorable JSON and retention preserves unrelated files", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-snapshots-"));
  try {
    let time = Date.UTC(2026, 10, 11);
    const store = createBackupStore({ directory: path.join(temporary, "snapshots"), forbiddenDirectories: [], retention: 2, now: () => time++ });
    const first = await store.create({ profile: { name: "Before edit" } });
    assert.deepEqual(JSON.parse(await fs.readFile(first, "utf8")), { profile: { name: "Before edit" } });
    assert.equal((await fs.stat(first)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(store.directory)).mode & 0o777, 0o700);
    const unrelated = path.join(store.directory, "academic-site-backup-2026-11-11.json");
    await fs.writeFile(unrelated, "Manual backup");
    const second = await store.create({ version: 2 });
    const third = await store.create({ version: 3 });
    await assert.rejects(fs.access(first), { code: "ENOENT" });
    await fs.access(second);
    await fs.access(third);
    assert.equal(await fs.readFile(unrelated, "utf8"), "Manual backup");
    assert.equal((await fs.readdir(store.directory)).some((name) => name.endsWith(".tmp")), false);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("snapshots reject public directories, unsafe retention, and symlink aliases", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-snapshot-path-"));
  try {
    const frontend = path.join(temporary, "frontend");
    await fs.mkdir(frontend);
    assert.throws(() => createBackupStore({ directory: path.join(frontend, "snapshots"), forbiddenDirectories: [frontend] }), /outside/);
    for (const retention of [0, -1, 1.5, NaN, 1001]) assert.throws(() => createBackupStore({ directory: temporary, forbiddenDirectories: [], retention }), /retention/);
    const alias = path.join(temporary, "alias");
    await fs.symlink(frontend, alias);
    const store = createBackupStore({ directory: path.join(alias, "snapshots"), forbiddenDirectories: [frontend] });
    await assert.rejects(store.create({ version: 1 }), /inside/);
    assert.deepEqual(await fs.readdir(path.join(frontend, "snapshots")), []);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
