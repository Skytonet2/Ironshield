// backend/services/governanceListener.js
// IronClaw governance brain. Three responsibilities, all driven by polling
// ironshield.near every 5 minutes:
//
//   1. Vote aggregator: when a proposal's voting window has expired but it's
//      still status="active", call finalize_proposal. When it ends up
//      status="passed", call execute_proposal. Both calls require an agent
//      NEAR account configured via AGENT_ACCOUNT_ID + AGENT_PRIVATE_KEY.
//
//   2. Telegram pusher: announce each lifecycle transition (created /
//      finalized / executed) into TELEGRAM_GOVERNANCE_CHAT_ID. No-op if not
//      configured.
//
//   3. IronClaw runtime updater: when a Mission / PromptUpdate proposal hits
//      executed=true, write its content into agent/activeMission.json /
//      agent/activePrompt.json so nearAgent.js picks it up on next call.
//
// All three pieces fail soft. If signing creds are missing, the aggregator
// is skipped but the pusher and runtime updater still run. If Telegram creds
// are missing, the pusher is skipped but the aggregator still runs. The
// listener should never crash on a network blip.

require("dotenv").config();
const { connect, keyStores, providers } = require("near-api-js");
const fs   = require("fs");
const path = require("path");

const { getAgentAccount }                                        = require("./nearSigner");
const { pushProposalCreated, pushProposalFinalized, pushProposalExecuted } = require("./governancePusher");

const PROMPT_FILE  = path.join(__dirname, "../../agent/activePrompt.json");
const MISSION_FILE = path.join(__dirname, "../../agent/activeMission.json");
const STATE_FILE   = path.join(__dirname, "../../agent/listenerState.json");

const STAKING_CONTRACT = process.env.STAKING_CONTRACT_ID || "ironshield.near";
const POLL_INTERVAL_MS = parseInt(process.env.GOV_POLL_INTERVAL_MS || "300000", 10); // 5 min default
const NODE_URL         = process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";

const NEAR_CONFIG = {
  networkId: "mainnet",
  nodeUrl:   NODE_URL,
  keyStore:  new keyStores.InMemoryKeyStore(),
};

// State shape:
// {
//   lastSeenId:    -1,         // highest executed proposal we've applied to disk
//   announcedIds:  { created: [], finalized: [], executed: [] }
// }
function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      lastSeenId:   raw.lastSeenId   ?? -1,
      announcedIds: {
        created:   Array.isArray(raw.announcedIds?.created)   ? raw.announcedIds.created   : [],
        finalized: Array.isArray(raw.announcedIds?.finalized) ? raw.announcedIds.finalized : [],
        executed:  Array.isArray(raw.announcedIds?.executed)  ? raw.announcedIds.executed  : [],
      },
    };
  } catch {
    return { lastSeenId: -1, announcedIds: { created: [], finalized: [], executed: [] } };
  }
}
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const writeJson  = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const has = (arr, id) => arr.includes(id);
const remember = (arr, id) => { if (!has(arr, id)) arr.push(id); };

async function fetchProposals() {
  const near    = await connect(NEAR_CONFIG);
  const account = await near.account("anonymous");
  return account.viewFunction({
    contractId: STAKING_CONTRACT,
    methodName: "get_proposals",
    args: {},
  });
}

// ── Vote aggregator ─────────────────────────────────────────────
async function tryAggregate(proposals) {
  const agent = getAgentAccount();
  if (!agent) return; // no creds → skip silently after first warning

  const nowNs = BigInt(Date.now()) * 1_000_000n;

  for (const p of proposals) {
    try {
      // Stage 1: finalize expired-but-still-active proposals.
      if (p.status === "active" && BigInt(p.expires_at) < nowNs) {
        console.log(`[aggregator] Finalizing proposal #${p.id} "${p.title}"`);
        await agent.functionCall({
          contractId: STAKING_CONTRACT,
          methodName: "finalize_proposal",
          args:       { proposal_id: p.id },
          gas:        BigInt("30000000000000"),
          attachedDeposit: 0n,
        });
      }
      // Stage 2: execute passed-but-not-executed proposals.
      // (We re-fetch on the next poll to pick up the updated status, so this
      // branch only fires when status was already "passed" before this poll.)
      else if (p.status === "passed" && !p.executed) {
        console.log(`[aggregator] Executing proposal #${p.id} "${p.title}"`);
        await agent.functionCall({
          contractId: STAKING_CONTRACT,
          methodName: "execute_proposal",
          args:       { proposal_id: p.id },
          gas:        BigInt("30000000000000"),
          attachedDeposit: 0n,
        });
      }
    } catch (err) {
      console.error(`[aggregator] proposal #${p.id} failed: ${err.message}`);
    }
  }
}

// ── Telegram pusher ─────────────────────────────────────────────
async function tryAnnounce(proposals, state) {
  for (const p of proposals) {
    if (p.status === "active" && !has(state.announcedIds.created, p.id)) {
      try { await pushProposalCreated(p); } catch (e) { console.error("[pusher] created:", e.message); }
      remember(state.announcedIds.created, p.id);
    }
    if ((p.status === "passed" || p.status === "rejected" || p.status === "executed")
        && !has(state.announcedIds.finalized, p.id)) {
      try { await pushProposalFinalized(p); } catch (e) { console.error("[pusher] finalized:", e.message); }
      remember(state.announcedIds.finalized, p.id);
    }
    if (p.executed && !has(state.announcedIds.executed, p.id)) {
      try { await pushProposalExecuted(p); } catch (e) { console.error("[pusher] executed:", e.message); }
      remember(state.announcedIds.executed, p.id);
    }
  }
}

// ── IronClaw runtime updater ────────────────────────────────────
function applyExecutedToRuntime(proposals, state) {
  const newExec = proposals.filter(p => p.executed && p.passed && p.id > state.lastSeenId);
  for (const p of newExec) {
    if (p.proposal_type === "PromptUpdate") {
      writeJson(PROMPT_FILE, { content: p.content, updatedAt: new Date().toISOString(), proposalId: p.id });
      // This prompt is injected into every call agentConnector.js makes
      // to our IronShield agent running on IronClaw (NEAR's hosted
      // agent runtime). We do NOT mutate IronClaw's own config — we
      // prepend governance-approved guidance at the application layer.
      console.log(`[governance] IronShield agent prompt updated by proposal #${p.id}: "${p.title}" (will ship on next IronClaw call)`);
    }
    if (p.proposal_type === "Mission") {
      writeJson(MISSION_FILE, { content: p.content, updatedAt: new Date().toISOString(), proposalId: p.id });
      console.log(`[governance] IronShield agent mission updated by proposal #${p.id}: "${p.title}" (will ship on next IronClaw call)`);
    }
    if (p.id > state.lastSeenId) state.lastSeenId = p.id;
  }
}

// ── Main poll ───────────────────────────────────────────────────
async function pollGovernance() {
  try {
    const proposals = await fetchProposals();
    if (!Array.isArray(proposals)) {
      console.warn("[Governance] get_proposals returned non-array; contract may not be deployed");
      return;
    }

    const state = readState();

    await tryAggregate(proposals);
    await tryAnnounce(proposals, state);
    applyExecutedToRuntime(proposals, state);

    writeState(state);
  } catch (err) {
    console.error("[Governance] Poll error:", err.message);
  }
}

pollGovernance();
setInterval(pollGovernance, POLL_INTERVAL_MS);

console.log(`[Governance] Listener started — polling ${STAKING_CONTRACT} every ${POLL_INTERVAL_MS / 1000}s`);
