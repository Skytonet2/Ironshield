// backend/services/governanceListener.js
// Polls ironshield.near for executed governance proposals
// and updates IronClaw's active prompt and mission automatically.

require("dotenv").config();
const { connect, keyStores } = require("near-api-js");
const fs   = require("fs");
const path = require("path");

const PROMPT_FILE  = path.join(__dirname, "../../agent/activePrompt.json");
const MISSION_FILE = path.join(__dirname, "../../agent/activeMission.json");
const STATE_FILE   = path.join(__dirname, "../../agent/listenerState.json");

const NEAR_CONFIG = {
  networkId: "mainnet",
  nodeUrl:   "https://rpc.mainnet.near.org",
  keyStore:  new keyStores.InMemoryKeyStore(),
};

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { lastSeenId: -1 }; } };
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const writeJson  = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

async function pollGovernance() {
  try {
    const near    = await connect(NEAR_CONFIG);
    const account = await near.account("anonymous");
    const proposals = await account.viewFunction({
      contractId: "ironshield.near",
      methodName: "get_proposals",
      args: {},
    });

    const state   = readState();
    const newExec = proposals.filter(p => p.executed && p.passed && p.id > state.lastSeenId);

    for (const p of newExec) {
      if (p.proposal_type === "PromptUpdate") {
        writeJson(PROMPT_FILE, { content: p.content, updatedAt: new Date().toISOString(), proposalId: p.id });
        console.log(`[Governance] IronClaw prompt updated by proposal #${p.id}: "${p.title}"`);
      }
      if (p.proposal_type === "Mission") {
        writeJson(MISSION_FILE, { content: p.content, updatedAt: new Date().toISOString(), proposalId: p.id });
        console.log(`[Governance] IronClaw mission updated by proposal #${p.id}: "${p.title}"`);
      }
      if (p.id > state.lastSeenId) state.lastSeenId = p.id;
    }

    writeState(state);
  } catch (err) {
    console.error("[Governance] Poll error:", err.message);
  }
}

// Run immediately then every 5 minutes
pollGovernance();
setInterval(pollGovernance, 5 * 60 * 1000);

console.log("[Governance] Listener started — polling ironshield.near every 5 minutes");
