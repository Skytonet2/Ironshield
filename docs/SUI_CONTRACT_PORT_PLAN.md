# Sui Contract Port Plan

Status: Phase B.1 design only. This document scopes how the current NEAR contract should be ported to Sui Move. It does not add Move code, change production NEAR code, or mount any Sui contract integration.

## 1. Grounding

Verified inputs:

- Contract source read from `contract/src/*.rs`.
- Current NEAR contract package: `contract/Cargo.toml`, `near-sdk = "=5.1.0"`, `near-contract-standards = "=5.1.0"`.
- Current live identity is still `ironshield.near`; AZUKA is the product name.
- Phase 10 NEAR economy code exists in source but memory says it is not deployed to mainnet yet.
- Phase A Sui auth foundation is already in PR #139 and does not replace NEAR auth.

Sui docs checked while designing this shape:

- https://docs.sui.io/
- https://docs.sui.io/doc/sui-cli-cheatsheet.pdf
- https://intro.sui-book.com/unit-two/lessons/2_ownership.html
- https://intro.sui-book.com/unit-four/lessons/2_dynamic_fields.html
- https://move-book.com/reference/abilities/object

Important Sui translation rule in plain English: NEAR keeps "one big contract account with maps inside it." Sui keeps "objects." Some objects are owned by a wallet, and some are shared so many people can touch them. AZUKA needs both.

## 2. Contract Surface Summary

Mechanical scan result:

| Category | Count | Notes |
|---|---:|---|
| `pub fn` methods across `contract/src/*.rs` | 145 | Includes old NEAR migration functions. |
| `pub fn` methods excluding `migrate.rs` | 135 | Main app/API surface. |
| NEP-141 callback not counted by `pub fn` scan | 1 | `ft_on_transfer` in `ft_callbacks.rs`. |
| NEAR migration functions | 10 | Do not port as Move entry functions. |
| Public structs / response structs | 24 | Includes `StakingContract`, view structs, and model structs. |

Recommended Sui v1 posture:

- Port the agent economy first: agents, skills, kits, structured missions, minimal treasury.
- Defer legacy staking/pro/governance until product confirms Sui-native token and governance direction.
- Do not port NEAR Web4; Sui does not have the same `near.page` gateway contract model.
- Do not port NEAR in-place migration functions; Sui migration should be export/import or claim-based.

## 3. Exported Method Inventory

Each row lists NEAR methods verified on disk and the proposed Sui destination. Line numbers are from the current branch.

