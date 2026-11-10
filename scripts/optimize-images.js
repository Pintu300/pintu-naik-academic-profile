/* Build-time image variants. Originals are retained; requires Node.js 20.9+. */
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const optimizeImages = async () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || major === 20 && minor < 9) throw new Error("Image generation requires Node.js 20.9 or newer. The local website server can still run without regenerating images.");
  const sharp = require("sharp");
  // Only decode the trusted local JPEG inputs below, never arbitrary uploads or SVG.
  const assets = path.resolve(__dirname, "../frontend/assets");
  const output = path.join(assets, "optimized");
  await fs.mkdir(output, { recursive: true });
  const files = ["Photo.jpeg", ...(await fs.readdir(assets)).filter((name) => /^(research-|profile-).*\.jpg$/.test(name))].sort();
  const manifest = {};
  let originalBytes = 0;
  let largestVariantsBytes = 0;
  for (const file of files) {
    const input = await fs.readFile(path.join(assets, file));
    const metadata = await sharp(input).metadata();
    const widths = file === "Photo.jpeg" ? [96, 320, 640] : [480, 960];
    const variants = [];
    for (const requestedWidth of widths) {
      const width = Math.min(requestedWidth, metadata.width);
      const name = `${path.parse(file).name}-${requestedWidth}.webp`;
      const { data, info } = await sharp(input).autoOrient().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
      await fs.writeFile(path.join(output, name), data);
      variants.push({ path: `assets/optimized/${name}`, width: info.width, height: info.height, bytes: data.length });
    }
    manifest[`assets/${file}`] = { sha256: createHash("sha256").update(input).digest("hex"), originalBytes: input.length, variants };
    originalBytes += input.length;
    largestVariantsBytes += variants[variants.length - 1].bytes;
  }
  await fs.writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Generated image variants: ${originalBytes} original bytes → ${largestVariantsBytes} bytes at the largest display sizes (${Math.round((1 - largestVariantsBytes / originalBytes) * 100)}% smaller).`);
};
if (require.main === module) optimizeImages().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { optimizeImages };
