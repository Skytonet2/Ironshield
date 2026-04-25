# IronShield v1 Launch Sprint — 21 Day Plan

**Working hours:** 0800 → 1700 daily, ~9h × 21 days = ~189h productive (minus lunch).
**Goal:** ship full v1 — every feature in the audit either complete, gracefully gated, or explicitly deferred to v1.1 with a written reason.

## Release train

| Tag | Day | Scope |
|-----|-----|-------|
| `v0.9.0` (RC1) | D7 | Security blockers closed, governance loop proven, 500-user load tested. Many features still 501. |
| `v0.95.0-beta` | D14 | Feature complete: DMs, Telegram bot, NewsCoin, Trading, Automations, Rooms (sans LiveKit prod), Bridge testnet. |
| `v1.0.0` | D21 | Skill purchase flow + revenue UI, IronShield Pro, LiveKit production, Playwright E2E, PgBouncer. Public launch. |

## How to use this file

Each task below has a **self-contained prompt** ready to copy-paste into a fresh Claude session. Each prompt:
- Names the goal, files to touch, and the verify check.
- Honors the four operating principles: surface assumptions, minimum code, surgical changes, verify-loop.
- Should be runnable without re-reading prior conversation.

If a day slips, the cleanest cuts in priority order: **drop 5.5 (DM polling → WebSocket), drop 6.4 (IronShield Pro decision), drop 5.4 (dead-code sweep)**. Auth, governance loop, load test are non-negotiable.

---

## Day-by-day overview

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
| 9 | Telegram bot feature parity | `/portfolio`, `/alerts`, `/vote`, `/digest` all functional from TG |
| 10 | NewsCoin completion | Token launch detection + terminal feed + buy flow live |
| 11 | Trading flows hardening | Slippage controls + failure recovery + history persistence |
| 12 | Automations execution polish | Time/event/AI triggers all fire; quota enforced; dry-run works |
| 13 | Rooms feature complete (no LiveKit prod) | Create/join/chat/recording-metadata works on managed LiveKit dev tier |
| 14 | Bridge testnet proof + beta cutover | One bridge route end-to-end on testnet; tag `v0.95.0-beta` |
| 15 | Skill purchase frontend wiring | Buy button calls `install_skill` payable; success + refund handled |
| 16 | Revenue dashboard + richer split | Creator revenue UI; contract split refactored to match treasury.rs model |
| 17 | "My purchases" + uninstall flow | Users see installed skills, can uninstall, history persists |
| 18 | IronShield Pro tier | Stake-locked Pro membership; backend gate; UI; higher AI budget |
| 19 | LiveKit production infrastructure | LiveKit Cloud creds + token issuance + recording at room ID |
| 20 | Playwright E2E suite + PgBouncer | 8 critical paths green in CI; PgBouncer in front of Postgres |
| 21 | Final load test + v1.0.0 cutover | 5000 concurrent users; `v1.0.0` shipped with full runbook update |

---

## DAY 1 — Auth foundation

### TASK 1.1 — Design and document the signed-message auth contract
**Time:** 0800-0900
**Goal:** lock the wire format before writing code.
**Files:** new `docs/auth-contract.md`.
**Verify:** another engineer (or fresh Claude) reads the doc and can implement either side without questions.

**Prompt:**
> Design the wire format for signed-message authentication on the IronShield backend. Today every mutating route trusts a bare `x-wallet` header — anyone can impersonate anyone. We need to replace this with a NEAR signed-message scheme.
>
> Constraints:
> - The wallet selector (`@near-wallet-selector` v10, configured in `src/lib/contexts.js`) supports `signMessage`. Use it.
> - Signatures must be replay-safe: include a server-issued nonce, valid for ≤5 min, single-use.
> - Read-only routes stay public; mutating routes require sig.
> - No third-party auth library. Verify with `near-api-js` `KeyPair.verify` or equivalent primitive.
>
> Write `docs/auth-contract.md` covering: header names, payload shape, nonce issuance endpoint, server verification steps, replay-window policy, error codes (401 categories: missing-sig, expired-nonce, bad-sig, replay). Include a curl example and a TS example. Under 400 lines. Do not write code yet.

---

### TASK 1.2 — Server-side `requireWallet` middleware + nonce store
**Time:** 0900-1130
**Goal:** drop-in middleware that enforces the contract.
**Files:** `backend/middleware/requireWallet.js` (new), `backend/db/schema.sql` (add `auth_nonces` table), `backend/db/migrations/` (new migration).
**Verify:** unit test in `backend/__tests__/requireWallet.test.js` covers missing/expired/replayed/bad-sig/valid cases. All pass.

**Prompt:**
> Implement NEAR signed-message auth middleware per `docs/auth-contract.md`.
>
> Create `backend/middleware/requireWallet.js` exporting a single middleware that:
> 1. Reads `x-wallet`, `x-signature`, `x-nonce`, `x-public-key` headers.
> 2. Looks up nonce in `auth_nonces` (Postgres). Reject if missing/expired/used.
> 3. Verifies sig against `x-public-key` using `near-api-js`.
> 4. Confirms `x-public-key` is a registered key for `x-wallet` (use `view_access_key_list` cached 60s in memory; if not cached, accept full-access keys returned from RPC).
> 5. Marks nonce used. Sets `req.wallet = x-wallet`. Calls `next()`.
> 6. Otherwise responds 401 with one of the documented error codes.
>
> Add migration creating `auth_nonces (nonce TEXT PRIMARY KEY, wallet TEXT, issued_at TIMESTAMPTZ DEFAULT NOW(), used_at TIMESTAMPTZ)` with TTL via partial index.
>
> Add `GET /api/auth/nonce` endpoint that issues a fresh nonce (256-bit hex, 5-min expiry).
>
> Write `backend/__tests__/requireWallet.test.js` with cases: no headers → 401 `missing-sig`; nonce never issued → 401 `bad-nonce`; nonce expired → 401 `expired-nonce`; nonce reused → 401 `replay`; sig mismatch → 401 `bad-sig`; valid → next() called and `req.wallet` set.
>
> Honor the operating principles in this repo: surgical changes, no speculative options, no error handling for impossible scenarios. The middleware should be one file under 150 lines.

---

### TASK 1.3 — Client-side `apiFetch` wrapper that signs
**Time:** 1130-1230
**Goal:** any frontend code can call `apiFetch(path, opts)` and signing happens transparently.
**Files:** `src/lib/apiFetch.js` (new), maybe `src/hooks/useNear.js` (export `signRequest`).
**Verify:** in dev tools network tab, every request from `apiFetch` carries `x-signature`/`x-nonce`/`x-public-key`/`x-wallet` and the backend logs `req.wallet` set.

**Prompt:**
> Create `src/lib/apiFetch.js` exporting `apiFetch(path, options)` that:
> 1. If `options.method` is GET/HEAD or `options.public === true`, just calls `fetch(NEXT_PUBLIC_BACKEND_URL + path, options)`. No signing.
> 2. Otherwise: GET `/api/auth/nonce` to get a fresh nonce, sign `{nonce, path, body}` via the active wallet selector's `signMessage`, attach `x-wallet`, `x-signature`, `x-nonce`, `x-public-key` headers, then `fetch`.
> 3. On 401 with `code: "expired-nonce"`, retry once with a fresh nonce.
>
> The active wallet selector lives in `src/lib/contexts.js` (Zustand-ish). Export a `signRequest(payload)` helper from `src/hooks/useNear.js` if one doesn't exist; the rest of `useNear.js` should not change shape.
>
> Update one caller as a smoke test: `src/components/agents/CreateAgentPage.jsx` register-agent submit. Do not touch other callers in this task.
>
> Verify: in browser dev tools, the register-agent request shows the four signed headers and the backend (running locally) logs the wallet via `requireWallet`. If wallet selector returns no signer (user not connected), `apiFetch` throws with a clear message — caller decides what to do.
>
> Operating principles: surgical changes only, no global fetch monkeypatch, no retry-with-backoff library.

---

### TASK 1.4 — Wire `requireWallet` on top 5 mutating routes
**Time:** 1330-1500
**Goal:** prove the contract works on the routes most prone to abuse.
**Files:** `backend/routes/agents.route.js`, `backend/routes/skills.route.js`, `backend/routes/dm.route.js`, `backend/routes/posts.route.js`, `backend/routes/governance.route.js`.
**Verify:** for each of the 5, an unsigned `curl POST` returns 401; a signed request from the frontend succeeds. Read endpoints unchanged.

**Prompt:**
> Wire the `requireWallet` middleware (from `backend/middleware/requireWallet.js`) onto every mutating endpoint in these 5 routers:
> - `backend/routes/agents.route.js`
> - `backend/routes/skills.route.js`
> - `backend/routes/dm.route.js`
> - `backend/routes/posts.route.js`
> - `backend/routes/governance.route.js`
>
> Rules:
> - Apply to POST/PUT/PATCH/DELETE only. GET stays public.
> - After auth, ALWAYS use `req.wallet` (set by middleware) instead of the previous `x-wallet` header read or `req.body.wallet` field. Replace any spot where the route trusted a client-supplied wallet identifier with `req.wallet`.
> - Do not change response shapes or business logic.
>
> Verify per route: `curl -X POST <route>` (no headers) returns 401; same call from the frontend (which now uses `apiFetch`) succeeds. Add one regression line to `backend/__tests__/` per router asserting the 401 case.
>
> Operating principles: surgical changes — do NOT refactor route handlers, rename variables, or "improve" adjacent code. Only swap auth source.

---

### TASK 1.5 — Dangerous-TODO triage (ownership/trust holes)
**Time:** 1500-1630
**Goal:** any TODO that bypasses ownership checks or trusts client input → fix or 501.
**Files:** `backend/routes/dm.route.js`, `posts.route.js`, `tips.route.js`, `revenue.route.js`, `agents.route.js`.
**Verify:** grep for TODO/mock/placeholder in those 5 files returns zero hits in security-sensitive paths.

**Prompt:**
> Audit these 5 files for TODOs, "mock", "placeholder", or comments that indicate ownership checks or trust boundaries are skipped:
> - `backend/routes/dm.route.js`
> - `backend/routes/posts.route.js`
> - `backend/routes/tips.route.js`
> - `backend/routes/revenue.route.js`
> - `backend/routes/agents.route.js`
>
> For each finding, decide:
> 1. **Implement now** if the fix is ≤20 lines and obvious (e.g., add `WHERE owner_wallet = $1`).
> 2. **Return 501** with `{ error: "feature.unavailable", feature: "<name>" }` if implementing properly is multi-day work. Frontend will hide the CTA in Day 5.
> 3. **Leave as-is** only if the TODO is purely cosmetic and not security-relevant (document why in the PR).
>
> Print a brief table at the end: file, line, decision, one-sentence reason. Do not touch other files. Do not refactor.

---

### TASK 1.6 — Day 1 deploy + smoke
**Time:** 1630-1700
**Goal:** Day 1 work is live on Render preview; basic smoke passes.
**Verify:** signed-fetch from staging frontend hits Render preview backend and round-trips successfully; unsigned curl returns 401.

**Prompt:**
> Deploy current commit to Render preview (per memory: `POST /v1/services/<srv-id>/deploys` with `{commitId}`). Then from a local frontend pointed at the preview backend, exercise: register-agent (signed), DM send (signed), unsigned curl on each (expect 401). Report pass/fail and any logs that look off. Don't change code in this task — if a test fails, file a fix-up task and stop.

---

## DAY 2 — Auth rollout + admin + rate limits + CORS

### TASK 2.1 — Wire `requireWallet` on remaining mutating routes
**Time:** 0800-1000
**Goal:** every mutating endpoint in `backend/routes/*` is signed.
**Files:** all remaining `*.route.js` with mutating handlers (rooms, automations, livekit, push, newscoin, tg, trading, bridge, ai, ironclaw, market, media, xfeed, feed, chat).
**Verify:** grep across `backend/routes/*.route.js` for `router\.(post|put|patch|delete)` shows every match either uses `requireWallet` or has an explicit `// public:` comment with one-sentence justification.

**Prompt:**
> Wire `requireWallet` middleware onto every mutating handler in the remaining route files:
> - rooms, automations, livekit, push, newscoin, tg, trading, bridge, ai, ironclaw, market, media, xfeed, feed, chat
>
> Same rules as Task 1.4. For any handler that genuinely needs to be public (e.g., `/api/tg/webhook/:secret` because Telegram calls it with a shared secret), add a comment `// public: <one-sentence reason>` so the audit grep stays clean.
>
> Verify: `grep -rE "router\.(post|put|patch|delete)" backend/routes/` — every result line is followed by either `requireWallet` in the handler chain or a `// public:` annotation in the route file. No exceptions without justification.

---

### TASK 2.2 — Kill `NEXT_PUBLIC_ADMIN_PW`, build server-side admin gate
**Time:** 1000-1200
**Goal:** admin access requires an allowlisted wallet + valid sig. No client-side password anywhere.
**Files:** `src/components/AdminPanel.jsx`, `backend/routes/admin.route.js` (may need to create), `backend/db/schema.sql` (`admin_wallets` table), `.env.example`.
**Verify:** with admin wallet → panel renders + actions work. With non-admin wallet → 403. With no wallet → redirect/empty state. Grep across repo for `NEXT_PUBLIC_ADMIN_PW` and `ironshield_admin` returns zero matches.

