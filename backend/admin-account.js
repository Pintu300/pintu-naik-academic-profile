const { randomBytes, randomInt, scrypt, timingSafeEqual, createHmac } = require("node:crypto");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
const validEmail = (email) => typeof email === "string" && email.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email);
const hashPassword = async (password) => {
  const salt = randomBytes(32).toString("hex");
  return { salt, hash: (await derive(password, salt, 32)).toString("hex") };
};
const createAdminAccount = (pool, { secret = randomBytes(32).toString("hex"), now = Date.now } = {}) => {
  const digest = (code) => createHmac("sha256", secret).update(code).digest("hex");
  const read = async () => (await pool.query("SELECT * FROM portfolio.admin_account WHERE id=1")).rows[0];
  const provision = async ({ username, password, email = "", replace = false }) => {
    if (typeof username !== "string" || !username.trim() || username.length > 256 || typeof password !== "string" || password.length < (replace ? 12 : 1) || password.length > 1024
      || (email && !validEmail(email))) throw new Error("Invalid private admin configuration.");
    const { salt, hash } = await hashPassword(password);
    const conflict = replace ? `DO UPDATE SET username=EXCLUDED.username, password_salt=EXCLUDED.password_salt,
      password_hash=EXCLUDED.password_hash, recovery_email=EXCLUDED.recovery_email,
      credential_version=portfolio.admin_account.credential_version+1, otp_digest=NULL, otp_expires_at=NULL` : "DO NOTHING";
    await pool.query(`INSERT INTO portfolio.admin_account(id,username,password_salt,password_hash,recovery_email) VALUES (1,$1,$2,$3,$4) ON CONFLICT (id) ${conflict}`, [username.trim(), salt, hash, email.toLowerCase()]);
  };
  const request = async (email, send) => {
    const code = String(randomInt(0, 100000000)).padStart(8, "0");
    const time = new Date(now());
    // Database limits cover all clients and survive process restarts.
    const result = await pool.query(`UPDATE portfolio.admin_account SET otp_digest=$1,
      otp_expires_at=$2, otp_attempts=0, last_mail_at=$3,
      mail_count=CASE WHEN mail_window > $3::timestamptz - interval '15 minutes' THEN mail_count+1 ELSE 1 END,
      mail_window=CASE WHEN mail_window > $3::timestamptz - interval '15 minutes' THEN mail_window ELSE $3 END
      WHERE id=1 AND recovery_email=$4 AND (last_mail_at IS NULL OR last_mail_at <= $3::timestamptz - interval '60 seconds')
      AND (mail_window IS NULL OR mail_window <= $3::timestamptz - interval '15 minutes' OR mail_count < 5)
      RETURNING recovery_email`, [digest(code), new Date(now() + 10 * 60 * 1000), time, email.toLowerCase()]);
    if (!result.rows.length) return;
    try { await send({ to: result.rows[0].recovery_email, code }); }
    catch {
      await pool.query("UPDATE portfolio.admin_account SET otp_digest=NULL, otp_expires_at=NULL WHERE id=1 AND otp_digest=$1", [digest(code)]);
      console.error("Admin recovery email delivery failed. Check private mail settings; no code or credentials were printed.");
    }
  };
  const reset = async ({ email, code, password }) => {
    if (typeof email !== "string" || typeof code !== "string" || !/^\d{8}$/.test(code)
      || typeof password !== "string" || password.length < 12 || password.length > 1024) return null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const account = (await client.query("SELECT * FROM portfolio.admin_account WHERE id=1 FOR UPDATE")).rows[0];
      if (!account || account.recovery_email !== email.toLowerCase() || !account.otp_digest || !account.otp_expires_at || account.otp_expires_at.getTime() <= now() || account.otp_attempts >= 5) {
        await client.query("COMMIT"); return null;
      }
      if (!timingSafeEqual(Buffer.from(account.otp_digest, "hex"), Buffer.from(digest(code), "hex"))) {
        await client.query("UPDATE portfolio.admin_account SET otp_attempts=otp_attempts+1 WHERE id=1");
        await client.query("COMMIT"); return null;
      }
      const { salt, hash } = await hashPassword(password);
      await client.query("UPDATE portfolio.admin_account SET password_salt=$1,password_hash=$2,credential_version=credential_version+1,otp_digest=NULL,otp_expires_at=NULL,otp_attempts=0 WHERE id=1", [salt, hash]);
      await client.query("COMMIT");
      return account.username;
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  };
  return { read, provision, request, reset };
};
module.exports = { createAdminAccount, validEmail };
