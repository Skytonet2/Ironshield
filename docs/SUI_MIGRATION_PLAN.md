# AZUKA Sui Migration Plan

Phase 1 scope only. This document inventories the NEAR surface area and proposes a phased plan for moving AZUKA from NEAR-native to Sui-native. No migration code should land until the user picks a cut-over strategy and a future chip starts Phase A.

Verified inputs:

- Memory confirms `ironshield.near` is still the live chain identity after the AZUKA rebrand.
- Mainnet `ironshield.near` is on Phase 9. Phase 10 contract code is merged but not deployed because `migrate_v10_economy()` still needs a testnet or sandbox round-trip.
- Tier 4 added connectors, Kits, OAuth, and Kit runtime. That work is heavily keyed by the signed wallet identity and `connector_credentials.user_wallet`.
- Production DB is Neon, not Render Postgres.
- Required grep found 287 non-generated files matching NEAR/auth/wallet terms, grouped as: root 8, agent 1, backend 122, bot 21, contract 20, docs 13, functions 1, manifests 3, scripts 13, src 85.
- `MIST` has no Sui-unit implementation in the app today. Matches were package names or English words like `optimistic` / `mistake`, not Sui amount math.
- Current Sui frontend docs now recommend `@mysten/dapp-kit-react` plus `@mysten/sui`; legacy `@mysten/dapp-kit` is JSON-RPC only and not the right new-project target. Sources: https://sdk.mystenlabs.com/dapp-kit and https://sdk.mystenlabs.com/sui/migrations/sui-2.0/dapp-kit.

## 1. Surface area inventory

`Lines` means exact line references from the grep/read pass. File totals use physical line counts from `Get-Content`, including blank lines.

