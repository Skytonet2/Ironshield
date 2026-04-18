// backend/routes/dm.route.js
// DMs are end-to-end encrypted client-side via tweetnacl. The server only
// stores ciphertext + nonce; it cannot read message bodies.
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet } = require("../services/feedHelpers");
const agent = require("../services/agentConnector");

let AccessToken;
try { ({ AccessToken } = require("livekit-server-sdk")); } catch { AccessToken = null; }

function pair(a, b) { return a < b ? [a, b] : [b, a]; }
function dmCallRoomName(conversationId) { return `ironclaw-dm-${conversationId}`; }

async function assertGroupMember(groupId, userId) {
  const r = await db.query(
    "SELECT 1 FROM feed_group_chat_members WHERE group_id=$1 AND user_id=$2 LIMIT 1",
    [groupId, userId]
  );
  return !!r.rows.length;
}

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

// POST /api/dm/assistant  body: { message }
router.post("/assistant", requireWallet, async (req, res, next) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message required" });
    const reply = await agent.personalAssistant({ wallet: req.wallet, message });
    res.json({
      reply,
      assistant: {
        id: "ironclaw-assistant",
        wallet: "ironclaw.ai",
        username: "ironclaw_ai",
        displayName: "IronClaw AI",
      },
    });
  } catch (e) { next(e); }
});

// GET /api/dm/groups
router.get("/groups", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const r = await db.query(
      `SELECT g.id, g.name, g.last_message_at,
              COUNT(m.user_id)::int AS member_count
         FROM feed_group_chats g
         JOIN feed_group_chat_members mm ON mm.group_id = g.id AND mm.user_id = $1
         JOIN feed_group_chat_members m ON m.group_id = g.id
        GROUP BY g.id
        ORDER BY g.last_message_at DESC
        LIMIT 100`,
      [me.id]
    );
    res.json({ groups: r.rows.map(x => ({ id: x.id, name: x.name, memberCount: x.member_count, kind: "group" })) });
  } catch (e) { next(e); }
});

// POST /api/dm/groups  body: { name, members: [walletOrUsername] }
router.post("/groups", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const name = String(req.body?.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "name required" });
    const memberInputs = Array.isArray(req.body?.members) ? req.body.members : [];
    const resolvedIds = new Set([me.id]);
    for (const entry of memberInputs.slice(0, 24)) {
      const q = String(entry || "").toLowerCase().trim();
      if (!q) continue;
      const u = await db.query(
        "SELECT id FROM feed_users WHERE LOWER(wallet_address)=$1 OR LOWER(username)=$1 LIMIT 1",
        [q]
      );
      if (u.rows[0]?.id) resolvedIds.add(u.rows[0].id);
    }
    const group = await db.query(
      "INSERT INTO feed_group_chats (name, created_by) VALUES ($1, $2) RETURNING *",
      [name, me.id]
    );
    const gid = group.rows[0].id;
    for (const uid of resolvedIds) {
      await db.query(
        "INSERT INTO feed_group_chat_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT (group_id, user_id) DO NOTHING",
        [gid, uid]
      );
    }
    res.json({ group: { id: gid, name, memberCount: resolvedIds.size, kind: "group" } });
  } catch (e) { next(e); }
});

// GET /api/dm/groups/:groupId/messages
router.get("/groups/:groupId/messages", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const gid = parseInt(req.params.groupId, 10);
    if (!Number.isFinite(gid)) return res.status(400).json({ error: "invalid group id" });
    if (!(await assertGroupMember(gid, me.id))) return res.status(403).json({ error: "not a group member" });
    const r = await db.query(
      `SELECT gm.id, gm.content, gm.created_at,
              u.wallet_address AS from_wallet, COALESCE(u.display_name, u.username, u.wallet_address) AS from_display
         FROM feed_group_messages gm
         JOIN feed_users u ON u.id = gm.from_id
        WHERE gm.group_id = $1
        ORDER BY gm.created_at ASC
        LIMIT 300`,
      [gid]
    );
    res.json({ messages: r.rows });
  } catch (e) { next(e); }
});

// POST /api/dm/groups/:groupId/send  body: { content }
router.post("/groups/:groupId/send", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const gid = parseInt(req.params.groupId, 10);
    const content = String(req.body?.content || "").trim();
    if (!Number.isFinite(gid)) return res.status(400).json({ error: "invalid group id" });
    if (!content) return res.status(400).json({ error: "content required" });
    if (!(await assertGroupMember(gid, me.id))) return res.status(403).json({ error: "not a group member" });
    const r = await db.query(
      `INSERT INTO feed_group_messages (group_id, from_id, content)
       VALUES ($1,$2,$3)
       RETURNING id, content, created_at`,
      [gid, me.id, content.slice(0, 4000)]
    );
    await db.query("UPDATE feed_group_chats SET last_message_at=NOW() WHERE id=$1", [gid]);
    res.json({
      message: {
        ...r.rows[0],
        from_wallet: me.wallet_address,
        from_display: me.display_name || me.username || me.wallet_address,
      },
    });
  } catch (e) { next(e); }
});

