// backend/routes/auth.route.js
// Public endpoint that issues fresh nonces consumed by the requireWallet
// middleware. Spec: docs/auth-contract.md §3.
const express = require("express");
const crypto  = require("crypto");
const router  = express.Router();
const db      = require("../db/client");

const TTL_MS = 5 * 60 * 1000;

router.get("/nonce", async (_req, res, next) => {
  try {
    const nonce = crypto.randomBytes(32).toString("base64url");
    await db.query("INSERT INTO auth_nonces (nonce) VALUES ($1)", [nonce]);
    res.json({ nonce, expiresAt: Date.now() + TTL_MS });
  } catch (err) { next(err); }
});

module.exports = router;
