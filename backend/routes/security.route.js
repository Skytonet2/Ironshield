// backend/routes/security.route.js
const express = require("express");
const router  = express.Router();
const db      = require("../db/client");

const KNOWN_SCAM_DOMAINS = ["drainer.xyz", "freecoins.io", "claimreward.net", "free-airdrop.com", "walletconnect-dapp.com"];

router.post("/check-link", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "url required" });
  try {
    const domain = new URL(url).hostname.replace("www.", "");

    // Check hardcoded list first
    let flagged = KNOWN_SCAM_DOMAINS.some(d => domain.includes(d));
    let reason = flagged ? "Known scam domain" : null;

    // Check database
    if (!flagged) {
      const { rows } = await db.query(
        "SELECT reason, severity FROM flagged_urls WHERE domain = $1 LIMIT 1",
        [domain]
      ).catch(() => ({ rows: [] }));
      if (rows.length) {
        flagged = true;
        reason = rows[0].reason;
      }
    }

    res.json({ success: true, data: { url, domain, flagged, reason } });
  } catch {
    res.json({ success: true, data: { url, flagged: true, reason: "Invalid or malformed URL" } });
  }
});

router.post("/check-wallet", async (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ success: false, error: "address required" });

  let flagged = false;
  let reason = null;

  // Check database
  const { rows } = await db.query(
    "SELECT reason, severity FROM flagged_wallets WHERE LOWER(address) = LOWER($1) LIMIT 1",
    [address]
  ).catch(() => ({ rows: [] }));

  if (rows.length) {
    flagged = true;
    reason = rows[0].reason;
  }

  res.json({ success: true, data: { address, flagged, reason } });
});

// POST /api/security/report — report a scam URL or wallet
router.post("/report", async (req, res) => {
  const { type, value, reason, reported_by } = req.body;
  if (!type || !value) return res.status(400).json({ success: false, error: "type and value required" });

  try {
    if (type === "url") {
      const domain = new URL(value).hostname.replace("www.", "");
      await db.query(
        "INSERT INTO flagged_urls (url, domain, reason, reported_by) VALUES ($1, $2, $3, $4)",
        [value, domain, reason || "User reported", reported_by]
      );
    } else if (type === "wallet") {
      await db.query(
        "INSERT INTO flagged_wallets (address, reason, reported_by) VALUES ($1, $2, $3) ON CONFLICT (address) DO NOTHING",
        [value, reason || "User reported", reported_by]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
