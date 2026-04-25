@AGENTS.md

# IronShield — Claude Code Handoff

## The Project Vision

IronClaw is NEAR AI's open-source AI agent runtime (Rust). IronShield is the governance + staking + marketplace protocol that controls IronClaw.

> If someone wants to run IronClaw in fully autonomous mode, they must deploy it through IronShield governance — giving control to $IRONCLAW token holders who decide missions and AI prompt updates.

- No team controls IronClaw's behavior.
- Token holders vote on missions, AI prompts, capability rules.
- Passed proposals automatically rewrite IronClaw's runtime config.
- IronClaw is the agent. IronShield is its democratic brain.

---

## Reality Check (read before doing anything)

The repo is **much larger than earlier handoffs claimed**. It is a Web2.5 social + governance + agent platform, not a tiny IPFS app. Treat the code as source of truth, not earlier docs.

### Frontend — Next.js 16.2.2, React 19, Turbopack, **`output: "export"` (static)**
- File-system routes under `src/app/*` (feed, agents, skills, governance, staking, rooms, bridge, messages, newscoin, portfolio, treasury, automations, profile, rewards, settings, ecosystem, docs, agent, my-agent).
- Chrome: `src/components/shell/AppShell.jsx`. Old single-router (`src/app/page.js` calling `<HomePage />`-style nav) is gone — orphan components remain (HomePage, DashboardPage, EarnDashboard, IronClawSections, LaunchPage) and should be deleted.
- Hooks: `src/hooks/useNear.js` (view/call), `src/hooks/useGovernance.js`, `src/hooks/useAgent.js` (register/skills).
- Wallet: `@near-wallet-selector` v10 (Meteor + HERE + HOT + Intear + MyNear) wired in `src/lib/contexts.js`.
- State: zustand stores in `src/lib/stores/*`; `src/lib/store.js` is **only seed data + in-memory `memoryStore`** for AdminPanel — not the platform's data layer.
- Static export means **no SSR / no API routes / no middleware**. All security must live in the Express backend.

### Backend — Node + Express on Render
- `backend/server.js` mounts ~40 routers. Real, not stubs: summary, research, verify, portfolio, security, chat, agents, skills, governance, feed, posts, dm, rooms, livekit, push, newscoin, tg, trading, bridge, ai, ironclaw, market, revenue, tips, media, xfeed.
- Postgres via `backend/db/client.js` (SSL pool, 10 conn). Schema: `backend/db/schema.sql` (~899 lines). Migrations run on boot. If `DATABASE_URL` is unset, mutating routes 503.
- AI calls are real: `backend/services/agentConnector.js` POSTs to `https://cloud-api.near.ai/v1/chat/completions` with `Bearer ${NEAR_AI_KEY}`. Reads `agent/activePrompt.json` + `agent/activeMission.json` on every call.
- WebSocket `/ws/feed` via `backend/ws/feedHub.js`.
- `backend/services/rateLimiter.js` exists but is **NOT wired** into `server.js`.
- Auth today: a soft `x-wallet` header — **unsigned, impersonable**. Real signed-message auth is the Day 1 task below.

### Smart contracts — Rust, NEAR SDK
- `contract/src/lib.rs` — root.
- `contract/src/pool.rs` + `actions.rs` + `ft_callbacks.rs` — staking (MasterChef).
- `contract/src/governance.rs` — proposals, voting, execution, event emission.
- `contract/src/agents.rs` — **1604 lines**, 50+ methods: `register_agent`, `register_sub_agent`, `create_skill`, `install_skill`, `set_agent_connection`, `record_submission`, `award_points`, `set_agent_permissions`, etc. **Skill purchase / fee distribution is NOT yet on-chain.**
- `contract/src/pretoken.rs` — pre-token + Vanguard governance.
- Build: **`cargo near build non-reproducible-wasm --no-abi`** (NOT bare `cargo build`). Output at `contract/target/near/`.
- **Deployed**: mainnet `ironshield.near`, currently Phase 8 (code_hash `Eg9wk…`). On-chain agent↔framework binding lives there; auth stays off-chain.

### Agent runtime
- `agent/nearAgent.js` — NEAR AI connector, reads activePrompt + activeMission on every call.
- `agent/activePrompt.json` — currently `""` (no PromptUpdate proposal has ever passed).
- `agent/activeMission.json` — default string.
- `agent/listenerState.json`, `agent/loopState.json` — committed but mutated at runtime. **Move to Postgres.**

