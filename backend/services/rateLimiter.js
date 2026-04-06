// backend/services/rateLimiter.js
const LIMITS = {
  summary:   { max: 5,  windowMs: 60 * 60 * 1000 },
  research:  { max: 10, windowMs: 60 * 60 * 1000 },
  verify:    { max: 20, windowMs: 60 * 60 * 1000 },
  portfolio: { max: 30, windowMs: 60 * 60 * 1000 },
};

// { userId_route: [timestamps] }
const windows = new Map();

const key = (userId, route) => `${userId}:${route}`;

module.exports = {
  check(userId, route) {
    const cfg  = LIMITS[route];
    if (!cfg)  return { allowed: true };
    const k    = key(userId, route);
    const now  = Date.now();
    const hits = (windows.get(k) || []).filter(ts => now - ts < cfg.windowMs);
    if (hits.length >= cfg.max) {
      const oldest    = hits[0];
      const retryAfter = Math.ceil((oldest + cfg.windowMs - now) / 1000);
      return { allowed: false, retryAfter };
    }
    return { allowed: true };
  },
  consume(userId, route) {
    const k   = key(userId, route);
    const cfg = LIMITS[route];
    if (!cfg) return;
    const now  = Date.now();
    const hits = (windows.get(k) || []).filter(ts => now - ts < cfg.windowMs);
    hits.push(now);
    windows.set(k, hits);
  },
};
