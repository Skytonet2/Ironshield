// backend/jobs/walletWatchPoller.job.js
//
// Phase 10 Tier 3 — Wallet Watch Kit poller.
//
// Iterates active `kit_deployments` of slug 'wallet-watch-kit' on a
// short interval. Each tick reads the watched account's balance, runs
// the drain heuristic locally, and on a positive verdict spins up a
// crew run that walks the four-step audit trail (scout → verifier →
// reporter → outreach) and dispatches the alert via Telegram.
//
// Why pre-check before the crew. Naively running runCrew every tick
// would write four audit_log rows per deployment per tick. At 30s
// interval × 100 deployments × 24h = 1.15M rows/day. The cron pre-
// checks cheaply (no DB writes on a no-drain tick), and only spins up
// a mission + crew when the heuristic actually fires. The skill
// re-execution inside the crew is intentional: it builds a coherent
// audit trail tied to the mission, even if the cron's snapshot drifted
// between the pre-check and the crew run.
//
// Synthetic on_chain_id. The Phase 10 contract isn't on mainnet yet
// and we don't want to attach real escrow during a watch-trigger. The
// mission row is created off-chain only, with a synthetic negative
// on_chain_id derived from `kit_deployments.id` so it can never collide
// with a real on-chain mission id (those are unsigned u64). When Phase
// 10 hits mainnet and we want real escrow per incident, the synthetic
// path is replaced by a `create_mission` contract call.
//
// Boot wiring lives in `backend/server.js`; this job exports
// `start()` / `stop()` / `runOnce()` matching the newsBot convention.

const cron = require("node-cron");

const db                 = require("../db/client");
const skills             = require("../services/skills");
const missionEngine      = require("../services/missionEngine");
const crewOrchestrator   = require("../services/crewOrchestrator");
const tgEscalation       = require("../services/tgEscalation");

const KIT_SLUG          = "wallet-watch-kit";
const TEMPLATE_SLUG     = "watch-wallet";
const DEFAULT_INTERVAL  = 60;          // seconds — overridable per deployment
const DEFAULT_THRESHOLD = "1000000000000000000000000"; // 1 NEAR

// in-process per-deployment state. Restarting the backend resets the
// cache, which means the first tick after boot can't trigger a drain
// (no prev_balance). That's the correct behaviour for a relative
// detector — it would be worse to hallucinate a drain off a stale row.
const lastBalance      = new Map();    // deployment_id → balance_yocto string
const lastTickAt       = new Map();    // deployment_id → epoch ms
const incidentCounter  = new Map();    // deployment_id → integer

let task = null;

/** Synthetic on_chain_id for an off-chain incident mission. The
 *  contract uses unsigned u64 and we want zero risk of collision, so
 *  we pick a large-magnitude negative number. The deployment id and
 *  incident counter are baked in so each mission row is unique even
 *  across collisions in clock time. */
function syntheticMissionId(deploymentId, incident) {
  const base = -1_000_000_000_000;     // -1e12 keeps us well clear of u64 min
  return base - (deploymentId * 1000) - incident;
}

async function loadActiveDeployments(client = db) {
  const { rows } = await client.query(
    `SELECT id, kit_slug, agent_owner_wallet, preset_config_json, status
       FROM kit_deployments
      WHERE kit_slug = $1 AND status = 'active'
      ORDER BY created_at ASC`,
    [KIT_SLUG],
  );
  return rows;
}

async function loadKitContext(client = db) {
  const { rows } = await client.query(
    `SELECT bundled_skill_ids FROM agent_kits WHERE slug = $1`,
    [KIT_SLUG],
  );
  if (!rows[0]) throw new Error(`agent_kits row "${KIT_SLUG}" missing — run seedWalletWatchKit.job.js first`);
  const ids = rows[0].bundled_skill_ids || [];
  if (ids.length !== 4) {
    throw new Error(`Wallet Watch Kit expects 4 bundled_skill_ids, found ${ids.length}`);
  }
  // Order is fixed by the seed: scout, verifier, reporter, outreach.
  return {
    scout_skill_id:    Number(ids[0]),
    verifier_skill_id: Number(ids[1]),
    reporter_skill_id: Number(ids[2]),
    outreach_skill_id: Number(ids[3]),
  };
}