**Prompt:**
> Replace the client-side admin password gate with a server-side wallet allowlist.
>
> 1. Migration: create `admin_wallets (wallet TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'admin', daily_ai_budget_usd NUMERIC, added_at TIMESTAMPTZ DEFAULT NOW())`. Seed with one wallet from `ADMIN_WALLET_SEED` env var on migration boot if the table is empty.
> 2. Add `GET /api/admin/check` (signed-auth required) returning `{ admin: true, role }` if `req.wallet` is in `admin_wallets`, otherwise 403.
> 3. In `src/components/AdminPanel.jsx`: remove the `pw` state, the `NEXT_PUBLIC_ADMIN_PW` check, and the hardcoded `"ironshield_admin"` fallback (currently around line 140). On mount, call `apiFetch("/api/admin/check")`. If 200 → render panel. If 403 or 401 → render "Not authorized" with a sign-in CTA.
> 4. Wire `requireWallet` + an `requireAdmin` chain helper on every admin-only mutating endpoint (audit `admin.route.js` if it exists; if admin actions live in other routers, add `requireAdmin` there).
> 5. Remove `NEXT_PUBLIC_ADMIN_PW` from `.env.example`. Document `ADMIN_WALLET_SEED` instead.
>
> Verify: `grep -r NEXT_PUBLIC_ADMIN_PW` and `grep -r ironshield_admin` both return zero. With your wallet allowlisted → AdminPanel works. With another wallet → 403. With no wallet → "Not authorized" view.
>
> Operating principles: simplest possible gate. No roles system, no permission matrix. Just `is in allowlist?`.

---

### TASK 2.3 — Wire `rateLimiter` to AI + auth + mutation routes
**Time:** 1300-1430
**Goal:** AI key uncallable beyond budget; mutations/reads can't be DoS'd by one wallet.
**Files:** `backend/server.js`, `backend/services/rateLimiter.js`.
**Verify:** load 25 req/min/wallet at `/api/research` → first 20 succeed, next 5 return 429 with `Retry-After`.

**Prompt:**
> `backend/services/rateLimiter.js` exists but is not wired into `backend/server.js`. Wire it.
>
> Tiers (use `req.wallet` when available, fall back to IP):
> - **AI**: `/api/research`, `/api/summary`, `/api/chat`, `/api/ai/*`, `/api/verify` → 20/min/wallet, 100/day/wallet.
> - **Mutations**: any signed-auth route → 60/min/wallet.
> - **Reads**: everything else → 300/min/IP.
> - **Auth nonce issuance**: `/api/auth/nonce` → 60/min/IP.
>
> 429 response shape: `{ error: "rate-limited", retryAfterMs }` with `Retry-After` header.
>
> Verify with a small node script in `scripts/smoke-ratelimit.js` that fires 25 signed `/api/research` calls in a loop and asserts the 21st-25th return 429.
>
> Operating principles: do not write a new rate-limiter. Use what exists. If `rateLimiter.js` is missing a tier abstraction, add the smallest possible shim — no general-purpose middleware framework.

---

### TASK 2.4 — Lock CORS + helmet + body limits
**Time:** 1430-1530
**Goal:** no wildcard CORS, no payload-bomb DoS, basic security headers set.
**Files:** `backend/server.js`.
**Verify:** OPTIONS from a non-allowlisted origin returns no CORS headers; `curl -X POST -d "$(head -c 1000000 /dev/urandom | base64)" /api/posts` returns 413.

**Prompt:**
> Three small changes to `backend/server.js`:
>
> 1. Replace bare `cors()` with explicit allowlist from `CORS_ALLOWED_ORIGINS` env var (comma-separated). In dev, allow `http://localhost:3000`. Reject (no headers) for everything else.
> 2. Add `helmet()` with default config; turn off `contentSecurityPolicy` since the API serves no HTML.
> 3. Replace `express.json()` with `express.json({ limit: "256kb" })` and add `express.urlencoded({ extended: false, limit: "64kb" })`.
>
> Add `CORS_ALLOWED_ORIGINS` to `.env.example` with sane defaults.
>
> Verify: an OPTIONS preflight from `https://evil.example.com` returns no `Access-Control-Allow-Origin`. A 1MB JSON body returns 413. Frontend (Cloudflare Pages preview) and localhost:3000 both still work.
>
> Operating principles: 3 small edits to one file. No new middleware files.

---

### TASK 2.5 — Day 2 deploy + smoke
**Time:** 1530-1700
**Goal:** every mutating route is locked; AI key budget defended; CORS is real.
**Verify:** smoke script runs all 5 attack vectors from a non-allowlisted origin: unsigned mutation, expired nonce, replay, oversized body, AI flood. All blocked.

**Prompt:**
> Write `scripts/smoke-day2.js` that exercises five attack vectors and reports pass/fail:
> 1. Unsigned POST to 5 random mutating routes → expect 401.
> 2. Replayed signed POST → expect 401 `replay`.
> 3. Oversized body (1MB) on `/api/posts` → expect 413.
> 4. CORS preflight from `https://evil.example` → expect missing `Access-Control-Allow-Origin`.
> 5. 25 signed `/api/research` calls/min → expect 429 on calls 21-25.
>
> Run against Render preview after deploying current commit. Report results. Do not change application code in this task.

---

## DAY 3 — Ops split + state migration

### TASK 3.1 — Split Render into 3 services
**Time:** 0800-1000
**Goal:** web, governance worker, bot worker each own a process.
**Files:** `render.yaml`, possibly `package.json` script aliases.
**Verify:** Render dashboard shows 3 healthy services; `npm run ironclaw` is no longer used by any prod service (kept as dev convenience).

**Prompt:**
> Split the Render deployment into three services. Edit `render.yaml`:
> 1. `ironshield-web` — `node backend/server.js` (port from $PORT). Existing service ID stays.
> 2. `ironshield-worker-governance` — new background worker. Start command: `node backend/services/governanceListener.js` (after Task 3.2 makes it standalone-runnable).
> 3. `ironshield-worker-bot` — new background worker. Start command: `node bot/index.js` (after Task 3.4 switches it to webhook mode and adds the listener).
>
> Each service: same Docker image (existing Dockerfile), different `dockerCommand`. Same `DATABASE_URL`. Per-service env: governance worker also needs `AGENT_ACCOUNT_ID` + `AGENT_PRIVATE_KEY`; bot worker needs `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET`.
>
> Document the service IDs in CLAUDE.md (or a new `docs/ops.md`) so manual deploy API calls have targets.
>
> Verify: deploy all three; check logs show one process per service. Run `ps -ef` inside web container — should see exactly one node process, not five.
>
> Operating principles: minimum config. No multi-environment matrix. Manual commit-pinned deploys stay (per existing memory note).

---

### TASK 3.2 — Move runtime state to Postgres `agent_state` table
**Time:** 1000-1230
**Goal:** retire `agent/listenerState.json`, `loopState.json`, `activePrompt.json`, `activeMission.json` from runtime path.
**Files:** new migration, new `backend/db/agentState.js`, edits to `backend/services/governanceListener.js`, `agent/nearAgent.js`, `backend/services/agentConnector.js`. Delete the JSON files from git, add to `.gitignore`.
**Verify:** restart governance worker mid-poll twice; no duplicate Telegram pushes; `activePrompt` change persists across restart.

**Prompt:**
> Replace 4 mutable JSON files with a Postgres-backed key-value store.
>
> 1. Migration: create `agent_state (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`.
> 2. New `backend/db/agentState.js` exports `get(key)`, `set(key, value)`, `getCached(key, ttlMs)` (in-memory cache to avoid hammering DB on every AI call).
> 3. In `backend/services/governanceListener.js`: replace every `fs.readFileSync`/`fs.writeFileSync` of `agent/*.json` with `get`/`set`. Keys: `listenerState`, `loopState`, `activePrompt`, `activeMission`.
> 4. In `agent/nearAgent.js` and `backend/services/agentConnector.js`: replace file reads with `getCached("activePrompt", 30_000)` and `getCached("activeMission", 30_000)`.
> 5. Migration step on first boot: if any of the 4 JSON files exist on disk, copy values into `agent_state` once, then ignore the files going forward.
> 6. Delete the JSON files from the git repo. Add `agent/*.json` to `.gitignore`.
>
> Verify: kill the governance worker mid-poll twice via Render dashboard. Listener resumes from DB state. `activePrompt` change made via test proposal persists. No file writes to `agent/*.json` happen after migration.
>
> Operating principles: smallest possible KV shim. Don't introduce an ORM. Don't add migrations framework if `db/migrations/` already runs sequentially on boot — match the existing convention.

---

### TASK 3.3 — Aggregator credentials self-check
**Time:** 1330-1400
**Goal:** governance worker fails loud, not silent, if its agent keys are missing.
**Files:** `backend/services/governanceListener.js` (top-of-file env check).
**Verify:** start worker without `AGENT_ACCOUNT_ID` → exits non-zero with a clear log line.

**Prompt:**
> At the top of `backend/services/governanceListener.js`, before any work:
>
> 1. If `AGENT_ACCOUNT_ID` or `AGENT_PRIVATE_KEY` are missing, log `[FATAL] governance listener requires AGENT_ACCOUNT_ID and AGENT_PRIVATE_KEY — aggregator will not run` and `process.exit(1)`.
> 2. If `STAKING_CONTRACT_ID` is missing, log similarly and exit.
>
> No silent no-op. Render restarts and surfaces the error in logs and email alerts.
>
> Verify: locally `node backend/services/governanceListener.js` with the env vars unset exits 1 within 1 second with the log line above.
>
> Operating principles: 5 lines. No env-validation library.

---

### TASK 3.4 — Telegram bot webhook mode
**Time:** 1400-1600
**Goal:** bot serves a webhook endpoint instead of long-polling.
**Files:** `bot/index.js` (or new `bot/webhook.js` entrypoint), `backend/server.js` (add the webhook route there) OR keep webhook in the bot worker behind a small Express app.
**Verify:** send a `/start` to the bot in prod → Render bot-worker logs show the update arrived via webhook (not via polling); response is sent.

