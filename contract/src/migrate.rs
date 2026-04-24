// contract/src/migrate.rs
//
// State migration from the deployed contract at ironshield.near
// (code_hash 8itAFEXWgDCJBaFeboqVz7LGmp9EnEc2hAq8JnUqHzQa) into the
// Phase-2 contract that adds pre-token governance fields.
//
// The deployed contract already has staking + governance + mission execution
// + treasury (mission_results, orchestrator_id, treasury bps splits, three
// recipient wallets). We confirmed the on-chain state shape by reading raw
// view_state and decoding the borsh-serialized STATE blob.
//
// Borsh deserializes a struct by reading fields in declaration order with
// no schema embedded, so the only safe upgrade is to define a parallel
// struct that matches the OLD shape byte-for-byte, read it, and re-pack
// into the new shape.
//
// The first 19 fields of `StakingContract` (owner_id … proposer_wallet)
// are unchanged from the deployed version. The six new pre-token fields
// are initialized fresh; their storage prefixes (b"c", b"a", b"n", b"V")
// don't collide with any prefix already in use (b"p", b"u", b"g", b"v",
// b"mr").

use crate::*;
use near_sdk::store::{
    LookupMap as OldLookupMap, LookupSet as OldLookupSet,
    UnorderedMap as OldUnorderedMap, Vector as OldVector,
};

/// Byte-for-byte mirror of the deployed `StakingContract` state.
/// DO NOT change this struct after the upgrade has run on mainnet — its only
/// purpose is to read the pre-Phase-2 storage. If we ever need a Phase-3
/// migration, add a NEW Old* struct rather than editing this one.
#[near(serializers=[borsh])]
struct OldStakingContract {
    owner_id:               AccountId,
    ironclaw_token_id:      AccountId,
    pools:                  OldVector<PoolInfo>,
    user_info:              OldLookupMap<String, UserInfo>,
    reward_per_ns:          Balance,
    last_reward_time:       u64,
    total_alloc_point:      u32,
    paused:                 bool,
    proposals:              OldVector<Proposal>,
    votes:                  OldLookupMap<String, String>,
    mission_results:        OldLookupMap<u32, MissionResult>,
    orchestrator_id:        AccountId,
    total_revenue:          Balance,
    distributed_revenue:    Balance,
    staker_share_bps:       u32,
    contributor_share_bps:  u32,
    reserve_share_bps:      u32,
    proposer_share_bps:     u32,
    contributor_wallet:     AccountId,
    reserve_wallet:         AccountId,
    proposer_wallet:        AccountId,
}

#[near]
impl StakingContract {
    /// One-shot migration: upgrade the deployed contract state to Phase 2 in place.
    ///
    /// `#[init(ignore_state)]` lets us bypass the usual `state_exists`
    /// guard so we can read the old state shape, then overwrite it with
    /// the new one. `#[private]` restricts callers to the contract account
    /// itself — and we issue this call from the same atomic deploy
    /// transaction, so it's only ever invoked once.
    ///
    /// If migrate() panics for any reason (e.g. struct shape mismatch),
    /// the entire deploy + migrate transaction reverts atomically and the
    /// contract stays on the previous code. There is no partial-upgrade
    /// failure mode.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: OldStakingContract = env::state_read()
            .expect("No state to migrate — was the contract ever initialized?");

        let mut vanguard_nft_contracts = Vector::new(b"n");
        vanguard_nft_contracts.push("nearlegion.nfts.tg".parse().unwrap());

        env::log_str("EVENT_JSON:{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"state_migrated\",\"data\":{\"to\":\"phase2\"}}");

