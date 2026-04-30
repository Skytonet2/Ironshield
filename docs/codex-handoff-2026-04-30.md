# Handoff to Codex — 2026-04-30

You're picking up the AZUKA agent-economy build mid-sprint. Claude burned through this week's quota, and you're the next set of hands. This document is everything you need to act without follow-up. Read it end to end before opening any file.

---

## What this project is

**AZUKA** (umbrella rebrand of IronShield, applied 2026-04-28 — see `~/.claude/projects/C--Users-SKYTONET-ironshield/memory/project_azuka_rebrand.md`) is a NEAR-based agent economy. Three surfaces in one repo:

- **Backend** — Express on Render, single web service `srv-d7ev9v7lk1mc73c2ic0g`, mounts the Telegram bot inline. Postgres on Neon (NOT Render — see `project_db_neon_not_render.md`).
- **Frontend** — Next.js 16 App Router, deployed via Cloudflare Pages (`azuka.pages.dev`). Build is `next build` → static export to `out/`. Deploy is `wrangler pages deploy out --project-name=azuka --branch=main`. Pushing to main does not auto-deploy.
- **Smart contract** — Rust monolith at `contract/src/`. Deployed instance is `ironshield.near` (chain account name unchanged across the rebrand). Phase 9 on mainnet (`code_hash GKwch…`); Phase 10 code is merged to main but **NOT YET DEPLOYED** to mainnet — see "deploy gate" below.

Everything additive. Existing security DAO flows (staking, governance, treasury, the original IronClaw security agent) must keep working untouched.

## Current state — last verified 2026-04-30 ~10:48 UTC

