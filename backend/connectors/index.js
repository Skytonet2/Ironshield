// backend/connectors/index.js
//
// Web2 connector dispatcher (Phase 10 Tier 4).
//
// Each connector module exports the contract:
//   {
//     name:         string,
//     capabilities: ('search'|'read'|'write'|'monitor')[],
//     rate_limits:  { per_minute?, per_hour?, per_day?, scope?: 'wallet'|'platform' },
//     auth_method:  'oauth'|'api_key'|'session_token'|'byo_account',
//     invoke(action, ctx): Promise<any>,
//   }
//
// Callers go through `invoke(name, action, ctx)`. The dispatcher acquires
// a rate-limit token before forwarding — no connector should make
// outbound calls bypassing rateLimit.acquire (Tier 4 constraint).

const rateLimit = require("./rateLimit");

const REGISTRY = new Map();

function register(mod) {
  if (!mod || typeof mod !== "object") {
    throw new Error("connector module must be an object");
  }
  if (!mod.name || typeof mod.name !== "string") {
    throw new Error("connector must export a string `name`");
  }
  if (!Array.isArray(mod.capabilities) || mod.capabilities.length === 0) {
    throw new Error(`connector ${mod.name}: capabilities[] required`);
  }
  if (typeof mod.invoke !== "function") {
    throw new Error(`connector ${mod.name}: invoke(action, ctx) required`);
  }
  if (!["oauth", "api_key", "session_token", "byo_account"].includes(mod.auth_method)) {
    throw new Error(`connector ${mod.name}: invalid auth_method ${mod.auth_method}`);
  }
  if (REGISTRY.has(mod.name)) {
    throw new Error(`connector ${mod.name}: already registered`);
  }
  REGISTRY.set(mod.name, mod);
  rateLimit.configure(mod.name, mod.rate_limits || {});
  return mod;
}

function get(name) {
  return REGISTRY.get(name) || null;
}

function list() {
  return Array.from(REGISTRY.values()).map((m) => ({
    name: m.name,
    capabilities: m.capabilities.slice(),
    auth_method: m.auth_method,
    rate_limits: m.rate_limits || {},
  }));
}

/**
 * Invoke a connector action. Acquires a rate-limit token first so the
 * connector code doesn't have to remember to. ctx must include a
 * `wallet` (or 'platform' for shared-key calls).
 */
async function invoke(name, action, ctx = {}) {
  const mod = REGISTRY.get(name);
  if (!mod) throw new Error(`unknown connector: ${name}`);
  const wallet = ctx.wallet || "platform";
  await rateLimit.acquire(name, wallet);
  return mod.invoke(action, ctx);
}

// Auto-register first-party connector modules. Each module is wrapped in
// try/catch so a single broken connector (e.g., missing optional dep)
// doesn't take down the others. Failures are logged once at boot.
function loadBuiltins() {
  const candidates = [
    "./tg",
    "./x",
    "./facebook",
    // Additional connectors register themselves as their commits land.
    // "./jiji", "./email", "./whatsapp", "./linkedin",
  ];
  for (const path of candidates) {
    try {
      register(require(path));
    } catch (e) {
      console.warn(`[connectors] failed to load ${path}:`, e.message);
    }
  }
}

let _loaded = false;
function ensureLoaded() {
  if (_loaded) return;
  _loaded = true;
  loadBuiltins();
}
ensureLoaded();

// Test hook: drop in-memory state. Tests reset and re-register.
function _reset() {
  REGISTRY.clear();
  rateLimit._reset();
  _loaded = false;
}

module.exports = { register, get, list, invoke, _reset };
