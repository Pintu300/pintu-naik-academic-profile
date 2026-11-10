const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const root = path.resolve(__dirname, "..");
test("responsive images match the retained originals and are smaller at display sizes", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, "frontend/assets/optimized/manifest.json"), "utf8"));
  let originalBytes = 0;
  let displayBytes = 0;
  for (const [source, entry] of Object.entries(manifest)) {
    const original = await fs.readFile(path.join(root, "frontend", source));
    assert.equal(createHash("sha256").update(original).digest("hex"), entry.sha256);
    for (const variant of entry.variants) {
      const bytes = await fs.readFile(path.join(root, "frontend", variant.path));
      assert.equal(bytes.length, variant.bytes);
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
      assert.ok(variant.width > 0 && variant.height > 0);
    }
    originalBytes += original.length;
    displayBytes += entry.variants.at(-1).bytes;
  }
  assert.ok(displayBytes < originalBytes * 0.6, "Generated display images should materially reduce download size");
});
