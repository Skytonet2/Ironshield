// backend/routes/admin.route.js
// Endpoints scoped to admin actions. Today only /check; Day 5+ may add
// per-wallet AI budget management here.
const express = require("express");
const router  = express.Router();
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

module.exports = router;
