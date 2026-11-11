const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { readRecoverySettings, createRecoveryMailer } = require("./recovery-mail");

test("Gmail recovery settings stay private and reject exposed files or symlinks", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-mail-test-"));
  const filename = path.join(directory, "mail.json");
  const settings = { user: "owner@example.invalid", password: randomBytes(8).toString("hex"), secret: randomBytes(32).toString("hex") };
  try {
    assert.equal(readRecoverySettings(filename), null);
    fs.writeFileSync(filename, JSON.stringify(settings), { mode: 0o600 });
    assert.deepEqual(readRecoverySettings(filename), settings);
    fs.chmodSync(filename, 0o644);
    assert.throws(() => readRecoverySettings(filename), /private regular file/);
    fs.chmodSync(filename, 0o600);
    const symlink = path.join(directory, "link.json");
    fs.symlinkSync(filename, symlink);
    assert.throws(() => readRecoverySettings(symlink), /private regular file/);
    fs.writeFileSync(filename, JSON.stringify({ ...settings, user: "owner@example.invalid,extra@example.invalid" }));
    assert.throws(() => readRecoverySettings(filename), (error) => !error.message.includes(settings.password) && /Incomplete/.test(error.message));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("recovery mail uses verified TLS, fixed Gmail settings, and no credential logging", async () => {
  let configuration;
  const messages = [];
  const settings = { user: "owner@example.invalid", password: randomBytes(8).toString("hex") };
  const mailer = createRecoveryMailer(settings, { transportFactory(options) { configuration = options; return { async sendMail(message) { messages.push(message); } }; } });
  assert.equal(configuration.host, "smtp.gmail.com");
  assert.equal(configuration.secure, true);
  assert.equal(configuration.tls.rejectUnauthorized, true);
  assert.equal(configuration.logger, false);
  assert.equal(configuration.debug, false);
  assert.equal(configuration.disableFileAccess, true);
  assert.equal(configuration.disableUrlAccess, true);
  await mailer({ to: "recovery@example.invalid", code: "12345678" });
  await mailer({ to: "recovery@example.invalid", reset: true });
  assert.equal(messages[0].to, "recovery@example.invalid");
  assert.ok(messages[0].text.includes("12345678"));
  assert.ok(!JSON.stringify(messages).includes(settings.password));
  assert.ok(!messages[1].text.includes("12345678"));
  assert.equal(createRecoveryMailer(null), null);
});