| NEAR file | Count | Methods | Sui module / action |
|---|---:|---|---|
| `lib.rs` | 1 | `new` 244 | `azuka::core::init` creates shared registry/config plus admin cap. |
| `admin.rs` | 4 | `add_pool` 16, `fund_rewards` 44, `set_paused` 56, `set_ironclaw_token` 65 | `azuka::staking` if staking is kept; `set_paused` belongs in `azuka::core`. |
| `ft_callbacks.rs` | 1 | `ft_on_transfer` 19 | Do not port directly. Sui should pass `Coin<IRONCLAW>` / `Balance<IRONCLAW>` into a stake entry function in a PTB. |
| `actions.rs` | 2 | `claim` 16, `unstake` 40 | `azuka::staking`, deferred unless Sui IRONCLAW is approved. |
| `views.rs` | 7 | `get_pool` 8, `get_pools_count` 13, `get_pools` 18, `get_user_info` 25, `pending_reward` 31, `get_contract_info` 45, `is_paused` 57 | Most become object reads/indexer queries, not entry functions. |
| `pro.rs` | 5 | `extend_lock` 58, `is_pro` 95, `get_pro_lock_until` 105, `get_pro_min_stake` 111, `get_pro_min_lock_seconds` 115 | Defer with staking. If kept, `azuka::pro` depends on Sui staking position objects. |
| `governance.rs` | 8 | `create_proposal` 20, `vote` 74, `finalize_proposal` 117, `execute_proposal` 132, `get_proposals` 149, `get_proposal` 156, `get_vote` 161, `get_voting_power` 167 | Defer/rebuild as `azuka::governance`; voting source changes on Sui. |
| `missions.rs` | 5 | `submit_mission_result` 17, `set_orchestrator` 70, `get_mission_result` 80, `get_approved_missions` 88, `get_orchestrator` 101 | Legacy proposal-based mission flow. Prefer retiring in favor of `mission_engine.rs`. |
| `pretoken.rs` | 19 | `request_contributor` 41, `approve_contributor` 61, `reject_contributor` 75, `revoke_contributor` 81, `add_vanguard_nft_contract` 89, `set_vanguard_token_id_max` 99, `register_vanguard` 109, `register_vanguard_callback` 136, `revoke_vanguard` 162, `set_pretoken_mode` 170, `get_pretoken_mode` 177, `is_contributor` 181, `is_vanguard` 185, `get_contributor` 189, `get_pending_applications` 193, `get_contributors` 197, `get_vanguard_nft_contracts` 204, `get_vanguard_token_id_max` 210, `get_pretoken_power` 219 | Defer or replace. NEAR NFT ownership callback does not port 1:1. |
| `agents.rs` | 56 | `register_agent` 319, `set_agent_account` 355, `update_agent_bio` 372, `award_points` 390, `record_submission` 434, `record_mission_complete` 477, `set_agent_reputation` 529, `get_agent` 546, `get_agent_by_handle` 550, `is_handle_available` 556, `get_points` 561, `get_leaderboard` 572, `get_agents_count` 581, `get_total_points_issued` 585, `get_agent_stats` 595, `get_agent_activity` 602, `assign_task` 620, `cancel_task` 674, `complete_task` 695, `get_agent_tasks` 739, `set_agent_permissions` 748, `set_agent_daily_limit` 769, `record_agent_spend` 802, `get_agent_permissions` 836, `get_current_day_index` 843, `register_sub_agent` 907, `update_sub_agent_bio` 961, `remove_sub_agent` 976, `list_sub_agents` 1001, `get_sub_agent` 1007, `get_sub_agents_total` 1016, `set_agent_connection` 1051, `remove_agent_connection` 1118, `mark_agent_connection_seen` 1143, `get_agent_connections` 1159, `list_agent_connections_for_owner` 1167, `get_agent_connections_total` 1191, `set_subscription` 1201, `set_public` 1216, `get_agent_flags` 1231, `get_public_agents` 1237, `create_skill` 1285, `update_skill_metadata` 1353, `set_skill_verified` 1392, `install_skill` 1411, `uninstall_skill` 1480, `get_skill` 1500, `get_skill_metadata` 1507, `list_skills` 1512, `list_skills_with_metadata` 1524, `get_installed_skills` 1542, `get_installed_skills_with_metadata` 1550, `get_skills_count` 1563, `link_to_ironclaw` 1580, `unlink_from_ironclaw` 1598, `get_ironclaw_source` 1607 | Split across `azuka::agents`, `azuka::skills`, and off-chain indexer reads. This is the biggest Sui v1 module group. |
| `mission_engine.rs` | 13 | `create_mission` 68, `claim_mission` 123, `submit_mission_work` 151, `approve_mission` 186, `reject_mission` 216, `abort_mission` 241, `expire_mission` 268, `set_mission_default_fee_bps` 301, `get_mission` 313, `list_missions` 319, `list_open_missions` 335, `get_missions_for_claimant` 353, `get_missions_for_poster` 371 | Port as `azuka::missions`. Escrow should be a Sui `Balance<SUI>` / `Coin<SUI>` held by a Mission object. |
| `kits.rs` | 7 | `register_kit` 47, `update_kit_manifest` 105, `set_kit_status` 119, `update_kit_revenue_split` 139, `get_kit` 163, `list_kits` 170, `list_kits_by_status` 179 | Port as `azuka::kits`. Keep off-chain manifest hash anchor. |
| `treasury.rs` | 5 | `deposit_revenue` 42, `distribute_revenue` 64, `update_shares` 105, `set_revenue_recipients` 131, `get_treasury_stats` 144 | Port minimal treasury as `azuka::treasury`; SUI/MIST split instead of NEAR/yocto. |
| `web4.rs` | 3 | `web4_get` 86, `web4_static_url` 100, `set_web4_url` 107 | Retire/replace with normal hosting config. |
| `migrate.rs` | 10 | `migrate` 87, `migrate_v8_agent_connections` 264, `migrate_v7c_multi_agent` 388, `migrate_v7b_agent_permissions` 511, `migrate_v7_skill_metadata` 636, `migrate_v6_ironclaw_link` 713, `migrate_v5_tasks_skills` 829, `migrate_v4_agent_stats` 943, `migrate_add_agents` 1059, `migrate_v10_economy` 1190 | Do not port. Replace with a one-time data export/import or user claim flow. |

