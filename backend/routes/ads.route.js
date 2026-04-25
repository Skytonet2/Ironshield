// backend/routes/ads.route.js — $5/week post promotion
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");

// POST /api/ads/create  body: { postId, paymentTxHash }
router.post("/create", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { postId, paymentTxHash } = req.body || {};
    if (!postId || !paymentTxHash) return res.status(400).json({ error: "postId + paymentTxHash required" });
    const own = await db.query("SELECT id FROM feed_posts WHERE id=$1 AND author_id=$2", [postId, user.id]);
    if (!own.rows.length) return res.status(403).json({ error: "you can only boost your own posts" });
    const end = new Date(Date.now() + 7 * 86400_000);
    const r = await db.query(
      `INSERT INTO feed_ad_campaigns (user_id, post_id, budget_cents, end_date, payment_tx)
       VALUES ($1,$2,500,$3,$4) RETURNING *`,
      [user.id, postId, end, paymentTxHash]);
    res.json({ campaign: r.rows[0] });
  } catch (e) { next(e); }
});

// GET /api/ads/active — internal use by feed engine
router.get("/active", async (req, res, next) => {
  try {
    const r = await db.query(
      "SELECT * FROM feed_ad_campaigns WHERE active=TRUE AND (end_date IS NULL OR end_date > NOW())");
    res.json({ campaigns: r.rows });
  } catch (e) { next(e); }
});

// public: anonymous click-through counter — increments a single column,
// no per-user state. Day 5 may add IP-based rate limiting if abuse appears.
router.post("/impression", async (req, res, next) => {
  try {
    const { campaignId } = req.body || {};
    if (!campaignId) return res.status(400).json({ error: "campaignId required" });
    await db.query("UPDATE feed_ad_campaigns SET impressions = impressions + 1 WHERE id=$1", [campaignId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/ads/mine — user's own boosted posts (with impression counts)
router.get("/mine", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const r = await db.query(
      "SELECT * FROM feed_ad_campaigns WHERE user_id=$1 ORDER BY start_date DESC LIMIT 50", [user.id]);
    res.json({ campaigns: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
