@AGENTS.md

# IronShield — Claude Code Handoff

## The Project Vision (READ THIS FIRST)

IronClaw is NEAR AI's open-source AI agent runtime, implemented in Rust, inspired by OpenClaw — focused on privacy and security. See: nearai/ironclaw on GitHub.

IronShield is the governance and staking protocol that controls IronClaw.

The core rule:
> "If someone wants to run IronClaw in fully autonomous mode, they must deploy it through IronShield governance — giving control to $IRONCLAW token holders who decide missions and AI prompt updates."

This means:
- No team controls IronClaw's behavior
- Token holders vote on what IronClaw does (missions, AI prompts, capability rules)
- Passed proposals automatically update IronClaw's runtime configuration
- IronClaw is the agent. IronShield is its democratic brain.

---

## What Is Built

### Frontend (Next.js 16, static export, deployed to IPFS)
- `src/app/page.js` — main router with nav: Home, Dashboard, Staking, Trade, Earn, Governance, Roadmap, Ecosystem
- `src/components/GovernancePage.jsx` — full governance UI (proposals, voting, create proposal, vote history)
- `src/components/StakingPage.jsx` — NEAR contract wired (stake/unstake/claim via near-api-js v6)
- `src/components/EarnPage.jsx` — missions and leaderboard
- `src/components/AdminPanel.jsx` — admin panel using memoryStore
- `src/hooks/useNear.js` — connects to NEAR mainnet, viewMethod + callMethod
- `src/hooks/useGovernance.js` — governance contract calls
- `src/lib/contexts.js` — wallet selector (MeteorWallet), theme system
- `src/lib/store.js` — default contest and score data

### Smart Contracts (Rust, NEAR SDK v5.1.0)
- `contract/src/` — staking contract (MasterChef algorithm, pool.rs + actions.rs)
- `contract/src/governance.rs` — governance module (proposals, voting, execution, event emission)

Contract to deploy to: `ironshield.near`
Token contract: `ironclaw.near` (NEP-141)

### IronClaw Agent Layer (Node.js, runs alongside Next.js)
- `backend/server.js` — Express API on port 3001
- `backend/routes/` — /summary /research /verify /portfolio /security
- `backend/services/agentConnector.js` — ONLY file that calls NEAR AI
- `backend/services/governanceListener.js` — polls ironshield.near for passed proposals, updates agent/activePrompt.json and agent/activeMission.json automatically
- `bot/index.js` — Telegram bot (polling mode for dev, webhook for prod)
- `agent/nearAgent.js` — NEAR AI runtime connector
- `agent/activeMission.json` — current mission set by governance vote
- `agent/activePrompt.json` — current AI system prompt set by governance vote
- `jobs/` — dailySummary, portfolioUpdate, alertTrigger cron jobs

---

## What Needs Finishing

### Priority 1 — Deploy to ironshield.near.page (live site)
```bash
npm run build
npx web4-deploy out ironshield.near
```
The Governance page is built but NOT on the live site yet. This deploy makes it live.

### Priority 2 — Fix any build errors before deploying
Run `npm run build` and fix all errors. Common issues:
- near-api-js crypto module in static export → already handled in next.config.mjs with turbopack: {}
- Any missing imports in new component files

### Priority 3 — Deploy the Rust contract
```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
near deploy --accountId ironshield.near --wasmFile target/wasm32-unknown-unknown/release/ironshield.wasm
near call ironshield.near new '{"owner_id": "ironshield.near"}' --accountId ironshield.near
```
Until this is done, StakingPage and GovernancePage show — placeholders (handled gracefully).

### Priority 4 — Wire governance event to IronClaw runtime
governanceListener.js already polls for executed proposals.
When a PromptUpdate proposal passes → writes to agent/activePrompt.json
When a Mission proposal passes → writes to agent/activeMission.json
nearAgent.js reads these files on every AI call.
This chain is the core autonomous governance loop. Verify it works end to end.

### Priority 5 — Telegram bot production setup
- Set TELEGRAM_BOT_TOKEN in .env
- For production: switch bot/index.js from polling to webhook mode
- Deploy backend + bot to Railway, Render, or VPS

---

## Key Environment Variables (.env)
```
NEXT_PUBLIC_NETWORK_ID=mainnet
TELEGRAM_BOT_TOKEN=get_from_botfather
BACKEND_PORT=3001
BACKEND_URL=http://localhost:3001
NEAR_AI_ENDPOINT=https://api.near.ai/v1/chat/completions
NEAR_AI_KEY=get_from_app.near.ai
NEAR_AI_MODEL=llama-3.1-70b-instruct
NEXT_PUBLIC_ADMIN_PW=ironshield_admin
```

---

## Deployment Commands
```bash
# Frontend (IPFS)
npm run build
npx web4-deploy out ironshield.near

# Backend + Bot (local dev)
npm run backend    # port 3001
npm run bot        # Telegram bot

# Everything at once
npm run dev:all
```

---

## Architecture Summary
```
Token holders
     │ vote on GovernancePage
     ▼
ironshield.near (NEAR contract)
     │ emits proposal_executed event
     ▼
governanceListener.js (polls every 5min)
     │ writes activePrompt.json + activeMission.json
     ▼
nearAgent.js (reads on every AI call)
     │ sends to NEAR AI with governance instructions
     ▼
IronClaw operates autonomously under community decisions
```

## Live URLs
- Frontend: https://ironshield.near.page
- Contract: ironshield.near on NEAR mainnet
- Telegram: t.me/IronClawHQ
