// backend/services/orchestratorBot.js
//
// The AZUKA orchestrator bot. This is the single off-chain actor
// authorised to call the orchestrator-gated methods on ironshield.near:
//
//   • complete_task            (task outcomes)
//   • record_submission        (mission-submission grading)
//   • record_mission_complete  (mission-completion ledger + optional points)
//   • award_points             (points-only awards)
//   • set_agent_reputation     (reputation updates)
//   • submit_mission_result    (executed-mission result receipts)
//
// Until this process is running, on-chain state gated to `orchestrator_id`
// never advances: active tasks sit forever, passed Mission proposals have
// no reported results, and the activity feed stays empty.
//
// Boot behaviour:
//   • If ORCHESTRATOR_ACCOUNT / ORCHESTRATOR_KEY are missing, the bot
//     logs a warning and remains idle. The rest of the backend keeps
//     running.
//   • On startup it performs an immediate poll, then schedules itself on
//     MISSION_POLL_MS (default 300_000 = 5 min).
//
// Required env:
//   ORCHESTRATOR_ACCOUNT   e.g. orchestrator.ironshield.near
//   ORCHESTRATOR_KEY       ed25519:... (full key string)
// Optional env:
//   STAKING_CONTRACT_ID    default ironshield.near
//   NEAR_RPC_URL           default https://rpc.mainnet.near.org
//   MISSION_POLL_MS        default 300000
//   ORCHESTRATOR_SECRET    signs the attestation blob for mission results
//   IPFS_CID_OVERRIDE      skip real IPFS pinning (dev)

require("dotenv").config();

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const { connect, keyStores } = require("near-api-js");
const { getOrchestratorAccount } = require("./nearSigner");
const missionIndexer = require("./missionIndexer");

const STAKING_CONTRACT  = process.env.STAKING_CONTRACT_ID || "ironshield.near";
const NODE_URL          = process.env.NEAR_RPC_URL        || "https://rpc.mainnet.near.org";
const POLL_INTERVAL_MS  = parseInt(process.env.MISSION_POLL_MS || "300000", 10);
const STATE_FILE        = path.join(__dirname, "../../agent/orchestratorState.json");

const MAX_RESULT_CHARS       = 280; // contract cap on complete_task.result
const MAX_DESCRIPTION_CHARS  = 160; // contract cap on record_submission.description
const MAX_MISSION_NAME_CHARS = 96;  // contract cap on record_mission_complete.mission_name
const GAS                    = BigInt("30000000000000"); // 30 TGas

// ─── State ────────────────────────────────────────────────────────
// {
//   processedTasks:    Record<owner, number[]>  // task ids we already called complete_task on
//   reportedMissions:  number[]                 // proposal ids we already reported results for
// }
function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      processedTasks:   raw.processedTasks   && typeof raw.processedTasks === "object" ? raw.processedTasks : {},
      reportedMissions: Array.isArray(raw.reportedMissions) ? raw.reportedMissions : [],
    };
  } catch {
    return { processedTasks: {}, reportedMissions: [] };
  }
}
function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
function markTaskProcessed(state, owner, taskId) {
  const list = state.processedTasks[owner] || (state.processedTasks[owner] = []);
  if (!list.includes(taskId)) list.push(taskId);
  // Prevent unbounded growth — contract caps tasks at 10 per owner so we
  // only need a short tail to detect replays of recently-seen ids.
  if (list.length > 50) state.processedTasks[owner] = list.slice(-50);
}

// ─── Read-only NEAR view helper ──────────────────────────────────
async function viewContract(methodName, args = {}) {
  const near    = await connect({
    networkId: "mainnet",
    nodeUrl:   NODE_URL,
    keyStore:  new keyStores.InMemoryKeyStore(),
  });
  const account = await near.account("anonymous");
  return account.viewFunction({ contractId: STAKING_CONTRACT, methodName, args });
}

