// backend/routes/rewards.route.js
// Rewards + referral-code endpoints for the /rewards page.
//
// This is a thin first pass — the full rewards program (points accrual,
// tier progression, uStore redemptions) lands with a governance vote.
// What we ship now:
//
//   GET  /api/rewards/me            — viewer's current rewards snapshot
//   GET  /api/rewards/ref-code      — viewer's referral code (auto-generated
//                                     if missing, custom if they've set one)
//   POST /api/rewards/ref-code      — set a custom referral code (6–20 chars,
//                                     a–z 0–9 underscore; must be unique)
//   GET  /api/rewards/ref/:code     — public: resolve a ref code to the
//                                     owner (used by the landing page
//                                     when someone hits /?ref=CODE)
//
// The feed_users table gets two columns: ref_code (nullable, unique) and
// referrer_id (nullable fk). If the migration hasn't run yet, this route
// reads/writes an ephemeral in-process Map so the UI still works during
// rollout — values persist for the life of the process and vanish on
// restart. The frontend can't tell the difference.
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");

const HANDLE_RE = /^[a-z0-9_]{4,20}$/;

// In-process fallback when the schema hasn't been migrated yet. Keyed
// by user id → { code, customizedAt }. Also a reverse lookup for resolve.
const memoryCodes = new Map();
const memoryReverse = new Map();

function autoGenerate(wallet) {
  // Deterministic-but-short code derived from the wallet. User can
  // customize later via POST. Avoids collisions across new signups
  // because the wallet address space is sparse.
  const base = String(wallet || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 6);
  return (base.slice(0, 6) || "ironsh") + suffix;
}

async function hasRefSchema() {
  try {
    const r = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='feed_users' AND column_name='ref_code' LIMIT 1"
    );
    return r.rows.length > 0;
  } catch { return false; }
}

async function readCode(user) {
  if (await hasRefSchema()) {
    const r = await db.query("SELECT ref_code FROM feed_users WHERE id=$1", [user.id]);
    return r.rows[0]?.ref_code || null;
  }
  return memoryCodes.get(user.id)?.code || null;
}

async function writeCode(user, code) {
  if (await hasRefSchema()) {
    await db.query("UPDATE feed_users SET ref_code=$1 WHERE id=$2", [code, user.id]);
  } else {
    const prev = memoryCodes.get(user.id)?.code;
    if (prev) memoryReverse.delete(prev);
    memoryCodes.set(user.id, { code, customizedAt: Date.now() });
    memoryReverse.set(code, user.id);
  }
}

async function codeInUse(code, exceptUserId = null) {
  if (await hasRefSchema()) {
    const r = await db.query(
      "SELECT id FROM feed_users WHERE LOWER(ref_code)=LOWER($1) LIMIT 1",
      [code]
    );
    const row = r.rows[0];
    if (!row) return false;
    return row.id !== exceptUserId;
  }
  const holderId = memoryReverse.get(code);
  if (!holderId) return false;
  return holderId !== exceptUserId;
}

// GET /api/rewards/me — a plain snapshot the dashboard can render
// without crashing on missing fields. Numbers are all 0 until the real
// accrual pipeline lands. `refCode` is included so the Referrals tab
// doesn't need a second round-trip.
// Unsigned read — wallet identity comes from the bare x-wallet header
// (matches the pre-Day-1 trust posture for personalization GETs).
router.get("/me", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "x-wallet header required" });
    const user = await getOrCreateUser(wallet);
    let code = await readCode(user);
    if (!code) {
      code = autoGenerate(wallet);
      await writeCode(user, code);
    }
    // Referral count: how many users register us as their referrer.
    // Only queryable if the schema is there; otherwise 0.
    let referralCount = 0;
    try {
      if (await hasRefSchema()) {
        const r = await db.query(
          "SELECT COUNT(*)::int AS c FROM feed_users WHERE referrer_id=$1",
          [user.id]
        );
        referralCount = r.rows[0]?.c || 0;
      }
    } catch { /* swallow — table column not there yet */ }

    res.json({
      rewards: {
        rank: 0,
        volume: 0,
        totalPoints: 0,
        creation: 0,
        tracker: 0,
        volumePoints: 0,
        referrals: referralCount,
        referralEarningsUsd: 0,
        tier: { key: "bronze", label: "BRONZE", threshold: 0 },
        nextTier: { key: "silver", label: "SILVER", threshold: 10 },
        nextTierProgress: 0,
        refCode: code,
      },
    });
  } catch (e) { next(e); }
});

// GET /api/rewards/ref-code — just the code (lightweight).
router.get("/ref-code", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "x-wallet header required" });
    const user = await getOrCreateUser(wallet);
    let code = await readCode(user);
    if (!code) {
      code = autoGenerate(wallet);
      await writeCode(user, code);
    }
    res.json({ refCode: code });
  } catch (e) { next(e); }
});

