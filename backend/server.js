const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const DATA_DIR = path.join(__dirname, "data");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const dataFiles = {
  profile: "profile.json",
  research: "research.json",
  updates: "updates.json",
  publications: "publications.json",
  projects: "projects.json",
  achievements: "achievements.json",
  education: "education.json",
  skills: "skills.json",
  teaching: "teaching.json"
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml"
};

const send = (response, statusCode, body, contentType = "text/plain; charset=utf-8") => {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
};

const sendJson = (response, statusCode, payload) => {
  send(response, statusCode, JSON.stringify(payload, null, 2), "application/json; charset=utf-8");
};

const sendUnauthorized = (response) => {
  response.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="Website Admin"'
  });
  response.end("Authentication required");
};

const readSiteData = async () => {
  const entries = await Promise.all(
    Object.entries(dataFiles).map(async ([key, filename]) => {
      const file = await fs.readFile(path.join(DATA_DIR, filename), "utf8");
      return [key, JSON.parse(file)];
    })
  );

  return Object.fromEntries(entries);
};

const readRequestBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
};

const isAdminRequest = (request) => {
  if (!ADMIN_PASSWORD) {
    return false;
  }

  const header = request.headers.authorization || "";

  if (!header.startsWith("Basic ")) {
    return false;
  }

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex === -1) {
    return false;
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return username === ADMIN_USER && password === ADMIN_PASSWORD;
};

const validateSiteData = (data) => {
  if (!data || typeof data !== "object") {
    return "Data must be an object.";
  }

  if (!data.profile || typeof data.profile !== "object") {
    return "Missing profile object.";
  }

  const requiredArrays = [
    "research",
    "updates",
    "publications",
    "projects",
    "achievements",
    "education",
    "skills",
    "teaching"
  ];
  const missingArray = requiredArrays.find((field) => !Array.isArray(data[field]));

  if (missingArray) {
    return `${missingArray} must be an array.`;
  }

  const requiredProfileFields = ["name", "title", "institution", "department", "email", "summary"];
  const missingField = requiredProfileFields.find((field) => !data.profile[field]);

  if (missingField) {
    return `Missing profile field: ${missingField}.`;
  }

  return null;
};

const writeSiteData = async (data) => {
  const error = validateSiteData(data);

  if (error) {
    return error;
  }

  await Promise.all(
    Object.entries(dataFiles).map(([key, filename]) =>
      fs.writeFile(path.join(DATA_DIR, filename), `${JSON.stringify(data[key], null, 2)}\n`, "utf8")
    )
  );

  return null;
};

const serveApi = async (request, requestUrl, response) => {
  const data = await readSiteData();

  if (requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok" });
    return true;
  }

  if (requestUrl.pathname === "/api/admin/site-data") {
    if (!isAdminRequest(request)) {
      sendUnauthorized(response);
      return true;
    }

    if (request.method === "GET") {
      sendJson(response, 200, data);
      return true;
    }

    if (request.method === "PUT") {
      const body = await readRequestBody(request);
      const nextData = JSON.parse(body);
      const error = await writeSiteData(nextData);

      if (error) {
        sendJson(response, 400, { error });
        return true;
      }

      sendJson(response, 200, { status: "saved" });
      return true;
    }

    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (requestUrl.pathname === "/api/profile") {
    sendJson(response, 200, data.profile);
    return true;
  }

  if (requestUrl.pathname === "/api/updates") {
    sendJson(response, 200, data.updates);
    return true;
  }

  if (requestUrl.pathname === "/api/research") {
    sendJson(response, 200, data.research);
    return true;
  }

  if (requestUrl.pathname === "/api/publications") {
    sendJson(response, 200, data.publications);
    return true;
  }

  if (requestUrl.pathname === "/api/projects") {
    sendJson(response, 200, data.projects);
    return true;
  }

  if (requestUrl.pathname === "/api/achievements") {
    sendJson(response, 200, data.achievements);
    return true;
  }

  if (requestUrl.pathname === "/api/education") {
    sendJson(response, 200, data.education);
    return true;
  }

  if (requestUrl.pathname === "/api/skills") {
    sendJson(response, 200, data.skills);
    return true;
  }

  if (requestUrl.pathname === "/api/teaching") {
    sendJson(response, 200, data.teaching);
    return true;
  }

  return false;
};

const serveSiteData = async (requestUrl, response) => {
  const match = /^\/data\/([a-z]+)\.json$/.exec(requestUrl.pathname);

  if (!match || !dataFiles[match[1]]) {
    return false;
  }

  const body = await fs.readFile(path.join(DATA_DIR, dataFiles[match[1]]), "utf8");
  send(response, 200, body, mimeTypes[".json"]);
  return true;
};

const safeStaticPath = (pathname) => {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(FRONTEND_DIR, requestedPath));

  if (!filePath.startsWith(FRONTEND_DIR)) {
    return null;
  }

  return filePath;
};

const serveStatic = async (requestUrl, response) => {
  const filePath = safeStaticPath(decodeURIComponent(requestUrl.pathname));

  if (!filePath) {
    send(response, 403, "Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const contentType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    send(response, 200, body, contentType);
  } catch (error) {
    if (error.code === "ENOENT") {
      send(response, 404, "Not found");
      return;
    }

    send(response, 500, "Internal server error");
  }
};

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (requestUrl.pathname.startsWith("/api/")) {
      const handled = await serveApi(request, requestUrl, response);
      if (!handled) {
        sendJson(response, 404, { error: "API route not found" });
      }
      return;
    }

    if (requestUrl.pathname.startsWith("/data/")) {
      const handled = await serveSiteData(requestUrl, response);
      if (!handled) {
        sendJson(response, 404, { error: "Site data file not found" });
      }
      return;
    }

    if (["/admin.html", "/admin.js"].includes(requestUrl.pathname) && !isAdminRequest(request)) {
      sendUnauthorized(response);
      return;
    }

    await serveStatic(requestUrl, response);
  } catch (error) {
    sendJson(response, 500, { error: "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Frontend served from ${FRONTEND_DIR}`);
  if (!ADMIN_PASSWORD) {
    console.log("Admin editor disabled. Set ADMIN_PASSWORD to enable /admin.html");
  }
});
