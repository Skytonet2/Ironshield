// backend/services/agents/automationExecutor.js
//
// Fires a single automation rule. Used by both the cron-style worker
// (schedule triggers) and the on-demand webhook + manual entry points.
// All executions go through here so logging + run-recording stays in
// one place.

const fetch = require("node-fetch");
const adapters = require("./index");
const store    = require("./connectionStore");
const automationStore = require("./automationStore");
const skillRegistry = require("../skills");

async function run({ automation, source = "manual" }) {
  const startedAt = Date.now();
  let status = "ok", output = "", error = "";
  try {
    const result = await dispatch(automation);
    output = JSON.stringify(result || {}).slice(0, 8_000);
  } catch (err) {
    status = "error";
    error  = err?.message || String(err);
  }
  await automationStore.recordRun({
    automation_id: automation.id,
    source, status, output, error,
  }).catch((dbErr) => {
    console.warn("[automation] recordRun failed:", dbErr.message);
  });
  if (automation.trigger?.type === "schedule") {
    await automationStore.rotateSchedule(automation).catch(() => {});
  }
  return { status, output, error, ms: Date.now() - startedAt };
}

async function dispatch(rule) {
  const { action } = rule;
  if (!action?.type) throw new Error("Rule missing action.type");

  switch (action.type) {
    case "ask_agent":   return askAgent(rule);
    case "webhook_out": return webhookOut(rule);
    case "call_skill":  return callSkill(rule);
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

async function askAgent(rule) {
  const { owner, agent_account, action } = rule;
  const prompt = action.prompt;
  if (!prompt) throw new Error("ask_agent action requires prompt");

  // Pick framework: explicit `action.framework` wins, otherwise the
  // first connection on this agent.
  let framework = action.framework;
  let conn;
  if (framework) {
    conn = await store.getOne({ owner, agent_account, framework });
    if (!conn) throw new Error(`No connection for ${framework}`);
  } else {
    const list = await store.listForOwner(owner);
    conn = list.find(c => c.agent_account === agent_account && c.status !== "disconnected");
    if (!conn) throw new Error("No active framework connection on this agent");
    framework = conn.framework;
  }

  const adapter = adapters.get(framework);
  const auth = await store.getDecryptedAuth({ owner, agent_account, framework });
  const out = await adapter.sendMessage({
    external_id: conn.external_id,
    endpoint:    conn.endpoint,
    auth,
    message:     prompt,
    systemPrompt: action.system,
  });
  return { framework, reply: out?.reply || "", raw: null };
}

async function webhookOut(rule) {
  const { url, method = "POST", payload, headers } = rule.action;
  if (!url) throw new Error("webhook_out action requires url");
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    timeout: 8_000,
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`Webhook returned HTTP ${r.status}: ${text.slice(0, 200)}`);
  return { status: r.status, response: text.slice(0, 1_000) };
}

async function callSkill(rule) {
  const { owner, agent_account, action } = rule;
  const key = action.skill_key || action.registry_key;
  if (!key) {
    return {
      skill_id: action.skill_id || null,
      note: "Author-supplied skills aren't runnable yet. Pick a built-in skill (action.skill_key) or wait for the sandboxed runner.",
    };
  }
  const mod = skillRegistry.get(key);
  if (!mod) throw new Error(`Unknown built-in skill: ${key}`);

  // Closure over the user's framework adapter — same path the sandbox
  // uses, so the skill's LLM hops obey whatever framework + auth the
  // user picked at agent launch.
  const list = await store.listForOwner(owner);
  const conn = list.find(c => c.agent_account === agent_account && c.status !== "disconnected");
  if (!conn) throw new Error("No active framework connection on this agent");
  const adapter = adapters.get(conn.framework);
  const auth    = await store.getDecryptedAuth({ owner, agent_account, framework: conn.framework });

  const agentFn = ({ message, systemPrompt, meta } = {}) =>
    adapter.sendMessage({
      external_id: conn.external_id,
      endpoint:    conn.endpoint,
      auth,
      message,
      systemPrompt,
      meta,
    });

  return skillRegistry.run({
    id:  key,
    ctx: {
      owner, agent_account,
      params: action.params || {},
      agent:  agentFn,
    },
  });
}

module.exports = { run, dispatch };
