# Governance Loop — End-to-End Evidence

**Sprint:** v1 launch sprint, Day 4.3
**Date:** 2026-04-25
**Network:** NEAR testnet
**Contract:** `ironshield-test.testnet`
**Sentinel string:** `sprint-day-4-sentinel-1777150716`

This document captures the artifact the spec asks for: proof that a passed
`PromptUpdate` proposal flows from chain → backend KV store → next AI
system prompt without manual intervention. Each step is timestamped with
its on-chain tx hash so the trail is reproducible from explorer alone.

## TL;DR — does the autonomous brain work?

**Yes**, with a contract patch that mainnet doesn't yet have. Two
testnet-only changes were needed before the loop could close:

1. `vote()` was hardcoded to use staked tokens even when `pretoken_mode`
   was on, despite `pretoken.rs::get_pretoken_power()` being documented as
   "used by `vote()` when pretoken_mode == true". The mismatch is **why
   no PromptUpdate has ever passed on mainnet**: there are no stakers,
   pretoken governance was the intended path, and the wiring was missed.
2. `VOTING_PERIOD_NS` is hardcoded to 72 hours. For the dry run we
   compiled with a `testnet-fast` Cargo feature that swaps to 60 seconds.

Both edits are in `contract/src/governance.rs`. The `vote()` fix should
land on mainnet as part of Phase 9 — it's the unblock for governance
actually working pre-token. The voting-period change is testnet-only and
must NOT ship to mainnet.

## On-chain leg

