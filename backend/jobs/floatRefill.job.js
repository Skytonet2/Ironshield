// backend/jobs/floatRefill.job.js
//
// Hourly NEAR-float-refill cron.
//
// On each tick we look at the float wallet balance vs FLOAT_MIN_NEAR.
// If we're underwater, we ask the configured exchange adapter to swap
// accumulated naira into NEAR up to FLOAT_TARGET_NEAR, then log the
// refill in psp_naira_float_log.
//
// Exchange adapter is selected via PSP_EXCHANGE=quidax|bitget|binance|none.
// `none` (default) is a dry-run mode that ONLY emits an alert log when
// the float drops below FLOAT_MIN_NEAR and otherwise does nothing — for
// pre-launch dev where the operator hasn't yet picked an exchange API
// or wired live naira→NEAR conversion. This keeps the cron safe-by-
// default: until you explicitly opt in, it cannot move money.
//
// Boot wiring is gated on PAYSTACK_SECRET_KEY being set (no point
// running the cron in deploys that haven't enabled the on-ramp at all).

const cron = require("node-cron");

const db           = require("../db/client");
const floatManager = require("../services/psp/floatManager");

// Hourly at minute 7 — offset from other crons so they don't all queue
// up on the same wall-clock minute.
const SCHEDULE = process.env.FLOAT_REFILL_SCHEDULE || "7 * * * *";

let task = null;

async function runOnce() {
  let status;
  try {
    status = await floatManager.status();
  } catch (err) {
    console.error("[floatRefill] status() failed:", err.message);
    return { ok: false, reason: "status-failed" };
  }
  if (!status.configured) {
    return { ok: false, reason: "not-configured" };
  }
  if (status.over_cap) {
    console.warn(
      `[floatRefill] OVER CAP: balance ${status.balance_near} N > FLOAT_MAX_NEAR ${status.max_near} N — refusing further refills, drain manually`,
    );
    return { ok: true, action: "over-cap-skip", status };
  }
  if (!status.needs_refill) {
    return { ok: true, action: "no-op", status };
  }

  const exchange = (process.env.PSP_EXCHANGE || "none").toLowerCase();
  const need_near = status.target_near - status.balance_near;
  console.warn(
    `[floatRefill] LOW: balance ${status.balance_near} N < FLOAT_MIN_NEAR ${status.min_near} N — would refill ~${need_near} N via ${exchange}`,
  );

  if (exchange === "none") {
    // Pre-launch / no-exchange-wired mode. Loud log so the operator
    // notices, but no money is moved. Refilling the float is a manual
    // ops action until PSP_EXCHANGE is set.
    return { ok: true, action: "alert-only", need_near };
  }

  // Real exchange wiring is intentionally not in this PR. Each adapter
  // (Quidax, Bitget, Binance NG) needs its own API-key handling, KYC
  // posture, and rate-limit story; ship one at a time once the founder
  // has chosen which exchange to integrate against. Until then we log
  // the intent and defer to manual ops.
  console.warn(
    `[floatRefill] PSP_EXCHANGE=${exchange} but no adapter wired — manual refill required. To wire, add backend/services/psp/exchanges/${exchange}.js implementing { swapNairaToNear(need_near) }.`,
  );

  await db.query(
    `INSERT INTO psp_naira_float_log
       (kind, naira_kobo, near_amount_yocto, exchange, notes)
     VALUES ('alert', NULL, 0, $1, $2)`,
    [exchange, `float low: balance=${status.balance_near}N target=${status.target_near}N`],
  );

  return { ok: true, action: "logged-need", need_near, exchange };
}

function start() {
  if (task) return task;
  if (!process.env.PAYSTACK_SECRET_KEY) {
    console.log("[floatRefill] PAYSTACK_SECRET_KEY not set — cron disabled");
    return null;
  }
  task = cron.schedule(SCHEDULE, () => {
    runOnce().catch((err) => {
      console.error("[floatRefill] tick failed:", err.message);
    });
  });
  console.log(`[floatRefill] scheduled (${SCHEDULE})`);
  return task;
}

function stop() {
  if (task) { task.stop(); task = null; }
}

module.exports = { start, stop, runOnce };
