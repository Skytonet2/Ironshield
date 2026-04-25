// backend/routes/agents.route.js
//
// IronShield agent control plane — connection management for the
// hybrid skill model. We're a launchpad over OpenClaw / IronClaw /
// self-hosted agents; the on-chain register_agent + register_sub_agent
// hold canonical identity, this module manages the per-framework
// credentials + endpoints those identities point at.
//
// Mounted under /api/agents.

const router = require("express").Router();
const adapters = require("../services/agents");
const store    = require("../services/agents/connectionStore");
const automationStore   = require("../services/agents/automationStore");
const automationExecutor = require("../services/agents/automationExecutor");
const requireWallet = require("../middleware/requireWallet");

// ── GET /api/agents/frameworks
// Public list of supported frameworks for the wizard's framework picker.
router.get("/frameworks", (_req, res) => {
  res.json({ frameworks: adapters.listFrameworks() });
});

// ── POST /api/agents/validate
// Dry-run validation: hit the chosen framework with the supplied
// credentials WITHOUT persisting. Used by the wizard's "Test
// connection" button so the user gets a clear error before they
// commit.
//
// Body: { framework, external_id?, endpoint?, auth? }
router.post("/validate", requireWallet, async (req, res) => {
  const { framework, external_id, endpoint, auth } = req.body || {};
  if (!framework) return res.status(400).json({ error: "framework required" });
  let adapter;
  try { adapter = adapters.get(framework); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    const result = await adapter.validate({ external_id, endpoint, auth });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/agents/connect
// Persist a connection. Validates first, then upserts into
// agent_connections. The plaintext `auth` is encrypted at rest.
//
// Body: { owner, agent_account, framework, external_id?, endpoint?, auth? }
router.post("/connect", requireWallet, async (req, res) => {
  const wallet = req.wallet;
  const { owner, agent_account, framework, external_id, endpoint, auth, meta } = req.body || {};
  if (!owner || !agent_account || !framework) {
    return res.status(400).json({ error: "owner, agent_account, framework required" });
  }
  if (owner !== wallet) {
    return res.status(403).json({ error: "Cannot connect on behalf of another account" });
  }

  let adapter;
  try { adapter = adapters.get(framework); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const validation = await adapter.validate({ external_id, endpoint, auth });
  if (!validation.ok) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  try {
    const row = await store.upsert({
      owner, agent_account, framework,
      external_id, endpoint, auth,
      status: "active",
      meta:   { ...(meta || {}), validated: validation.info || {} },
    });
    await store.markSeen({ owner, agent_account, framework, status: "active" });
    res.json({ ok: true, connection: row, info: validation.info });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/agents/connections?owner=<near>
// All connections owned by the caller. Returns sanitised rows
// (no decrypted secrets).
router.get("/connections", async (req, res) => {
  const owner = (req.query.owner || "").trim();
  if (!owner) return res.status(400).json({ error: "owner query param required" });
  try {
    const rows = await store.listForOwner(owner);
    res.json({ connections: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/agents/connections/:agent_account
// All framework connections attached to a specific agent identity.
router.get("/connections/:agent_account", async (req, res) => {
  try {
    const rows = await store.listForAccount(req.params.agent_account);
    res.json({ connections: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/agents/sandbox
// Send a single chat turn through the appropriate adapter. This is
// what the dashboard "Test your agent" panel calls.
//
// Body: { owner, agent_account, framework, message, systemPrompt?, meta? }
router.post("/sandbox", requireWallet, async (req, res) => {
  const wallet = req.wallet;
  const { owner, agent_account, framework, message, systemPrompt, meta } = req.body || {};
  if (owner !== wallet) {
    return res.status(403).json({ error: "Cannot speak on behalf of another account" });
  }
  if (!message || !framework) {
    return res.status(400).json({ error: "framework + message required" });
  }
  let adapter;
  try { adapter = adapters.get(framework); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  let conn;
  try { conn = await store.getOne({ owner, agent_account, framework }); }
  catch (err) { return res.status(500).json({ error: err.message }); }
  if (!conn) return res.status(404).json({ error: "No connection found for this agent + framework" });

  let auth = null;
  try { auth = await store.getDecryptedAuth({ owner, agent_account, framework }); }
  catch { /* missing key shouldn't crash sandbox */ }

  try {
    const result = await adapter.sendMessage({
      external_id: conn.external_id,
      endpoint:    conn.endpoint,
      auth,
      message,
      systemPrompt,
      meta,
    });
    await store.markSeen({ owner, agent_account, framework, status: "active" });
    res.json({ ok: true, ...result });
  } catch (err) {
    await store.markSeen({ owner, agent_account, framework, status: "disconnected" })
      .catch(() => {});
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── DELETE /api/agents/connect
// Body: { owner, agent_account, framework }
router.delete("/connect", requireWallet, async (req, res) => {
  const wallet = req.wallet;
  const { owner, agent_account, framework } = req.body || {};
  if (owner !== wallet) return res.status(403).json({ error: "Forbidden" });
  if (!owner || !agent_account || !framework) {
    return res.status(400).json({ error: "owner, agent_account, framework required" });
  }
  try {
    const removed = await store.remove({ owner, agent_account, framework });
    res.json({ ok: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Automation rules
// ─────────────────────────────────────────────────────────────────────
//
// These mount under /api/agents/automations. Same wallet-auth pattern
// as /connect — the x-wallet header must equal the row's `owner`.

router.get("/automations/:agent_account", async (req, res) => {
  try {
    const rows = await automationStore.listForAccount(req.params.agent_account);
    res.json({ automations: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/automations", requireWallet, async (req, res) => {
  const wallet = req.wallet;
  const { agent_account, name, description, trigger, action, enabled } = req.body || {};
  if (!agent_account || !name || !trigger || !action) {
    return res.status(400).json({ error: "agent_account, name, trigger, action required" });
  }
  try {
    const row = await automationStore.create({
      owner: wallet, agent_account, name, description, trigger, action, enabled,
    });
    res.json({ automation: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/automations/:id", requireWallet, async (req, res) => {
  const wallet = req.wallet;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const row = await automationStore.update(id, wallet, req.body || {});
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ automation: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/automations/:id", requireWallet, async (req, res) => {
  const wallet = req.wallet;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const removed = await automationStore.remove(id, wallet);
    res.json({ ok: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual fire: useful for testing a rule from the dashboard.
router.post("/automations/:id/fire", requireWallet, async (req, res) => {
  const wallet = req.wallet;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  let rule;
  try { rule = await automationStore.findOne(id, wallet); }
  catch (err) { return res.status(500).json({ error: err.message }); }
  if (!rule) return res.status(404).json({ error: "Not found" });
  try {
    const result = await automationExecutor.run({ automation: rule, source: "manual" });
    res.json({ ok: result.status === "ok", ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// public: id-as-shared-secret — upstream services ping this URL with
// the rule id alone. Rotate by deleting + recreating the rule. No
// signed-message auth because the caller is a third-party webhook
// source that won't have a NEAR wallet.
router.post("/automations/:id/webhook", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  let rule;
  try { rule = await automationStore.findById(id); }
  catch (err) { return res.status(500).json({ error: err.message }); }
  if (!rule)              return res.status(404).json({ error: "Not found" });
  if (!rule.enabled)      return res.status(409).json({ error: "Rule disabled" });
  if (rule.trigger?.type !== "webhook") return res.status(409).json({ error: "Rule isn't webhook-triggered" });
  try {
    const result = await automationExecutor.run({ automation: rule, source: "webhook" });
    res.json({ ok: result.status === "ok", ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/automations/:id/runs", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const runs = await automationStore.listRuns(id, 25);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