        Self {
            owner_id:              old.owner_id,
            ironclaw_token_id:     old.ironclaw_token_id,
            pools:                 old.pools,
            user_info:             old.user_info,
            reward_per_ns:         old.reward_per_ns,
            last_reward_time:      old.last_reward_time,
            total_alloc_point:     old.total_alloc_point,
            paused:                old.paused,
            proposals:             old.proposals,
            votes:                 old.votes,
            mission_results:       old.mission_results,
            orchestrator_id:       old.orchestrator_id,
            total_revenue:         old.total_revenue,
            distributed_revenue:   old.distributed_revenue,
            staker_share_bps:      old.staker_share_bps,
            contributor_share_bps: old.contributor_share_bps,
            reserve_share_bps:     old.reserve_share_bps,
            proposer_share_bps:    old.proposer_share_bps,
            contributor_wallet:    old.contributor_wallet,
            reserve_wallet:        old.reserve_wallet,
            proposer_wallet:       old.proposer_wallet,

            // Pre-token governance defaults
            pretoken_mode:          true, // ON until $IRONCLAW launches
            contributors:           UnorderedMap::new(b"c"),
            pending_applications:   UnorderedMap::new(b"a"),
            vanguard_nft_contracts,
            vanguard_verified:      LookupSet::new(b"V"),
            vanguard_token_id_max:  1000,

            // Agent profiles + points (initialized empty on Phase 1 → Phase 5 path)
            agent_profiles:      UnorderedMap::new(b"G"),
            agent_handles:       UnorderedMap::new(b"H"),
            total_points_issued: 0,
            agent_stats:         UnorderedMap::new(b"S"),
            agent_tasks:         UnorderedMap::new(b"T"),
            next_task_id:        0,
            skills:              UnorderedMap::new(b"K"),
            next_skill_id:       0,
            installed_skills:    UnorderedMap::new(b"I"),
            agent_flags:         UnorderedMap::new(b"F"),
            ironclaw_sources:    UnorderedMap::new(b"L"),
            // Phase 7 — empty on every upgrade path; `create_skill` and
            // `update_skill_metadata` populate it lazily. Prefix b"M".
            skill_metadata:      UnorderedMap::new(b"M"),
            // Phase 7B — empty on every upgrade path. Prefix b"P".
            agent_permissions:   UnorderedMap::new(b"P"),
        }
    }
}

/// Byte-for-byte mirror of the Phase-5 (post-`migrate_v5_tasks_skills()`)
/// shape. Used by `migrate_v6_ironclaw_link()` to add the `ironclaw_sources`
/// storage without disturbing existing state. Do NOT edit after the Phase 6
/// upgrade has run on mainnet.
#[near(serializers=[borsh])]
struct Phase5StakingContract {
    owner_id:               AccountId,
    ironclaw_token_id:      AccountId,
    pools:                  OldVector<PoolInfo>,
    user_info:              OldLookupMap<String, UserInfo>,
    reward_per_ns:          Balance,
    last_reward_time:       u64,
    total_alloc_point:      u32,
    paused:                 bool,
    proposals:              OldVector<Proposal>,
    votes:                  OldLookupMap<String, String>,
    mission_results:        OldLookupMap<u32, MissionResult>,
    orchestrator_id:        AccountId,
    total_revenue:          Balance,
    distributed_revenue:    Balance,
    staker_share_bps:       u32,
    contributor_share_bps:  u32,
    reserve_share_bps:      u32,
    proposer_share_bps:     u32,
    contributor_wallet:     AccountId,
    reserve_wallet:         AccountId,
    proposer_wallet:        AccountId,
    pretoken_mode:          bool,
    contributors:           OldUnorderedMap<AccountId, ContributorInfo>,
    pending_applications:   OldUnorderedMap<AccountId, ContributorApplication>,
    vanguard_nft_contracts: OldVector<AccountId>,
    vanguard_verified:      OldLookupSet<AccountId>,
    vanguard_token_id_max:  u64,
    agent_profiles:         OldUnorderedMap<AccountId, AgentProfile>,
    agent_handles:          OldUnorderedMap<String, AccountId>,
    total_points_issued:    Balance,
    agent_stats:            OldUnorderedMap<AccountId, AgentStats>,
    agent_tasks:            OldUnorderedMap<AccountId, Vec<AgentTask>>,
    next_task_id:           u64,
    skills:                 OldUnorderedMap<u64, Skill>,
    next_skill_id:          u64,
    installed_skills:       OldUnorderedMap<AccountId, Vec<u64>>,
    agent_flags:            OldUnorderedMap<AccountId, AgentFlags>,
}

