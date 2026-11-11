const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { timingSafeEqual, randomUUID, createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");

const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const DATA_DIR = path.join(__dirname, "data");
const MAX_BODY_BYTES = 1_000_000;
const { createAdminAuth } = require("./auth");
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://www.googletagmanager.com",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://www.google-analytics.com https://*.google-analytics.com",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com https://pintu-naik-visitor-stats.pintunaik300.workers.dev",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
].join("; ");

const DATA_FILES = Object.freeze({
  profile: "profile.json",
  research: "research.json",
  updates: "updates.json",
  publications: "publications.json",
  projects: "projects.json",
  achievements: "achievements.json",
  education: "education.json",
  skills: "skills.json",
  teaching: "teaching.json"
});

const API_RESOURCES = Object.freeze({
  "/api/profile": "profile",
  "/api/research": "research",
  "/api/updates": "updates",
  "/api/publications": "publications",
  "/api/projects": "projects",
  "/api/achievements": "achievements",
  "/api/education": "education",
  "/api/skills": "skills",
  "/api/teaching": "teaching"
});

const MIME_TYPES = Object.freeze({
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
});

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the 1 MB limit.");
    this.statusCode = 413;
  }
}

class InvalidJsonError extends Error {
  constructor() {
    super("Request body must contain valid JSON.");
    this.statusCode = 400;
  }
}

const send = (request, response, statusCode, body, contentType = "text/plain; charset=utf-8") => {
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  if (/^(text\/|application\/json|image\/svg\+xml)/.test(contentType)) {
    response.setHeader("Vary", "Accept-Encoding");
    const gzipAllowed = (request.headers["accept-encoding"] || "").split(",").some((encoding) => {
      const [name, ...parameters] = encoding.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return name.toLowerCase() === "gzip" && (!quality || Number(quality.trim().slice(2)) > 0);
    });
    if (statusCode === 200 && payload.length >= 1024 && gzipAllowed) {
      payload = gzipSync(payload);
      response.setHeader("Content-Encoding", "gzip");
    }
  }
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": response.getHeader("Cache-Control") || "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Resource-Policy": "same-origin"
  });
  response.end(request.method === "HEAD" ? undefined : payload);
};

const sendJson = (request, response, statusCode, payload) => {
  send(request, response, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
};

const sendMethodNotAllowed = (request, response, allowedMethods) => {
  response.setHeader("Allow", allowedMethods.join(", "));
  sendJson(request, response, 405, { error: "Method not allowed." });
};

const readJsonFile = async (dataDir, filename) => {
  const contents = await fs.readFile(path.join(dataDir, filename), "utf8");

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filename}.`, { cause: error });
  }
};

const readSiteData = async (dataDir) => {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, filename]) => [
      key,
      await readJsonFile(dataDir, filename)
    ])
  );

  return Object.fromEntries(entries);
};

const dataRevision = (data) => `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;

const readRequestBody = (request, maxBodyBytes) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) chunks.push(chunk);
    });

    request.on("end", () => {
      if (tooLarge) {
        reject(new RequestBodyTooLargeError());
        return;
      }

      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });

const constantTimeEquals = (value, expected) => {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
};