| Layer | File / dir | NEAR-specific dependency | Lines | Effort |
|---|---|---|---|---|
| Dependencies | `package.json` | `@near-wallet-selector/*`, `near-api-js` | 32-38, 58; 82 lines | Replace with `@mysten/dapp-kit-react`, `@mysten/dapp-kit-core`, `@mysten/sui`; remove NEAR libs after dual-auth period |
| Contract | `contract/Cargo.toml` | `near-sdk`, `near-contract-standards` | 10-11; 25 lines | Rewrite in Move |
| Contract | `contract/src/*.rs` | NEAR contract model: `near_sdk`, `AccountId`, `env`, NEAR collections, promises, yocto deposits | 5,074 total lines across 16 Rust files | Rewrite in Sui Move; no safe line-by-line port |
| Contract storage | `contract/src/lib.rs` | NEAR prefix collections and account-id keys | Struct/storage around 78-238; init prefixes around 244-340 | Redesign around Sui object ownership, shared objects, dynamic fields, and package IDs |
| Contract migrations | `contract/src/migrate.rs` | Borsh state mirrors and NEAR upgrade migrations | migrate fns at 87, 264, 388, 511, 636, 713, 829, 943, 1059, 1190; 1,251 lines | Mostly discarded; use export/import or claim-based Sui initialization |
| Contract economy | `contract/src/mission_engine.rs`, `contract/src/kits.rs` | Phase 10 mission escrow and Kit registry on NEAR | mission fns 68-371; kit fns 47-179; 599 lines | Rebuild as Sui shared objects and owned payment flows |
| Contract agents/skills | `contract/src/agents.rs` | Agent profiles, handles, sub-agents, skills, permissions, connections keyed by `AccountId` | fns 319-1607; 1,610 lines | Rebuild identity model; Sui addresses are not human-readable NEAR account IDs |
| Contract staking/pro | `contract/src/actions.rs`, `admin.rs`, `views.rs`, `pro.rs`, `pool.rs`, `treasury.rs`, `ft_callbacks.rs` | NEAR staking, FT callbacks, yocto rewards, NEAR promises | 98 + 69 + 70 + 118 + 63 + 159 + 85 lines | Decide whether Sui v1 keeps staking/pro/treasury or defers them |
| Contract legacy | `contract/newscoin/**` | NEAR factory/registry/curve/rhea migrator | 4 files matched mandatory terms | Out of Sui v1 unless NewsCoin is explicitly revived |
| Backend auth | `backend/middleware/requireWallet.js` | NEP-413 Borsh encoding, `near-api-js` `PublicKey`, NEAR RPC access-key lookup, fixed recipient `ironshield.near` | 1-166; 167 lines | Add `requireSuiWallet` beside it, then dual-auth, then retire NEP-413 |
| Backend auth docs | `docs/auth-contract.md` | Full NEP-413 signed-message contract | 5, 11, 30-39, 57, 79, 130, 201, 215, 277, 302-303 | Replace with a Sui personal-message auth spec |
| Backend token auth | `backend/routes/auth.route.js` | Nonce + login flow depends on `requireWallet`; session token stores `wallet` | 2, 9, 17, 34-45; 73 lines | Keep nonce/session shape but add chain-aware wallet binding |
| Backend route gate | `backend/routes/*.route.js` | 42 route files import/use `requireWallet` or `req.wallet` | Exact route hits listed below; e.g. `dm.route.js` 31, `rooms.route.js` 22, `posts.route.js` 21, `agents.route.js` 18 | Dual-auth must preserve `req.wallet` or introduce `req.identity` compatibility layer |
| Backend admin/pro | `backend/middleware/requireAdmin.js`, `backend/middleware/requirePro.js` | Reads `req.wallet`; Pro checks NEAR contract via `near-api-js` | admin 28,31; pro 14,18,89,91; 151 total lines | Admin can stay DB-backed; Pro needs Sui contract read or off-chain flag |
| Backend route examples | `backend/routes/connectors.route.js` | Connector creds keyed by `req.wallet` | 39-41, 85-111, 129-148; 156 lines | Schema migration or claim flow required |
| Backend route examples | `backend/routes/missions.route.js` | `poster_wallet`, `claimant_wallet`, `escrow_yocto`, `req.wallet` authorization | 213-347; 372 lines | Rename amount units and address assumptions; keep route shape if dual-auth |
| Backend route examples | `backend/routes/payments.route.js` | PingPay routes funds into NEAR wallet; pending mission stores `escrow_yocto` | 1-28, 64-114, 173-246; 254 lines | Redesign Sui funding path and amount units |
| Backend route examples | `backend/routes/kitDeployments.route.js` | `agent_owner_wallet = req.wallet` | 52-107; 140 lines | Re-key deployments or bridge old owner to new Sui address |
| Backend chain signer | `backend/services/nearSigner.js` | Env private keys, `near-api-js` `Account`, `KeyPairSigner`, orchestrator `orchestrator.ironshield.near` | 1-55; deps at 20; env notes 5-12; 61 lines | Replace with Sui keypair/client for backend-owned admin/orchestrator actions |
| Backend indexer | `backend/services/missionIndexer.js` | Polls `list_missions` on `STAKING_CONTRACT_ID || ironshield.near` via `near-api-js` | 1-180; deps at 31-35; 192 lines | Replace with Sui event/object indexer |
| Backend governance | `backend/services/governanceListener.js` | Polls `ironshield.near`, finalizes/executes via NEAR agent account | 1-193; dependency at 24; env lines 34-43 | Either rebuild governance on Sui or freeze legacy governance |
| Backend automations | `backend/services/agents/automationExecutor.js` | Reads `get_skill_metadata` from `ironshield.near` via NEAR RPC | 8, 15-32, 146-157; 185 lines | Replace skill verification source with Sui object/event read |
| Backend payment verify | `backend/services/txVerify.js` | Verifies NEAR transfer receiver and yocto amount | 1-24; 27 lines | Replace with Sui tx/effects verification and MIST math |
| Backend balance | `backend/services/balanceLookup.js` | Reads NEAR and NEAR USDC variants via custodial helpers | 1-64; NEAR decimals at 30; output at 48-58 | Replace with Sui coin balance reads |
| Backend bid/DM fees | `backend/services/bidEngine.js`, `backend/routes/feed.route.js` | NEAR transfer stake and premium fee verification | bid lines 28-64, 112; feed lines 504-551 | Reprice in SUI or USD; use MIST base units |
| Backend Wallet Watch Kit | `backend/services/skills/watch_balance.js`, `backend/jobs/walletWatchPoller.job.js` | NEAR balance watcher and `*_yocto` fields | watch lines 18-66; poller 48, 116-184, 206-248; 390 total lines | Convert to Sui address balance watcher and MIST units |
| Backend connector store | `backend/connectors/credentialStore.js` | `wallet` and `user_wallet` are the owner key for encrypted Web2 creds | 128 lines; 7 NEAR/wallet hits | Needs old-NEAR to new-Sui claim decision |
| DB schema | `backend/db/schema.sql` | Wallet IDs and yocto amounts throughout Neon schema | `feed_users.wallet_address` 161-178; `auth_nonces` 1034-1045; `connector_credentials.user_wallet` 1441-1449; `agent_kits.curator_wallet` 1374-1398; `kit_deployments.agent_owner_wallet` 1421-1434; `missions.poster_wallet` 1261-1290; `pending_missions.poster_wallet` 1838-1876; 1,946 lines | Biggest non-contract migration risk |
| Frontend wallet provider | `src/lib/contexts.js` | Dynamic `near-api-js`; `@near-wallet-selector/*`; NEAR balance math `10^24`; wallet type `near` | imports 4-5; NEAR instance 7-27; selector 259-282; balance 331-339; chooser 466-512; 797 lines | Replace wallet stack with Sui dApp Kit while preserving app wallet context |
| Frontend auth fetch | `src/lib/apiFetch.js` | NEP-413 `signMessage`, `ironshield.near` recipient, `x-wallet` headers, `signedFetch` | 1-194; recipient 29; sign 67-92; headers 99-104; `apiFetch` 167; 218 lines | Rewrite signing path for Sui personal message; keep token caching |
| Frontend hook | `src/hooks/useNear.js` | Read/call methods on NEAR contracts; NEP-413 helper | 2-74; tx import 46; signMessage 63-71; 75 lines | Replace with `useSui` or split read/call helpers per Sui |
| Frontend config | `src/lib/nearConfig.js` | Mainnet/testnet IDs, `ironshield.near`, `claw.ironshield.near`, `AUTH_RECIPIENT` | 2-41; 41 lines | Replace with Sui network/package/coin config |
| Frontend payments | `src/lib/payments.js`, `src/lib/walletActions.js` | NEAR wallet-selector transfer/function-call actions and yocto parser | payments 2-46; walletActions 2-124; 184 total lines | Replace with Sui transaction blocks |
| Frontend Privy | `src/components/auth/PrivyWrapper.jsx` | Leaves NEAR to wallet selector; Privy currently only mirrors EVM/Solana | comments 70, 129; 155 lines | Decide if zkLogin/Privy becomes primary Sui sign-in or stays separate |
| Frontend Phase 10 UI | `src/app/agents/deploy/[kit_slug]/KitDeployClient.jsx`, `src/app/payments/success/PaymentsSuccessClient.jsx` | Create mission, NEAR wallet payment path, PingPay NEAR landing path | deploy 708-825; success 6, 122-146; 1,222 total lines | Convert create mission and payment UX to Sui |
| Frontend token UI | `src/app/automations/page.js`, `src/app/portfolio/page.js`, `src/app/rewards/page.js`, `src/app/messages/page.js`, `src/app/bridge/page.js` | NEAR labels, `.near` validation, NEARBlocks, bridge/intents, yocto/NEAR assumptions | automations 11-145; portfolio 7-139; rewards 19, 123, 924; messages 1797-2037, 2831-2839; bridge 5-96, 407-549 | Replace copy, explorer links, units, and address handling |
| Frontend high-use hooks | `src/hooks/useAgent.js`, `src/hooks/useGovernance.js`, `src/hooks/useAgentConnections.js` | Contract calls and wallet-keyed agent surfaces | useAgent 724 lines with 114 hits; useGovernance 32 hits; useAgentConnections 12 hits | Sui contract reads/writes and identity shape changes |
| Frontend API consumers | `src/components/**`, `src/app/**` | 85 frontend files match `apiFetch`, `useWallet`, `.near`, `yocto`, `NEAR`, or contract helpers | Exact match scan count: 85 files | Audit after backend dual-auth so UI can keep shipping |
| Bot wallet parser | `bot/utils/wallet.js` | NEAR named/implicit regex | 3-17 | Add Sui `0x` parser; decide if `.near` remains legacy |
| Bot custody | `backend/services/custodialBotWallet.js`, `bot/commands/custodial.js` | NEAR implicit accounts, `near-api-js` keys, NEAR Intents assets, yocto reserve | service 1-238; command 32-258, 339-451; 721 total lines | Reimplement on Sui or retire custodial bot wallet |
| Bot docs/setup | `bot/README.md`, `bot/setup.sh` | NEAR AI, `ironshield.near`, NEAR staking copy | README 34; setup 104-159, 217-225 | Docs/copy refresh after product decision |
| Env/deploy | `.env.example`, `.env.test.example`, `render.yaml` | `STAKING_CONTRACT_ID=ironshield.near`, `NEAR_RPC_URL`, `ORCHESTRATOR_ACCOUNT`, fee wallets | `.env.example` 25-34, 82-113, 159-167, 245-246; `render.yaml` 30-37, 82-89 | Add Sui envs alongside NEAR first |
| Scripts/tests | `scripts/**`, `backend/__tests__/**`, `e2e/**` | NEP-413 smoke helpers, contract deploys, NEAR fixtures like `alice.near`, yocto assertions | 13 scripts and many backend tests in 122 backend matches | Update test harness per phase; do not delete until dual-auth ends |
| Docs/catalogs | `docs/**`, `src/data/skillsCatalog*.json`, manifests | NEAR user-facing copy, pricing in NEAR, wallet-watch manifests | docs 13 files; manifests 3; catalog files matched | Docs/copy sweep after cut-over strategy |