/// Byte-for-byte mirror of the Phase-7A (post-`migrate_v7_skill_metadata()`)
/// shape. Used by `migrate_v7b_agent_permissions()` to add the
/// `agent_permissions` map. Do NOT edit once the Phase 7B upgrade has run
/// on mainnet.
#[near(serializers=[borsh])]
struct Phase7AStakingContract {
    owner_id:               AccountId,
    ironclaw_token_id:      AccountId,
    pools:                  OldVector<PoolInfo>,
    user_info:              OldLookupMap<String, UserInfo>,
    reward_per_ns:          Balance,
    last_reward_time:       u64,
    total_alloc_point:      u32,
    paused:                 bool,
    proposals:              OldVector<Proposal>,
    votes:                  OldLookupMap<String, String>,
    mission_results:        OldLookupMap<u32, MissionResult>,
    orchestrator_id:        AccountId,
    total_revenue:          Balance,
    distributed_revenue:    Balance,
    staker_share_bps:       u32,
    contributor_share_bps:  u32,
    reserve_share_bps:      u32,
    proposer_share_bps:     u32,
    contributor_wallet:     AccountId,
    reserve_wallet:         AccountId,
    proposer_wallet:        AccountId,
    pretoken_mode:          bool,
    contributors:           OldUnorderedMap<AccountId, ContributorInfo>,
    pending_applications:   OldUnorderedMap<AccountId, ContributorApplication>,
    vanguard_nft_contracts: OldVector<AccountId>,
    vanguard_verified:      OldLookupSet<AccountId>,
    vanguard_token_id_max:  u64,
    agent_profiles:         OldUnorderedMap<AccountId, AgentProfile>,
    agent_handles:          OldUnorderedMap<String, AccountId>,
    total_points_issued:    Balance,
    agent_stats:            OldUnorderedMap<AccountId, AgentStats>,
    agent_tasks:            OldUnorderedMap<AccountId, Vec<AgentTask>>,
    next_task_id:           u64,
    skills:                 OldUnorderedMap<u64, Skill>,
    next_skill_id:          u64,
    installed_skills:       OldUnorderedMap<AccountId, Vec<u64>>,
    agent_flags:            OldUnorderedMap<AccountId, AgentFlags>,
    ironclaw_sources:       OldUnorderedMap<AccountId, String>,
    skill_metadata:         OldUnorderedMap<u64, SkillMetadata>,
}

#[near]
impl StakingContract {
    /// Phase 7A → Phase 7B: adds an empty `agent_permissions` map under
    /// prefix b"P". O(1) runtime — no per-profile iteration, no
    /// re-encoding. Existing agent_profiles stay on their Phase 4 byte
    /// layout. Owners get the default (no entry → read-only, no spend
    /// limit) until they call set_agent_permissions for the first time.
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v7b_agent_permissions() -> Self {
        let old: Phase7AStakingContract = env::state_read()
            .expect("No state to migrate — was the contract ever initialized?");

        env::log_str("EVENT_JSON:{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"state_migrated\",\"data\":{\"to\":\"phase7b_agent_permissions\"}}");

        Self {
            owner_id:               old.owner_id,
            ironclaw_token_id:      old.ironclaw_token_id,
            pools:                  old.pools,
            user_info:              old.user_info,
            reward_per_ns:          old.reward_per_ns,
            last_reward_time:       old.last_reward_time,
            total_alloc_point:      old.total_alloc_point,
            paused:                 old.paused,
            proposals:              old.proposals,
            votes:                  old.votes,
            mission_results:        old.mission_results,
            orchestrator_id:        old.orchestrator_id,
            total_revenue:          old.total_revenue,
            distributed_revenue:    old.distributed_revenue,
            staker_share_bps:       old.staker_share_bps,
            contributor_share_bps:  old.contributor_share_bps,
            reserve_share_bps:      old.reserve_share_bps,
            proposer_share_bps:     old.proposer_share_bps,
            contributor_wallet:     old.contributor_wallet,
            reserve_wallet:         old.reserve_wallet,
            proposer_wallet:        old.proposer_wallet,
            pretoken_mode:          old.pretoken_mode,
            contributors:           old.contributors,
            pending_applications:   old.pending_applications,
            vanguard_nft_contracts: old.vanguard_nft_contracts,
            vanguard_verified:      old.vanguard_verified,
            vanguard_token_id_max:  old.vanguard_token_id_max,
            agent_profiles:         old.agent_profiles,
            agent_handles:          old.agent_handles,
            total_points_issued:    old.total_points_issued,
            agent_stats:            old.agent_stats,
            agent_tasks:            old.agent_tasks,
            next_task_id:           old.next_task_id,
            skills:                 old.skills,
            next_skill_id:          old.next_skill_id,
            installed_skills:       old.installed_skills,
            agent_flags:            old.agent_flags,
            ironclaw_sources:       old.ironclaw_sources,
            skill_metadata:         old.skill_metadata,

            // Phase 7B — empty. Populated by set_agent_permissions +
            // set_agent_daily_limit. Prefix b"P" (previously unused,
            // see lib.rs + prefix inventory).
            agent_permissions:      UnorderedMap::new(b"P"),
        }
    }
}

