use crate::*;
use uint::construct_uint;

construct_uint! {
    /// 256-bit unsigned integer. Required to prevent overflow during reward distribution multiplication.
    pub struct U256(4);
}

impl StakingContract {
    /// Update reward variables for all pools. Be careful of gas spending!
    pub(crate) fn mass_update_pools(&mut self) {
        let length = self.pools.len();
        for pid in 0..length {
            self.update_pool(pid);
        }
        self.last_reward_time = env::block_timestamp();
    }

    /// Update reward variables of the given pool to be up-to-date.
    pub(crate) fn update_pool(&mut self, pid: PoolId) {
        let mut pool = self.pools.get(pid).expect("Pool not found").clone();
        let current_ns = env::block_timestamp();
        
        if current_ns <= self.last_reward_time || pool.total_staked == 0 || self.total_alloc_point == 0 {
            return;
        }

        let time_delta = current_ns - self.last_reward_time;
        // Total near reward for this pool = (time_delta * reward_per_ns * pool_alloc_point) / total_alloc_point
        let pool_reward = (U256::from(time_delta) * U256::from(self.reward_per_ns) * U256::from(pool.reward_multiplier)) 
                           / U256::from(self.total_alloc_point);
                           
        // acc_reward_per_share += (pool_reward * ACC_REWARD_MULTIPLIER) / total_staked
        let additional_acc_per_share = (pool_reward * U256::from(ACC_REWARD_MULTIPLIER)) / U256::from(pool.total_staked);
        
        let new_acc = U256::from(pool.acc_reward_per_share) + additional_acc_per_share;
        pool.acc_reward_per_share = new_acc.as_u128();
        
        self.pools.replace(pid, pool);
    }
    
    /// Math helper to calculate a user's pending reward based on current pool's state
    pub(crate) fn calculate_pending_reward(&self, user: &UserInfo, pool: &PoolInfo) -> Balance {
        let current_ns = env::block_timestamp();
        let mut acc_reward = U256::from(pool.acc_reward_per_share);
        
        if current_ns > self.last_reward_time && pool.total_staked > 0 && self.total_alloc_point > 0 {
            let time_delta = current_ns - self.last_reward_time;
            let pool_reward = (U256::from(time_delta) * U256::from(self.reward_per_ns) * U256::from(pool.reward_multiplier)) 
                               / U256::from(self.total_alloc_point);
            let additional_acc = (pool_reward * U256::from(ACC_REWARD_MULTIPLIER)) / U256::from(pool.total_staked);
            acc_reward = acc_reward + additional_acc;
        }
        
        let accumulated_reward = (U256::from(user.amount) * acc_reward) / U256::from(ACC_REWARD_MULTIPLIER);
        // debt could technically be slightly larger due to precision edge cases
        if accumulated_reward > U256::from(user.reward_debt) {
            (accumulated_reward - U256::from(user.reward_debt)).as_u128()
        } else {
            0
        }
    }
}