## 4. Storage Layout Mapping

Current NEAR storage is one `StakingContract` state struct with prefixed collections. Sui should not copy prefix maps directly. Use shared registry/catalog objects for global indexes and owned/shared child objects for user resources.

| NEAR storage field | Prefix / type | Current role | Sui shape |
|---|---|---|---|
| `owner_id` | scalar | Contract admin | `AdminCap` owned by deployer plus `Config.admin: address`. |
| `paused` | scalar | Emergency stop | `Config.paused: bool` in shared config. |
| `ironclaw_token_id` | scalar `AccountId` | NEP-141 token contract | Sui coin type parameter, e.g. `Coin<IRONCLAW>`, only if staking is kept. |
| `pools` | `Vector<PoolInfo>` prefix `p` | Staking pools | `PoolRegistry` shared object with pool dynamic fields or vector. Defer. |
| `user_info` | `LookupMap<String, UserInfo>` prefix `u` | Stake position by `account:pool` | Owned `StakePosition` object or dynamic field keyed by `(owner, pool_id)`. Defer. |
| `reward_per_ns`, `last_reward_time`, `total_alloc_point` | scalars | MasterChef reward math | Fields on `PoolRegistry`. Use `Clock` object for time. Defer. |
| `proposals` | `Vector<Proposal>` prefix `g` | Legacy governance proposals | Shared `GovernanceRegistry` plus `Proposal` objects. Defer. |
| `votes` | `LookupMap<String, String>` prefix `v` | Vote receipt by `proposal:account` | Vote receipt objects/dynamic fields keyed by proposal and voter. Defer. |
| `mission_results` | `LookupMap<u32, MissionResult>` prefix `mr` | Legacy proposal mission outputs | Retire if Phase 10 missions replace it. |
| `orchestrator_id` | scalar | Authorized bot account | `Config.orchestrator: address` or `OrchestratorCap`. |
| `total_revenue`, `distributed_revenue`, share bps, recipient wallets | scalars | Treasury accounting | Shared `Treasury` object with `Balance<SUI>` and recipient addresses. |
| `pretoken_mode` | scalar | Contributor/vanguard voting switch | Defer. Likely off-chain/admin-only for Sui v1. |
| `contributors` | prefix `c` | Approved contributor registry | `ContributorRegistry` dynamic fields or off-chain DB with optional attestations. |
| `pending_applications` | prefix `a` | Contributor applications | Probably off-chain first; on-chain only if governance returns. |
| `vanguard_nft_contracts` | prefix `n` | NEAR NFT whitelist | Not portable. Replace with Sui collection allowlist if this product feature survives. |
| `vanguard_verified` | prefix `V` | NEAR NFT verified wallets | Claim/migrate separately or retire. |
| `agent_profiles` | prefix `G` | Primary agent by owner wallet | Owned `AgentProfile` object plus shared handle index. |
| `agent_handles` | prefix `H` | Unique handle -> owner | Shared `AgentRegistry` dynamic field `handle -> profile_id/address`. |
| `total_points_issued` | scalar | Points accounting | Field on shared `AgentRegistry`; maybe off-chain if points are not tokenized. |
| `agent_stats` | prefix `S` | Activity counters and weekly points | `AgentStats` child object or off-chain indexer with event replay. |
| `agent_tasks` | prefix `T` | Per-owner task ring | Off-chain DB or owned `TaskBook`; only anchor hashes on-chain if needed. |
| `skills` | prefix `K` | Global skill catalog | Shared `SkillCatalog` with `Skill` objects/dynamic fields. |
| `next_skill_id` | scalar | Skill ID counter | Field on `SkillCatalog`. |
| `installed_skills` | prefix `I` | Per-owner installed skill IDs | `InstallReceipt` objects owned by user or dynamic field under `AgentProfile`. |
| `agent_flags` | prefix `F` | Public/subscription flags | Field on `AgentProfile` or small `AgentFlags` child. |
| `ironclaw_sources` | prefix `L` | Linked external IronClaw source | Field on `AgentProfile` or off-chain profile metadata. |
| `skill_metadata` | prefix `M` | Extended skill metadata | Merge into `Skill` object or keep off-chain manifest hash. |
| `agent_permissions` | prefix `P` | Agent capability mask and daily spend limit | `AgentPermission` child object; change `yocto` fields to `mist` if spending SUI. |
| `owner_agents` | prefix `O` | Secondary agents per wallet | Owned `SubAgent` objects, indexed by `AgentRegistry`. |
| `sub_agent_handles` | prefix `Q` | Unique sub-agent handle -> owner | Same shared handle index as primary agents, with namespace flag. |
| `agent_connections` | prefix `X` | Public framework bindings | Child objects or events; secrets remain backend-only. |
| `missions` | prefix `B` | Structured escrow missions | Shared `Mission` objects holding escrow balance and lifecycle fields. |
| `next_mission_id` | scalar | Mission counter | Field on shared `MissionRegistry`. |
| `kits` | prefix `k` | Kit catalog rows | Shared `KitCatalog` with dynamic fields by slug. |
| `pro_locks` | prefix `R` | Pro lock-until timestamp | Defer with staking/pro; if kept, `ProLock` object keyed by owner. |
| raw `WEB4_STATIC_URL` | raw storage key | NEAR Web4 static target | Do not port. Use frontend/deploy config. |

