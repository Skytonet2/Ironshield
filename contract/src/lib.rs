use near_sdk::{near, env, AccountId, PanicOnDefault};
use near_sdk::store::{UnorderedMap, LookupMap, LookupSet, Vector};
use near_sdk::json_types::U128;
pub type Balance = u128;

mod pool;
mod ft_callbacks;
mod actions;
mod admin;
mod views;
mod governance;
mod treasury;
mod missions;
mod web4;
mod pretoken;
mod agents;
mod pro;
mod migrate;

pub use pretoken::{ContributorApplication, ContributorInfo};
pub use agents::{AgentProfile, AgentStats, ActivityEntry, AgentTask, Skill, SkillMetadata, AgentPermissions, AgentFlags, SubAgent, AgentConnection};

pub type PoolId = u32;

/// Precision for MasterChef math. We multiply rewards by this before dividing by total_staked.
pub const ACC_REWARD_MULTIPLIER: u128 = 1_000_000_000_000_000_000_000_000; // 1e24

#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct UserInfo {
    /// Total amount of $IRONCLAW staked by this user in a specific pool
    pub amount: Balance,
    /// Reward debt for MasterChef logic
    pub reward_debt: Balance,
    /// The timestamp when the user staked. Used to calculate lockup penalty.
    pub staked_at: u64,
}

#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct PoolInfo {
    /// Total $IRONCLAW staked in this pool
    pub total_staked: Balance,
    /// Reward multiplier (e.g. 1.0x, 1.5x, 2.0x). Represented with 2 decimals (100 = 1x, 150 = 1.5x)
    pub reward_multiplier: u32,
    /// Minimum lock period in nanoseconds
    pub lock_period_ns: u64,
    /// Penalty percentage (0-100) if user unstakes before lock period expires
    pub early_exit_penalty_pct: u8,
    /// Accumulated NEAR rewards per share (multiplied by ACC_REWARD_MULTIPLIER)
    pub acc_reward_per_share: u128,
}

#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct Proposal {
    pub id: u32,
    pub title: String,
    pub description: String,
    pub proposal_type: String, // "Mission", "PromptUpdate", "RuleChange"
    pub proposer: AccountId,
    pub content: String,
    pub votes_for: u128,
    pub votes_against: u128,
    pub status: String,    // "active", "passed", "rejected", "executed"
    pub passed: bool,
    pub executed: bool,
    pub created_at: u64,
    pub expires_at: u64,
}

