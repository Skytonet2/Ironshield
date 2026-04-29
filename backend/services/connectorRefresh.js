// backend/services/connectorRefresh.js
//
// Periodic worker that refreshes OAuth access tokens before they
// expire. Without this, connector_credentials.expires_at goes stale
// and the next invoke() throws 401 on the user.
//
// Strategy:
//   - Every TICK_MS, ask credentialStore for rows whose expires_at is
//     within REFRESH_WINDOW_MS.
//   - For each, look up the connector's refresh() function. If the
//     connector doesn't implement refresh (e.g. session-cookie
//     connectors like LinkedIn, BYO mailbox creds), skip silently —
//     those don't have an automated refresh path.
//   - On success, upsert the new payload + new expires_at.
//   - On failure, leave the row in place and log. The user will hit
//     a 401 on next invoke and the UX should re-route them to
//     /oauth/start.
//
// Wired in server.js next to the other background jobs.

const credentialStore = require("../connectors/credentialStore");
const connectors      = require("../connectors");

const TICK_MS            = 5 * 60 * 1000;  // 5 min
const REFRESH_WINDOW_MS  = 10 * 60 * 1000; // refresh anything expiring inside 10 min
const MAX_PER_TICK       = 25;             // cap so a flood of expiries doesn't stall the loop

let _timer = null;
let _running = false;

async function _tick() {
  if (_running) return; // overlap guard
  _running = true;
  try {
    // Pull at most MAX_PER_TICK rows from the DB — no point fetching
    // more than we'd process this tick. Next tick picks up the rest.
    const expiring = await credentialStore.findExpiring({
      withinMs: REFRESH_WINDOW_MS,
      limit: MAX_PER_TICK,
    });
    if (!expiring.length) return;
    let processed = 0;
    for (const row of expiring) {
      if (processed >= MAX_PER_TICK) break;
      processed++;
      const mod = connectors.get(row.connector_name);
      if (!mod || typeof mod.refresh !== "function") continue;
      try {
        // refresh() returns { payload, expiresAt } on success or throws.
        const fresh = await mod.refresh({ wallet: row.user_wallet });
        if (fresh?.payload) {
          await credentialStore.upsert({
            wallet:    row.user_wallet,
            connector: row.connector_name,
            payload:   fresh.payload,
            expiresAt: fresh.expiresAt || null,
          });
        }
      } catch (e) {
        console.warn(
          `[connectorRefresh] ${row.connector_name} for ${row.user_wallet}: ${e.message}`
        );
        // Don't bubble — one bad row shouldn't stop the rest.
      }
    }
  } catch (e) {
    console.warn("[connectorRefresh] tick failed:", e.message);
  } finally {
    _running = false;
  }
}

function start({ tickMs = TICK_MS } = {}) {
  if (_timer) return; // idempotent
  _timer = setInterval(_tick, tickMs);
  if (typeof _timer.unref === "function") _timer.unref();
  // Kick a tick on boot so a deploy after a long quiet period doesn't
  // wait the full interval before catching expiring tokens. Unref so a
  // process trying to shut down within the first 5s isn't held open.
  const bootTimer = setTimeout(() => { _tick().catch(() => {}); }, 5_000);
  if (typeof bootTimer.unref === "function") bootTimer.unref();
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = { start, stop, _tick };
