use near_sdk::{near, env, AccountId, PanicOnDefault};
use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::json_types::U128;
pub type Balance = u128;

mod pool;
mod ft_callbacks;
mod actions;
mod admin;
mod views;
mod governance;
mod pretoken;

pub use pretoken::{ContributorApplication, ContributorInfo};

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

    // Governance
    pub proposals: Vector<Proposal>,
    pub votes: LookupMap<String, String>, // "proposalId:accountId" -> "for"|"against"

    // Pre-token governance: contributors + vanguards vote before $IRONCLAW launches
    pub pretoken_mode:          bool,
    pub contributors:           IterableMap<AccountId, ContributorInfo>,
    pub pending_applications:   IterableMap<AccountId, ContributorApplication>,
    pub vanguard_nft_contracts: Vector<AccountId>,
    pub vanguard_verified:      LookupSet<AccountId>,
    /// Top-N rule: token IDs in [1, vanguard_token_id_max] count as Vanguard.
    /// Default 1000 = top 30% of NEAR Legion's 3,333 supply.
    pub vanguard_token_id_max:  u64,
}

#[near]
impl StakingContract {
    #[init]
    pub fn new(owner_id: AccountId, ironclaw_token_id: AccountId, reward_per_ns: U128) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        let mut vanguard_nft_contracts = Vector::new(b"n");
        // Seed the whitelist with NEAR Legion (HOT Protocol).
        vanguard_nft_contracts.push("nearlegion.nfts.tg".parse().unwrap());

        Self {
            owner_id,
            ironclaw_token_id,
            pools: Vector::new(b"p"),
            user_info: LookupMap::new(b"u"),
            reward_per_ns: reward_per_ns.into(),
            last_reward_time: env::block_timestamp(),
            total_alloc_point: 0,
            paused: false,
            proposals: Vector::new(b"g"),
            votes: LookupMap::new(b"v"),

            // Pre-token governance defaults
            pretoken_mode:          true, // ON until $IRONCLAW launches
            contributors:           IterableMap::new(b"c"),
            pending_applications:   IterableMap::new(b"a"),
            vanguard_nft_contracts,
            vanguard_verified:      LookupSet::new(b"V"),
            vanguard_token_id_max:  1000, // top 30% of 3,333
        }
    }
}

/// Helper function to generate keys for the user_info lookup map
pub(crate) fn get_user_key(account_id: &AccountId, pool_id: PoolId) -> String {
    format!("{}:{}", account_id, pool_id)
}
