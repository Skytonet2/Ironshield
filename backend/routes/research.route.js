// backend/routes/research.route.js
const express     = require("express");
const router      = express.Router();
const agent       = require("../services/agentConnector");
const cache       = require("../services/cacheService");
const { rateLimit } = require("../services/rateLimiter");
const tokenLookup = require("../services/tokenLookup");
const requireWallet = require("../middleware/requireWallet");

router.post("/", requireWallet, rateLimit("ai"), async (req, res) => {
  const { query, queryType, chain = "auto" } = req.body;
  if (!query) return res.status(400).json({ success: false, error: "query required" });

  const cacheKey = `research:${query}:${chain}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ success: true, cached: true, data: cached });
  try {
    // Step 1: Fetch REAL data from APIs
    const realData = await tokenLookup.lookup(query);

    // Step 2: Send real data to AI for analysis. wallet flows in so the
    // Day 5.3 budget gate can pre-check + post-record this caller's spend.
    const data = await agent.research({ query, queryType, chain, realData, wallet: req.wallet });
    cache.set(cacheKey, data, 900);
    res.json({ success: true, cached: false, data });
  } catch (err) {
    if (err.code === "ai-budget-exceeded") {
      return res.status(402).json({ success: false, error: err.code, used: err.used, cap: err.cap });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
