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

// POST /api/admin/classifieds-drift/run — fire the drift check for
// every configured classifieds site on demand. Heavyweight (spawns
// Chromium per site, ~10s each, serial via the connector mutex).
// Operator should call this when investigating empty-result reports
// from a Realtor / Car-Sales kit. Weekly cron lands separately in
// classifiedsDrift.start().
router.post("/classifieds-drift/run", requireWallet, requireAdmin, async (req, res, next) => {
  try {
    const drift = require("../services/classifiedsDrift");
    const out = await drift.runOnce();
    res.json(out);
  } catch (e) { next(e); }
});

// ── Phase 10 Tier 5 slice 3 — skill moderation ───────────────────────
// Admin-only operations on skill_runtime_manifests. Three actions:
//   - lifecycle  : flip lifecycle_status (curated/public/deprecated/...)
//   - pin        : promote one version to runtime status='active' and
//                  demote others (the only path that touches runtime
//                  status; see project_skill_status_columns memory)
//   - slash      : off-chain mark as removed (lifecycle_status='slashed').
//                  The contract has no slash_skill method yet, so this
//                  is purely a catalog-layer takedown — runtime that
//                  reads from the manifest table will hide the row.
//                  When the contract gets slash_skill, this handler
//                  should be extended to fire that call too.
const { setLifecycleStatus, pinVersion } = require("../services/skillManifests");

/** GET /api/admin/skills?lifecycle=public,curated&limit=100&cursor=<id>
 *  Paged moderation queue. Reads from skill_runtime_manifests with
 *  optional lifecycle_status filter; defaults to "internal,curated"
 *  so brand-new submissions show up first.
 */
router.get("/skills", requireWallet, requireAdmin, async (req, res, next) => {
  try {
    const lifecycles = String(req.query.lifecycle || "internal,curated")
      .split(",").map(s => s.trim()).filter(Boolean);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;

    const params = [lifecycles];
    let where = "lifecycle_status = ANY($1::text[])";
    if (cursor && Number.isFinite(cursor)) {
      params.push(cursor);
      where += ` AND id < $${params.length}`;
    }
    params.push(limit + 1);

    const r = await db.query(
      `SELECT id, skill_id, version, name, description, category,
              vertical_tags, manifest_hash,
              status, lifecycle_status, deployed_at
         FROM skill_runtime_manifests
        WHERE ${where}
        ORDER BY id DESC
        LIMIT $${params.length}`,
      params
    );
    const hasMore = r.rows.length > limit;
    const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
    res.json({ rows, nextCursor: hasMore ? rows[rows.length - 1].id : null });
  } catch (e) { next(e); }
});

/** POST /api/admin/skills/:skill_id/lifecycle
 *  Body: { version: string, lifecycle_status: string, reason?: string }
 *
 *  Writes ONLY skill_runtime_manifests.lifecycle_status. Does not
 *  touch the runtime status column — see the two-status-columns memo
 *  in project_skill_status_columns. Use /pin to change runtime
 *  active-version, /slash for the takedown shortcut.
 */
router.post("/skills/:skill_id/lifecycle", requireWallet, requireAdmin, async (req, res, next) => {
  try {
    const skillId = Number(req.params.skill_id);
    const { version, lifecycle_status } = req.body || {};
    if (!Number.isFinite(skillId)) return res.status(400).json({ error: "skill_id must be an integer" });
    if (!version)                   return res.status(400).json({ error: "version required" });
    if (!lifecycle_status)          return res.status(400).json({ error: "lifecycle_status required" });

    const row = await setLifecycleStatus(skillId, version, lifecycle_status);
    if (!row) return res.status(404).json({ error: "manifest version not found" });
    res.json({ ok: true, ...row, by: req.wallet });
  } catch (e) {
    if (/Invalid lifecycle_status/.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

/** POST /api/admin/skills/:skill_id/pin
 *  Body: { version: string }
 *
 *  Promote the named version to runtime status='active' and demote
 *  all other versions of the same skill to status='inactive'. Single
 *  transaction so reads never see zero active versions.
 *  This is the ONE admin path that mutates the runtime status column;
 *  it's exactly that column's purpose.
 */
router.post("/skills/:skill_id/pin", requireWallet, requireAdmin, async (req, res, next) => {
  try {
    const skillId = Number(req.params.skill_id);
    const { version } = req.body || {};
    if (!Number.isFinite(skillId)) return res.status(400).json({ error: "skill_id must be an integer" });
    if (!version)                   return res.status(400).json({ error: "version required" });

    const row = await pinVersion(skillId, version);
    if (!row) return res.status(404).json({ error: "manifest version not found" });
    res.json({ ok: true, ...row, by: req.wallet });
  } catch (e) { next(e); }
});

/** POST /api/admin/skills/:skill_id/slash
 *  Body: { version: string, reason?: string }
 *
 *  Off-chain takedown shortcut. Sets lifecycle_status='slashed' which
 *  hides the row from the public catalog. Runtime callers that look up
 *  by skill_id will still find an active manifest version (status=
 *  'active') — slash does NOT stop in-flight executions, only hides
 *  the listing. To halt execution, also POST /pin to a different
 *  version (or none — pin's transaction permits demoting all to
 *  inactive by passing a version that doesn't match any row, though
 *  that's not a designed shape; recommend explicit version-pin).
 *
 *  When contract gains slash_skill (future phase), this handler
 *  should also fire that call so the on-chain reputation effect lands.
 */
router.post("/skills/:skill_id/slash", requireWallet, requireAdmin, async (req, res, next) => {
  try {
    const skillId = Number(req.params.skill_id);
    const { version } = req.body || {};
    if (!Number.isFinite(skillId)) return res.status(400).json({ error: "skill_id must be an integer" });
    if (!version)                   return res.status(400).json({ error: "version required" });

    const row = await setLifecycleStatus(skillId, version, "slashed");
    if (!row) return res.status(404).json({ error: "manifest version not found" });
    res.json({ ok: true, ...row, by: req.wallet, note: "off-chain takedown only; contract slash_skill not yet wired" });
  } catch (e) { next(e); }
});

module.exports = router;
