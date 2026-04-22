"use client";
// geckoTerminal — thin client for the free GeckoTerminal API.
//
// Covers the one data source we need for Phase 3A: OHLCV candles for a
// given pool on a given network. Free tier allows 30 req/min and has
// permissive CORS so we hit it directly from the browser — adding a
// backend proxy can come later if rate limits bite.
//
// API docs: https://www.geckoterminal.com/dex-api
//
// Shape:
//   GET /networks/{network}/pools/{pool}/ohlcv/{timeframe}
//     ?aggregate={n}&limit=300&currency=usd
//   → { data: { attributes: { ohlcv_list: [[ts, o, h, l, c, v], ...] } } }

const BASE = "https://api.geckoterminal.com/api/v2";

// Our chain IDs → GeckoTerminal's network slugs. GeckoTerminal uses
// "near-protocol" (not just "near") for NEAR — getting this wrong
// returns an empty 404 rather than an error the caller can diagnose.
export const NETWORK_SLUG = {
  sol:  "solana",
  near: "near-protocol",
};

// Supported timeframe → [resolution, aggregate-multiplier]. GeckoTerminal
// only serves minute/hour/day granularities and uses an `aggregate` query
// param to coarsen; e.g. 5m = minute with aggregate=5.
const TIMEFRAME = {
  "1m":  ["minute", 1],
  "5m":  ["minute", 5],
  "15m": ["minute", 15],
  "1h":  ["hour", 1],
  "4h":  ["hour", 4],
  "1d":  ["day", 1],
};

export const SUPPORTED_TIMEFRAMES = Object.keys(TIMEFRAME);

/** Fetch OHLCV candles. Returns an array of { time, open, high, low, close, volume }
 *  ordered oldest-first (lightweight-charts expects ascending time). */
export async function fetchOhlcv({ chain, pool, timeframe = "1h", limit = 300, signal }) {
  const slug = NETWORK_SLUG[chain];
  if (!slug) throw new Error(`Unsupported chain: ${chain}`);
  const tf = TIMEFRAME[timeframe];
  if (!tf) throw new Error(`Unsupported timeframe: ${timeframe}`);
  const [resolution, aggregate] = tf;

  const url =
    `${BASE}/networks/${slug}/pools/${pool}/ohlcv/${resolution}` +
    `?aggregate=${aggregate}&limit=${Math.min(limit, 1000)}&currency=usd`;

  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`geckoterminal ${res.status}: ${body.slice(0, 140)}`);
  }
  const j = await res.json();
  const rows = j?.data?.attributes?.ohlcv_list || [];
  // GeckoTerminal returns newest-first; reverse so charts see ascending time.
  return rows
    .map(([ts, o, h, l, c, v]) => ({
      time: ts, // unix seconds, matches lightweight-charts UTCTimestamp
      open: Number(o), high: Number(h), low: Number(l), close: Number(c),
      volume: Number(v),
    }))
    .sort((a, b) => a.time - b.time);
}

/** Find pools for a token address. Used by the token selector — hands
 *  the chart a pool address once the user picks a token. */
export async function findPools({ chain, tokenAddress, signal }) {
  const slug = NETWORK_SLUG[chain];
  if (!slug) throw new Error(`Unsupported chain: ${chain}`);
  const url = `${BASE}/networks/${slug}/tokens/${tokenAddress}/pools?page=1`;
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
  const j = await res.json();
  const pools = (j?.data || []).map((p) => {
    const a = p.attributes || {};
    return {
      address: a.address,
      name: a.name,
      dex: a.dex_id || p.relationships?.dex?.data?.id || null,
      reserveUsd: Number(a.reserve_in_usd || 0),
      priceUsd:   Number(a.base_token_price_usd || a.quote_token_price_usd || 0),
      volume24h:  Number(a.volume_usd?.h24 || 0),
      change24h:  Number(a.price_change_percentage?.h24 || 0),
    };
  });
  // Highest-liquidity pool first — that's the one traders want charted.
  pools.sort((a, b) => b.reserveUsd - a.reserveUsd);
  return pools;
}

/** Search tokens by free-text (ticker, name, partial CA). GeckoTerminal's
 *  `/search/pools` endpoint accepts a `query` param; filter to our chain. */
export async function searchTokens({ chain, query, signal }) {
  const slug = NETWORK_SLUG[chain];
  if (!slug) throw new Error(`Unsupported chain: ${chain}`);
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const url = `${BASE}/search/pools?query=${q}&network=${slug}&page=1`;
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
  const j = await res.json();
  return (j?.data || []).map((p) => {
    const a = p.attributes || {};
    return {
      poolAddress: a.address,
      name: a.name,
      baseSymbol:  a.base_token_symbol  || "",
      quoteSymbol: a.quote_token_symbol || "USD",
      priceUsd:    Number(a.base_token_price_usd || 0),
      reserveUsd:  Number(a.reserve_in_usd || 0),
      change24h:   Number(a.price_change_percentage?.h24 || 0),
    };
  });
}
