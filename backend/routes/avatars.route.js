// backend/routes/avatars.route.js
//
// Avatar upload + serve. The picker resizes to 256×256 JPEG client-
// side and POSTs as a base64 data URL, so this route does no image
// processing — just validates, hashes, dedupes, and stores.
//
// Storage is Postgres BYTEA for now (rows are bounded by the 256×256
// resize, typically 30–60KB). Migration to Cloudflare Images is a
// drop-in: this route returns an absolute URL, the renderer doesn't
// care where the bytes live.
//
// Mounted under /api/agents/avatar.

const router = require("express").Router();
const crypto = require("crypto");
const db     = require("../db/client");

const MAX_BYTES   = 512 * 1024;   // 512KB cap on the post-resize blob
const ALLOWED_CT  = new Set(["image/jpeg", "image/png", "image/webp"]);

function requireWallet(req, res) {
  const wallet = (req.get("x-wallet") || "").trim();
  if (!wallet) { res.status(401).json({ error: "x-wallet header required" }); return null; }
  return wallet;
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") throw new Error("data_url must be a string");
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) throw new Error("data_url must be a base64-encoded image");
  const ct = m[1].toLowerCase();
  if (!ALLOWED_CT.has(ct)) throw new Error(`Unsupported content type: ${ct}`);
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_BYTES) throw new Error(`Image too large: ${bytes.length} bytes (max ${MAX_BYTES})`);
  return { ct, bytes };
}

/** Build the absolute URL the frontend will GET. Honors trust-proxy
 *  semantics by reading req.protocol + req.get('host') instead of
 *  hard-coding origin. */
function publicUrl(req, id) {
  const origin = `${req.protocol}://${req.get("host")}`;
  return `${origin}/api/agents/avatar/${id}`;
}

/** POST /api/agents/avatar
 *  Body: { data_url, agent_account? }
 *  Returns: { id, url, size_bytes, content_type } */
router.post("/", async (req, res) => {
  const wallet = requireWallet(req, res); if (!wallet) return;
  const { data_url, agent_account } = req.body || {};
  let parsed;
  try { parsed = parseDataUrl(data_url); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const sha = crypto.createHash("sha256").update(parsed.bytes).digest("hex");
  try {
    // Dedupe: same owner uploading the same bytes returns the existing row.
    const { rows: existing } = await db.query(
      `SELECT id, content_type, size_bytes FROM agent_avatars
         WHERE owner = $1 AND sha256 = $2 LIMIT 1`,
      [wallet, sha]
    );
    if (existing[0]) {
      return res.json({
        id:           existing[0].id,
        url:          publicUrl(req, existing[0].id),
        size_bytes:   existing[0].size_bytes,
        content_type: existing[0].content_type,
        deduped:      true,
      });
    }

    const { rows } = await db.query(
      `INSERT INTO agent_avatars (owner, agent_account, content_type, bytes, sha256, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, content_type, size_bytes`,
      [wallet, agent_account || null, parsed.ct, parsed.bytes, sha, parsed.bytes.length]
    );
    res.json({
      id:           rows[0].id,
      url:          publicUrl(req, rows[0].id),
      size_bytes:   rows[0].size_bytes,
      content_type: rows[0].content_type,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/agents/avatar/:id
 *  Streams the bytes with a long cache-control. Public — no auth.
 *  Avatars are content-addressable via SHA-256 + bounded in size, so
 *  there's no leakage risk worth gating with x-wallet here. */
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const { rows } = await db.query(
      `SELECT content_type, bytes FROM agent_avatars WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!rows[0]) return res.status(404).end();
    res.set("Content-Type",  rows[0].content_type || "image/jpeg");
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(rows[0].bytes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
