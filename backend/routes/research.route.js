// backend/routes/research.route.js
const express     = require("express");
const router      = express.Router();
const agent       = require("../services/agentConnector");
const cache       = require("../services/cacheService");
const limiter     = require("../services/rateLimiter");
const tokenLookup = require("../services/tokenLookup");
const requireWallet = require("../middleware/requireWallet");

router.post("/", requireWallet, async (req, res) => {
  const { query, queryType, chain = "auto" } = req.body;
  const userId = req.wallet;
  if (!query) return res.status(400).json({ success: false, error: "query required" });

  const limit = limiter.check(userId, "research");
  if (!limit.allowed) return res.status(429).json({ success: false, error: `Rate limit hit. Retry in ${limit.retryAfter}s` });

  const key    = `research:${query}:${chain}`;
  const cached = cache.get(key);
  if (cached) return res.json({ success: true, cached: true, data: cached });

  limiter.consume(userId, "research");
  try {
    // Step 1: Fetch REAL data from APIs
    const realData = await tokenLookup.lookup(query);

    // Step 2: Send real data to AI for analysis
    const data = await agent.research({ query, queryType, chain, realData });
    cache.set(key, data, 900);
    res.json({ success: true, cached: false, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
