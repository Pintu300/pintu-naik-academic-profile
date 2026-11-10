const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { timingSafeEqual, randomUUID } = require("node:crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const DATA_DIR = path.join(__dirname, "data");
const MAX_BODY_BYTES = 1_000_000;

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
  ".webp": "image/webp"
  ,".woff": "font/woff",
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
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY"
  });
  response.end(request.method === "HEAD" ? undefined : body);
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

const parseBasicCredentials = (request) => {
  const authorization = request.headers.authorization || "";
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return null;

  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
};

const constantTimeEquals = (value, expected) => {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
};

const isAdminRequest = (request, adminUser, adminPassword) => {
  if (!adminPassword) return false;

  const credentials = parseBasicCredentials(request);
  if (!credentials) return false;

  const usernameMatches = constantTimeEquals(credentials.username, adminUser);
  const passwordMatches = constantTimeEquals(credentials.password, adminPassword);
  return usernameMatches && passwordMatches;
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

const sendUnauthorized = (request, response) => {
  response.setHeader("WWW-Authenticate", 'Basic realm="Website Admin", charset="UTF-8"');
  sendJson(request, response, 401, { error: "Authentication required." });
};

const serveAdminApi = async (request, response, dataDir, adminUser, adminPassword, maxBodyBytes) => {
  if (!isAdminRequest(request, adminUser, adminPassword)) {
    sendUnauthorized(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    sendJson(request, response, 200, await readSiteData(dataDir));
    return;
  }

  if (request.method !== "PUT") {
    sendMethodNotAllowed(request, response, ["GET", "HEAD", "PUT"]);
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

  const validationError = await writeSiteData(dataDir, nextData);
  if (validationError) {
    sendJson(request, response, 400, { error: validationError });
    return;
  }

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

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return filePath;
};

const serveStatic = async (request, response, frontendDir) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendMethodNotAllowed(request, response, ["GET", "HEAD"]);
    return;
  }

  const filePath = resolveStaticPath(frontendDir, new URL(request.url, "http://localhost").pathname);
  if (!filePath) {
    sendJson(request, response, 403, { error: "Forbidden." });
    return;
  }

  let file;
  try {
    file = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      sendJson(request, response, 404, { error: "Not found." });
      return;
    }
    throw error;
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
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

  if (pathname === "/api/admin/site-data") {
    await serveAdminApi(
      request,
      response,
      options.dataDir,
      options.adminUser,
      options.adminPassword,
      options.maxBodyBytes
    );
    return;
  }

  const resource = API_RESOURCES[pathname];
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
  frontendDir = FRONTEND_DIR,
  dataDir = DATA_DIR,
  maxBodyBytes = MAX_BODY_BYTES
} = {}) => {
  const options = { adminUser, adminPassword, frontendDir, dataDir, maxBodyBytes };

  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://localhost");

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
        if (!resource || !DATA_FILES[resource]) {
          sendJson(request, response, 404, { error: "Site data file not found." });
          return;
        }

        const contents = await fs.readFile(path.join(options.dataDir, DATA_FILES[resource]));
        send(request, response, 200, contents, MIME_TYPES[".json"]);
        return;
      }

      if (["/admin.html", "/admin.js"].includes(requestUrl.pathname)
        && !isAdminRequest(request, options.adminUser, options.adminPassword)) {
        sendUnauthorized(request, response);
        return;
      }

      await serveStatic(request, response, options.frontendDir);
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
};

const startServer = () => {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0";
  const server = createServer();

  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

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
