# IronShield runbook (v0.9.0)

The minimum a stranger needs to keep this thing alive at 3 a.m. without
reading source. Updated at v0.9.0 cutover (2026-04-26).

## Architecture

```
                     ┌────────────────────────┐
                     │  ironshield.pages.dev  │   Cloudflare Pages
                     │   (Next.js export)     │   static frontend
                     └───────────┬────────────┘
                                 │ NEP-413 signed REST
                                 ▼
                ┌────────────────────────────────┐
                │ ironclaw-backend.onrender.com  │ Render web service
                │   Node + Express, max 30 pool  │ srv-d7ev9v7lk1mc73c2ic0g
                └───┬──────────────┬───────────┬─┘
                    │              │           │
                    ▼              ▼           ▼
         ┌────────────────┐  ┌──────────┐  ┌─────────────┐
         │ Postgres       │  │ NEAR AI  │  │ ironshield  │
         │ (Render mgmt'd)│  │ (Qwen3)  │  │   .near     │
         │ pool max 30    │  │ daily $  │  │ Phase 8     │
         └────────────────┘  │ caps     │  │ Eg9wk…RL9huw│
                             └──────────┘  └─────────────┘

Deferred: ironshield-worker-governance + ironshield-worker-bot
(declared in render.yaml, not provisioned). Governance listener +
TG bot run from the web service today.
```

## Service registry

| Service | Render ID | Branch tracked | What it runs |
|---|---|---|---|
| **ironclaw-backend** (web) | `srv-d7ev9v7lk1mc73c2ic0g` | `claude/zealous-kalam` (deploys are commit-pinned, not branch-followed) | Express API, governance listener, autonomous loop, jobs, TG bot polling/webhook |
| ironshield-worker-governance | not provisioned | — | Day 3.5 follow-up. Currently embedded in web service. |
| ironshield-worker-bot | not provisioned | — | Day 3.5 follow-up. Currently embedded in web service. |

## Deploy commands

### Backend (Render — commit-pinned)

```bash
# Token: rnd_2MFOgrtOwaB4RDIhWyuydooBk283 (or RENDER_API_KEY in parent .env)
curl -X POST "https://api.render.com/v1/services/srv-d7ev9v7lk1mc73c2ic0g/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"commitId\":\"<40-char-sha>\"}"
# Returns dep-XXXX. Poll status:
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/srv-d7ev9v7lk1mc73c2ic0g/deploys/<dep-id>"
# status flow: build_in_progress → update_in_progress → live
```

The service does NOT auto-deploy from main. Pushing to a branch does
nothing on Render. Trigger every deploy with the API call above.

### Frontend (Cloudflare Pages — direct upload)

```bash
# CF token, account, project live in worktrees/zealous-kalam/.env
set -a; source ~/ironshield/.claude/worktrees/zealous-kalam/.env; set +a
cd ~/ironshield               # or current worktree
npm run build                 # produces out/
npx wrangler pages deploy out --project-name=ironshield --branch=main
# prod alias ironshield.pages.dev auto-promotes from latest --branch=main
```

Pushing to GitHub does NOT deploy. The web4-deploy entries you might
see in older docs are stale.

### Contract (NEAR mainnet)

```bash
cd contract
cargo near build non-reproducible-wasm --no-abi
# output at target/near/ironshield.wasm — bare cargo build produces
# wasm NEAR rejects with PrepareError::Deserialization
near deploy ironshield.near target/near/ironshield.wasm
# If state layout changed:
near call ironshield.near migrate '{}' --accountId ironshield.near
```

Mainnet credentials at `~/.near-credentials/mainnet/ironshield.near.json`.

## Rollback

Three layers, three rollback paths. Always pin to the previous-known-good
commit — do NOT try to fix forward in production.

| Layer | Rollback |
|---|---|
| Backend | Re-issue the Render deploy POST above with the previous commit SHA. v0.9.0 known-good = `7b571a1d0af5eebaa65e49b7f0eceb9d755a9709`. |
| Frontend | `git checkout <previous-sha> && npm run build && wrangler pages deploy out --project-name=ironshield --branch=main`. Last v0.9.0 build SHA = same as backend. |
| Contract | `near deploy ironshield.near <previous-wasm>`. We do NOT keep historical wasms in git — back up the artifact before every prod contract deploy. |

