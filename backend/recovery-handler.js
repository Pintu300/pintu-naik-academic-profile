const { validEmail } = require("./admin-account");
const createRecoveryHandler = ({ accountStore, mailer, sendJson, readRequestBody, now }) => {
  const attempts = new Map();
  let sending = 0;
  let resetting = 0;
  return async (request, response, pathname) => {
    const requestCode = pathname === "/api/auth/recovery/request";
    if (!accountStore || !mailer) {
      sendJson(request, response, 503, { error: "Email recovery is not configured. The server owner can configure it locally." });
      return;
    }
    for (const [key, value] of attempts) if (value.expires <= now()) attempts.delete(key);
    const key = `${request.socket.remoteAddress}:${requestCode ? "send" : "reset"}`;
    const entry = attempts.get(key);
    const limit = requestCode ? 5 : 20;
    if ((entry?.count || 0) >= limit || (!entry && attempts.size >= 10000) || (!requestCode && resetting >= 4)) {
      response.setHeader("Retry-After", "900");
      sendJson(request, response, 429, { error: "Too many recovery attempts. Try again later." });
      return;
    }
    attempts.set(key, { count: (entry?.count || 0) + 1, expires: entry?.expires || now() + 15 * 60 * 1000 });
    let data;
    try {
      if (Number(request.headers["content-length"]) > 4096) { request.resume(); throw new Error(); }
      data = JSON.parse(await readRequestBody(request, 4096));
    } catch { sendJson(request, response, 400, { error: "Invalid recovery request." }); return; }
    if (!data || !validEmail(data.email)) {
      sendJson(request, response, 400, { error: "Enter a valid recovery email address." }); return;
    }
    if (requestCode) {
      // Respond identically before email delivery, without exposing registered addresses.
      if (sending < 4) {
        sending++;
        void accountStore.request(data.email, mailer).catch(() => {
          console.error("Admin recovery request failed; private details were not printed.");
        }).finally(() => { sending--; });
      }
      sendJson(request, response, 202, { message: "If this is the registered recovery address, a code will arrive shortly. Check your inbox and spam folder. Wait at least 60 seconds before requesting another code." });
      return;
    }
    if (typeof data.code !== "string" || !/^\d{8}$/.test(data.code)
      || typeof data.password !== "string" || data.password.length < 12 || data.password.length > 1024
      || data.password !== data.confirmPassword) {
      sendJson(request, response, 400, { error: "Enter the 8-digit code and matching new passwords of 12–1024 characters." }); return;
    }
    // Slow uploads must not reserve hashing slots; recheck once the body is read.
    if (resetting >= 4) { sendJson(request, response, 429, { error: "Too many recovery attempts. Try again later." }); return; }
    resetting++;
    try {
      const username = await accountStore.reset(data);
      if (!username) { sendJson(request, response, 400, { error: "The recovery code is invalid, expired, or has too many attempts. Request a new code." }); return; }
      sendJson(request, response, 200, { message: "Password changed. Sign in with your new password.", username });
      // The verified email is fixed by the successful reset, never an arbitrary recipient.
      void mailer({ to: data.email, reset: true }).catch(() => console.error("Admin password-change notification failed; private details were not printed."));
    } finally { resetting--; }
  };
};
module.exports = { createRecoveryHandler };