// ─── Task processor ──────────────────────────────────────────────
// For each registered agent, inspect their active tasks. For any we
// haven't recorded as processed, run the task description through the
// IronClaw agent and call complete_task with the result. Keeps things
// best-effort: any single-task failure is logged and skipped — the poll
// will retry next tick.
async function runTaskProcessor(orchestrator, state) {
  // Fetch every registered agent via the leaderboard view (clamped to
  // 200 server-side). Tasks exist on public and private agents alike —
  // `get_public_agents` would miss private ones.
  let agents;
  try {
    agents = await viewContract("get_leaderboard", { limit: 200 });
  } catch (err) {
    console.warn(`[orchestrator] get_leaderboard failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(agents) || agents.length === 0) return;

  for (const agent of agents) {
    const owner = agent.owner;
    if (!owner) continue;

    let tasks;
    try {
      tasks = await viewContract("get_agent_tasks", { owner });
    } catch (err) {
      console.warn(`[orchestrator] get_agent_tasks(${owner}) failed: ${err.message}`);
      continue;
    }
    if (!Array.isArray(tasks)) continue;

    const seen   = state.processedTasks[owner] || [];
    const active = tasks.filter((t) => t.status === "active" && !seen.includes(t.id));

    for (const task of active) {
      const outcome = await processTask(task);
      try {
        await orchestrator.functionCall({
          contractId: STAKING_CONTRACT,
          methodName: "complete_task",
          args: {
            owner,
            task_id: Number(task.id),
            success: outcome.success,
            result:  outcome.result.slice(0, MAX_RESULT_CHARS),
          },
          gas: GAS,
          attachedDeposit: 0n,
        });
        markTaskProcessed(state, owner, task.id);
        console.log(
          `[orchestrator] complete_task(${owner}, #${task.id}, success=${outcome.success}) ok`,
        );
      } catch (err) {
        console.error(
          `[orchestrator] complete_task(${owner}, #${task.id}) failed: ${err.message}`,
        );
      }
    }
  }
}

// Runs the task through whichever agent runtime is configured. Prefers
// IronClaw when IRONCLAW_AGENT_MODE=true, otherwise falls back to the
// legacy NEAR AI chat-completions path (nearAgent.js). If neither is
// usable, returns a success=false outcome so the task is closed out
// rather than stuck in limbo forever.
async function processTask(task) {
  const prompt = buildTaskPrompt(task);
  try {
    if (process.env.IRONCLAW_AGENT_MODE === "true" && process.env.IRONCLAW_GATEWAY_TOKEN) {
      const ironclaw = require("./ironclawClient");
      const { reply } = await ironclaw.chat({ content: prompt, timeoutMs: 45000 });
      const text = String(reply || "").trim();
      return { success: Boolean(text), result: text || "No reply from IronClaw" };
    }
    const nearAgent = require("../../agent/nearAgent");
    const obj = await nearAgent.dispatch(prompt);
    const text = typeof obj === "string" ? obj : JSON.stringify(obj);
    return { success: Boolean(text), result: text };
  } catch (err) {
    return { success: false, result: `Processing error: ${err.message}` };
  }
}

function buildTaskPrompt(task) {
  const missionLine = task.mission_id != null
    ? `This task is linked to on-chain mission #${task.mission_id}.`
    : "This is a free-form task (no linked mission).";
  return [
    `Task #${task.id} assigned by ${task.owner}.`,
    missionLine,
    `Description: ${task.description}`,
    "Return a single JSON object: {\"summary\": string, \"status\": \"ok\"|\"blocked\"}.",
    "Summary is shown to the user as the task result — keep it under 200 characters.",
  ].join("\n");
}

