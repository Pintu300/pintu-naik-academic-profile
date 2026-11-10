const pages = {
  "index.html": "Academic Profile",
  "research.html": "Research",
  "publications.html": "Publications",
  "projects.html": "Projects",
  "teaching.html": "Teaching",
  "achievements.html": "Achievements",
  "education.html": "Education",
  "cv.html": "Academic CV"
};
const escapeAttribute = (text) => String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const publicBase = (value) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("The public site URL must be an HTTPS URL without credentials, query, or fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
};
const pageUrl = (base, filename) => new URL(filename === "index.html" ? "./" : filename, base).href;
const injectMetadata = (html, filename, profile, base) => {
  const url = pageUrl(base, filename);
  const title = `${profile.name} | ${pages[filename]}`;
  const descriptions = {
    "index.html": profile.summary || `Academic profile of ${profile.name}.`,
    "research.html": `Research interests and current directions of ${profile.name}.`,
    "publications.html": `Publications, accepted papers, and submissions by ${profile.name}.`,
    "projects.html": `Research and software projects by ${profile.name}.`,
    "teaching.html": `Teaching and mentoring experience of ${profile.name}.`,
    "achievements.html": `Academic achievements, university memories, and photographs of ${profile.name}.`,
    "education.html": `Academic background and qualifications of ${profile.name}.`,
    "cv.html": `Academic CV, research, publications, and experience of ${profile.name}.`
  };
  const description = escapeAttribute(descriptions[filename]);
  const photo = typeof profile.photo === "string" && /^assets\/[A-Za-z0-9._/-]+$/.test(profile.photo)
    && !profile.photo.split("/").includes("..") ? profile.photo : "assets/Photo.jpeg";
  const image = new URL(photo, base).href;
  const tags = [
    `    <link rel="canonical" href="${escapeAttribute(url)}" />`,
    '    <link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />',
    `    <meta property="og:type" content="website" />`,
    `    <meta property="og:site_name" content="${escapeAttribute(profile.name)}" />`,
    `    <meta property="og:title" content="${escapeAttribute(title)}" />`,
    `    <meta property="og:description" content="${description}" />`,
    `    <meta property="og:url" content="${escapeAttribute(url)}" />`,
    `    <meta property="og:image" content="${escapeAttribute(image)}" />`,
    `    <meta property="og:image:alt" content="Portrait of ${escapeAttribute(profile.name)}" />`,
    '    <meta name="twitter:card" content="summary" />',
    `    <meta name="twitter:title" content="${escapeAttribute(title)}" />`,
    `    <meta name="twitter:description" content="${description}" />`,
    `    <meta name="twitter:image" content="${escapeAttribute(image)}" />`
  ].join("\n");
  return html.replace(/\n\s*<!-- Site metadata -->[\s\S]*?<!-- End site metadata -->\n?/g, "\n")
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/>/s, `<meta name="description" content="${description}" />`)
    .replace(/<title>.*?<\/title>/s, `<title>${escapeAttribute(title)}</title>`)
    .replace("  </head>", `    <!-- Site metadata -->\n${tags}\n    <!-- End site metadata -->\n  </head>`);
};
module.exports = { pages, publicBase, pageUrl, injectMetadata, escapeAttribute };
