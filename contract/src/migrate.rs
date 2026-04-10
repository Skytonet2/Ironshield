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
use near_sdk::store::{LookupMap as OldLookupMap, Vector as OldVector};

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
        }
    }
}
