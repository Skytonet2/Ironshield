# Wallet Watch Kit — end-to-end demo walkthrough

Phase 10 Tier 3 of the Agent Economy. Ships the first Kit, the first
Mission Template, and a cron-driven loop that turns "drain on a NEAR
account" into a Telegram approval prompt.

---

## What lands in this PR

- Four built-in skills under [backend/services/skills/](../backend/services/skills/):
  - [watch_balance.js](../backend/services/skills/watch_balance.js) — Scout role: reads NEAR balance via JsonRpcProvider, reports delta vs. previous reading.
  - [detect_drain.js](../backend/services/skills/detect_drain.js) — Verifier role: pure heuristic over absolute outflow, percentage drop, and unfamiliar destinations.
  - [classify_alert.js](../backend/services/skills/classify_alert.js) — Reporter role: formats verdict + balance into headline + summary.
  - [alert_owner.js](../backend/services/skills/alert_owner.js) — Outreach role: dispatches the alert to the wallet owner over Telegram.
- Four manifest JSON files under [manifests/wallet-watch-kit/](../manifests/wallet-watch-kit/), each binding a role tag and a `runtime_category` to its built-in.
- Off-chain seed job [backend/jobs/seedWalletWatchKit.job.js](../backend/jobs/seedWalletWatchKit.job.js): resolves on-chain skill IDs, upserts manifests, agent_kits row, mission_templates row, computes deterministic kit `manifest_hash`.
- On-chain register script [scripts/register-wallet-watch-kit.js](../scripts/register-wallet-watch-kit.js): reads the agent_kits row and calls `register_kit` (or `update_kit_manifest` with `--update-hash-only`) on the Phase 10 contract.
- Cron poller [backend/jobs/walletWatchPoller.job.js](../backend/jobs/walletWatchPoller.job.js): boots from `server.js`, ticks every 30 s, drives drain detection + crew runs.
- Integration test [backend/__tests__/walletWatchKit.integration.test.js](../backend/__tests__/walletWatchKit.integration.test.js): walks the full poller → orchestrator → 4 skills loop with mocked RPC + TG. **3/3 pass; backend suite 155/155 green.**

---

## How the loop works

```
                                                                     ┌─────────────────────────┐
                                                                     │  POSTGRES               │
┌─────────────────┐    1. /onboard interview                         │  agent_kits             │
│   USER          │─────────────────────────────────────────────────▶│   slug=wallet-watch-kit │
└─────────────────┘                                                  │  mission_templates      │
        │                                                            │   slug=watch-wallet     │
        │  2. tap "deploy"                                            │  kit_deployments        │
        ▼                                                            │   preset_config_json    │
┌─────────────────────────────┐                                      └──────────┬──────────────┘
│  /agents/deploy/             │                                                 │
│       wallet-watch-kit       │  insert kit_deployments row                     │
│  (Tier 2 wizard, already on  │────────────────────────────────────────────────▶│
│   main)                      │                                                 │
└─────────────────────────────┘                                                  │
                                                                                 │
                                                                                 │  3. cron tick
                              ┌──────────────────────────────────────────────────┘
                              ▼
                    ┌──────────────────────────────────┐    watch_balance      ┌────────────┐
                    │  walletWatchPoller.job.js        │───────────────────────▶│ NEAR RPC   │
                    │   ticks every 30 s               │  ◀──── balance_yocto ─┤            │
                    │                                  │                       └────────────┘
                    │   detect_drain (in-process,      │
                    │   no DB writes)                  │
                    └──────────┬───────────────────────┘
                               │ drain detected
                               ▼
                    ┌──────────────────────────────────┐
                    │  recordCreated mission row        │  synthetic on_chain_id (negative)
                    │  inputs_hash = sha256(snapshot)   │  escrow_yocto = 0
                    └──────────┬───────────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────────┐
                    │  crewOrchestrator.runCrew         │  4 steps in order:
                    │                                   │  scout → verifier → reporter → outreach
                    │  per step:                        │
                    │   • authEngine.check              │  send_message + recipient_count=1 → auto
                    │   • skill.execute                 │
                    │   • appendAuditStep               │  hash-chained
                    └──────────┬───────────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────────┐    notifyWallet       ┌────────────┐
                    │  alert_owner                      │───────────────────────▶│ Telegram   │
                    └──────────────────────────────────┘                       └────────────┘
```

The IronGuide concierge (Tier 2) reads the user's profile, the
`/onboard` page recommends the Wallet Watch Kit because its
`vertical='security'` tag matches the security bucket and the
`default_pricing_json.tags` list includes `'global'`. Tap deploy →
[Tier 2 wizard](../src/app/agents/deploy/[kit_slug]/page.js) writes a
`kit_deployments` row. The cron poller picks it up on its next tick.

---

## Run it locally

### Prerequisites

- Postgres reachable via `DATABASE_URL`. The Phase 10 schema
  (agent_kits, mission_templates, missions, mission_audit_log,
  mission_escalations, skill_runtime_manifests) is idempotent
  `CREATE TABLE IF NOT EXISTS` in [backend/db/schema.sql](../backend/db/schema.sql);
  `npm run db:migrate` brings a fresh DB current.
