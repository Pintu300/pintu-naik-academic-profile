const { createServer } = require("../backend/server");
const { createDatabasePool } = require("../backend/database");
const { createContentStore } = require("../backend/content-store");

// No listening socket is opened. Use while the editor server is stopped.
const pool = createDatabasePool();
createServer({ contentStore: createContentStore(pool) }).createBackup().then((filename) => {
  console.log(`Content backup created: ${filename}`);
}).catch(() => {
  console.error("Could not create a backup. Check content validity, backup directory permissions, and disk space.");
  process.exitCode = 1;
}).finally(() => pool.end());
