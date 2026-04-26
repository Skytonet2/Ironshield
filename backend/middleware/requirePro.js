// backend/middleware/requirePro.js — Day 18.2
//
// Chainable Express middleware that gates a route on IronShield Pro
// membership. Use AFTER requireWallet:
//   router.post("/x", requireWallet, requirePro, handler);
//
// Calls the contract view `is_pro(account_id)` against the configured
// staking contract and caches per-wallet for TTL_MS. The contract's
// own definition is authoritative — middleware just relays. 402 on
// non-Pro is the convention the audit doc + spec call for ("payment
// required"); this isn't crypto-enforced, the perks are off-chain
// affordances.

const { providers } = require("near-api-js");

const RPC_URL          = process.env.NEAR_RPC_URL          || "https://rpc.fastnear.com";
const STAKING_CONTRACT = process.env.STAKING_CONTRACT_ID   || process.env.STAKING_CONTRACT
                        || "ironshield.near";

let _provider = null;
function provider() {
  if (!_provider) _provider = new providers.JsonRpcProvider({ url: RPC_URL });
  return _provider;
}

// Per-wallet cache. Pro status changes rarely (you have to call
// extend_lock or your stake has to drop), so 60s is plenty and saves
// ~1 RPC roundtrip per request. Wallet -> { isPro, at }.
//
// Bounded at MAX_CACHE entries to defend against the /api/auth/me
// path that accepts an unsigned x-wallet header: an attacker could
// otherwise hammer the endpoint with millions of distinct wallets
// and balloon server memory. Map preserves insertion order, so
// dropping the first key is approximate-FIFO eviction (good enough
// for this access pattern — there's no LRU promotion). 5000 entries
// is ~500KB and dwarfs IronShield's expected concurrent-wallet count
// while still putting a hard ceiling on growth.
const cache = new Map();
const MAX_CACHE = 5000;
const TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 10_000; // shorter so a freshly-upgraded user sees Pro within ~10s

function setCacheEntry(wallet, value) {
  if (cache.size >= MAX_CACHE && !cache.has(wallet)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(wallet, value);
}

async function readIsPro(wallet) {
  const args = Buffer.from(JSON.stringify({ account_id: wallet })).toString("base64");
  const res = await provider().query({
    request_type: "call_function",
    finality:     "final",
    account_id:   STAKING_CONTRACT,
    method_name:  "is_pro",
    args_base64:  args,
  });
  const text = Buffer.from(res.result).toString();
  return JSON.parse(text) === true;
}

async function isPro(wallet) {
  const hit = cache.get(wallet);
  const now = Date.now();
  if (hit) {
    const ttl = hit.isPro ? TTL_MS : NEGATIVE_TTL_MS;
    if (now - hit.at < ttl) return hit.isPro;
  }
  let result;
  try { result = await readIsPro(wallet); }
  catch (err) {
    // Fail closed — if we can't read the chain we can't be sure.
    // Cache the negative briefly so the next request retries.
    setCacheEntry(wallet, { isPro: false, at: now });
    throw err;
  }
  setCacheEntry(wallet, { isPro: result, at: now });
  return result;
}

function invalidate(wallet) {
  if (wallet) cache.delete(wallet);
  else cache.clear();
}

async function requirePro(req, res, next) {
  if (!req.wallet) return res.status(401).json({ error: "wallet required", code: "missing-sig" });
  try {
    const ok = await isPro(req.wallet);
    if (!ok) {
      return res.status(402).json({
        error: "pro-required",
        upgradeUrl: "/rewards#pro",
        hint: "Lock your stake for 30 days to unlock IronShield Pro.",
      });
    }
    req.isPro = true;
    next();
  } catch (err) {
    console.warn("[requirePro] is_pro lookup failed:", err.message);
    res.status(503).json({ error: "pro-status-unavailable" });
  }
}

module.exports = requirePro;
module.exports.isPro = isPro;
module.exports.invalidate = invalidate;
