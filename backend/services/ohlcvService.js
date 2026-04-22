// backend/services/ohlcvService.js
//
// OHLCV data source for the /trading chart.
//
//   Tier 1 — NewsCoins: aggregate our own feed_newscoin_trades in
//   SQL. Zero third-party dependency; we own every trade row. This
//   is the only real "self-hosted OHLCV" source today.
//
//   Tier 2 — NEAR general pools: DEFERRED. Ref Finance's public
//   indexer removed `list-pool-trades` sometime in 2025 and the
//   community replacements (Pikespeak / NEAR Lake) require keys or
//   infrastructure we don't have yet. Backend returns an empty
//   candle list with source='unavailable' for non-NewsCoin NEAR
//   pools; the client falls through to GeckoTerminal's near-protocol
//   coverage to keep charts alive in the meantime. When budget
//   clears, the unlock path is either (a) Pikespeak signup + re-add
//   the fetchRefOhlcv() shape, or (b) subscribe to NEAR Lake via
//   S3 and index Ref contract receipts ourselves.
//
// Solana is not served here either; the client hits GeckoTerminal
// directly. Tier 3 (self-hosted Solana indexer) needs a paid RPC.

const db = require("../db/client");

// Timeframe → Postgres interval literal accepted by date_bin().
// Keep in sync with SUPPORTED_TIMEFRAMES on the client.
const TIMEFRAMES = {
  "1m":  "1 minute",
  "5m":  "5 minutes",
  "15m": "15 minutes",
  "1h":  "1 hour",
  "4h":  "4 hours",
  "1d":  "1 day",
};

// Rough "how much history to scan for N buckets" — we return up to
// `limit` candles but the query bounds by time, not row count, so a
// quiet pool doesn't exhaust the row budget scanning ancient trades.
const SECONDS_PER_BUCKET = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400,
};

function pickBucket(tf) {
  const interval = TIMEFRAMES[tf];
  if (!interval) throw new Error(`Unsupported timeframe: ${tf}`);
  return interval;
}

/* ── Tier 1: NewsCoin OHLCV from feed_newscoin_trades ───────────── */

// pool can be the coin's account address (e.g. "nbull-7.newscoin-
// factory.ironshield.near") or its numeric feed_newscoins.id. Always
// verify the coin exists — a bare numeric literal is just as likely
// to be a Ref pool ID (e.g. "3879"), and we MUST return null in that
// case so the dispatcher falls through to Tier 2 (Ref indexer).
async function getNewscoinCoinId(pool) {
  let r;
  if (/^\d+$/.test(pool)) {
    r = await db.query(
      "SELECT id FROM feed_newscoins WHERE id = $1 LIMIT 1",
      [Number(pool)]
    );
  } else {
    r = await db.query(
      "SELECT id FROM feed_newscoins WHERE contract_address = $1 LIMIT 1",
      [pool]
    );
  }
  return r.rows[0]?.id || null;
}

async function fetchNewscoinOhlcv({ pool, timeframe, limit }) {
  const coinId = await getNewscoinCoinId(pool);
  if (!coinId) return null;
  const interval = pickBucket(timeframe);
  const windowSeconds = SECONDS_PER_BUCKET[timeframe] * (limit + 5);

  // array_agg(... ORDER BY ...)[1] gives us the first/last price per
  // bucket cheaply. Works up to ~10k rows per bucket before window
  // functions would be faster, but NewsCoins are nowhere near that
  // per-bucket throughput.
  const r = await db.query(
    `SELECT
       EXTRACT(EPOCH FROM date_bin($1::interval, created_at, TIMESTAMP '2000-01-01'))::bigint AS t,
       (array_agg(price ORDER BY created_at ASC))[1]::float8  AS o,
       MAX(price)::float8  AS h,
       MIN(price)::float8  AS l,
       (array_agg(price ORDER BY created_at DESC))[1]::float8 AS c,
       SUM(near_amount)::float8                                AS v
     FROM feed_newscoin_trades
     WHERE coin_id = $2
       AND created_at >= NOW() - ($3 || ' seconds')::interval
     GROUP BY t
     ORDER BY t ASC
     LIMIT $4`,
    [interval, coinId, windowSeconds, limit]
  );
  return r.rows.map((row) => ({
    time:   Number(row.t),
    open:   Number(row.o),
    high:   Number(row.h),
    low:    Number(row.l),
    close:  Number(row.c),
    volume: Number(row.v || 0),
  }));
}

/* ── Dispatch ───────────────────────────────────────────────────── */

/**
 * Resolve OHLCV candles for a NEAR pool. Returns NewsCoin candles
 * when the pool is one of ours; returns an empty list with source
 * 'unavailable' otherwise so the client knows to fall through to
 * GeckoTerminal. Ordered oldest-first so the chart can setData()
 * without re-sorting.
 */
async function getNearOhlcv({ pool, timeframe, limit }) {
  if (!pool) throw new Error("pool required");
  const tf = timeframe || "1h";
  const lim = Math.max(1, Math.min(Number(limit) || 300, 1000));

  const newscoinCandles = await fetchNewscoinOhlcv({ pool, timeframe: tf, limit: lim });
  if (newscoinCandles) return { source: "newscoin", candles: newscoinCandles };

  // Tier 2 deferred (see top-of-file rationale). Fall through to the
  // client's GeckoTerminal path by returning an unambiguous empty.
  return { source: "unavailable", candles: [] };
}

module.exports = { getNearOhlcv, TIMEFRAMES };
