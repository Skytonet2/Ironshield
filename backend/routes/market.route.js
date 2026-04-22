// backend/routes/market.route.js
//
// Market-wide signals that drive the feed's right-rail widgets.
// Sentiment derives from on-chain + social signals aggregated by
// socialMonitor + trendingAgent. Deliberately cheap — no LLM calls
// and no external indexer dependencies, just math over what the
// other services already collect.

const express = require("express");
const router = express.Router();

// Safe optional imports — the endpoint degrades to a neutral
// response rather than 500ing when a producer hasn't started.
let socialMonitor = null;
try { socialMonitor = require("../services/socialMonitor"); } catch {}
let trendingAgent = null;
try { trendingAgent = require("../services/trendingAgent"); } catch {}

// GET /api/market/sentiment
//
// Returns:
// {
//   score: 0..100,      // aggregate bull-bear score
//   label: "Bullish"|"Neutral"|"Bearish",
//   delta: <int>,       // 24h change in score (pts)
//   narratives: [ { tag, change } x 4..5 ]
// }
router.get("/sentiment", async (req, res) => {
  try {
    // ── Trending coin data (CoinGecko) gives us price-movement
    //    bullishness. socialMonitor caches this, so the call is
    //    usually instant.
    let coins = [];
    try {
      if (socialMonitor?.getTrending) {
        coins = await socialMonitor.getTrending();
      }
    } catch { /* use default */ }

    // ── Score: mean 24h change of the top 10 trending, clamped
    //    into 0..100 via a logistic. Positive move → bullish,
    //    negative → bearish. Null coin data → neutral 50.
    let score = 50;
    let delta = 0;
    if (Array.isArray(coins) && coins.length > 0) {
      const changes = coins
        .slice(0, 10)
        .map((c) => Number(c.change_24h || c.price_change_percentage_24h || 0))
        .filter((n) => Number.isFinite(n));
      if (changes.length) {
        const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
        // Map [-20, +20] → [0, 100] via linear + clamp.
        score = Math.round(Math.max(0, Math.min(100, 50 + mean * 2.5)));
        delta = Math.round(mean); // already roughly points/day
      }
    }
    const label = score >= 60 ? "Bullish" : score <= 40 ? "Bearish" : "Neutral";

    // ── Narratives: pull agent-driven trending topics, strip the
    //    category prefix, turn count deltas into %. If the agent
    //    hasn't booted yet, fall back to the coin list names.
    let narratives = [];
    try {
      if (trendingAgent?.getTopics) {
        const topics = await trendingAgent.getTopics(6);
        narratives = topics.map((t) => {
          const changePct = t.count_prev > 0
            ? ((t.count - t.count_prev) / t.count_prev) * 100
            : (t.count > 0 ? 100 : 0);
          return {
            tag: formatTag(t.tag, t.kind),
            change: Number(changePct.toFixed(1)),
          };
        });
      }
    } catch { /* continue to fallback */ }
    if (narratives.length === 0 && Array.isArray(coins)) {
      narratives = coins.slice(0, 5).map((c) => ({
        tag: c.name || c.symbol || "?",
        change: Number((c.change_24h || c.price_change_percentage_24h || 0).toFixed(1)),
      }));
    }
    // Always give the UI 4-5 rows — pad to 4 with zeros so the card
    // never looks empty.
    while (narratives.length < 4) {
      narratives.push({ tag: "—", change: 0 });
    }
    narratives = narratives.slice(0, 5);

    res.json({ score, label, delta, narratives });
  } catch (e) {
    // Never let the right-rail break the page — return a neutral
    // payload on any failure.
    res.json({
      score: 50, label: "Neutral", delta: 0,
      narratives: [{ tag: "—", change: 0 }, { tag: "—", change: 0 }, { tag: "—", change: 0 }, { tag: "—", change: 0 }],
      error: e?.message,
    });
  }
});

// "#foo" for hashtags, "$FOO" for tickers, plain otherwise.
function formatTag(tag, kind) {
  if (!tag) return "?";
  if (kind === "ticker") return `$${tag.toUpperCase()}`;
  return tag;
}

module.exports = router;