/// Byte-for-byte mirror of the Phase-6 (post-`migrate_v6_ironclaw_link()`)
/// shape. Used by `migrate_v7_skill_metadata()` to preserve state while
/// adding the skill_metadata map. Do NOT edit once the Phase 7 upgrade
/// has run on mainnet.
#[near(serializers=[borsh])]
struct Phase6StakingContract {
    owner_id:               AccountId,
    ironclaw_token_id:      AccountId,
    pools:                  OldVector<PoolInfo>,
    user_info:              OldLookupMap<String, UserInfo>,
    reward_per_ns:          Balance,
    last_reward_time:       u64,
    total_alloc_point:      u32,
    paused:                 bool,
    proposals:              OldVector<Proposal>,
    votes:                  OldLookupMap<String, String>,
    mission_results:        OldLookupMap<u32, MissionResult>,
    orchestrator_id:        AccountId,
    total_revenue:          Balance,
    distributed_revenue:    Balance,
    staker_share_bps:       u32,
    contributor_share_bps:  u32,
    reserve_share_bps:      u32,
    proposer_share_bps:     u32,
    contributor_wallet:     AccountId,
    reserve_wallet:         AccountId,
    proposer_wallet:        AccountId,
    pretoken_mode:          bool,
    contributors:           OldUnorderedMap<AccountId, ContributorInfo>,
    pending_applications:   OldUnorderedMap<AccountId, ContributorApplication>,
    vanguard_nft_contracts: OldVector<AccountId>,
    vanguard_verified:      OldLookupSet<AccountId>,
    vanguard_token_id_max:  u64,
    agent_profiles:         OldUnorderedMap<AccountId, AgentProfile>,
    agent_handles:          OldUnorderedMap<String, AccountId>,
    total_points_issued:    Balance,
    agent_stats:            OldUnorderedMap<AccountId, AgentStats>,
    agent_tasks:            OldUnorderedMap<AccountId, Vec<AgentTask>>,
    next_task_id:           u64,
    skills:                 OldUnorderedMap<u64, Skill>,
    next_skill_id:          u64,
    installed_skills:       OldUnorderedMap<AccountId, Vec<u64>>,
    agent_flags:            OldUnorderedMap<AccountId, AgentFlags>,
    ironclaw_sources:       OldUnorderedMap<AccountId, String>,
}

#[near]
impl StakingContract {
    /// Phase 6 → Phase 7 (Sub-PR A): preserves all existing state and
    /// adds an empty `skill_metadata` map under prefix b"M". Previously-
    /// created skills retain their exact on-chain encoding; they'll
    /// render without category/tags/verified in the marketplace until
    /// their author calls `update_skill_metadata`. No destructive
    /// changes, no per-skill rewrite — the migration is O(1) in runtime
    /// regardless of how many skills the contract holds.
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v7_skill_metadata() -> Self {
        let old: Phase6StakingContract = env::state_read()
            .expect("No state to migrate — was the contract ever initialized?");

        env::log_str("EVENT_JSON:{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"state_migrated\",\"data\":{\"to\":\"phase7_skill_metadata\"}}");

        Self {
            owner_id:               old.owner_id,
            ironclaw_token_id:      old.ironclaw_token_id,
            pools:                  old.pools,
            user_info:              old.user_info,
            reward_per_ns:          old.reward_per_ns,
            last_reward_time:       old.last_reward_time,
            total_alloc_point:      old.total_alloc_point,
            paused:                 old.paused,
            proposals:              old.proposals,
            votes:                  old.votes,
            mission_results:        old.mission_results,
            orchestrator_id:        old.orchestrator_id,
            total_revenue:          old.total_revenue,
            distributed_revenue:    old.distributed_revenue,
            staker_share_bps:       old.staker_share_bps,
            contributor_share_bps:  old.contributor_share_bps,
            reserve_share_bps:      old.reserve_share_bps,
            proposer_share_bps:     old.proposer_share_bps,
            contributor_wallet:     old.contributor_wallet,
            reserve_wallet:         old.reserve_wallet,
            proposer_wallet:        old.proposer_wallet,
            pretoken_mode:          old.pretoken_mode,
            contributors:           old.contributors,
            pending_applications:   old.pending_applications,
            vanguard_nft_contracts: old.vanguard_nft_contracts,
            vanguard_verified:      old.vanguard_verified,
            vanguard_token_id_max:  old.vanguard_token_id_max,
            agent_profiles:         old.agent_profiles,
            agent_handles:          old.agent_handles,
            total_points_issued:    old.total_points_issued,
            agent_stats:            old.agent_stats,
            agent_tasks:            old.agent_tasks,
            next_task_id:           old.next_task_id,
            skills:                 old.skills,
            next_skill_id:          old.next_skill_id,
            installed_skills:       old.installed_skills,
            agent_flags:            old.agent_flags,
            ironclaw_sources:       old.ironclaw_sources,

            // Phase 7 — empty. Populated by create_skill on new listings
            // and by update_skill_metadata / set_skill_verified on
            // legacy ones. Prefix b"M" is previously unused (see
            // migrate.rs header for full prefix inventory).
            skill_metadata:         UnorderedMap::new(b"M"),
            // Phase 7B — empty on every upgrade path. Prefix b"P".
            agent_permissions:      UnorderedMap::new(b"P"),
        }
    }
}