## 5. Proposed Sui Package Shape

This is the target module map, not implementation.

| Sui module | Owns | Notes |
|---|---|---|
| `azuka::core` | `Config`, `AdminCap`, pause flag, orchestrator address/cap | Create first. Every other module checks admin/orchestrator through this. |
| `azuka::agents` | `AgentRegistry`, `AgentProfile`, `SubAgent`, flags, permissions, connections | High priority. Keeps `req.wallet`-style identity useful after Sui auth lands. |
| `azuka::skills` | `SkillCatalog`, `Skill`, metadata, install receipts | High priority if AZUKA keeps Tier 4 Kits and skills marketplace as core product. |
| `azuka::kits` | `KitCatalog`, `Kit` rows keyed by slug | High priority because Tier 4 work depends on kits. |
| `azuka::missions` | `MissionRegistry`, `Mission`, SUI escrow lifecycle | High priority if classified/workflow economy stays in Sui v1. |
| `azuka::treasury` | `Treasury`, revenue balance, bps splits | Medium priority; can be minimal for mission/platform fees. |
| `azuka::staking` | `PoolRegistry`, `StakePosition`, reward accounting | Defer unless Sui-native IRONCLAW token is approved. |
| `azuka::pro` | `ProLock` / pro eligibility | Defer; depends on staking. |
| `azuka::governance` | Proposal/vote objects | Defer/rebuild. Current governance depends on NEAR stake and NEAR NFT contributor paths. |
| `azuka::legacy_missions` | Proposal-based mission result reporting | Prefer not to create. Phase 10 `missions` supersedes it. |

## 6. Sui-Specific Design Decisions

### Shared vs owned objects