/// Off-chain mission execution result, reported by the orchestrator after
/// NEAR AI IronClaw finishes a task. Stored in a separate LookupMap keyed
/// by proposal_id so we don't have to migrate the existing Proposal struct.
#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct MissionResult {
    pub proposal_id: u32,
    pub result_hash: String,
    pub result_cid: String,
    pub attestation: String,
    pub success: bool,
    pub session_id: String,
    pub completed_at: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct StakingContract {
    pub owner_id: AccountId,
    pub ironclaw_token_id: AccountId,

    pub pools: Vector<PoolInfo>,
    /// Maps (AccountId, PoolId) string to UserInfo
    pub user_info: LookupMap<String, UserInfo>,

    /// The global rate at which NEAR rewards are distributed per nanosecond.
    pub reward_per_ns: Balance,
    /// Timestamp of the last time rewards were updated across pools.
    pub last_reward_time: u64,
    /// Total allocation points. Must be the sum of all pools' multipliers.
    pub total_alloc_point: u32,

    pub paused: bool,

    // ── Governance ──────────────────────────────────────────────
    pub proposals: Vector<Proposal>,
    pub votes: LookupMap<String, String>, // "proposalId:accountId" -> "for"|"against"

    // ── Mission execution ───────────────────────────────────────
    /// Off-chain mission results reported by the orchestrator, keyed by proposal id.
    pub mission_results: LookupMap<u32, MissionResult>,
    /// Authorized orchestrator account that may call submit_mission_result.
    pub orchestrator_id: AccountId,

    // ── Treasury ────────────────────────────────────────────────
    pub total_revenue: Balance,
    pub distributed_revenue: Balance,
    pub staker_share_bps: u32,
    pub contributor_share_bps: u32,
    pub reserve_share_bps: u32,
    pub proposer_share_bps: u32,
    pub contributor_wallet: AccountId,
    pub reserve_wallet: AccountId,
    pub proposer_wallet: AccountId,

    // ── Pre-token governance (Phase 2) ──────────────────────────
    /// When true, voting power comes from contributor/vanguard registry instead
    /// of $IRONCLAW staked balance. Flips off automatically once token launches.
    pub pretoken_mode:          bool,
    pub contributors:           UnorderedMap<AccountId, ContributorInfo>,
    pub pending_applications:   UnorderedMap<AccountId, ContributorApplication>,
    pub vanguard_nft_contracts: Vector<AccountId>,
    pub vanguard_verified:      LookupSet<AccountId>,
    /// Top-N rule: token IDs in [1, vanguard_token_id_max] count as Vanguard.
    /// Default 1000 = top 30% of NEAR Legion's 3,333 supply.
    pub vanguard_token_id_max:  u64,

    // ── Agent profiles + points (Slice 1) ──────────────────────────────
    /// Platform identity for a user's agent. Keyed by owner AccountId; the
    /// optional `agent_account` inside holds the scoped sub-wallet once the
    /// owner links it.
    pub agent_profiles:      UnorderedMap<AccountId, AgentProfile>,
    /// Case-insensitive handle → owner index. Enforces uniqueness and powers
    /// handle-based lookups from the frontend.
    pub agent_handles:       UnorderedMap<String, AccountId>,
    /// Monotonic total of all points ever awarded. Drives the pool-share math
    /// for the future $IRONCLAW conversion and sanity-checks drift against
    /// summed profile balances.
    pub total_points_issued: Balance,

    // ── Agent stats (Phase 4) ──────────────────────────────────────────
    /// Per-agent rolling stats: weekly points snapshots, submission/mission
    /// counters, last-active, and a bounded recent-activity ring buffer. Kept
    /// as a separate map from `agent_profiles` so Phase 4 didn't need to
    /// rewrite existing profiles; each entry is lazy-created on first write.
    pub agent_stats: UnorderedMap<AccountId, AgentStats>,

    // ── Agent tasks + skills marketplace (Phase 5) ─────────────────────
    /// Active + historical tasks per agent owner (bounded ring, cap 10).
    pub agent_tasks:      UnorderedMap<AccountId, Vec<AgentTask>>,
    /// Monotonic task id so the frontend + orchestrator can reference tasks
    /// without ambiguity across agents.
    pub next_task_id:     u64,
    /// Global skills catalog keyed by skill id.
    pub skills:           UnorderedMap<u64, Skill>,
    pub next_skill_id:    u64,
    /// Per-owner list of installed skill ids (cap 25).
    pub installed_skills: UnorderedMap<AccountId, Vec<u64>>,
    /// Per-owner public-directory + IronClaw-subscription flags. Kept separate
    /// from AgentProfile so Phase 4 profiles don't need a rewrite.
    pub agent_flags:      UnorderedMap<AccountId, AgentFlags>,

    // ── Phase 6: linked external IronClaw agents ───────────────────────
    /// Maps owner → external IronClaw agent source (URL or handle) when the
    /// owner has linked an existing ironclaw.com agent to their on-platform
    /// profile. Lazy-populated; absence means no linked external agent.
    pub ironclaw_sources: UnorderedMap<AccountId, String>,

    // ── Phase 7 (Sub-PR A): skill metadata + paid installs ────────────
    /// Per-skill metadata keyed by skill_id. Parallel to `skills` so we
    /// don't rewrite existing skill entries during migration; absence
    /// means the skill was created before Phase 7 and has no metadata
    /// set. Authors can call `update_skill_metadata` to populate it.
    pub skill_metadata: UnorderedMap<u64, SkillMetadata>,

    // ── Phase 7 (Sub-PR B): agent capability mask + daily spend limit ─
    /// Per-owner permission row keyed by AccountId. Parallel to
    /// `agent_profiles` so the Phase 4 profile encoding stays stable;
    /// absence means "default permissions" (read-only, no spend limit).
    /// Owners flip bits + set a daily yocto cap via set_agent_permissions
    /// / set_agent_daily_limit.
    pub agent_permissions: UnorderedMap<AccountId, AgentPermissions>,

    // ── Phase 7 (Sub-PR C): multi-agent per wallet ────────────────────
    /// Per-owner list of secondary agents (capped at
    /// MAX_SUB_AGENTS_PER_OWNER). The primary agent still lives in
    /// `agent_profiles`; this map only holds the extras. Absence
    /// means "owner has zero sub-agents." Prefix b"O".
    pub owner_agents: UnorderedMap<AccountId, Vec<SubAgent>>,
    /// Sub-agent handle → owner. Parallel to `agent_handles` so
    /// Phase 3's handle encoding stays stable. Both maps are
    /// consulted when checking uniqueness so a handle can't collide
    /// across the primary + sub namespaces. Prefix b"Q".
    pub sub_agent_handles: UnorderedMap<String, AccountId>,

    // ── Phase 8: external-framework connections ──────────────────────
    /// Per-agent_account list of public framework bindings (OpenClaw,
    /// IronClaw on NEAR AI, self-hosted Hermes, ...). Auth tokens
    /// stay off-chain in the backend connection store; this map only
    /// holds the public side so the binding is auditable. Prefix b"X".
    pub agent_connections: UnorderedMap<AccountId, Vec<AgentConnection>>,

    // ── Day 18: IronShield Pro lock ──────────────────────────────────
    /// Per-wallet Pro-membership lock-until timestamp (unix ns). A
    /// wallet that wants Pro perks calls `extend_lock(seconds)` to
    /// commit to keeping their stake locked at least that long;
    /// `is_pro` returns true only while lock_until is at least
    /// PRO_MIN_LOCK_NS in the future AND total stake meets
    /// PRO_MIN_STAKE_YOCTO. Absence == 0 == "never opted in." Prefix b"R".
    pub pro_locks: LookupMap<AccountId, u64>,
}

