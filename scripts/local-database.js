const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { randomBytes, randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createDatabasePool, migrateDatabase, checkDatabase } = require("../backend/database");
const { privateDirectory, stateFile, roleNames, readLocalDatabaseState, localConnectionString } = require("../backend/local-database-config");
const exec = promisify(execFile);
const dataDirectory = path.join(privateDirectory, "postgresql-data");
const socketDirectory = path.join(privateDirectory, "postgresql-socket");
const logFile = path.join(privateDirectory, "postgresql.log");
const lockFile = path.join(privateDirectory, ".postgresql-command.lock");
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

const freePort = (requested = 0) => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once("error", reject);
  socket.listen(requested, "127.0.0.1", () => {
    const port = socket.address().port;
    socket.close(() => resolve(port));
  });
});
const running = async (state) => {
  try { await exec(path.join(state.binaryDirectory, "pg_ctl"), ["-D", dataDirectory, "status"]); return true; }
  catch (error) { if (error.code === 3 || error.code === 4) return false; throw new Error("Could not check local PostgreSQL status."); }
};
const start = async (state) => {
  if (await running(state)) return;
  if (await freePort(state.port) !== state.port) throw new Error("Configured PostgreSQL port is unavailable.");
  await fs.mkdir(socketDirectory, { recursive: true, mode: 0o700 });
  const log = await fs.open(logFile, "a", 0o600);
  await log.close();
  await exec(path.join(state.binaryDirectory, "pg_ctl"), ["-D", dataDirectory, "-l", logFile, "-o", `-h 127.0.0.1 -p ${state.port} -k ${quote(socketDirectory)} -c shared_buffers=32MB -c max_connections=30`, "-w", "start"]);
};

const prepareRoles = async (state) => {
  const pool = createDatabasePool({ connectionString: localConnectionString(state, "bootstrap", "postgres") });
  try {
    for (const key of ["owner", "application"]) {
      const name = roleNames[key];
      const result = await pool.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=$1", [name]);
      if (result.rows.length) {
        if (Object.values(result.rows[0]).some(Boolean)) throw new Error("Existing local database role has unexpected privileges; no role was changed.");
      } else {
        // Passwords are generated/validated hex, and identifiers are fixed constants.
        await pool.query(`CREATE ROLE "${name}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${state.passwords[key]}'`);
      }
    }
    const database = await pool.query("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1", ["academic_portfolio"]);
    if (!database.rows.length) await pool.query('CREATE DATABASE academic_portfolio OWNER "portfolio_owner"');
    else if (database.rows[0].owner !== roleNames.owner) throw new Error("Existing local database has another owner; no data was overwritten.");
  } finally { await pool.end(); }
};

(async () => {
  const command = process.argv[2];
  if (!["setup", "start", "stop", "status"].includes(command)) throw new Error("Use local-database.js setup, start, stop, or status.");
  await fs.mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(privateDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error("The local database directory must be private (0700) and not a symlink.");
  if (command === "status") {
    const state = readLocalDatabaseState();
    if (!state) { console.log("Local PostgreSQL is not set up. Run npm run db:setup."); return; }
    console.log(`Local PostgreSQL: ${await running(state) ? "running" : "stopped"}; 127.0.0.1:${state.port}; database academic_portfolio; application role portfolio_app.`);
    return;
  }
  const lock = await fs.open(lockFile, "wx", 0o600);
  await lock.writeFile(String(process.pid));
  await lock.close();
  try {
    let state = readLocalDatabaseState();
    if (!state && command !== "setup") throw new Error("Run npm run db:setup first.");
    if (!state) {
      if (await fs.access(dataDirectory).then(() => true, () => false)) throw new Error("Existing PostgreSQL data has no settings; refusing to overwrite it.");
      const binaryDirectory = process.env.PG_BIN || (await exec("pg_config", ["--bindir"])).stdout.trim();
      const requested = process.env.LOCAL_POSTGRES_PORT ? Number(process.env.LOCAL_POSTGRES_PORT) : null;
      if (requested !== null && (!Number.isInteger(requested) || requested < 1024 || requested > 65535)) throw new Error("LOCAL_POSTGRES_PORT must be between 1024 and 65535.");
      const port = requested !== null ? await freePort(requested) : await freePort(15432).catch(() => freePort());
      state = { version: 1, port, binaryDirectory, passwords: Object.fromEntries(["bootstrap", "owner", "application"].map((key) => [key, randomBytes(32).toString("hex")])) };
      await fs.writeFile(stateFile, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    }
    if (command === "stop") {
      if (await running(state)) await exec(path.join(state.binaryDirectory, "pg_ctl"), ["-D", dataDirectory, "-m", "fast", "-w", "stop"]);
      console.log("Project-local PostgreSQL stopped. Its private data was kept.");
      return;
    }
    if (command === "setup" && !(await fs.access(path.join(dataDirectory, "PG_VERSION")).then(() => true, () => false))) {
      const passwordFile = path.join(privateDirectory, `.bootstrap-${randomUUID()}`);
      await fs.writeFile(passwordFile, state.passwords.bootstrap, { mode: 0o600, flag: "wx" });
      try {
        await exec(path.join(state.binaryDirectory, "initdb"), ["-D", dataDirectory, `--username=${roleNames.bootstrap}`, "--auth-local=scram-sha-256", "--auth-host=scram-sha-256", `--pwfile=${passwordFile}`, "--no-locale", "--encoding=UTF8"]);
      } finally { await fs.unlink(passwordFile); }
    }
    await start(state);
    if (command === "setup") {
      await prepareRoles(state);
      const owner = createDatabasePool({ connectionString: localConnectionString(state, "owner") });
      try {
        await migrateDatabase(owner);
        await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON DATABASE academic_portfolio FROM PUBLIC; GRANT CONNECT ON DATABASE academic_portfolio TO "portfolio_app"');
        await owner.query('GRANT USAGE ON SCHEMA portfolio TO "portfolio_app"; GRANT SELECT ON portfolio.schema_migrations TO "portfolio_app"');
        await owner.query('GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio.users, portfolio.comments, portfolio.contact_messages, portfolio.site_content, portfolio.admin_account TO "portfolio_app"; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA portfolio TO "portfolio_app"');
        await owner.query('ALTER DEFAULT PRIVILEGES FOR ROLE "portfolio_owner" IN SCHEMA portfolio GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "portfolio_app"; ALTER DEFAULT PRIVILEGES FOR ROLE "portfolio_owner" IN SCHEMA portfolio GRANT USAGE, SELECT ON SEQUENCES TO "portfolio_app"');
      } finally { await owner.end(); }
    }
    const app = createDatabasePool({ connectionString: localConnectionString(state) });
    try { await checkDatabase(app); }
    finally { await app.end(); }
    console.log(`Project-local PostgreSQL ready on 127.0.0.1:${state.port}. Credentials are stored privately; no password was printed.`);
  } finally { await fs.unlink(lockFile); }
})().catch(() => {
  console.error("Local PostgreSQL command failed. Existing data was preserved. Check installed PostgreSQL tools, port availability, and private log/settings. An active or stale command lock may require owner review.");
  process.exitCode = 1;
});
