// backend/routes/missions.route.js
//
// Phase 10 — Agent Economy: mission lifecycle surface.
//
// Read-side endpoints are public; write-side endpoints expect an
// authenticated wallet. The contract is the source of truth for
// state — these endpoints render the off-chain mirror, append to the
// audit log, and provide a DB-level abort/approve hook that the
// frontend pairs with the corresponding signed contract call.
//
// Endpoints:
//   GET  /api/missions                    list (filters: status, kit_slug, mine)
//   GET  /api/missions/:id                full row + audit log + escalations
//   GET  /api/missions/:id/audit          just the audit chain
//   GET  /api/missions/:id/audit/root     the latest payload_hash
//   GET  /api/missions/:id/stream         SSE: live audit + escalation events
//   POST /api/missions/:id/record-create  off-chain bootstrap after create_mission
//   POST /api/missions/:id/audit          append a step to the audit log
//   POST /api/missions/:id/run-crew       run a sequential crew (auth-gated)
//   POST /api/missions/:id/mirror         indexer/orchestrator pushes a state event

const router = require("express").Router();
const requireWallet      = require("../middleware/requireWallet");
const missionEngine      = require("../services/missionEngine");
const crewOrchestrator   = require("../services/crewOrchestrator");
const tgEscalation       = require("../services/tgEscalation");
const eventBus           = require("../services/eventBus");
const db                 = require("../db/client");

