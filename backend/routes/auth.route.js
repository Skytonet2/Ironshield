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

module.exports = router;
