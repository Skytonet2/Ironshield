// backend/routes/push.route.js — Push subscription management
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet } = require("../services/feedHelpers");

// GET /api/push/vapid-key — public VAPID key for the frontend
router.get("/vapid-key", (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || "";
  if (!key) return res.status(503).json({ error: "Push not configured" });
  res.json({ publicKey: key });
});

// POST /api/push/subscribe — store a push subscription
// body: { subscription: PushSubscription JSON }
router.post("/subscribe", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const sub = req.body?.subscription;
    if (!sub?.endpoint) return res.status(400).json({ error: "subscription required" });

    const subJson = JSON.stringify(sub);
    // Upsert by endpoint so re-subscribing doesn't duplicate
    await db.query(
      `INSERT INTO feed_push_subscriptions (user_id, endpoint, subscription)
       VALUES ($1, $2, $3)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, subscription = $3, updated_at = NOW()`,
      [user.id, sub.endpoint, subJson]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/push/unsubscribe — remove a subscription
// body: { endpoint }
router.post("/unsubscribe", requireWallet, async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: "endpoint required" });
    await db.query("DELETE FROM feed_push_subscriptions WHERE endpoint = $1", [endpoint]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
