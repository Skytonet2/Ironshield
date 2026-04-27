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
//   POST /api/missions/:id/record-create  off-chain bootstrap after create_mission
//   POST /api/missions/:id/audit          append a step to the audit log
//   POST /api/missions/:id/mirror         indexer/orchestrator pushes a state event

const router = require("express").Router();
const requireWallet = require("../middleware/requireWallet");
const missionEngine = require("../services/missionEngine");

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
