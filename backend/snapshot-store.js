const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const managedName = /^academic-site-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.json$/;
const isInside = (directory, parent) => {
  const relative = path.relative(parent, directory);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

const createBackupStore = ({ directory, forbiddenDirectories, retention = 30, now = Date.now }) => {
  if (!Number.isInteger(retention) || retention < 1 || retention > 1000) throw new Error("Backup retention must be an integer between 1 and 1000.");
  const target = path.resolve(directory);
  const forbidden = forbiddenDirectories.map((name) => path.resolve(name));
  if (forbidden.some((parent) => isInside(target, parent))) throw new Error("Backups must be stored outside frontend, public build, and content directories.");

  const prepare = async () => {
    await fs.mkdir(target, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("The backup directory must be a real directory, not a symlink.");
    const actual = await fs.realpath(target);
    for (const parent of forbidden) {
      const realParent = await fs.realpath(parent).catch((error) => {
        if (error.code === "ENOENT") return parent;
        throw error;
      });
      if (isInside(actual, realParent)) throw new Error("The backup destination resolves inside public or content files.");
    }
  };

  const create = async (data) => {
    await prepare();
    const id = randomUUID();
    const name = `academic-site-backup-${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${id}.json`;
    const temporary = path.join(target, `.snapshot-${id}.tmp`);
    const destination = path.join(target, name);
    let handle;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`);
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temporary, destination);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
    const files = (await fs.readdir(target, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && managedName.test(entry.name) && entry.name !== name)
      .map((entry) => entry.name).sort().reverse();
    for (const old of files.slice(retention - 1)) await fs.unlink(path.join(target, old));
    return destination;
  };
  return { create, directory: target };
};

module.exports = { createBackupStore };