- Global catalogs and registries need shared objects: `Config`, `AgentRegistry`, `SkillCatalog`, `KitCatalog`, `MissionRegistry`, `Treasury`.
- User resources should be owned where possible: `AgentProfile`, `InstallReceipt`, maybe `StakePosition`.
- Escrow missions probably need shared `Mission` objects because poster, claimant, and anyone calling `expire_mission` can mutate lifecycle state.
- Shared objects are simpler for global coordination but cost more and serialize more transactions than owned objects. Use them only where multiple independent wallets must mutate the same state.

### IDs and indexes

- NEAR uses numeric IDs and map prefixes. Sui should use object IDs as the durable identity and keep numeric counters only for UI continuity.
- For handles/slugs, keep a shared uniqueness index. The object itself can store the display handle/slug.
- Listing functions like `list_skills`, `list_kits`, `get_public_agents`, and `list_missions` should mostly become indexer/API reads. Do not try to make every list query a Move function.

### Time

- NEAR uses `env::block_timestamp()` in nanoseconds.
- Sui Move should use the Sui `Clock` object for mission review windows, pro locks, activity timestamps, and reward math.
- Store timestamps consistently as milliseconds or nanoseconds after checking the exact framework convention during implementation.

### Money

- NEAR native amounts are yoctoNEAR, `10^24`.
- Sui native amounts are MIST, `10^9`.
- Contract fields and event names should stop saying `yocto`. Use `mist`, `amount`, or type-specific names.
- Paid skill installs and mission escrow should accept `Coin<SUI>` first unless the user approves a Sui `IRONCLAW` coin.

### Events

- NEAR emits stringified `EVENT_JSON`.
- Sui should emit typed Move event structs. Backend indexers should consume event types, not parse strings.

### Upgrade model

- NEAR upgrades one account's WASM and can run private migration methods against existing state.
- Sui publishes packages and manages objects. Package upgrades are possible but object layout changes need explicit compatibility planning.
- The first Sui contract should be intentionally smaller than the NEAR contract, because porting all legacy maps at once will create a brittle shared-object mega-contract.

## 7. Recommended Port Order

Each item should be a separate future chip.

1. `contract-sui/` skeleton and package conventions

- Create a Sui Move package only after this design is approved.
- Add no frontend/backend wiring yet.
- Include localnet/testnet instructions and object IDs in a deploy doc.

2. Core config and admin capability

- Implement `Config`, `AdminCap`, pause flag, admin transfer/rotation, orchestrator setting.
- Tests: admin-only guards, pause guard, cap ownership.

3. Kits catalog

- Port `register_kit`, `update_kit_manifest`, `set_kit_status`, `update_kit_revenue_split`.
- Keep off-chain manifest hash model.
- Reads should be via object/event indexer.

4. Agents and skills

- Port primary agent profile, handle uniqueness, flags, permissions, skills catalog, paid/free install receipts.
- Avoid porting every activity/stat list as on-chain storage if backend can derive it from events.

5. Structured missions and escrow

- Port `create_mission`, `claim_mission`, `submit_mission_work`, `approve_mission`, `reject_mission`, `abort_mission`, `expire_mission`.
- Use SUI escrow in MIST.
- Model review deadline with `Clock`.

6. Minimal treasury

- Port revenue recipients, bps checks, and mission/platform fee capture.
- Decide whether revenue distribution happens on-chain or backend-indexed first.

7. Optional staking/pro/governance rebuild

- Only after user confirms a Sui-native IRONCLAW token, Pro membership model, and governance source.
- This is not a line-by-line port; it is a product redesign.

## 8. Keep / Defer Recommendation

