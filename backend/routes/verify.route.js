// backend/routes/verify.route.js
const express = require("express");
const router  = express.Router();
const agent   = require("../services/agentConnector");
const cache   = require("../services/cacheService");
const { rateLimit } = require("../services/rateLimiter");
const requireWallet = require("../middleware/requireWallet");

router.post("/", requireWallet, rateLimit("ai"), async (req, res) => {
  const { claim, context, relatedContract } = req.body;
  if (!claim) return res.status(400).json({ success: false, error: "claim required" });

  const cacheKey = `verify:${Buffer.from(claim).toString("base64").slice(0, 40)}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, cached: true, data: cached });

  try {
    const data = await agent.verify({ claim, context, relatedContract, wallet: req.wallet });
    cache.set(cacheKey, data, 3600);
    res.json({ success: true, cached: false, data });
  } catch (err) {
    if (err.code === "ai-budget-exceeded") {
      return res.status(402).json({ success: false, error: err.code, used: err.used, cap: err.cap });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
