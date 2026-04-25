// backend/routes/verify.route.js
const express = require("express");
const router  = express.Router();
const agent   = require("../services/agentConnector");
const cache   = require("../services/cacheService");
const limiter = require("../services/rateLimiter");
const requireWallet = require("../middleware/requireWallet");

router.post("/", requireWallet, async (req, res) => {
  const { claim, context, relatedContract } = req.body;
  const userId = req.wallet;
  if (!claim) return res.status(400).json({ success: false, error: "claim required" });

  const limit = limiter.check(userId, "verify");
  if (!limit.allowed) return res.status(429).json({ success: false, error: `Rate limit hit. Retry in ${limit.retryAfter}s` });

  const key    = `verify:${Buffer.from(claim).toString("base64").slice(0, 40)}`;
  const cached = cache.get(key);
  if (cached) return res.json({ success: true, cached: true, data: cached });

  limiter.consume(userId, "verify");
  try {
    const data = await agent.verify({ claim, context, relatedContract });
    cache.set(key, data, 3600);
    res.json({ success: true, cached: false, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