- The four built-in skill modules registered on-chain (Skill rows with
  `category="builtin:watch_balance"` etc.). On a fresh contract:
  ```
  ORCHESTRATOR_ACCOUNT=… ORCHESTRATOR_KEY=… \
    node backend/jobs/seedBuiltinSkills.job.js
  ```
  This script is unchanged — adding the four new skills to
  [backend/services/skills/index.js](../backend/services/skills/index.js)
  is enough for it to register them on the next run.

### One-shot kit installer

```
node backend/jobs/seedWalletWatchKit.job.js
```

Reads the four JSON manifests, resolves `runtime_category` →
on-chain `skill_id`, upserts each manifest into
`skill_runtime_manifests` at status `'curated'` then promotes to
`'active'`. Inserts the `agent_kits` row with deterministic
`manifest_hash` and the `mission_templates` row.

### On-chain Kit registration

```
ORCHESTRATOR_ACCOUNT=… ORCHESTRATOR_KEY=… \
  node scripts/register-wallet-watch-kit.js
```

> ⚠️ **Phase 10 contract not on mainnet yet.** Per
> [project_phase10_deploy_gate.md](https://github.com/Skytonet2/Ironshield)/), the
> testnet round-trip of `migrate_v10_economy` is required first. Until
> the gate clears, point this script at a testnet contract by setting
> `STAKING_CONTRACT` and `NEAR_RPC_URL`.

### Boot the backend

```
npm run backend
```

`server.js` starts the cron poller automatically:

```
[wallet-watch] scheduled every 30s
```

### Trigger a fake drain

The cleanest path on testnet:

1. Create a fresh testnet account `watched.testnet` and fund it with
   ~5 NEAR.
2. Add a `kit_deployments` row pointing at it:
   ```sql
   INSERT INTO kit_deployments
     (kit_slug, agent_owner_wallet, preset_config_json, status)
   VALUES (
     'wallet-watch-kit',
     'alice.testnet',
     '{"address":"watched.testnet","alert_threshold_yocto":"1000000000000000000000000","poll_interval_seconds":30}'::jsonb,
     'active'
   );
   ```
3. Wait for the first cron tick — it logs `first_poll`, no audit rows.
4. Sweep ~3 NEAR out of `watched.testnet` to a fresh destination.
5. Next tick logs `drain_dispatched` with the synthetic `mission_id`.
6. The poster's linked Telegram receives the alert formatted by
   `classify_alert`. The bot's existing `/missions <id>` command shows
   the four-step audit log; the inline keyboard handles
   approve/reject (Phase 10 baseline already wired this).

### Inspect the audit chain

```
GET /api/missions/<synthetic_id>
```

Returns the mission row, the four audit log entries, and any
escalation records. Hash chain integrity:

```
audit[0].prev_hash = null
audit[i].prev_hash = audit[i-1].payload_hash   for i ≥ 1
```

`audit_root` (returned by `GET /api/missions/<id>/audit/root`) is the
last `payload_hash` — the value `submit_mission_work` would commit
on-chain in a real (non-synthetic) mission.

### Live SSE stream

```
GET /api/missions/<synthetic_id>/stream
```

The Tier 1 SSE handler emits `audit.appended` and
`escalation.created/resolved` events as the crew runs.

---

## Design notes

- **Synthetic mission IDs.** While the Phase 10 contract is undeployed,
  the poller creates off-chain-only mission rows with negative
  `on_chain_id` derived from `kit_deployments.id` and an incident
  counter. Negative space is unreachable from a real `create_mission`
  call (the contract uses unsigned `u64`), so collisions are impossible
  by construction. When the gate clears, the synthetic path is
  replaced by a real `create_mission` contract call (the DB schema
  doesn't change).
- **Pre-check + crew re-run.** The cron does a cheap watch+detect
  pre-check every tick. Only on a positive verdict does it spin up a
  mission and call `crewOrchestrator.runCrew`, which runs the four
  skills again. The duplication is intentional: the crew run produces
  the canonical audit trail tied to a mission, even if the cron's
  observation drifted in the milliseconds between pre-check and crew.
  Without the pre-check, every no-drain tick would write four
  audit rows per deployment per tick — not viable past a handful of
  watched accounts.
- **No double auth gate.** `alert_owner.execute` deliberately does
  *not* call `authEngine.check`. The crew orchestrator runs the gate
  before the skill executes; calling it again inside the skill would
  write a duplicate `mission_escalations` row whenever the verdict is
  `notify`. The skill's header comment explains.
- **Stateless skills.** Every skill takes its inputs through `params`
  and returns a pure object. Per-deployment state (last balance, last
  tick at, incident counter) lives in the cron poller's in-process
  Maps. Restarting the backend resets these — the first tick after
  boot logs `first_poll` and writes nothing, which is the correct
  behaviour for a relative detector.
- **Manifest hash is kit-scoped.** `skillManifests.computeManifestHash`
  hashes a single skill's body. `seedWalletWatchKit.computeKitHash`
  hashes the kit's body (slug + vertical + sorted skill ID set +
  preset schema + default pricing). They're disjoint hash inputs, so
  changing one doesn't ripple into the other unless the kit-level
  payload actually moved.
