// backend/routes/dm.route.js
// DMs are end-to-end encrypted client-side via tweetnacl. The server only
// stores ciphertext + nonce; it cannot read message bodies.
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");
const agent = require("../services/agentConnector");
const feedHub = require("../ws/feedHub");

// Group @handle rules: 3–24 chars, lowercase letters/digits/underscore.
const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
function normalizeHandle(raw) {
  const h = String(raw || "").trim().toLowerCase().replace(/^@/, "");
  return h;
}
function newInviteToken() {
  // 128-bit url-safe token. Base64url w/o padding.
  return crypto.randomBytes(16).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

// GET /api/dm/conversations — unsigned read (identity from x-wallet
// header). Mutating sends/reads-receipts/etc still go through
// requireWallet below.
router.get("/conversations", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.json({ conversations: [] });
    const me = await getOrCreateUser(wallet);
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

// GET /api/dm/search?q=wallet.near — look up a user to DM. Unsigned: x-wallet
// only required to gate to logged-in viewers; we don't read from req.wallet.
router.get("/search", async (req, res, next) => {
  try {
    if (!req.header("x-wallet")) return res.json({ user: null });
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

// GET /api/dm/groups — unsigned read.
router.get("/groups", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.json({ groups: [] });
    const me = await getOrCreateUser(wallet);
    const r = await db.query(
      `SELECT g.id, g.name, g.handle, g.pfp_url, g.invite_token, g.created_by,
              g.last_message_at,
              COUNT(m.user_id)::int AS member_count
         FROM feed_group_chats g
         JOIN feed_group_chat_members mm ON mm.group_id = g.id AND mm.user_id = $1
         JOIN feed_group_chat_members m ON m.group_id = g.id
        GROUP BY g.id
        ORDER BY g.last_message_at DESC
        LIMIT 100`,
      [me.id]
    );
    res.json({
      groups: r.rows.map(x => ({
        id: x.id,
        name: x.name,
        handle: x.handle,
        pfpUrl: x.pfp_url,
        inviteToken: x.created_by === me.id ? x.invite_token : null,
        isOwner: x.created_by === me.id,
        memberCount: x.member_count,
        kind: "group",
      })),
    });
  } catch (e) { next(e); }
});

// GET /api/dm/groups/:groupId — detail (members, owner-only invite token).
// Unsigned read: identity from x-wallet; the membership check below is the
// real gate against viewing a group you're not in.
router.get("/groups/:groupId", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "x-wallet header required" });
    const me = await getOrCreateUser(wallet);
    const gid = parseInt(req.params.groupId, 10);
    if (!Number.isFinite(gid)) return res.status(400).json({ error: "invalid group id" });
    if (!(await assertGroupMember(gid, me.id))) return res.status(403).json({ error: "not a group member" });
    const g = await db.query(
      `SELECT g.id, g.name, g.handle, g.pfp_url, g.invite_token, g.created_by, g.last_message_at
         FROM feed_group_chats g WHERE g.id = $1`,
      [gid]
    );
    if (!g.rows.length) return res.status(404).json({ error: "group not found" });
    const row = g.rows[0];
    const members = await db.query(
      `SELECT u.id, u.wallet_address, u.username, u.display_name, u.pfp_url
         FROM feed_group_chat_members m
         JOIN feed_users u ON u.id = m.user_id
        WHERE m.group_id = $1`,
      [gid]
    );
    const isOwner = row.created_by === me.id;
    res.json({
      group: {
        id: row.id,
        name: row.name,
        handle: row.handle,
        pfpUrl: row.pfp_url,
        inviteToken: isOwner ? row.invite_token : null,
        isOwner,
        createdBy: row.created_by,
        memberCount: members.rows.length,
        members: members.rows.map(u => ({
          id: u.id, wallet: u.wallet_address, username: u.username,
          displayName: u.display_name, pfpUrl: u.pfp_url,
        })),
        kind: "group",
      },
    });
  } catch (e) { next(e); }
});

// POST /api/dm/groups  body: { name, handle?, pfpUrl?, members: [walletOrUsername] }
router.post("/groups", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const name = String(req.body?.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "name required" });

    let handle = null;
    const handleRaw = req.body?.handle;
    if (handleRaw != null && String(handleRaw).trim() !== "") {
      handle = normalizeHandle(handleRaw);
      if (!HANDLE_RE.test(handle)) {
        return res.status(400).json({ error: "handle must be 3-24 chars, a-z 0-9 _" });
      }
      const clash = await db.query("SELECT 1 FROM feed_group_chats WHERE LOWER(handle)=$1 LIMIT 1", [handle]);
      if (clash.rows.length) return res.status(409).json({ error: "handle taken" });
    }

    const pfpUrl = req.body?.pfpUrl ? String(req.body.pfpUrl).slice(0, 500) : null;
    const inviteToken = newInviteToken();

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
      `INSERT INTO feed_group_chats (name, created_by, handle, pfp_url, invite_token)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, me.id, handle, pfpUrl, inviteToken]
    );
    const gid = group.rows[0].id;
    for (const uid of resolvedIds) {
      await db.query(
        "INSERT INTO feed_group_chat_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT (group_id, user_id) DO NOTHING",
        [gid, uid]
      );
    }
    res.json({
      group: {
        id: gid, name, handle, pfpUrl,
        inviteToken, isOwner: true,
        memberCount: resolvedIds.size, kind: "group",
      },
    });
  } catch (e) { next(e); }
});

// PATCH /api/dm/groups/:groupId  body: { name?, handle?, pfpUrl? } — owner only
router.patch("/groups/:groupId", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const gid = parseInt(req.params.groupId, 10);
    if (!Number.isFinite(gid)) return res.status(400).json({ error: "invalid group id" });
    const g = await db.query("SELECT created_by FROM feed_group_chats WHERE id=$1", [gid]);
    if (!g.rows.length) return res.status(404).json({ error: "group not found" });
    if (g.rows[0].created_by !== me.id) return res.status(403).json({ error: "only the owner can edit" });

    const patch = {};
    if (req.body?.name != null) {
      const n = String(req.body.name).trim().slice(0, 80);
      if (!n) return res.status(400).json({ error: "name required" });
      patch.name = n;
    }
    if (req.body?.pfpUrl !== undefined) {
      patch.pfp_url = req.body.pfpUrl ? String(req.body.pfpUrl).slice(0, 500) : null;
    }
    if (req.body?.handle !== undefined) {
      if (req.body.handle === null || String(req.body.handle).trim() === "") {
        patch.handle = null;
      } else {
        const h = normalizeHandle(req.body.handle);
        if (!HANDLE_RE.test(h)) return res.status(400).json({ error: "handle must be 3-24 chars, a-z 0-9 _" });
        const clash = await db.query(
          "SELECT 1 FROM feed_group_chats WHERE LOWER(handle)=$1 AND id<>$2 LIMIT 1",
          [h, gid]
        );
        if (clash.rows.length) return res.status(409).json({ error: "handle taken" });
        patch.handle = h;
      }
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "no changes" });

    const fields = Object.keys(patch);
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
    const values = [gid, ...fields.map(f => patch[f])];
    const r = await db.query(
      `UPDATE feed_group_chats SET ${sets} WHERE id=$1
       RETURNING id, name, handle, pfp_url, invite_token, created_by`,
      values
    );
    const row = r.rows[0];
    res.json({
      group: {
        id: row.id, name: row.name, handle: row.handle, pfpUrl: row.pfp_url,
        inviteToken: row.invite_token, isOwner: true, kind: "group",
      },
    });
  } catch (e) { next(e); }
});

// POST /api/dm/groups/:groupId/invite — rotate + fetch invite token (owner only)
router.post("/groups/:groupId/invite", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const gid = parseInt(req.params.groupId, 10);
    if (!Number.isFinite(gid)) return res.status(400).json({ error: "invalid group id" });
    const g = await db.query("SELECT created_by, invite_token FROM feed_group_chats WHERE id=$1", [gid]);
    if (!g.rows.length) return res.status(404).json({ error: "group not found" });
    if (g.rows[0].created_by !== me.id) return res.status(403).json({ error: "only the owner can rotate the link" });

    const rotate = !!req.body?.rotate || !g.rows[0].invite_token;
    let token = g.rows[0].invite_token;
    if (rotate) {
      token = newInviteToken();
      await db.query("UPDATE feed_group_chats SET invite_token=$1 WHERE id=$2", [token, gid]);
    }
    res.json({ inviteToken: token });
  } catch (e) { next(e); }
});

// POST /api/dm/groups/join/:token — join a group via invite link
router.post("/groups/join/:token", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "invalid invite token" });
    const g = await db.query(
      `SELECT id, name, handle, pfp_url, created_by FROM feed_group_chats WHERE invite_token=$1 LIMIT 1`,
      [token]
    );
    if (!g.rows.length) return res.status(404).json({ error: "invite link not found or expired" });
    const row = g.rows[0];
    await db.query(
      "INSERT INTO feed_group_chat_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT (group_id, user_id) DO NOTHING",
      [row.id, me.id]
    );
    const count = await db.query(
      "SELECT COUNT(*)::int AS c FROM feed_group_chat_members WHERE group_id=$1", [row.id]
    );
    res.json({
      group: {
        id: row.id, name: row.name, handle: row.handle, pfpUrl: row.pfp_url,
        memberCount: count.rows[0].c, isOwner: row.created_by === me.id, kind: "group",
      },
    });
  } catch (e) { next(e); }
});

// GET /api/dm/groups/:groupId/messages — unsigned read; gate by membership.
router.get("/groups/:groupId/messages", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "x-wallet header required" });
    const me = await getOrCreateUser(wallet);
    const gid = parseInt(req.params.groupId, 10);
    if (!Number.isFinite(gid)) return res.status(400).json({ error: "invalid group id" });
    if (!(await assertGroupMember(gid, me.id))) return res.status(403).json({ error: "not a group member" });
    // LEFT JOIN the reply target so we get a one-line preview of the
    // quoted message for the UI (sender handle + first 80 chars). If
    // the parent was deleted, ON DELETE SET NULL leaves reply_to_id
    // null — the UI falls back to "Replying to a deleted message."
    const r = await db.query(
      `SELECT gm.id, gm.content, gm.created_at, gm.reply_to_id,
              u.wallet_address AS from_wallet,
              COALESCE(u.display_name, u.username, u.wallet_address) AS from_display,
              rm.content       AS reply_to_content,
              ru.wallet_address AS reply_to_wallet,
              COALESCE(ru.display_name, ru.username, ru.wallet_address) AS reply_to_display
         FROM feed_group_messages gm
         JOIN feed_users u ON u.id = gm.from_id
         LEFT JOIN feed_group_messages rm ON rm.id = gm.reply_to_id
         LEFT JOIN feed_users ru ON ru.id = rm.from_id
        WHERE gm.group_id = $1
        ORDER BY gm.created_at ASC
        LIMIT 300`,
      [gid]
    );
    res.json({ messages: r.rows });
  } catch (e) { next(e); }
});

// POST /api/dm/groups/:groupId/send  body: { content, replyToId? }
router.post("/groups/:groupId/send", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    const gid = parseInt(req.params.groupId, 10);
    const content = String(req.body?.content || "").trim();
    // replyToId is optional; validate that it exists in the SAME group
    // so a member of group A can't reply into group B (info leak).
    let replyToId = null;
    if (req.body?.replyToId != null) {
      const candidate = parseInt(req.body.replyToId, 10);
      if (Number.isFinite(candidate)) {
        const r = await db.query(
          "SELECT group_id FROM feed_group_messages WHERE id=$1 LIMIT 1",
          [candidate]
        );
        if (r.rows[0]?.group_id === gid) replyToId = candidate;
      }
    }
    if (!Number.isFinite(gid)) return res.status(400).json({ error: "invalid group id" });
    if (!content) return res.status(400).json({ error: "content required" });
    if (!(await assertGroupMember(gid, me.id))) return res.status(403).json({ error: "not a group member" });
    const r = await db.query(
      `INSERT INTO feed_group_messages (group_id, from_id, content, reply_to_id)
       VALUES ($1,$2,$3,$4)
       RETURNING id, content, created_at, reply_to_id`,
      [gid, me.id, content.slice(0, 4000), replyToId]
    );
    await db.query("UPDATE feed_group_chats SET last_message_at=NOW() WHERE id=$1", [gid]);

    // Live WS push to every group member except the author. Same shape
    // as the 1:1 dm:new event, with groupId in place of conversationId.
    try {
      const memberRows = await db.query(
        `SELECT u.wallet_address FROM feed_group_chat_members m
           JOIN feed_users u ON u.id = m.user_id
          WHERE m.group_id = $1 AND m.user_id <> $2`,
        [gid, me.id]
      );
      for (const { wallet_address } of memberRows.rows) {
        if (wallet_address) {
          feedHub.publish(wallet_address, {
            type: "dm:new",
            groupId: gid,
            fromId: me.id,
            messageId: r.rows[0].id,
          });
        }
      }
    } catch { /* best-effort */ }

    // TG fanout to every group member except the author. `group_msg`
    // setting defaults ON per the 2026-04-22 migration; existing
    // users without the key opt in by default (we treat missing as
    // true server-side on the tgNotify check).
    (async () => {
      try {
        const tg = require("../services/tgNotify");
        const chat = await db.query(
          "SELECT name FROM feed_group_chats WHERE id = $1", [gid]
        );
        const groupName = chat.rows[0]?.name || "group";
        const senderName = me.display_name || me.username || "someone";
        const preview = content.slice(0, 160).replace(/\s+/g, " ");
        const text =
          `💬 *${senderName}* in _${groupName.slice(0, 60)}_\n` +
          `${preview}${content.length > 160 ? "…" : ""}`;
        const members = await db.query(
          "SELECT user_id FROM feed_group_chat_members WHERE group_id = $1 AND user_id <> $2",
          [gid, me.id]
        );
        for (const { user_id } of members.rows) {
          tg.notifyFeedUser(user_id, "group_msg", text).catch(() => {});
        }
      } catch (e) {
        console.warn("[dm] group-msg tg fanout failed:", e.message);
      }
    })();

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

// GET /api/dm/:conversationId/messages?cursor= — unsigned read; participant
// check below is the real gate.
router.get("/:conversationId/messages", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "x-wallet header required" });
    const me = await getOrCreateUser(wallet);
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

    // Day 8.2: catch the offline-then-online case. Mark any inbound
    // messages we haven't yet acknowledged as delivered, and tell the
    // sender so their bubble flips. Synchronous before responding so
    // the client's first render already shows delivered state for its
    // own outbound messages once the sender's WS event arrives.
    try {
      const upd = await db.query(
        `UPDATE feed_dms SET delivered_at=NOW()
         WHERE conversation_id=$1 AND to_id=$2 AND delivered_at IS NULL
         RETURNING id, from_id, delivered_at`,
        [cid, me.id]
      );
      if (upd.rows.length) {
        const byFrom = new Map();
        for (const row of upd.rows) {
          if (!byFrom.has(row.from_id)) byFrom.set(row.from_id, []);
          byFrom.get(row.from_id).push(row.id);
          for (const m of r.rows) if (m.id === row.id) m.delivered_at = row.delivered_at;
        }
        const senders = await db.query(
          "SELECT id, wallet_address FROM feed_users WHERE id = ANY($1)",
          [[...byFrom.keys()]]
        );
        for (const s of senders.rows) {
          if (s.wallet_address) {
            feedHub.publish(s.wallet_address, {
              type: "dm:state",
              conversationId: cid,
              messageIds: byFrom.get(s.id),
              state: "delivered",
              at: upd.rows[0].delivered_at,
            });
          }
        }
      }
    } catch { /* best-effort */ }

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

    // Live WS push to the recipient's authed sockets. Replaces the 30s
    // poll on /api/dm/conversations the AppShell used to run. Body is
    // ciphertext-only — server can't read it — so the event carries
    // just routing metadata; the client refetches the conversation.
    //
    // Day 8.2: if the recipient has a live socket, mark delivered_at
    // immediately and emit dm:state back to the sender so their bubble
    // flips from single-tick to double-tick. Offline recipients pick
    // this up on their next GET /messages.
    try {
      const peer = await db.query("SELECT wallet_address FROM feed_users WHERE id=$1", [toId]);
      const peerWallet = peer.rows[0]?.wallet_address;
      if (peerWallet) {
        feedHub.publish(peerWallet, {
          type: "dm:new",
          conversationId,
          fromId: me.id,
          messageId: r.rows[0].id,
        });
        if (feedHub.hasAuthedSocket(peerWallet)) {
          const upd = await db.query(
            "UPDATE feed_dms SET delivered_at=NOW() WHERE id=$1 AND delivered_at IS NULL RETURNING delivered_at",
            [r.rows[0].id]
          );
          if (upd.rows[0]) {
            r.rows[0].delivered_at = upd.rows[0].delivered_at;
            feedHub.publish(me.wallet_address, {
              type: "dm:state",
              conversationId,
              messageIds: [r.rows[0].id],
              state: "delivered",
              at: upd.rows[0].delivered_at,
            });
          }
        }
      }
    } catch { /* best-effort */ }

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
        const actorRow = actor.rows[0] || {};
        notifyUser(toId, {
          title: `📞 ${name} is calling`,
          body: "Tap to answer — IronShield call",
          url: `/#/Feed?dm=${conversationId}&call=incoming`,
          tag: `call-${conversationId}`,
          actions: [
            { action: "answer", title: "Answer" },
            { action: "decline", title: "Decline" },
          ],
          kind: "call",
          conversationId,
          // Foreground overlay reads these via postMessage — the OS
          // notification itself doesn't render them.
          peer: {
            wallet: req.wallet,
            username: actorRow.username || null,
            displayName: actorRow.display_name || null,
          },
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
    const cid = req.params.conversationId;
    // Day 8.2: RETURNING the affected rows lets us fan out a dm:state
    // event to each unique sender so their bubbles flip to "read"
    // within ~1s. Multiple senders is rare (1:1 conv) but we group
    // anyway — the same logic powers the offline-fetch delivered
    // fanout above.
    const upd = await db.query(
      `UPDATE feed_dms SET read_at=NOW()
       WHERE conversation_id=$1 AND to_id=$2 AND read_at IS NULL
       RETURNING id, from_id, read_at`,
      [cid, me.id]);
    if (upd.rows.length) {
      try {
        const byFrom = new Map();
        for (const row of upd.rows) {
          if (!byFrom.has(row.from_id)) byFrom.set(row.from_id, []);
          byFrom.get(row.from_id).push(row.id);
        }
        const senders = await db.query(
          "SELECT id, wallet_address FROM feed_users WHERE id = ANY($1)",
          [[...byFrom.keys()]]
        );
        for (const s of senders.rows) {
          if (s.wallet_address) {
            feedHub.publish(s.wallet_address, {
              type: "dm:state",
              conversationId: parseInt(cid, 10),
              messageIds: byFrom.get(s.id),
              state: "read",
              at: upd.rows[0].read_at,
            });
          }
        }
      } catch { /* best-effort */ }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
