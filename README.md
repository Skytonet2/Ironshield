# IronShield

**NEAR-native governance protocol designed for autonomous IronClaw deployments.**

Token holders vote on the deployed agent's system prompt and mission. When a proposal passes, the vote rewrites that agent's runtime config — the next AI call uses the new prompt. End-to-end on-chain governance of agent behavior, not metadata.

The governance loop is proven end-to-end on mainnet via the contract's pre-token primitive. A Phase 1 Council of named contributors takes over governance before $IRONCLAW launches; $IRONCLAW broadens participation post-TGE.

> Anyone can run IronClaw locally. To run it autonomously — making decisions, holding funds, acting for others — IronShield is the governance pattern that makes the chain of authority cryptographically verifiable.

Live on NEAR mainnet at [`ironshield.near`](https://nearblocks.io/address/ironshield.near) — Phase 8.

---

## What's live today

### Smart contracts (mainnet, Rust + NEAR SDK)

- **Staking** — MasterChef-style pool with FT callbacks
- **Governance** — proposals, voting, execution, on-chain event emission
- **Agent registry** — 50+ methods, on-chain agent ↔ framework binding (1604 lines in `agents.rs`)
- **Skill marketplace** — create, install, metadata, verification
- **Pre-token + Vanguard NFT governance** — bonus voting weight + revenue share for Vanguard holders

### Backend (Express on Render, Postgres)

- ~40 routes covering feed, agents, skills, governance, DMs, rooms, NewsCoin, trading, bridge, automations, Telegram, push, media
- 899-line schema, real DB-backed
- Real NEAR AI integration (Llama-3.1) — system prompts read from on-chain governance state on every call
- WebSocket feed hub for live updates
- Governance listener service: chain events → runtime config

### Frontend (Next.js 16 static export, Cloudflare Pages)

- 18 pages: feed, agents, skills, governance, staking, rooms, bridge, messages, NewsCoin, portfolio, treasury, automations, profile, rewards, settings, ecosystem, docs
- `@near-wallet-selector` v10 — Meteor, HERE, HOT, Intear, MyNearWallet
- Live at https://ironshield.pages.dev

### Telegram bot

- `/link`, `/portfolio`, `/alerts`, `/vote`, `/digest` commands
- https://t.me/IronClawHQ

---

## Revenue / token capture

| Stream | Mechanism |
|---|---|
| Skill marketplace | 15% of every install fee → treasury, 85% → creator. On-chain enforced. |
| Token-volume fees | 20% of NEAR token-volume fees route to treasury |
| Pay-per-report | $IRONCLAW spent on full scam / contract audits |
| IronShield Pro | Stake-lock $IRONCLAW for Pro perks (higher AI budget, badge, themes) |
| Treasury use | Funds IronClaw inference + $IRONCLAW buybacks |

---

## Why NEAR

- **The runtime is here.** IronClaw is NEAR AI's open-source agent runtime.
- **NEAR keys make every prompt change cryptographically attributable to a specific on-chain vote.** No other chain offers this primitive natively.
- **Treasury, marketplace, settlement all on-contract.** No bridges in the critical governance path.

---

## Live URLs

- **Frontend:** https://ironshield.pages.dev
- **Contract:** [`ironshield.near`](https://nearblocks.io/address/ironshield.near) (Phase 8)
- **Telegram:** https://t.me/IronClawHQ

---

## Contact

[ your email / X handle / TG handle here ]