Backend route gate details from the exact route scan:

| Route group | Files | NEAR auth shape |
|---|---|---|
| Social/feed/DM/profile/posts/rooms | `feed.route.js`, `social.route.js`, `dm.route.js`, `profile.route.js`, `posts.route.js`, `rooms.route.js` | `requireWallet` gates writes; `req.wallet` maps to `feed_users.wallet_address` or ownership checks |
| Agent economy | `agents.route.js`, `skills.route.js`, `missions.route.js`, `kitDeployments.route.js`, `payments.route.js`, `connectors.route.js`, `authProfiles.route.js` | `req.wallet` is owner, poster, claimant, connector credential key, or session owner |
| Ops/admin/security | `admin.route.js`, `leaderboard.route.js`, `security.route.js`, `verify.route.js`, `summary.route.js`, `research.route.js`, `ai.route.js` | `requireWallet` plus DB/admin gates or per-wallet AI limits |
| Product utilities | `bridge.route.js`, `trading.route.js`, `portfolio.route.js`, `tg.route.js`, `push.route.js`, `notifications.route.js`, `livekit.route.js`, `media.route.js`, `tips.route.js`, `xfeed.route.js` | Auth and ownership are still wallet-string based |

Contract functions that need Sui equivalents or explicit retirement:

- `admin.rs`: `add_pool`, `fund_rewards`, `set_paused`, `set_ironclaw_token`.
- `actions.rs`: `claim`, `unstake`.
- `views.rs`: `get_pool`, `get_pools_count`, `get_pools`, `get_user_info`, `pending_reward`, `get_contract_info`, `is_paused`.
- `governance.rs`: `create_proposal`, `vote`, `finalize_proposal`, `execute_proposal`, `get_proposals`, `get_proposal`, `get_vote`, `get_voting_power`.
- `treasury.rs`: `deposit_revenue`, `distribute_revenue`, `update_shares`, `set_revenue_recipients`, `get_treasury_stats`.
- `missions.rs`: `submit_mission_result`, `set_orchestrator`, `get_mission_result`, `get_approved_missions`, `get_orchestrator`.
- `pretoken.rs`: contributor/vanguard application, approval, revocation, NFT contract, token max, mode, and read methods.
- `agents.rs`: agent registration/profile, points, reputation, stats, tasks, permissions, sub-agents, framework connections, flags, skills create/update/verify/install/uninstall/list, IronClaw link/unlink.
- `mission_engine.rs`: `create_mission`, `claim_mission`, `submit_mission_work`, approve/reject/abort/expire, fee setter, mission reads.
- `kits.rs`: kit register/update/status/revenue split/read/list.
- `pro.rs`: `extend_lock`, `is_pro`, lock/minimum reads.
- `web4.rs`: `web4_get`, `web4_static_url`, `set_web4_url`; probably retire, because Cloudflare `azuka.pages.dev` is canonical.
- `migrate.rs`: all NEAR storage migrations; not portable to Sui except as historical export logic.

