// backend/routes/security.route.js
const express = require("express");
const router  = express.Router();

const KNOWN_SCAM_DOMAINS = ["drainer.xyz", "freecoins.io", "claimreward.net"];
const KNOWN_SCAM_WALLETS = [];

router.post("/check-link", (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "url required" });
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    const flagged = KNOWN_SCAM_DOMAINS.some(d => domain.includes(d));
    res.json({ success: true, data: { url, flagged, domain, reason: flagged ? "Known scam domain" : null } });
  } catch {
    res.json({ success: true, data: { url, flagged: true, reason: "Invalid or malformed URL" } });
  }
});

router.post("/check-wallet", (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ success: false, error: "address required" });
  const flagged = KNOWN_SCAM_WALLETS.includes(address.toLowerCase());
  res.json({ success: true, data: { address, flagged, reason: flagged ? "Known scam wallet" : null } });
});

module.exports = router;
