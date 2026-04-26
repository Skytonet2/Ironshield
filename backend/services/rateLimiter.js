// backend/services/rateLimiter.js
// Two surfaces:
//   1. Legacy route-keyed limiter — check(userId, route) / consume(userId, route).
//      Hardcoded 1-hour windows. Kept for backwards compat with the inline
//      callers in research.route etc. before Day 2.3 swapped them.
//   2. Tier-based limiter — tierCheck(tier, key) + rateLimit(tier) Express
//      middleware. Day 2.3 surface. Tiers are configured in TIERS below.
//
// All windows are in-memory, process-local. Multi-instance deploys each
// hold their own — fine for v1; PgBouncer + Redis is a Day 21 followup
// if the load test exposes stickiness issues.

// ── Legacy (do not extend; use tiers below for new code) ─────────────
const LIMITS = {
  summary:   { max: 5,  windowMs: 60 * 60 * 1000 },
  research:  { max: 10, windowMs: 60 * 60 * 1000 },
  verify:    { max: 20, windowMs: 60 * 60 * 1000 },
  portfolio: { max: 30, windowMs: 60 * 60 * 1000 },
};
const windows = new Map();
const key = (userId, route) => `${userId}:${route}`;

function check(userId, route) {
  const cfg = LIMITS[route];
  if (!cfg) return { allowed: true };
  const k = key(userId, route);
  const now = Date.now();
  const hits = (windows.get(k) || []).filter((ts) => now - ts < cfg.windowMs);
  if (hits.length >= cfg.max) {
    const oldest = hits[0];
    const retryAfter = Math.ceil((oldest + cfg.windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }
  return { allowed: true };
}

function consume(userId, route) {
  const cfg = LIMITS[route];
  if (!cfg) return;
  const k = key(userId, route);
  const now = Date.now();
  const hits = (windows.get(k) || []).filter((ts) => now - ts < cfg.windowMs);
  hits.push(now);
  windows.set(k, hits);
}

// ── Tier surface (Day 2.3) ───────────────────────────────────────────
// Each tier can have a per-minute and a per-day cap. Either is optional.
// `keyHint` is documentation — actual key resolution lives in rateLimit().
const TIERS = {
  ai: {       // protects NEAR_AI_KEY from drain
    minute: { max: 20,  ms:    60_000 },
    day:    { max: 100, ms: 86_400_000 },
    keyHint: "wallet-or-ip",
  },
  nonce: {    // /api/auth/nonce — issued before signing, can't be wallet-keyed
    minute: { max: 60, ms: 60_000 },
    keyHint: "ip",
  },
  mutation: { // declared for future use; not wired in 2.3 (high-churn deferral)
    minute: { max: 60, ms: 60_000 },
    keyHint: "wallet",
  },
  read: {     // declared for future use; not wired in 2.3
    minute: { max: 300, ms: 60_000 },
    keyHint: "ip",
  },
};

const tierBuckets = new Map(); // `${tier}:${bucket}:${key}` -> [timestamps]

function bumpAndCheck(bucketKey, max, windowMs) {
  const now  = Date.now();
  const hits = (tierBuckets.get(bucketKey) || []).filter((ts) => now - ts < windowMs);
  if (hits.length >= max) {
    const retryAfterMs = Math.max(1, hits[0] + windowMs - now);
    return { allowed: false, retryAfterMs };
  }
  hits.push(now);
  tierBuckets.set(bucketKey, hits);
  return { allowed: true };
}

// Probe a tier without consuming. Returns { allowed, retryAfterMs }.
// Use rateLimit() middleware in normal flow; this is for tests.
function tierProbe(tier, identifier) {
  const cfg = TIERS[tier];
  if (!cfg) return { allowed: true };
  const now = Date.now();
  for (const bucket of ["minute", "day"]) {
    const b = cfg[bucket];
    if (!b) continue;
    const k = `${tier}:${bucket}:${identifier}`;
    const hits = (tierBuckets.get(k) || []).filter((ts) => now - ts < b.ms);
    if (hits.length >= b.max) {
      return { allowed: false, retryAfterMs: Math.max(1, hits[0] + b.ms - now), bucket };
    }
  }
  return { allowed: true };
}

// Express middleware factory. `keyFn(req)` defaults to req.wallet || req.ip
// (handles both wallet-keyed and IP-keyed tiers in one shape).
function rateLimit(tier, { keyFn } = {}) {
  const cfg = TIERS[tier];
  if (!cfg) throw new Error(`unknown rate-limit tier: ${tier}`);
  const resolveKey = keyFn || ((req) => req.wallet || req.ip || "anon");
  return function rateLimitMw(req, res, next) {
    const id = resolveKey(req);
    for (const bucket of ["minute", "day"]) {
      const b = cfg[bucket];
      if (!b) continue;
      const k = `${tier}:${bucket}:${id}`;
      const result = bumpAndCheck(k, b.max, b.ms);
      if (!result.allowed) {
        res.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
        return res.status(429).json({
          error: "rate-limited",
          retryAfterMs: result.retryAfterMs,
          tier, bucket,
        });
      }
    }
    next();
  };
}

// Test hook: drop all in-memory state. Tests call this between cases.
function _reset() {
  windows.clear();
  tierBuckets.clear();
}

module.exports = { check, consume, rateLimit, tierProbe, TIERS, _reset };
