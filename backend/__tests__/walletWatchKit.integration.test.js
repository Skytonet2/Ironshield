// backend/__tests__/walletWatchKit.integration.test.js
//
// Phase 10 Tier 3 — Wallet Watch Kit end-to-end integration.
//
// Walks the cron poller's `runOnceForDeployment` through a faked
// drain. The skills run for real; mission engine, auth engine,
// skill-manifest store, and TG dispatch are stubbed in memory so the
// test doesn't need Postgres or NEAR RPC.
//
// What's covered:
//   • Cron's pre-check on the no-drain tick produces no audit rows
//   • On a drain tick, a 4-step crew runs in scout → verifier →
//     reporter → outreach order
//   • Audit log accumulates 4 entries with a coherent hash chain
//     (each prev_hash matches the previous payload_hash)
//   • The outreach step's payload.recipient_count = 1 keeps the
//     auth-engine verdict on auto, so the TG dispatcher fires
//     directly and no escalation row is written
//   • alert_owner's `_notify` injection records the dispatch
//   • run.status === 'completed', run.audit_root === last hash

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const crypto = require("node:crypto");

// Stub db client before requiring anything that pulls it in.
const clientPath = path.resolve(__dirname, "..", "db", "client.js");
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    pool: { connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }) },
    close: async () => {},
  },
};

const skills           = require("../services/skills");
const crewOrchestrator = require("../services/crewOrchestrator");
const poller           = require("../jobs/walletWatchPoller.job");

// ─── Deterministic helpers ───────────────────────────────────────────

function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
function hashPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

// ─── In-memory fakes ─────────────────────────────────────────────────

function makeMissionEngine() {
  const missions = new Map();
  const audit    = []; // ordered list of entries across all missions
  return {
    missions, audit,
    hashPayload,
    async recordCreated(args) {
      missions.set(Number(args.on_chain_id), {
        on_chain_id:    args.on_chain_id,
        poster_wallet:  args.poster_wallet,
        claimant_wallet: null,
        kit_slug:       args.kit_slug,
        status:         "open",
      });
      return missions.get(Number(args.on_chain_id));
    },
    async getMission(id) {
      return missions.get(Number(id)) || null;
    },
    async appendAuditStep({ mission_on_chain_id, skill_id, role, action_type, payload, agent_wallet }) {
      const prev = audit.filter((a) => a.mission_on_chain_id === mission_on_chain_id).pop();
      const next_step_seq = prev ? prev.step_seq + 1 : 1;
      const payload_hash = hashPayload(payload || {});
      const entry = {
        id: audit.length + 1,
        mission_on_chain_id,
        step_seq: next_step_seq,
        skill_id, role, action_type,
        payload_hash,
        prev_hash: prev ? prev.payload_hash : null,
        agent_wallet,
        created_at: new Date().toISOString(),
      };
      audit.push(entry);
      return entry;
    },
  };
}

function makeAuthEngine({ verdicts = {} } = {}) {
  const calls = [];
  return {
    POLICY_AUTO: "auto",
    POLICY_NOTIFY: "notify",
    POLICY_REQUIRE_APPROVAL: "require_approval",
    calls,
    async check({ action, ctx }) {
      calls.push({ action, ctx });
      // Default: auto. Override per action_type via `verdicts`.
      const v = verdicts[action.action_type] || { policy: "auto" };
      return v;
    },
  };
}

function makeSkillManifests({ scoutId, verifierId, reporterId, outreachId }) {
  // Map skill_id → fake active manifest with role + runtime_category.
  const byId = new Map([
    [scoutId,    { skill_id: scoutId,    category: "scout",    tool_manifest: [{ runtime_category: "builtin:watch_balance"  }] }],
    [verifierId, { skill_id: verifierId, category: "verifier", tool_manifest: [{ runtime_category: "builtin:detect_drain"   }] }],
    [reporterId, { skill_id: reporterId, category: "reporter", tool_manifest: [{ runtime_category: "builtin:classify_alert" }] }],
    [outreachId, { skill_id: outreachId, category: "outreach", tool_manifest: [{ runtime_category: "builtin:alert_owner"    }] }],
  ]);
  return {
    async getActiveManifest(id) { return byId.get(Number(id)) || null; },
  };
}