Storage migration shape:

| NEAR collection | Current meaning | Sui shape to consider |
|---|---|---|
| `p`, `u` | Pools and `(account,pool)` user staking | Shared staking object plus per-user stake objects, if staking survives |
| `g`, `v` | Governance proposals and votes | Shared governance object, proposal objects, vote receipts |
| `mr` | Mission result by proposal id | Move into new mission objects or off-chain mirror only |
| `c`, `a`, `n`, `V` | Pretoken contributor/vanguard registries | Likely retire or replace with Sui allowlist/NFT proof |
| `G`, `H` | Agent profiles and handle index | Shared registry object plus address-owned profile objects |
| `S` | Agent stats | Off-chain first unless stats must be trustless |
| `T` | Tasks | Off-chain first; Sui only if escrow/trust boundary needs it |
| `K`, `M`, `I` | Skills, metadata, installed skills | Shared skill registry plus per-owner install objects or off-chain installs |
| `P`, `F`, `R` | Permissions, flags, Pro locks | Address-owned config objects or DB-backed during transition |
| `L`, `X` | IronClaw source and framework connections | Keep public binding on-chain only if auditability is required |
| `O`, `Q` | Sub-agent lists and handle index | Sui owned agent objects; handles in shared registry |
| `B`, `k` | Phase 10 missions and Kits | Highest priority Sui rewrite: shared mission escrow objects and Kit registry |