#[near]
impl StakingContract {
    /// Phase 5 → Phase 6 upgrade: preserves all existing state and adds the
    /// ironclaw_sources map. Safe to call exactly once on a contract that has
    /// already run `migrate_v5_tasks_skills()`.
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v6_ironclaw_link() -> Self {
        let old: Phase5StakingContract = env::state_read()
            .expect("No state to migrate — was the contract ever initialized?");

        env::log_str("EVENT_JSON:{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"state_migrated\",\"data\":{\"to\":\"phase6_ironclaw_link\"}}");

        Self {
            owner_id:               old.owner_id,
            ironclaw_token_id:      old.ironclaw_token_id,
            pools:                  old.pools,
            user_info:              old.user_info,
            reward_per_ns:          old.reward_per_ns,
            last_reward_time:       old.last_reward_time,
            total_alloc_point:      old.total_alloc_point,
            paused:                 old.paused,
            proposals:              old.proposals,
            votes:                  old.votes,
            mission_results:        old.mission_results,
            orchestrator_id:        old.orchestrator_id,
            total_revenue:          old.total_revenue,
            distributed_revenue:    old.distributed_revenue,
            staker_share_bps:       old.staker_share_bps,
            contributor_share_bps:  old.contributor_share_bps,
            reserve_share_bps:      old.reserve_share_bps,
            proposer_share_bps:     old.proposer_share_bps,
            contributor_wallet:     old.contributor_wallet,
            reserve_wallet:         old.reserve_wallet,
            proposer_wallet:        old.proposer_wallet,
            pretoken_mode:          old.pretoken_mode,
            contributors:           old.contributors,
            pending_applications:   old.pending_applications,
            vanguard_nft_contracts: old.vanguard_nft_contracts,
            vanguard_verified:      old.vanguard_verified,
            vanguard_token_id_max:  old.vanguard_token_id_max,
            agent_profiles:         old.agent_profiles,
            agent_handles:          old.agent_handles,
            total_points_issued:    old.total_points_issued,
            agent_stats:            old.agent_stats,
            agent_tasks:            old.agent_tasks,
            next_task_id:           old.next_task_id,
            skills:                 old.skills,
            next_skill_id:          old.next_skill_id,
            installed_skills:       old.installed_skills,
            agent_flags:            old.agent_flags,

            // Phase 6 — empty, populated when an owner calls link_to_ironclaw
            ironclaw_sources: UnorderedMap::new(b"L"),
            // Phase 7 — empty on every upgrade path; `create_skill` and
            // `update_skill_metadata` populate it lazily. Prefix b"M".
            skill_metadata:   UnorderedMap::new(b"M"),
            // Phase 7B — empty on every upgrade path. Prefix b"P".
            agent_permissions: UnorderedMap::new(b"P"),
        }
    }
}

