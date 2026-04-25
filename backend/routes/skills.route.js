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
const httpRunner = require("../services/skills/http_runner");

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
  const { agent_account, skill_key, category, params } = req.body || {};
  if (!agent_account || (!skill_key && !category)) {
    return res.status(400).json({ error: "agent_account and (skill_key OR category) required" });
  }
  if (skill_key && !skills.get(skill_key)) {
    return res.status(404).json({ error: `Unknown built-in skill: ${skill_key}` });
  }
  if (!skill_key) {
    // category-only path — must classify to something runnable.
    const c = skills.classifyCategory(category);
    if (!c) return res.status(400).json({ error: `Unrunnable category: ${category}` });
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
    const ctx = {
      owner:         wallet,
      agent_account,
      params:        params || {},
      agent:         agentFn,
    };
    const result = skill_key
      ? await skills.run({ id: skill_key, ctx })
      : await skills.runByCategory({ category, ctx });
    res.json({ ok: true, skill_key: skill_key || null, category: category || null, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/skills/http_callback/:token
 *  Author-hosted skills POST here while their /run is in flight to
 *  ask the user's connected framework agent for an LLM hop. The token
 *  authenticates the call (HMAC-signed, short-lived) — no x-wallet
 *  required because the author's process doesn't have one.
 *
 *  Body: { kind: "agent_message", message, system?, framework? }
 *  Returns: { reply }
 */
router.post("/http_callback/:token", async (req, res) => {
  const payload = httpRunner.verifyCallbackToken(req.params.token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });

  const { kind, message, system, framework: requestedFw } = req.body || {};
  if (kind !== "agent_message") {
    return res.status(400).json({ error: "Only agent_message callbacks are supported right now" });
  }
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message required" });
  }
  if (Buffer.byteLength(message, "utf8") > 64 * 1024) {
    return res.status(413).json({ error: "message > 64KB cap" });
  }

  // Resolve the user's framework connection. Prefer `requestedFw`
  // when supplied; otherwise pick the first active connection.
  let conn;
  try {
    const list = await connectionStore.listForOwner(payload.owner);
    const filtered = list.filter(c => c.agent_account === payload.agent_account && c.status !== "disconnected");
    conn = requestedFw
      ? filtered.find(c => c.framework === requestedFw)
      : filtered[0];
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!conn) return res.status(404).json({ error: "No active framework on this agent" });

  let adapter;
  try { adapter = adapters.get(conn.framework); }
  catch (err) { return res.status(500).json({ error: err.message }); }

  let auth = null;
  try { auth = await connectionStore.getDecryptedAuth({ owner: payload.owner, agent_account: payload.agent_account, framework: conn.framework }); }
  catch { /* anonymous adapter call ok */ }

  try {
    const out = await adapter.sendMessage({
      external_id:  conn.external_id,
      endpoint:     conn.endpoint,
      auth,
      message,
      systemPrompt: system,
    });
    res.json({ reply: out?.reply || "", framework: conn.framework });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
