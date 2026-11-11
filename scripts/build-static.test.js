const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { buildStatic } = require("./build-static");
const { pages, publicBase, injectMetadata } = require("./site-metadata");

test("static build includes public pages and data, excludes admin tools, and uses the configured base path", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-static-"));
  try {
    await buildStatic({ outputDirectory: temporary, siteUrl: "https://example.com/academic/" });
    for (const filename of Object.keys(pages)) {
      const html = await fs.readFile(path.join(temporary, filename), "utf8");
      assert.match(html, /rel="canonical" href="https:\/\/example.com\/academic\//);
      assert.equal((html.match(/property="og:title"/g) || []).length, 1);
      for (const match of html.matchAll(/(?:src|href)="((?:assets\/|[^"/:]+\.html)[^"]*)"/g)) {
        await fs.access(path.join(temporary, match[1].split("#")[0]));
      }
    }
    for (const filename of ["admin.html", "admin.js", "login.html", "login.js", "recovery.html", "recovery.js", "editor-model.js", "script.test.js", "editor-model.test.js"]) {
      await assert.rejects(fs.access(path.join(temporary, filename)), { code: "ENOENT" });
    }
    const sitemap = await fs.readFile(path.join(temporary, "sitemap.xml"), "utf8");
    assert.equal((sitemap.match(/<url>/g) || []).length, 8);
    assert.ok(!sitemap.includes("admin"));
    assert.match(await fs.readFile(path.join(temporary, "robots.txt"), "utf8"), /Sitemap: https:\/\/example.com\/academic\/sitemap.xml/);
    await fs.access(path.join(temporary, "data/profile.json"));
    await fs.access(path.join(temporary, "assets/favicon.svg"));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("metadata generation is repeatable and rejects insecure public URL configuration", () => {
  const profile = { name: 'Name <script>', photo: "assets/Photo.jpeg" };
  const base = publicBase("https://example.com/profile");
  const html = '<head><title>Title</title>\n  </head>';
  const once = injectMetadata(html, "index.html", profile, base);
  const twice = injectMetadata(once, "index.html", profile, base);
  assert.equal((twice.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(!twice.includes("Name <script>"));
  assert.ok(twice.includes("https://example.com/profile/"));
  assert.throws(() => publicBase("http://example.com"));
  assert.throws(() => publicBase("https://user:password@example.com"));
});

test("static publication excludes private files even when placed in frontend assets", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "academic-private-assets-"));
  try {
    const frontendDirectory = path.join(temporary, "frontend");
    const outputDirectory = path.join(temporary, "public");
    await fs.cp(path.join(__dirname, "../frontend"), frontendDirectory, { recursive: true });
    const privateNames = [".env", "credentials.json", "service-account.json", "academic-site-backup-today.json", "backup-notes.pdf", "signing.pfx", "extra.json", "website.sqlite", "website.sqlite-wal", "website.sqlite3-shm", "website.db-journal", "website.pgdump", "website.dump"];
    for (const name of privateNames) await fs.writeFile(path.join(frontendDirectory, "assets", name), "Synthetic private fixture");
    await buildStatic({ outputDirectory, frontendDirectory });
    for (const name of privateNames) await assert.rejects(fs.access(path.join(outputDirectory, "assets", name)), { code: "ENOENT" });
    await fs.access(path.join(outputDirectory, "assets", "Photo.jpeg"));
    await fs.access(path.join(outputDirectory, "assets", "optimized", "manifest.json"));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
