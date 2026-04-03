use crate::*;
use near_sdk::Promise;

#[near]
impl StakingContract {

    /// Reverts if the caller is not the owner
    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Only the contract owner can call this"
        );
    }

    /// Admin: Add a new Staking Pool Tier
    pub fn add_pool(
        &mut self,
        reward_multiplier: u32,
        lock_period_ns: u64,
        early_exit_penalty_pct: u8,
    ) {
        self.assert_owner();
        assert!(early_exit_penalty_pct <= 100, "Penalty cannot exceed 100%");
        
        // Update math before changing allocation weights!
        self.mass_update_pools();

        self.total_alloc_point += reward_multiplier;

        let new_pool = PoolInfo {
            total_staked: 0,
            reward_multiplier,
            lock_period_ns,
            early_exit_penalty_pct,
            acc_reward_per_share: 0,
        };

        self.pools.push(new_pool);
    }

    /// Admin: Fund the native $NEAR reward pool using protocol fees.
    /// Payable function. We optionally update the global `reward_per_ns` if requested.
    #[payable]
    pub fn fund_rewards(&mut self, new_reward_per_ns: Option<U128>) {
        self.assert_owner();
        let deposit = env::attached_deposit();
        assert!(deposit.as_yoctonear() > 0, "Must attach $NEAR to fund rewards");

        if let Some(rate) = new_reward_per_ns {
            self.mass_update_pools(); // Lock in existing math at old rate first
            self.reward_per_ns = rate.into();
        }
    }

    /// Admin: Emergency toggle to halt deposits and claims
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
    }
}
