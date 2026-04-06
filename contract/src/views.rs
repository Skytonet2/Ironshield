use crate::*;
use near_sdk::json_types::U128;

/// View methods — free, no gas needed, called by frontend
#[near]
impl StakingContract {
    /// Get a single pool's info
    pub fn get_pool(&self, pool_id: PoolId) -> Option<PoolInfo> {
        self.pools.get(pool_id).cloned()
    }

    /// Get total number of staking pools
    pub fn get_pools_count(&self) -> u32 {
        self.pools.len()
    }

    /// Get all pools
    pub fn get_pools(&self) -> Vec<PoolInfo> {
        (0..self.pools.len())
            .filter_map(|i| self.pools.get(i).cloned())
            .collect()
    }

    /// Get user's staking info for a specific pool
    pub fn get_user_info(&self, account_id: AccountId, pool_id: PoolId) -> Option<UserInfo> {
        let key = get_user_key(&account_id, pool_id);
        self.user_info.get(&key).cloned()
    }

    /// Get user's pending (unclaimed) NEAR reward for a specific pool
    pub fn pending_reward(&self, account_id: AccountId, pool_id: PoolId) -> U128 {
        let key = get_user_key(&account_id, pool_id);
        let user = match self.user_info.get(&key) {
            Some(u) => u,
            None => return U128(0),
        };
        let pool = match self.pools.get(pool_id) {
            Some(p) => p,
            None => return U128(0),
        };
        U128(self.calculate_pending_reward(user, pool))
    }

    /// Get global contract info
    pub fn get_contract_info(&self) -> ContractInfo {
        ContractInfo {
            owner_id: self.owner_id.clone(),
            ironclaw_token_id: self.ironclaw_token_id.clone(),
            reward_per_ns: U128(self.reward_per_ns),
            total_alloc_point: self.total_alloc_point,
            pools_count: self.pools.len(),
            paused: self.paused,
        }
    }

    /// Check if contract is paused
    pub fn is_paused(&self) -> bool {
        self.paused
    }
}

#[near(serializers=[json])]
pub struct ContractInfo {
    pub owner_id: AccountId,
    pub ironclaw_token_id: AccountId,
    pub reward_per_ns: U128,
    pub total_alloc_point: u32,
    pub pools_count: u32,
    pub paused: bool,
}
