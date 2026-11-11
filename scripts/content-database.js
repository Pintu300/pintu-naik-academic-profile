const path = require("node:path");
const { createDatabasePool, checkDatabase } = require("../backend/database");
const { createContentStore } = require("../backend/content-store");
const { readSiteData, writeSiteData, validateSiteData } = require("../backend/server");
(async () => {
  const command = process.argv[2];
  if (!["import", "export"].includes(command)) throw new Error("Unsupported content command.");
  const pool = createDatabasePool();
  try {
    await checkDatabase(pool);
    const store = createContentStore(pool);
    const directory = path.join(__dirname, "../backend/data");
    const data = command === "import" ? await readSiteData(directory) : await store.load();
    if (validateSiteData(data)) throw new Error("Invalid content.");
    if (command === "import") {
      const imported = await store.import(data);
      console.log(imported ? "Website content imported into PostgreSQL." : "PostgreSQL already contains website content; nothing was overwritten.");
    } else {
      await writeSiteData(directory, data);
      console.log("Public website content exported to backend/data for review and GitHub Pages publishing. Review git diff before committing.");
    }
  } finally { await pool.end(); }
})().catch(() => {
  console.error("Content database operation failed. Check database connectivity, migrations, permissions, and content validity. No credentials were printed.");
  process.exitCode = 1;
});
