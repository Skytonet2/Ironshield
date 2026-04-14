// backend/routes/feedNews.route.js
// Returns a small curated list of "Today's News" for the IronFeed right rail.
// Pulls from the same alpha-feed cache the Alpha tab uses, trimmed to 5 items.
const express = require("express");
const router = express.Router();

let cache = { ts: 0, items: [] };
const TTL_MS = 5 * 60 * 1000;

router.get("/", async (req, res) => {
  if (Date.now() - cache.ts < TTL_MS && cache.items.length) {
    return res.json({ news: cache.items });
  }
  try {
    // Reuse the alpha route's data source if available.
    const backend = `http://127.0.0.1:${process.env.BACKEND_PORT || 3001}`;
    const r = await fetch(`${backend}/api/alpha/feed`);
    const j = await r.json().catch(() => ({}));
    const items = (j.feed || j.items || []).slice(0, 5).map(i => ({
      title: i.title || i.headline || i.content?.slice(0, 80),
      source: i.source || i.category || "Alpha",
      posts: i.upvotes || i.score || 0,
      url: i.url || null,
      createdAt: i.createdAt || i.timestamp,
    }));
    cache = { ts: Date.now(), items };
    res.json({ news: items });
  } catch (e) {
    res.json({ news: [] });
  }
});

module.exports = router;
