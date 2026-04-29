// backend/routes/admin.route.js
// Endpoints scoped to admin actions. /check is the auth probe;
// /stats is the operator-eyes-only health snapshot.
const express = require("express");
const router  = express.Router();
const db = require("../db/client");
const requireWallet = require("../middleware/requireWallet");
const requireAdmin  = require("../middleware/requireAdmin");

// POST /api/admin/check
// Signed-auth required. Returns { admin: true, role } if req.wallet is in
// admin_wallets, otherwise 403 (via requireAdmin). Used by AdminPanel.jsx
// on mount to decide whether to render the panel or a "Not authorized" view.
//
// Modeled as POST (not GET) because apiFetch only signs mutating verbs;
// GET would arrive without auth headers. The handler doesn't write — it's
// effectively a "who am I?" probe.
router.post("/check", requireWallet, requireAdmin, (req, res) => {
  res.json({ admin: true, role: req.adminRole });
});

// POST /api/admin/stats
// Signed-auth + admin-only. Aggregate counts across the live DB so an
// operator can answer "how many users / posts / sales do we have?"
// without needing direct Postgres access. All counts run in parallel;
// any individual COUNT failing falls back to null so a partial schema
// (e.g. an older deploy missing a newer table) doesn't 500 the whole
// response.
//
// POST (not GET) for the same signed-mutation reason as /check.
router.post("/stats", requireWallet, requireAdmin, async (_req, res, next) => {
  try {
    const safe = (sql) =>
      db.query(sql).then((r) => Number(r.rows[0]?.c ?? 0)).catch(() => null);

    const [
      users, usersOnboarded, usersActive7d, usersNew24h,
      posts, comments, dms, follows,
      newscoins, newscoinTrades,
      skillSales, automations,
    ] = await Promise.all([
      safe("SELECT COUNT(*)::int AS c FROM feed_users"),
      safe("SELECT COUNT(*)::int AS c FROM feed_users WHERE onboarded_at IS NOT NULL"),
      safe("SELECT COUNT(*)::int AS c FROM feed_users WHERE last_seen_at >= NOW() - INTERVAL '7 days'"),
      safe("SELECT COUNT(*)::int AS c FROM feed_users WHERE created_at >= NOW() - INTERVAL '24 hours'"),
      safe("SELECT COUNT(*)::int AS c FROM feed_posts WHERE deleted_at IS NULL"),
      safe("SELECT COUNT(*)::int AS c FROM feed_comments"),
      safe("SELECT COUNT(*)::int AS c FROM feed_dms"),
      safe("SELECT COUNT(*)::int AS c FROM feed_follows"),
      safe("SELECT COUNT(*)::int AS c FROM feed_newscoins"),
      safe("SELECT COUNT(*)::int AS c FROM feed_newscoin_trades"),
      safe("SELECT COUNT(*)::int AS c FROM skill_sales"),
      safe("SELECT COUNT(*)::int AS c FROM agent_automations"),
    ]);

    res.json({
      ts: new Date().toISOString(),
      users: {
        total: users,
        onboarded: usersOnboarded,
        active7d: usersActive7d,
        new24h: usersNew24h,
      },
      feed: { posts, comments, dms, follows },
      newscoin: { total: newscoins, trades: newscoinTrades },
      skills: { sales: skillSales },
      agents: { automations },
    });
  } catch (e) { next(e); }
});

// GET /api/admin/event-counters — connector-activity telemetry. Admin
// allowlist only (operator visibility, not user-facing). Labels are
// connector names / kit slugs — never wallets.
router.get("/event-counters", requireWallet, requireAdmin, async (req, res, next) => {
  try {
    const telemetry = require("../services/telemetry");
    const limit = Number(req.query.limit) || 200;
    const counters = await telemetry.list({ limit });
    res.json({ counters });
  } catch (e) { next(e); }
});

module.exports = router;
