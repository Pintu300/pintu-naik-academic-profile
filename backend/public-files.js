const path = require("node:path");

const publicFiles = new Set([
  "index.html", "research.html", "publications.html", "projects.html",
  "teaching.html", "achievements.html", "education.html", "cv.html",
  "admin.html", "login.html", "styles.css", "script.js", "catalog.js",
  "catalog-ui.js", "analytics.js", "visitor-stats.js", "admin.js",
  "login.js", "editor-model.js"
]);
const assetExtensions = new Set([".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp", ".pdf", ".woff", ".woff2", ".ttf", ".otf"]);

const isSensitivePath = (filename) => filename.replaceAll("\\", "/").split("/").some((part) =>
  /^\.env(?:\.|$)/i.test(part) && part !== ".env.example"
  || /^\.dev\.vars(?:\.|$)/i.test(part)
  || /\.(?:pem|key|p12|pfx|keystore|kdbx|bak|sql|pgdump|dump)$/i.test(part)
  || /\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$/i.test(part)
  || part.toLowerCase() === "private"
  || /(?:^|[._-])(?:secrets?|credentials?|service[-_]?accounts?|backups?|drafts?)(?:[._-]|$)/i.test(part)
);

const isPublicAsset = (filename) => {
  const relative = filename.replaceAll("\\", "/");
  if (!relative.startsWith("assets/") || isSensitivePath(relative)
    || relative.split("/").some((part) => !part || part.startsWith("."))) return false;
  return relative === "assets/optimized/manifest.json" || assetExtensions.has(path.posix.extname(relative).toLowerCase());
};

module.exports = { isSensitivePath, isPublicAsset, publicFiles };