function makeFakeProvider({ balanceYocto }) {
  // near-api-js JsonRpcProvider replacement. Returns a fixed balance
  // every time view_account is called. We swap balances between calls
  // by mutating the closure from the test.
  const ref = { balance: balanceYocto };
  return {
    setBalance(b) { ref.balance = b; },
    async query({ request_type }) {
      if (request_type !== "view_account") {
        throw new Error(`fake provider: unexpected request_type ${request_type}`);
      }
      return { amount: ref.balance };
    },
  };
}

function buildSkills({ provider, notify }) {
  // We wrap the real registry but inject _provider / _notify into the
  // appropriate skill calls by intercepting runByCategory.
  return {
    async runByCategory({ category, ctx }) {
      const c = skills.classifyCategory(category);
      if (!c || c.kind !== "builtin") throw new Error(`unrunnable: ${category}`);
      const mod = skills.get(c.key);
      if (!mod) throw new Error(`missing module: ${c.key}`);
      const params = { ...(ctx?.params || {}) };
      if (c.key === "watch_balance") params._provider = provider;
      if (c.key === "alert_owner")   params._notify   = notify;
      return mod.execute({ ...ctx, params });
    },
  };
}

// ─── The test ─────────────────────────────────────────────────────────

const ONE_NEAR_YOCTO   = "1000000000000000000000000";
const FIVE_NEAR_YOCTO  = "5000000000000000000000000";
const TWO_NEAR_YOCTO   = "2000000000000000000000000";

test("Wallet Watch Kit: drain detection drives a complete 4-step crew", async () => {
  const provider = makeFakeProvider({ balanceYocto: FIVE_NEAR_YOCTO });
  const notifyCalls = [];
  const fakeNotify = async (wallet, settingKey, text /* , opts */) => {
    notifyCalls.push({ wallet, settingKey, text });
    return 1; // one TG link, one send
  };

  const me = makeMissionEngine();
  const ae = makeAuthEngine();
  const sm = makeSkillManifests({ scoutId: 100, verifierId: 101, reporterId: 102, outreachId: 103 });
  const sk = buildSkills({ provider, notify: fakeNotify });

  const fakeTgEscalation = { dispatch: async () => true }; // never called on auto

  const deployment = {
    id: 1,
    kit_slug: "wallet-watch-kit",
    agent_owner_wallet: "alice.testnet",
    preset_config_json: {
      address:               "watched.testnet",
      alert_threshold_yocto: ONE_NEAR_YOCTO,
      poll_interval_seconds: 30,
      known_destinations:    [],
    },
  };
  const kitCtx = {
    scout_skill_id: 100, verifier_skill_id: 101,
    reporter_skill_id: 102, outreach_skill_id: 103,
  };

  // First poll: no prev_balance, no drain. Just records the balance.
  const r1 = await poller.runOnceForDeployment(deployment, kitCtx, {
    skills: sk,
    missionEngine: me,
    crewOrchestrator,
    tgEscalation: fakeTgEscalation,
    crewDeps: { missionEngine: me, authEngine: ae, skills: sk, skillManifests: sm },
  });
  assert.equal(r1.status, "first_poll");
  assert.equal(me.audit.length, 0, "first poll must not write audit rows");

  // Now simulate a drain: balance drops from 5 NEAR to 2 NEAR.
  provider.setBalance(TWO_NEAR_YOCTO);

  const r2 = await poller.runOnceForDeployment(deployment, kitCtx, {
    skills: sk,
    missionEngine: me,
    crewOrchestrator,
    tgEscalation: fakeTgEscalation,
    crewDeps: { missionEngine: me, authEngine: ae, skills: sk, skillManifests: sm },
  });

  assert.equal(r2.status, "drain_dispatched");
  assert.equal(r2.crew_status, "completed", "crew should run to completion (auto verdict)");
  assert.ok(r2.mission_id < 0, "mission id should be synthetic (negative)");

  // 4 audit rows in scout → verifier → reporter → outreach order.
  const rows = me.audit;
  assert.equal(rows.length, 4, "must produce 4 audit rows");
  assert.deepEqual(rows.map((r) => r.role), ["scout", "verifier", "reporter", "outreach"]);

  // Hash chain intact.
  assert.equal(rows[0].prev_hash, null, "first row has no predecessor");
  for (let i = 1; i < rows.length; i += 1) {
    assert.equal(rows[i].prev_hash, rows[i - 1].payload_hash,
      `row ${i} prev_hash should match row ${i - 1} payload_hash`);
  }
  assert.equal(r2.audit_root, rows[3].payload_hash, "audit_root is the final hash");

  // Auth engine was consulted exactly once per role (4 calls).
  assert.equal(ae.calls.length, 4);
  // Outreach step carried recipient_count=1 so the threshold rule never triggered.
  const outreachCall = ae.calls.find((c) => c.action.action_type === "send_message");
  assert.ok(outreachCall, "auth engine should have seen a send_message call");
  assert.equal(outreachCall.action.recipient_count, 1);

  // TG dispatch happened once.
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].wallet, "alice.testnet");
  assert.match(notifyCalls[0].text, /drain/i, "alert text mentions drain");
});

