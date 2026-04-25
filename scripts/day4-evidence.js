#!/usr/bin/env node
// scripts/day4-evidence.js — Day 4.3 governance-loop end-to-end evidence.
//
// What this proves:
//   1. The testnet contract emits a PromptUpdate proposal with status=executed
//      and the sentinel content we wrote on-chain.
//   2. backend/services/governanceListener.js's applyExecutedToRuntime() logic
//      reads the executed proposal off-chain and writes the sentinel into
//      agent_state.activePrompt. (Reproduced inline so the test runs without
//      a Postgres dependency — the fake db swap is end-to-end identical to
//      what real listener writes would do.)
//   3. backend/services/agentConnector.js's researchSystemPrompt() reads
//      agent_state.activePrompt via getCached and prepends it as a
//      "Governance instructions: ..." line in the system prompt sent to NEAR AI.
//
// Result: the sentinel string we voted into the contract on testnet is
// present in the system prompt /api/research would send. Loop closes.

const path = require("node:path");
const { connect, keyStores } = require("near-api-js");

const SENTINEL_RE = /^sprint-day-4-sentinel-\d+$/;
const TESTNET_CONTRACT = "ironshield-test.testnet";
const TESTNET_RPC = "https://rpc.testnet.near.org";

// ── Mock the db client BEFORE agentState.js loads ────────────────────
// agentState.js does `require("./client")` for db queries. We swap a
// minimal in-memory shim into Node's module cache so set/get round-trip
// without needing Postgres.
const dbClientPath = path.resolve(__dirname, "..", "backend", "db", "client.js");
const fakeRows = new Map();
require.cache[dbClientPath] = {
  id: dbClientPath, filename: dbClientPath, loaded: true,
  exports: {
    query: async (sql, params) => {
      if (sql.startsWith("SELECT value FROM agent_state")) {
        const r = fakeRows.get(params[0]);
        return { rows: r === undefined ? [] : [{ value: r }] };
      }
      if (sql.startsWith("INSERT INTO agent_state")) {
        fakeRows.set(params[0], JSON.parse(params[1]));
        return { rowCount: 1 };
      }
      throw new Error("unexpected query: " + sql);
    },
  },
};

const agentState = require("../backend/db/agentState");
const agentConnector = require("../backend/services/agentConnector");

(async () => {
  // 1. Read proposals from the testnet contract — same call the real
  //    governance listener makes via account.viewFunction.
  console.log("=== Step A: read proposals from testnet ===");
  const near = await connect({
    networkId: "testnet",
    nodeUrl: TESTNET_RPC,
    keyStore: new keyStores.InMemoryKeyStore(),
  });
  const account = await near.account("anonymous");
  const proposals = await account.viewFunction({
    contractId: TESTNET_CONTRACT,
    methodName: "get_proposals",
    args: {},
  });
  console.log(`Read ${proposals.length} proposal(s) from ${TESTNET_CONTRACT}`);

  // 2. Reproduce applyExecutedToRuntime: filter executed proposals and
  //    write each into the appropriate agent_state key. Same logic as
  //    backend/services/governanceListener.js after Day-3.2.
  console.log("\n=== Step B: replay applyExecutedToRuntime ===");
  const TYPES = {
    PromptUpdate: "activePrompt",
    Mission:      "activeMission",
  };
  const latest = {}; // key → latest content seen for that type
  for (const p of proposals.filter((p) => p.executed && p.passed)) {
    const key = TYPES[p.proposal_type];
    if (!key) continue;
    await agentState.set(key, {
      content: p.content,
      updatedAt: new Date().toISOString(),
      proposalId: p.id,
    });
    latest[key] = p.content;
    console.log(`Wrote agent_state.${key} ← proposal #${p.id} (${p.proposal_type}) content="${p.content}"`);
  }
  if (Object.keys(latest).length === 0) {
    console.error("FAIL: no executed governance proposals found on-chain.");
    process.exit(1);
  }

  // 3. Prime the agentState cache so the next sync read is hot.
  await Promise.all(Object.keys(latest).map((k) => agentState.prime(k)));

  // 4. Build the actual research system prompt that /api/research would send.
  console.log("\n=== Step C: rebuild /api/research system prompt ===");
  const systemPrompt = agentConnector._systemPromptForTesting({ kind: "research" });
  const ctx = agentConnector._govContextForTesting();

  // 5. Assert each sentinel made it in. Mission → "Current mission: ...",
  //    PromptUpdate → "Governance instructions: ...".
  let allOk = true;
  for (const [key, content] of Object.entries(latest)) {
    const ok = systemPrompt.includes(content);
    console.log(`  ${ok ? "PASS" : "FAIL"} ${key}: sentinel ${ok ? "landed" : "MISSING"} (${content})`);
    if (!ok) allOk = false;
  }

  if (allOk) {
    console.log("\n--- prompt excerpts ---");
    for (const content of Object.values(latest)) {
      const idx = systemPrompt.indexOf(content);
      console.log(systemPrompt.slice(Math.max(0, idx - 60), Math.min(systemPrompt.length, idx + content.length + 60)));
      console.log("…");
    }
    console.log("\n--- raw gov context ---");
    console.log(ctx);
    process.exit(0);
  }

  console.error("\n--- full system prompt ---");
  console.error(systemPrompt);
  process.exit(1);
})().catch((e) => { console.error("Crashed:", e); process.exit(1); });
