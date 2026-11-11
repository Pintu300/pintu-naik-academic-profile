const { randomBytes, scryptSync, scrypt, timingSafeEqual, createHash } = require("node:crypto");
const { promisify } = require("node:util");
const { createRecoveryHandler } = require("./recovery-handler");

const deriveKey = promisify(scrypt);
const SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const IDLE_TIMEOUT = 5 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const COOKIE_NAME = "admin_session";

const sameOrigin = (request, adminOrigin) => {
  const origin = adminOrigin || `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`;
  return request.headers["sec-fetch-site"] !== "cross-site"
    && (!request.headers.origin || request.headers.origin === origin);
};

const createAdminAuth = ({ adminUser, adminPassword, adminOrigin, sendJson, readRequestBody, accountStore, recoveryMailer, now = Date.now }) => {
  const sessions = new Map();
  const attempts = new Map();
  const salt = randomBytes(32);
  const passwordKey = scryptSync(adminPassword, salt, 32);
  const usernameKey = createHash("sha256").update(adminUser).digest();
  const enabled = Boolean(accountStore || adminPassword);
  const handleRecovery = createRecoveryHandler({ accountStore, mailer: recoveryMailer, sendJson, readRequestBody, now });
  let activeLogins = 0;

  const cookieId = (request) => {
    const cookies = (request.headers.cookie || "").split(";");
    const value = cookies.find((cookie) => cookie.trim().startsWith(`${COOKIE_NAME}=`));
    const id = value?.trim().slice(COOKIE_NAME.length + 1) || "";
    return /^[a-f0-9]{64}$/.test(id) ? id : "";
  };
  const clearExpired = () => {
    const time = now();
    for (const [id, session] of sessions) {
      if (session.expires <= time || session.lastSeen + IDLE_TIMEOUT <= time) sessions.delete(id);
    }
    for (const [address, entry] of attempts) {
      if (entry.expires <= time) attempts.delete(address);
    }
  };
  const setCookie = (request, response, id, maxAge) => {
    const secure = request.socket.encrypted || adminOrigin.startsWith("https://");
    response.setHeader("Set-Cookie", `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
  };
  const sessionFor = async (request) => {
    clearExpired();
    const session = enabled ? sessions.get(cookieId(request)) : undefined;
    if (session && accountStore && (await accountStore.read())?.credential_version !== session.credentialVersion) {
      sessions.delete(cookieId(request));
      return undefined;
    }
    return session;
  };
  const authorize = async (request, response, pathname) => {
    const session = await sessionFor(request);
    if (!session) {
      if (pathname === "/admin.html" && ["GET", "HEAD"].includes(request.method)) {
        response.setHeader("Location", "/login.html");
        sendJson(request, response, 303, { error: "Sign in to continue." });
      } else {
        sendJson(request, response, 401, { error: "Authentication required." });
      }
      return false;
    }
    session.lastSeen = now();
    request.adminSession = session;
    return true;
  };
  const handleAuth = async (request, response, pathname) => {
    if (!["/api/auth/login", "/api/auth/logout", "/api/auth/activity", "/api/auth/recovery/request", "/api/auth/recovery/reset"].includes(pathname)) return false;
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(request, response, 405, { error: "Method not allowed." });
      return true;
    }
    if (!sameOrigin(request, adminOrigin) || request.headers["x-requested-with"] !== "admin-editor") {
      sendJson(request, response, 403, { error: "Invalid authentication request." });
      return true;
    }
    if (pathname.startsWith("/api/auth/recovery/")) {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
        sendJson(request, response, 415, { error: "Content-Type must be application/json." });
      } else await handleRecovery(request, response, pathname);
      return true;
    }
    if (["/api/auth/logout", "/api/auth/activity"].includes(pathname)) {
      const session = await sessionFor(request);
      const token = request.headers["x-csrf-token"] || "";
      if (!session) {
        sendJson(request, response, 401, { error: "Authentication required." });
      } else if (Buffer.byteLength(token) !== Buffer.byteLength(session.csrfToken)
        || !timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken))) {
        sendJson(request, response, 403, { error: "Invalid authentication request." });
      } else {
        if (pathname === "/api/auth/activity") {
          session.lastSeen = now();
          sendJson(request, response, 200, { status: "active" });
        } else {
          sessions.delete(cookieId(request));
          setCookie(request, response, "", 0);
          sendJson(request, response, 200, { status: "signed-out" });
        }
      }
      return true;
    }
    if (!enabled) {
      sendJson(request, response, 503, { error: "Admin login is disabled. Set ADMIN_PASSWORD on the server." });
      return true;
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
      sendJson(request, response, 415, { error: "Content-Type must be application/json." });
      return true;
    }
    clearExpired();
    const address = request.socket.remoteAddress;
    const entry = attempts.get(address);
    if (entry?.count >= 10 || (!entry && attempts.size >= 10_000) || activeLogins >= 4 || sessions.size >= 1000) {
      response.setHeader("Retry-After", String(entry ? Math.max(1, Math.ceil((entry.expires - now()) / 1000)) : 60));
      sendJson(request, response, 429, { error: "Too many login attempts. Try again later." });
      return true;
    }
    // Count before awaiting work so simultaneous guesses cannot evade the limit.
    attempts.set(address, { count: (entry?.count || 0) + 1, expires: entry?.expires || now() + LOGIN_WINDOW });
    let verifyingPassword = false;
    try {
      if (Number(request.headers["content-length"]) > 4096) {
        request.resume();
        sendJson(request, response, 413, { error: "Login request is too large." });
        return true;
      }
      let credentials;
      try {
        credentials = JSON.parse(await readRequestBody(request, 4096));
      } catch (error) {
        if (error.statusCode === 413) {
          sendJson(request, response, 413, { error: "Login request is too large." });
        } else {
          sendJson(request, response, 400, { error: "Invalid login request." });
        }
        return true;
      }
      if (!credentials || typeof credentials.username !== "string" || typeof credentials.password !== "string"
        || credentials.username.length > 256 || credentials.password.length > 1024) {
        sendJson(request, response, 400, { error: "Invalid login request." });
        return true;
      }
      // Slow uploads must not occupy scarce password-hashing slots. Recheck
      // immediately before starting work because other bodies may finish first.
      if (activeLogins >= 4 || sessions.size >= 1000) {
        response.setHeader("Retry-After", "60");
        sendJson(request, response, 429, { error: "Too many login attempts. Try again later." });
        return true;
      }
      activeLogins++;
      verifyingPassword = true;
      const account = accountStore ? await accountStore.read() : null;
      const suppliedKey = await deriveKey(credentials.password, account?.password_salt || salt, 32);
      const suppliedUser = createHash("sha256").update(credentials.username).digest();
      const passwordMatches = timingSafeEqual(account ? Buffer.from(account.password_hash, "hex") : passwordKey, suppliedKey);
      const usernameMatches = timingSafeEqual(account ? createHash("sha256").update(account.username).digest() : usernameKey, suppliedUser);
      if ((accountStore && !account) || !passwordMatches || !usernameMatches) {
        sendJson(request, response, 401, { error: "Incorrect username or password." });
        return true;
      }
      attempts.delete(address);
      sessions.delete(cookieId(request));
      const id = randomBytes(32).toString("hex");
      sessions.set(id, { csrfToken: randomBytes(32).toString("hex"), expires: now() + SESSION_LIFETIME, lastSeen: now(), credentialVersion: account?.credential_version });
      setCookie(request, response, id, SESSION_LIFETIME / 1000);
      sendJson(request, response, 200, { status: "signed-in" });
      return true;
    } finally {
      if (verifyingPassword) activeLogins--;
    }
  };
  return { authorize, handleAuth };
};

module.exports = { createAdminAuth };
