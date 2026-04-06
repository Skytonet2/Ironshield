// backend/routes/research.route.js
const express = require("express");
const router  = express.Router();
const agent   = require("../services/agentConnector");
const cache   = require("../services/cacheService");
const limiter = require("../services/rateLimiter");

router.post("/", async (req, res) => {
  const { query, queryType, userId, chain = "auto" } = req.body;
  if (!query || !userId) return res.status(400).json({ success: false, error: "query and userId required" });

  const limit = limiter.check(userId, "research");
  if (!limit.allowed) return res.status(429).json({ success: false, error: `Rate limit hit. Retry in ${limit.retryAfter}s` });

  const key    = `research:${query}:${chain}`;
  const cached = cache.get(key);
  if (cached) return res.json({ success: true, cached: true, data: cached });

  limiter.consume(userId, "research");
  try {
    const data = await agent.research({ query, queryType, chain });
    cache.set(key, data, 900);
    res.json({ success: true, cached: false, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