/// Byte-for-byte mirror of the Phase-4 (post-`migrate_v4_agent_stats()`) shape.
/// Used by `migrate_v5_tasks_skills()` to preserve state while adding the
/// Phase 5 storage (agent_tasks, skills, installed_skills, agent_flags). Do
/// NOT edit once the Phase 5 upgrade has run on mainnet.
#[near(serializers=[borsh])]
struct Phase4StakingContract {
    owner_id:               AccountId,
    ironclaw_token_id:      AccountId,
    pools:                  OldVector<PoolInfo>,
    user_info:              OldLookupMap<String, UserInfo>,
    reward_per_ns:          Balance,
    last_reward_time:       u64,
    total_alloc_point:      u32,
    paused:                 bool,
    proposals:              OldVector<Proposal>,
    votes:                  OldLookupMap<String, String>,
    mission_results:        OldLookupMap<u32, MissionResult>,
    orchestrator_id:        AccountId,
    total_revenue:          Balance,
    distributed_revenue:    Balance,
    staker_share_bps:       u32,
    contributor_share_bps:  u32,
    reserve_share_bps:      u32,
    proposer_share_bps:     u32,
    contributor_wallet:     AccountId,
    reserve_wallet:         AccountId,
    proposer_wallet:        AccountId,
    pretoken_mode:          bool,
    contributors:           OldUnorderedMap<AccountId, ContributorInfo>,
    pending_applications:   OldUnorderedMap<AccountId, ContributorApplication>,
    vanguard_nft_contracts: OldVector<AccountId>,
    vanguard_verified:      OldLookupSet<AccountId>,
    vanguard_token_id_max:  u64,
    agent_profiles:         OldUnorderedMap<AccountId, AgentProfile>,
    agent_handles:          OldUnorderedMap<String, AccountId>,
    total_points_issued:    Balance,
    agent_stats:            OldUnorderedMap<AccountId, AgentStats>,
}

#[near]
impl StakingContract {
    /// Phase 4 → Phase 5 upgrade: preserves all existing state and seeds the
    /// new task queue, skills catalog, installed-skills map, and agent flags.
    /// Safe to call exactly once on a contract that has already run
    /// `migrate_v4_agent_stats()`.
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v5_tasks_skills() -> Self {
        let old: Phase4StakingContract = env::state_read()
            .expect("No state to migrate — was the contract ever initialized?");

        env::log_str("EVENT_JSON:{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"state_migrated\",\"data\":{\"to\":\"phase5_tasks_skills\"}}");

        Self {
            owner_id:               old.owner_id,
            ironclaw_token_id:      old.ironclaw_token_id,
            pools:                  old.pools,
            user_info:              old.user_info,
            reward_per_ns:          old.reward_per_ns,
            last_reward_time:       old.last_reward_time,
            total_alloc_point:      old.total_alloc_point,
            paused:                 old.paused,
            proposals:              old.proposals,
            votes:                  old.votes,
            mission_results:        old.mission_results,
            orchestrator_id:        old.orchestrator_id,
            total_revenue:          old.total_revenue,
            distributed_revenue:    old.distributed_revenue,
            staker_share_bps:       old.staker_share_bps,
            contributor_share_bps:  old.contributor_share_bps,
            reserve_share_bps:      old.reserve_share_bps,
            proposer_share_bps:     old.proposer_share_bps,
            contributor_wallet:     old.contributor_wallet,
            reserve_wallet:         old.reserve_wallet,
            proposer_wallet:        old.proposer_wallet,
            pretoken_mode:          old.pretoken_mode,
            contributors:           old.contributors,
            pending_applications:   old.pending_applications,
            vanguard_nft_contracts: old.vanguard_nft_contracts,
            vanguard_verified:      old.vanguard_verified,
            vanguard_token_id_max:  old.vanguard_token_id_max,
            agent_profiles:         old.agent_profiles,
            agent_handles:          old.agent_handles,
            total_points_issued:    old.total_points_issued,
            agent_stats:            old.agent_stats,

            // Phase 5 — empty collections, populated lazily
            agent_tasks:      UnorderedMap::new(b"T"),
            next_task_id:     0,
            skills:           UnorderedMap::new(b"K"),
            next_skill_id:    0,
            installed_skills: UnorderedMap::new(b"I"),
            agent_flags:      UnorderedMap::new(b"F"),
            ironclaw_sources: UnorderedMap::new(b"L"),
            // Phase 7 — empty on every upgrade path; `create_skill` and
            // `update_skill_metadata` populate it lazily. Prefix b"M".
            skill_metadata:   UnorderedMap::new(b"M"),
            // Phase 7B — empty on every upgrade path. Prefix b"P".
            agent_permissions: UnorderedMap::new(b"P"),
        }
    }
}