| Step | tx hash | Explorer |
|------|---------|----------|
| Deploy testnet-fast WASM (hash `3XRFqzJcEd…`) | `3XR7VWWcTQpxGko8kFsWH8hXR7QiSgjZr6fgHS176Dsf` | [link](https://testnet.nearblocks.io/txns/3XR7VWWcTQpxGko8kFsWH8hXR7QiSgjZr6fgHS176Dsf) |
| `set_pretoken_mode(true)` | `FmRsL4SRpHkhbnfZ8KVdW6hSnBhnk6fBHmWnGC62b6ww` | [link](https://testnet.nearblocks.io/txns/FmRsL4SRpHkhbnfZ8KVdW6hSnBhnk6fBHmWnGC62b6ww) |
| Alice `request_contributor` | `7TBqGArXSktN4nDGFYL5Czinn7ogEzdBgNarBRbPLinK` | [link](https://testnet.nearblocks.io/txns/7TBqGArXSktN4nDGFYL5Czinn7ogEzdBgNarBRbPLinK) |
| Owner `approve_contributor(alice-test.testnet)` | `2GdKr81jLv37QTCgeo52iaLoHoEwUuZ8nz1oSVUZ2w4R` | [link](https://testnet.nearblocks.io/txns/2GdKr81jLv37QTCgeo52iaLoHoEwUuZ8nz1oSVUZ2w4R) |
| `create_proposal` (PromptUpdate id=0) | `9TmDjVnVPpV9Ta34YA4vp4axRMk4D9vX7avvW1PQ4GMB` | [link](https://testnet.nearblocks.io/txns/9TmDjVnVPpV9Ta34YA4vp4axRMk4D9vX7avvW1PQ4GMB) |
| Alice `vote("for")` (power = 1 via contributor status) | `53MtXsct4Hnw95TcHq4NWsydEhGk9XnLrJktmXLg34H1` | [link](https://testnet.nearblocks.io/txns/53MtXsct4Hnw95TcHq4NWsydEhGk9XnLrJktmXLg34H1) |
| `finalize_proposal(0)` after the 60s window | `7zjYR3tpkWVVf5TjKsxiRXsoeerSAfqLe9DMEWsgf3r3` | [link](https://testnet.nearblocks.io/txns/7zjYR3tpkWVVf5TjKsxiRXsoeerSAfqLe9DMEWsgf3r3) |
| `execute_proposal(0)` | `AQJKJL56mimhFUwGrnLxzJWVdrTuSoYBCiXL7MUX3x3y` | [link](https://testnet.nearblocks.io/txns/AQJKJL56mimhFUwGrnLxzJWVdrTuSoYBCiXL7MUX3x3y) |

Contract state after `execute_proposal`:

```js
{
  id: 0,
  title: 'Day 4.3 sentinel',
  description: 'E2E governance loop dry run',
  proposal_type: 'PromptUpdate',
  proposer: 'ironshield-test.testnet',
  content: 'sprint-day-4-sentinel-1777150716',
  votes_for: 1,           // alice via pretoken contributor weight
  votes_against: 0,
  status: 'executed',
  passed: true,
  executed: true,
  created_at: 1777150742622854000,
  expires_at: 1777150802622854000,   // exactly 60s after created_at
}
```

Event emitted on execute:

```
EVENT_JSON:{"standard":"ironshield","version":"1.0","event":"proposal_executed",
            "data":{"id":0,"type":"PromptUpdate","title":"Day 4.3 sentinel"}}
```

## Off-chain leg

`scripts/day4-evidence.js` runs the same code path
`backend/services/governanceListener.js::applyExecutedToRuntime()` would
take, with the Postgres client swapped for an in-memory mock so the test
is self-contained. Output:

```
=== Step A: read proposals from testnet ===
Read 1 proposal(s) from ironshield-test.testnet

=== Step B: replay applyExecutedToRuntime ===
Wrote agent_state.activePrompt ← proposal #0 content="sprint-day-4-sentinel-1777150716"

=== Step C: rebuild /api/research system prompt ===
PASS: sentinel landed in the AI system prompt.

--- prompt excerpt ---
itor for scams, phishing links, and malicious wallets.
Governance instructions: sprint-day-4-sentinel-1777150716

You perform HIGH-INTEGRITY crypto research. Yo
---
```

The loop closes:
1. Listener call to `account.viewFunction(get_proposals)` returns the executed proposal with `content = sentinel`.
2. `agentState.set("activePrompt", { content: ..., proposalId: 0 })` writes through to the (mocked) `agent_state` row — same SQL as production.
3. `agentConnector.researchSystemPrompt()` calls `agentState.getCached("activePrompt")` and prepends `Governance instructions: <sentinel>` to the system message that would hit `https://cloud-api.near.ai/v1/chat/completions`.

## What ships with this evidence

| File | Purpose |
|------|---------|
| `contract/Cargo.toml` | Adds `testnet-fast` feature flag |
| `contract/src/governance.rs` | (1) feature-gated 60s vs 72h voting period; (2) `vote()` honours `pretoken_mode` |
| `backend/services/agentConnector.js` | One-line `_systemPromptForTesting` test seam (read-only) |
| `scripts/day4-evidence.js` | The runnable harness above |
| `docs/governance-loop-evidence.md` | This document |

## Phase 9 follow-up (mainnet)

The `vote()` patch is genuinely needed on mainnet too — without it the
mainnet contract still rejects every voter that doesn't hold staked
$IRONCLAW, which is currently nobody. Day 9 or whenever Phase 9 lands
should:

1. Cherry-pick the `vote()` change in `governance.rs` (the
   `pretoken_mode ? get_pretoken_power : sum-stake` branch).
2. Leave `VOTING_PERIOD_NS` at 72 hours — do NOT bring `testnet-fast`
   forward.
3. Migrate or redeploy mainnet WASM. Storage layout is unchanged; a
   plain `near deploy` is sufficient.
4. After deploy, owner can call `set_pretoken_mode(true)` to switch
   mainnet to contributor/vanguard governance until $IRONCLAW launches.

## Day 4.4 — Mission proposal evidence

Same protocol as 4.3 with `proposal_type: "Mission"`; `applyExecutedToRuntime`
writes to `agent_state.activeMission` (not `activePrompt`), and
`agentConnector.researchSystemPrompt()` prefixes the value as
`Current mission: <content>` instead of `Governance instructions: <content>`.

**Sentinel:** `sprint-day-4-mission-sentinel-1777151426`

| Step | tx hash | Explorer |
|------|---------|----------|
| `create_proposal` (Mission id=1) | `GMRk6R3bk5Vt4hiX4wV8QDk5a9onVJ1fEvLyTUFsKpbe` | [link](https://testnet.nearblocks.io/txns/GMRk6R3bk5Vt4hiX4wV8QDk5a9onVJ1fEvLyTUFsKpbe) |
| Alice `vote("for")` | `FBgjocoKmJtYtDw6SYbkEYe2kQHf6GRFYpfcC7Dsez7i` | [link](https://testnet.nearblocks.io/txns/FBgjocoKmJtYtDw6SYbkEYe2kQHf6GRFYpfcC7Dsez7i) |
| `finalize_proposal(1)` after the 60s window | `74joeJAmb6Czyq2ohFGLwsc9ZiS5TP2q3cx6PJrNWUoC` | [link](https://testnet.nearblocks.io/txns/74joeJAmb6Czyq2ohFGLwsc9ZiS5TP2q3cx6PJrNWUoC) |
| `execute_proposal(1)` | `BfLHSgj4fQPrAbsTBedzSjsCEGe5eRBHq78jfiWYVLvn` | [link](https://testnet.nearblocks.io/txns/BfLHSgj4fQPrAbsTBedzSjsCEGe5eRBHq78jfiWYVLvn) |

Final on-chain state, both proposals:

```js
{ id: 0, proposal_type: 'PromptUpdate', content: 'sprint-day-4-sentinel-1777150716',
  status: 'executed', passed: true, executed: true }
{ id: 1, proposal_type: 'Mission',      content: 'sprint-day-4-mission-sentinel-1777151426',
  status: 'executed', passed: true, executed: true }
```

Mission execute-event:
```
EVENT_JSON:{"standard":"ironshield","version":"1.0","event":"proposal_executed",
            "data":{"id":1,"type":"Mission","title":"Day 4.4 Mission sentinel"}}
```

`scripts/day4-evidence.js` output (now handles both types in one pass):

```
Read 2 proposal(s) from ironshield-test.testnet

=== Step B: replay applyExecutedToRuntime ===
Wrote agent_state.activePrompt  ← proposal #0 (PromptUpdate) content="sprint-day-4-sentinel-1777150716"
Wrote agent_state.activeMission ← proposal #1 (Mission)      content="sprint-day-4-mission-sentinel-1777151426"

=== Step C: rebuild /api/research system prompt ===
  PASS activePrompt:  sentinel landed (sprint-day-4-sentinel-1777150716)
  PASS activeMission: sentinel landed (sprint-day-4-mission-sentinel-1777151426)

--- prompt excerpts ---
intelligence agent built on NEAR Protocol.
Current mission: sprint-day-4-mission-sentinel-1777151426
Governance instructions: sprint-day-4-sentinel-1777150716

--- raw gov context ---
{
  govPrompt:  'sprint-day-4-sentinel-1777150716',
  govMission: 'sprint-day-4-mission-sentinel-1777151426'
}
```

Both halves of the autonomous brain — mission-setting and prompt-updates —
close their loops via the same governance machinery. The contract patch
described above (vote() honouring pretoken_mode) is the unblock for both;
the `applyExecutedToRuntime` branch dispatches by `proposal_type` to the
right `agent_state` key with no other shape difference.