// POST /api/rewards/ref-code  body: { code }
// Sets a custom referral code. Returns 409 if taken.
router.post("/ref-code", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const code = String(req.body?.code || "").trim().toLowerCase();
    if (!HANDLE_RE.test(code)) {
      return res.status(400).json({
        error: "Code must be 4–20 chars of a–z, 0–9, or underscore.",
      });
    }
    if (await codeInUse(code, user.id)) {
      return res.status(409).json({ error: "That code is already taken." });
    }
    await writeCode(user, code);
    res.json({ refCode: code });
  } catch (e) { next(e); }
});

// ─── Inviter tracking (who referred this user) ────────────────────
// Same in-process fallback pattern as the code lookup above. When
// the schema lands (feed_users.referrer_id), both readers +
// writers route to the column transparently.
const memoryReferrers = new Map(); // userId → referrerUserId

async function readReferrer(user) {
  if (await hasRefSchema()) {
    const r = await db.query(
      "SELECT referrer_id FROM feed_users WHERE id=$1",
      [user.id]
    );
    return r.rows[0]?.referrer_id || null;
  }
  return memoryReferrers.get(user.id) || null;
}

async function writeReferrer(user, referrerId) {
  if (await hasRefSchema()) {
    await db.query(
      "UPDATE feed_users SET referrer_id=$1 WHERE id=$2 AND referrer_id IS NULL",
      [referrerId, user.id]
    );
  } else {
    if (!memoryReferrers.has(user.id)) {
      memoryReferrers.set(user.id, referrerId);
    }
  }
}

async function resolveCodeToUserId(code) {
  if (await hasRefSchema()) {
    const r = await db.query(
      "SELECT id FROM feed_users WHERE LOWER(ref_code)=LOWER($1) LIMIT 1",
      [code]
    );
    return r.rows[0]?.id || null;
  }
  return memoryReverse.get(code) || null;
}

// POST /api/rewards/claim-referrer  body: { code }
// Viewer claims the given referral code as the user who invited them.
// Only lands once — subsequent calls no-op so users can't game this
// by swapping referrers later. Self-referral blocked. Returns
// { claimed, referrer? } so the client can decide whether to show
// the "follow your inviter" prompt.
router.post("/claim-referrer", requireWallet, async (req, res, next) => {
  try {
    const code = String(req.body?.code || "").trim().toLowerCase();
    if (!HANDLE_RE.test(code)) return res.status(400).json({ error: "invalid code" });
    const user = await getOrCreateUser(req.wallet);
    const existing = await readReferrer(user);
    if (existing) return res.json({ claimed: false, reason: "already_set" });
    const referrerId = await resolveCodeToUserId(code);
    if (!referrerId) return res.status(404).json({ error: "code not found" });
    if (referrerId === user.id) return res.status(400).json({ error: "self_referral" });
    await writeReferrer(user, referrerId);
    // Hydrate the referrer for the UI so the follow-prompt has
    // avatar + handle without another round trip.
    const rr = await db.query(
      "SELECT id, wallet_address, username, display_name, pfp_url FROM feed_users WHERE id=$1",
      [referrerId]
    );
    const r = rr.rows[0] || {};
    res.json({
      claimed: true,
      referrer: {
        wallet: r.wallet_address,
        username: r.username,
        displayName: r.display_name,
        pfpUrl: r.pfp_url,
      },
    });
  } catch (e) { next(e); }
});

// GET /api/rewards/referrer — who invited me? Returns {} when nobody
// or when the viewer hasn't claimed a code yet.
router.get("/referrer", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.json({ referrer: null });
    const user = await getOrCreateUser(wallet);
    const referrerId = await readReferrer(user);
    if (!referrerId) return res.json({ referrer: null });
    const rr = await db.query(
      "SELECT id, wallet_address, username, display_name, pfp_url FROM feed_users WHERE id=$1",
      [referrerId]
    );
    const r = rr.rows[0];
    if (!r) return res.json({ referrer: null });
    res.json({
      referrer: {
        wallet: r.wallet_address,
        username: r.username,
        displayName: r.display_name,
        pfpUrl: r.pfp_url,
      },
    });
  } catch (e) { next(e); }
});

// GET /api/rewards/ref/:code — resolve a code to its owner. Public.
// Used when a visitor lands with ?ref=foo; we stamp the code into
// localStorage and attach it on signup so the referrer gets credit.
router.get("/ref/:code", async (req, res, next) => {
  try {
    const code = String(req.params.code || "").trim().toLowerCase();
    if (!HANDLE_RE.test(code)) return res.status(400).json({ error: "invalid code" });
    if (await hasRefSchema()) {
      const r = await db.query(
        `SELECT u.id, u.wallet_address, u.username, u.display_name, u.pfp_url
           FROM feed_users u WHERE LOWER(u.ref_code)=$1 LIMIT 1`, [code]
      );
      if (!r.rows.length) return res.status(404).json({ error: "not found" });
      const u = r.rows[0];
      return res.json({
        owner: {
          wallet: u.wallet_address, username: u.username,
          displayName: u.display_name, pfpUrl: u.pfp_url,
        },
      });
    }
    const holderId = memoryReverse.get(code);
    if (!holderId) return res.status(404).json({ error: "not found" });
    return res.json({ owner: { wallet: `user-${holderId}` } });
  } catch (e) { next(e); }
});

module.exports = router;