#[near]
impl StakingContract {
    #[init]
    pub fn new(owner_id: AccountId, ironclaw_token_id: AccountId, reward_per_ns: U128) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let mut vanguard_nft_contracts = Vector::new(b"n");
        vanguard_nft_contracts.push("nearlegion.nfts.tg".parse().unwrap());

        Self {
            owner_id: owner_id.clone(),
            ironclaw_token_id,
            pools: Vector::new(b"p"),
            user_info: LookupMap::new(b"u"),
            reward_per_ns: reward_per_ns.into(),
            last_reward_time: env::block_timestamp(),
            total_alloc_point: 0,
            paused: false,
            proposals: Vector::new(b"g"),
            votes: LookupMap::new(b"v"),

            // Mission execution
            mission_results: LookupMap::new(b"mr".to_vec()),
            orchestrator_id: owner_id.clone(),

            // Treasury
            total_revenue: 0,
            distributed_revenue: 0,
            staker_share_bps: 4_000,
            contributor_share_bps: 2_500,
            reserve_share_bps: 2_000,
            proposer_share_bps: 1_500,
            contributor_wallet: owner_id.clone(),
            reserve_wallet: owner_id.clone(),
            proposer_wallet: owner_id,

            // Pre-token governance
            pretoken_mode:          true,
            contributors:           UnorderedMap::new(b"c"),
            pending_applications:   UnorderedMap::new(b"a"),
            vanguard_nft_contracts,
            vanguard_verified:      LookupSet::new(b"V"),
            vanguard_token_id_max:  1000,

            // Agent profiles + points
            agent_profiles:      UnorderedMap::new(b"G"),
            agent_handles:       UnorderedMap::new(b"H"),
            total_points_issued: 0,
            agent_stats:         UnorderedMap::new(b"S"),

            // Phase 5 — tasks + skills + flags
            agent_tasks:         UnorderedMap::new(b"T"),
            next_task_id:        0,
            skills:              UnorderedMap::new(b"K"),
            next_skill_id:       0,
            installed_skills:    UnorderedMap::new(b"I"),
            // Phase 7 — skill metadata. Prefix b"M" — previously unused
            // (see migrate.rs for the full prefix inventory).
            skill_metadata:      UnorderedMap::new(b"M"),
            // Phase 7 Sub-PR B — agent permissions. Prefix b"P".
            agent_permissions:   UnorderedMap::new(b"P"),
            agent_flags:         UnorderedMap::new(b"F"),

            // Phase 6 — linked external IronClaw agents
            ironclaw_sources:    UnorderedMap::new(b"L"),

            // Phase 7 Sub-PR C — multi-agent per wallet. Prefixes b"O" + b"Q".
            owner_agents:        UnorderedMap::new(b"O"),
            sub_agent_handles:   UnorderedMap::new(b"Q"),

            // Phase 8 — external-framework connections. Prefix b"X".
            agent_connections:   UnorderedMap::new(b"X"),

            // Day 18 — Pro lock-until timestamps. Prefix b"R" (previously
            // unused; see migrate.rs for the full prefix inventory).
            pro_locks:           LookupMap::new(b"R"),
        }
    }
}

/// Helper function to generate keys for the user_info lookup map
pub(crate) fn get_user_key(account_id: &AccountId, pool_id: PoolId) -> String {
    format!("{}:{}", account_id, pool_id)
}
