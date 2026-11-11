/* Reports locations and categories only; never prints matched credentials. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { isSensitivePath } = require("../backend/public-files");
const root = path.resolve(__dirname, "..");
const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----(?:\s|\\n)+[A-Za-z0-9+/=]{32,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{35}\b/],
  ["AWS access identifier", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["service-account JSON", /"type"\s*:\s*"service_account"/],
  ["database connection credentials", /\bpostgres(?:ql)?:\/\/[^\s:/@]+:[^\s@/]+@/i]
];
const detectSecrets = (text) => rules.filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
const inspectFile = (filename, content) => {
  const categories = detectSecrets(content);
  if (isSensitivePath(filename)) categories.push("private filename");
  if (!/\.test\.[cm]?js$/.test(filename)) {
    if (/(?:DATABASE_PASSWORD|PGPASSWORD|POSTGRES_PASSWORD)["']?\s*[:=]\s*["'][^"'\r\n]+["']/.test(content)) categories.push("literal database password");
    if (/(?:SMTP_PASSWORD|GMAIL_APP_PASSWORD)["']?\s*[:=]\s*["'][^"'\r\n]+["']/.test(content)) categories.push("literal mail password");
    const assignments = content.matchAll(/(?:ADMIN_PASSWORD|adminPassword)["']?\s*[:=]\s*["']([^"'\r\n]+)["']/g);
    for (const [, value] of assignments) {
      if (!/^(?:change-this-password|test-password|your[-_ ].*|example[-_ ].*|placeholder|\$.*)$/i.test(value)) {
        categories.push("literal admin password");
        break;
      }
    }
  }
  return [...new Set(categories)];
};
const git = (args, cwd = root, input) => {
  const result = spawnSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Git inspection failed; no scan result can be claimed.");
  return result.stdout;
};
const run = ({ history = false, repositoryRoot = root, report = (summary) => console.log(JSON.stringify(summary, null, 2)) } = {}) => {
  const inspectGit = (args, input) => git(args, repositoryRoot, input);
  const findings = [];
  const files = inspectGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  for (const filename of files) {
    const file = path.join(repositoryRoot, filename);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
    const content = fs.readFileSync(file);
    for (const category of inspectFile(filename, content.toString("utf8"))) {
      findings.push({ file: filename, category });
    }
  }
  // Inspect the index too: a clean working copy can hide an older staged secret.
  const staged = inspectGit(["ls-files", "--stage", "-z"]).split("\0").filter(Boolean);
  for (const entry of staged) {
    const separator = entry.indexOf("\t");
    const [, id] = entry.slice(0, separator).split(" ");
    const filename = entry.slice(separator + 1);
    const content = inspectGit(["cat-file", "-p", id]);
    for (const category of inspectFile(filename, content)) findings.push({ file: filename, source: "index", category });
  }
  let historyObjects = 0;
  if (history) {
    const objects = inspectGit(["rev-list", "--objects", "--all"]).trim().split("\n").flatMap((line) => {
      const separator = line.indexOf(" ");
      return separator < 0 ? [] : [{ id: line.slice(0, separator), filename: line.slice(separator + 1) }];
    });
    const blobs = new Set(objects.length ? inspectGit(["cat-file", "--batch-check=%(objectname) %(objecttype)"], objects.map(({ id }) => id).join("\n") + "\n")
      .trim().split("\n").filter((line) => line.endsWith(" blob")).map((line) => line.split(" ")[0]) : []);
    // Inspect every blob, including deleted shell/CSS files and binary assets.
    // File extensions and NUL bytes do not establish that content is secret-free.
    for (const { id, filename } of objects) {
      if (!blobs.has(id)) continue;
      historyObjects++;
      for (const category of inspectFile(filename, inspectGit(["cat-file", "-p", id]))) {
        findings.push({ file: filename, object: id.slice(0, 12), category });
      }
    }
  }
  report({ filesChecked: files.length, indexedFilesChecked: staged.length, historyObjectsChecked: historyObjects, findings });
  return findings;
};
if (require.main === module) {
  try { if (run({ history: process.argv.includes("--history") }).length) process.exitCode = 1; }
  catch { console.error("Security scan could not complete. Check Git availability and permissions; credential values were not printed."); process.exitCode = 1; }
}
module.exports = { detectSecrets, inspectFile, run };
