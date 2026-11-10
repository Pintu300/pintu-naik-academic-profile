/* Read-only checks against the configured public site and DOI registration metadata. */
const fs = require("node:fs/promises");
const path = require("node:path");
const { publicBase } = require("./site-metadata");
const root = path.resolve(__dirname, "..");
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
const run = async () => {
  const config = JSON.parse(await fs.readFile(path.join(root, "site.config.json"), "utf8"));
  const base = publicBase(config.publicUrl);
  const publications = JSON.parse(await fs.readFile(path.join(root, "backend/data/publications.json"), "utf8"));
  const report = { checkedAt: new Date().toISOString(), publicUrl: base.href, deployment: [], publications: [] };
  for (const url of [base.href, base.href.replace(/^https:/, "http:"), ...["admin.html", "login.html", "sitemap.xml", "robots.txt"].map((file) => new URL(file, base).href)]) {
    try {
      const response = await request(url, { method: "HEAD", redirect: "manual" });
      report.deployment.push({ url, status: response.status, location: response.headers.get("location"), hsts: response.headers.get("strict-transport-security"), contentType: response.headers.get("content-type") });
    } catch (error) { report.deployment.push({ url, error: error.message }); }
  }
  for (const publication of publications) {
    const row = { title: publication.title, localYear: publication.year, status: publication.status || "Published", doi: publication.doi || null };
    if (publication.doi) {
      const doi = publication.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
      const endpoint = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
      row.metadataSource = endpoint;
      try {
        const response = await request(endpoint, { headers: { Accept: "application/json" } });
        row.lookupStatus = response.status;
        if (response.ok) {
          const record = (await response.json()).message;
          row.registeredTitle = record.title?.[0];
          row.registeredAuthors = record.author?.map((person) => [person.given, person.family].filter(Boolean).join(" "));
          row.registeredDates = Object.fromEntries(["published", "published-print", "published-online", "issued"].filter((name) => record[name]).map((name) => [name, record[name]["date-parts"]]));
          row.titleMatches = row.registeredTitle?.toLowerCase().replace(/[^a-z0-9]/g, "") === publication.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        }
      } catch (error) { row.error = error.message; }
    } else row.note = "No DOI supplied. Acceptance/submission status remains owner-provided and unchanged.";
    report.publications.push(row);
  }
  const directory = path.join(root, "artifacts");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "public-audit.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
};
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