// POST /api/dm/:conversationId/call-token
router.post("/:conversationId/call-token", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const cid = parseInt(req.params.conversationId, 10);
    if (!Number.isFinite(cid)) return res.status(400).json({ error: "invalid conversation id" });

    const conv = await db.query(
      `SELECT c.*,
              ua.id AS a_id, ua.wallet_address AS a_wallet, ua.username AS a_username, ua.display_name AS a_name, ua.pfp_url AS a_pfp,
              ub.id AS b_id, ub.wallet_address AS b_wallet, ub.username AS b_username, ub.display_name AS b_name, ub.pfp_url AS b_pfp
         FROM feed_conversations c
         JOIN feed_users ua ON ua.id = c.participant_a
         JOIN feed_users ub ON ub.id = c.participant_b
        WHERE c.id=$1 AND (c.participant_a=$2 OR c.participant_b=$2)`,
      [cid, me.id]
    );
    if (!conv.rows.length) return res.status(403).json({ error: "not a participant" });

    const row = conv.rows[0];
    const peer = row.a_id === me.id
      ? { id: row.b_id, wallet: row.b_wallet, username: row.b_username, displayName: row.b_name, pfpUrl: row.b_pfp }
      : { id: row.a_id, wallet: row.a_wallet, username: row.a_username, displayName: row.a_name, pfpUrl: row.a_pfp };

    const url = process.env.LIVEKIT_URL || "";
    const apiKey = process.env.LIVEKIT_API_KEY || "";
    const apiSecret = process.env.LIVEKIT_API_SECRET || "";
    const roomName = dmCallRoomName(cid);

    if (!apiKey || !apiSecret || !url || !AccessToken) {
      return res.json({
        token: null,
        url: null,
        roomName,
        identity: me.wallet_address,
        peer,
        mocked: true,
      });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: me.wallet_address,
      name: me.display_name || me.username || me.wallet_address,
      ttl: 60 * 60 * 2,
    });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    });

    res.json({
      token: await at.toJwt(),
      url,
      roomName,
      identity: me.wallet_address,
      peer,
      mocked: false,
    });
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

    // Fire-and-forget push to the recipient. DMs are E2E encrypted, so the
    // server cannot read the text — we send a generic "New message" with a
    // deep link to the thread. Call invites get a dedicated high-urgency push.
    try {
      const { notifyUser } = require("../services/pushNotify");
      const actor = await db.query("SELECT display_name, username FROM feed_users WHERE id=$1", [me.id]);
      const name = actor.rows[0]?.display_name || actor.rows[0]?.username || "Someone";
      // Heuristic: the encrypted payload starts with a known prefix for call
      // invites (buildDmCallInvite wraps as IX_CALL_INVITE:<json>). Since it's
      // encrypted we can't detect that server-side — frontend signals via a
      // separate `type` field when it's a call.
      const isCall = req.body?.type === "call_invite";
      if (isCall) {
        notifyUser(toId, {
          title: `${name} is calling`,
          body: "Tap to answer",
          url: `/#/Feed?dm=${conversationId}&call=incoming`,
          tag: `call-${conversationId}`,
          actions: [
            { action: "answer", title: "Answer" },
            { action: "decline", title: "Decline" },
          ],
          kind: "call",
          conversationId,
        }).catch(() => {});
      } else {
        notifyUser(toId, {
          title: `${name}`,
          body: "New message",
          url: `/#/Feed?dm=${conversationId}`,
          tag: `dm-${conversationId}`,
        }).catch(() => {});
      }

      // Telegram side-channel for DMs. For non-call DMs we map the TG
      // message_id back to the conversation so the user can reply in
      // Telegram and have their reply posted into the site thread.
      try {
        const tg = require("../services/tgNotify");
        const text = isCall
          ? `📞 *${name}* is calling you\nOpen IronShield to answer.`
          : `💬 *${name}* sent you a DM\n_Reply here to respond on-site._\n[Open thread](https://ironshield.near.page/#/Feed?dm=${conversationId})`;
        tg.notifyFeedUser(toId, "dms", text, {
          replyMapConversationId: isCall ? null : conversationId,
        }).catch(() => {});
      } catch { /* optional */ }
    } catch (_) { /* push is best-effort */ }

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
