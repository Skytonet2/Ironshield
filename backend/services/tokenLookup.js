// backend/services/tokenLookup.js
// Fetches REAL on-chain and market data from free APIs before sending to AI.
const fetch = require("node-fetch");

const NEARBLOCKS_API  = "https://api3.nearblocks.io/v1";
const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex";
const REF_FINANCE_API = "https://api.ref.finance";
const COINGECKO_API   = "https://api.coingecko.com/api/v3";

const TIMEOUT = 8000;

const fetchJson = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "IronShield/1.0", "Accept": "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
};

/**
 * Detect if query is a NEAR contract/token
 */
function isNearToken(query) {
  return /\.near$|\.tkn\.near$|\.token\.near$/i.test(query);
}

/**
 * Lookup a NEAR token via NearBlocks + DexScreener + Ref Finance
 */
async function lookupNearToken(contract) {
  const results = { source: "near", contract, data: {} };

  // Fetch from all sources in parallel
  const [nearblocks, dexscreener, refPrices, holders] = await Promise.all([
    fetchJson(`${NEARBLOCKS_API}/fts/${contract}`),
    fetchJson(`${DEXSCREENER_API}/tokens/${contract}`),
    fetchJson(`${REF_FINANCE_API}/list-token-price`),
    fetchJson(`${NEARBLOCKS_API}/fts/${contract}/holders?limit=5`),
  ]);

  // NearBlocks FT data
  if (nearblocks?.contracts?.[0]) {
    const ft = nearblocks.contracts[0];
    results.data.name = ft.name || "Unknown";
    results.data.symbol = ft.symbol || "Unknown";
    results.data.decimals = ft.decimals;
    results.data.totalSupply = ft.total_supply || "unavailable";
    results.data.price = ft.price || "unavailable";
    results.data.marketCap = ft.market_cap || ft.onchain_market_cap || "unavailable";
    results.data.volume24h = ft.volume_24h || "unavailable";
    results.data.change24h = ft.change_24 || "unavailable";
    results.data.holderCount = ft.holders_count || "unavailable";
    results.data.icon = ft.icon || null;
  }

  // DexScreener pair data (liquidity, DEX info)
  if (dexscreener?.pairs?.length > 0) {
    const topPair = dexscreener.pairs[0];
    results.data.dex = topPair.dexId || "unknown";
    results.data.pairAddress = topPair.pairAddress || null;
    results.data.priceUsd = topPair.priceUsd || results.data.price || "unavailable";
    results.data.liquidity = topPair.liquidity?.usd ? `$${Math.round(topPair.liquidity.usd).toLocaleString()}` : "unavailable";
    results.data.volume24h = results.data.volume24h !== "unavailable"
      ? results.data.volume24h
      : (topPair.volume?.h24 ? `$${Math.round(topPair.volume.h24).toLocaleString()}` : "unavailable");
    results.data.txns24h = topPair.txns?.h24
      ? `${topPair.txns.h24.buys} buys / ${topPair.txns.h24.sells} sells`
      : "unavailable";
    results.data.priceChange24h = topPair.priceChange?.h24 != null
      ? `${topPair.priceChange.h24}%`
      : "unavailable";
    results.data.fdv = topPair.fdv ? `$${Math.round(topPair.fdv).toLocaleString()}` : "unavailable";
    results.data.pairCount = dexscreener.pairs.length;
  }

  // Ref Finance price fallback
  if (refPrices && refPrices[contract]) {
    const ref = refPrices[contract];
    if (!results.data.price || results.data.price === "unavailable") {
      results.data.price = ref.price || "unavailable";
    }
    if (!results.data.symbol || results.data.symbol === "Unknown") {
      results.data.symbol = ref.symbol || "Unknown";
    }
  }

  // Top holders
  if (holders?.holders?.length > 0) {
    results.data.topHolders = holders.holders.map(h => ({
      account: h.account,
      amount: h.amount,
    }));
  }

  return results;
}

/**
 * Lookup a non-NEAR token via CoinGecko + DexScreener
 */
async function lookupGenericToken(query) {
  const results = { source: "generic", query, data: {} };

  // Try CoinGecko search first
  const search = await fetchJson(`${COINGECKO_API}/search?query=${encodeURIComponent(query)}`);
  if (search?.coins?.length > 0) {
    const coin = search.coins[0];
    results.data.coingeckoId = coin.id;
    results.data.name = coin.name;
    results.data.symbol = coin.symbol;
    results.data.marketCapRank = coin.market_cap_rank;
    results.data.thumb = coin.thumb;

    // Fetch detailed data
    const detail = await fetchJson(`${COINGECKO_API}/coins/${coin.id}?localization=false&tickers=false&community_data=true&developer_data=false`);
    if (detail) {
      const md = detail.market_data || {};
      results.data.price = md.current_price?.usd ? `$${md.current_price.usd}` : "unavailable";
      results.data.marketCap = md.market_cap?.usd ? `$${Math.round(md.market_cap.usd).toLocaleString()}` : "unavailable";
      results.data.volume24h = md.total_volume?.usd ? `$${Math.round(md.total_volume.usd).toLocaleString()}` : "unavailable";
      results.data.change24h = md.price_change_percentage_24h != null ? `${md.price_change_percentage_24h.toFixed(2)}%` : "unavailable";
      results.data.ath = md.ath?.usd ? `$${md.ath.usd}` : "unavailable";
      results.data.totalSupply = md.total_supply || "unavailable";
      results.data.circulatingSupply = md.circulating_supply || "unavailable";
      results.data.twitter = detail.links?.twitter_screen_name || null;
      results.data.website = detail.links?.homepage?.[0] || null;
      results.data.description = detail.description?.en?.slice(0, 300) || null;
      results.data.categories = detail.categories?.filter(Boolean) || [];
    }
  }

  // Also try DexScreener search
  const dex = await fetchJson(`${DEXSCREENER_API}/search?q=${encodeURIComponent(query)}`);
  if (dex?.pairs?.length > 0) {
    const topPair = dex.pairs[0];
    if (!results.data.price || results.data.price === "unavailable") {
      results.data.price = topPair.priceUsd ? `$${topPair.priceUsd}` : "unavailable";
    }
    results.data.liquidity = topPair.liquidity?.usd ? `$${Math.round(topPair.liquidity.usd).toLocaleString()}` : "unavailable";
    results.data.dex = topPair.dexId || "unknown";
    results.data.chain = topPair.chainId || "unknown";
  }

  return results;
}

/**
 * Main lookup — auto-detects NEAR vs generic tokens
 */
async function lookup(query) {
  if (isNearToken(query)) {
    return lookupNearToken(query);
  }
  return lookupGenericToken(query);
}

module.exports = { lookup, isNearToken, lookupNearToken, lookupGenericToken };
