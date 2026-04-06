// backend/routes/trending.route.js
const express       = require("express");
const router        = express.Router();
const socialMonitor = require("../services/socialMonitor");

router.get("/", async (req, res) => {
  try {
    const trending = await socialMonitor.getTrending();
    res.json({ success: true, data: trending });
  } catch (err) {
    console.error("[Trending] Error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

// Twitter search endpoint (requires TWITTER_BEARER_TOKEN)
router.get("/twitter", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ success: false, error: "Provide ?q=search_term" });
    const result = await socialMonitor.searchTwitter(query);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("[Twitter] Error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
