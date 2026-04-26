// backend/routes/livekit.route.js — LiveKit JWT mint
//
// Issues a short-lived (2h) AccessToken so a wallet can join the LiveKit
// room bound to a feed_rooms row. Permissions follow the participant's
// role in feed_room_participants:
//   host    → can publish + subscribe + control (canUpdateOwnMetadata)
//   speaker → can publish + subscribe
//   listener→ subscribe only (no canPublish)
//
// Mocked path: when LIVEKIT_API_KEY/SECRET aren't set the route returns
// `{ mocked: true, token: null }` so the client falls back to the visual-
// only stage. This keeps preview deploys working before LiveKit is wired.

const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");

let AccessToken;
try { ({ AccessToken } = require("livekit-server-sdk")); } catch { AccessToken = null; }

// POST /api/livekit/token  body: { roomId }
// Returns { token, url, identity, role, mocked? }
router.post("/token", requireWallet, async (req, res, next) => {
  try {
    const { roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ error: "roomId required" });

    const user = await getOrCreateUser(req.wallet);
    const r = await db.query(
      `SELECT r.livekit_room_name, r.status, p.role
         FROM feed_rooms r
         LEFT JOIN feed_room_participants p
           ON p.room_id = r.id AND p.user_id = $2 AND p.left_at IS NULL
        WHERE r.id = $1`,
      [roomId, user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "room not found" });
    const row = r.rows[0];
    if (row.status !== "live") return res.status(410).json({ error: "room closed" });
    if (!row.role) return res.status(403).json({ error: "join the room first" });

    const url        = process.env.LIVEKIT_URL || "";
    const apiKey     = process.env.LIVEKIT_API_KEY || "";
    const apiSecret  = process.env.LIVEKIT_API_SECRET || "";

    if (!apiKey || !apiSecret || !url || !AccessToken) {
      return res.json({
        token: null, url: null,
        identity: user.wallet_address, role: row.role,
        mocked: true,
      });
    }

    const canPublish = row.role === "host" || row.role === "speaker";

    const at = new AccessToken(apiKey, apiSecret, {
      identity: user.wallet_address,
      name: user.display_name || user.username || user.wallet_address,
      ttl: 60 * 60 * 2, // 2h — long enough for a 90m room with overrun
    });
    at.addGrant({
      room: row.livekit_room_name,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,                   // text-channel data messages
      canUpdateOwnMetadata: row.role === "host",
    });

    const token = await at.toJwt();
    res.json({
      token,
      url,
      identity: user.wallet_address,
      role: row.role,
      roomName: row.livekit_room_name,
      mocked: false,
    });
  } catch (e) { next(e); }
});

module.exports = router;