test("Wallet Watch Kit: a non-drain tick produces no mission and no audit rows", async () => {
  const provider = makeFakeProvider({ balanceYocto: FIVE_NEAR_YOCTO });
  const notifyCalls = [];
  const fakeNotify = async () => { notifyCalls.push(true); return 1; };

  const me = makeMissionEngine();
  const ae = makeAuthEngine();
  const sm = makeSkillManifests({ scoutId: 100, verifierId: 101, reporterId: 102, outreachId: 103 });
  const sk = buildSkills({ provider, notify: fakeNotify });
  const fakeTgEscalation = { dispatch: async () => true };

  const deployment = {
    id: 2,
    kit_slug: "wallet-watch-kit",
    agent_owner_wallet: "bob.testnet",
    preset_config_json: {
      address: "stable.testnet",
      alert_threshold_yocto: ONE_NEAR_YOCTO,
      poll_interval_seconds: 30,
    },
  };
  const kitCtx = {
    scout_skill_id: 100, verifier_skill_id: 101,
    reporter_skill_id: 102, outreach_skill_id: 103,
  };

  // First poll seeds the cache.
  await poller.runOnceForDeployment(deployment, kitCtx, {
    skills: sk, missionEngine: me, crewOrchestrator, tgEscalation: fakeTgEscalation,
    crewDeps: { missionEngine: me, authEngine: ae, skills: sk, skillManifests: sm },
  });

  // Balance unchanged — no drain.
  const r = await poller.runOnceForDeployment(deployment, kitCtx, {
    skills: sk, missionEngine: me, crewOrchestrator, tgEscalation: fakeTgEscalation,
    crewDeps: { missionEngine: me, authEngine: ae, skills: sk, skillManifests: sm },
  });
  assert.equal(r.status, "no_drain");
  assert.equal(me.audit.length, 0);
  assert.equal(notifyCalls.length, 0);
});

test("Wallet Watch Kit: drain detection is suppressed when outflow is below threshold", async () => {
  const provider = makeFakeProvider({ balanceYocto: FIVE_NEAR_YOCTO });
  const me = makeMissionEngine();
  const ae = makeAuthEngine();
  const sm = makeSkillManifests({ scoutId: 100, verifierId: 101, reporterId: 102, outreachId: 103 });
  const sk = buildSkills({ provider, notify: async () => 1 });
  const fakeTgEscalation = { dispatch: async () => true };

  const deployment = {
    id: 3,
    kit_slug: "wallet-watch-kit",
    agent_owner_wallet: "carol.testnet",
    preset_config_json: {
      address: "small.testnet",
      // Threshold of 100 NEAR — a 0.5 NEAR outflow should not trip,
      // and the percentage drop is below 20%.
      alert_threshold_yocto: "100000000000000000000000000",
      poll_interval_seconds: 30,
    },
  };
  const kitCtx = {
    scout_skill_id: 100, verifier_skill_id: 101,
    reporter_skill_id: 102, outreach_skill_id: 103,
  };

  // Seed prev_balance.
  await poller.runOnceForDeployment(deployment, kitCtx, {
    skills: sk, missionEngine: me, crewOrchestrator, tgEscalation: fakeTgEscalation,
    crewDeps: { missionEngine: me, authEngine: ae, skills: sk, skillManifests: sm },
  });

  // Drop by 0.5 NEAR (10 % of balance — both heuristics should pass).
  provider.setBalance("4500000000000000000000000");
  const r = await poller.runOnceForDeployment(deployment, kitCtx, {
    skills: sk, missionEngine: me, crewOrchestrator, tgEscalation: fakeTgEscalation,
    crewDeps: { missionEngine: me, authEngine: ae, skills: sk, skillManifests: sm },
  });
  assert.equal(r.status, "no_drain", "0.5 NEAR drop below threshold and below 20% should not trip");
  assert.equal(me.audit.length, 0);
});
