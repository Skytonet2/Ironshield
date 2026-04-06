// backend/routes/summary.route.js
const express = require("express");
const router  = express.Router();
const agent   = require("../services/agentConnector");
const cache   = require("../services/cacheService");
const limiter = require("../services/rateLimiter");

router.post("/", async (req, res) => {
  const { source, identifier, range, userId, requestedVia } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: "userId required" });

  const limit = limiter.check(userId, "summary");
  if (!limit.allowed) return res.status(429).json({ success: false, error: `Rate limit hit. Retry in ${limit.retryAfter}s` });

  const key    = `summary:${identifier}:${range}`;
  const cached = cache.get(key);
  if (cached) return res.json({ success: true, cached: true, data: cached });

  limiter.consume(userId, "summary");
  try {
    const data = await agent.summarize({ source, identifier, range });
    cache.set(key, data, 1800);
    res.json({ success: true, cached: false, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