function shouldPoll(deployment, nowMs) {
  const interval = Number(deployment.preset_config_json?.poll_interval_seconds) || DEFAULT_INTERVAL;
  const last = lastTickAt.get(deployment.id) || 0;
  return (nowMs - last) >= interval * 1000;
}

async function buildAndRunIncident({ deployment, scoutOut, verdict, kitCtx, deps }) {
  const me = deps.missionEngine    || missionEngine;
  const co = deps.crewOrchestrator || crewOrchestrator;
  const tg = deps.tgEscalation     || tgEscalation;

  const incident = (incidentCounter.get(deployment.id) || 0) + 1;
  incidentCounter.set(deployment.id, incident);
  const mission_id = syntheticMissionId(deployment.id, incident);

  const inputs_json = {
    kit_slug:    KIT_SLUG,
    template:    TEMPLATE_SLUG,
    deployment_id: deployment.id,
    incident,
    snapshot: {
      address:            scoutOut.address,
      balance_yocto:      scoutOut.balance_yocto,
      prev_balance_yocto: scoutOut.prev_balance_yocto,
      delta_yocto:        scoutOut.delta_yocto,
      polled_at:          scoutOut.polled_at,
    },
    verdict,
  };
  const inputs_hash = me.hashPayload(inputs_json);

  await me.recordCreated({
    on_chain_id:      mission_id,
    template_slug:    TEMPLATE_SLUG,
    poster_wallet:    deployment.agent_owner_wallet,
    kit_slug:         KIT_SLUG,
    inputs_json,
    inputs_hash,
    escrow_yocto:     "0",
    platform_fee_bps: 500,
    tx_create:        null,
  });

  const cfg            = deployment.preset_config_json || {};
  const threshold      = String(cfg.alert_threshold_yocto || DEFAULT_THRESHOLD);
  const knownDest      = Array.isArray(cfg.known_destinations) ? cfg.known_destinations : [];

  const steps = [
    {
      skill_id: kitCtx.scout_skill_id,
      role:     "scout",
      params: {
        address:            scoutOut.address,
        prev_balance_yocto: scoutOut.prev_balance_yocto,
      },
    },
    {
      skill_id: kitCtx.verifier_skill_id,
      role:     "verifier",
      params: {
        balance_yocto:         scoutOut.balance_yocto,
        prev_balance_yocto:    scoutOut.prev_balance_yocto,
        alert_threshold_yocto: threshold,
        known_destinations:    knownDest,
        recent_destinations:   [],
      },
    },
    {
      skill_id: kitCtx.reporter_skill_id,
      role:     "reporter",
      params: {
        address:            scoutOut.address,
        balance_yocto:      scoutOut.balance_yocto,
        prev_balance_yocto: scoutOut.prev_balance_yocto,
        is_drain:           true,
        severity:           verdict.severity,
        reasons:            verdict.reasons,
        polled_at:          scoutOut.polled_at,
      },
    },
    {
      skill_id: kitCtx.outreach_skill_id,
      role:     "outreach",
      // payload.recipient_count drives the auth-engine threshold rule.
      // We always have one recipient (the deployment owner), so the
      // mass-DM rule never fires and the verdict is auto.
      payload: { recipient_count: 1 },
      params: {
        owner_wallet: deployment.agent_owner_wallet,
        headline:     `Possible drain on ${scoutOut.address} — severity ${verdict.severity}`,
        summary:      `Outflow ${verdict.outflow_yocto} yoctoNEAR triggered ${verdict.reasons.length} reason(s).`,
        channel:      "tg",
      },
    },
  ];

  return co.runCrew({
    mission_id,
    steps,
    dispatchEscalation: tg.dispatch,
    deps: deps.crewDeps || {},
  });
}

