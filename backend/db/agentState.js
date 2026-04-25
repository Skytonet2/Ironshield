// backend/db/agentState.js
// Tiny KV wrapper over the agent_state Postgres table. Replaces the
// four mutable JSON files (activePrompt, activeMission, listenerState,
// loopState) that previously lived on ephemeral container disk.
//
// Two surfaces:
//   - get(key) / set(key, value)  — async, authoritative.
//   - getCached(key, ttlMs)       — sync, returns last-known value and
//                                   spawns a background refresh on
//                                   stale-or-missing. Used in hot AI
//                                   paths (every NEAR-AI call) so we
//                                   don't add a DB round-trip per call.
//
// Caller-side fallbacks: getCached returns null on cold cache. The
// hot callers (agentConnector.getGovContext, nearAgent.getSystemPrompt)
// already short-circuit null with a sensible default string, so cold
// startup degrades to "no governance prompt" rather than crashing.

const db = require("./client");

const cache = new Map(); // key -> { value, fetchedAt, inflight }

async function get(key) {
  const r = await db.query("SELECT value FROM agent_state WHERE key = $1", [key]);
  return r.rows[0]?.value ?? null;
}

async function set(key, value) {
  await db.query(
    `INSERT INTO agent_state (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
  // Bust local cache so the next getCached refreshes immediately.
  cache.delete(key);
}

// Sync read with background refresh. Returns the cached value (possibly
// null on cold start) and kicks off an async refresh whenever the entry
// is missing or older than ttlMs. Subsequent calls within ttlMs are
// served from memory at zero cost.
function getCached(key, ttlMs = 30_000) {
  const entry = cache.get(key);
  const now   = Date.now();
  const stale = !entry || now - entry.fetchedAt > ttlMs;
  if (stale && !entry?.inflight) {
    const inflight = (async () => {
      try {
        const value = await get(key);
        cache.set(key, { value, fetchedAt: Date.now(), inflight: null });
      } catch (err) {
        // Keep prior value on error so a transient DB blip doesn't blank
        // the AI prompt mid-call. Log once and clear the inflight flag.
        console.warn(`[agentState] refresh failed for ${key}:`, err.message);
        const cur = cache.get(key);
        if (cur) cur.inflight = null;
      }
    })();
    if (entry) entry.inflight = inflight;
    else cache.set(key, { value: null, fetchedAt: 0, inflight });
  }
  return entry?.value ?? null;
}

// Force-prime the cache. Awaited at boot when a caller wants a guaranteed
// non-null read on the first hot call.
async function prime(key) {
  const value = await get(key);
  cache.set(key, { value, fetchedAt: Date.now(), inflight: null });
  return value;
}

// One-shot disk-to-DB migration. Called from migrate() on boot. If any of
// the four legacy JSON files exist AND the corresponding agent_state row
// is empty, copy the file value into the row. After a successful copy the
// files are no longer read — this is purely a transition aid for stacks
// that have legacy disk state from before Day 3.2.
async function migrateFromDisk(repoRoot) {
  const fs   = require("fs");
  const path = require("path");
  const map = {
    activePrompt:  path.join(repoRoot, "agent", "activePrompt.json"),
    activeMission: path.join(repoRoot, "agent", "activeMission.json"),
    listenerState: path.join(repoRoot, "agent", "listenerState.json"),
    loopState:     path.join(repoRoot, "agent", "loopState.json"),
  };
  for (const [key, file] of Object.entries(map)) {
    if (!fs.existsSync(file)) continue;
    const existing = await get(key);
    if (existing !== null) continue;
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      await set(key, value);
      console.log(`[agentState] migrated ${file} → agent_state.${key}`);
    } catch (err) {
      console.warn(`[agentState] migrate ${key} skipped:`, err.message);
    }
  }
}

module.exports = { get, set, getCached, prime, migrateFromDisk };
