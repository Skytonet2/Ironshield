// backend/services/agents/automationExecutor.js
//
// Fires a single automation rule. Used by both the cron-style worker
// (schedule triggers) and the on-demand webhook + manual entry points.
// All executions go through here so logging + run-recording stays in
// one place.

const fetch = require("node-fetch");
const { providers } = require("near-api-js");
const adapters = require("./index");
const store    = require("./connectionStore");
const automationStore = require("./automationStore");
const skillRegistry = require("../skills");

const STAKING_CONTRACT = process.env.STAKING_CONTRACT || "ironshield.near";
const NEAR_RPC_URL     = process.env.NEAR_RPC_URL     || "https://rpc.mainnet.near.org";
let _nearProvider = null;
function nearProvider() {
  if (!_nearProvider) _nearProvider = new providers.JsonRpcProvider({ url: NEAR_RPC_URL });
  return _nearProvider;
}

/** Look up SkillMetadata.verified for a given skill_id by calling
 *  get_skill_metadata on the contract. Returns null on failure so
 *  callers can decide how to handle that — automationExecutor treats
 *  missing metadata as unverified (fail-safe). */
async function readSkillMetadata(skillId) {
  const args = Buffer.from(JSON.stringify({ skill_id: Number(skillId) })).toString("base64");
  const res = await nearProvider().query({
    request_type: "call_function",
    finality:     "final",
    account_id:   STAKING_CONTRACT,
    method_name:  "get_skill_metadata",
    args_base64:  args,
  });
  const text = Buffer.from(res.result).toString();
  return JSON.parse(text);
}

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
  // Built-in path stays the explicit shortcut for rules wired by the
  // automation modal. HTTP skills come in via action.category instead
  // (the dashboard fills it from the on-chain SkillMetadata when the
  // user picks an http: skill).
  const category = action.category;

  // Build the agent closure regardless of skill type — both built-in
  // and HTTP runners need the user's framework adapter wired in.
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

  const ctx = {
    owner, agent_account,
    params: action.params || {},
    agent:  agentFn,
  };

  if (key) {
    const mod = skillRegistry.get(key);
    if (!mod) throw new Error(`Unknown built-in skill: ${key}`);
    return skillRegistry.run({ id: key, ctx });
  }

  if (category) {
    // Lets HTTP skills (and any future runtime kind) flow through
    // the same dispatch we'd use from /api/skills/run.
    //
    // Verified gate: HTTP skills are author-hosted at an arbitrary
    // URL — we only execute them when the on-chain SkillMetadata
    // marks them verified by the contract owner. The skill_id on
    // the rule's action is the source of truth; if it's missing or
    // we can't read chain state, default to unverified (refuse).
    let verified = false;
    if (action.skill_id != null) {
      try {
        const meta = await readSkillMetadata(action.skill_id);
        verified = Boolean(meta?.verified);
      } catch (err) {
        console.warn(`[automation] couldn't read SkillMetadata for #${action.skill_id}:`, err.message);
      }
    }
    return skillRegistry.runByCategory({ category, ctx, verified });
  }

  return {
    skill_id: action.skill_id || null,
    note: "Skill action needs a `skill_key` (built-in) or `category` (e.g. \"http:<url>\"). Pick a runnable skill from the marketplace.",
  };
}

module.exports = { run, dispatch };