const validateSiteData = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Data must be a JSON object.";
  }

  if (!data.profile || typeof data.profile !== "object" || Array.isArray(data.profile)) {
    return "Missing profile object.";
  }

  for (const field of Object.keys(DATA_FILES)) {
    if (field === "profile") continue;

    if (!Array.isArray(data[field])) {
      return `${field} must be an array.`;
    }

    if (data[field].some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      return `${field} entries must be objects.`;
    }
  }

  const requiredProfileFields = ["name", "title", "institution", "department", "email", "summary"];
  const missingField = requiredProfileFields.find(
    (field) => typeof data.profile[field] !== "string" || !data.profile[field].trim()
  );

  if (missingField) return `Missing profile field: ${missingField}.`;

  const safeAsset = (value) => /^assets\/[A-Za-z0-9._/-]+$/.test(value)
    && !value.split("/").some((part) => !part || part.startsWith("."));
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  };
  const validateFields = (record) => {
    for (const [key, value] of Object.entries(record)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) return "Reserved field name.";
      if (typeof value !== "string") return `${key} must be text.`;
      if (value.length > 20_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
        return `${key} contains invalid or excessive text.`;
      }
      if (!value) continue;
      if (["photo", "image", "institutionLogo"].includes(key) && !safeAsset(value)) {
        return `${key} must be a local assets/ path.`;
      }
      if (["url", "doi", "pdf", "codeUrl", "demoUrl"].includes(key) && !safeUrl(value)
        && !(key === "pdf" && safeAsset(value) && /\.pdf$/i.test(value))) {
        return `${key} must be an HTTP(S) URL or supported local PDF path.`;
      }
    }
    return null;
  };
  const { about, links, ...profileFields } = data.profile;
  if (about !== undefined && (!Array.isArray(about)
    || about.length > 100 || about.some((text) => typeof text !== "string" || text.length > 20_000))) {
    return "Profile about must be an array of text paragraphs.";
  }
  if (links !== undefined && (!links || typeof links !== "object" || Array.isArray(links)
    || Object.entries(links).some(([key, url]) => ["__proto__", "constructor", "prototype"].includes(key)
      || typeof url !== "string" || (url !== "" && !safeUrl(url))))) {
    return "Profile links must contain HTTP(S) URLs.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.profile.email)) return "Invalid profile email.";
  const profileError = validateFields(profileFields);
  if (profileError) return profileError;
  for (const field of Object.keys(DATA_FILES).filter((key) => key !== "profile")) {
    if (data[field].length > 1000) return `${field} has too many entries.`;
    for (const item of data[field]) {
      const error = validateFields(item);
      if (error) return `${field}: ${error}`;
    }
  }
  return null;
};

