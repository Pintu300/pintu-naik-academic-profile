const { createHash } = require("node:crypto");
const revision = (data) => `"${createHash("sha256").update(JSON.stringify(data)).digest("hex")}"`;

const createContentStore = (pool) => ({
  async load() {
    const { rows } = await pool.query("SELECT document FROM portfolio.site_content WHERE id=1");
    if (!rows.length) throw new Error("PostgreSQL content is not initialized. Run npm run db:import.");
    return rows[0].document;
  },
  async import(data) {
    const result = await pool.query("INSERT INTO portfolio.site_content(id,document) VALUES (1,$1::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id", [JSON.stringify(data)]);
    return result.rowCount === 1;
  },
  async save(data, expectedRevision, backup) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT document FROM portfolio.site_content WHERE id=1 FOR UPDATE");
      if (!rows.length) throw new Error("PostgreSQL content is not initialized.");
      if (revision(rows[0].document) !== expectedRevision) {
        const error = new Error("Content changed since you opened the editor. Download your draft, then reload the saved content and apply your edits again.");
        error.statusCode = 412;
        throw error;
      }
      await backup(rows[0].document);
      const result = await client.query("UPDATE portfolio.site_content SET document=$1::jsonb, updated_at=CURRENT_TIMESTAMP WHERE id=1 RETURNING document", [JSON.stringify(data)]);
      await client.query("COMMIT");
      return revision(result.rows[0].document);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }
});
module.exports = { createContentStore };
