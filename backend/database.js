const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");
const migrations = require("./database-schema");
const { databaseConnectionString } = require("./local-database-config");
class DatabaseConfigurationError extends Error {}
class DatabaseMigrationError extends Error {}
const root = path.resolve(__dirname, "..");
const loopback = new Set(["localhost", "127.0.0.1", "::1"]);

const databaseConfiguration = ({ connectionString = databaseConnectionString(), caFile = process.env.DATABASE_CA_FILE } = {}) => {
  if (!connectionString) throw new DatabaseConfigurationError("Set DATABASE_URL privately before using database commands.");
  let url;
  try { url = new URL(connectionString); }
  catch { throw new DatabaseConfigurationError("DATABASE_URL must be a valid PostgreSQL connection URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1) || url.hash) throw new DatabaseConfigurationError("Use a PostgreSQL URL with a host, username, and database name.");
  if ([...url.searchParams.keys()].some((key) => key !== "sslmode") || url.searchParams.getAll("sslmode").length > 1) throw new DatabaseConfigurationError("Only the sslmode URL option is supported. Configure a trusted CA with DATABASE_CA_FILE.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const local = loopback.has(host.toLowerCase());
  const mode = url.searchParams.get("sslmode") || (local ? "disable" : "verify-full");
  if (!["disable", "require", "verify-ca", "verify-full"].includes(mode) || (mode === "disable" && !local)) throw new DatabaseConfigurationError("Remote PostgreSQL connections require verified TLS. sslmode=disable is limited to loopback development.");
  let user, password, database;
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); database = decodeURIComponent(url.pathname.slice(1)); }
  catch { throw new DatabaseConfigurationError("The PostgreSQL URL contains invalid encoding."); }
  if ([user, password, database].some((value) => /[\u0000-\u001f\u007f]/.test(value))) throw new DatabaseConfigurationError("Database connection fields contain unsupported control characters.");
  const ssl = mode === "disable" ? false : { rejectUnauthorized: true };
  if (caFile && ssl) {
    try { ssl.ca = fs.readFileSync(caFile, "utf8"); }
    catch { throw new DatabaseConfigurationError("Could not read DATABASE_CA_FILE. Check its private path and permissions."); }
  }
  return { host, port: Number(url.port || 5432), user, password, database, ssl };
};

const createDatabasePool = (options = {}) => {
  const pool = new Pool({ ...databaseConfiguration(options), max: 5, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, query_timeout: 10000, statement_timeout: 10000,
    idle_in_transaction_session_timeout: 10000, application_name: "academic-portfolio",
    options: "-c search_path=pg_catalog,portfolio" });
  pool.on("error", () => console.error("PostgreSQL idle connection failed. Check private database connectivity."));
  return pool;
};

const validateHistory = (rows, complete = false) => {
  if (rows.length > migrations.length) throw new DatabaseMigrationError("The PostgreSQL schema is newer than this application.");
  for (let index = 0; index < rows.length; index++) {
    const migration = migrations[index];
    const checksum = createHash("sha256").update(migration.sql).digest("hex");
    if (rows[index].version !== index + 1 || migration.version !== index + 1 || rows[index].checksum !== checksum) throw new DatabaseMigrationError("Applied migration history changed. Restore the original migration before proceeding.");
  }
  if (complete && rows.length !== migrations.length) throw new DatabaseMigrationError("Database migrations are incomplete. Run npm run db:init.");
};

const migrateDatabase = async (pool) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [0x50575431]);
    const existing = await client.query("SELECT to_regclass('portfolio.schema_migrations') AS ledger");
    if (!existing.rows[0].ledger) {
      const tables = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1", ["portfolio"]);
      if (tables.rows.length) throw new DatabaseMigrationError("Existing portfolio tables have no migration history; refusing to adopt them.");
    }
    await client.query("CREATE SCHEMA IF NOT EXISTS portfolio; REVOKE ALL ON SCHEMA portfolio FROM PUBLIC");
    await client.query(`CREATE TABLE IF NOT EXISTS portfolio.schema_migrations (
      version integer PRIMARY KEY, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const { rows } = await client.query("SELECT version, checksum FROM portfolio.schema_migrations ORDER BY version");
    validateHistory(rows);
    for (let index = rows.length; index < migrations.length; index++) {
      const migration = migrations[index];
      if (migration.version !== index + 1) throw new DatabaseMigrationError("Migrations must have consecutive versions.");
      await client.query(migration.sql);
      await client.query("INSERT INTO portfolio.schema_migrations(version, checksum) VALUES ($1, $2)", [migration.version, createHash("sha256").update(migration.sql).digest("hex")]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
};

const checkDatabase = async (pool) => {
  const { rows } = await pool.query("SELECT version, checksum FROM portfolio.schema_migrations ORDER BY version");
  validateHistory(rows, true);
  const tables = await pool.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = $1", ["portfolio"]);
  const names = tables.rows.map((row) => row.tablename);
  for (const name of ["users", "comments", "contact_messages", "schema_migrations", "site_content", "admin_account"]) {
    if (!names.includes(name)) throw new DatabaseMigrationError("Expected PostgreSQL tables are missing.");
  }
};

const inside = (filename, directory) => {
  const relative = path.relative(directory, filename);
  return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const backupDatabase = async ({ filename = path.join(process.env.BACKUP_DIR || path.join(__dirname, "backups"), `database-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.pgdump`), ...options } = {}) => {
  const configuration = databaseConfiguration(options);
  const target = path.resolve(filename);
  if (!target.endsWith(".pgdump")) throw new DatabaseConfigurationError("Use a .pgdump file for private PostgreSQL backups.");
  const forbidden = [path.join(root, "frontend"), path.join(root, "dist"), path.join(__dirname, "data")];
  if (forbidden.some((directory) => inside(target, directory))) throw new DatabaseConfigurationError("Database backups must stay outside public and JSON content directories.");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const actual = path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
  if (forbidden.some((directory) => inside(actual, fs.existsSync(directory) ? fs.realpathSync(directory) : directory))) throw new DatabaseConfigurationError("Backup destination resolves inside public or JSON content files.");
  const descriptor = fs.openSync(target, "wx", 0o600);
  const env = { ...process.env, PGHOST: configuration.host, PGPORT: String(configuration.port), PGUSER: configuration.user, PGPASSWORD: configuration.password,
    PGDATABASE: configuration.database, PGSSLMODE: configuration.ssl ? "verify-full" : "disable", PGCONNECT_TIMEOUT: "5" };
  if (configuration.ssl && (options.caFile || process.env.DATABASE_CA_FILE)) env.PGSSLROOTCERT = options.caFile || process.env.DATABASE_CA_FILE;
  else delete env.PGSSLROOTCERT;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.PG_DUMP || "pg_dump", ["--format=custom", "--schema=portfolio", "--no-owner", "--no-privileges", "--no-password", "--lock-wait-timeout=5000"], { env, stdio: ["ignore", descriptor, "pipe"] });
      child.stderr.resume();
      let timedOut = false;
      let forceTimer;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        forceTimer.unref();
      }, 120000);
      child.on("error", () => { clearTimeout(timer); clearTimeout(forceTimer); reject(new Error("Could not start pg_dump. Install the PostgreSQL client tools.")); });
      child.on("close", (code) => {
        clearTimeout(timer); clearTimeout(forceTimer);
        if (timedOut) reject(new Error("PostgreSQL backup timed out."));
        else code === 0 ? resolve() : reject(new Error("PostgreSQL backup failed. Check client version, connection settings, and disk space."));
      });
    });
    fs.fsyncSync(descriptor);
    return target;
  } catch (error) {
    try { fs.unlinkSync(target); } catch {}
    throw error;
  } finally { fs.closeSync(descriptor); }
};

module.exports = { databaseConfiguration, createDatabasePool, migrateDatabase, checkDatabase, backupDatabase, DatabaseConfigurationError, DatabaseMigrationError };
