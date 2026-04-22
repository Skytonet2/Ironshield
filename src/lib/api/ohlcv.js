"use client";
// ohlcv — OHLCV fetcher that dispatches by chain + pool to whichever
// source owns the data. PriceChart imports from here instead of
// geckoTerminal directly so swapping a source is a one-file change.
//
// Dispatch rules:
//   chain === 'near':
//     1. Try our backend /api/trading/ohlcv first. If the pool is a
//        NewsCoin we get fully self-hosted candles from
//        feed_newscoin_trades in Postgres (response source='newscoin').
//     2. If the backend returns source='unavailable' (general NEAR
//        pool, no self-hosted data) fall through to GeckoTerminal's
//        near-protocol coverage. Ref Finance's public trades endpoint
//        is gone; self-hosting this tier needs Pikespeak or NEAR Lake.
//   chain === 'sol' → GeckoTerminal direct (Tier 3 self-host deferred).

import { fetchOhlcv as fetchGtOhlcv } from "./geckoTerminal";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

/**
 * Unified OHLCV fetch. Returns the same shape as geckoTerminal.fetchOhlcv
 * so PriceChart doesn't care who served the data.
 *
 * Returns: [{ time, open, high, low, close, volume }] oldest-first.
 */
export async function fetchOhlcv({ chain, pool, timeframe = "1h", limit = 300, signal }) {
  if (!chain || !pool) return [];

  if (chain === "near") {
    // Hit our backend first. Any backend failure or unavailable source
    // falls through silently to GeckoTerminal — a dead backend
    // shouldn't black-hole the chart.
    try {
      const url = `${BACKEND_BASE}/api/trading/ohlcv` +
        `?chain=near&pool=${encodeURIComponent(pool)}` +
        `&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`;
      const res = await fetch(url, { signal, cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        if (j?.source === "newscoin" && Array.isArray(j.candles) && j.candles.length > 0) {
          return j.candles;
        }
        // source === 'unavailable' or an empty NewsCoin: fall through.
      }
    } catch (e) {
      if (e.name === "AbortError") throw e;
      // Anything else → try GeckoTerminal.
    }
    return fetchGtOhlcv({ chain, pool, timeframe, limit, signal });
  }

  // Solana + anything else: GeckoTerminal direct.
  return fetchGtOhlcv({ chain, pool, timeframe, limit, signal });
}
