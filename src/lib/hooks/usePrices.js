"use client";
// usePrices — lightweight CoinGecko poll for the bottom status bar.
//
// One module-level cache so multiple <BottomBar/> mounts (e.g. nested
// routes on the same tab) don't multiplex requests. CoinGecko's free
// tier is 10–30 req/min and has loose CORS — direct client calls are
// fine. Poll interval is 30s, matching the spec.
//
// Returns { sol, near, bnb } as USD numbers (or null while loading).
// Call-sites render something sensible while null; never block.

import { useEffect, useState } from "react";

const ENDPOINT =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana,near,binancecoin&vs_currencies=usd";

const POLL_MS = 30_000;

let cache = { sol: null, near: null, bnb: null };
let lastFetch = 0;
let inflight = null;
const listeners = new Set();

async function refresh() {
  // Coalesce: if an in-flight fetch is already running, everyone waits
  // for the same promise. Avoids the thundering-herd on first mount.
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      if (!res.ok) throw new Error(`coingecko ${res.status}`);
      const j = await res.json();
      cache = {
        sol:  j.solana?.usd       ?? null,
        near: j.near?.usd         ?? null,
        bnb:  j.binancecoin?.usd  ?? null,
      };
      lastFetch = Date.now();
      listeners.forEach((fn) => fn(cache));
    } catch {
      // Swallow — stale cache is better than a crash. Next poll retries.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function usePrices() {
  const [prices, setPrices] = useState(cache);

  useEffect(() => {
    listeners.add(setPrices);
    // Kick immediately if we have no data, or if the cache is stale
    // (e.g. a background tab that paused intervals for > POLL_MS).
    if (!lastFetch || Date.now() - lastFetch > POLL_MS) {
      refresh();
    } else {
      setPrices(cache);
    }
    const id = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(id);
      listeners.delete(setPrices);
    };
  }, []);

  return prices;
}