async function runOnceForDeployment(deployment, kitCtx, deps = {}) {
  const sk = deps.skills || skills;
  const cfg = deployment.preset_config_json || {};
  const address = String(cfg.address || "").trim();
  if (!address) {
    return { deployment_id: deployment.id, status: "skipped_no_address" };
  }

  const prev_balance_yocto = lastBalance.get(deployment.id) || null;

  let scoutOut;
  try {
    scoutOut = await sk.runByCategory({
      category: "builtin:watch_balance",
      ctx: { params: { address, prev_balance_yocto } },
      verified: false,
    });
  } catch (e) {
    return { deployment_id: deployment.id, status: "watch_failed", error: e.message };
  }

  // Always update the cache — even on a drain tick — so the next
  // tick's prev_balance is the latest reading rather than the pre-drain
  // value. Otherwise a single drain would re-fire every tick until the
  // attacker stopped moving funds.
  lastBalance.set(deployment.id, scoutOut.balance_yocto);

  if (prev_balance_yocto == null) {
    return { deployment_id: deployment.id, status: "first_poll", balance: scoutOut.balance_yocto };
  }

  let verdict;
  try {
    verdict = await sk.runByCategory({
      category: "builtin:detect_drain",
      ctx: {
        params: {
          balance_yocto:         scoutOut.balance_yocto,
          prev_balance_yocto:    scoutOut.prev_balance_yocto,
          alert_threshold_yocto: String(cfg.alert_threshold_yocto || DEFAULT_THRESHOLD),
          known_destinations:    cfg.known_destinations || [],
        },
      },
      verified: false,
    });
  } catch (e) {
    return { deployment_id: deployment.id, status: "verify_failed", error: e.message };
  }

  if (!verdict.is_drain) {
    return { deployment_id: deployment.id, status: "no_drain", balance: scoutOut.balance_yocto };
  }

  const run = await buildAndRunIncident({ deployment, scoutOut, verdict, kitCtx, deps });
  return {
    deployment_id: deployment.id,
    status: "drain_dispatched",
    mission_id: run.mission_id,
    crew_status: run.status,
    audit_root: run.audit_root,
  };
}

async function runOnce(deps = {}) {
  const deployments = await loadActiveDeployments();
  if (deployments.length === 0) return { ticked: 0, results: [] };

  let kitCtx;
  try { kitCtx = await loadKitContext(); }
  catch (e) {
    console.warn(`[wallet-watch] ${e.message}`);
    return { ticked: 0, results: [], error: e.message };
  }

  const now = Date.now();
  const results = [];
  for (const deployment of deployments) {
    if (!shouldPoll(deployment, now)) continue;
    lastTickAt.set(deployment.id, now);
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await runOnceForDeployment(deployment, kitCtx, deps);
      results.push(r);
    } catch (e) {
      results.push({ deployment_id: deployment.id, status: "error", error: e.message });
    }
  }
  return { ticked: results.length, results };
}

function start({ intervalSeconds = 30 } = {}) {
  if (task) return task;
  // node-cron schedule string: every <intervalSeconds> seconds.
  // node-cron supports seconds when the schedule has 6 fields.
  const schedule = `*/${Math.max(5, Math.min(intervalSeconds, 60))} * * * * *`;
  task = cron.schedule(schedule, () => {
    runOnce().catch((e) => console.warn(`[wallet-watch] tick failed: ${e.message}`));
  }, { scheduled: true });
  console.log(`[wallet-watch] scheduled every ${intervalSeconds}s`);
  return task;
}

function stop() {
  if (task) { task.stop(); task = null; }
  lastBalance.clear();
  lastTickAt.clear();
  incidentCounter.clear();
}

module.exports = {
  KIT_SLUG,
  TEMPLATE_SLUG,
  start,
  stop,
  runOnce,
  runOnceForDeployment,
  buildAndRunIncident,
  syntheticMissionId,
  loadActiveDeployments,
  loadKitContext,
  // Test hooks — allow tests to seed cache state without booting cron.
  _state: { lastBalance, lastTickAt, incidentCounter },
};