router.get("/", async (req, res) => {
  try {
    const { status, kit_slug, poster, claimant, mine, limit } = req.query;
    let posterFilter = poster || null;
    let claimantFilter = claimant || null;
    if (mine === "1" && req.headers["x-wallet"]) {
      posterFilter ||= String(req.headers["x-wallet"]).toLowerCase();
    }
    const rows = await missionEngine.listMissions({
      status: status || null,
      poster_wallet: posterFilter,
      claimant_wallet: claimantFilter,
      kit_slug: kit_slug || null,
      limit: Math.min(Number(limit) || 50, 200),
    });
    res.json({ missions: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const mission = await missionEngine.getMission(id);
    if (!mission) return res.status(404).json({ error: "Mission not found" });
    const [audit, escalations] = await Promise.all([
      missionEngine.getAuditLog(id),
      require("../db/client").query(
        `SELECT id, step_seq, action_type, status, channel, decided_by_wallet,
                decided_at, created_at, expires_at
           FROM mission_escalations
          WHERE mission_on_chain_id = $1
          ORDER BY created_at DESC`,
        [id],
      ).then(r => r.rows),
    ]);
    res.json({ mission, audit, escalations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/audit", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const audit = await missionEngine.getAuditLog(id);
    res.json({ audit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/audit/root", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const root = await missionEngine.getAuditRoot(id);
    res.json({ audit_root: root });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── SSE: live mission stream ────────────────────────────────────────
//
// Streams new audit-log entries and escalation lifecycle changes for a
// single mission as they happen. Reads piggyback on the existing
// public read-side endpoints, so no auth is required here either —
// the data is the same shape `GET /:id` already returns.
//
// Wire format:
//   event: snapshot              (sent once on connect)
//   data: { audit: [...], escalations: [...] }
//
//   event: audit.appended        (every new audit_log row for this mission)
//   data: { mission_on_chain_id, step_seq, action_type, payload_hash, ... }
//
//   event: escalation.created    (every new mission_escalations row)
//   data: { mission_on_chain_id, escalation_id, action_type, status, channel, ... }
//
//   event: escalation.resolved   (status flip on an existing escalation)
//   data: { mission_on_chain_id, escalation_id, status, decided_at, ... }
//
// A `:keepalive` SSE comment is sent every 30 s so corporate proxies
// don't cull the connection. Subscriptions are torn down when the
// client closes the connection or `req.on('close')` fires.
//
// Handler is exported as a named function so it's exercised directly
// with mocked req/res + injected deps in tests — no Express server
// needed. Production callers go through the route registration below.
function sseFrame(eventName, data) {
  // SSE wire format: each event is "event: name\ndata: <line>\n\n".
  // Multi-line data fields are encoded as multiple `data:` lines but
  // we serialise to JSON which has no line breaks, so a single line
  // is always sufficient.
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function streamHandler(req, res, deps = {}) {
  const me  = deps.missionEngine || missionEngine;
  const dbc = deps.db            || db;
  const bus = deps.eventBus      || eventBus;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id must be numeric" });
  }
  const mission = await me.getMission(id);
  if (!mission) {
    return res.status(404).json({ error: "Mission not found" });
  }

  // Kick the connection into SSE mode. flushHeaders() is a no-op on
  // mocks; on the real Node http response it forces the headers out
  // before the first body write so the client knows it's an SSE stream.
  res.statusCode = 200;
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx response buffering
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  // Initial snapshot: matches what GET /:id would return for audit +
  // escalations. Lets the frontend bootstrap without a separate fetch.
  const audit       = await me.getAuditLog(id);
  const { rows: escalations } = await dbc.query(
    `SELECT id, step_seq, action_type, status, channel, decided_by_wallet,
            decided_at, created_at, expires_at
       FROM mission_escalations
      WHERE mission_on_chain_id = $1
      ORDER BY created_at DESC`,
    [id],
  );
  res.write(sseFrame("snapshot", { audit, escalations }));

  // Filter every bus event by mission id so a chatty mission elsewhere
  // doesn't fan out to other listeners. Track (channel, listener)
  // pairs so cleanup works both against the real eventBus wrapper
  // (which returns its own unsubscribe) and against a raw
  // EventEmitter (whose `.on` returns the emitter itself, not an unsub).
  const matches = (payload) => Number(payload?.mission_on_chain_id) === id;
  const subs = [];
  const wireUp = (channel, eventName) => {
    const listener = (payload) => {
      if (!matches(payload)) return;
      try { res.write(sseFrame(eventName, payload)); } catch { /* client gone */ }
    };
    bus.on(channel, listener);
    subs.push({ channel, listener });
  };
  wireUp("mission.audit.appended",      "audit.appended");
  wireUp("mission.escalation.created",  "escalation.created");
  wireUp("mission.escalation.resolved", "escalation.resolved");

  // Keepalive against idle-connection killers (heroku, nginx default
  // is 60s). Comment lines are ignored by EventSource.
  const keepalive = setInterval(() => {
    try { res.write(":keepalive\n\n"); } catch { /* client gone */ }
  }, 30_000);
  if (keepalive.unref) keepalive.unref();

  const cleanup = () => {
    clearInterval(keepalive);
    for (const { channel, listener } of subs) {
      if (typeof bus.off === "function") bus.off(channel, listener);
      else if (typeof bus.removeListener === "function") bus.removeListener(channel, listener);
    }
  };
  // req.on('close') fires whether the client disconnects cleanly or
  // the response was ended on our side — covers both paths.
  if (typeof req.on === "function") req.on("close", cleanup);
  return cleanup; // exposed for direct test invocation
}

router.get("/:id/stream", (req, res) => streamHandler(req, res));

// Frontend bootstrap: posters call this right after their create_mission
// tx lands so the off-chain mirror is populated before the indexer
// catches up. The call is idempotent — if the indexer's already mirrored
// the row, this is a no-op.
router.post("/:id/record-create", requireWallet, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const {
      template_slug,
      kit_slug,
      inputs_json,
      inputs_hash,
      escrow_yocto,
      platform_fee_bps,
      tx_create,
    } = req.body || {};
    if (!inputs_hash) return res.status(400).json({ error: "inputs_hash required" });
    if (!escrow_yocto) return res.status(400).json({ error: "escrow_yocto required" });

    const row = await missionEngine.recordCreated({
      on_chain_id: id,
      template_slug,
      poster_wallet: req.wallet,
      kit_slug,
      inputs_json: inputs_json || {},
      inputs_hash,
      escrow_yocto,
      platform_fee_bps,
      tx_create,
    });
    res.json({ ok: true, mission: row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Append an audit step. Open to the wallet that's the poster OR the
// claimant on the mission — anyone else is rejected.
router.post("/:id/audit", requireWallet, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const mission = await missionEngine.getMission(id);
    if (!mission) return res.status(404).json({ error: "Mission not found" });
    const wallet = String(req.wallet).toLowerCase();
    const allowed = [
      mission.poster_wallet,
      mission.claimant_wallet,
    ].filter(Boolean).map(w => w.toLowerCase());
    if (!allowed.includes(wallet)) {
      return res.status(403).json({ error: "Only poster or claimant may append audit steps" });
    }
    const { skill_id, role, action_type, payload, agent_wallet } = req.body || {};
    if (!action_type) return res.status(400).json({ error: "action_type required" });
    const step = await missionEngine.appendAuditStep({
      mission_on_chain_id: id,
      skill_id: skill_id ?? null,
      role: role ?? null,
      action_type,
      payload: payload ?? {},
      agent_wallet: agent_wallet ?? wallet,
    });
    res.json({ ok: true, step });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Run a sequential crew against a mission. Open to the wallet that's
// the poster OR the claimant. Each step is gated through authEngine;
// require_approval verdicts dispatch to TG via tgEscalation.dispatch
// and freeze the run mid-stream. Returns the run summary so the caller
// can poll for resume once an escalation resolves.
//
// Factored out as a named handler so it's unit-testable against
// mocked deps without spinning up Express.
async function runCrewHandler(req, res, deps = {}) {
  const me = deps.missionEngine    || missionEngine;
  const co = deps.crewOrchestrator || crewOrchestrator;
  const tg = deps.tgEscalation     || tgEscalation;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const mission = await me.getMission(id);
    if (!mission) return res.status(404).json({ error: "Mission not found" });
    const wallet = String(req.wallet || "").toLowerCase();
    const allowed = [mission.poster_wallet, mission.claimant_wallet]
      .filter(Boolean)
      .map((w) => w.toLowerCase());
    if (!allowed.includes(wallet)) {
      return res.status(403).json({ error: "Only poster or claimant may run a crew" });
    }
    const { steps } = req.body || {};
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: "steps must be a non-empty array" });
    }
    const run = await co.runCrew({
      mission_id: id,
      steps,
      dispatchEscalation: tg.dispatch,
    });
    return res.json({ ok: true, run });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
router.post("/:id/run-crew", requireWallet, (req, res) => runCrewHandler(req, res));

// Kit-driven runtime: plan steps from agent_kits.bundled_skill_ids,
// then call crewOrchestrator. Same auth model as /run-crew (poster
// or claimant only) but the caller doesn't supply steps[].
async function runKitHandler(req, res, deps = {}) {
  const me = deps.missionEngine || missionEngine;
  const kr = deps.kitRunner     || require("../services/kitRunner");
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const mission = await me.getMission(id);
    if (!mission) return res.status(404).json({ error: "Mission not found" });
    const wallet = String(req.wallet || "").toLowerCase();
    const allowed = [mission.poster_wallet, mission.claimant_wallet]
      .filter(Boolean).map((w) => w.toLowerCase());
    if (!allowed.includes(wallet)) {
      return res.status(403).json({ error: "Only poster or claimant may run a Kit" });
    }
    const run = await kr.runKit({ mission_id: id });
    try { require("../services/telemetry").bumpFireAndForget("mission.run_kit", mission.kit_slug || ""); } catch {}
    return res.json({ ok: true, run });
  } catch (e) {
    const status =
      e.code === "MISSION_NOT_FOUND" ? 404 :
      e.code === "MISSION_NOT_KIT"   ? 400 :
      e.code === "KIT_NOT_FOUND"     ? 404 :
      400;
    return res.status(status).json({ error: e.message, code: e.code });
  }
}
router.post("/:id/run-kit", requireWallet, (req, res) => runKitHandler(req, res));
module.exports.runKitHandler = runKitHandler;

// Indexer / orchestrator pushes contract events into the off-chain
// mirror. Gated by an env shared secret since this isn't user-facing.
router.post("/:id/mirror", async (req, res) => {
  const expected = process.env.ORCHESTRATOR_SHARED_SECRET;
  const provided = req.headers["x-orchestrator-secret"];
  if (!expected || provided !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const event = { ...(req.body || {}), on_chain_id: id };
    const updated = await missionEngine.mirrorEvent(event);
    res.json({ ok: true, mission: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
module.exports.runCrewHandler = runCrewHandler;
module.exports.streamHandler  = streamHandler;
module.exports.sseFrame       = sseFrame;