Notes:

- Sui addresses are `0x` 32-byte hex. They do not behave like `alice.near` account names.
- NEAR amount math is `yoctoNEAR = 10^24`; Sui native unit is `MIST = 10^9`.
- The classifieds drift cron and scraper-fix chips are chain-independent. They are not killed by the Sui pivot, but they should be deprioritized behind migration foundations.

## 2. Migration phases

Each phase should be a separate future chip. Phase A should happen before any production-facing Sui UI or contract rewrite.

### Phase A: foundations, no user-visible change

Goals:

- Pick SDK stack: `@mysten/sui` for TypeScript clients and `@mysten/dapp-kit-react` / `@mysten/dapp-kit-core` for wallet UI. Do not start with legacy `@mysten/dapp-kit`.
- Pick Move toolchain and package layout, probably `sui move build` / Sui CLI for contracts.
- Provision Sui devnet/testnet account and document address ownership.
- Add Sui env names beside existing NEAR envs, not replacing them yet: package id, RPC/fullnode endpoint, admin address, orchestrator key/address, explorer base.
- Write a new auth spec beside `docs/auth-contract.md`: Sui personal-message signing, nonce, domain, headers, replay protection, and session-token binding.
- Stub backend dual-auth shape: `req.wallet` stays for compatibility, but new code should prefer a chain-aware identity like `{ chain, address }`.
- Document address format change: `*.near` strings become `0x...` Sui addresses. Any username-like identity must be a separate profile/handle field, not the wallet primary key.

Tradeoffs:

- Keeping `req.wallet` as a string is fastest but hides whether it is NEAR or Sui.
- Introducing `req.identity` is cleaner but touches many route handlers.
- Sui zkLogin changes UX deeply; extension wallets are a smaller technical jump.

### Phase B: contracts

Goals:

- Rewrite contract surface in Sui Move, not Rust.
- Decide which legacy modules survive Sui v1. I recommend Phase B1 includes only: agent profile registry, skills/metadata enough for marketplace, Kits, missions/escrow, Pro/admin if required for current UI gates.
- For every function listed in Section 1, mark one of: port now, port later, retire, off-chain only.
- Design Sui storage around objects:
- Agent registry: shared object for handles; owned `AgentProfile` objects by Sui address.
- Kit registry: shared object keyed by slug/dynamic fields.
- Mission escrow: shared or owned mission object with coin custody and state transitions.
- Skills: shared registry plus author-owned metadata if authors remain.
- Permissions: owner-owned capability/config object.
- Write testnet deployment plan first.
- Treat the existing Phase 10 NEAR deploy gate as obsolete for the Sui contract identity. A new Sui gate doc should replace it.

