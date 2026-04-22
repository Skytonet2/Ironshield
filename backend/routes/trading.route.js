// backend/routes/trading.route.js
//
// Trading read endpoints. Today just OHLCV for NEAR. Solana stays on
// the client-side GeckoTerminal path for now. When swap execution
// lands in Phase 3B, position + fee writes land here too.

const express = require("express");
const router = express.Router();
const ohlcvService = require("../services/ohlcvService");

// GET /api/trading/ohlcv?chain=near&pool=X&timeframe=1h&limit=300
// Returns: { source: 'newscoin' | 'ref', candles: [{time, open, high, low, close, volume}] }
router.get("/ohlcv", async (req, res) => {
  const chain     = String(req.query.chain || "").toLowerCase();
  const pool      = String(req.query.pool || "").trim();
  const timeframe = String(req.query.timeframe || "1h");
  const limit     = Number(req.query.limit) || 300;

  if (!pool) return res.status(400).json({ error: "pool required" });

  try {
    if (chain === "near") {
      const out = await ohlcvService.getNearOhlcv({ pool, timeframe, limit });
      return res.json(out);
    }
    // Solana stays on GeckoTerminal client-side until Tier 3 budget
    // clears. We could proxy/cache GT here to paper over rate limits,
    // but that's premature until a second chain needs the same path.
    return res.status(400).json({ error: `chain '${chain}' not served by backend yet` });
  } catch (e) {
    return res.status(500).json({ error: e.message || "ohlcv failed" });
  }
});

module.exports = router;