/// Byte-for-byte mirror of the Phase-3 (post-`migrate_add_agents()`) shape.
/// Used by `migrate_v4_agent_stats()` to upgrade an already-Phase-3 contract
/// without discarding state. Do NOT edit once the Phase 4 upgrade has run on
/// mainnet.
#[near(serializers=[borsh])]
struct Phase3StakingContract {
    owner_id:               AccountId,
    ironclaw_token_id:      AccountId,
    pools:                  OldVector<PoolInfo>,
    user_info:              OldLookupMap<String, UserInfo>,
    reward_per_ns:          Balance,
    last_reward_time:       u64,
    total_alloc_point:      u32,
    paused:                 bool,
    proposals:              OldVector<Proposal>,
    votes:                  OldLookupMap<String, String>,
    mission_results:        OldLookupMap<u32, MissionResult>,
    orchestrator_id:        AccountId,
    total_revenue:          Balance,
    distributed_revenue:    Balance,
    staker_share_bps:       u32,
    contributor_share_bps:  u32,
    reserve_share_bps:      u32,
    proposer_share_bps:     u32,
    contributor_wallet:     AccountId,
    reserve_wallet:         AccountId,
    proposer_wallet:        AccountId,
    pretoken_mode:          bool,
    contributors:           OldUnorderedMap<AccountId, ContributorInfo>,
    pending_applications:   OldUnorderedMap<AccountId, ContributorApplication>,
    vanguard_nft_contracts: OldVector<AccountId>,
    vanguard_verified:      OldLookupSet<AccountId>,
    vanguard_token_id_max:  u64,
    agent_profiles:         OldUnorderedMap<AccountId, AgentProfile>,
    agent_handles:          OldUnorderedMap<String, AccountId>,
    total_points_issued:    Balance,
}

#[near]
impl StakingContract {
    /// Phase 3 → Phase 4 upgrade: preserves all existing state and seeds the
    /// new per-agent stats storage. Safe to call exactly once on a contract
    /// that has already run `migrate_add_agents()`.
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v4_agent_stats() -> Self {
        let old: Phase3StakingContract = env::state_read()
            .expect("No state to migrate — was the contract ever initialized?");

        env::log_str("EVENT_JSON:{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"state_migrated\",\"data\":{\"to\":\"phase4_agent_stats\"}}");

        Self {
            owner_id:               old.owner_id,
            ironclaw_token_id:      old.ironclaw_token_id,
            pools:                  old.pools,
            user_info:              old.user_info,
            reward_per_ns:          old.reward_per_ns,
            last_reward_time:       old.last_reward_time,
            total_alloc_point:      old.total_alloc_point,
            paused:                 old.paused,
            proposals:              old.proposals,
            votes:                  old.votes,
            mission_results:        old.mission_results,
            orchestrator_id:        old.orchestrator_id,
            total_revenue:          old.total_revenue,
            distributed_revenue:    old.distributed_revenue,
            staker_share_bps:       old.staker_share_bps,
            contributor_share_bps:  old.contributor_share_bps,
            reserve_share_bps:      old.reserve_share_bps,
            proposer_share_bps:     old.proposer_share_bps,
            contributor_wallet:     old.contributor_wallet,
            reserve_wallet:         old.reserve_wallet,
            proposer_wallet:        old.proposer_wallet,
            pretoken_mode:          old.pretoken_mode,
            contributors:           old.contributors,
            pending_applications:   old.pending_applications,
            vanguard_nft_contracts: old.vanguard_nft_contracts,
            vanguard_verified:      old.vanguard_verified,
            vanguard_token_id_max:  old.vanguard_token_id_max,
            agent_profiles:         old.agent_profiles,
            agent_handles:          old.agent_handles,
            total_points_issued:    old.total_points_issued,

            // Phase 4 — empty stats map, populated lazily by award_points etc.
            agent_stats: UnorderedMap::new(b"S"),

            // Phase 5 — empty collections (seeded here so a fresh contract
            // built from the new lib.rs also works if the Phase-3 → Phase-4
            // migration path is chosen over the dedicated Phase-5 one).
            agent_tasks:      UnorderedMap::new(b"T"),
            next_task_id:     0,
            skills:           UnorderedMap::new(b"K"),
            next_skill_id:    0,
            installed_skills: UnorderedMap::new(b"I"),
            agent_flags:      UnorderedMap::new(b"F"),
            ironclaw_sources: UnorderedMap::new(b"L"),
            // Phase 7 — empty on every upgrade path; `create_skill` and
            // `update_skill_metadata` populate it lazily. Prefix b"M".
            skill_metadata:   UnorderedMap::new(b"M"),
            // Phase 7B — empty on every upgrade path. Prefix b"P".
            agent_permissions: UnorderedMap::new(b"P"),
        }
    }
}

