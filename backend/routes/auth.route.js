// backend/routes/auth.route.js
// Public endpoint that issues fresh nonces consumed by the requireWallet
// middleware. Spec: docs/auth-contract.md §3.
const express = require("express");
const crypto  = require("crypto");
const router  = express.Router();
const db      = require("../db/client");
const { rateLimit } = require("../services/rateLimiter");
const requireWallet = require("../middleware/requireWallet");
const wsTicket = require("../services/wsTicket");
const sessionToken = require("../services/sessionToken");
const requirePro = require("../middleware/requirePro");

// /login MUST run on a fresh signature — accepting a token here would
// let a stolen token mint a fresh one and never expire. Build a
// signature-only variant of the middleware for this single route.
const requireSignedWallet = requireWallet.makeRequireWallet({ allowToken: false });

const TTL_MS = 5 * 60 * 1000;

router.get("/nonce", rateLimit("nonce"), async (_req, res, next) => {
  try {
    const nonce = crypto.randomBytes(32).toString("base64url");
    await db.query("INSERT INTO auth_nonces (nonce) VALUES ($1)", [nonce]);
    res.json({ nonce, expiresAt: Date.now() + TTL_MS });
  } catch (err) { next(err); }
});

// POST /api/auth/ws-ticket — exchanges one signed REST call for a
// short-lived HMAC ticket the client presents on the WS auth message.
// Without this hop, /ws/feed has no way to verify the claimed wallet:
// the connection itself can't run NEP-413, and signing every reconnect
// would surface a wallet popup.
router.post("/ws-ticket", requireWallet, (req, res) => {
  const { ticket, expMs } = wsTicket.issue(req.wallet);
  res.json({ ticket, expiresAt: expMs });
});

// POST /api/auth/login — signed-once entry that mints a 24h session
// token. The client stores the token and presents it as
// `Authorization: Bearer <token>` on subsequent mutating calls,
// bypassing per-action signMessage popups.
router.post("/login", requireSignedWallet, (req, res) => {
  const { token, expMs } = sessionToken.issue(req.wallet);
  res.json({ token, expiresAt: expMs, wallet: req.wallet });
});

// GET /api/auth/me — Day 18.3 identity surface. Returns the caller's
// wallet plus the two off-chain capability flags AppShell needs to
// render: isPro (drives the PRO pill, AI budget badge) and isAdmin
// (drives the AdminPanel gate). Both flags are derived from public
// on-chain / DB state, so the endpoint reads the unsigned x-wallet
// header rather than NEP-413 — every page nav doesn't need a
// wallet popup just to render a badge. The badge rendering is
// cosmetic; the real Pro/admin gate is enforced server-side by
// requirePro / requireAdmin on every protected route. Falls back to
// {isPro:false} on RPC errors so a chain blip doesn't blank the
// badge for everyone.
router.get("/me", async (req, res) => {
  const wallet = String(req.header("x-wallet") || "").toLowerCase().trim();
  if (!wallet) return res.json({ wallet: null, isPro: false, isAdmin: false });
  let isPro = false;
  try { isPro = await requirePro.isPro(wallet); }
  catch (err) { console.warn("[/api/auth/me] is_pro failed:", err.message); }
  let isAdmin = false;
  try {
    const r = await db.query("SELECT 1 FROM admin_wallets WHERE wallet = $1 LIMIT 1", [wallet]);
    isAdmin = r.rows.length > 0;
  } catch (err) { console.warn("[/api/auth/me] admin lookup failed:", err.message); }
  res.json({ wallet, isPro, isAdmin });
});

module.exports = router;
