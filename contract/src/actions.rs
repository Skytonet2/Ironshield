use crate::*;
use crate::pool::U256;
use near_sdk::{ext_contract, Gas, NearToken};

const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10); // 10 TGas

#[ext_contract(ext_ft_contract)]
pub trait FtContract {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl StakingContract {

    /// Claim native $NEAR rewards without unstaking
    pub fn claim(&mut self, pool_id: PoolId) {
        assert!(!self.paused, "Paused");
        
        let account_id = env::predecessor_account_id();
        let user_key = get_user_key(&account_id, pool_id);
        
        self.mass_update_pools();
        let pool = self.pools.get(pool_id).expect("Pool not found");
        let mut user = self.user_info.get(&user_key).expect("You do not have a stake in this pool").clone();

        let pending = self.calculate_pending_reward(&user, &pool);
        assert!(pending > 0, "No rewards to claim");

        // Transfer Native $NEAR
        Promise::new(account_id.clone()).transfer(NearToken::from_yoctonear(pending));

        // Update User Debt
        let new_debt = (U256::from(user.amount) * U256::from(pool.acc_reward_per_share)) / U256::from(ACC_REWARD_MULTIPLIER);
        user.reward_debt = new_debt.as_u128();

        self.user_info.insert(user_key, user);
    }

    /// Unstake $IRONCLAW tokens. Inflicts a burn penalty if lock period is not met.
    pub fn unstake(&mut self, pool_id: PoolId, amount: U128) {
        assert!(!self.paused, "Paused");
        
        let account_id = env::predecessor_account_id();
        let user_key = get_user_key(&account_id, pool_id);
        let amount_to_withdraw = amount.0;
        assert!(amount_to_withdraw > 0, "Amount must be strictly positive");

        self.mass_update_pools();
        let mut pool = self.pools.get(pool_id).expect("Pool not found").clone();
        let mut user = self.user_info.get(&user_key).expect("Not staked").clone();
        
        assert!(user.amount >= amount_to_withdraw, "Not enough staked balance");

        // Calculate and dispatch pending rewards
        let pending = self.calculate_pending_reward(&user, &pool);
        if pending > 0 {
            Promise::new(account_id.clone()).transfer(NearToken::from_yoctonear(pending));
        }

        // Apply Penalty Logic
        let mut final_payout = amount_to_withdraw;
        let mut penalty_amount = 0;
        let time_staked = env::block_timestamp() - user.staked_at;

        if time_staked < pool.lock_period_ns { // Premature exit!
            let slash_pct = pool.early_exit_penalty_pct as u128;
            penalty_amount = (amount_to_withdraw * slash_pct) / 100;
            final_payout = amount_to_withdraw - penalty_amount;
        }

        // Update State
        user.amount -= amount_to_withdraw;
        pool.total_staked -= amount_to_withdraw;

        let new_debt = (U256::from(user.amount) * U256::from(pool.acc_reward_per_share)) / U256::from(ACC_REWARD_MULTIPLIER);
        user.reward_debt = new_debt.as_u128();

        self.user_info.insert(user_key, user);
        self.pools.replace(pool_id, pool);

        // Execute Returns and Burns
        
        // Return remaining FT to user
        ext_ft_contract::ext(self.ironclaw_token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(account_id, U128(final_payout), Some("IronShield unstake".to_string()));

        // Burn the penalty by sending it to a dead system address
        if penalty_amount > 0 {
            let dead_address: AccountId = "system".parse().unwrap();
            ext_ft_contract::ext(self.ironclaw_token_id.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FOR_FT_TRANSFER)
                .ft_transfer(dead_address, U128(penalty_amount), Some("IronShield deflationary burn penalty".to_string()));
        }
    }
}
