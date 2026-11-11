const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateKeyPairSync } = require("node:crypto");
const { detectSecrets, inspectFile, run } = require("./security-audit");
const { isPublicAsset, isSensitivePath } = require("../backend/public-files");

test("credential scanning detects generated private keys and token-shaped values without returning their contents", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  assert.deepEqual(detectSecrets(pem), ["private key"]);
  assert.deepEqual(detectSecrets(JSON.stringify({ private_key: pem })), ["private key"]);
  const token = "gh" + "p_" + "x".repeat(36);
  const findings = inspectFile("frontend/config.js", `const token = '${token}';`);
  assert.deepEqual(findings, ["GitHub token"]);
  assert.ok(!JSON.stringify(findings).includes(token));
  assert.deepEqual(inspectFile("config.json", JSON.stringify({ adminPassword: "synthetic-value" })), ["literal admin password"]);
  assert.deepEqual(inspectFile("README.md", 'ADMIN_PASSWORD="change-this-password" npm start'), []);
});

test("public identifiers and runtime secret references are distinguished from credentials", () => {
  assert.deepEqual(detectSecrets('const measurementId = "G-1234567890"; const key = process.env.GA_PRIVATE_KEY;'), []);
  assert.deepEqual(detectSecrets('pem.replace(/-----BEGIN PRIVATE KEY-----/g, "")'), []);
  assert.equal(isSensitivePath(".env.example"), false);
  for (const name of [".env", ".env.production", "credentials.json", "service-account.json", "backups/site.json", "academic-site-draft-2026.json", "signing.pfx"]) {
    assert.equal(isSensitivePath(name), true, name);
  }
});

test("only designated asset types and the generated image manifest can be published", () => {
  for (const name of ["assets/photo.jpg", "assets/papers/research.pdf", "assets/favicon.svg", "assets/optimized/manifest.json"]) assert.equal(isPublicAsset(name), true, name);
  for (const name of ["assets/config.json", "assets/backups/research.pdf", "assets/secret-photo.jpg", "assets/.env", "assets/key.pem", "assets/../profile.jpg", "assets/code.js"]) assert.equal(isPublicAsset(name), false, name);
});

test("a secret staged in Git is detected even after it is removed from the working file", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-secret-index-"));
  try {
    for (const args of [["init", "--quiet", temporary]]) assert.equal(spawnSync("git", args).status, 0);
    const token = "gh" + "p_" + "x".repeat(36);
    await fs.writeFile(path.join(temporary, "config.js"), `const token = '${token}';`);
    assert.equal(spawnSync("git", ["add", "config.js"], { cwd: temporary }).status, 0);
    await fs.writeFile(path.join(temporary, "config.js"), "// Secret removed from working copy\n");
    const findings = run({ repositoryRoot: temporary, report() {} });
    assert.deepEqual(findings, [{ file: "config.js", source: "index", category: "GitHub token" }]);
    assert.ok(!JSON.stringify(findings).includes(token));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("history scanning detects deleted secrets in shell files and binary assets", async () => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-history-scan-"));
  const git = (...args) => {
    const result = spawnSync("git", ["-c", "user.name=Security Test", "-c", "user.email=test@example.invalid", ...args], { cwd: temporary, encoding: "utf8" });
    assert.equal(result.status, 0);
  };
  try {
    git("init", "--quiet");
    const token = "gh" + "p_" + "z".repeat(36);
    await fs.writeFile(path.join(temporary, "run.sh"), `export TOKEN='${token}'\n`);
    await fs.writeFile(path.join(temporary, "image.png"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(token)]));
    assert.ok(run({ repositoryRoot: temporary, report() {} }).some((item) => item.file === "image.png" && item.category === "GitHub token"));
    git("add", "run.sh", "image.png");
    git("commit", "--quiet", "-m", "Synthetic historical fixture");
    git("rm", "--quiet", "run.sh", "image.png");
    git("commit", "--quiet", "-m", "Remove fixtures");
    const findings = run({ repositoryRoot: temporary, history: true, report() {} });
    for (const filename of ["run.sh", "image.png"]) assert.ok(findings.some((item) => item.file === filename && item.object && item.category === "GitHub token"), filename);
    assert.ok(!JSON.stringify(findings).includes(token));
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
