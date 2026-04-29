// backend/services/classifiedsDrift.js
//
// Selector-drift watch for the classifieds connector. Once a week (or
// on-demand via the admin endpoint), runs a small generic search
// against every registered site and records the per-site result count
// to event_counters. A site that used to return 20 items now returning
// 0 is the early signal of selector rot, IP block, or site downtime.
//
// Cost: each tick spawns Playwright N times serially (one site at a
// time, gated by the classifieds connector's _busy mutex). On the
// starter Render plan that's a 200MB Chromium spike per site —
// serializing avoids hitting the 512MB ceiling.
//
// Lazy-Playwright safe: if the runtime browser isn't installed, the
// connector throws CLASSIFIEDS_PLAYWRIGHT_MISSING. We catch and skip
// the cron rather than crashing the worker thread.

const TICK_MS  = 7 * 24 * 60 * 60 * 1000;   // weekly
const BOOT_MS  = 5 * 60 * 1000;             // first tick 5 min after boot
const QUERY    = "phone";                    // generic — almost every site has phone listings
const PER_SITE_TIMEOUT_MS = 60_000;         // per-site cap so a stuck Chromium doesn't hold the cron

let _classifieds = null;
function _connector() {
  if (!_classifieds) {
    try { _classifieds = require("../connectors/classifieds"); } catch { _classifieds = null; }
  }
  return _classifieds;
}

let _telemetry = null;
function _bump(event, label) {
  if (!_telemetry) {
    try { _telemetry = require("./telemetry"); } catch { _telemetry = { bumpFireAndForget: () => {} }; }
  }
  _telemetry.bumpFireAndForget(event, label);
}

let _logger = null;
function _log() {
  if (!_logger) {
    try { _logger = require("./logger"); } catch { _logger = { info: console.log, warn: console.warn }; }
  }
  return _logger;
}

let _timer = null;
let _running = false;

/** Run the drift check once across all configured sites. Returns an
 *  array of per-site results — one row per site with status, count,
 *  and (on failure) error code. Pure-ish — only writes to telemetry. */
async function runOnce() {
  if (_running) {
    _log().warn({ event: "classifieds.drift.skipped" }, "drift run already in progress");
    return { skipped: true };
  }
  _running = true;
  const out = [];
  try {
    const cf = _connector();
    if (!cf) {
      _log().warn({ event: "classifieds.drift.connector_missing" }, "classifieds connector not loaded; skipping");
      return { skipped: true, reason: "connector-not-loaded" };
    }
    const sites = Object.keys(cf._SITES || {}).sort();
    if (sites.length === 0) {
      return { skipped: true, reason: "no-sites" };
    }
    for (const siteId of sites) {
      const start = Date.now();
      try {
        // Per-site timeout race so a stuck browser doesn't lock the
        // cron forever.
        const result = await Promise.race([
          cf.invoke("search", { wallet: "platform", params: { site: siteId, query: QUERY, limit: 5 } }),
          new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("per-site timeout"), { code: "DRIFT_TIMEOUT" })), PER_SITE_TIMEOUT_MS)),
        ]);
        const count = result?.count ?? (Array.isArray(result?.items) ? result.items.length : 0);
        const ok = count > 0;
        _bump(ok ? "classifieds.drift.ok" : "classifieds.drift.empty", siteId);
        out.push({ site: siteId, status: ok ? "ok" : "empty", count, duration_ms: Date.now() - start });
        _log().info({
          event: "classifieds.drift.tick",
          site: siteId, count, ok, duration_ms: Date.now() - start,
        }, `drift ${siteId}: ${ok ? "ok" : "empty"} (${count})`);
      } catch (e) {
        _bump("classifieds.drift.failure", siteId);
        out.push({ site: siteId, status: "failure", error: e.message, code: e.code, duration_ms: Date.now() - start });
        _log().warn({
          event: "classifieds.drift.tick",
          site: siteId, err: e.message, code: e.code, duration_ms: Date.now() - start,
        }, `drift ${siteId} failed`);
      }
    }
    return { sites: out, summary: summarise(out) };
  } finally {
    _running = false;
  }
}

function summarise(rows) {
  const ok = rows.filter((r) => r.status === "ok").length;
  const empty = rows.filter((r) => r.status === "empty").length;
  const failure = rows.filter((r) => r.status === "failure").length;
  return { total: rows.length, ok, empty, failure };
}

/** Schedule weekly runs + an initial kick BOOT_MS after start. Both
 *  timers .unref() so a process trying to shut down isn't held open. */
function start({ tickMs = TICK_MS, bootMs = BOOT_MS } = {}) {
  if (_timer) return;
  _timer = setInterval(() => { runOnce().catch(() => {}); }, tickMs);
  if (typeof _timer.unref === "function") _timer.unref();
  const boot = setTimeout(() => { runOnce().catch(() => {}); }, bootMs);
  if (typeof boot.unref === "function") boot.unref();
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = { runOnce, start, stop, summarise };