Deployment plan:

1. Sui devnet local smoke.
2. Sui testnet package publish.
3. Backend read-only indexer against Sui testnet.
4. Frontend preview against Sui testnet.
5. Fresh deploy gate doc for Sui mainnet package publish, including admin key custody and rollback limits.

Tradeoffs:

- Sui object model is a redesign, not a port. This is the largest work slice.
- NEAR Phase 10 storage migration work is sunk cost if we pivot before deploying it.
- A partial Sui contract can ship faster if old governance/staking/pretoken modules are retired.

### Phase C: backend auth

Goals:

- Add `requireSuiWallet` that verifies Sui personal-sign signatures.
- Preserve nonce replay protection and 24h session tokens.
- Run dual-auth: NEP-413 OR Sui during transition.
- Make session token payload include `chain` and `address`; never let a NEAR token satisfy a Sui-only write by accident.
- Keep route handlers stable at first by setting `req.wallet = address`, but add `req.walletChain = "sui"` or `req.identity`.
- Retire NEP-413 only after cut-over decision and data migration path are complete.

Tradeoffs:

- Dual-auth reduces user pain but doubles auth test cases.
- Big-bang auth is cleaner but forces all users to re-link immediately.

### Phase D: frontend wallet

Goals:

- Replace NEAR selector with Sui wallet kit.
- Current best target: `@mysten/dapp-kit-react` with `@mysten/sui`.
- Rewrite `apiFetch` signing path to use Sui personal message signing.
- Keep `apiFetch` session-token caching if possible; the nice part of the current NEP-413 flow is the one-sign-login.
- Update `WalletProvider` / `useWallet` shape so app surfaces still get `connected`, `address`, `walletType`, `balance`, and sign/call helpers.
- Audit all wallet-keyed UI surfaces: DMs, profile, posts, tips, kits, connectors, rooms, rewards, settings, agent dashboards.

Tradeoffs:

- A compatibility `useWallet` wrapper minimizes UI churn.
- A clean Sui-first provider is better long-term but touches many files at once.

### Phase E: token/balance UI

Goals:

- Replace NEAR amount math: `BigInt(yocto) / 10n**24n` becomes `BigInt(mist) / 10n**9n`.
- Replace currency labels and user copy from `NEAR` to `SUI` where the amount is chain-native.
- Replace NEARBlocks links with Sui explorer links.
- Replace NEAR Intents assumptions in bridge/payment flows with a Sui-native funding decision.
- Update Wallet Watch Kit to watch Sui balances and output `balance_mist`, `prev_balance_mist`, `delta_mist`.

Tradeoffs:

- Some "NEAR AI" references may remain if AZUKA still uses NEAR AI as an AI runtime. That is product/runtime branding, not chain settlement.
- Bridge/intent copy should not be renamed until the actual Sui payment path is chosen.

### Phase F: data migration

Goals:

- Decide whether to migrate old NEAR-linked data or start fresh.
- High-risk wallet-keyed tables:
- `connector_credentials.user_wallet`
- `feed_users.wallet_address` and every `feed_*` table linked through `feed_users.id`
- `agent_kits.curator_wallet`
- `kit_deployments.agent_owner_wallet`
- `missions.poster_wallet`, `missions.claimant_wallet`
- `pending_missions.poster_wallet`
- `auth_profiles.user_wallet`, `auth_profiles.agent_owner_wallet`
- `post_agent_bids.agent_owner_wallet`, `post_hires.agent_owner_wallet`, `bounty_attempts.agent_owner_wallet`, `post_dms.agent_owner_wallet`
- `admin_wallets.wallet`, `wallet_budgets.wallet`, `wallet_ai_spend.wallet`
- Pick one:
- Orphan old rows and require new Sui accounts.
- One-time signed claim flow: sign with old NEAR wallet and new Sui wallet to link old data to new identity.
- Admin-managed mapping for known users only.

