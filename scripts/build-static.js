const fs = require("node:fs/promises");
const path = require("node:path");
const { pages, publicBase, pageUrl, injectMetadata, escapeAttribute } = require("./site-metadata");
const { isSensitivePath, isPublicAsset } = require("../backend/public-files");
const root = path.resolve(__dirname, "..");

const buildStatic = async ({ outputDirectory = path.join(root, "dist"), frontendDirectory = path.join(root, "frontend"), siteUrl } = {}) => {
  const config = JSON.parse(await fs.readFile(path.join(root, "site.config.json"), "utf8"));
  const base = publicBase(siteUrl || process.env.SITE_URL || config.publicUrl);
  const profile = JSON.parse(await fs.readFile(path.join(root, "backend/data/profile.json"), "utf8"));
  const dataFiles = ["profile", "research", "updates", "publications", "projects", "achievements", "education", "skills", "teaching"];
  // Validate the input before replacing the previous build.
  const { validateSiteData } = require("../backend/server");
  const data = Object.fromEntries(await Promise.all(dataFiles.map(async (name) => [
    name, JSON.parse(await fs.readFile(path.join(root, "backend/data", `${name}.json`), "utf8"))
  ])));
  const error = validateSiteData(data);
  if (error) throw new Error(`Cannot build invalid content: ${error}`);
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDirectory, "data"), { recursive: true });
  for (const filename of Object.keys(pages)) {
    const html = await fs.readFile(path.join(frontendDirectory, filename), "utf8");
    await fs.writeFile(path.join(outputDirectory, filename), injectMetadata(html, filename, profile, base));
  }
  for (const name of ["styles.css", "catalog.js", "catalog-ui.js", "script.js", "analytics.js", "visitor-stats.js", "assets"]) {
    await fs.cp(path.join(frontendDirectory, name), path.join(outputDirectory, name), {
      recursive: true,
      filter: async (source) => {
        const stat = await fs.lstat(source);
        if (stat.isSymbolicLink()) throw new Error("Static assets must not contain symlinks.");
        const relative = path.relative(frontendDirectory, source);
        if (path.basename(source).startsWith(".") || isSensitivePath(relative)) return false;
        return stat.isDirectory() || name !== "assets" || isPublicAsset(relative);
      }
    });
  }
  await Promise.all(dataFiles.map((name) => fs.writeFile(path.join(outputDirectory, "data", `${name}.json`), `${JSON.stringify(data[name], null, 2)}\n`)));
  const urls = Object.keys(pages).map((name) => `  <url><loc>${escapeAttribute(pageUrl(base, name))}</loc></url>`).join("\n");
  await fs.writeFile(path.join(outputDirectory, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  await fs.writeFile(path.join(outputDirectory, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", base).href}\n`);
  await fs.writeFile(path.join(outputDirectory, ".nojekyll"), "");
  console.log(`Static website built in ${outputDirectory}`);
  return { outputDirectory, publicUrl: base.href };
};
if (require.main === module) buildStatic().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildStatic };
