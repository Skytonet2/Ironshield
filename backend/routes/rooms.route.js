// backend/routes/rooms.route.js — Live Alpha Rooms
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const db = require("../db/client");
const { getOrCreateUser, postHash } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");
const feedHub = require("../ws/feedHub");

// LiveKit server SDK is optional at boot. When LIVEKIT_* env is unset
// (preview deploys, local dev) we surface 503 from mute/kick so the
// caller knows the action didn't actually land in voice. The DB-side
// effects (left_at) still apply.
let RoomServiceClient, EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, WebhookReceiver;
try {
  ({ RoomServiceClient, EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, WebhookReceiver } =
    require("livekit-server-sdk"));
} catch {
  RoomServiceClient = null; EgressClient = null; WebhookReceiver = null;
}
function livekitClient() {
  const url = process.env.LIVEKIT_URL || "";
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  if (!url || !apiKey || !apiSecret || !RoomServiceClient) return null;
  return new RoomServiceClient(url, apiKey, apiSecret);
}

// Day 19 — LiveKit Egress. Returns an EgressClient when the room creds
// AND the S3 destination creds are all set. Without an S3 bucket the
// egress server has nowhere to upload, so we no-op rather than start an
// egress that will fail mid-room.
function egressClient() {
  const url = process.env.LIVEKIT_URL || "";
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  if (!url || !apiKey || !apiSecret || !EgressClient) return null;
  if (!process.env.LIVEKIT_EGRESS_S3_BUCKET) return null;
  return new EgressClient(url, apiKey, apiSecret);
}

function buildEgressFileOutput(roomName) {
  const bucket = process.env.LIVEKIT_EGRESS_S3_BUCKET;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // Audio-only rooms → .ogg keeps files small. Frontend treats either
  // extension uniformly via <audio src=…> on the replay page.
  const filepath = `rooms/${roomName}/${stamp}.ogg`;
  return new EncodedFileOutput({
    fileType: EncodedFileType.OGG,
    filepath,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY || "",
        secret:    process.env.LIVEKIT_EGRESS_S3_SECRET     || "",
        region:    process.env.LIVEKIT_EGRESS_S3_REGION     || "",
        bucket,
        endpoint:  process.env.LIVEKIT_EGRESS_S3_ENDPOINT   || undefined,
        forcePathStyle: !!process.env.LIVEKIT_EGRESS_S3_ENDPOINT,
      }),
    },
  });
}

function publicEgressUrl(filepath) {
  const base = (process.env.LIVEKIT_EGRESS_PUBLIC_BASE || "").replace(/\/+$/, "");
  return base ? `${base}/${filepath}` : null;
}

const MIN_STAKE_USD = 50; // spec: min 50 $IRONCLAW ≈ $50-equiv for MVP
const ALLOWED_ACCESS = ["open", "token_gated", "invite_only"];

// ─── Helpers ────────────────────────────────────────────────────────
// Seeded per-wallet bot probability: stable across sessions, 0..100.
function seedBotScore(wallet) {
  if (!wallet) return 50;
  const h = crypto.createHash("sha256").update(String(wallet)).digest();
  return h[0] % 101;
}

function aggregateBotScore(participants) {
  if (!participants.length) return 0;
  const total = participants.reduce((s, p) => s + (p.botProbability || 0), 0);
  return Math.round(total / participants.length);
}

async function countLive(roomId) {
  const r = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE role IN ('host','speaker'))::int AS speakers,
       COUNT(*) FILTER (WHERE role = 'listener')::int         AS listeners,
       COUNT(*)::int                                           AS total,
       COALESCE(AVG(bot_probability), 0)::float                AS avg_bot
       FROM feed_room_participants
      WHERE room_id=$1 AND left_at IS NULL`,
    [roomId]
  );
  return r.rows[0];
}

function hydrateRoom(room, counts, host) {
  return {
    id: room.id,
    title: room.title,
    topic: room.topic,
    accessType: room.access_type,
    voiceEnabled: room.voice_enabled,
    recordingEnabled: !!room.recording_enabled,
    recording: {
      enabled:   !!room.recording_enabled,
      live:      !!room.recording_egress_id && !room.recording_ended_at,
      startedAt: room.recording_started_at || null,
      endedAt:   room.recording_ended_at   || null,
      url:       room.recording_url || null,
    },
    stake: {
      tokenContract: room.stake_token_contract,
      tokenSymbol:   room.stake_token_symbol,
      tokenDecimals: room.stake_token_decimals,
      amountHuman:   Number(room.stake_amount_human),
      amountUsd:     Number(room.stake_usd_frozen),
      txHash:        room.stake_tx_hash,
    },
    durationMins: room.duration_mins,
    startedAt: room.started_at,
    endsAt:    room.ends_at,
    closedAt:  room.closed_at,
    status:    room.status,
    livekitRoomName: room.livekit_room_name,
    gate: room.access_type === "open" ? null : {
      minBalance: room.access_min_balance != null ? Number(room.access_min_balance) : null,
      minTier:    room.access_min_tier   || null,
      allowlist:  Array.isArray(room.access_allowlist) ? room.access_allowlist : [],
    },
    counts: {
      speakers:   counts?.speakers   || 0,
      listeners:  counts?.listeners  || 0,
      total:      counts?.total      || 0,
      botThreat:  Math.round(counts?.avg_bot || 0),
    },
    host: host ? {
      id: host.id,
      wallet: host.wallet_address,
      username: host.username,
      displayName: host.display_name,
      pfpUrl: host.pfp_url,
    } : null,
  };
}

// ─── Routes ─────────────────────────────────────────────────────────

// GET /api/rooms — list live rooms (newest first). Query: ?access=open|token_gated|invite_only
router.get("/", async (req, res, next) => {
  try {
    const { access } = req.query;
    const params = [];
    let sql = "SELECT * FROM feed_rooms WHERE status='live' AND ends_at > NOW()";
    if (access && ALLOWED_ACCESS.includes(access)) {
      params.push(access);
      sql += ` AND access_type = $${params.length}`;
    }
    sql += " ORDER BY started_at DESC LIMIT 60";

    const rooms = await db.query(sql, params);
    if (!rooms.rows.length) return res.json({ rooms: [] });

    const ids = rooms.rows.map(r => r.id);
    const hostIds = [...new Set(rooms.rows.map(r => r.host_id).filter(Boolean))];

    const [countsResult, hostsResult] = await Promise.all([
      db.query(
        `SELECT room_id,
                COUNT(*) FILTER (WHERE role IN ('host','speaker'))::int AS speakers,
                COUNT(*) FILTER (WHERE role = 'listener')::int         AS listeners,
                COUNT(*)::int                                           AS total,
                COALESCE(AVG(bot_probability),0)::float                 AS avg_bot
           FROM feed_room_participants
          WHERE room_id = ANY($1) AND left_at IS NULL
          GROUP BY room_id`,
        [ids]
      ),
      hostIds.length
        ? db.query("SELECT id, wallet_address, username, display_name, pfp_url FROM feed_users WHERE id = ANY($1)", [hostIds])
        : Promise.resolve({ rows: [] }),
    ]);

    const cMap = Object.fromEntries(countsResult.rows.map(r => [r.room_id, r]));
    const hMap = Object.fromEntries(hostsResult.rows.map(h => [h.id, h]));

    res.json({
      rooms: rooms.rows.map(r => hydrateRoom(r, cMap[r.id], hMap[r.host_id])),
    });
  } catch (e) { next(e); }
});

// POST /api/rooms — create a room
// body: { title, topic, accessType, stakeAmountHuman, stakeAmountUsd,
//         stakeTokenContract, stakeTokenSymbol, stakeTokenDecimals,
//         durationMins, voiceEnabled, gate?, stakeTxHash? }
router.post("/", requireWallet, async (req, res, next) => {
  try {
    const host = await getOrCreateUser(req.wallet);
    const {
      title, topic = "",
      accessType = "open",
      stakeAmountHuman = 0, stakeAmountUsd = 0,
      stakeTokenContract = "near", stakeTokenSymbol = "NEAR", stakeTokenDecimals = 24,
      durationMins = 60, voiceEnabled = true, recordingEnabled = false,
      gate = null,
      stakeTxHash = null,
    } = req.body || {};

    if (!title || title.length > 120) return res.status(400).json({ error: "title required (max 120)" });
    if (!ALLOWED_ACCESS.includes(accessType)) return res.status(400).json({ error: "bad accessType" });
    if (Number(stakeAmountUsd) < MIN_STAKE_USD) {
      return res.status(400).json({ error: `minimum stake is $${MIN_STAKE_USD} equivalent` });
    }

    // Derive base-unit amount from human amount + decimals.
    const stakeBase = (() => {
      const [w, f = ""] = String(stakeAmountHuman).split(".");
      const padded = (f + "0".repeat(stakeTokenDecimals)).slice(0, stakeTokenDecimals);
      return (BigInt(w || "0") * 10n ** BigInt(stakeTokenDecimals) + BigInt(padded || "0")).toString();
    })();

    // Gate columns (for token_gated / invite_only). Open rooms ignore gate.
    let minBalance = null, minTier = null, allowlist = null;
    if (accessType !== "open" && gate) {
      if (gate.type === "balance") minBalance = Number(gate.minBalance) || null;
      if (gate.type === "tier")    minTier    = gate.minTier || null;
      if (gate.type === "allowlist") {
        const list = Array.isArray(gate.allowlist) ? gate.allowlist.map(a => String(a).toLowerCase().trim()).filter(Boolean) : [];
        if (list.length) allowlist = JSON.stringify(list);
      }
    }

    const livekitName = `ironclaw-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    const endsAt = new Date(Date.now() + Number(durationMins) * 60_000).toISOString();

    const r = await db.query(
      `INSERT INTO feed_rooms
         (host_id, title, topic, access_type,
          stake_token_contract, stake_token_symbol, stake_token_decimals,
          stake_amount_base, stake_amount_human, stake_usd_frozen, stake_tx_hash,
          duration_mins, voice_enabled, recording_enabled,
          access_min_balance, access_min_tier, access_allowlist,
          livekit_room_name, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        host.id, title, topic, accessType,
        stakeTokenContract, stakeTokenSymbol, Number(stakeTokenDecimals),
        stakeBase, String(stakeAmountHuman), String(stakeAmountUsd), stakeTxHash,
        Number(durationMins), !!voiceEnabled, !!recordingEnabled,
        minBalance, minTier, allowlist,
        livekitName, endsAt,
      ]
    );
    const room = r.rows[0];

    // Auto-add host as speaker.
    await db.query(
      `INSERT INTO feed_room_participants (room_id, user_id, role, bot_probability)
       VALUES ($1, $2, 'host', $3)
       ON CONFLICT (room_id, user_id) DO UPDATE SET role='host', left_at=NULL`,
      [room.id, host.id, seedBotScore(host.wallet_address)]
    );

    const hostRow = await db.query(
      "SELECT id, wallet_address, username, display_name, pfp_url FROM feed_users WHERE id=$1",
      [host.id]
    );
    const counts = await countLive(room.id);

    // Fan out a TG notification to every follower of the host. Fire
    // and forget — never block room creation on notification side
    // effects. Followers without TG linked get nothing; those with
    // room_start=false in their settings skip silently.
    (async () => {
      try {
        const tg = require("../services/tgNotify");
        const followers = await db.query(
          "SELECT follower_id FROM feed_follows WHERE following_id = $1",
          [host.id]
        );
        const hostName = hostRow.rows[0]?.display_name || hostRow.rows[0]?.username || "someone";
        const text =
          `🎙 *${hostName}* started a room\n` +
          `_${(room.title || "untitled").slice(0, 120)}_\n` +
          `[Join →](https://ironshield.pages.dev/rooms/view?id=${room.id})`;
        for (const { follower_id } of followers.rows) {
          tg.notifyFeedUser(follower_id, "room_start", text).catch(() => {});
        }
      } catch (e) {
        console.warn("[rooms] tg fanout failed:", e.message);
      }
    })();

    res.json({ room: hydrateRoom(room, counts, hostRow.rows[0]) });
  } catch (e) { next(e); }
});

// GET /api/rooms/:id
router.get("/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM feed_rooms WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "room not found" });
    const room = r.rows[0];
    const [host, counts, parts] = await Promise.all([
      room.host_id
        ? db.query("SELECT id, wallet_address, username, display_name, pfp_url FROM feed_users WHERE id=$1", [room.host_id]).then(rr => rr.rows[0])
        : Promise.resolve(null),
      countLive(room.id),
      db.query(
        `SELECT p.id, p.role, p.bot_probability, p.hand_raised, p.joined_at,
                u.id AS user_id, u.wallet_address, u.username, u.display_name, u.pfp_url
           FROM feed_room_participants p
           JOIN feed_users u ON u.id = p.user_id
          WHERE p.room_id=$1 AND p.left_at IS NULL
          ORDER BY
            CASE p.role WHEN 'host' THEN 0 WHEN 'speaker' THEN 1 ELSE 2 END,
            p.joined_at ASC`,
        [room.id]
      ),
    ]);

    res.json({
      room: hydrateRoom(room, counts, host),
      participants: parts.rows.map(row => ({
        id: row.user_id,
        wallet: row.wallet_address,
        username: row.username,
        displayName: row.display_name,
        pfpUrl: row.pfp_url,
        role: row.role,
        botProbability: row.bot_probability,
        handRaised: row.hand_raised,
        joinedAt: row.joined_at,
      })),
    });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/join  body: { role?: 'listener'|'speaker' }
// Access enforcement is client-supplied for MVP (client checks balance/tier
// against gate and sends the eligible role). Real-world impl would re-verify
// against on-chain balance here before issuing the LiveKit token.
router.post("/:id/join", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const room = await db.query("SELECT * FROM feed_rooms WHERE id=$1", [req.params.id]);
    if (!room.rows.length) return res.status(404).json({ error: "room not found" });
    if (room.rows[0].status !== "live") return res.status(410).json({ error: "room closed" });

    const requested = req.body?.role === "speaker" ? "speaker" : "listener";
    const access = room.rows[0].access_type;
    // Open rooms: anyone can be a speaker on request.
    // Token-gated: listeners auto-upgraded to speaker (gate already enforced).
    // Invite-only: stay as listener unless host promotes later.
    let finalRole = requested;
    if (access === "token_gated" && requested === "listener") finalRole = "speaker";
    if (access === "invite_only" && requested === "speaker") finalRole = "listener";

    await db.query(
      `INSERT INTO feed_room_participants (room_id, user_id, role, bot_probability)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (room_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, left_at = NULL, joined_at = NOW()`,
      [room.rows[0].id, user.id, finalRole, seedBotScore(user.wallet_address)]
    );
    res.json({ ok: true, role: finalRole });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/leave
router.post("/:id/leave", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    await db.query(
      "UPDATE feed_room_participants SET left_at=NOW() WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL",
      [req.params.id, user.id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/close — host only. Closes the room and queues the
// stake-refund decision. The on-chain refund itself is wired in Day 13
// (rooms feature complete) — until then refund_tx_hash stays NULL and the
// response carries refund_status: "pending" | "forfeited" so the frontend
// can show an honest "refund pending" state instead of a fake tx hash.
router.post("/:id/close", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const room = await db.query("SELECT * FROM feed_rooms WHERE id=$1", [req.params.id]);
    if (!room.rows.length) return res.status(404).json({ error: "room not found" });
    if (room.rows[0].host_id !== user.id) return res.status(403).json({ error: "not host" });

    const refundOk = (room.rows[0].flagged_violations || 0) === 0;
    const refundStatus = refundOk ? "pending" : "forfeited";

    // Day 19 — stop any in-flight egress before flipping status. Best
    // effort: a stuck egress shouldn't block the host from closing.
    if (room.rows[0].recording_egress_id) {
      const ec = egressClient();
      if (ec) {
        try { await ec.stopEgress(room.rows[0].recording_egress_id); }
        catch { /* webhook will reconcile, or egress already exited */ }
      }
      await db.query(
        `UPDATE feed_rooms
            SET recording_enabled=FALSE,
                recording_ended_at=COALESCE(recording_ended_at, NOW())
          WHERE id=$1`,
        [room.rows[0].id]
      );
    }

    await db.query(
      `UPDATE feed_rooms
          SET status='closed', closed_at=NOW(), refund_tx_hash=NULL
        WHERE id=$1`,
      [room.rows[0].id]
    );
    await db.query(
      "UPDATE feed_room_participants SET left_at=NOW() WHERE room_id=$1 AND left_at IS NULL",
      [room.rows[0].id]
    );

    const summary = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM feed_room_participants WHERE room_id=$1)::int           AS total_participants,
         (SELECT COUNT(*) FROM feed_room_participants WHERE room_id=$1 AND role IN ('host','speaker'))::int AS total_speakers,
         (SELECT COUNT(*) FROM feed_room_messages    WHERE room_id=$1 AND is_alpha_call) ::int             AS alpha_calls`,
      [room.rows[0].id]
    );
    if (room.rows[0].recording_enabled) {
      const c = summary.rows[0];
      const postText = [
        `🎙️ Recorded Space: ${room.rows[0].title}`,
        room.rows[0].topic ? `Topic: ${room.rows[0].topic}` : null,
        `Speakers: ${c.total_speakers} · Participants: ${c.total_participants}`,
        `Alpha calls: ${c.alpha_calls}`,
        `Replay: /rooms/view/?id=${room.rows[0].id}`,
      ].filter(Boolean).join("\n");
      const ts = new Date().toISOString();
      await db.query(
        `INSERT INTO feed_posts (author_id, content, media_urls, media_type, post_hash, kind, title)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [user.id, postText, null, "NONE", postHash(postText, user.id, ts), "post", `Room Replay · ${room.rows[0].title}`]
      );
    }

    res.json({
      ok: true,
      // refundTx stays null until Day 13 wires the on-chain refund. The
      // status field tells the UI what to render: "pending" → spinner +
      // "refund processing"; "forfeited" → "stake forfeited (room flagged)".
      refundTx: null,
      refundStatus,
      summary: {
        totalParticipants: summary.rows[0].total_participants,
        totalSpeakers:     summary.rows[0].total_speakers,
        alphaCalls:        summary.rows[0].alpha_calls,
      },
    });
  } catch (e) { next(e); }
});

