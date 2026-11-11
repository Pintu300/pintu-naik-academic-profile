const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");
const { validEmail } = require("./admin-account");
const filename = path.join(__dirname, "private/admin-recovery.json");
const readRecoverySettings = (settingsFile = filename) => {
  let info;
  try { info = fs.lstatSync(settingsFile); }
  catch (error) { if (error.code === "ENOENT") return null; throw new Error("Cannot read private recovery settings."); }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error("Recovery settings must be a private regular file (0600).");
  let settings;
  try { settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")); }
  catch { throw new Error("Invalid private recovery settings."); }
  if (!settings || !validEmail(settings.user) || typeof settings.password !== "string" || !settings.password || !/^[a-f0-9]{64}$/.test(settings.secret || "")) throw new Error("Incomplete private recovery settings.");
  return settings;
};
const createRecoveryMailer = (settings, { transportFactory = nodemailer.createTransport } = {}) => {
  if (!settings) return null;
  const transport = transportFactory({ host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: settings.user, pass: settings.password }, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
  return async ({ to, code, reset = false }) => {
    await transport.sendMail({ from: settings.user, to,
      subject: reset ? "Website admin password changed" : "Your website admin recovery code",
      text: reset ? "Your website administrator password was changed. Existing sessions have been invalidated. If you did not request this, secure your email account and reset your admin credentials from your server."
        : `Your website admin recovery code is: ${code}\n\nIt expires in 10 minutes and can be used once. Do not share this code. If you did not request it, you can ignore this message.` });
  };
};
module.exports = { readRecoverySettings, createRecoveryMailer, recoverySettingsFile: filename };