| Area | Recommendation | Why |
|---|---|---|
| Core admin/pause/orchestrator | Keep for Sui v1 | Needed by every other module. |
| Kits | Keep for Sui v1 | Recent Tier 4 work depends on kit integrity anchors. |
| Agents | Keep for Sui v1 | App identity, dashboard, skills, connectors, and permissions depend on it. |
| Skills marketplace | Keep for Sui v1, possibly simplified | User-facing product surface. Paid install math ports cleanly to SUI. |
| Structured missions | Keep for Sui v1 | Phase 10 economy code is the cleanest on-chain escrow model. |
| Treasury | Keep minimal | Needed for platform fees, but full revenue distribution can be deferred. |
| Legacy proposal missions | Defer/retire | Superseded by structured missions. |
| Staking pools | Defer | Requires Sui-native IRONCLAW decision and tokenomics review. |
| Pro lock | Defer | Depends on staking. |
| Governance | Defer/rebuild | Current voting power is NEAR-specific. |
| Pretoken contributor/vanguard | Defer/rebuild | NEAR NFT callback and account model do not port. |
| Web4 | Retire | NEAR-specific hosting adapter. |
| NEAR migrations | Retire | Sui migration is data import/claim, not WASM state migration. |

## 9. Data Migration Shape

Do not try to replay NEAR storage prefixes into Sui directly.

Recommended migration model:

1. Export current NEAR state and Neon rows into versioned JSON snapshots.
2. Normalize every wallet field from NEAR `AccountId` into a chain-aware identity record.
3. For user-owned records, require a signed claim: old NEAR wallet signs, new Sui wallet signs, backend records the link.
4. For admin-owned catalogs, owner imports curated rows directly: kits, verified skills, initial catalog metadata.
5. For mission/escrow money, do not silently migrate funds. Freeze or settle NEAR missions first, then start fresh Sui missions.

Collection-specific migration:

| Collection | Migration shape |
|---|---|
| Agent profiles/handles | Claim-based if user-owned. Admin can reserve handles during transition to prevent squatting. |
| Skills | Admin import verified public skills; authors claim ownership later. |
| Skill installs | Recreate as off-chain history first; only mint Sui install receipts for claimed users if product needs it. |
| Kits | Admin import from current Tier 4 seeded catalog and on-chain hashes. |
| Agent permissions/connections | Recreate after Sui sign-in; do not migrate secrets on-chain. |
| Missions | Do not migrate active escrow. Settle/freeze on NEAR and create new Sui missions. |
| Treasury/revenue | Snapshot accounting only; do not bridge treasury funds without explicit bridge ops. |
| Staking/pro/governance | No automatic migration until Sui token/governance design exists. |

## 10. Main Risks

- A literal port creates one huge shared object and loses much of Sui's advantage.
- Porting staking before tokenomics are decided can trap the team in a fake Sui-native design that is really just NEAR logic wearing Sui clothes.
- Listing/query methods are cheap on NEAR but awkward on-chain in Sui. The backend indexer should carry more list/read work.
- Mission escrow is the highest financial-risk module. It needs isolated tests before any frontend wiring.
- Existing Tier 4 Kits and connector work are not dead, but their on-chain anchors should move after core Sui identity and kit catalog are stable.
- The separate scraper chips remain valid because scrapers do not depend on NEAR, but the Sui pivot should deprioritize non-critical scraper polish until the contract/auth path is settled.

## 11. Open Questions

1. Do we keep Sui-native IRONCLAW in v1, or ship with SUI payments only?
2. Should Pro remain stake-locked, or become a Sui subscription/pass object?
3. Is governance required for Sui v1, or can owner/admin curation ship first?
4. Do we reserve old NEAR handles on Sui until users claim them?
5. Should paid skills charge SUI, a future AZUKA/IRONCLAW coin, or stay free until token launch?
6. Should missions use one shared registry plus shared mission objects, or one shared registry with mission data stored as dynamic fields?
7. Does the orchestrator get an address-only admin check, or an owned `OrchestratorCap` object?
8. Which current Phase 10 NEAR methods are still product-critical after the Sui pivot?

## 12. Concrete Next Commit After Approval

Smallest safe implementation commit after this doc:

- Create `contract-sui/Move.toml` and a minimal `sources/core.move` with only package constants/types for `Config` and `AdminCap`.
- Add no frontend integration.
- Add no backend route integration.
- Add a local Sui build/test command in docs only after the CLI/runtime is confirmed on the machine.

Recommended next chip: `Phase B.2 - Sui Move package skeleton and core admin config`.
