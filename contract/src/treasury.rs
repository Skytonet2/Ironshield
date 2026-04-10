use crate::*;
use near_sdk::{Promise, NearToken};
use near_sdk::json_types::U128;

/// Basis points denominator. All four bucket shares must sum to this value.
pub const BPS_DENOMINATOR: u32 = 10_000;

#[near(serializers=[json])]
#[derive(Clone)]
pub struct TreasuryStats {
    pub total_revenue: U128,
    pub distributed_revenue: U128,
    pub undistributed_revenue: U128,
    pub staker_share_bps: u32,
    pub contributor_share_bps: u32,
    pub reserve_share_bps: u32,
    pub proposer_share_bps: u32,
    pub contributor_wallet: AccountId,
    pub reserve_wallet: AccountId,
    pub proposer_wallet: AccountId,
}

#[near]
impl StakingContract {
    /// Private helper: verifies caller is the contract owner.
    fn assert_treasury_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Only the contract owner can manage the treasury"
        );
    }

    /// Deposit protocol revenue into the treasury. Anyone can call this (the
    /// revenue router bot, a paying customer, or the owner). The attached NEAR
    /// is credited to `total_revenue` and becomes eligible for the next
    /// distribute_revenue() call.
    ///
    /// `source` is a free-form label (e.g. "mission:42", "ad_rev", "manual")
    /// used purely for off-chain accounting via the emitted event log.
    #[payable]
    pub fn deposit_revenue(&mut self, source: String) {
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit > 0, "Must attach NEAR to deposit revenue");

        self.total_revenue += deposit;

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"revenue_deposited\",\"data\":{{\"amount\":\"{}\",\"source\":\"{}\",\"total_revenue\":\"{}\"}}}}",
            deposit, source, self.total_revenue
        ));
    }

    /// Distribute all undistributed revenue according to the current bps splits.
    ///
    /// Layout:
    ///   - staker_share_bps  → stays on contract (claimable via existing claim flow)
    ///   - contributor_share → Promise::transfer → contributor_wallet
    ///   - reserve_share     → Promise::transfer → reserve_wallet
    ///   - proposer_share    → Promise::transfer → proposer_wallet
    ///
    /// Callable by anyone; it's economically neutral because the shares are
    /// pre-configured by the owner.
    pub fn distribute_revenue(&mut self) -> Promise {
        let undistributed = self
            .total_revenue
            .checked_sub(self.distributed_revenue)
            .expect("distributed_revenue must never exceed total_revenue");
        assert!(undistributed > 0, "Nothing to distribute");

        // Compute each bucket. Staker share remains in the contract.
        let contributor_amount =
            undistributed * self.contributor_share_bps as u128 / BPS_DENOMINATOR as u128;
        let reserve_amount =
            undistributed * self.reserve_share_bps as u128 / BPS_DENOMINATOR as u128;
        let proposer_amount =
            undistributed * self.proposer_share_bps as u128 / BPS_DENOMINATOR as u128;
        // Staker share = remainder (avoids rounding dust)
        let staker_amount = undistributed
            .saturating_sub(contributor_amount)
            .saturating_sub(reserve_amount)
            .saturating_sub(proposer_amount);

        self.distributed_revenue += undistributed;

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"revenue_distributed\",\"data\":{{\"total\":\"{}\",\"staker\":\"{}\",\"contributor\":\"{}\",\"reserve\":\"{}\",\"proposer\":\"{}\"}}}}",
            undistributed, staker_amount, contributor_amount, reserve_amount, proposer_amount
        ));

        // Chain the three transfers. Staker share stays on the contract balance.
        Promise::new(self.contributor_wallet.clone())
            .transfer(NearToken::from_yoctonear(contributor_amount))
            .then(
                Promise::new(self.reserve_wallet.clone())
                    .transfer(NearToken::from_yoctonear(reserve_amount)),
            )
            .then(
                Promise::new(self.proposer_wallet.clone())
                    .transfer(NearToken::from_yoctonear(proposer_amount)),
            )
    }

    /// Owner: update the four revenue share bps. Must sum to 10_000.
    pub fn update_shares(
        &mut self,
        staker_bps: u32,
        contributor_bps: u32,
        reserve_bps: u32,
        proposer_bps: u32,
    ) {
        self.assert_treasury_owner();
        assert_eq!(
            staker_bps + contributor_bps + reserve_bps + proposer_bps,
            BPS_DENOMINATOR,
            "Shares must sum to 10_000 bps"
        );
        self.staker_share_bps = staker_bps;
        self.contributor_share_bps = contributor_bps;
        self.reserve_share_bps = reserve_bps;
        self.proposer_share_bps = proposer_bps;

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"shares_updated\",\"data\":{{\"staker\":{},\"contributor\":{},\"reserve\":{},\"proposer\":{}}}}}",
            staker_bps, contributor_bps, reserve_bps, proposer_bps
        ));
    }

    /// Owner: update the three external recipient wallets (contributor,
    /// reserve, proposer). Staker share remains on-contract.
    pub fn set_revenue_recipients(
        &mut self,
        contributor_wallet: AccountId,
        reserve_wallet: AccountId,
        proposer_wallet: AccountId,
    ) {
        self.assert_treasury_owner();
        self.contributor_wallet = contributor_wallet;
        self.reserve_wallet = reserve_wallet;
        self.proposer_wallet = proposer_wallet;
    }

    /// View: full snapshot of treasury state.
    pub fn get_treasury_stats(&self) -> TreasuryStats {
        let undistributed = self.total_revenue.saturating_sub(self.distributed_revenue);
        TreasuryStats {
            total_revenue: U128(self.total_revenue),
            distributed_revenue: U128(self.distributed_revenue),
            undistributed_revenue: U128(undistributed),
            staker_share_bps: self.staker_share_bps,
            contributor_share_bps: self.contributor_share_bps,
            reserve_share_bps: self.reserve_share_bps,
            proposer_share_bps: self.proposer_share_bps,
            contributor_wallet: self.contributor_wallet.clone(),
            reserve_wallet: self.reserve_wallet.clone(),
            proposer_wallet: self.proposer_wallet.clone(),
        }
    }
}
