const { createServer } = require("../backend/server");

// No listening socket is opened. Use while the editor server is stopped.
createServer().createBackup().then((filename) => {
  console.log(`Content backup created: ${filename}`);
}).catch(() => {
  console.error("Could not create a backup. Check content validity, backup directory permissions, and disk space.");
  process.exitCode = 1;
});