### Governance loop (the autonomous brain)
```
Token holders → GovernancePage
        ↓
ironshield.near (proposal_executed event)
        ↓
backend/services/governanceListener.js  (polls every 5 min)
        ↓ applyExecutedToRuntime()
agent/activePrompt.json + agent/activeMission.json
        ↓
agent/nearAgent.js (reads on every AI call)
        ↓
IronClaw responds under community-set rules
```
Listener is **not** auto-started by `backend/server.js`. It runs only via `npm run governance` or the `npm run ironclaw` mega-script. On Render this means it must be a separate worker service.

### Telegram bot
- `bot/index.js` — polling mode (dev). Webhook mode for prod still TODO.
- Started via `npm run bot` or rolled into `npm run ironclaw`.

### Cron jobs
- `jobs/dailySummary.job.js` (`0 8 * * *`), `portfolioUpdate.job.js` (`*/15 * * * *`), `alertTrigger.job.js` (`*/5 * * * *`).
- These self-register on import. They run only when `npm run jobs` (or `ironclaw`) runs them. NOT auto-started by `server.js`.
- `backend/jobs/newsBot.job` IS started inline at `server.js` boot.

---

## Current Audit Findings (open)

**Critical (launch-blockers):**
1. `x-wallet` header auth on every mutating backend route — unsigned, impersonable.
2. `NEXT_PUBLIC_ADMIN_PW` is bundled to client; `AdminPanel.jsx:140` has hardcoded fallback `"ironshield_admin"`.
3. No rate limiting + bare `cors()` on AI endpoints — first attacker drains `NEAR_AI_KEY`.
4. `governanceListener` not auto-started by `server.js` — must be its own worker.
5. Earlier handoff docs were stale on deploy commands.

**High:**
- Governance loop never end-to-end exercised. `activePrompt.json` is empty.
- `listenerState.json` / `loopState.json` on ephemeral disk — duplicate Telegram pushes after restart.
- 17 TODO/mock sites across 9 backend routes (livekit ×5, newscoin ×3, dm ×2, rooms ×2, feed, xfeed, revenue, posts, tips).
- Single-container `npm run ironclaw` runs 5 Node processes — OOM under load.
- 30s polling for DMs/notifications = ~33 req/s baseline at 1k users; pool of 10 chokes.

**Medium / Low:** dead orphan components, no helmet/body limits/CSRF, file upload validation unverified, "IronShield Pro" CTA points to vaporware, dead bottom-bar chips.

Full feature completion table in the audit chat log; targets below.

---

## 21-Day Sprint Plan → see `SPRINT_PLAN.md`

The goal is **full v1**: every audit feature shipped, gracefully gated, or explicitly deferred to v1.1 with a written reason. Three release tags along the way.

Full per-task prompts in [SPRINT_PLAN.md](SPRINT_PLAN.md). Summary inline.

### Release train

| Tag | Day | Scope |
|-----|-----|-------|
| `v0.9.0` (RC1) | D7 | Security blockers closed, governance loop proven, 500-user load tested. Many features still 501. |
| `v0.95.0-beta` | D14 | Feature complete: DMs, Telegram bot, NewsCoin, Trading, Automations, Rooms (sans LiveKit prod), Bridge testnet. |
| `v1.0.0` | D21 | Skill purchase flow + revenue UI, IronShield Pro, LiveKit production, Playwright E2E, PgBouncer. Public launch. |

### Day-by-day exit criteria