**Prompt:**
> Convert the Telegram bot from polling to webhook mode for production. Keep polling available behind `BOT_MODE=polling` for local dev.
>
> Implementation:
> 1. In `bot/index.js`: read `BOT_MODE` (default `polling` in dev, `webhook` in prod via env).
> 2. In webhook mode, start a small Express app on `$PORT` with one route `POST /tg/webhook/:secret`. Compare `:secret` to `TELEGRAM_WEBHOOK_SECRET` in constant time. Mismatch → 403. Match → forward to the existing update handler.
> 3. On startup, call `setWebhook` with `https://<bot-worker-host>/tg/webhook/<secret>` if not already set (cache the URL in `agent_state` to avoid hitting Telegram on every restart).
> 4. Render service for bot exposes the webhook URL as the public hostname. (Bot worker runs as a web service if exposing HTTP — adjust `render.yaml` accordingly.)
>
> Verify: deploy bot worker, send `/start` from your account, see "GET /api/getMe" success on boot and "POST /tg/webhook/..." 200 on the update. No polling traffic.
>
> Operating principles: minimum surface. No bot framework swap. Reuse existing `node-telegram-bot-api` (or whatever's already in `package.json`).

---

### TASK 3.5 — Day 3 deploy + smoke
**Time:** 1600-1700
**Goal:** 3 Render services healthy, state in DB, bot on webhook.
**Verify:** kill each worker once via Render dashboard; system recovers without manual intervention.

**Prompt:**
> Deploy current commit to all 3 Render services. Run smoke:
> 1. Kill each worker once (web, governance, bot). Confirm Render restarts and recovery is < 60s.
> 2. Check `agent_state` table has `listenerState` rows incrementing.
> 3. Send a TG `/start` and confirm webhook 200 in bot logs.
> 4. Hit `/api/research` from frontend → confirm `agent_state.activePrompt` was read (look for the cache log).
>
> Report any anomalies. No code changes in this task.

---

## DAY 4 — Governance loop end-to-end (testnet)

### TASK 4.1 — Deploy current contract WASM to testnet
**Time:** 0800-0930
**Goal:** a fresh testnet contract identical to mainnet Phase 8 to vote against.
**Files:** none (script-driven).
**Verify:** `near view ironshield-test.testnet get_proposals '{}'` returns `[]`; staking + agent registration work via testnet account.

**Prompt:**
> Deploy the current contract WASM to a fresh testnet account.
>
> 1. `cargo near build non-reproducible-wasm --no-abi` (per memory: bare `cargo build` produces wasm NEAR rejects).
> 2. Create `ironshield-test.testnet` if not exists: `near create-account ironshield-test.testnet --useFaucet`.
> 3. `near deploy ironshield-test.testnet target/near/ironshield.wasm`.
> 4. `near call ironshield-test.testnet new '{...}'` with the same init args mainnet uses.
>
> Verify: `near view ironshield-test.testnet get_proposals '{}'` returns `[]`. `register_agent` from a second testnet account succeeds. `create_skill` succeeds.
>
> Operating principles: do not modify the contract. This task is purely deployment.

---

### TASK 4.2 — Frontend testnet toggle
**Time:** 0930-1100
**Goal:** the same frontend, run with `NEXT_PUBLIC_NETWORK_ID=testnet`, hits the testnet contract.
**Files:** `src/hooks/useNear.js`, possibly `src/lib/contexts.js`.
**Verify:** localhost frontend with `NEXT_PUBLIC_NETWORK_ID=testnet` shows testnet wallet selector and writes hit `ironshield-test.testnet`.

**Prompt:**
> Audit the frontend for hardcoded contract IDs or RPC URLs. Replace with env-driven config:
> - `NEXT_PUBLIC_NETWORK_ID` (`mainnet` | `testnet`)
> - `NEXT_PUBLIC_STAKING_CONTRACT` (e.g. `ironshield.near` or `ironshield-test.testnet`)
> - `NEXT_PUBLIC_TOKEN_CONTRACT`
>
> Most of this is probably already in place (`src/hooks/useNear.js`); verify and fix gaps.
>
> Verify: with `NEXT_PUBLIC_NETWORK_ID=testnet` set in `.env.local`, run `npm run dev`, connect wallet, register an agent. Transaction goes to `ironshield-test.testnet`.
>
> Operating principles: surgical. Do not refactor the wallet selector setup. Only swap hardcoded strings for env reads.

---

### TASK 4.3 — End-to-end PromptUpdate proposal dry run
**Time:** 1100-1300
**Goal:** prove the autonomous brain works: vote → state changes → next AI call uses new prompt.
**Files:** none (test execution).
**Verify:** captured logs/screenshots showing prompt before vote ≠ prompt after vote ≠ prompt sent to NEAR AI on the very next `/api/research`.

**Prompt:**
> Execute and document the autonomous-governance loop end-to-end on testnet. This is the most important verification of the sprint.
>
> Pre-state: capture current `agent_state.activePrompt` value. Capture the actual system prompt that hits NEAR AI by adding a one-line debug log in `backend/services/agentConnector.js` (remove after).
>
> Steps (record timestamps and contract tx hashes):
> 1. From frontend, create a `PromptUpdate` proposal with a unique sentinel string (e.g., `"sprint-day-4-sentinel-" + Date.now()`).
> 2. Vote it through with enough Vanguard NFTs to pass.
> 3. Execute the proposal.
> 4. Watch governance worker logs for `applyExecutedToRuntime` firing.
> 5. Confirm `SELECT value FROM agent_state WHERE key = 'activePrompt'` now contains the sentinel.
> 6. Trigger `/api/research` from the frontend.
> 7. In agentConnector debug log, confirm the system prompt sent to NEAR AI contains the sentinel.
>
> Save the artifact: write `docs/governance-loop-evidence.md` with timestamps, tx hashes, log excerpts, and DB query output.
>
> Operating principles: no code changes except the temporary debug log (remove in this task). If a step fails, file a fix-up task and stop — don't paper over.

---

### TASK 4.4 — End-to-end Mission proposal dry run
**Time:** 1330-1430
**Goal:** same loop for Mission-type proposals.
**Files:** none.
**Verify:** `agent_state.activeMission` updates and the next AI call's mission context contains the sentinel.

**Prompt:**
> Repeat the Task 4.3 protocol but with a `Mission`-type proposal and the `activeMission` key. Append evidence to `docs/governance-loop-evidence.md`.

---

### TASK 4.5 — Replay-attack test on signed-auth nonces
**Time:** 1430-1530
**Goal:** verify the auth contract's replay defense holds under hostile traffic.
**Files:** `scripts/smoke-replay.js` (new).
**Verify:** every replay attempt across 100 trials returns 401 `replay`.

**Prompt:**
> Write `scripts/smoke-replay.js` that:
> 1. Acquires a fresh nonce, signs a `/api/posts` create.
> 2. Submits the signed request 5 times in parallel.
> 3. Asserts exactly 1 succeeds (200/201) and 4 return 401 with `code: "replay"`.
> 4. Repeats 20 times.
>
> Run against testnet-pointed backend. If any replay slips through, fix the nonce-marking race in `requireWallet` middleware (likely needs `INSERT … ON CONFLICT DO NOTHING RETURNING xmax = 0` or a SELECT FOR UPDATE).
>
> Verify: 0 replays succeed across 100 attempts.

---

### TASK 4.6 — Day 4 evidence pack + commit
**Time:** 1530-1700
**Goal:** the loop is provable to a stakeholder.
**Verify:** `docs/governance-loop-evidence.md` is committed; a 60-second screen recording exists demonstrating vote → prompt change → AI response shift.

**Prompt:**
> Polish `docs/governance-loop-evidence.md` for stakeholder readability: add a 4-line ASCII diagram, embed the key tx hashes, and include a 60-second screen recording link (record locally, upload to whatever storage the team uses; if none, just describe the recording steps in markdown). Commit. No code changes.

---

## DAY 5 — Polish: uploads, TODOs, dead code, observability

### TASK 5.1 — Media route hardening
**Time:** 0800-1000
**Goal:** uploads are size/MIME bounded, per-wallet quota enforced.
**Files:** `backend/routes/media.route.js`.
**Verify:** 6MB upload → 413; `.exe` upload → 415; 11th upload of the day from same wallet → 429.

**Prompt:**
> Harden `backend/routes/media.route.js` (uses `busboy`).
>
> 1. Reject any file > 5 MB → 413.
> 2. MIME allowlist by magic bytes (use `file-type` package): `image/png`, `image/jpeg`, `image/webp`. Anything else → 415.
> 3. Random filename: `crypto.randomUUID() + ext`. Never trust client-supplied name.
> 4. Per-wallet daily quota in Postgres `media_uploads (wallet, uploaded_at)` — 10 uploads/day default; admin allowlist override via `admin_wallets.daily_ai_budget_usd`-style column. 11th → 429.
> 5. Strip EXIF on images via `sharp`.
>
> Verify: 6MB upload → 413; `.exe` renamed to `.png` → 415 (magic bytes win); 10 successful uploads; 11th → 429.
>
> Operating principles: minimum hardening. No virus scanning. No CDN. No image resizing pipeline.

---

### TASK 5.2 — TODO triage round 2
**Time:** 1000-1200
**Goal:** non-security TODOs in livekit/newscoin/feed/xfeed/rooms either implemented, gated, or 501'd.
**Files:** `backend/routes/livekit.route.js`, `newscoin.route.js`, `feed.route.js`, `xfeed.route.js`, `rooms.route.js`.
**Verify:** zero `TODO`/`mock`/`placeholder` remaining in those 5 files. Frontend has no CTA pointing at a 501.

**Prompt:**
> Audit and resolve every TODO/mock/placeholder in:
> - `backend/routes/livekit.route.js` (×5 hits)
> - `backend/routes/newscoin.route.js` (×3)
> - `backend/routes/feed.route.js`
> - `backend/routes/xfeed.route.js`
> - `backend/routes/rooms.route.js` (×2)
>
> For each, choose: implement (≤30 lines), feature-flag behind `FEATURE_<X>=off`, or `501 { feature: "<name>" }`. Days 10 (NewsCoin), 13 (Rooms), and 19 (LiveKit prod) will fully complete the gated paths — your job today is just to make the routes safe and the UI honest about what's not ready yet.
>
> Then in the frontend, find every CTA whose endpoint now returns 501. Hide or replace with "Coming soon — week 2" badge. Routes to check: `/rooms`, `/newscoin`, anything that calls livekit. Do not delete the components — just gate the CTAs.
>
> Verify: `grep -E "TODO|mock|placeholder" backend/routes/{livekit,newscoin,feed,xfeed,rooms}.route.js` returns zero. Click every CTA in those areas locally — none hits a 501 in the browser.

---

### TASK 5.3 — Per-wallet AI $ cap
**Time:** 1300-1400
**Goal:** no single wallet can run up an unbounded NEAR AI bill.
**Files:** `backend/services/agentConnector.js`, `backend/db/schema.sql` (extend `admin_wallets` or new `wallet_budgets`).
**Verify:** wallet with `daily_ai_budget_usd = 1.0` gets 402 once accumulated cost ≥ $1.

**Prompt:**
> Add per-wallet daily $ cap on AI calls.
>
> 1. New table or column: `wallet_budgets (wallet TEXT PRIMARY KEY, daily_ai_budget_usd NUMERIC NOT NULL DEFAULT 5.0)` and `wallet_ai_spend (wallet TEXT, day DATE, cost_usd NUMERIC, PRIMARY KEY (wallet, day))`.
> 2. In `agentConnector.js`: before calling NEAR AI, look up today's spend; if ≥ budget → 402 `{ error: "ai-budget-exceeded" }`.
> 3. After the AI response, estimate cost from token counts (use a simple `$/1k tokens` constant per model, doc'd in code) and `INSERT … ON CONFLICT DO UPDATE SET cost_usd = cost_usd + $1`.
> 4. Admin allowlist (from `admin_wallets`) gets a higher cap from `admin_wallets.daily_ai_budget_usd`, falls through to `wallet_budgets` for everyone else.
>
> Verify: set a test wallet's budget to $0.10. Burn it via `/api/research`. Confirm 402 on next call. Confirm `wallet_ai_spend` accumulates correctly.
>
> Operating principles: token-cost constant in code, not config. We can tune later. No multi-currency. No usage dashboards in this task.

---

### TASK 5.4 — Dead-code sweep
**Time:** 1400-1500
**Goal:** orphan components and dead UI chips gone.
**Files:** `src/components/HomePage.jsx`, `DashboardPage.jsx`, `EarnDashboard.jsx`, `IronClawSections.jsx`, `LaunchPage.jsx`, `TelegramOnboardingModal.jsx`, `TipModal.jsx`; `src/components/shell/AppShell.jsx`.
**Verify:** `npm run build` clean after each delete; bundle size drops; "+ Creation Panel"/"Deploys"/"?" chips gone.

**Prompt:**
> Delete orphan components from the old single-router era. For each candidate, first confirm zero importers via grep; if zero, delete and `npm run build`. If any importer exists, leave the file and report.
>
> Candidates:
> - `src/components/HomePage.jsx`
> - `src/components/DashboardPage.jsx`
> - `src/components/EarnDashboard.jsx`
> - `src/components/IronClawSections.jsx`
> - `src/components/LaunchPage.jsx`
> - `src/components/TelegramOnboardingModal.jsx`
> - `src/components/TipModal.jsx`
>
> Then in `src/components/shell/AppShell.jsx` around lines 790-792: remove the dead "+ Creation Panel", "Deploys", "?" bottom-bar chips.
>
> Replace `window.prompt()` SCAN at lines ~917-923 with a small inline modal (or remove the SCAN button if the feature isn't ready — defer the decision to product if unsure).
>
> Verify: `npm run build` succeeds. Bundle size in `out/` drops measurably.
>
> Operating principles: surgical. Do NOT refactor adjacent code. Mention any dead code I notice but didn't delete in chat output.

---

### TASK 5.5 — Polling → WebSocket for DM/notifications
**Time:** 1500-1700
**Goal:** drop the 30s `useEffect` polls; backend pushes via existing `feedHub`.
**Files:** `src/components/shell/AppShell.jsx` (around line 881), `backend/ws/feedHub.js`, `backend/routes/dm.route.js`, `backend/routes/notifications.route.js` (or wherever notifs live).
**Verify:** with browser network tab open and idle, no `/api/dm/poll` or `/api/notifications/unread` requests fire after page load. New DM in another browser → first browser updates within 1s via WS.
**Drop this task if Day 5 runs over.**

**Prompt:**
> Move the 30-second DM and notification polling onto the existing `/ws/feed` hub.
>
> 1. Find the polling `useEffect` blocks in `src/components/shell/AppShell.jsx` (around line 881). Remove them.
> 2. Subscribe to `dm:new` and `notification:new` events on the existing WS connection. Update local zustand stores on receipt.
> 3. On the backend, when DM or notification mutations occur (in `dm.route.js`, `posts.route.js`, etc.), publish via `feedHub.publish(targetWallet, event)`.
>
> Verify: open two browsers (different wallets). Send DM A→B. Browser B updates within 1s with no fetch in network tab. Idle Browser B for 5min — zero polling requests.
>
> Operating principles: do not redesign the WS protocol. Reuse the existing event shape. If `feedHub` doesn't have wallet-targeted publish, add the smallest possible method.

---

## DAY 6 — DB + frontend + secret re-audit

### TASK 6.1 — Indexes on hot routes
**Time:** 0800-1000
**Goal:** `EXPLAIN ANALYZE` on top 10 most-called queries shows index usage; p95 < 50ms in dev.
**Files:** new migration with `CREATE INDEX` statements.
**Verify:** for each hot query, before/after `EXPLAIN ANALYZE` snippets in commit message.

**Prompt:**
> Identify and index hot DB queries.
>
> 1. Add temporary query logging in `backend/db/client.js` (`log: ['error']` → `log: ['error','query']` behind a `DEBUG_QUERY=1` env). Run the smoke suite + manual flows for 10 minutes.
> 2. From logs, pick the top 10 most-called queries. For each, run `EXPLAIN ANALYZE` against a seeded dev DB.
> 3. Add the missing indexes (most likely: `posts (author_wallet, created_at DESC)`, `dm_messages (recipient_wallet, created_at DESC)`, `feed_items (created_at DESC)`, `auth_nonces (used_at) WHERE used_at IS NULL`, etc.). One migration file.
> 4. Re-run `EXPLAIN ANALYZE`. Confirm `Index Scan` replaces `Seq Scan` and rows-examined drops.
>
> Document before/after timings in the commit message.
>
> Verify: p95 of all 10 queries under 50ms on the dev DB.
>
> Operating principles: only indexes the data demands. No speculative indexes "just in case". Remove the `DEBUG_QUERY` flag at end.

---

### TASK 6.2 — Pool tuning + retry
**Time:** 1000-1100
**Goal:** Postgres pool can absorb a 1000-user spike without exhausting.
**Files:** `backend/db/client.js`.
**Verify:** synthetic 200 concurrent connections via `scripts/smoke-pool.js` succeed without `Connection terminated` errors.

**Prompt:**
> Tune the Postgres pool in `backend/db/client.js`.
>
> 1. Bump `max` from 10 → 30 (Render Postgres Starter supports ~97).
> 2. Add `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`.
> 3. On `'error'` event, log structured + don't crash the process.
> 4. Add a tiny `withRetry(fn)` helper that retries once on `'connection terminated unexpectedly'` only.
>
> Write `scripts/smoke-pool.js` that fires 200 parallel `SELECT 1` queries; assert all succeed in < 5s.
>
> Verify: smoke script passes. No `'unhandled error'` events in logs.
>
> Operating principles: do not introduce PgBouncer in this task — it's a week-2 item. Don't add a query builder. Pool tuning only.

---

### TASK 6.3 — Frontend bundle audit + clean build
**Time:** 1100-1230
**Goal:** `npm run build` produces zero warnings; bundle has no dead orphans; wallet-selector is tree-shaken sanely.
**Files:** wherever warnings point.
**Verify:** `npm run build` exits 0 with no warnings; total `out/_next/static/chunks/` size noted before/after.

**Prompt:**
> Run `npm run build` and resolve every warning. Common fixes: remove unused imports, fix React 19 hook deps, fix Next 16 `<Image>` usage, remove dynamic imports that don't need to be dynamic.
>
> Then audit bundle size: `ls -lh out/_next/static/chunks | sort -k5 -h | tail -20`. If `@near-wallet-selector/*` chunks dominate (>500KB total), check whether all 5 wallet adapters are actually shipped — if so, that's expected and acceptable for now. Document the sizes in the commit message.
>
> Verify: `npm run build` exits 0, zero warnings printed.
>
> Operating principles: surgical. Don't refactor file structure to fix warnings. Add the smallest fix per warning.

---

### TASK 6.4 — IronShield Pro decision
**Time:** 1330-1430
**Goal:** either implement minimal Pro tier or remove the CTA.
**Files:** `src/components/shell/AppShell.jsx` lines ~336-362.
**Verify:** no UI element references "Pro" unless the feature exists.

**Prompt:**
> Pro tier is being built on Day 18. For RC1, we need an interim state that doesn't 404.
>
> Edit `src/components/shell/AppShell.jsx:336-362`: change the upgrade card link from `/rewards` to `/rewards#pro`. Add a `<section id="pro">` to `src/app/rewards/page.js` with a "Pro tier launches with v1.0.0 (Day 21)" panel. No purchase flow yet.
>
> Verify: clicking the upgrade card scrolls to a real, non-empty section explaining Pro is coming. No broken links.
>
> Operating principles: smallest possible stub. Day 18 will replace this with the real flow — do not pre-design the tier matrix here.

---

### TASK 6.5 — Secret re-grep + .env.example sanity
**Time:** 1430-1530
**Goal:** zero NEXT_PUBLIC_* secrets, .env.example documents reality, CORS allowlist correct.
**Files:** `.env.example`, possibly `next.config.mjs`, audit only across the whole repo.
**Verify:** the grep checklist below all return zero matches in committed source (excluding deleted/historic refs in CHANGELOG).

**Prompt:**
> Run the secret re-audit checklist:
>
> 1. `grep -r "NEXT_PUBLIC_ADMIN" .` → 0 hits.
> 2. `grep -r "ironshield_admin" .` → 0 hits.
> 3. `grep -rE "NEXT_PUBLIC_.*(_KEY|_SECRET|_TOKEN|_PW)" .` → review every hit. None should be a real secret.
> 4. `grep -rE "(api[_-]?key|secret|token)\\s*[:=]\\s*['\"]([a-zA-Z0-9_-]{20,})['\"]" --include='*.{js,jsx,ts,tsx}' .` → review.
> 5. Open `.env.example`. Confirm every key documented matches a real consumer in code; remove orphans. Confirm no value leaks a real secret.
> 6. Open `next.config.mjs`. Confirm `output: "export"` and no embedded secrets.
> 7. Confirm `CORS_ALLOWED_ORIGINS` default in `.env.example` matches prod + Cloudflare preview pattern.
>
> Report findings in chat. Fix anything dangerous. Do not commit `.env.local` ever.

---

### TASK 6.6 — Day 6 deploy + smoke
**Time:** 1530-1700
**Goal:** all of Day 5+6 changes live on Render preview + Cloudflare preview.
**Verify:** smoke 1.6, 2.5, 3.5 all pass on the preview URLs.

**Prompt:**
> Deploy current commit to Render preview (3 services) and Cloudflare Pages preview. Re-run `scripts/smoke-day2.js`, `scripts/smoke-pool.js`, and a manual login + post + DM cycle. Report any regressions.

---

## DAY 7 — Load test + production cutover

### TASK 7.1 — Load smoke at 100 → 250 → 500 concurrent
**Time:** 0800-1030
**Goal:** identify the breakpoint and tune limits before prod.
**Files:** `scripts/load.js` (k6 or `oha`).
**Verify:** at 250 concurrent, p95 < 500ms across read endpoints, error rate < 0.5%.

**Prompt:**
> Write a k6 load script (`scripts/load.k6.js`) with workload mix:
> - 70% reads (`/api/feed`, `/api/posts/recent`, `/api/agents/list`)
> - 20% mutations (`/api/posts` create, `/api/dm` send) — must use signed-auth; pre-issue 50 test wallets with funded keys for the test
> - 10% AI calls (`/api/research`, `/api/summary`)
>
> Stages: ramp 0→100 over 1m, hold 3m. Repeat at 250 and 500.
>
> Run against Render preview backend (NOT prod). Capture p50/p95/p99, error breakdown, AI-budget rejections.
>
> Verify: at 250, p95 < 500ms reads, < 1.5s mutations; error rate < 0.5%. At 500, document the bottleneck (likely DB pool or AI rate limit).
>
> Operating principles: don't over-engineer the test. One file, one workload mix, three stages.

---

### TASK 7.2 — Tune rate limits + pool from results
**Time:** 1030-1130
**Goal:** adjust limits so 500 concurrent users (not all AI-active) stay green.
**Files:** `backend/services/rateLimiter.js` config, `backend/db/client.js` if pool maxed.
**Verify:** re-run load at 500; p95 reads < 500ms, error rate < 1%.

**Prompt:**
> Based on Task 7.1 numbers, tune the smallest possible knobs:
> - If DB pool was the bottleneck, bump `max` (cap at 60 for Render Starter Postgres).
> - If AI 429s dominated mutation errors, lower the AI per-wallet limit further (load tests don't represent real-user behavior).
> - If mutation latency was DB-bound, double-check Task 6.1 indexes covered the hot mutation paths.
>
> Re-run k6 at 500. Document numbers in commit message.
>
> Operating principles: tune values, don't redesign. If the bottleneck is architectural (e.g., needs PgBouncer or a queue), document and defer to week 2 — do not implement here.

---

### TASK 7.3 — Production cutover
**Time:** 1130-1330
**Goal:** prod is on the v1 commit across contract, backend, frontend.
**Files:** none (deploy operations).
**Verify:** prod URL works end-to-end: connect wallet (mainnet), see real data, no 5xx in 30 min of monitoring.

**Prompt:**
> Production deployment. Stop and ask before each step if anything looks anomalous.
>
> 1. **Contract:** if any contract changes in this sprint, rebuild via `cargo near build non-reproducible-wasm --no-abi` and `near deploy ironshield.near target/near/ironshield.wasm`. If state layout changed, run `near call ironshield.near migrate '{}' --accountId ironshield.near`. If no changes, skip.
> 2. **Backend (3 services):** for each Render service ID, `POST /v1/services/<id>/deploys` with `{commitId: "<v1-sha>"}`. Watch logs for 5 min each. Use the existing manual deploy convention (per memory).
> 3. **Frontend:** `npm run build && wrangler pages deploy out --project-name=ironshield --branch=main`. Switch frontend env to mainnet (`NEXT_PUBLIC_NETWORK_ID=mainnet`) — confirm Cloudflare env vars before deploy.
> 4. **DNS / domain:** confirm prod domain points to the new Cloudflare deployment.
>
> Verify: hit prod URL, connect wallet, see real data. Watch backend logs and Sentry for 30 min — zero unhandled errors.
>
> Operating principles: pinned commit deploys, no destructive steps without confirmation. If a step fails, ROLLBACK by re-pinning the previous commit. Don't try to fix forward in production.

---

### TASK 7.4 — Tag v0.9.0 + write runbook
**Time:** 1330-1530
**Goal:** future-you (or another engineer) can roll back, debug, and on-call without reading source.
**Files:** new `docs/runbook.md`, git tag.
**Verify:** runbook covers rollback, on-call paging, env-var checklist, common error → action.

**Prompt:**
> Write `docs/runbook.md` covering:
>
> 1. **Architecture diagram** (ASCII): frontend → backend → contract; backend services (web, governance, bot); DB; NEAR AI.
> 2. **Service registry**: each Render service ID, what it runs, what env vars it needs, log link.
> 3. **Deploy commands**: frontend (wrangler), backend (curl Render API), contract (cargo near).
> 4. **Rollback procedure**: re-pin previous commit per service. Document the previous-known-good commit SHA at v0.9.0 cutover.
> 5. **On-call decision tree**: "5xx spike?" → check pool/Sentry; "AI cost spike?" → check rate limiter + per-wallet caps; "governance not updating?" → check governance worker logs + AGENT_ACCOUNT_ID; "TG bot dead?" → check webhook secret + setWebhook.
> 6. **Env var checklist** (full list, per service).
> 7. **Known week-2 backlog** (what's still TODO).
>
> Then `git tag v0.9.0 && git push --tags`.
>
> Verify: hand the runbook to another engineer (or fresh Claude session). They can answer "how do I roll back the backend?" and "how do I add a new admin wallet?" with no other context.

---

### TASK 7.5 — Update CLAUDE.md to current state + handoff
**Time:** 1530-1700
**Goal:** the next engineer reads CLAUDE.md and has a current map.
**Files:** `CLAUDE.md`, this `SPRINT_PLAN.md`.
**Verify:** every claim in CLAUDE.md is verifiable by current code.

**Prompt:**
> Update `CLAUDE.md`:
> 1. Replace the "4-Day Sprint Plan" section with a "What we just shipped (v0.9.0)" section.
> 2. Replace "Current Audit Findings (open)" with "v0.9.0 known limitations" (only the ones still open: skill purchase on-chain, IronShield Pro, LiveKit prod, PgBouncer, Playwright, bridge production proof).
> 3. Confirm every file path mentioned still exists.
> 4. Confirm every command works.
>
> Then mark this `SPRINT_PLAN.md` as "**STATUS: shipped 2026-XX-XX**" at the top and link it from CLAUDE.md as historical context.
>
> Verify: a fresh engineer reads only `CLAUDE.md` and `docs/runbook.md` and can spin up the dev environment + deploy a contract change.

---

## DAY 8 — DMs E2E crypto + UX polish

### TASK 8.1 — Audit dmCrypto for correctness
**Time:** 0800-1000
**Goal:** verify the existing E2E crypto is sound; fix anything dangerous.
**Files:** `src/lib/dmCrypto.js`, `backend/routes/dm.route.js`.
**Verify:** `docs/dm-crypto-review.md` lists every primitive, key derivation, nonce policy, and a verdict per item.

**Prompt:**
> Audit the existing DM E2E crypto implementation in `src/lib/dmCrypto.js` and any server-side counterpart in `backend/routes/dm.route.js` (and `backend/services/` if relevant). Write `docs/dm-crypto-review.md` covering:
> 1. What asymmetric/symmetric primitives are used (curve, cipher, KDF). Are they library-vetted (libsodium, WebCrypto) or hand-rolled?
> 2. Where do per-user keys come from? Wallet-derived or independently generated? Where stored?
> 3. Nonce/IV policy for each ciphertext. Random or counter? Reuse risk?
> 4. Forward secrecy? Any ratchet or just static keys?
> 5. Server's view: does the server ever see plaintext? Does it store ciphertext + metadata?
>
> For each finding, mark **OK / WEAK / BROKEN**. Anything BROKEN → fix in the same task with the smallest possible change. WEAK items get tickets but don't block.
>
> Operating principles: don't refactor working crypto. Don't introduce a new library if WebCrypto already covers it. Cite line numbers.

---

### TASK 8.2 — Read receipts + delivery state
**Time:** 1000-1200
**Goal:** sender sees "sent / delivered / read" per message.
**Files:** schema migration adding `dm_messages.delivered_at`, `read_at`; backend mutation when recipient opens thread; WS push of state changes; UI ticks in DM thread component.
**Verify:** sender sees state transition within 1s of recipient action.

**Prompt:**
> Add read-receipt and delivery state to DMs.
>
> 1. Migration: `ALTER TABLE dm_messages ADD COLUMN delivered_at TIMESTAMPTZ, ADD COLUMN read_at TIMESTAMPTZ`.
> 2. Backend: when WS pushes a new DM to recipient → set `delivered_at = NOW()` and emit `dm:state` event back to sender. When recipient opens the thread (POST `/api/dm/:threadId/read`) → set `read_at = NOW()` for all unread messages and emit `dm:state`.
> 3. Frontend: subscribe to `dm:state` via the existing `feedHub` connection. Render single-tick (sent), double-tick (delivered), filled double-tick (read).
>
> Verify: open two browsers as different wallets. Send DM A→B. A sees "sent" immediately, "delivered" within 1s, "read" within 1s of B opening the thread.
>
> Operating principles: reuse existing WS hub. No new tables. No new routes beyond the read-mark endpoint.

---

### TASK 8.3 — Key rotation handling
**Time:** 1300-1500
**Goal:** when a wallet adds/removes an access key, DM crypto handles it without losing history.
**Files:** `src/lib/dmCrypto.js`, possibly schema for key fingerprint per ciphertext.
**Verify:** rotate keys mid-conversation; old messages still decrypt; new messages use new key.

**Prompt:**
> Today the DM crypto likely uses a single static key per wallet. When the wallet rotates keys (NEAR allows multiple access keys + revocation), the system must:
> 1. Tag every ciphertext with the public-key fingerprint that encrypted it.
> 2. On decrypt, locate the matching private key (or derive it). If unavailable, render "[encrypted with rotated key]" placeholder.
> 3. New messages always use the wallet's current default key.
>
> Migration if needed: `ALTER TABLE dm_messages ADD COLUMN sender_key_fp TEXT, recipient_key_fp TEXT`.
>
> Verify: connect with two access keys, send a message with key A active. Switch to key B (key A still authorized). Old messages decrypt, new use B. Revoke key A on chain. Old messages from A render the placeholder gracefully.
>
> Operating principles: don't build a key-management UI today (Day 18 may add one). Just don't crash on rotation.

---

### TASK 8.4 — DM media attachments
**Time:** 1500-1630
**Goal:** users can attach images to DMs using the hardened media route from Day 5.1.
**Files:** `src/components/messages/*` (DM composer), `backend/routes/dm.route.js`.
**Verify:** attach image → recipient sees image inline; size/MIME limits enforced.

**Prompt:**
> Wire image attachments into the DM composer.
> 1. Composer: file picker → upload via `apiFetch("/api/media", { method: "POST", body: formData })` (already hardened on Day 5.1). Receive `{url, fp}`.
> 2. Encrypt the URL + fingerprint as part of the message body (image stays at unencrypted URL — document in `docs/dm-crypto-review.md` that media is metadata-only encrypted; full image encryption is v1.1).
> 3. Render: if message body parses as `{ url, mime }`, render `<img src={url}>` inline.
>
> Verify: attach a PNG, send to recipient, recipient sees image. Try .exe → 415 from Day 5.1. Try 6MB → 413.
>
> Operating principles: do not encrypt the image bytes themselves in this task — track as v1.1 in `docs/dm-crypto-review.md`. Surgical UI changes only.

---

### TASK 8.5 — Day 8 smoke
**Time:** 1630-1700
**Prompt:**
> Smoke: send DM with image both directions, mark read, rotate keys mid-conversation. Confirm UI states match expected. Deploy to Render preview.

---

## DAY 9 — Telegram bot feature parity

### TASK 9.1 — TG ↔ wallet account linking
**Time:** 0800-1000
**Goal:** users can bind their Telegram account to a NEAR wallet via signed challenge.
**Files:** `bot/handlers/link.js`, `backend/routes/tg.route.js`, schema `tg_links`.
**Verify:** `/link` in TG → bot returns a one-time URL → user signs in browser → TG account linked in DB.

**Prompt:**
> Build the TG ↔ wallet linking flow.
> 1. Schema: `tg_links (tg_user_id BIGINT PRIMARY KEY, wallet TEXT NOT NULL, linked_at TIMESTAMPTZ, challenge TEXT, challenge_expires_at TIMESTAMPTZ)`.
> 2. `/link` command in bot → generate 256-bit challenge, save with 10-min expiry, reply with link `https://ironshield.pages.dev/link?challenge=<>&tg=<user_id>`.
> 3. Frontend `/link` page: connect wallet, sign the challenge (reuse `signRequest` from Day 1.3), POST to `/api/tg/link`. Backend verifies challenge + sig, sets `wallet`, deletes challenge.
> 4. `/whoami` command → reply with linked wallet or "not linked".
>
> Verify: full round-trip works. Replay of challenge fails. Expired challenge fails.
>
> Operating principles: one new route, one schema change, two commands. Do not build a multi-wallet linking flow.

---

### TASK 9.2 — `/portfolio` command
**Time:** 1000-1100
**Goal:** TG user with linked wallet sees portfolio summary.
**Files:** `bot/handlers/portfolio.js`.
**Verify:** `/portfolio` → reply with NEAR + token balances + total USD.

**Prompt:**
> Implement `/portfolio` TG command.
> 1. Look up `tg_links` for `wallet`. If none → "Run /link first".
> 2. Call existing backend `/api/portfolio?wallet=<>` (which already aggregates balances).
> 3. Render in TG markdown: `*Portfolio for `wallet`*\n` then per-token rows.
>
> Verify: linked wallet returns real balances. Unlinked → friendly error. Error from backend → "Portfolio temporarily unavailable, try again."
>
> Operating principles: thin wrapper over existing backend route. No new computation in the bot.

---

### TASK 9.3 — `/alerts` command
**Time:** 1100-1230
**Goal:** TG users can list/create/delete price alerts from chat.
**Files:** `bot/handlers/alerts.js`, schema `alerts` if not present.
**Verify:** `/alerts` lists current; `/alert near>5` creates; `/alert delete <id>` removes; alert fires via existing `alertTrigger.job.js`.

**Prompt:**
> Implement `/alerts`, `/alert <expr>`, `/alert delete <id>` commands.
> 1. Reuse existing `alerts` table (check `backend/db/schema.sql`); add it if missing.
> 2. Parse expressions like `near>5`, `eth<2000`, `ironclaw>0.10` (token symbol, comparator, threshold).
> 3. `alertTrigger.job.js` (already runs `*/5 * * * *`) checks each alert; if triggered, look up `tg_user_id` from `tg_links` for `wallet` and DM the user.
>
> Verify: create alert via TG, manually update price to trigger, receive DM within 5 min. Delete alert via TG, confirm not in `/alerts` list.
>
> Operating principles: do not redesign the alerts engine. Just expose CRUD via TG and ensure the trigger pipeline routes to TG when the wallet is linked.

---

### TASK 9.4 — `/vote` command
**Time:** 1330-1500
**Goal:** TG user can list active proposals and cast a vote.
**Files:** `bot/handlers/vote.js`.
**Verify:** `/vote` shows top 5 active proposals with inline keyboard "Yes / No / Abstain"; tap → on-chain vote tx submitted.

**Prompt:**
> Implement `/vote` TG command.
> 1. Call backend (or contract view directly) for active proposals.
> 2. Render top 5 with inline keyboard (Telegram inline buttons): Yes / No / Abstain per proposal.
> 3. On button tap: build the `vote` tx with the linked wallet. Sign requires the user's wallet — use a deeplink to `https://ironshield.pages.dev/vote?proposal=<id>&choice=<>` which signs in browser. Bot DMs back the tx hash on success.
>
> Verify: full round-trip on testnet. Unlinked user → "Run /link first". Empty proposals → "No active votes".
>
> Operating principles: bot does not hold private keys. Voting always goes through the user's wallet via the frontend deeplink. Do not embed private keys in the bot.

---

### TASK 9.5 — `/digest` daily AI summary
**Time:** 1500-1630
**Goal:** users opt in to a daily AI-generated portfolio + governance + market digest.
**Files:** `bot/handlers/digest.js`, `jobs/dailySummary.job.js` (extend), schema `tg_links.digest_opt_in BOOLEAN`.
**Verify:** opt in via `/digest on`; receive a real digest at 0800 next day; token cost charged to wallet AI budget.

**Prompt:**
> Implement opt-in daily digest.
> 1. Migration: `ALTER TABLE tg_links ADD COLUMN digest_opt_in BOOLEAN DEFAULT false, digest_time TEXT DEFAULT '08:00'`.
> 2. `/digest on|off` command toggles `digest_opt_in`.
> 3. Extend `jobs/dailySummary.job.js`: for each opted-in wallet, build context (portfolio snapshot + active votes + tracked tokens), call `agentConnector.generate(context)` (reuses Day 5.3 budget cap), DM the user.
>
> Verify: opt in via TG, manually invoke the cron, receive digest. Token cost shows in `wallet_ai_spend` table.
>
> Operating principles: reuse the existing cron, the existing AI connector, the existing budget cap. Just add the per-wallet loop.

---

### TASK 9.6 — Day 9 smoke + deploy
**Time:** 1630-1700
**Prompt:**
> Smoke all 5 commands end-to-end on the bot worker. Deploy to Render. Update `docs/runbook.md` with TG command list.

---

## DAY 10 — NewsCoin completion

### TASK 10.1 — Token launch detection backend
**Time:** 0800-1030
**Goal:** the scanner that powers NewsCoin actually surfaces new launches.
**Files:** `backend/services/newscoinScanner.js` (or wherever the partial scanner lives), `backend/routes/newscoin.route.js`.
**Verify:** after 30 min of scanner runtime, `newscoin_tokens` table has ≥10 fresh launches with risk-flag fields populated.

**Prompt:**
> Complete the NewsCoin token launch scanner.
> 1. Identify the existing scanner: search `backend/services/newscoinScanner.js`, `backend/routes/newscoin.route.js`, and `jobs/`. If only stubs exist, build the smallest real scanner: poll Pump.fun (or whatever source already has partial wiring) every 60s, dedupe by mint address, insert new rows into `newscoin_tokens`.
> 2. Per token, fetch basic risk fields: dev allocation %, LP locked?, contract verified? Use whatever APIs are already imported (don't add new ones unless required).
> 3. The 3 TODO/mock sites in `backend/routes/newscoin.route.js` (flagged in audit) — implement now using the new scanner data.
>
> Verify: after 30 min, `SELECT count(*) FROM newscoin_tokens WHERE created_at > NOW() - INTERVAL '30 min'` ≥ 10. Each row has non-null risk fields.
>
> Operating principles: minimum scanner. No ML, no scoring rubric beyond what the data already supports. If a risk field can't be computed cheaply, leave it null and skip in UI.

---

### TASK 10.2 — Terminal feed UI completion
**Time:** 1030-1230
**Goal:** the NewsCoin terminal page renders live feed with risk badges.
**Files:** `src/app/newscoin/page.js`, related components.
**Verify:** open `/newscoin`; new tokens appear within 60s of detection (via WS push).

**Prompt:**
> Complete the NewsCoin terminal UI.
> 1. Subscribe to `newscoin:new` event via existing WS (publish on backend insert from Task 10.1).
> 2. Render token rows with: ticker, age, MC, dev %, risk badge (green/yellow/red).
> 3. Click row → open existing token detail page (`/newscoin?token=<mint>`).
> 4. Remove the "Coming soon" gate added in Task 5.2 for paths now functional.
>
> Verify: live feed updates without refresh. Risk badge logic visible (yellow if dev > 5%, red if > 10% or LP unlocked, else green).
>
> Operating principles: no charting library. No animations. Surgical changes — leave the page layout from earlier sprint commits intact.

---

### TASK 10.3 — Buy flow wired to existing DEX
**Time:** 1330-1530
**Goal:** click "Buy" on a NewsCoin token → trade executes via existing trading route.
**Files:** `src/app/newscoin/page.js` (buy button), reuse `backend/routes/trading.route.js`.
**Verify:** test buy with $0.10 worth on devnet completes; tx hash returned and shown.

**Prompt:**
> Wire the NewsCoin buy button to the existing trading infrastructure (Jupiter SDK is already in `package.json`, used in `trading.route.js`).
> 1. Buy button → modal with amount input + slippage default 1%.
> 2. Submit → POST signed `/api/trading/swap { from: "USDC", to: <mint>, amount }`.
> 3. Backend route returns tx hash + final price. UI renders success toast with tx link.
> 4. On failure (slippage exceeded, insufficient funds): show actionable error.
>
> Verify: $0.10 test trade on devnet. Real-network test only after Day 11 trading hardening.
>
> Operating principles: thin UI on top of existing trading route. No new SDK. No new pricing logic.

---

### TASK 10.4 — Honeypot/risk pre-trade check
**Time:** 1530-1630
**Goal:** block buys on tokens flagged as honeypots.
**Files:** `backend/routes/trading.route.js`.
**Verify:** attempting to buy a known-honeypot test token returns 422 with reason.

**Prompt:**
> Add a pre-trade honeypot check.
> 1. Before executing a swap to a NewsCoin token, look up the token in `newscoin_tokens`. If `risk_flags` contains `honeypot` or `lp_unlocked`, return 422 `{ error: "risk-blocked", flags }` unless request has `confirmRisk: true` body field.
> 2. UI: show a confirmation modal "This token is flagged: <flags>. Continue at your own risk?" → resubmits with `confirmRisk: true`.
>
> Verify: known honeypot mint → blocked first try; second try with confirm proceeds.
>
> Operating principles: do not write a honeypot detector here — rely on whatever the Day 10.1 scanner produces. Just enforce the gate.

---

### TASK 10.5 — Day 10 smoke
**Time:** 1630-1700
**Prompt:**
> Smoke: terminal renders live, buy round-trips, honeypot blocks. Deploy to Render preview.

---

## DAY 11 — Trading flows hardening

### TASK 11.1 — Slippage controls + quote refresh
**Time:** 0800-1000
**Goal:** every swap UI has settable slippage, auto-refreshes quotes when stale.
**Files:** `src/components/trading/*`, `backend/routes/trading.route.js`.
**Verify:** quote shown for >10s shows "stale" warning; submitting stale quote re-quotes server-side.

**Prompt:**
> Audit every swap UI surface (NewsCoin buy, manual swap, any portfolio rebalance). For each:
> 1. Add slippage input (presets 0.5/1/3/custom%, default 1%).
> 2. After 10s without execution, badge the quote "Stale — refresh".
> 3. Backend `/api/trading/swap` always re-quotes server-side before executing; if delta from client quote > 0.5%, return 409 `{ error: "quote-stale", newQuote }` and let UI re-confirm.
>
> Verify: get quote, wait 11s → "Stale" badge. Submit anyway → 409 + new quote shown.
>
> Operating principles: one slippage component reused. No re-quote loop on the client (server is source of truth).

---

### TASK 11.2 — Failure recovery + partial fills
**Time:** 1000-1200
**Goal:** failed/partial swaps surface real status; user funds never silently lost.
**Files:** `backend/routes/trading.route.js`, `backend/services/tradingMonitor.js` (new if needed).
**Verify:** simulated partial-fill test → UI shows "Partial: 30% filled, 70% refunded"; tx hashes for both.

**Prompt:**
> Harden trading failure paths.
> 1. After swap submission, poll the tx (Solana: `getSignatureStatus`; NEAR: `tx`) until finalized or timeout (30s).
> 2. On finalized: parse log for actual `amountIn` / `amountOut`. If `amountIn < requested`, mark partial, fire any refund tx if the DEX needs explicit refund.
> 3. Persist to `trades` table: `wallet, status, requested_amount, filled_amount, tx_hash, refund_tx_hash, error`.
> 4. UI: render statuses (pending → filled → partial → refunded → failed) with tx links.
>
> Verify: simulated partial fill (use a tiny LP with known low liquidity for the test) → status transitions correctly.
>
> Operating principles: no retry on failed swaps — that's a v1.1 feature. Just observe and report accurately.

---

### TASK 11.3 — Trade history persistence + UI
**Time:** 1300-1500
**Goal:** users see all past trades with filterable status.
**Files:** schema `trades` table (extend if needed), `src/app/portfolio/trades/page.js` (new).
**Verify:** make 3 trades; trades page shows them in reverse-chrono with statuses.

**Prompt:**
> Build trade history.
> 1. Schema (extend or create): `trades (id BIGSERIAL PK, wallet TEXT, dex TEXT, from_mint TEXT, to_mint TEXT, requested_in NUMERIC, filled_in NUMERIC, filled_out NUMERIC, status TEXT, tx_hash TEXT, refund_tx_hash TEXT, created_at TIMESTAMPTZ)`.
> 2. Backend: every swap persists; include `GET /api/trading/history?wallet=<>` (signed-auth required, server enforces `req.wallet === wallet` per Day 1).
> 3. Frontend: `/portfolio/trades` page; table, filter by status, link tx hashes.
>
> Verify: 3 trades on testnet → all shown with correct statuses + tx links.
>
> Operating principles: one table, one route, one page. No CSV export, no analytics.

---

### TASK 11.4 — Day 11 smoke + deploy
**Time:** 1500-1700
**Prompt:**
> Run k6 small load (50 concurrent) hitting trade quote + history endpoints. Confirm p95 < 300ms. Deploy to Render preview.

---

## DAY 12 — Automations execution polish

### TASK 12.1 — Time-based triggers via cron
**Time:** 0800-1000
**Goal:** "every Mon 9am" triggers fire on schedule.
**Files:** `backend/services/automationExecutor.js`, `jobs/automationCron.job.js` (new if not present).
**Verify:** create automation with `schedule: "0 9 * * 1"`; it executes at next Monday 9am UTC (or override `NOW` for test).

**Prompt:**
> Wire time-based automations.
> 1. New `jobs/automationCron.job.js` (or extend existing). Every minute, query `automations WHERE type='time' AND next_run <= NOW()`; for each, enqueue execution via `automationExecutor.run(automationId)` and update `next_run` from cron expr.
> 2. Use `cron-parser` (already a transitive dep via `node-cron`?) to compute `next_run`.
>
> Verify: create automation `{ type: "time", schedule: "* * * * *", action: { kind: "log", msg: "ping" } }`. Confirm it logs once per minute.
>
> Operating principles: reuse existing cron infrastructure. Don't introduce a job queue (BullMQ etc) — sequential execution per minute is fine for v1.

---

### TASK 12.2 — Event-based triggers via WS/webhook
**Time:** 1000-1130
**Goal:** "when proposal X passes" or "when token Y > $5" triggers fire.
**Files:** `backend/services/automationExecutor.js`, `backend/services/eventBus.js` (new lightweight pub/sub).
**Verify:** automation `{ type: "event", on: "proposal.executed", filter: {...} }` fires when matching event published.

**Prompt:**
> Add event-driven automations.
> 1. New `backend/services/eventBus.js` — in-memory `emit(event, payload)` / `on(event, handler)`. (For multi-process later, swap to Postgres LISTEN/NOTIFY — track as v1.1 in `docs/runbook.md`).
> 2. Hook existing publishers: `governanceListener` emits `proposal.executed`; `alertTrigger.job` emits `price.alert`; `dm.route.js` emits `dm.received`.
> 3. On boot, `automationExecutor` subscribes for each `automations.type='event'` row; on event match (filter satisfied), runs the action.
>
> Verify: create automation `{ type: "event", on: "price.alert", filter: { token: "NEAR", op: ">", val: 5 }, action: { kind: "tg.dm", msg: "NEAR > $5" } }`. Manually emit via test endpoint. DM arrives.
>
> Operating principles: in-memory bus is fine for week 2 v0.95 — single web service consumes its own events. Multi-instance buses are a v1.1 problem.

---

### TASK 12.3 — AI-evaluated triggers
**Time:** 1230-1400
**Goal:** "when a tweet from @whale mentions a token I hold, alert me" — LLM evaluates the condition.
**Files:** `backend/services/automationExecutor.js`.
**Verify:** ai-trigger automation reduces wallet AI budget on each evaluation.

**Prompt:**
> Add AI-evaluated triggers.
> 1. Automation `{ type: "ai", source: "<feed-name>", prompt: "Does this item match: <user prompt>?", action: {...} }`.
> 2. Source feeds: pull recent items (last 5 min) from xfeed, rss feeds, etc. — whatever is already wired.
> 3. For each item, call `agentConnector.classify(prompt + item)` returning `{ match: bool, reason: string }`. Use the cheapest configured model.
> 4. Charge cost to wallet's `wallet_ai_spend` (Day 5.3 cap applies).
>
> Verify: create AI trigger; emit a synthetic feed item that should match; action fires; spend recorded.
>
> Operating principles: rate-limit AI triggers to 1 evaluation per item per automation. Do not loop. If wallet budget exhausted, skip silently and log.

---

### TASK 12.4 — Per-wallet automation quota + dry-run
**Time:** 1400-1530
**Goal:** users limited to N automations; can preview what an automation would do without firing.
**Files:** `backend/routes/automations.route.js`, schema if needed.
**Verify:** 11th automation creation → 429; dry-run returns simulated action result without side effect.

**Prompt:**
> 1. Quota: max 10 automations per wallet (admin allowlist gets 100). Enforce in POST `/api/automations`. 11th → 429.
> 2. Dry-run: POST `/api/automations/:id/dry-run` returns what would execute (action kind, payload, predicted AI cost) without firing the action.
>
> Verify: hit the quota → 429. Dry-run a TG DM action → returns the rendered message without sending.
>
> Operating principles: quota in code constant, not config table. Day 18 Pro tier can override.

---

### TASK 12.5 — Day 12 smoke + deploy
**Time:** 1530-1700
**Prompt:**
> Create one automation per type (time/event/ai). Confirm each fires correctly. Deploy.

---

## DAY 13 — Rooms feature complete (managed LiveKit dev tier)

### TASK 13.1 — LiveKit dev tier setup
**Time:** 0800-0930
**Goal:** real LiveKit dev project with creds; backend issues join tokens.
**Files:** `backend/routes/livekit.route.js`, `.env.example`.
**Verify:** `POST /api/livekit/token { roomId }` returns valid LiveKit JWT; client connects successfully.

**Prompt:**
> Provision LiveKit dev tier.
> 1. Create LiveKit Cloud free dev project (manual). Save `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` as Render env vars.
> 2. Backend: in `livekit.route.js`, replace any 5 mock sites with real implementations using `livekit-server-sdk` (`AccessToken` builder).
> 3. `POST /api/livekit/token` (signed-auth) → issues a token bound to `req.wallet` as identity, room from request body.
>
> Verify: real LiveKit JWT validates against `LIVEKIT_URL`. Frontend `Room.connect()` succeeds.
>
> Operating principles: dev tier only — we'll move to production tier on Day 19. Don't build recording, don't build moderation server.

---

### TASK 13.2 — Create/join room flow
**Time:** 0930-1130
**Goal:** any user can create a room and others can join via link.
**Files:** `src/app/rooms/page.js`, `src/app/rooms/[id]/page.js`, `backend/routes/rooms.route.js`.
**Verify:** A creates room → gets shareable link → B opens link → both see each other in the room.

**Prompt:**
> 1. Schema: `rooms (id TEXT PK, owner_wallet TEXT, title TEXT, created_at TIMESTAMPTZ, ended_at TIMESTAMPTZ NULL, max_participants INT DEFAULT 16)`.
> 2. POST `/api/rooms` → creates row, returns `{ id, joinUrl }`.
> 3. GET `/api/rooms/:id` → returns metadata.
> 4. Frontend `/rooms/[id]` → fetch metadata, request LiveKit token, connect.
>
> Verify: end-to-end with two browser windows.
>
> Operating principles: max participants enforced by LiveKit room config, not app code. Don't build a room-listing page beyond what already exists.

---

### TASK 13.3 — Room chat persistence
**Time:** 1130-1300
**Goal:** in-room chat survives reconnects and is replayable for late joiners.
**Files:** `backend/routes/rooms.route.js`, schema `room_messages`.
**Verify:** A says "hi", disconnects, reconnects → still sees "hi". B joins late → sees "hi" in scrollback.

**Prompt:**
> 1. Schema: `room_messages (id BIGSERIAL PK, room_id TEXT, sender_wallet TEXT, body TEXT, created_at TIMESTAMPTZ)`.
> 2. WS event `room:msg` (over the existing `feedHub`, scoped by `room:<id>`) on send → persist + fan out.
> 3. On join, replay last 50 messages.
>
> Verify per above.
>
> Operating principles: text only. No emoji reactions. No threads.

---

### TASK 13.4 — Mod actions (mute/kick) + recording metadata
**Time:** 1330-1500
**Goal:** room owner can mute/kick; recording-on flag persists in metadata (no actual recording yet — Day 19).
**Files:** `backend/routes/rooms.route.js`.
**Verify:** owner mutes B → B's audio track stops; owner kicks B → B disconnected; toggle "Record" → metadata flag set, future Day 19 work picks it up.

**Prompt:**
> 1. POST `/api/rooms/:id/mute { wallet }` (signed-auth, owner-only) → call LiveKit RoomService `mutePublishedTrack`.
> 2. POST `/api/rooms/:id/kick { wallet }` (signed, owner-only) → `removeParticipant`.
> 3. POST `/api/rooms/:id/recording { on }` → updates `rooms.recording_requested BOOLEAN`. Day 19 will read this flag and start actual recording.
>
> Verify: mute/kick work end-to-end. Recording flag persists; rendered as "Recording: requested" badge in UI.
>
> Operating principles: thin wrappers over LiveKit server SDK. No mod-log persistence in this task.

---

### TASK 13.5 — Day 13 smoke
**Time:** 1500-1700
**Prompt:**
> Three-browser test: A creates, B joins, C joins late, A mutes B, A toggles record, A kicks C. Confirm everything. Deploy.

---

## DAY 14 — Bridge testnet proof + v0.95.0-beta cutover

### TASK 14.1 — Pick + test one bridge route end-to-end
**Time:** 0800-1130
**Goal:** one canonical route works on testnet (NEAR ↔ ETH Sepolia via Rainbow Bridge or similar).
**Files:** `backend/routes/bridge.route.js`, `src/components/bridge/*`.
**Verify:** transfer 0.01 testnet asset → arrives at destination chain within published window.

**Prompt:**
> Identify which bridge SDK / partner is already integrated (Rainbow Bridge? Wormhole? Allbridge?). Pick the one with the most existing wiring. Make exactly one route work end-to-end on testnet:
> 1. Backend: `/api/bridge/quote` and `/api/bridge/initiate` real (not mock).
> 2. Frontend: bridge UI submits → polls status → shows destination tx hash on completion.
> 3. Document the route in `docs/bridge-routes.md` with exact contract addresses, est. completion time, fee structure.
>
> Verify: 0.01 testnet asset round-trips. Status updates reflect reality.
>
> Operating principles: do NOT add a second route. v1.0 ships one verified route + a "More routes coming" panel.

---

### TASK 14.2 — Bridge UI hardening
**Time:** 1130-1300
**Goal:** failure modes (relayer down, dest chain congestion) surface cleanly.
**Files:** `src/components/bridge/*`.
**Verify:** simulate relayer-down → UI shows "Bridge temporarily unavailable: <reason>".

**Prompt:**
> Audit bridge UI for unhandled error states. For each:
> - Quote endpoint 5xx → "Pricing temporarily unavailable, try again."
> - Initiate succeeds but status polling fails → "Transfer in progress; track at <explorer link>."
> - Status returns "stuck" → "Bridge is congested, ETA <X> min, do not retry."
>
> Verify: each simulated by mocking the SDK responses.
>
> Operating principles: defensive UI. No automatic retries. User decides.

---

### TASK 14.3 — v0.95.0-beta cutover
**Time:** 1330-1530
**Goal:** mainnet cutover with feature-complete beta.
**Files:** none (deploy ops).
**Verify:** prod URL works, beta tag visible.

**Prompt:**
> Same protocol as Task 7.3 production cutover, but tag `v0.95.0-beta` instead of `v1.0.0`. Add a "Beta" badge in the UI header. Update `docs/runbook.md` with the beta cutover entry.

---

### TASK 14.4 — Beta announcement prep
**Time:** 1530-1700
**Goal:** copy + screenshots ready for an internal/closed-beta invite.
**Files:** `docs/beta-announce.md`.
**Verify:** doc has feature list, known limitations, feedback channel, beta-test wallet onboarding steps.

**Prompt:**
> Write `docs/beta-announce.md`: 1-page beta announcement. Sections: What works, What's coming, How to test, Where to file bugs (link a GitHub issue template). Include 5 screenshots of new flows.
>
> No code changes. Don't actually publish — that's a product decision.

---

## DAY 15 — Skill purchase frontend wiring

### TASK 15.1 — Make `purchase_skill` payable on contract
**Time:** 0800-1030
**Goal:** contract has a payable `purchase_skill(skill_id)` that splits payment to creator + treasury.
**Files:** `contract/src/agents.rs` (or new `skills_marketplace.rs`).
**Verify:** unit test in Rust passes: caller deposits N yoctoNEAR; creator receives `N * 0.85`, treasury `N * 0.15`; skill marked installed for caller's agent.

**Prompt:**
> Add `purchase_skill(skill_id: SkillId)` to the contract. Constraints:
> - Must be `#[payable]`.
> - Payment must equal the skill's `price` (read from existing skill struct).
> - 85% goes to `skill.creator`, 15% to `treasury_account` (config).
> - On success, calls existing `install_skill` logic for the caller's agent.
> - Emits `skill_purchased` event with `(buyer, skill_id, price, creator)`.
>
> Add a Rust unit test covering: exact price → success + correct payouts; underpayment → panic; overpayment → panic; already-installed → idempotent (no double-charge).
>
> Build: `cargo near build non-reproducible-wasm --no-abi`.
>
> Operating principles: do not refactor existing skill methods. Just add the new one. Split percentages as constants for now (treasury config can come later).

---

### TASK 15.2 — Deploy contract update to testnet
**Time:** 1030-1200
**Goal:** the new method is callable on `ironshield-test.testnet`.
**Files:** none.
**Verify:** `near call ironshield-test.testnet purchase_skill '{"skill_id": "..."}' --deposit 1 --accountId buyer.testnet` succeeds.

**Prompt:**
> Deploy the updated WASM to testnet. If state layout changed, run `migrate '{}'`. Smoke the purchase via NEAR CLI from a second testnet account. Confirm `view skill_owners '{"skill_id": "..."}'` includes the buyer's agent.
>
> Operating principles: testnet only in this task. Mainnet deploy is Day 21 cutover.

---

### TASK 15.3 — Frontend buy button
**Time:** 1300-1500
**Goal:** marketplace page has a "Buy" button that calls `purchase_skill` payable.
**Files:** `src/components/skills/MarketplacePage.jsx`, `src/hooks/useAgent.js`.
**Verify:** click Buy on testnet → wallet popup shows correct deposit → tx succeeds → success toast → skill appears in "My Skills".

**Prompt:**
> Add `purchaseSkill(skillId, priceYocto)` to `src/hooks/useAgent.js` calling `callMethod(STAKING_CONTRACT, "purchase_skill", { skill_id }, GAS, priceYocto)`.
>
> In `MarketplacePage.jsx`, the Buy button:
> 1. Confirms intent in modal: "Buy <skillName> for <priceNEAR> NEAR?".
> 2. On confirm, calls `purchaseSkill`. Wallet handles signing + redirect.
> 3. On return (URL params), shows success toast and refreshes the user's installed skills list.
>
> Verify: round-trip on testnet. Insufficient balance → wallet error surfaces. Cancel → no charge.
>
> Operating principles: reuse existing wallet selector flow. Don't intercept the redirect — let the wallet do its thing.

---

### TASK 15.4 — Refund handling
**Time:** 1500-1630
**Goal:** if `purchase_skill` panics post-deposit (e.g., race with creator delisting), wallet is refunded automatically.
**Files:** `contract/src/agents.rs` (verify NEAR runtime semantics).
**Verify:** force a panic mid-purchase via test → buyer's balance is unchanged.

**Prompt:**
> Verify NEAR's automatic refund-on-panic semantics for the `purchase_skill` flow. Write a test that:
> 1. Calls `purchase_skill` on a deleted skill → panic.
> 2. Asserts buyer's balance equals starting balance minus gas only (no deposit lost).
>
> If NEAR's default doesn't fully cover this (e.g., for cross-contract callbacks), document the gap in `docs/skill-purchase.md` and add explicit refund logic.
>
> Operating principles: rely on NEAR runtime guarantees. Do not write defensive refund code if not needed. Document if deferred.

---

### TASK 15.5 — Day 15 smoke
**Time:** 1630-1700
**Prompt:**
> 5 testnet purchases by 5 different wallets across 3 skills. Confirm payouts and installs. Deploy frontend.

---

## DAY 16 — Revenue dashboard + richer split

### TASK 16.1 — On-chain revenue events → backend index
**Time:** 0800-1000
**Goal:** backend listens for `skill_purchased` events and persists to `skill_sales` table.
**Files:** `backend/services/revenueIndexer.js` (new), schema `skill_sales`.
**Verify:** purchase on testnet → row appears in `skill_sales` within 30s.

**Prompt:**
> Build a revenue indexer.
> 1. Schema: `skill_sales (tx_hash TEXT PK, block_height BIGINT, skill_id TEXT, buyer_wallet TEXT, creator_wallet TEXT, price_yocto NUMERIC, creator_take_yocto NUMERIC, treasury_take_yocto NUMERIC, sold_at TIMESTAMPTZ)`.
> 2. New service polls NEAR explorer/RPC for `skill_purchased` events from the contract every 30s, dedupes by `tx_hash`, inserts.
> 3. Run as part of `governance worker` Render service (it already has the agent keys + RPC client).
>
> Verify: trigger 3 testnet purchases → 3 rows within a minute.
>
> Operating principles: do not build a generic indexer framework. One event, one table. v1.1 can generalize.

---

### TASK 16.2 — Creator revenue dashboard
**Time:** 1000-1230
**Goal:** creators see total earnings, per-skill breakdown, recent sales.
**Files:** `src/app/skills/revenue/page.js` (new or existing), backend route.
**Verify:** creator with 5 sales sees totals + table.

**Prompt:**
> Build `/skills/revenue` for the connected wallet (must be a creator):
> 1. Backend `/api/skills/revenue?wallet=<>` (signed, server enforces match) → aggregates from `skill_sales`.
> 2. Frontend: total NEAR earned (24h / 7d / all), per-skill breakdown, recent sales table.
>
> Verify: 5 sales → numbers match `SUM(creator_take_yocto)`.
>
> Operating principles: read-only page. No payout button (NEAR auto-credits creator balance). No CSV export.

---

### TASK 16.3 — Treasury page update
**Time:** 1300-1430
**Goal:** existing `/treasury` page reflects accrued skill-sale fees.
**Files:** `src/app/treasury/page.js`.
**Verify:** page shows treasury balance with breakdown by source (skill-sale, staking penalties, etc.).

**Prompt:**
> Audit existing `/treasury` page. Add a "Revenue sources" panel:
> - Skill-sale fees (from `skill_sales.treasury_take_yocto SUM`).
> - Other existing sources (staking, fees) — keep as-is.
>
> Read from a single new backend route `/api/treasury/sources` that aggregates.
>
> Operating principles: don't redesign the page. Add one panel.

---

### TASK 16.4 — Day 16 smoke
**Time:** 1430-1700
**Prompt:**
> Verify creator dashboard + treasury page reflect the testnet purchases from Day 15. Deploy.

---

## DAY 17 — "My purchases" + uninstall

### TASK 17.1 — "My Skills" page completion
**Time:** 0800-1000
**Goal:** user sees every installed skill across their agents.
**Files:** `src/app/skills/mine/page.js` (or `MySkillsPage.jsx`), backend route.
**Verify:** page lists all installed skills with install date, agent assignment, uninstall button.

**Prompt:**
> Complete `/skills/mine` for the connected wallet:
> 1. Backend `/api/skills/installed?wallet=<>` (signed) → joins `agent_installed_skills` with `skills` and `agents`.
> 2. Frontend: cards grouped by agent. Each card: skill name, install date, link to skill detail, "Uninstall" button.
>
> Verify: install 3 skills across 2 agents → grouping and dates correct.
>
> Operating principles: reuse existing components from `MarketplacePage.jsx` if applicable. Don't build a new design.

---

### TASK 17.2 — Uninstall flow
**Time:** 1000-1130
**Goal:** uninstall button calls existing `uninstall_skill` on contract.
**Files:** `src/hooks/useAgent.js`, `MySkillsPage.jsx`.
**Verify:** click Uninstall → wallet confirms → tx succeeds → card disappears.

**Prompt:**
> Wire the Uninstall button to existing contract method `uninstall_skill(agent_id, skill_id)`. Show confirmation modal "Uninstall <skill> from <agent>? Your purchase is not refunded." On success, remove from list and toast.
>
> Verify: round-trip on testnet. Uninstalled skill doesn't reappear on refresh.
>
> Operating principles: thin UI on top of existing contract method. No refund logic — purchases are non-refundable post-install.

---

### TASK 17.3 — Purchase history
**Time:** 1230-1430
**Goal:** users see lifetime purchase history regardless of current install state.
**Files:** new `src/app/skills/history/page.js`, reuse `skill_sales` query.
**Verify:** history shows uninstalled-then-reinstalled correctly.

**Prompt:**
> Build `/skills/history` from `skill_sales` filtered by `buyer_wallet = req.wallet`. Columns: skill, price, date, tx hash, current state (installed / uninstalled).
>
> Verify: install + uninstall + reinstall sequence renders accurately.
>
> Operating principles: read-only table. Pagination via cursor on `sold_at DESC` if rows > 50.

---

### TASK 17.4 — Day 17 smoke
**Time:** 1430-1700
**Prompt:**
> Round-trip: buy → install → uninstall → reinstall → confirm history correctness. Deploy.

---

## DAY 18 — IronShield Pro tier

### TASK 18.1 — Contract: stake-locked Pro membership
**Time:** 0800-1030
**Goal:** contract has `is_pro(account)` view based on stake amount + lock duration.
**Files:** `contract/src/pretoken.rs` or `pool.rs`, new `is_pro` view.
**Verify:** account with ≥ 10000 IRONCLAW staked + lock ≥ 30d returns `true`.

**Prompt:**
> Add Pro membership to the contract.
> - View `is_pro(account_id) -> bool` returning true iff `staked(account) >= PRO_MIN_STAKE && stake_lock_until(account) >= now + PRO_MIN_LOCK_SECONDS`.
> - Constants: `PRO_MIN_STAKE = 10_000 * 10**24`, `PRO_MIN_LOCK_SECONDS = 30 * 86400`.
> - If existing pool struct lacks per-account lock time, add `lock_until: u64` to staker info; default 0 for existing stakers.
> - New method `extend_lock(seconds: u64)` to let users opt into Pro by locking longer (no-op if already locked further out).
>
> Migration if struct changed.
>
> Verify: Rust unit test: stake 10K + extend lock 30d → `is_pro` true. Stake 10K with no lock → false. Stake 5K with 30d lock → false.
>
> Operating principles: simplest possible Pro definition. No tiered Pro levels. No NFT.

---

### TASK 18.2 — Deploy + backend `requirePro` middleware
**Time:** 1030-1200
**Goal:** backend can gate routes by Pro status (cached 60s).
**Files:** `backend/middleware/requirePro.js`, deploy contract to testnet.
**Verify:** Pro wallet → 200; non-Pro → 402 `{ error: "pro-required" }`.

**Prompt:**
> 1. Deploy updated WASM to testnet, run `migrate '{}'` if needed.
> 2. New `backend/middleware/requirePro.js`: chains after `requireWallet`, calls contract view `is_pro(req.wallet)`, caches 60s. If false → 402 `{ error: "pro-required", upgradeUrl: "/rewards#pro" }`.
>
> Verify: Test Pro wallet → 200. Non-Pro → 402.
>
> Operating principles: middleware mirrors `requireWallet` shape. Cache via the same in-memory cache.

---

### TASK 18.3 — Pro perks: AI budget, badge, themes
**Time:** 1300-1500
**Goal:** Pro users get higher AI budget, Pro badge, custom theme options.
**Files:** `backend/services/agentConnector.js`, `src/components/shell/AppShell.jsx`, `src/lib/themes.js`.
**Verify:** Pro wallet's `wallet_budgets.daily_ai_budget_usd` reads $20 (vs $5 default); Pro badge renders next to wallet address.

**Prompt:**
> 1. AI budget: in `agentConnector.js`, when computing budget, if `is_pro(wallet)` (cached) → cap = $20/day instead of $5.
> 2. UI badge: in `AppShell.jsx`, render a "PRO" pill next to the wallet address if `/api/admin/check`-style endpoint says Pro (add `/api/me` returning `{ wallet, isPro, isAdmin }`).
> 3. Themes: extend `src/lib/themes.js` with 3 Pro-only themes; theme picker shows them locked for non-Pro with "Upgrade to Pro" CTA.
>
> Verify: Pro wallet sees badge + can pick locked themes + AI calls accumulate against $20 cap.
>
> Operating principles: Pro perks are additive. Free tier still works. No degraded paths.

---

### TASK 18.4 — Pro upgrade flow UI
**Time:** 1500-1630
**Goal:** the `/rewards#pro` section (stubbed in Task 6.4) becomes a real upgrade flow.
**Files:** `src/app/rewards/page.js`.
**Verify:** click "Upgrade to Pro" → wallet calls `extend_lock(30d)` → on success, badge appears.

**Prompt:**
> Replace the Day 6.4 stub with a real flow:
> 1. Show current stake + current lock-until.
> 2. If not Pro: show "Lock 30 days to unlock Pro" → button calls `extend_lock(30 * 86400)`.
> 3. If Pro: show "You are Pro until <date>" + "Extend lock" button.
>
> Verify: testnet round-trip. Stake 10K, click Upgrade → tx → page refreshes with Pro state.
>
> Operating principles: thin UI on top of `extend_lock`. No payment flow — Pro is stake-locked, not subscription.

---

### TASK 18.5 — Day 18 smoke
**Time:** 1630-1700
**Prompt:**
> Three accounts: free, Pro-by-stake, Pro-by-extend. Each sees correct AI cap, badge, theme options. Deploy.

---

## DAY 19 — LiveKit production infrastructure

### TASK 19.1 — LiveKit Cloud production project
**Time:** 0800-0930
**Goal:** prod project with usage tier appropriate for expected concurrency.
**Files:** `.env.example`, Render env.
**Verify:** prod creds working; dev creds remain for testnet.

**Prompt:**
> 1. Create LiveKit Cloud production project. Set `LIVEKIT_API_KEY_PROD`, `LIVEKIT_API_SECRET_PROD`, `LIVEKIT_URL_PROD` on the web Render service.
> 2. Backend reads `*_PROD` when `NODE_ENV=production`, falls back to dev creds otherwise.
> 3. Test from Render preview pointed at prod.
>
> Verify: prod token validates against prod URL.
>
> Operating principles: dual creds, no shared secrets across envs.

---

### TASK 19.2 — Recording-to-S3 pipeline
**Time:** 0930-1230
**Goal:** rooms with `recording_requested = true` actually record to S3 and surface playback URL.
**Files:** `backend/services/livekitWebhooks.js` (new), `backend/routes/livekit.route.js`.
**Verify:** start a recorded room; end it; recording artifact appears in S3; metadata row points to it.

**Prompt:**
> 1. Provision S3 bucket + IAM user (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_LK`).
> 2. Configure LiveKit Egress: when a room with `recording_requested = true` starts, call `RoomCompositeEgress` to S3.
> 3. LiveKit webhook → `POST /api/livekit/webhooks` updates `rooms.recording_url` on completion.
> 4. Frontend: rooms with `recording_url` show a playback link in the post-room screen.
>
> Verify: short test room → recording lands in S3 within 5 min → playback works.
>
> Operating principles: S3 only. No multi-cloud. No transcription (v1.1).

---

### TASK 19.3 — Move existing Rooms code to prod-tier
**Time:** 1330-1500
**Goal:** the dev-tier code from Day 13 transparently switches to prod creds in production.
**Files:** `backend/routes/livekit.route.js`.
**Verify:** Day 13's smoke test passes against prod creds.

**Prompt:**
> Refactor `livekit.route.js` to read creds via a `getLiveKitConfig()` helper that returns prod or dev based on env. Verify Day 13 smoke against prod.
>
> Operating principles: no behavior change. Just config indirection.

---

### TASK 19.4 — Day 19 smoke
**Time:** 1500-1700
**Prompt:**
> 5-person test room with recording. Verify all working including playback. Deploy.

---

## DAY 20 — Playwright E2E suite + PgBouncer

### TASK 20.1 — Playwright suite (8 critical paths)
**Time:** 0800-1130
**Goal:** 8 user journeys auto-tested in CI.
**Files:** `e2e/` (new), `playwright.config.ts`, GitHub Actions workflow.
**Verify:** `npm run e2e` runs all 8, all green.

**Prompt:**
> Set up Playwright. 8 critical paths (one spec each):
> 1. Connect Meteor wallet (testnet) → see header pill.
> 2. Register agent → name appears in `/agents`.
> 3. Create skill → appears in marketplace.
> 4. Vote on a proposal → vote count increments.
> 5. Send DM → recipient sees message in second context.
> 6. Buy a skill (testnet) → appears in `/skills/mine`.
> 7. Join a room → both contexts see each other's name.
> 8. Create automation → fires on test event.
>
> Use Playwright's testnet `near-api-js` programmatic wallet (no real wallet UI clicks where avoidable).
>
> Verify: `npm run e2e` green locally. CI workflow runs on push.
>
> Operating principles: 8 specs, no fixtures-of-fixtures. Each spec under 100 lines.

---

### TASK 20.2 — GitHub Actions workflow
**Time:** 1130-1230
**Goal:** Playwright runs on every PR.
**Files:** `.github/workflows/e2e.yml`.
**Verify:** PR shows the Playwright check.

**Prompt:**
> Add `.github/workflows/e2e.yml`: Node 20, install, build, start backend against test Postgres, start frontend on `:3000`, run Playwright. Cache `~/.cache/ms-playwright`.
>
> Verify: open a draft PR, check appears, runs to completion.
>
> Operating principles: one workflow file. No matrix, no parallel shards (8 specs is small).

---

### TASK 20.3 — PgBouncer in front of Postgres
**Time:** 1330-1530
**Goal:** transaction-mode PgBouncer absorbs connection bursts.
**Files:** Render docker-based service for PgBouncer (or Render add-on if available); `backend/db/client.js` connection string update.
**Verify:** load test 1000 concurrent connections succeeds without "too many clients".

**Prompt:**
> 1. Stand up PgBouncer in front of the Render Postgres (Docker service or community add-on). Mode: `transaction`. Pool size matches Postgres `max_connections`.
> 2. Update `DATABASE_URL` to point at PgBouncer.
> 3. Backend `db/client.js`: ensure no `LISTEN/NOTIFY` or session-level features are used (transaction mode breaks those). If they are, document workaround in `docs/runbook.md`.
>
> Verify: 1000-connection burst from a smoke script succeeds.
>
> Operating principles: minimum infra. Don't introduce HAProxy or pgpool — PgBouncer alone is enough.

---

### TASK 20.4 — Day 20 smoke + deploy
**Time:** 1530-1700
**Prompt:**
> Run full Playwright suite + PgBouncer load smoke against staging. Deploy backend with new connection string.

---

## DAY 21 — Final load test + v1.0.0 cutover

### TASK 21.1 — Full load test 1000 → 5000
**Time:** 0800-1100
**Goal:** find the breakpoint with PgBouncer + LiveKit prod + all features live.
**Files:** `scripts/load.k6.js` (extend from Task 7.1).
**Verify:** at 2500, p95 reads < 500ms, error < 1%; at 5000, document the failure mode.

**Prompt:**
> Extend Task 7.1's k6 script with the new endpoints (purchase_skill quote, automations dry-run, rooms create, bridge quote). Run 1000 / 2500 / 5000 concurrent stages.
>
> Capture: per-endpoint p50/p95/p99, error rate breakdown, AI cost burn, DB connection count via PgBouncer stats, LiveKit concurrent rooms.
>
> Document the breakpoint and the bottleneck (likely DB or AI rate cap).
>
> Verify per the goal above.
>
> Operating principles: one script, three stages, one report file at `docs/load-results-v1.md`.

---

### TASK 21.2 — Final tuning
**Time:** 1100-1230
**Goal:** adjust limits/pool/cap based on Task 21.1 numbers.
**Files:** rate limiter config, PgBouncer pool, AI caps.
**Verify:** re-run at 2500 → all metrics within target.

**Prompt:**
> Tune the smallest knobs based on Task 21.1 results. Document each change in the commit message with before/after numbers.
>
> Operating principles: no architectural changes. If something needs deeper work (e.g., read replica), file a v1.1 ticket and document.

---

### TASK 21.3 — Mainnet contract redeploy (purchase_skill + Pro)
**Time:** 1330-1500
**Goal:** mainnet has the new methods from Day 15 + Day 18.
**Files:** none.
**Verify:** mainnet `view is_pro` and `view skill_owners` return correct data.

**Prompt:**
> Per memory, build with `cargo near build non-reproducible-wasm --no-abi`. Deploy to `ironshield.near`. If state layout changed, run `migrate '{}'`.
>
> Smoke 3 mainnet operations: register agent (existing), purchase a real skill at small price, extend lock to Pro.
>
> Operating principles: do not skip the migrate call. Confirm code_hash matches expected. Be ready to rollback by re-deploying previous WASM.

---

### TASK 21.4 — Frontend + backend prod cutover
**Time:** 1500-1600
**Goal:** prod URLs serve v1.0.0.
**Files:** none.
**Verify:** prod URL works end-to-end with mainnet wallet.

**Prompt:**
> Same protocol as Task 7.3 / Task 14.3 cutover, but tag `v1.0.0`. Deploy 3 Render services + Cloudflare Pages. Switch frontend env to mainnet for the new contract methods.
>
> Verify: connect mainnet wallet, register agent, buy a skill (real NEAR), extend lock to Pro. Watch logs + Sentry for 30 min — zero unhandled errors.

---

### TASK 21.5 — Public launch checklist + runbook update
**Time:** 1600-1700
**Goal:** runbook + announcement copy + on-call schedule ready for launch announcement.
**Files:** `docs/runbook.md`, `docs/launch-announce.md`.
**Verify:** runbook covers v1.0.0 surface; announce copy ready to publish.

**Prompt:**
> 1. Update `docs/runbook.md`: add purchase_skill, Pro tier, LiveKit prod, PgBouncer, Playwright sections. Update env-var checklist. Document new known limitations (whatever Task 21.1 surfaced).
> 2. Write `docs/launch-announce.md`: 1-page public announcement. Sections: What we shipped, How to get started, How to provide feedback, Roadmap teaser. Don't publish — that's a product call.
> 3. `git tag v1.0.0 && git push --tags`.
> 4. Update `CLAUDE.md` to "STATUS: v1.0.0 shipped" and link this `SPRINT_PLAN.md` as historical reference.
>
> Verify: a fresh engineer reads only `CLAUDE.md` + `docs/runbook.md` and can spin up dev + roll back any service.

---

## Daily checklist (print and tick)

```
[ ] Day 1  — Auth foundation: 5 routes locked, smoke green
[ ] Day 2  — Auth rollout, admin gate, rate limits, CORS: AI key safe, no NEXT_PUBLIC_* secrets
[ ] Day 3  — Render split, state in DB, bot webhook: 3 services healthy
[ ] Day 4  — Governance loop testnet evidence pack committed
[ ] Day 5  — Uploads hardened, TODOs gated, AI $ cap live, dead code gone
[ ] Day 6  — Indexes, pool, clean build, secret re-audit clean
[ ] Day 7  — Load test 500 green, RC1 cutover, v0.9.0 tagged, runbook + CLAUDE.md current
[ ] Day 8  — DM E2E crypto verified, read receipts + key rotation + media attachments live
[ ] Day 9  — TG bot: linking + portfolio + alerts + vote + digest
[ ] Day 10 — NewsCoin: live scanner + terminal + buy + honeypot gate
[ ] Day 11 — Trading: slippage + partial-fill recovery + history
[ ] Day 12 — Automations: time + event + AI triggers + quota + dry-run
[ ] Day 13 — Rooms: create/join/chat/mod/recording-flag on LiveKit dev tier
[ ] Day 14 — Bridge: one route end-to-end testnet, v0.95.0-beta tagged
[ ] Day 15 — Skill purchase contract + frontend buy button working on testnet
[ ] Day 16 — Revenue indexer + creator dashboard + treasury panel
[ ] Day 17 — My Skills + uninstall + history
[ ] Day 18 — IronShield Pro: contract + middleware + perks + upgrade flow
[ ] Day 19 — LiveKit production: prod creds + S3 recording pipeline
[ ] Day 20 — Playwright 8 paths + PgBouncer
[ ] Day 21 — Load 5000 + mainnet contract + v1.0.0 cutover + runbook
```

## Drop-list if any day slips

In order of dropability (drop first):
1. **5.5** — DM/notif polling → WebSocket migration (UX nice-to-have; Day 8 doesn't depend on it)
2. **5.4** — Dead-code sweep (cosmetic)
3. **6.3** — Bundle audit beyond warning fix (size > clean is acceptable)
4. **8.4** — DM media attachments (chat works without)
5. **9.5** — `/digest` daily AI summary (other TG commands cover MVP)
6. **10.4** — Honeypot pre-trade gate (Day 10.1 risk badge already informs user)
7. **12.3** — AI-evaluated triggers (time + event triggers cover 80% of value)
8. **13.4** — Rooms mod actions (host can create new room as workaround)
9. **16.3** — Treasury page revenue panel (data still on chain)
10. **17.3** — Purchase history page (My Skills covers current state)
11. **19.2** — S3 recording pipeline (Day 13.4 metadata flag is already set)
12. **20.1** — Playwright suite (manual smoke covers v1)

**Never drop:** auth (D1+D2), governance loop evidence (D4), load test (D7.1, D21.1), production cutover (D7.3, D14.3, D21.4), purchase_skill contract + frontend (D15), Pro tier contract (D18.1).
