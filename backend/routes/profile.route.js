// backend/routes/profile.route.js
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");

// GET /api/profile/me — viewer's own profile, used by the onboarding
// modal trigger. Includes `onboardedAt` so the frontend can decide
// whether to show the welcome flow. Unsigned read keyed by x-wallet
// header (matches /api/rewards/me posture).
router.get("/me", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "x-wallet header required" });
    const user = await getOrCreateUser(wallet);
    res.json({
      user: {
        id: user.id,
        walletAddress: user.wallet_address,
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        pfpUrl: user.pfp_url,
        bannerUrl: user.banner_url,
        accountType: user.account_type,
        verified: user.verified,
        onboardedAt: user.onboarded_at || null,
      },
    });
  } catch (e) { next(e); }
});

// POST /api/profile/onboard — atomic "save profile + mark onboarded".
// Body matches PATCH /api/profile plus the implicit completion stamp.
// Username + displayName required; pfpUrl and bannerUrl optional.
// Wrapping in a transaction so a duplicate-username 409 doesn't leave
// the user half-onboarded with their pfp set but no name.
router.post("/onboard", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const username    = String(req.body?.username    || "").trim();
    const displayName = String(req.body?.displayName || "").trim();
    const pfpUrl      = req.body?.pfpUrl    ? String(req.body.pfpUrl)    : null;
    const bannerUrl   = req.body?.bannerUrl ? String(req.body.bannerUrl) : null;

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: "Username must be 3–24 chars of letters, digits, or underscore.",
      });
    }
    if (displayName.length < 1 || displayName.length > 40) {
      return res.status(400).json({ error: "Display name must be 1–40 characters." });
    }

    const r = await db.query(
      `UPDATE feed_users SET
         username     = $2,
         display_name = $3,
         pfp_url      = COALESCE($4, pfp_url),
         banner_url   = COALESCE($5, banner_url),
         onboarded_at = NOW()
       WHERE id=$1 RETURNING *`,
      [user.id, username, displayName, pfpUrl, bannerUrl]
    );
    res.json({ user: r.rows[0] });
  } catch (e) {
    if (String(e.message).includes("duplicate") || String(e.code) === "23505") {
      return res.status(409).json({ error: "Username taken" });
    }
    next(e);
  }
});

// GET /api/profile/:walletOrUsername
router.get("/:key", async (req, res, next) => {
  try {
    const k = req.params.key.toLowerCase();
    const r = await db.query(
      "SELECT * FROM feed_users WHERE LOWER(wallet_address)=$1 OR LOWER(username)=$1 LIMIT 1", [k]);
    if (!r.rows.length) return res.status(404).json({ error: "user not found" });
    const u = r.rows[0];
    const [followers, following, posts] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS c FROM feed_follows WHERE following_id=$1", [u.id]),
      db.query("SELECT COUNT(*)::int AS c FROM feed_follows WHERE follower_id=$1",  [u.id]),
      db.query("SELECT COUNT(*)::int AS c FROM feed_posts   WHERE author_id=$1 AND deleted_at IS NULL", [u.id]),
    ]);
    res.json({
      user: {
        id: u.id, walletAddress: u.wallet_address, username: u.username,
        displayName: u.display_name, bio: u.bio, pfpUrl: u.pfp_url, bannerUrl: u.banner_url,
        accountType: u.account_type, verified: u.verified, dmPubkey: u.dm_pubkey,
        followers: followers.rows[0].c, following: following.rows[0].c, posts: posts.rows[0].c,
      },
    });
  } catch (e) { next(e); }
});

// PATCH /api/profile  body: { displayName, bio, pfpUrl, bannerUrl, username }
router.patch("/", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { displayName, bio, pfpUrl, bannerUrl, username } = req.body || {};
    const r = await db.query(
      `UPDATE feed_users SET
         display_name = COALESCE($2, display_name),
         bio          = COALESCE($3, bio),
         pfp_url      = COALESCE($4, pfp_url),
         banner_url   = COALESCE($5, banner_url),
         username     = COALESCE($6, username)
       WHERE id=$1 RETURNING *`,
      [user.id, displayName, bio, pfpUrl, bannerUrl, username]);
    res.json({ user: r.rows[0] });
  } catch (e) {
    if (String(e.message).includes("duplicate")) return res.status(409).json({ error: "username taken" });
    next(e);
  }
});

// POST /api/profile/upload — Cloudinary signed-upload params
router.post("/upload", requireWallet, async (req, res) => {
  const cloud  = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !secret) {
    return res.status(503).json({ error: "Cloudinary not configured", hint: "set CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET" });
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "ironfeed";
  const toSign = `folder=${folder}&timestamp=${timestamp}${secret}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");
  res.json({
    cloudName: cloud, apiKey, timestamp, folder, signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloud}/auto/upload`,
  });
});

// POST /api/profile/dm-pubkey  body: { pubkey }
// Publishes the user's Curve25519 public key so peers can encrypt DMs to them.
router.post("/dm-pubkey", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { pubkey } = req.body || {};
    if (!pubkey) return res.status(400).json({ error: "pubkey required" });
    await db.query("UPDATE feed_users SET dm_pubkey=$1 WHERE id=$2", [pubkey, user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/profile/grant-delegate body: { pubkey }
// Records that the user has granted the platform a function-call access key.
router.post("/grant-delegate", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { pubkey } = req.body || {};
    if (!pubkey) return res.status(400).json({ error: "pubkey required" });
    await db.query("UPDATE feed_users SET delegate_pubkey=$1 WHERE id=$2", [pubkey, user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/profile/:userId/posts
router.get("/:userId/posts", async (req, res, next) => {
  try {
    const r = await db.query(
      "SELECT * FROM feed_posts WHERE author_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50",
      [req.params.userId]);
    const { hydratePosts } = require("../services/feedHelpers");
    const wallet = req.header("x-wallet");
    const viewer = wallet ? await getOrCreateUser(wallet) : null;
    res.json({ posts: await hydratePosts(r.rows, viewer?.id) });
  } catch (e) { next(e); }
});

module.exports = router;
