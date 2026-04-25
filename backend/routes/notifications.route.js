// backend/routes/notifications.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");

router.get("/", requireWallet, async (req, res, next) => {
  try {
    const me = await getOrCreateUser(req.wallet);
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