/// Byte-for-byte mirror of the Phase-2 (post-`migrate()`) shape. Used by
/// `migrate_add_agents()` to upgrade an already-Phase-2 contract without
/// discarding state. Do NOT edit once the Phase 3 upgrade has run on mainnet.
#[near(serializers=[borsh])]
struct Phase2StakingContract {
    owner_id:               AccountId,
    ironclaw_token_id:      AccountId,
    pools:                  OldVector<PoolInfo>,
    user_info:              OldLookupMap<String, UserInfo>,
    reward_per_ns:          Balance,
    last_reward_time:       u64,
    total_alloc_point:      u32,
    paused:                 bool,
    proposals:              OldVector<Proposal>,
    votes:                  OldLookupMap<String, String>,
    mission_results:        OldLookupMap<u32, MissionResult>,
    orchestrator_id:        AccountId,
    total_revenue:          Balance,
    distributed_revenue:    Balance,
    staker_share_bps:       u32,
    contributor_share_bps:  u32,
    reserve_share_bps:      u32,
    proposer_share_bps:     u32,
    contributor_wallet:     AccountId,
    reserve_wallet:         AccountId,
    proposer_wallet:        AccountId,
    pretoken_mode:          bool,
    contributors:           OldUnorderedMap<AccountId, ContributorInfo>,
    pending_applications:   OldUnorderedMap<AccountId, ContributorApplication>,
    vanguard_nft_contracts: OldVector<AccountId>,
    vanguard_verified:      OldLookupSet<AccountId>,
    vanguard_token_id_max:  u64,
}

#[near]
impl StakingContract {
    /// Phase 2 → Phase 3 upgrade: preserves all existing state and seeds the
    /// new agent profile / points storage. Safe to call exactly once on a
    /// contract that has already run `migrate()` (or deployed fresh with the
    /// Phase 2 `new()` signature). Call order in the deploy transaction:
    /// deploy-code + `migrate_add_agents`.
    #[private]
    #[init(ignore_state)]
    pub fn migrate_add_agents() -> Self {
        let old: Phase2StakingContract = env::state_read()
            .expect("No state to migrate — was the contract ever initialized?");

        env::log_str("EVENT_JSON:{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"state_migrated\",\"data\":{\"to\":\"phase3_agents\"}}");

        Self {
            owner_id:               old.owner_id,
            ironclaw_token_id:      old.ironclaw_token_id,
            pools:                  old.pools,
            user_info:              old.user_info,
            reward_per_ns:          old.reward_per_ns,
            last_reward_time:       old.last_reward_time,
            total_alloc_point:      old.total_alloc_point,
            paused:                 old.paused,
            proposals:              old.proposals,
            votes:                  old.votes,
            mission_results:        old.mission_results,
            orchestrator_id:        old.orchestrator_id,
            total_revenue:          old.total_revenue,
            distributed_revenue:    old.distributed_revenue,
            staker_share_bps:       old.staker_share_bps,
            contributor_share_bps:  old.contributor_share_bps,
            reserve_share_bps:      old.reserve_share_bps,
            proposer_share_bps:     old.proposer_share_bps,
            contributor_wallet:     old.contributor_wallet,
            reserve_wallet:         old.reserve_wallet,
            proposer_wallet:        old.proposer_wallet,
            pretoken_mode:          old.pretoken_mode,
            contributors:           old.contributors,
            pending_applications:   old.pending_applications,
            vanguard_nft_contracts: old.vanguard_nft_contracts,
            vanguard_verified:      old.vanguard_verified,
            vanguard_token_id_max:  old.vanguard_token_id_max,

            // New agent + points storage
            agent_profiles:      UnorderedMap::new(b"G"),
            agent_handles:       UnorderedMap::new(b"H"),
            total_points_issued: 0,
            agent_stats:         UnorderedMap::new(b"S"),

            // Phase 5 seeds (empty; picked up once the Phase 5 migration runs
            // or an owner calls assign_task/create_skill/set_public/etc.)
            agent_tasks:         UnorderedMap::new(b"T"),
            next_task_id:        0,
            skills:              UnorderedMap::new(b"K"),
            next_skill_id:       0,
            installed_skills:    UnorderedMap::new(b"I"),
            agent_flags:         UnorderedMap::new(b"F"),
            ironclaw_sources:    UnorderedMap::new(b"L"),
            // Phase 7 — empty on every upgrade path; `create_skill` and
            // `update_skill_metadata` populate it lazily. Prefix b"M".
            skill_metadata:      UnorderedMap::new(b"M"),
            // Phase 7B — empty on every upgrade path. Prefix b"P".
            agent_permissions:   UnorderedMap::new(b"P"),
        }
    }
}