Tradeoffs:

- Claim flow is more humane and much safer for connectors/DM history, but it adds auth complexity.
- Orphaning is fastest and cleanest but painful.
- Mapping by admin is risky unless the user base is tiny and known personally.

## 3. Cut-over strategy options

| Option | Estimate | User pain | Code maintenance burden | Tier 4 Kits + classifieds connector + Phase 10 impact |
|---|---:|---|---|---|
| 1. Big-bang | 4-6 weeks minimum | High. Users must reconnect/recreate or claim on a fixed date | Low after cut-over, high during launch week | Kits and connectors must be re-keyed or reset before launch. Classifieds scraper can keep running because it is chain-independent. NEAR Phase 10 on-chain work is abandoned or archived |
| 2. Dual-chain bridge period | 6-10 weeks minimum | Medium. Users can migrate when ready | High. NEAR and Sui auth, data, tests, and support paths coexist for about 3 months | Best preservation path for Tier 4 Kits/connectors. Requires claim flow for connector credentials and kit deployments. Phase 10 NEAR can stay undeployed while Sui contract becomes source of truth |
| 3. Net-new Sui project | 4-8 weeks minimum | Medium-high. Existing users/data stay on legacy AZUKA; Sui users start fresh | Medium-high. Two products or branches need care | Fastest path to a working Sui-native v1. Tier 4 Kits can be copied conceptually, not migrated. Classifieds scraper can be reused. Existing Phase 10 NEAR work remains legacy and probably never deploys |

Recommendation:

Option 2 is the safest product path if existing users, connector credentials, DMs, and Kit deployments matter. It is also the most engineering work. If the user wants fastest Sui momentum and can accept old data staying behind, Option 3 is the practical "stop the bleeding" path. I do not recommend Option 1 unless the current user base is tiny and the user is comfortable forcing everyone through a hard reset.

Plain-English version:

- Big-bang is clean code, angry users.
- Dual-chain is kinder to users, messier code.
- Net-new Sui is fastest to ship, but the old house stays standing next door.

## 4. Open questions for the user

1. Which Sui wallet target comes first: Sui Wallet, Suiet, OKX, Phantom Sui, zkLogin, Slush, or "any wallet supported by dApp Kit"?
2. Which cut-over strategy do you want: big-bang, dual-chain bridge period, or net-new Sui project?
3. Do you already own the Sui admin address that replaces `ironshield.near`, or should Phase A provision one?
4. Do you accept that the NEAR Phase 10 mainnet deploy gate becomes sunk cost if AZUKA pivots before deployment?
5. Should AZUKA use zkLogin for web2-style onboarding, extension wallets for crypto-native users, or both?
6. What should happen to the custodial Telegram bot wallet: keep NEAR as a cross-chain sidecar, retire it, or reimplement custody on Sui?
7. Should existing connector credentials and Kit deployments be claimable from old NEAR wallets, or can Sui AZUKA start with empty connections?
8. Does Sui v1 need governance/staking/pretoken features, or can v1 focus on agents, Kits, missions, and connector runtime?
9. Should NEAR AI / IronClaw runtime references remain as the AI backend, even if settlement and identity move to Sui?
10. What is the desired user-facing chain name: "Sui-native AZUKA" everywhere, or only wallet/payment surfaces?

## 5. Concrete first commit

Smallest, lowest-risk first commit:

- Commit only this file: `docs/SUI_MIGRATION_PLAN.md`.

Do not add Sui packages yet. Do not create `contract-sui/` yet. Do not edit backend/frontend/contract production code yet.

Reason:

- This keeps NEAR-side production untouched.
- It gives the user a decision point before code starts moving.
- It avoids a half-scaffolded Sui branch before the cut-over strategy is chosen.

Suggested next chip after user picks strategy:

- If Option 2: start Phase A with a dual-auth design doc plus Sui auth proof-of-concept behind tests only.
- If Option 3: start Phase A with a separate Sui v1 branch and a tiny Move package skeleton after the user approves the fork strategy.
- If Option 1: start Phase A with a hard cut-over checklist, data export snapshot plan, and downtime/relink notice plan.
