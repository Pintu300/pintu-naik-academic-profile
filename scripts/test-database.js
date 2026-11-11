// Creates and removes an isolated local PostgreSQL cluster when no test URL is set.
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);

const tests = (env) => new Promise((resolve, reject) => {
  const files = process.argv.includes("--all")
    ? ["backend", "frontend", "scripts"].flatMap((directory) => fsSync.readdirSync(directory).filter((name) => name.endsWith(".test.js")).map((name) => path.join(directory, name)))
    : ["backend/database.test.js"];
  const child = spawn(process.execPath, ["--test", ...files], { env, stdio: "inherit" });
  child.on("error", () => reject(new Error("Could not start database tests.")));
  child.on("exit", (code) => resolve(Number.isInteger(code) ? code : 1));
});
(async () => {
  if (process.env.TEST_DATABASE_URL) { process.exitCode = await tests(process.env); return; }
  const binaries = process.env.PG_BIN || (await exec("pg_config", ["--bindir"])).stdout.trim();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-postgres-"));
  await fs.chmod(temporary, 0o700);
  const data = path.join(temporary, "data");
  const sockets = path.join(temporary, "socket");
  const passwordFile = path.join(temporary, "password");
  const password = randomBytes(32).toString("hex");
  const pgctl = path.join(binaries, "pg_ctl");
  try {
    await fs.mkdir(sockets, { mode: 0o700 });
    await fs.writeFile(passwordFile, password, { mode: 0o600 });
    await exec(path.join(binaries, "initdb"), ["-D", data, "--username=portfolio_test", "--auth-local=trust", "--auth-host=scram-sha-256", `--pwfile=${passwordFile}`, "--no-locale", "--encoding=UTF8"]);
    const reservation = net.createServer();
    await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    await exec(pgctl, ["-D", data, "-l", path.join(temporary, "server.log"), "-o", `-h 127.0.0.1 -p ${port} -k ${sockets} -c shared_buffers=16MB -c max_connections=20`, "-w", "start"]);
    const url = new URL(`postgresql://portfolio_test@127.0.0.1:${port}/postgres?sslmode=disable`);
    url.password = password;
    process.exitCode = await tests({ ...process.env, TEST_DATABASE_URL: url.href, PG_DUMP: path.join(binaries, "pg_dump"), PG_RESTORE: path.join(binaries, "pg_restore") });
  } finally {
    if (await fs.access(path.join(data, "postmaster.pid")).then(() => true, () => false)) await exec(pgctl, ["-D", data, "-m", "fast", "-w", "stop"]);
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch(() => { console.error("Database test setup failed. Install PostgreSQL server/client tools or set a loopback TEST_DATABASE_URL; private credentials were not printed."); process.exitCode = 1; });
