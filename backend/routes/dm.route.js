// backend/routes/dm.route.js
// DMs are end-to-end encrypted client-side via tweetnacl. The server only
// stores ciphertext + nonce; it cannot read message bodies.
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet } = require("../services/feedHelpers");

function pair(a, b) { return a < b ? [a, b] : [b, a]; }

// GET /api/dm/conversations
router.get("/conversations", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const r = await db.query(
      `SELECT c.*,
              ua.id AS a_id, ua.wallet_address AS a_wallet, ua.username AS a_username, ua.display_name AS a_name, ua.pfp_url AS a_pfp, ua.dm_pubkey AS a_pk,
              ub.id AS b_id, ub.wallet_address AS b_wallet, ub.username AS b_username, ub.display_name AS b_name, ub.pfp_url AS b_pfp, ub.dm_pubkey AS b_pk,
              (SELECT COUNT(*)::int FROM feed_dms d
                WHERE d.conversation_id=c.id AND d.to_id=$1 AND d.read_at IS NULL) AS unread
         FROM feed_conversations c
         JOIN feed_users ua ON ua.id = c.participant_a
         JOIN feed_users ub ON ub.id = c.participant_b
        WHERE c.participant_a=$1 OR c.participant_b=$1
        ORDER BY c.last_message_at DESC LIMIT 100`, [me.id]);
    res.json({
      conversations: r.rows.map(c => ({
        id: c.id, lastMessageAt: c.last_message_at, unread: c.unread,
        peer: c.a_id === me.id
          ? { id: c.b_id, wallet: c.b_wallet, username: c.b_username, displayName: c.b_name, pfpUrl: c.b_pfp, dmPubkey: c.b_pk }
          : { id: c.a_id, wallet: c.a_wallet, username: c.a_username, displayName: c.a_name, pfpUrl: c.a_pfp, dmPubkey: c.a_pk },
      })),
    });
  } catch (e) { next(e); }
});

// GET /api/dm/search?q=wallet.near — look up a user to DM
router.get("/search", requireWallet, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").toLowerCase().trim();
    if (!q) return res.json({ user: null });
    const r = await db.query(
      "SELECT id, wallet_address, username, display_name, pfp_url, account_type, dm_pubkey FROM feed_users WHERE LOWER(wallet_address)=$1 OR LOWER(username)=$1 LIMIT 1",
      [q]);
    res.json({ user: r.rows[0] || null, registered: !!r.rows[0] });
  } catch (e) { next(e); }
});

// POST /api/dm/conversation  body: { peerWallet }
router.post("/conversation", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const peer = await getOrCreateUser(req.body?.peerWallet);
    if (!peer || peer.id === me.id) return res.status(400).json({ error: "invalid peer" });
    const [a, b] = pair(me.id, peer.id);
    let r = await db.query("SELECT * FROM feed_conversations WHERE participant_a=$1 AND participant_b=$2", [a, b]);
    if (!r.rows.length) {
      r = await db.query("INSERT INTO feed_conversations (participant_a, participant_b) VALUES ($1,$2) RETURNING *", [a, b]);
    }
    res.json({ conversationId: r.rows[0].id, peer: { id: peer.id, wallet: peer.wallet_address, username: peer.username, dmPubkey: peer.dm_pubkey } });
  } catch (e) { next(e); }
});

// GET /api/dm/:conversationId/messages?cursor=
router.get("/:conversationId/messages", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const cid = parseInt(req.params.conversationId);
    const conv = await db.query(
      "SELECT * FROM feed_conversations WHERE id=$1 AND (participant_a=$2 OR participant_b=$2)",
      [cid, me.id]);
    if (!conv.rows.length) return res.status(403).json({ error: "not a participant" });
    const cursor = req.query.cursor;
    const sql = cursor
      ? "SELECT * FROM feed_dms WHERE conversation_id=$1 AND created_at < $2 ORDER BY created_at DESC LIMIT 50"
      : "SELECT * FROM feed_dms WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 50";
    const params = cursor ? [cid, cursor] : [cid];
    const r = await db.query(sql, params);
    res.json({ messages: r.rows });
  } catch (e) { next(e); }
});

// POST /api/dm/send  body: { conversationId, encryptedPayload, nonce }
router.post("/send", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const { conversationId, encryptedPayload, nonce } = req.body || {};
    if (!encryptedPayload || !nonce) return res.status(400).json({ error: "encryptedPayload + nonce required" });
    const conv = await db.query("SELECT * FROM feed_conversations WHERE id=$1", [conversationId]);
    if (!conv.rows.length) return res.status(404).json({ error: "conversation not found" });
    const c = conv.rows[0];
    if (c.participant_a !== me.id && c.participant_b !== me.id) return res.status(403).json({ error: "not a participant" });
    const toId = c.participant_a === me.id ? c.participant_b : c.participant_a;
    const r = await db.query(
      `INSERT INTO feed_dms (conversation_id, from_id, to_id, encrypted_payload, nonce)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [conversationId, me.id, toId, encryptedPayload, nonce]);
    await db.query("UPDATE feed_conversations SET last_message_at=NOW() WHERE id=$1", [conversationId]);
    res.json({ message: r.rows[0] });
  } catch (e) { next(e); }
});

// POST /api/dm/:conversationId/read
router.post("/:conversationId/read", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    await db.query(
      "UPDATE feed_dms SET read_at=NOW() WHERE conversation_id=$1 AND to_id=$2 AND read_at IS NULL",
      [req.params.conversationId, me.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
