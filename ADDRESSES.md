# AZUKA / NewsCoin — Account Registry

Single source of truth for every NEAR account the system uses.
**Only addresses here. Never private keys.**

## On-chain contracts (mainnet)

| Role | Account | Init args / notes |
|---|---|---|
| Root owner | `ironshield.near` | Deploys + admins everything. |
| $IRONCLAW token | `claw.ironshield.near` | NEP-141 governance/utility token. |
| Staking | `ironshield.near` | MasterChef algorithm (pool.rs / actions.rs). |
| NewsCoin factory | `newscoin-factory.ironshield.near` | Mints `coinN.newscoin-factory.ironshield.near` sub-accounts. |
| NewsCoin registry | `newscoin-registry.ironshield.near` | Indexes coins, updates stats. |
| Rhea migrator | `rhea-migrator.ironshield.near` | Routes liquidity to Rhea at graduation. |
| Revenue wallet | `ironshield-revenue.ironshield.near` | Collects protocol fees. |
| Tips | `tips.ironshield.near` *(not deployed yet)* | Per-post tipping vault. |
| Rooms | `rooms.ironshield.near` *(not deployed yet)* | Voice room state + access gating. |
| IronClaw agent | `ironclaw-agent.ironshield.near` | Signs curve updates, kill switches, research writes. |
| Fees (legacy) | `fees.ironshield.near` | Older fee collector (prefer revenue wallet). |
| Contributors | `contributors.ironshield.near` | Payout wallet for contributors. |
| Orchestrator | `orchestrator.ironshield.near` | Scheduler / job runner. |
| Proposers | `proposers.ironshield.near` | Governance proposer bond pool. |
| Reserve | `reserve.ironshield.near` | Treasury / reserve. |
| Web4 host | `www.ironshield.near` | Holds the web4 frontend. |

## Auto-generated sub-accounts

| Pattern | Example | Keys? |
|---|---|---|
| `coin{N}.newscoin-factory.ironshield.near` | `coin0.newscoin-factory.ironshield.near` | **None** — locked contract, no full-access key. |

Every NewsCoin is its own sub-account deployed by the factory with the curve WASM.
They cannot be upgraded or drained outside the contract's own rules.

## Where each private key **should** live (never commit)

| Account | Location | Used by |
|---|---|---|
| `ironshield.near` | Meteor Wallet + `~/.near-credentials/mainnet/ironshield.near.json` | Manual admin (deploys, waivers, upgrades) |
| `newscoin-factory.ironshield.near` | `~/.near-credentials/mainnet/newscoin-factory.ironshield.near.json` | Admin calls: `admin_remove_orphan_coin`, `admin_store_curve_wasm`, fee waivers |
| `newscoin-registry.ironshield.near` | `~/.near-credentials/mainnet/newscoin-registry.ironshield.near.json` | Registry admin |
| `ironclaw-agent.near` | `backend/.env` → `AGENT_PRIVATE_KEY` (gitignored) | Running agent backend only |
| `revenue.ironshield.near` | Hardware/mobile wallet ONLY | Manual withdrawals |
| `tips.ironshield.near`, `rooms.ironshield.near` | Contract is locked; admin ops via `ironshield.near` | — |

## Environment variables (not in git)

| Where | Var | Purpose |
|---|---|---|
| `backend/.env` | `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY` | Agent signer |
| `backend/.env` | `NEAR_AI_KEY`, `NEAR_AI_ENDPOINT`, `NEAR_AI_MODEL` | AI inference |
| `backend/.env` | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Voice calls |
| Cloudflare Pages (secrets) | `NEAR_AI_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | DM assistant + voice (serverless functions) |
| Cloudflare Pages (plain) | `NEAR_AI_ENDPOINT`, `NEAR_AI_MODEL`, `LIVEKIT_URL` | Non-secret config |

## Backup checklist

- [ ] `~/.near-credentials/mainnet/*.json` backed up to an encrypted location (1Password / Bitwarden / encrypted USB).
- [ ] Seed phrase for `ironshield.near` stored offline (steel plate / safe).
- [ ] `revenue.ironshield.near` seed phrase stored **separately** from `ironshield.near`.
- [ ] `AGENT_PRIVATE_KEY` rotated at least every 90 days.
- [ ] No `.env`, no `*.json` credentials file, no `*.pem`, no `*.key` committed — verify with `git ls-files | grep -Ei 'credential|private|\.env|\.pem|\.key'`.