If the DB schema applied a destructive migration, rollback gets harder —
the schema.sql is purely additive at v0.9.0, so backwards-compatible.

## On-call decision tree

| Symptom | First check |
|---|---|
| **5xx spike** | Render dashboard → service logs. Likely DB pool exhaustion (`Connection terminated`) or upstream NEAR RPC timeout. If pool: Day 6.2 set max=30; transient drops auto-retry once. If RPC: NEAR RPC has been flaky historically — wait or swap `NEAR_RPC_URL`. |
| **AI cost spike** | Backend logs for `[aiBudget]` lines. Per-wallet caps land at `wallet_budgets` table — admin overrides at `admin_wallets.daily_ai_budget_usd`. If runaway, raise the global `DAILY_AI_BUDGET_USD` floor or lower the rate limit. |
| **Governance not updating** | `ironclaw-backend` logs for `[governanceListener]`. Verify `AGENT_ACCOUNT_ID` + `AGENT_PRIVATE_KEY` envs. Listener polls every 5 min via `GOV_POLL_INTERVAL_MS`. |
| **TG bot dead** | Check `TELEGRAM_BOT_TOKEN`, then webhook secret. Bot mode toggles via `BOT_MODE` (webhook vs polling). |
| **WS disconnects** | Day 5.5 added authed `/ws/feed`. Tickets use `WS_TICKET_SECRET`; if unset, tickets don't survive a restart. Day 5.6 session tokens use the same secret. |
| **Auth 401 storm** | Day 1 nonce store. Nonces single-use, 5-min TTL. Replay attempts are 401 + `replay`. If users see this on every action, a clock skew between client and server might be misclassifying valid signatures — check Render time. |
| **Wallet can't sign in** | Privy app id missing → frontend renders disabled button. NEP-413 wallets need network match (`NEXT_PUBLIC_NETWORK_ID`). |

## Env var checklist (per service)

`.env.example` is authoritative. v0.9.0 critical envvars on Render:

- `DATABASE_URL` — Render-managed Postgres connection string
- `WS_TICKET_SECRET` — HMAC for WS tickets + session tokens (Day 5.5/5.6). Lose this and all in-flight tokens go invalid.
- `ADMIN_WALLET_SEED` — bootstraps admin allowlist on first boot. Without it, AdminPanel locks out everyone.
- `AGENT_ACCOUNT_ID` + `AGENT_PRIVATE_KEY` — governance executor identity
- `ORCHESTRATOR_ACCOUNT` + `ORCHESTRATOR_KEY` — mission executor
- `COLLECTOR_ACCOUNT` + `COLLECTOR_KEY` — revenue router
- `CUSTODIAL_ENCRYPT_KEY` — TG-bot custodial wallet encryption
- `IRONCLAW_GATEWAY_TOKEN` — NEAR AI Cloud auth
- `CORS_ALLOWED_ORIGINS` — exact-string match list, comma-separated
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME`
- Cloudinary trio (media uploads)
- LiveKit trio (rooms voice)
- VAPID pair (push notifications)

## Week-2 backlog (open at v0.9.0)

- Day 3.5 — provision `ironshield-worker-governance` + `ironshield-worker-bot` Render services (currently embedded in web)
- Day 6.1 — capture real `EXPLAIN ANALYZE` numbers for the 4 new indexes via `pg_stat_statements`
- Day 6.2 — run `smoke-pool.js` against a real `DATABASE_URL`
- Day 7.1 — full k6 250/500-concurrent profile against a dedicated preview env (current soft-load.js can't bypass per-IP rate limit from a single source)
- Day 18 — IronShield Pro tier (currently a stub at `/rewards#pro`)
- ESLint v9 flat-config repair (`@typescript-eslint` resolution failure on `npm run lint`)
- PgBouncer for connection multiplexing
- Playwright E2E suite
- Bridge production proof
- Cloudflare preview wildcard CORS support (today's allowlist is exact-string match; preview hashes need explicit entries)
