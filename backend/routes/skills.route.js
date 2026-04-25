// backend/routes/skills.route.js
//
// Skill execution registry surface. The on-chain skill marketplace
// owns metadata + installs (Phase 7); this route surfaces the
// **runnable** subset — first-party modules the orchestrator can
// actually execute on behalf of the user's agent.
//
// Mounted under /api/skills. The on-chain id ↔ registry key binding
// is documented at services/skills/index.js: skills with
// SkillMetadata.category = "builtin:<key>" run the matching module.

const router = require("express").Router();
const adapters = require("../services/agents");
const connectionStore = require("../services/agents/connectionStore");
const skills = require("../services/skills");

function requireWallet(req, res) {
  const wallet = (req.get("x-wallet") || "").trim();
  if (!wallet) { res.status(401).json({ error: "x-wallet header required" }); return null; }
  return wallet;
}

/** GET /api/skills/registry
 *  Public list of every executable built-in skill + its expected
 *  params. Used by the wizard / automation modal so users can pick a
 *  built-in without guessing the registry key.
 */
router.get("/registry", (_req, res) => {
  res.json({ skills: skills.listManifests() });
});

/** POST /api/skills/run
 *  One-shot execution. Used by the dashboard "Run skill" button.
 *  Body: { agent_account, skill_key, params? }
 *
 *  The same code path is exercised by automationExecutor.callSkill
 *  when a rule's action is `call_skill` — they share the registry,
 *  so a manual run mirrors what a scheduled rule would do.
 */
router.post("/run", async (req, res) => {
  const wallet = requireWallet(req, res); if (!wallet) return;
  const { agent_account, skill_key, params } = req.body || {};
  if (!agent_account || !skill_key) {
    return res.status(400).json({ error: "agent_account and skill_key required" });
  }
  if (!skills.get(skill_key)) {
    return res.status(404).json({ error: `Unknown built-in skill: ${skill_key}` });
  }

  // Resolve the user's framework connection so the skill can call
  // their agent for LLM judgement.
  let conn;
  try {
    const list = await connectionStore.listForOwner(wallet);
    conn = list.find(c => c.agent_account === agent_account && c.status !== "disconnected");
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!conn) return res.status(404).json({ error: "No active framework connection on this agent" });

  const adapter = adapters.get(conn.framework);
  let auth = null;
  try { auth = await connectionStore.getDecryptedAuth({ owner: wallet, agent_account, framework: conn.framework }); }
  catch { /* treat missing auth as anonymous; adapter will reject if needed */ }

  const agentFn = ({ message, systemPrompt, meta } = {}) =>
    adapter.sendMessage({
      external_id: conn.external_id,
      endpoint:    conn.endpoint,
      auth,
      message,
      systemPrompt,
      meta,
    });

  try {
    const result = await skills.run({
      id:  skill_key,
      ctx: {
        owner:         wallet,
        agent_account,
        params:        params || {},
        agent:         agentFn,
      },
    });
    res.json({ ok: true, skill_key, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
