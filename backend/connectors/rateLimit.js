// backend/connectors/rateLimit.js
//
// Per-connector outbound rate-limit hub. Token bucket per
// (connector_name, wallet) — the second key is "platform" for
// connectors that use a shared platform-wide key (e.g. TG bot,
// X app bearer) so all callers share one bucket.
//
// Connectors don't call this directly; the dispatcher in index.js
// invokes `acquire` before forwarding. This is the single choke
// point for outbound traffic — keep it that way.
//
// In-memory, process-local. Multi-instance deploys hold their own.
// That's fine for v1 — the per-process budget is conservative
// enough that even N processes won't tip a real provider over.

const QUOTAS = new Map();        // name -> { capacity, refillMs, scope }
const BUCKETS = new Map();       // `${name}:${key}` -> { tokens, last, queue }

// Lazy telemetry — same pattern as connectors/index.js.
let _telemetry = null;
function _bump(event, label) {
  if (!_telemetry) {
    try { _telemetry = require("../services/telemetry"); } catch { _telemetry = { bumpFireAndForget: () => {} }; }
  }
  _telemetry.bumpFireAndForget(event, label);
}

const MAX_QUEUE = 32;            // hard cap so a runaway agent can't OOM
const MIN_WAIT_MS = 25;
const MAX_WAIT_MS = 5_000;

function configure(name, limits) {
  // limits accepts { per_minute, per_hour, per_day, scope }. We pick the
  // tightest one and convert to a token-bucket (capacity, refillMs).
  // If nothing's set we default to a permissive 60/min so a connector
  // that forgets to declare can't be used as an unbounded firehose.
  const candidates = [];
  if (limits.per_minute) candidates.push({ cap: limits.per_minute, ms: 60_000 });
  if (limits.per_hour)   candidates.push({ cap: limits.per_hour,   ms: 3_600_000 });
  if (limits.per_day)    candidates.push({ cap: limits.per_day,    ms: 86_400_000 });
  if (candidates.length === 0) candidates.push({ cap: 60, ms: 60_000 });
  // Pick the tightest tokens-per-ms.
  candidates.sort((a, b) => (a.cap / a.ms) - (b.cap / b.ms));
  const tightest = candidates[0];
  QUOTAS.set(name, {
    capacity: tightest.cap,
    refillMs: tightest.ms / tightest.cap,
    scope: limits.scope || "wallet",
  });
}

function _bucket(name, key) {
  const bk = `${name}:${key}`;
  let b = BUCKETS.get(bk);
  if (!b) {
    const q = QUOTAS.get(name);
    if (!q) throw new Error(`rateLimit: no quota for ${name} — register the connector first`);
    b = { tokens: q.capacity, last: Date.now(), queue: 0 };
    BUCKETS.set(bk, b);
  }
  return b;
}

function _refill(b, q) {
  const now = Date.now();
  const elapsed = now - b.last;
  if (elapsed <= 0) return;
  const add = elapsed / q.refillMs;
  if (add > 0) {
    b.tokens = Math.min(q.capacity, b.tokens + add);
    b.last = now;
  }
}

/**
 * Acquire one token. Resolves when granted; rejects if the queue for
 * this (connector,key) is at MAX_QUEUE depth. Throws if the connector
 * isn't registered.
 */
function acquire(name, walletOrPlatform = "platform") {
  const q = QUOTAS.get(name);
  if (!q) return Promise.reject(new Error(`rateLimit: unknown connector ${name}`));
  const key = q.scope === "platform" ? "platform" : (walletOrPlatform || "platform");
  const b = _bucket(name, key);

  return new Promise((resolve, reject) => {
    const tryNow = () => {
      _refill(b, q);
      if (b.tokens >= 1) {
        b.tokens -= 1;
        if (b.queue > 0) b.queue -= 1;
        resolve();
        return;
      }
      const wait = Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, q.refillMs));
      // unref so a pending acquire never keeps the process alive — matters
      // for tests and graceful shutdown. A long-lived backend has plenty
      // of other handles holding the loop open during normal operation.
      setTimeout(tryNow, wait).unref?.();
    };

    if (b.queue >= MAX_QUEUE) {
      const err = new Error(`rateLimit: ${name}/${key} queue full (${MAX_QUEUE})`);
      err.code = "RATE_LIMIT_QUEUE_FULL";
      _bump("rate_limit.queue_full", name);
      reject(err);
      return;
    }
    b.queue += 1;
    tryNow();
  });
}

// Non-blocking probe — returns true iff a token is currently available.
// Doesn't consume. Useful for callers that want to fail fast.
function tryAcquire(name, walletOrPlatform = "platform") {
  const q = QUOTAS.get(name);
  if (!q) return false;
  const key = q.scope === "platform" ? "platform" : (walletOrPlatform || "platform");
  const b = _bucket(name, key);
  _refill(b, q);
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}

function _reset() {
  QUOTAS.clear();
  BUCKETS.clear();
}

module.exports = { configure, acquire, tryAcquire, _reset };