// ─── Mission executor ────────────────────────────────────────────
// Approved Mission proposals (executed + status=="executed") that have
// no on-chain result yet. We run each through the agent, hash the
// reply, and call submit_mission_result.
async function runMissionExecutor(orchestrator, state) {
  let missions;
  try {
    missions = await viewContract("get_approved_missions", {});
  } catch (err) {
    console.warn(`[orchestrator] get_approved_missions failed: ${err.message}`);
    return;
  }
  if (!Array.isArray(missions) || missions.length === 0) return;

  for (const m of missions) {
    if (state.reportedMissions.includes(m.id)) continue;
    const outcome = await processMission(m);
    const resultHash = sha256Hex(outcome.result);
    const resultCid  = process.env.IPFS_CID_OVERRIDE || `sha256:${resultHash}`;
    const attestation = buildAttestation({
      proposalId: m.id,
      resultHash,
      success: outcome.success,
    });
    try {
      await orchestrator.functionCall({
        contractId: STAKING_CONTRACT,
        methodName: "submit_mission_result",
        args: {
          proposal_id: Number(m.id),
          result_hash: resultHash,
          result_cid:  resultCid,
          attestation,
          success:     outcome.success,
          session_id:  `orchestrator-${m.id}-${Date.now()}`,
        },
        gas: GAS,
        attachedDeposit: 0n,
      });
      state.reportedMissions.push(m.id);
      console.log(`[orchestrator] submit_mission_result(#${m.id}, success=${outcome.success}) ok`);
    } catch (err) {
      console.error(`[orchestrator] submit_mission_result(#${m.id}) failed: ${err.message}`);
    }
  }
}

async function processMission(m) {
  const prompt = [
    `Mission #${m.id}: ${m.title}`,
    `Proposer: ${m.proposer}`,
    "",
    m.content,
    "",
    "Execute the mission and return a single JSON object:",
    "{\"summary\": string (<=400 chars), \"success\": boolean}.",
  ].join("\n");
  try {
    const nearAgent = require("../../agent/nearAgent");
    const obj = await nearAgent.dispatch(prompt);
    if (obj && typeof obj === "object") {
      const text    = obj.summary ? String(obj.summary) : JSON.stringify(obj);
      const success = "success" in obj ? Boolean(obj.success) : true;
      return { success, result: text };
    }
    return { success: true, result: String(obj) };
  } catch (err) {
    return { success: false, result: `Mission execution failed: ${err.message}` };
  }
}

// Placeholder attestation: HMAC(secret, "proposal_id|result_hash|success").
// Once TEE attestation is wired, replace with the raw NEAR AI
// attestation blob. On-chain we only store the string and leave
// verification to indexers — the contract does not parse it.
function buildAttestation({ proposalId, resultHash, success }) {
  const secret  = process.env.ORCHESTRATOR_SECRET || "rotate-me-before-prod";
  const payload = `${proposalId}|${resultHash}|${success ? 1 : 0}`;
  const sig     = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `hmac-sha256:${sig}`;
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

// ─── Main poll ───────────────────────────────────────────────────
async function poll() {
  // Mission indexer runs first and is read-only — it doesn't need
  // orchestrator credentials, so a missing-creds backend still keeps
  // the off-chain mirror in sync with on-chain mission state.
  try {
    await missionIndexer.pollOnce();
  } catch (err) {
    console.error(`[orchestrator] mission indexer error: ${err.message}`);
  }

  const orchestrator = getOrchestratorAccount();
  if (!orchestrator) {
    // Still poll — we want the "missing creds" warning to persist in
    // logs so the operator notices rather than the bot going silent.
    console.warn(
      "[orchestrator] ORCHESTRATOR_ACCOUNT / ORCHESTRATOR_KEY not set — skipping tick.",
    );
    return;
  }
  const state = readState();
  try {
    await runMissionExecutor(orchestrator, state);
    await runTaskProcessor(orchestrator, state);
  } catch (err) {
    console.error(`[orchestrator] poll error: ${err.message}`);
  } finally {
    writeState(state);
  }
}

function start() {
  console.log(
    `[orchestrator] Bot starting — polling ${STAKING_CONTRACT} every ${POLL_INTERVAL_MS / 1000}s`,
  );
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

module.exports = { start, poll };
