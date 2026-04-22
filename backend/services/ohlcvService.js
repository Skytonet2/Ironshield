// backend/services/ohlcvService.js
//
// OHLCV data source for the /trading chart.
//
//   Tier 1 — NewsCoins: aggregate our own feed_newscoin_trades in
//   SQL. Zero third-party dependency; we own every trade row.
//
//   Tier 2 — NEAR general pools: Pikespeak event-historic API
//   (https://api.pikespeak.ai/event-historic/ref_finance_swap).
//   Pikespeak indexes every swap event on v2.ref-finance.near; we
//   filter by pool_id client-side, bucket to OHLCV, and cache 60s
//   so hot pools stay warm without burning quota. Disabled cleanly
//   when PIKESPEAK_API_KEY is unset — route returns 'unavailable'
//   and the client falls through to GeckoTerminal.
//
// Solana is not served here; the client hits GeckoTerminal directly.
// Tier 3 (self-hosted Solana indexer) needs a paid RPC.

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

/* ── Tier 2: NEAR general pools via Pikespeak ───────────────────── */

const PIKESPEAK_BASE = "https://api.pikespeak.ai";
const PIKESPEAK_TIMEOUT_MS = 10_000;

// Pikespeak rate limits aggressively on the free tier; 60s cache
// keyed by pool+timeframe keeps the 5s client poll from burning
// quota, and a shared in-flight map coalesces concurrent requests
// for the same key into one upstream call.
const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const pikespeakCache = new Map();   // key → { ts, candles }
const pikespeakInflight = new Map(); // key → Promise

function cacheGet(key) {
  const hit = pikespeakCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) { pikespeakCache.delete(key); return null; }
  return hit.candles;
}
function cacheSet(key, candles) {
  if (pikespeakCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = pikespeakCache.keys().next().value;
    if (firstKey) pikespeakCache.delete(firstKey);
  }
  pikespeakCache.set(key, { ts: Date.now(), candles });
}

/**
 * Fetch recent ref_finance_swap events. Pikespeak's shape:
 *   [{ block_timestamp, pool_id, token_in, token_out,
 *      amount_in, amount_out, predecessor_id, … }, …]
 * Field names vary slightly between versions; we read defensively.
 */
async function fetchPikespeakSwaps({ poolId, limit = 1000 }) {
  const key = process.env.PIKESPEAK_API_KEY;
  if (!key) return null;
  const url = `${PIKESPEAK_BASE}/event-historic/ref_finance_swap?limit=${limit}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PIKESPEAK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "x-api-key": key,
        "User-Agent": "IronShield/ohlcv",
        "Accept": "application/json",
      },
    });
    if (!res.ok) {
      // 429 is common on the free tier; surface via null so the
      // caller returns `unavailable` and the client falls through.
      return null;
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    // Pikespeak returns the whole stream; narrow to the requested
    // pool. Accept string or numeric pool_id since Pikespeak has
    // mixed both in the wild.
    const target = String(poolId);
    return rows.filter((r) => {
      const pid = r?.pool_id ?? r?.arguments?.pool_id ?? r?.args?.pool_id;
      return String(pid) === target;
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function bucketSwaps({ swaps, timeframe, limit }) {
  const stepSec = SECONDS_PER_BUCKET[timeframe];
  const buckets = new Map();
  for (const sw of swaps) {
    // Timestamp — Pikespeak uses block_timestamp in nanoseconds (string).
    const tsNs = sw?.block_timestamp ?? sw?.timestamp ?? sw?.ts;
    if (!tsNs) continue;
    const tsSec = Math.floor(Number(tsNs) / 1_000_000_000);
    if (!isFinite(tsSec)) continue;
    const bucket = tsSec - (tsSec % stepSec);

    // Price = amount_out / amount_in. This gives the raw ratio in
    // base units of whichever direction the swap went; for OHLCV on
    // a single pool, all swaps reference the same pair so the
    // relative motion is meaningful even though units aren't
    // normalised. A follow-up can fetch token decimals and convert
    // to USD when we care about cross-pool comparisons.
    const amountIn  = Number(sw?.amount_in  ?? sw?.arguments?.amount_in  ?? 0);
    const amountOut = Number(sw?.amount_out ?? sw?.arguments?.min_amount_out ?? sw?.arguments?.amount_out ?? 0);
    if (!amountIn || !amountOut) continue;
    const price = amountOut / amountIn;
    const volume = amountIn; // base-unit volume of the sold side

    let b = buckets.get(bucket);
    if (!b) {
      b = { o: price, h: price, l: price, c: price, v: volume, firstTs: tsSec, lastTs: tsSec };
      buckets.set(bucket, b);
    } else {
      if (tsSec < b.firstTs) { b.o = price; b.firstTs = tsSec; }
      if (tsSec > b.lastTs)  { b.c = price; b.lastTs = tsSec;  }
      if (price > b.h) b.h = price;
      if (price < b.l) b.l = price;
      b.v += volume;
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-limit)
    .map(([time, b]) => ({ time, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
}

async function fetchPikespeakOhlcv({ pool, timeframe, limit }) {
  if (!SECONDS_PER_BUCKET[timeframe]) throw new Error(`Unsupported timeframe: ${timeframe}`);
  const key = `${pool}|${timeframe}|${limit}`;

  const cached = cacheGet(key);
  if (cached) return cached;

  if (pikespeakInflight.has(key)) return pikespeakInflight.get(key);
  const p = (async () => {
    const swaps = await fetchPikespeakSwaps({ poolId: pool, limit: 1000 });
    if (!swaps || swaps.length === 0) return null;
    const candles = bucketSwaps({ swaps, timeframe, limit });
    cacheSet(key, candles);
    return candles;
  })().finally(() => { pikespeakInflight.delete(key); });
  pikespeakInflight.set(key, p);
  return p;
}

/* ── Dispatch ───────────────────────────────────────────────────── */

/**
 * Resolve OHLCV candles for a NEAR pool. Tries NewsCoins first
 * (owned data), then Pikespeak for general pools. Returns
 * `unavailable` with empty candles if both miss so the client
 * falls through to GeckoTerminal cleanly. Ordered oldest-first
 * so the chart can setData() without re-sorting.
 */
async function getNearOhlcv({ pool, timeframe, limit }) {
  if (!pool) throw new Error("pool required");
  const tf = timeframe || "1h";
  const lim = Math.max(1, Math.min(Number(limit) || 300, 1000));

  const newscoinCandles = await fetchNewscoinOhlcv({ pool, timeframe: tf, limit: lim });
  if (newscoinCandles && newscoinCandles.length > 0) {
    return { source: "newscoin", candles: newscoinCandles };
  }

  // Pikespeak only makes sense for pools identified by numeric ID;
  // skip if the caller passed an address-shaped pool.
  if (/^\d+$/.test(pool) && process.env.PIKESPEAK_API_KEY) {
    const pikeCandles = await fetchPikespeakOhlcv({ pool, timeframe: tf, limit: lim });
    if (pikeCandles && pikeCandles.length > 0) {
      return { source: "pikespeak", candles: pikeCandles };
    }
  }

  return { source: "unavailable", candles: [] };
}

module.exports = { getNearOhlcv, TIMEFRAMES };
