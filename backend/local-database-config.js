const fs = require("node:fs");
const path = require("node:path");

const privateDirectory = path.join(__dirname, "private");
const stateFile = path.join(privateDirectory, "local-postgresql.json");
const roleNames = { bootstrap: "portfolio_setup", owner: "portfolio_owner", application: "portfolio_app" };

const readLocalDatabaseState = (filename = stateFile) => {
  let info;
  try { info = fs.lstatSync(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw new Error("Could not read private local PostgreSQL settings."); }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error("Local PostgreSQL settings must be a regular, owner-only file (0600).");
  let state;
  try { state = JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch { throw new Error("Local PostgreSQL settings are invalid. Credential contents were not printed."); }
  if (state.version !== 1 || !Number.isInteger(state.port) || state.port < 1024 || state.port > 65535
    || typeof state.binaryDirectory !== "string" || !path.isAbsolute(state.binaryDirectory)
    || !["bootstrap", "owner", "application"].every((key) => /^[a-f0-9]{64}$/.test(state.passwords?.[key] || ""))) {
    throw new Error("Local PostgreSQL settings are incomplete or unsupported.");
  }
  return state;
};

const localConnectionString = (state, role = "application", database = "academic_portfolio") => {
  if (!Object.hasOwn(roleNames, role)) throw new Error("Unsupported local database role.");
  const url = new URL(`postgresql://${roleNames[role]}@127.0.0.1:${state.port}/${database}?sslmode=disable`);
  url.password = state.passwords[role];
  return url.href;
};

const databaseConnectionString = ({ migration = false, env = process.env, filename = stateFile } = {}) => {
  if (migration && env.DATABASE_MIGRATION_URL) return env.DATABASE_MIGRATION_URL;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const state = readLocalDatabaseState(filename);
  return state ? localConnectionString(state, migration ? "owner" : "application") : undefined;
};

module.exports = { privateDirectory, stateFile, roleNames, readLocalDatabaseState, localConnectionString, databaseConnectionString };
