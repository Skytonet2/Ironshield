// backend/routes/channels.route.js
//
// CRUD for agent channels (Telegram / Discord / custom HTTP webhooks).
// This route persists credentials encrypted at rest so an owner can
// register their bot tokens once, but it does NOT yet run a relay
// loop — channel relays are tracked as a follow-up. The dashboard
// surfaces "pending" status to be honest about that until the
// runtime ships.
//
// Mounted under /api/agents/channels.

const router = require("express").Router();
const db     = require("../db/client");
const store  = require("../services/agents/connectionStore");

const SUPPORTED_CHANNELS = new Set(["telegram", "discord", "http"]);

function requireWallet(req, res) {
  const w = (req.get("x-wallet") || "").trim();
  if (!w) { res.status(401).json({ error: "x-wallet header required" }); return null; }
  return w;
}

/** Strip the encrypted blob before returning a row. */
function publicRow(row) {
  if (!row) return null;
  const { config_encrypted, ...rest } = row;
  return { ...rest, has_config: Boolean(config_encrypted) };
}

/** GET /api/agents/channels/:agent_account
 *  Public list of channels for one agent. Sanitised. */
router.get("/:agent_account", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM agent_channels WHERE agent_account = $1 ORDER BY created_at DESC`,
      [req.params.agent_account]
    );
    res.json({ channels: rows.map(publicRow) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/agents/channels
 *  Body: { agent_account, channel, label?, config }
 *  `config` is a free-form JSON object (bot_token, chat_id, webhook_url, ...).
 *  We encrypt it via the same AES-256-GCM scheme the connection store uses. */
router.post("/", async (req, res) => {
  const wallet = requireWallet(req, res); if (!wallet) return;
  const { agent_account, channel, label, config } = req.body || {};
  if (!agent_account || !channel || !config) {
    return res.status(400).json({ error: "agent_account, channel, config required" });
  }
  if (!SUPPORTED_CHANNELS.has(channel)) {
    return res.status(400).json({ error: `Unsupported channel: ${channel}` });
  }
  if (typeof config !== "object") {
    return res.status(400).json({ error: "config must be an object" });
  }
  const blob = JSON.stringify(config);
  if (blob.length > 4096) {
    return res.status(413).json({ error: "config payload > 4KB" });
  }
  try {
    const encrypted = store.encrypt(blob);
    const { rows } = await db.query(
      `INSERT INTO agent_channels
         (owner, agent_account, channel, label, config_encrypted, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [wallet, agent_account, channel, label || null, encrypted]
    );
    res.json({ channel: publicRow(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/agents/channels/:id
 *  Body: { label?, status?, config? }
 *  Only the row owner can patch. config is opt-in; if omitted, the
 *  encrypted blob is left intact (prevents accidental wipes). */
router.patch("/:id", async (req, res) => {
  const wallet = requireWallet(req, res); if (!wallet) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const cols = ["updated_at = NOW()"];
  const params = [id, wallet];
  let i = 2;

  if (req.body?.label !== undefined) { cols.push(`label = $${++i}`); params.push(req.body.label); }
  if (req.body?.status !== undefined) {
    const s = String(req.body.status);
    if (!["pending", "active", "disabled"].includes(s)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    cols.push(`status = $${++i}`); params.push(s);
  }
  if (req.body?.config !== undefined) {
    if (typeof req.body.config !== "object") return res.status(400).json({ error: "config must be an object" });
    const blob = JSON.stringify(req.body.config);
    if (blob.length > 4096) return res.status(413).json({ error: "config payload > 4KB" });
    cols.push(`config_encrypted = $${++i}`); params.push(store.encrypt(blob));
  }

  try {
    const { rows } = await db.query(
      `UPDATE agent_channels SET ${cols.join(", ")}
         WHERE id = $1 AND owner = $2 RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ channel: publicRow(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/agents/channels/:id */
router.delete("/:id", async (req, res) => {
  const wallet = requireWallet(req, res); if (!wallet) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const { rowCount } = await db.query(
      `DELETE FROM agent_channels WHERE id = $1 AND owner = $2`,
      [id, wallet]
    );
    res.json({ ok: rowCount > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
