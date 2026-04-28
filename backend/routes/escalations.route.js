// backend/routes/escalations.route.js
//
// Phase 10 — Agent Economy: authorization-tier escalations.
//
// Escalations are the freeze-points where the auth engine paused a
// step and asked the human owner to decide. They get resolved through
// three channels:
//   - TG inline-keyboard callback   →  /resolve (called by the bot)
//   - in-app approval UI            →  /resolve (called by the frontend)
//   - cron expiry sweep             →  /sweep   (called by the worker)
//
// The mission engine doesn't auto-resume the frozen step here — the
// orchestrator polls `GET /api/escalations?mine=1&status=resolved` for
// freshly-decided ones and handles resumption itself.

const router = require("express").Router();
const requireWallet = require("../middleware/requireWallet");
const authEngine = require("../services/authEngine");
const db = require("../db/client");

// Public listing for owners — filter by their wallet via x-wallet.
router.get("/", async (req, res) => {
  try {
    const { mission_id, status, mine, limit } = req.query;
    const clauses = [];
    const params = [];
    if (mission_id) {
      params.push(Number(mission_id));
      clauses.push(`e.mission_on_chain_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`e.status = $${params.length}`);
    }
    if (mine === "1" && req.headers["x-wallet"]) {
      params.push(String(req.headers["x-wallet"]).toLowerCase());
      clauses.push(`LOWER(m.poster_wallet) = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(Math.min(Number(limit) || 50, 200));
    const sql = `
      SELECT e.id, e.mission_on_chain_id, e.step_seq, e.action_type,
             e.payload_json, e.status, e.channel,
             e.tg_chat_id, e.tg_message_id,
             e.decided_by_wallet, e.decision_note, e.decided_at,
             e.created_at, e.expires_at,
             m.poster_wallet, m.claimant_wallet, m.kit_slug
        FROM mission_escalations e
        LEFT JOIN missions m ON m.on_chain_id = e.mission_on_chain_id
        ${where}
       ORDER BY e.created_at DESC
       LIMIT $${params.length}`;
    const { rows } = await db.query(sql, params);
    res.json({ escalations: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const escalation = await authEngine.getEscalation(id);
    if (!escalation) return res.status(404).json({ error: "Not found" });
    res.json({ escalation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resolve. Called by the TG bot (after the owner taps an inline button),
// the in-app approval UI, or by the orchestrator's expiry sweep. The
// caller authenticates via the shared orchestrator secret OR a wallet
// signature (x-wallet middleware) — escalations on a mission can only
// be resolved by the mission's poster wallet.
router.post("/:id/resolve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const { decision, note, decided_by_wallet, source } = req.body || {};
    if (!["approved", "rejected", "expired", "aborted"].includes(decision)) {
      return res.status(400).json({ error: "decision must be approved|rejected|expired|aborted" });
    }

    const expected = process.env.ORCHESTRATOR_SHARED_SECRET;
    const orchestratorAuthed = expected && req.headers["x-orchestrator-secret"] === expected;
    const walletHeader = req.headers["x-wallet"]
      ? String(req.headers["x-wallet"]).toLowerCase()
      : null;

    const existing = await authEngine.getEscalation(id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status !== "pending") {
      return res.status(409).json({ error: "Already resolved", status: existing.status });
    }

    if (!orchestratorAuthed) {
      // Wallet path — must be the mission poster.
      if (!walletHeader) return res.status(401).json({ error: "Wallet required" });
      const { rows } = await db.query(
        `SELECT poster_wallet FROM missions WHERE on_chain_id = $1`,
        [existing.mission_on_chain_id],
      );
      const poster = rows[0]?.poster_wallet?.toLowerCase();
      if (!poster || poster !== walletHeader) {
        return res.status(403).json({ error: "Only the mission poster may resolve" });
      }
    }

    const resolved = await authEngine.resolveEscalation(
      id,
      decision,
      decided_by_wallet || walletHeader || null,
      note || (source ? `via ${source}` : null),
    );
    if (!resolved) {
      return res.status(409).json({ error: "Already resolved (race)" });
    }
    res.json({ ok: true, escalation: resolved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cron-callable sweep: marks expired pending rows.
router.post("/sweep", async (_req, res) => {
  const expected = process.env.ORCHESTRATOR_SHARED_SECRET;
  if (!expected || _req.headers["x-orchestrator-secret"] !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const { rows } = await db.query(
      `UPDATE mission_escalations
          SET status = 'expired', decided_at = NOW(),
              decision_note = COALESCE(decision_note, 'auto-expired')
        WHERE status = 'pending'
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
        RETURNING id, mission_on_chain_id`,
    );
    res.json({ ok: true, expired: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
