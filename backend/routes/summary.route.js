// backend/routes/summary.route.js
const express = require("express");
const router  = express.Router();
const agent   = require("../services/agentConnector");
const cache   = require("../services/cacheService");
const { rateLimit } = require("../services/rateLimiter");
const requireWallet = require("../middleware/requireWallet");

router.post("/", requireWallet, rateLimit("ai"), async (req, res) => {
  const { identifier, range, transcript, messageCount, requestedVia } = req.body;

  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ success: false, error: "No message transcript provided" });
  }

  const cacheKey = `summary:${identifier}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, cached: true, data: cached });

  try {
    const data = await agent.summarize({ identifier, range, transcript, messageCount });
    cache.set(cacheKey, data, 1800);
    res.json({ success: true, cached: false, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
