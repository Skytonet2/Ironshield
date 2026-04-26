// backend/routes/notifications.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");

// GET is unsigned: signed reads would force a wallet-popup-per-poll
// (this endpoint polls every 30s). Identity comes from the bare
// x-wallet header — same trust posture as the pre-Day-1 reads. Returns
// an empty list when no header is present so the inbox renders cleanly
// for logged-out viewers.
router.get("/", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.json({ notifications: [] });
    const me = await getOrCreateUser(wallet);
    const r = await db.query(
      `SELECT n.*, u.username AS actor_username, u.display_name AS actor_name, u.pfp_url AS actor_pfp
         FROM feed_notifications n
         LEFT JOIN feed_users u ON u.id = n.actor_id
        WHERE n.user_id=$1
        ORDER BY n.created_at DESC LIMIT 50`, [me.id]);
    res.json({ notifications: r.rows });
  } catch (e) { next(e); }
});

router.post("/read-all", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
    await db.query("UPDATE feed_notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL", [me.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
