"use client";
// jupiterPrice — batched USD price lookup for SPL mints.
//
// Jupiter's free price API returns current USD price per mint. We
// batch all open positions' mints into one call every 20s (comfortably
// under the free rate limit) and cache in a module-level Map so every
// subscriber shares the same poll.
//
// Usage:
//   const prices = usePrices(["mint1", "mint2"]);
//   // → { mint1: 136.42, mint2: 0.00018, ... }, null while loading

import { useEffect, useState } from "react";

const ENDPOINT = "https://lite-api.jup.ag/price/v3";
const POLL_MS = 20_000;

let cache = {};
let lastFetchedFor = "";
let inflight = null;
const listeners = new Set();

async function refresh(mints) {
  if (!mints.length) return;
  const key = mints.slice().sort().join(",");
  if (inflight && lastFetchedFor === key) return inflight;
  lastFetchedFor = key;
  inflight = (async () => {
    try {
      const url = `${ENDPOINT}?ids=${encodeURIComponent(key)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      // v3 shape: { data: { mint: { usdPrice: number, ... } } }
      // Older fallback: { mint: { price: number } }
      const next = { ...cache };
      const bucket = j?.data || j || {};
      for (const [mint, row] of Object.entries(bucket)) {
        const px = Number(row?.usdPrice ?? row?.price ?? 0);
        if (Number.isFinite(px) && px > 0) next[mint] = px;
      }
      cache = next;
      listeners.forEach((fn) => fn(cache));
    } catch { /* stale cache better than a crash */ }
    finally { inflight = null; }
  })();
  return inflight;
}

/** Hook returns the latest price map. Re-renders on every refresh
 *  that changes the cache. Passing an empty array is a no-op. */
export function useJupiterPrices(mints) {
  const [prices, setPrices] = useState(cache);

  useEffect(() => {
    const list = Array.from(new Set((mints || []).filter(Boolean)));
    if (list.length === 0) return;

    listeners.add(setPrices);
    // Kick immediately if the set of mints changed.
    refresh(list);
    const id = setInterval(() => refresh(list), POLL_MS);
    return () => {
      clearInterval(id);
      listeners.delete(setPrices);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mints.join("|")]);

  return prices;
}
