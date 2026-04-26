// backend/routes/push.route.js — Push subscription management
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");
const { notifyUser } = require("../services/pushNotify");

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

// POST /api/push/test — fire a test push to the caller's own
// subscriptions so they can verify the flow end-to-end without
// waiting for someone else to like/comment. Returns the number of
// subscriptions pushed to so the UI can tell the user whether they
// actually have a device enrolled.
router.post("/test", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const r = await db.query(
      "SELECT COUNT(*)::int AS n FROM feed_push_subscriptions WHERE user_id = $1",
      [user.id]
    );
    const count = r.rows[0]?.n || 0;
    if (count === 0) {
      return res.status(409).json({
        ok: false,
        reason: "no_subscriptions",
        message: "No push subscription on file for this wallet. Enable Push first.",
      });
    }
    await notifyUser(user.id, {
      title: "IronShield",
      body: "Push is working — you'll see real alerts here.",
      url: "/",
      tag: "test",
    });
    res.json({ ok: true, pushedTo: count });
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
