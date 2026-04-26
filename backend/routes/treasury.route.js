// backend/routes/treasury.route.js — Treasury revenue-sources aggregator
//
// Day 16 split. The legacy /api/newscoin/treasury endpoint still owns
// the NewsCoin-specific treasury page payload (lifetime/24h/7d trade
// volume, recent feed, payout schedule) — keep using it for that.
// This route adds a per-source revenue rollup so the treasury page
// can render a "where the money came from" panel without re-deriving
// the math on the frontend.

const router = require("express").Router();
const db = require("../db/client");

const YOCTO = 1_000_000_000_000_000_000_000_000n;

function yoctoToNumNear(yoctoStr) {
  if (!yoctoStr) return 0;
  try {
    const big = BigInt(yoctoStr);
    const whole = Number(big / YOCTO);
    const frac = Number(big % YOCTO) / 1e24;
    return whole + frac;
  } catch { return 0; }
}

/** GET /api/treasury/sources
 *  Per-source treasury revenue rollup.
 *
 *  Sources (additive — new entries land here, panel renders any present):
 *  - skill_sales   : SUM(treasury_take_yocto) — 1% platform cut on installs
 *  - newscoin_fees : SUM(near_amount * 1%) — 1% platform cut on NewsCoin trades
 *
 *  Returns whole-NEAR floats (not yocto strings) — the panel is a
 *  display surface; precision drift below 6 decimals is fine and the
 *  numbers are easier to consume.
 */
router.get("/sources", async (_req, res) => {
  try {
    const skillSalesQ = db.query(
      `SELECT
         COALESCE(SUM(treasury_take_yocto), 0)::text  AS lifetime_yocto,
         COALESCE(SUM(treasury_take_yocto)
           FILTER (WHERE sold_at >= NOW() - INTERVAL '24 hours'), 0)::text AS d24_yocto,
         COALESCE(SUM(treasury_take_yocto)
           FILTER (WHERE sold_at >= NOW() - INTERVAL '7 days'), 0)::text  AS d7_yocto,
         COUNT(*)::int AS sales_count
       FROM skill_sales`
    );
    // NewsCoin trade volume × 1% — the platform fee mirrors the 1%
    // taken on each near_amount in the bonding curve. Backend has no
    // dedicated fee_yocto column on feed_newscoin_trades, so derive
    // it; if a fee schedule column lands later swap to summing it.
    const newscoinQ = db.query(
      `SELECT
         COALESCE(SUM(near_amount), 0)::numeric AS lifetime_volume,
         COALESCE(SUM(near_amount)
           FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'), 0)::numeric AS d24_volume,
         COALESCE(SUM(near_amount)
           FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::numeric AS d7_volume,
         COUNT(*)::int AS trades_count
       FROM feed_newscoin_trades`
    );

    const [skill, news] = await Promise.all([skillSalesQ, newscoinQ]);
    const s = skill.rows[0];
    const n = news.rows[0];
    const NEWSCOIN_FEE_RATE = 0.01;

    res.json({
      sources: [
        {
          key: "skill_sales",
          label: "Skill installs",
          lifetime_near: yoctoToNumNear(s.lifetime_yocto),
          d24h_near:     yoctoToNumNear(s.d24_yocto),
          d7d_near:      yoctoToNumNear(s.d7_yocto),
          tx_count:      s.sales_count,
        },
        {
          key: "newscoin_fees",
          label: "NewsCoin fees",
          lifetime_near: Number(n.lifetime_volume) * NEWSCOIN_FEE_RATE,
          d24h_near:     Number(n.d24_volume) * NEWSCOIN_FEE_RATE,
          d7d_near:      Number(n.d7_volume) * NEWSCOIN_FEE_RATE,
          tx_count:      n.trades_count,
        },
      ],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