const writeSiteData = async (dataDir, data) => {
  const validationError = validateSiteData(data);
  if (validationError) return validationError;

  const transactionId = randomUUID();
  const stagedFiles = [];
  const backedUpFiles = [];
  const installedFiles = [];

  try {
    for (const [key, filename] of Object.entries(DATA_FILES)) {
      const target = path.join(dataDir, filename);
      const temporary = path.join(dataDir, `.${filename}.${transactionId}.tmp`);
      await fs.writeFile(temporary, `${JSON.stringify(data[key], null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx"
      });
      stagedFiles.push({ target, temporary });
    }

    for (const { target, temporary } of stagedFiles) {
      const backup = path.join(dataDir, `.${path.basename(target)}.${transactionId}.bak`);
      await fs.rename(target, backup);
      backedUpFiles.push({ target, backup });
      await fs.rename(temporary, target);
      installedFiles.push(target);
    }
  } catch (error) {
    const rollbackErrors = [];

    for (const target of installedFiles.reverse()) {
      try {
        await fs.unlink(target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    for (const { target, backup } of backedUpFiles.reverse()) {
      try {
        await fs.rename(backup, target);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    await Promise.all(
      stagedFiles.map(({ temporary }) =>
        fs.unlink(temporary).catch((cleanupError) => {
          if (cleanupError.code !== "ENOENT") rollbackErrors.push(cleanupError);
        })
      )
    );

    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], "Could not safely roll back the site data update.");
    }
    throw error;
  }

  await Promise.all(
    backedUpFiles.map(({ backup }) =>
      fs.unlink(backup).catch((error) => {
        if (error.code !== "ENOENT") {
          console.error(JSON.stringify({
            level: "warn",
            message: "site_data_backup_cleanup_failed",
            file: path.basename(backup),
            error: error.message
          }));
        }
      })
    )
  );
  return null;
};

const serveAdminApi = async (request, response, loadData, maxBodyBytes, csrfToken, saveData, adminOrigin, validateOnly = false) => {
  if (!validateOnly && (request.method === "GET" || request.method === "HEAD")) {
    const data = await loadData();
    response.setHeader("X-CSRF-Token", csrfToken);
    response.setHeader("ETag", dataRevision(data));
    sendJson(request, response, 200, data);
    return;
  }

  if (request.method !== (validateOnly ? "POST" : "PUT")) {
    sendMethodNotAllowed(request, response, validateOnly ? ["POST"] : ["GET", "HEAD", "PUT"]);
    return;
  }

  const origin = adminOrigin || `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`;
  if (request.headers["sec-fetch-site"] === "cross-site"
    || (request.headers.origin && request.headers.origin !== origin)
    || !constantTimeEquals(request.headers["x-csrf-token"] || "", csrfToken)) {
    sendJson(request, response, 403, { error: "Invalid admin request. Reload the editor and try again." });
    return;
  }

  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
    sendJson(request, response, 415, { error: "Content-Type must be application/json." });
    return;
  }

  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    sendJson(request, response, 413, { error: new RequestBodyTooLargeError().message });
    request.resume();
    return;
  }

  const body = await readRequestBody(request, maxBodyBytes);
  let nextData;
  try {
    nextData = JSON.parse(body);
  } catch {
    throw new InvalidJsonError();
  }

  const validationError = validateSiteData(nextData);
  if (validationError) {
    sendJson(request, response, 400, { error: validationError });
    return;
  }

  if (validateOnly) {
    sendJson(request, response, 200, { status: "valid" });
    return;
  }
  if (!request.headers["if-match"]) {
    sendJson(request, response, 428, { error: "Reload the editor before saving. A content version is required." });
    return;
  }
  const revision = await saveData(nextData, request.headers["if-match"]);
  response.setHeader("ETag", revision);
  sendJson(request, response, 200, { status: "saved" });
};

const resolveStaticPath = (frontendDir, pathname) => {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const requestedPath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(frontendDir, requestedPath);
  const relativePath = path.relative(frontendDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)
    || requestedPath.split(/[\\/]/).some((part) => part.startsWith("."))
    || (!requestedPath.startsWith("assets/") && requestedPath.includes("/"))
    || !Object.hasOwn(MIME_TYPES, path.extname(filePath).toLowerCase())) return null;
  return filePath;
};

const serveStatic = async (request, response, frontendDir, pathname) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendMethodNotAllowed(request, response, ["GET", "HEAD"]);
    return;
  }

  const filePath = resolveStaticPath(frontendDir, pathname);
  if (!filePath) {
    sendJson(request, response, 403, { error: "Forbidden." });
    return;
  }

  let file;
  try {
    // Reject symlink aliases, including aliases to protected admin files.
    if (await fs.realpath(filePath) !== filePath) {
      sendJson(request, response, 403, { error: "Forbidden." });
      return;
    }
    if (!(await fs.stat(filePath)).isFile()) {
      sendJson(request, response, 404, { error: "Not found." });
      return;
    }
    file = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      sendJson(request, response, 404, { error: "Not found." });
      return;
    }
    throw error;
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  if (!filePath.endsWith(".html") && !["/admin.js", "/editor-model.js", "/login.js"].includes(pathname)) {
    const tag = `W/"${createHash("sha256").update(file).digest("hex")}"`;
    response.setHeader("ETag", tag);
    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    response.setHeader("Vary", "Accept-Encoding");
    const candidates = (request.headers["if-none-match"] || "").split(",").map((candidate) => candidate.trim().replace(/^W\//, ""));
    if (candidates.includes(tag.slice(2)) || candidates.includes("*")) {
      send(request, response, 304, "", contentType);
      return;
    }
  }
  send(request, response, 200, file, contentType);
};

const serveApi = async (request, response, pathname, options) => {
  if (pathname === "/api/health") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendMethodNotAllowed(request, response, ["GET", "HEAD"]);
      return;
    }
    sendJson(request, response, 200, { status: "ok" });
    return;
  }

  if (pathname === "/api/admin/site-data" || pathname === "/api/admin/validate-backup") {
    await serveAdminApi(
      request,
      response,
      options.loadData,
      options.maxBodyBytes,
      request.adminSession.csrfToken,
      options.saveData,
      options.adminOrigin,
      pathname === "/api/admin/validate-backup"
    );
    return;
  }

  const resource = Object.hasOwn(API_RESOURCES, pathname) ? API_RESOURCES[pathname] : null;
  if (!resource) {
    sendJson(request, response, 404, { error: "API route not found." });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendMethodNotAllowed(request, response, ["GET", "HEAD"]);
    return;
  }

  sendJson(request, response, 200, await readJsonFile(options.dataDir, DATA_FILES[resource]));
};

const createServer = ({
  adminUser = process.env.ADMIN_USER || "admin",
  adminPassword = process.env.ADMIN_PASSWORD || "",
  adminOrigin = process.env.ADMIN_ORIGIN || "",
  frontendDir = FRONTEND_DIR,
  dataDir = DATA_DIR,
  maxBodyBytes = MAX_BODY_BYTES,
  now = Date.now
} = {}) => {
  if (adminOrigin && (!/^https?:\/\//.test(adminOrigin) || new URL(adminOrigin).origin !== adminOrigin)) {
    throw new Error("ADMIN_ORIGIN must be an exact HTTP(S) origin without a trailing slash.");
  }
  const auth = createAdminAuth({ adminUser, adminPassword, adminOrigin, sendJson, readRequestBody, now });
  let pendingOperation = Promise.resolve();
  const serialize = (operation) => {
    const result = pendingOperation.then(operation);
    pendingOperation = result.catch(() => {});
    return result;
  };
  const loadData = () => serialize(() => readSiteData(dataDir));
  const saveData = (data, expectedRevision) => serialize(async () => {
    if (dataRevision(await readSiteData(dataDir)) !== expectedRevision) {
      const error = new Error("Content changed since you opened the editor. Download your draft, then reload the saved content and apply your edits again.");
      error.statusCode = 412;
      throw error;
    }
    await writeSiteData(dataDir, data);
    return dataRevision(await readSiteData(dataDir));
  });
  const options = { adminUser, adminPassword, frontendDir, dataDir, maxBodyBytes, loadData, saveData, adminOrigin };

  const server = http.createServer(async (request, response) => {
    try {
      let pathname;
      try {
        if (!request.url.startsWith("/") || request.url.startsWith("//")) throw new Error();
        pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (/[\\\u0000-\u001f\u007f%]/.test(pathname) || pathname.split("/").includes("..")) throw new Error();
        pathname = path.posix.normalize(pathname);
      } catch {
        sendJson(request, response, 400, { error: "Invalid request path." });
        return;
      }
      const requestUrl = { pathname };
      if (await auth.handleAuth(request, response, pathname)) return;
      if ((["/admin.html", "/admin.js"].includes(pathname) || pathname.startsWith("/api/admin/"))
        && !auth.authorize(request, response, pathname)) return;

      if (requestUrl.pathname.startsWith("/api/")) {
        await serveApi(request, response, requestUrl.pathname, options);
        return;
      }

      if (requestUrl.pathname.startsWith("/data/")) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendMethodNotAllowed(request, response, ["GET", "HEAD"]);
          return;
        }

        const resource = /^\/data\/([a-z]+)\.json$/.exec(requestUrl.pathname)?.[1];
        if (!resource || !Object.hasOwn(DATA_FILES, resource)) {
          sendJson(request, response, 404, { error: "Site data file not found." });
          return;
        }

        const contents = await fs.readFile(path.join(options.dataDir, DATA_FILES[resource]));
        send(request, response, 200, contents, MIME_TYPES[".json"]);
        return;
      }

      await serveStatic(request, response, options.frontendDir, pathname);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      if (statusCode >= 500) {
        console.error(JSON.stringify({
          level: "error",
          message: "request_failed",
          method: request.method,
          path: request.url,
          error: error.message
        }));
      }

      if (!response.headersSent) {
        sendJson(request, response, statusCode, {
          error: statusCode >= 500 ? "Internal server error." : error.message
        });
      } else {
        response.destroy(error);
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  return server;
};

const startServer = () => {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer();

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Cannot start: ${host}:${port} is already in use.`);
      console.error("Stop the existing server with Ctrl+C in its terminal, or choose another port:");
      console.error("PORT=3001 npm start (with ADMIN_PASSWORD set to enable admin login)");
    } else {
      console.error(`Could not start the server: ${error.message}`);
    }
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    console.log(`Server running at http://${host}:${server.address().port}`);
    console.log(`Frontend served from ${FRONTEND_DIR}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn("Admin editor disabled. Set ADMIN_PASSWORD to enable /admin.html.");
    }
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; closing server.`);
    server.close((error) => {
      if (error) {
        console.error("Could not close the server cleanly.", error);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
};

if (require.main === module) {
  startServer();
}

module.exports = { createServer, startServer, validateSiteData };
