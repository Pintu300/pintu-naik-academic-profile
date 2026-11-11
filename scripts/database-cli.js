const { createDatabasePool, migrateDatabase, checkDatabase, backupDatabase, DatabaseConfigurationError, DatabaseMigrationError } = require("../backend/database");
const { databaseConnectionString } = require("../backend/local-database-config");
(async () => {
  const command = process.argv[2];
  if (!["init", "check", "backup"].includes(command)) throw new DatabaseConfigurationError("Use database-cli.js init, check, or backup.");
  const connectionString = databaseConnectionString({ migration: command === "init" });
  const pool = createDatabasePool({ connectionString });
  try {
    if (command === "init") {
      await migrateDatabase(pool);
      console.log("PostgreSQL foundation ready: users, comments, contact_messages. No default accounts or public features were enabled.");
    } else {
      await checkDatabase(pool);
      if (command === "backup") console.log(`Private PostgreSQL backup created: ${await backupDatabase({ connectionString })}`);
      else console.log("PostgreSQL connection, migration history, and expected tables verified.");
    }
  } finally { await pool.end(); }
})().catch((error) => {
  // Never print connection URLs, database rows, or driver error details.
  console.error(error instanceof DatabaseConfigurationError || error instanceof DatabaseMigrationError
    ? error.message : "PostgreSQL operation failed. Check private connection settings, permissions, and installed client tools.");
  process.exitCode = 1;
});
