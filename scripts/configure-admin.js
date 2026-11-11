const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const { createDatabasePool, checkDatabase } = require("../backend/database");
const { createAdminAccount, validEmail } = require("../backend/admin-account");
const { recoverySettingsFile } = require("../backend/recovery-mail");
class AdminSetupError extends Error {}

(async () => {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const terminal = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  const ask = async (label, hidden = false) => {
    // Let readline render the label before suppressing secret input echoes.
    // Writing outside readline loses the label when a TTY redraws its line.
    muted = false;
    const answer = terminal.question(label);
    muted = hidden;
    try { return await answer; }
    finally { muted = false; if (hidden) process.stdout.write("\n"); }
  };
  let pool;
  try {
    const passwordOnly = process.argv.includes("--password-only");
    console.log(passwordOnly ? "Reset local website admin credentials. No Gmail setup is needed. Existing sessions and recovery codes will end."
      : "Configure this website's private admin credentials and Gmail recovery. Existing admin sessions will end. No email is sent by this command.");
    const username = process.env.ADMIN_USER || (await ask("Admin username [admin]: ")).trim() || "admin";
    const password = (!passwordOnly && process.env.ADMIN_PASSWORD) || await ask("New website admin password (at least 12 characters; hidden): ", true);
    const confirmation = (!passwordOnly && process.env.ADMIN_PASSWORD) || await ask("Confirm website admin password (hidden): ", true);
    if (password.length < 12 || password.length > 1024) throw new AdminSetupError("Your website admin password must contain 12–1024 characters. Run this command again and choose a longer password.");
    if (password !== confirmation) throw new AdminSetupError("The two website admin passwords do not match. Run this command again and enter exactly the same password twice.");
    pool = createDatabasePool();
    await checkDatabase(pool);
    if (passwordOnly) {
      const account = createAdminAccount(pool);
      const current = await account.read();
      await account.provision({ username, password, email: current?.recovery_email || "", replace: true });
      console.log("Admin credentials updated. Existing recovery email and mail settings were kept. Start or restart the website server and sign in with the new credentials.");
      return;
    }
    const email = (process.env.ADMIN_RECOVERY_EMAIL || await ask("Recovery email address: ")).trim().toLowerCase();
    const user = (process.env.SMTP_USER || (await ask(`Gmail sending address [${email}]: `)).trim() || email).toLowerCase();
    const mailPassword = (process.env.SMTP_PASSWORD || await ask("Gmail app password (NOT your normal Google password; hidden): ", true)).replace(/\s/g, "");
    if (!validEmail(email) || !validEmail(user) || !/^[a-zA-Z0-9]{16}$/.test(mailPassword)) throw new Error();
    const directory = path.dirname(recoverySettingsFile);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error();
    // Provision validates the email/credentials before changing database state.
    await createAdminAccount(pool).provision({ username, password, email, replace: true });
    const temporary = path.join(directory, `.admin-recovery-${randomUUID()}`);
    try {
      await fs.writeFile(temporary, JSON.stringify({ user, password: mailPassword, secret: randomBytes(32).toString("hex") }), { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, recoverySettingsFile);
    } finally { await fs.unlink(temporary).catch(() => {}); }
    console.log("Private admin and recovery settings saved. Restart npm start. Email delivery will be tested when you request a recovery code.");
  } finally { terminal.close(); if (pool) await pool.end(); }
})().catch((error) => {
  console.error(error instanceof AdminSetupError ? `Admin configuration did not complete: ${error.message}`
    : "Admin configuration did not complete. Check migrations, private directory permissions, email addresses, and your 16-character Gmail app password. No secrets were printed. You can rerun this command to complete setup.");
  process.exitCode = 1;
});