// ─── Messages ───────────────────────────────────────────────────────

// GET /api/rooms/:id/messages?since=<iso>
router.get("/:id/messages", async (req, res, next) => {
  try {
    const { since } = req.query;
    const params = [req.params.id];
    let sql = `SELECT m.id, m.content, m.is_alpha_call, m.alpha_upvotes, m.alpha_downvotes, m.pinned, m.created_at,
                      u.id AS user_id, u.wallet_address, u.username, u.display_name, u.pfp_url
                 FROM feed_room_messages m
                 JOIN feed_users u ON u.id = m.user_id
                WHERE m.room_id=$1`;
    if (since) {
      params.push(since);
      sql += ` AND m.created_at > $${params.length}`;
    }
    sql += " ORDER BY m.created_at ASC LIMIT 200";
    const r = await db.query(sql, params);
    res.json({
      messages: r.rows.map(row => ({
        id: row.id,
        content: row.content,
        isAlphaCall: row.is_alpha_call,
        alphaUpvotes: row.alpha_upvotes,
        alphaDownvotes: row.alpha_downvotes,
        pinned: row.pinned,
        createdAt: row.created_at,
        author: {
          id: row.user_id, wallet: row.wallet_address,
          username: row.username, displayName: row.display_name, pfpUrl: row.pfp_url,
        },
      })),
    });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/messages  body: { content, isAlphaCall? }
router.post("/:id/messages", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { content, isAlphaCall = false } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: "content required" });
    if (content.length > 500) return res.status(400).json({ error: "max 500 chars" });

    // Must be in the room.
    const part = await db.query(
      "SELECT 1 FROM feed_room_participants WHERE room_id=$1 AND user_id=$2 AND left_at IS NULL",
      [req.params.id, user.id]
    );
    if (!part.rows.length) return res.status(403).json({ error: "join the room first" });

    const r = await db.query(
      `INSERT INTO feed_room_messages (room_id, user_id, content, is_alpha_call)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [req.params.id, user.id, content.trim(), !!isAlphaCall]
    );

    // Live fanout. Clients in the room subscribe to type "room:msg"
    // and filter by roomId locally. Best-effort — if the WS hub is
    // down we still return the inserted row so the sender's UI updates
    // and HTTP polling/pull will replay for everyone else.
    try {
      feedHub.broadcast({
        type: "room:msg",
        roomId: Number(req.params.id),
        message: {
          id: r.rows[0].id,
          content: content.trim(),
          isAlphaCall: !!isAlphaCall,
          alphaUpvotes: 0,
          alphaDownvotes: 0,
          pinned: false,
          createdAt: r.rows[0].created_at,
          author: {
            id: user.id,
            wallet: user.wallet_address,
            username: user.username,
            displayName: user.display_name,
            pfpUrl: user.pfp_url,
          },
        },
      });
    } catch { /* best-effort */ }

    res.json({ id: r.rows[0].id, createdAt: r.rows[0].created_at });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/messages/:msgId/vote  body: { dir: 'up'|'down' }
router.post("/:id/messages/:msgId/vote", requireWallet, async (req, res, next) => {
  try {
    const dir = req.body?.dir === "down" ? "down" : "up";
    const col = dir === "up" ? "alpha_upvotes" : "alpha_downvotes";
    await db.query(
      `UPDATE feed_room_messages SET ${col} = ${col} + 1 WHERE id=$1 AND room_id=$2`,
      [req.params.msgId, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ─── Host controls ──────────────────────────────────────────────────

async function assertHost(roomId, wallet) {
  const u = await getOrCreateUser(wallet);
  const r = await db.query("SELECT host_id FROM feed_rooms WHERE id=$1", [roomId]);
  if (!r.rows.length) return { ok: false, code: 404, msg: "room not found" };
  if (r.rows[0].host_id !== u.id) return { ok: false, code: 403, msg: "not host" };
  return { ok: true, host: u };
}

// POST /api/rooms/:id/raise  body: { raised: bool }
router.post("/:id/raise", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const raised = !!req.body?.raised;
    await db.query(
      "UPDATE feed_room_participants SET hand_raised=$1 WHERE room_id=$2 AND user_id=$3",
      [raised, req.params.id, user.id]
    );
    res.json({ ok: true, raised });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/promote  body: { userId, role: 'speaker'|'listener' }
router.post("/:id/promote", requireWallet, async (req, res, next) => {
  try {
    const guard = await assertHost(req.params.id, req.wallet);
    if (!guard.ok) return res.status(guard.code).json({ error: guard.msg });
    const { userId, role } = req.body || {};
    const r = role === "speaker" ? "speaker" : "listener";
    await db.query(
      "UPDATE feed_room_participants SET role=$1, hand_raised=FALSE WHERE room_id=$2 AND user_id=$3",
      [r, req.params.id, userId]
    );
    res.json({ ok: true, role: r });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/kick  body: { userId }
router.post("/:id/kick", requireWallet, async (req, res, next) => {
  try {
    const guard = await assertHost(req.params.id, req.wallet);
    if (!guard.ok) return res.status(guard.code).json({ error: guard.msg });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId required" });

    // Resolve target wallet (LiveKit identity) and the room's livekit
    // room name, then call removeParticipant. Without this the kicked
    // user stays in voice until they reconnect even though their DB
    // row is set to left.
    const [targetRow, roomRow] = await Promise.all([
      db.query("SELECT wallet_address FROM feed_users WHERE id=$1", [userId]),
      db.query("SELECT livekit_room_name FROM feed_rooms WHERE id=$1", [req.params.id]),
    ]);
    const identity = targetRow.rows[0]?.wallet_address;
    const roomName = roomRow.rows[0]?.livekit_room_name;

    await db.query(
      "UPDATE feed_room_participants SET left_at=NOW() WHERE room_id=$1 AND user_id=$2",
      [req.params.id, userId]
    );

    let livekitOk = false;
    const lk = livekitClient();
    if (lk && roomName && identity) {
      try {
        await lk.removeParticipant(roomName, identity);
        livekitOk = true;
      } catch (e) {
        // Already gone or never joined LiveKit. The DB-side left_at is
        // still authoritative for the participants list.
        if (!/not.?found|does not exist/i.test(e.message || "")) throw e;
        livekitOk = true;
      }
    }

    try {
      feedHub.broadcast({
        type: "room:participant_kicked",
        roomId: Number(req.params.id),
        userId,
      });
    } catch { /* best-effort */ }

    res.json({ ok: true, livekit: livekitOk });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/mute  body: { userId, trackSid? }
// Owner-only. Mutes the target's published audio track. If trackSid is
// omitted we mute the first audio track LiveKit lists for that
// identity, which is the common case (one mic per participant).
router.post("/:id/mute", requireWallet, async (req, res, next) => {
  try {
    const guard = await assertHost(req.params.id, req.wallet);
    if (!guard.ok) return res.status(guard.code).json({ error: guard.msg });
    const { userId, trackSid } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId required" });

    const lk = livekitClient();
    if (!lk) return res.status(503).json({ error: "LiveKit not configured" });

    const [targetRow, roomRow] = await Promise.all([
      db.query("SELECT wallet_address FROM feed_users WHERE id=$1", [userId]),
      db.query("SELECT livekit_room_name FROM feed_rooms WHERE id=$1", [req.params.id]),
    ]);
    const identity = targetRow.rows[0]?.wallet_address;
    const roomName = roomRow.rows[0]?.livekit_room_name;
    if (!identity || !roomName) return res.status(404).json({ error: "user or room not found" });

    let sid = trackSid;
    if (!sid) {
      const p = await lk.getParticipant(roomName, identity).catch(() => null);
      const audio = (p?.tracks || []).find((t) => t.type === 0 || t.type === "AUDIO");
      sid = audio?.sid;
    }
    if (!sid) return res.status(404).json({ error: "no audio track to mute" });

    await lk.mutePublishedTrack(roomName, identity, sid, true);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/rooms/:id/recording  body: { on }
// Owner-only. Toggles `feed_rooms.recording_enabled`. Day 19: when the
// LiveKit Egress + S3 envs are set we also start (or stop) a real
// room-composite audio egress. Without S3 creds we still flip the flag
// so the toggle remains usable in preview/dev — `egressed: false` in
// the response tells the caller no actual capture happened.
router.post("/:id/recording", requireWallet, async (req, res, next) => {
  try {
    const guard = await assertHost(req.params.id, req.wallet);
    if (!guard.ok) return res.status(guard.code).json({ error: guard.msg });
    const on = !!req.body?.on;

    const cur = await db.query(
      `SELECT id, livekit_room_name, recording_enabled, recording_egress_id
         FROM feed_rooms WHERE id=$1`,
      [req.params.id]
    );
    if (!cur.rows.length) return res.status(404).json({ error: "room not found" });
    const room = cur.rows[0];

    let egressed = false;
    let egressError = null;
    const ec = egressClient();

    if (on && ec && !room.recording_egress_id) {
      try {
        const fileOutput = buildEgressFileOutput(room.livekit_room_name);
        const info = await ec.startRoomCompositeEgress(
          room.livekit_room_name,
          { file: fileOutput },
          { audioOnly: true }
        );
        await db.query(
          `UPDATE feed_rooms
             SET recording_enabled=TRUE,
                 recording_egress_id=$1,
                 recording_started_at=NOW(),
                 recording_ended_at=NULL,
                 recording_url=NULL
           WHERE id=$2`,
          [info.egressId, room.id]
        );
        egressed = true;
      } catch (e) {
        egressError = String(e?.message || e);
        // Egress failed — leave the flag off so the host sees an honest
        // failure instead of a green "recording" state with no file.
        await db.query(
          `UPDATE feed_rooms SET recording_enabled=FALSE WHERE id=$1`,
          [room.id]
        );
      }
    } else if (!on && ec && room.recording_egress_id) {
      try {
        await ec.stopEgress(room.recording_egress_id);
      } catch (e) {
        egressError = String(e?.message || e);
        // We still flip the flag off — egress may have already exited.
      }
      // recording_url is filled in by the egress webhook (EGRESS_COMPLETE);
      // here we just mark it ended.
      await db.query(
        `UPDATE feed_rooms
           SET recording_enabled=FALSE,
               recording_ended_at=NOW()
         WHERE id=$1`,
        [room.id]
      );
      egressed = true;
    } else {
      // No egress creds, or already in the requested state. Just flip
      // the flag — the metadata signal still has value (UI hint, post-
      // close summary).
      await db.query(
        `UPDATE feed_rooms SET recording_enabled=$1 WHERE id=$2`,
        [on, room.id]
      );
    }

    try {
      feedHub.broadcast({
        type: "room:recording",
        roomId: Number(req.params.id),
        on,
      });
    } catch { /* best-effort */ }

    res.json({
      ok: true,
      recording_enabled: on,
      egressed,
      ...(egressError ? { egressError } : {}),
    });
  } catch (e) { next(e); }
});

// POST /api/rooms/egress-webhook
// LiveKit Egress fires this on EGRESS_COMPLETE / EGRESS_FAILED. The
// upstream signs the body as a JWT in the Authorization header; we
// verify with WebhookReceiver before trusting the egress_id → URL
// mapping. The global express.json parser stashes the raw bytes on
// req.rawBody for us (see backend/server.js), which is what
// WebhookReceiver.receive needs to recompute the signature.
router.post("/egress-webhook", async (req, res) => {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY || "";
    const apiSecret = process.env.LIVEKIT_API_SECRET || "";
    if (!WebhookReceiver || !apiKey || !apiSecret) {
      return res.status(503).json({ error: "egress webhook not configured" });
    }
    const auth = req.get("Authorization") || "";
    const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});

    let ev;
    try {
      const receiver = new WebhookReceiver(apiKey, apiSecret);
      ev = await receiver.receive(raw, auth);
    } catch {
      return res.status(401).json({ error: "invalid webhook signature" });
    }

    if (ev.event !== "egress_ended" && ev.event !== "egress_updated") {
      return res.json({ ok: true, ignored: true });
    }
    const info = ev.egressInfo || {};
    const egressId = info.egressId;
    if (!egressId) return res.json({ ok: true, ignored: true });

    const fileResults = info.fileResults || [];
    const first = fileResults[0] || {};
    const filename = first.filename || "";
    const url = publicEgressUrl(filename) || first.location || null;

    await db.query(
      `UPDATE feed_rooms
         SET recording_url = COALESCE($1, recording_url),
             recording_ended_at = COALESCE(recording_ended_at, NOW()),
             recording_enabled = FALSE
       WHERE recording_egress_id = $2`,
      [url, egressId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

module.exports = router;
