use crate::*;
use near_sdk::{PromiseOrValue, Promise, NearToken};
use near_sdk::json_types::U128;
use crate::pool::U256;

pub trait FtOnTransfer {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128>;
}

#[near]
impl FtOnTransfer for StakingContract {
    /// Received exactly when $IRONCLAW tokens are transferred to this contract.
    /// `msg` must contain the stringified PoolId where the user wants to stake.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert!(!self.paused, "Staking is currently paused");
        assert_eq!(
            env::predecessor_account_id(),
            self.ironclaw_token_id,
            "Only the official $IRONCLAW token contract can call this"
        );

        // Attempt to parse msg as a pool ID
        let pool_id: PoolId = match msg.parse() {
            Ok(id) => id,
            Err(_) => env::panic_str("msg must be a valid PoolId (u32)"),
        };

        let amount_staked = amount.0;
        assert!(amount_staked > 0, "Amount must be strictly positive");

        // Validate the pool exists
        assert!(pool_id < self.pools.len() as u32, "Invalid PoolId");

        // 1. Mass update first to secure rewards math up to this exact millisecond
        self.mass_update_pools();

        // 2. Fetch the specific pool
        let mut pool = self.pools.get(pool_id).unwrap().clone();
        
        let user_key = get_user_key(&sender_id, pool_id);
        
        // 3. Load or initialize user
        let mut user = self.user_info.get(&user_key).cloned().unwrap_or_else(|| UserInfo {
            amount: 0,
            reward_debt: 0,
            staked_at: env::block_timestamp(),
        });

        // 4. If user already had a balance, we must calculate and send their pending reward FIRST,
        // because their stake amount is about to change which alters the debt ratio
        if user.amount > 0 {
            let pending = self.calculate_pending_reward(&user, &pool);
            if pending > 0 {
                Promise::new(sender_id.clone()).transfer(NearToken::from_yoctonear(pending));
            }
        }

        // 5. Update balances
        user.amount += amount_staked;
        user.staked_at = env::block_timestamp(); // Reset lock period
        
        // Debt = amount * acc_reward_per_share
        let new_debt = (U256::from(user.amount) * U256::from(pool.acc_reward_per_share)) / U256::from(ACC_REWARD_MULTIPLIER);
        user.reward_debt = new_debt.as_u128();

        pool.total_staked += amount_staked;

        // 6. Save State
        self.user_info.insert(user_key, user);
        self.pools.replace(pool_id, pool);

        // Required by NEP-141: Returns 0 to indicate all transferred tokens were accepted
        PromiseOrValue::Value(U128(0))
    }
}
