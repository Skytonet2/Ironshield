// backend/routes/feedOrg.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet } = require("../services/feedHelpers");
const { verifyTransfer } = require("../services/txVerify");

// POST /api/feed-org/register  body: { orgName, paymentTxHash }
router.post("/register", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { orgName, paymentTxHash } = req.body || {};
    if (!orgName || !paymentTxHash) return res.status(400).json({ error: "orgName + paymentTxHash required" });

    const check = await verifyTransfer({ txHash: paymentTxHash, signerId: req.wallet, minAmountNear: 100 });
    if (!check.ok) return res.status(402).json({ error: `Payment verification failed: ${check.reason}` });

    await db.query(
      `INSERT INTO feed_org_registrations (user_id, org_name, payment_tx, badge_granted)
       VALUES ($1,$2,$3,TRUE)`,
      [user.id, orgName, paymentTxHash]);
    await db.query(
      "UPDATE feed_users SET account_type='ORG', verified=TRUE, org_verified_at=NOW(), org_payment_tx=$1, display_name=COALESCE(display_name, $2) WHERE id=$3",
      [paymentTxHash, orgName, user.id]);
    res.json({ ok: true, badge: "ORG" });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM feed_org_registrations WHERE user_id=$1 ORDER BY paid_at DESC LIMIT 1", [req.params.id]);
    res.json({ org: r.rows[0] || null });
  } catch (e) { next(e); }
});

module.exports = router;