- `main` is at **`611e41a9`** (last merge: PR #129, sidebar nav additions).
- **Render backend** is live at `25195abb` (one commit behind main; nav is frontend-only so it does not need a backend redeploy).
- **Cloudflare Pages frontend** is live at `611e41a9` (matches main).
- **autoDeploy is OFF** on Render, deliberate per `project_render_backend.md`. Nothing redeploys until someone POSTs to the deploys endpoint or runs wrangler.

### Open PRs

- **PR #123** — `feat(payments): Paystack on-ramp for Nigerian buyers + NEAR float manager`. Was MERGEABLE clean as of an hour before this handoff. Mergeability flag may now read UNKNOWN because main moved during today's work; rebase if needed. **The user will merge — not you.** Live keys are gated on Nigerian entity registration + Paystack merchant approval; test-key dev can proceed but live deploy is human-gated.

### What just shipped today (2026-04-30, ~255 commits in the last 5 days)

- Phase 10 contract code (mission engine, kit registry, escrow) on `main`, NOT on mainnet.
- Phase 10 Tier 1 — mission lifecycle indexer, sequential crew orchestrator, six-role enum, bulk skill manifest CLI, SSE mission stream.
- Phase 10 Tier 2 — AZUKA Guide concierge (formerly IronGuide; rename landed in PR #128), Kit catalog at `/marketplace/kits`, Kit deploy wizard at `/agents/deploy/[slug]`, mission detail page with live SSE timeline.
- Phase 10 Tier 3 — Wallet Watch Kit shipped (PR #96).
- Phase 10 Tier 4 + 5 (PR #98) — six Web2 connectors, OAuth (X PKCE + Facebook), token refresh worker, `/run-kit` Kit runtime, `/connectors` page, four spec Kits (Realtor / Car Sales / Freelancer Hunter / Background Checker).
- Phase 10 Tier 5 (PR #126) — catalog FTS, admin moderation, authors leaderboard, version diff.
- Agent-economy feed (PR #125) — receipts auto-poster, mission posts, bounty posts, classifier, matcher, bid engine, anti-spam (stake-to-bid, vertical mute, premium DM, governance-slash report flow).
- PingPay hosted-checkout for mission funding (PR #124) — `pending_missions`, `pingpay_payments`, `/api/payments/pingpay/*` routes, frontend `/payments/success` and `/payments/cancel` pages.
- PingPay agent payout — **thin slice only** (PR #122). `pingpay_payouts` and `pingpay_agent_kyc` schema landed; `/api/payments/agent/balance` read endpoint exists; `backend/services/balanceLookup.js` returns `{near_yocto, usdc_base, decimals}`; the `/agents/me` Wallet panel is read-only. **The actual cash-out flow is not built yet.** This is your highest-priority item.
- AZUKA Guide rename (PR #128) — user-facing strings only; internal code identifiers (`services/ironguide/`, `ironguide_sessions`, `/api/ironguide`) kept to avoid churn.
- Sidebar nav (PR #129) — `/onboard`, `/missions`, `/marketplace/kits`, `/connectors` are now in the AppShell sidebar.

---

## Hard rules — read before touching anything

1. **Additive only.** Existing security / governance / staking / IronClaw-original-agent code must not be modified unless an explicit interface boundary requires it. Isolate any required change behind a flag.
2. **You can open PRs but cannot merge.** All PRs land on a branch. The user merges. Open the PR with a clear summary + test plan; do not auto-merge.
3. **Codex never deploys.** Do not call the Render API, do not run wrangler, do not run any deploy script. The user owns deploys. Your work ends at "PR open + CI green."
4. **DIY agent composition is gated.** `/api/agents/diy` returns 403 deliberately. v1 ships Kit-deploy only. Don't unlock until Phase 5 of the roadmap.
5. **The Phase 10 contract is not on mainnet.** Code changes to `contract/src/` ship to main but the wasm is NOT deployed. Production runs against synthetic on-chain ids until the deploy gate (below) clears. Do not edit the migrate path or `Phase8StakingContract` mirror without surfacing the implication.
6. **Webhook authentication.** Inbound from PingPay / Paystack uses HMAC over `{timestamp}.{raw_body}`. Reuse existing patterns at `backend/services/pingpay/checkout.js` (signature verifier) and `backend/routes/ironclaw.route.js` (raw-body capture). Never log raw bodies or signatures. Never re-add wallet-guard regressions for webhook routes — the test in `backend/__tests__/paymentsBalance.test.js` whitelists `/webhook` paths intentionally.
7. **Bank details encrypted.** Any bank details you persist go through AES-256-GCM with `CUSTODIAL_ENCRYPT_KEY` (same pattern as `backend/services/custodialBotWallet.js`). Mask to last 4 in API responses.
8. **Confidential roadmap surfaces stay private.** Iron-3, Iron Pay, Iron Voice, Iron Lens, Iron Escrow, Iron Index, Iron API are never named in user-facing strings. Build interfaces that *can* host them later; don't expose the names.

---

## The deploy gate — surface this if anyone asks to deploy contract code

Before deploying the Phase 10 wasm to mainnet, the `Phase8StakingContract` borsh mirror in `contract/src/migrate.rs` needs a testnet (or near-workspaces) round-trip to confirm it deserializes the live state byte-for-byte. Borsh has no schema; a wrong mirror panics at runtime. See `~/.claude/projects/C--Users-SKYTONET-ironshield/memory/project_phase10_deploy_gate.md`.

If a future user prompt asks you to "deploy" or "ship" the contract, **stop and surface this gate.** Do not push wasm to `ironshield.near` without explicit human confirmation that the round-trip ran. The off-chain backend and frontend can deploy independently of the contract — just the wasm itself is gated.

---

## Memory you must read on first turn

The memory directory at `~/.claude/projects/C--Users-SKYTONET-ironshield/memory/` is the single source of truth for project posture. Before acting, read these:

- **`MEMORY.md`** — index of everything. Re-read this when the user mentions memory.
- **`feedback_operating_principles.md`** — surface assumptions, minimum code, touch only what's asked, define verify checks per step.
- **`feedback_explain_plain.md`** — for status/summary/explain replies: short sentences, no headers, no hashes, no acronyms.
- **`feedback_stop_when_hallucinating.md`** — verify file/branch/PR existence before claiming absence.
- **`feedback_fetch_before_claim.md`** — `git fetch --all` and read `origin/main` before saying X isn't merged. Local main lags origin.
- **`project_azuka_rebrand.md`** — substitute AZUKA for IronShield in UI/docs/marketing; chain account, GitHub repo, Render service IDs all kept as `ironshield`.
- **`project_phase7_progress.md`** — the long history of contract phases. The Phase 10 section at the bottom is the current shape. Prefix inventory through Phase 10: `p, u, g, v, mr, c, a, n, V, G, H, S, T, K, I, F, L, M, P, O, Q, X, B, k, R`.
- **`project_phase10_deploy_gate.md`** — the testnet round-trip requirement.
- **`project_phase10_deploy_checklist.md`** — `/run-kit` smoke deferred until first real mission lands; synthetic skill_ids (9_000_001+) need reconciliation after contract starts minting real ones; live OAuth manual smoke pending FRONTEND_URL + provider apps.
- **`project_phase10_tier4_shipped.md`** — what landed in PR #98.
- **`project_db_neon_not_render.md`** — DB is on Neon, not Render's managed Postgres.
- **`project_render_backend.md`** — autoDeploy off; deploys via direct API call.
- **`project_deploy_pipeline.md`** — direct wrangler upload to project `azuka` (NOT `ironshield` — there's a stale alias).
- **`project_pino_build_break.md`** — if next build fails on Privy → walletconnect/logger requiring pino, install pino. Don't hunt through feature code for this trace.
- **`project_skill_status_columns.md`** — `skill_runtime_manifests` has TWO status columns: `lifecycle_status` (admin moderation, Tier 5) and `status` (runtime active flag). Don't conflate.

You don't need to memorize the rest, but `ls` the directory before claiming a memo doesn't exist.

---

## Workflow you follow

1. **Read memory first.** Before opening any file, `cat MEMORY.md` and re-read it.
2. **Always fetch before claiming.** `git fetch --all` and read `origin/main`. Do not assume your local view is current. The repo is multi-session; main moves.
3. **Branch naming.** `claude/<descriptive-slug>` is the existing convention. Use it. The user merges by branch name.
4. **One PR per logical unit.** If a task naturally splits into 3 commits, open 3 PRs that depend on each other in sequence rather than one mega-PR. PR descriptions should explicitly state what depends on what.
5. **PR template.** Title `feat(scope): summary`, `fix(scope): summary`, `chore(scope): summary`. Body: a `## Summary` bullet list of what shipped + a `## Test plan` checklist. Add the Codex co-author footer.
6. **Verify checks per step.** Don't claim "done" until tests pass. Test framework is `node --test "backend/__tests__/*.test.js"`. Mock DB by hijacking `require.cache[clientPath]` (pattern in `backend/__tests__/agentState.test.js`). Use deterministic fixtures — no live API calls in tests.
7. **Don't push contract/target/.** It's tracked but the build artifacts should not flow into PRs. `git add` source files explicitly; never `git add .` or `git add -A`.
8. **Match the existing styling.** Frontend uses custom CSS variables in `src/styles/tokens.css`. Dark-only by design. No shadcn / no MUI / no new component library. See `src/components/skills/CreateSkillPage.jsx` for the wizard pattern.

---

## Priority list — start at the top

### 1. Finish the PingPay agent payout off-ramp ([HIGH])

PR #122 landed only the read-only Wallet panel + balance endpoint. The full cash-out rail is still missing. This is the highest-leverage queue item — it completes the payments story (deposit via PingPay checkout already works; cash-out is the matching off-ramp).

What's already on main (do not redo):
- `pingpay_payouts` and `pingpay_agent_kyc` tables in `backend/db/schema.sql` (idempotent CREATE / ALTER, runs on backend boot).
- `backend/services/balanceLookup.js` — `getAgentBalance(accountId)` returns `{account_id, near_yocto, near_decimals, usdc_base, usdc_decimals}`.
- `GET /api/payments/agent/balance` endpoint, wallet-authed via NEP-413 (`backend/middleware/requireWallet`).
- `backend/services/pingpay/checkout.js` (the on-ramp client) — reuse its `verifyWebhookSignature` helper for the webhook-event extension.
- `POST /api/payments/pingpay/webhook` handler — extend the existing one, do NOT add a second `/webhook` route.
- `pingpay_payouts` schema columns: `id, agent_wallet, amount_yocto, source_token, target_currency, target_amount, target_country, fees_json, status (pending|sent|completed|failed), pingpay_payout_id, bank_details_encrypted (BYTEA), raw_event_json, created_at, completed_at`.
- `pingpay_agent_kyc` schema columns: `agent_wallet (PK), pingpay_kyc_id, status (unstarted|pending|verified|rejected), last_verified_at`.

What you need to build:
- **`backend/services/pingpay/payouts.js`** — wraps PingPay's payout/withdrawal endpoints. Confirm exact endpoint names from `https://pingpay.gitbook.io/docs/llms-full.txt` (search "payout", "withdrawal", "off-ramp", "payee"). Reuse `PINGPAY_PUBLISHABLE_KEY` and `PINGPAY_WEBHOOK_SECRET` env from chip 1.
- **Routes in `backend/routes/payments.route.js`** (already mounted at `/api/payments`):
  - `POST /api/payments/agent/cashout/quote` — wallet-authed. Body `{amount_yocto, target_currency, target_country}`. Returns `{target_amount, fees: {pingpay_bps, network_yocto, partner_bps}, eta_minutes}`. Stateless — recompute from PingPay API every call.
  - `POST /api/payments/agent/cashout` — wallet-authed. Body `{amount_yocto, target_currency, target_country, bank_details}`. Validate sufficient balance via `balanceLookup`. Encrypt `bank_details` with `CUSTODIAL_ENCRYPT_KEY` AES-256-GCM. Insert `pingpay_payouts` row in `'pending'`. Trigger PingPay payout call with idempotency key. Return `{payout_id, status, tracking_url}`.
  - `GET /api/payments/agent/cashout/:id` — wallet-authed. Returns the row. Decrypt `bank_details` only to surface last 4 digits. Never raw blob.
  - `GET /api/payments/agent/cashout` — wallet-authed list, paginated.
  - **Extend** the existing `POST /api/payments/pingpay/webhook` handler — dispatch on `event.type ∈ {payout.pending, payout.sent, payout.completed, payout.failed}` and update the matching `pingpay_payouts` row by `pingpay_payout_id`. The signature verification is already wired; reuse it.
- **KYC handshake.** Default to PingPay-hosted KYC. On first cash-out, the cashout endpoint reads `pingpay_agent_kyc.status` for the wallet:
  - `unstarted | rejected` → return `{kyc_required: true, redirect_url}`. Frontend opens in popup; PingPay redirects to `/payments/kyc/return?wallet=<>` after.
  - `pending` → return `{kyc_pending: true}`.
  - `verified` → proceed.
  - On the return URL, hit PingPay's KYC-status endpoint, update `pingpay_agent_kyc.status`, broadcast via the existing `eventBus` so the frontend SSE subscriber refreshes.
- **Frontend cashout modal** — `src/components/agent/CashoutModal.jsx`. Reachable from a "Cash out to bank" CTA next to the existing read-only Wallet panel on `src/app/agents/me/page.js`. Flow: amount → currency/country → KYC redirect on first run (block until status flips) → bank details (account number, name, bank) → quote step (live `/quote` call, refreshes every 15s while open) → confirm → submit. Match the existing custom-CSS-vars styling.
- **Tests** in `backend/__tests__/pingpayPayouts.test.js`:
  - Quote endpoint maps PingPay response to our shape.
  - Cashout creates a `pingpay_payouts` row in 'pending' AND triggers the PingPay client.
  - `bank_details_encrypted` is BYTEA, never returned raw.
  - Webhook event dispatch updates the matching payout row by `pingpay_payout_id`.
  - KYC gate blocks pre-verified wallets and returns the correct redirect.
  - Insufficient-balance check fires before any PingPay call.

Confirm in the PingPay docs whether NGN payout is supported on the off-ramp. If NOT (Nigeria off-ramp is also crypto-only), surface a clear "fiat off-ramp for Nigeria not supported — use Paystack on-ramp instead" message in the modal for Nigerian users. Don't silently fail.

PR title: `feat(payments): PingPay agent payout off-ramp — full slice`. Realistic effort: 2-3 working days solo.

### 2. Mission lifecycle smoke + synthetic-id reconciliation ([MEDIUM])

Per `project_phase10_deploy_checklist.md`: synthetic skill_ids start at 9_000_001 because the contract isn't deployed. When the Phase 10 wasm finally lands on mainnet, those synthetic ids need to map to real ids the contract mints. Build the migration shape now (so the user can run it the day the contract deploys):

- **Backfill script** `backend/scripts/reconcile-synthetic-skill-ids.js` — given a list of `(synthetic_id → real_id)` pairs from contract events post-deploy, walks `skill_runtime_manifests`, `agent_kits.bundled_skill_ids`, `mission_audit_log.skill_id`, and rewrites references.
- **Idempotent.** Should be safe to run twice.
- **Dry-run mode.** Default `--dry-run` flag prints the rewrite plan; `--commit` actually applies it.
- **Tests** with a fixture set covering each touched table.

PR title: `feat(scripts): synthetic-skill-id reconciliation for post-deploy backfill`.

### 3. Tier 6 — sandbox eval harness + integration tests + expiry crons ([MEDIUM])

Per the original Phase 2 Tier 6 chip prompt (no longer in the tray, but the work stands). Without an eval harness, the user's 200 queued skills can't be vetted before public flip.

- **`backend/services/skills/sandbox.js`** — `MockConnector`, `MockLLM`, `MockContract` deterministic fixtures. `harness.run({skill, inputs, fixtures})` returns `{outputs, audit_steps, errors}`.
- **CLI `backend/scripts/eval-skill.js`** — reads manifest, runs against fixtures, validates outputs match `io_schema_json`, reports pass/fail. Used to gate `lifecycle_status` flips from `internal/curated → public`.
- **Integration test `backend/__tests__/missionLoop.integration.test.js`** — fakes `mission_created` event → indexer → orchestrator → step loop → escalation → resolution → reputation tick. All mocked, no live RPC.
- **Cron workers**:
  - `backend/jobs/missionExpiry.job.js` — every 5 min, query `missions WHERE status='submitted' AND review_deadline < NOW()`, call on-chain `expire_mission` via the orchestrator account.
  - `backend/jobs/escalationExpiry.job.js` — cron-call `/api/escalations/sweep` with `ORCHESTRATOR_SHARED_SECRET`.

  Wire both into `npm run jobs` in `package.json`.

PR title: `feat(reliability): sandbox eval harness + mission-loop integration test + expiry crons`.

### 4. TG bot rogue-polling root cause ([LOW] but recurring annoyance)

Earlier today the Telegram webhook was getting cleared because something somewhere was running `node bot/index.js` in polling mode against the same bot token. Webhook is registered now (manually via Telegram API), but if it disappears again, the polling process is the cause.

Investigate:
- Search for any `npm run bot`-like invocation outside the merged `bot/attach.js` path.
- Confirm no separate Render service has the `TELEGRAM_BOT_TOKEN` env var set with a polling start command.
- Check `package.json` scripts — `npm run ironclaw` runs `concurrently "npm run backend" "npm run bot" ...` which would spawn a polling bot. If anyone runs `npm run ironclaw` locally or in any prod environment, the webhook clears.

Document findings in `docs/tg-bot-polling-root-cause.md` with concrete evidence (which file, which env, which deploy). If you need to ship a fix, the right shape is probably: kill the standalone `bot/index.js` polling fallback when `BOT_MODE` is unset, OR make `bot/index.js` a no-op when `WEBHOOK_URL` is set in env.

PR title: `chore(bot): document and lock down rogue-polling root cause`.

### 5. Tier 7 — frontend polish + docs ([LOW])

Walk every new route in a real browser. Capture issues. Fix the load-bearing ones. Write `/docs/economy/` markdown explaining the rail (overview, missions, kits, skill authoring, connectors, reputation, glossary). Don't leak the confidential roadmap surfaces.

PR title: `feat(economy): docs + frontend polish for Phase 10 surfaces`.

---

## What NOT to do

- **Do not redeploy.** Render and Pages bumps are the user's call. Even after a PR merges, you don't trigger the deploy.
- **Do not edit `contract/src/` to fix something.** The contract is gated. If you find a bug in the contract code that's already on `main`, write the fix as a TODO in `docs/codex-followups.md` and let the user decide.
- **Do not modify the security DAO modules.** `governance.rs`, `treasury.rs`, `actions.rs`, `pool.rs`, the original IronClaw security agent — none of these change unless an interface explicitly demands it.
- **Do not add `IronGuide` strings back to the UI.** The rename is final per PR #128. Internal code identifiers stay (`services/ironguide/`, `ironguide_sessions`, `/api/ironguide` route prefix); user-facing strings say "AZUKA Guide".
- **Do not remove the `agentsDiy.route.js` 403 lock.** v1 is Kit-deploy only.
- **Do not reorder or remove existing sidebar groups.** The Platform / IronClaw split is intentional even if "IronClaw" reads oddly under the AZUKA umbrella. That's a separate UX decision the user owns.
- **Do not change the auth-engine system defaults** (`commit_funds`, `sign_tx`, `meet_irl`, `public_post` → `require_approval`; `send_message` ≥5 → `notify`). They're load-bearing. Add custom rules via `auth_profiles` rows; don't edit the defaults.

---

## How to verify before opening a PR

1. `cargo check --release` (only if you touched `contract/src/` — and you shouldn't be).
2. `node --test "backend/__tests__/*.test.js"` — full suite must stay green. Add tests for new code.
3. `npm run build` — confirm Next.js static export still produces `out/`. Do NOT commit `out/`.
4. `node --check <file>` for any new JS file.
5. Schema additions: append to `backend/db/schema.sql` with `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS`. The schema is run at server boot via `npm run db:migrate`. Idempotent re-run must succeed.

---

## When you're stuck or finished

- **Stuck on something the user owns** (deploy, contract migration, regulatory question for Paystack live keys): open a PR with the work that *is* done, mark the gated bit as a follow-up in the PR body, do not push past it.
- **Finished a priority item:** open the PR, link it from the priority list above (edit this doc on a follow-up PR if you want), and pick up the next one.
- **Memory drift:** if you discover a memory file is stale (e.g. `project_phase10_tier5_scale_pending.md` says Tier 5 is pending but PR #126 just shipped it), update the memo as part of the PR. Memory accuracy compounds over weeks.

---

## Footer convention for commits

```
Co-Authored-By: Codex <noreply@openai.com>
```

(Replace with whatever co-author footer your runtime uses; the user's tooling expects an explicit attribution line.)

---

End of handoff. Start with Priority 1 — the PingPay payee off-ramp. Open the first PR before EOD.
