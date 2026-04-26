// backend/middleware/requireAdmin.js
// Chainable Express middleware that enforces an admin allowlist on top of
// requireWallet. Use in middleware position AFTER requireWallet:
//   router.post("/x", requireWallet, requireAdmin, handler);
// Reads the wallet from req.wallet (set by requireWallet) and checks it
// against the admin_wallets table. 403s otherwise.

const db = require("../db/client");

// In-memory allowlist cache. The table changes rarely (manual SQL), so
// 60s staleness is fine and avoids hammering Postgres on every admin
// click. Reset on process restart.
let cache = null;
let cacheAt = 0;
const TTL_MS = 60_000;

async function loadAllowlist() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  const { rows } = await db.query("SELECT wallet, role FROM admin_wallets");
  cache = new Map(rows.map((r) => [r.wallet, r.role]));
  cacheAt = Date.now();
  return cache;
}

function invalidate() { cache = null; cacheAt = 0; }

async function requireAdmin(req, res, next) {
  if (!req.wallet) return res.status(401).json({ error: "wallet required", code: "missing-sig" });
  try {
    const allow = await loadAllowlist();
    const role = allow.get(req.wallet);
    if (!role) return res.status(403).json({ error: "admin only", code: "forbidden" });
    req.adminRole = role;
    next();
  } catch (err) {
    console.warn("[requireAdmin] lookup failed:", err.message);
    res.status(503).json({ error: "admin lookup unavailable" });
  }
}

module.exports = requireAdmin;
module.exports.invalidate = invalidate;