| Day | Theme | Hard exit criterion |
|-----|-------|---------------------|
| 1 | Auth foundation | 5 mutating routes return 401 without signed-message header |
| 2 | Auth rollout + admin + rate limits + CORS | Every mutating route protected; AI key uncallable without sig+budget |
| 3 | Ops split + state migration | 3 Render services healthy; runtime JSON files retired |
| 4 | Governance loop end-to-end (testnet) | Vote on testnet → next `/api/research` uses new prompt |
| 5 | Polish: uploads, TODOs, dead code, observability | No public 5xx surface; per-wallet AI $ cap enforced |
| 6 | DB + frontend + secret re-audit | Clean `npm run build`; zero `NEXT_PUBLIC_*` secrets; indexes on hot paths |
| 7 | Load test + RC1 cutover | 1000 concurrent users supported; tag `v0.9.0` |
| 8 | DMs E2E crypto + UX polish | Read receipts + delivery state; key rotation works |
| 9 | Telegram bot feature parity | `/portfolio`, `/alerts`, `/vote`, `/digest` functional from TG |
| 10 | NewsCoin completion | Token launch detection + terminal feed + buy flow live |
| 11 | Trading flows hardening | Slippage controls + failure recovery + history persistence |
| 12 | Automations execution polish | Time/event/AI triggers all fire; quota enforced; dry-run works |
| 13 | Rooms feature complete (no LiveKit prod) | Create/join/chat/recording-metadata works on managed LiveKit dev tier |
| 14 | Bridge testnet proof + beta cutover | One bridge route end-to-end on testnet; tag `v0.95.0-beta` |
| 15 | Skill purchase frontend wiring | Buy button calls payable `purchase_skill`; success + refund handled |
| 16 | Revenue dashboard + richer split | Creator revenue UI; treasury panel reflects skill-sale fees |
| 17 | "My purchases" + uninstall flow | Users see installed skills, can uninstall, history persists |
| 18 | IronShield Pro tier | Stake-locked Pro membership; backend gate; UI; higher AI budget |
| 19 | LiveKit production infrastructure | LiveKit Cloud creds + token issuance + S3 recording pipeline |
| 20 | Playwright E2E suite + PgBouncer | 8 critical paths green in CI; PgBouncer in front of Postgres |
| 21 | Final load test + v1.0.0 cutover | 5000 concurrent users tested; `v1.0.0` shipped with full runbook |

**Drop list (in order):** 5.5, 5.4, 6.3, 8.4, 9.5, 10.4, 12.3, 13.4, 16.3, 17.3, 19.2, 20.1. Never drop: auth (D1+D2), governance evidence (D4), load tests (D7.1, D21.1), all 3 cutovers (D7.3, D14.3, D21.4), purchase_skill contract (D15), Pro contract (D18.1).

---

## Key environment variables

Backend (Render):
```
DATABASE_URL=postgres://...
NEAR_AI_ENDPOINT=https://cloud-api.near.ai/v1/chat/completions
NEAR_AI_KEY=...                       # secret
NEAR_AI_MODEL=llama-3.1-70b-instruct
AGENT_ACCOUNT_ID=ironshield-agent.near
AGENT_PRIVATE_KEY=ed25519:...         # secret (governance worker only)
TELEGRAM_BOT_TOKEN=...                # secret (bot worker only)
TELEGRAM_WEBHOOK_SECRET=...           # secret
CORS_ALLOWED_ORIGINS=https://ironshield.pages.dev,https://...
SENTRY_DSN=...
LOG_LEVEL=info
```

Frontend (Cloudflare Pages build env):
```
NEXT_PUBLIC_NETWORK_ID=mainnet
NEXT_PUBLIC_BACKEND_URL=https://ironclaw-backend.onrender.com
NEXT_PUBLIC_STAKING_CONTRACT=ironshield.near
NEXT_PUBLIC_TOKEN_CONTRACT=ironclaw.near
```

**No `NEXT_PUBLIC_ADMIN_PW`. Ever.**

---

## Deployment commands (correct, current)

Frontend → Cloudflare Pages:
```bash
npm run build
wrangler pages deploy out --project-name=ironshield --branch=main
```

Backend → Render: pin commit on the service via Render API (no Git auto-deploy):
```bash
curl -X POST https://api.render.com/v1/services/<srv-id>/deploys \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"commitId":"<sha>"}'
```

Contract → mainnet:
```bash
cd contract
cargo near build non-reproducible-wasm --no-abi
near deploy ironshield.near target/near/ironshield.wasm
# migrate if storage layout changed:
near call ironshield.near migrate '{}' --accountId ironshield.near
```

Local dev (everything):
```bash
npm run dev          # next dev
npm run backend      # express on 3001
npm run governance   # listener
npm run bot          # tg bot polling
npm run jobs         # crons
# OR: npm run ironclaw  (single-container, dev only)
```

---

## Live URLs
- Frontend: https://ironshield.pages.dev (Cloudflare Pages)
- Backend: https://ironclaw-backend.onrender.com
- Contract: `ironshield.near` on NEAR mainnet (Phase 8, code_hash `Eg9wk…`)
- Telegram: https://t.me/IronClawHQ
