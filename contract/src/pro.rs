// contract/src/pro.rs — IronShield Pro membership (Day 18.1)
//
// "Pro" is stake-locked, not a subscription. A wallet earns Pro perks by
// (a) keeping at least PRO_MIN_STAKE_YOCTO of $IRONCLAW staked across all
// pools and (b) committing to keep that stake locked for at least
// PRO_MIN_LOCK_NS nanoseconds via `extend_lock`. Off-chain perks (higher
// AI budget, PRO badge, locked themes) gate on the `is_pro` view.
//
// Storage: a single LookupMap<AccountId, u64> under prefix b"R" maps
// wallet → unix-ns timestamp the wallet has committed to staying locked
// until. Migration adds it empty; default for any existing staker is 0
// (== "not committed"), so they're not silently flipped to Pro by the
// upgrade.
//
// extend_lock is idempotent and monotonic — it never lowers an existing
// lock. To opt out of Pro, a user simply lets the clock run down (and/or
// pays the pool's early-exit penalty to unstake). There is no
// shorten_lock; allowing one would defeat the commitment signal Pro
// relies on.

use crate::*;

/// Minimum staked balance (across all pools) required for Pro. 10,000 IRONCLAW.
/// IRONCLAW has 24 decimal places (NEAR convention), so the literal is
/// 10_000 * 10^24 yoctoIRONCLAW.
pub const PRO_MIN_STAKE_YOCTO: u128 = 10_000 * 1_000_000_000_000_000_000_000_000;

/// Minimum forward-looking lock duration to qualify for Pro: 30 days
/// expressed in nanoseconds (the unit env::block_timestamp returns).
pub const PRO_MIN_LOCK_NS: u64 = 30 * 86_400 * 1_000_000_000;

#[near]
impl StakingContract {
    /// Sum of $IRONCLAW staked by `account_id` across all pools. Mirrors
    /// the per-account total used by `get_voting_power` so Pro and
    /// governance read the same number.
    fn pro_total_staked(&self, account_id: &AccountId) -> u128 {
        (0..self.pools.len())
            .map(|pid| {
                let key = get_user_key(account_id, pid);
                self.user_info.get(&key).map_or(0, |u| u.amount)
            })
            .sum()
    }

    /// Extend (or set, if absent) the caller's Pro lock-until timestamp.
    /// `seconds` is added to `now`; the new value only replaces the
    /// existing one if it pushes the lock further out — extend never
    /// shortens. A user wanting more Pro time calls this again with the
    /// remaining slack.
    ///
    /// Side-effect-free with respect to the user's actual stake: this
    /// is purely a commitment signal. Unstaking still goes through
    /// `withdraw` and incurs the pool's early-exit penalty if the
    /// pool's lock_period_ns hasn't elapsed; the Pro-lock value is
    /// independent and the user simply loses Pro status if their stake
    /// falls below PRO_MIN_STAKE_YOCTO.
    pub fn extend_lock(&mut self, seconds: u64) {
        assert!(seconds <= 5 * 365 * 86_400,
            "extend_lock seconds bounded at 5 years");
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp();
        let proposed = now.saturating_add(seconds.saturating_mul(1_000_000_000));
        let existing = self.pro_locks.get(&caller).copied().unwrap_or(0);
        let next = existing.max(proposed);
        if next != existing {
            self.pro_locks.insert(caller.clone(), next);
            env::log_str(&format!(
                "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"pro_lock_extended\",\"data\":{{\"account\":\"{}\",\"lock_until_ns\":{}}}}}",
                caller, next
            ));
        }
    }

    /// View: is this account a Pro member right now?
    /// True iff total stake across all pools is at least PRO_MIN_STAKE_YOCTO
    /// AND the wallet's lock-until is at least PRO_MIN_LOCK_NS in the
    /// future. The "in the future by N" check (rather than a flat
    /// "in the future") is what gives the lock its commitment property:
    /// a wallet has to keep re-extending well before expiry to stay Pro.
    pub fn is_pro(&self, account_id: AccountId) -> bool {
        if self.pro_total_staked(&account_id) < PRO_MIN_STAKE_YOCTO {
            return false;
        }
        let lock_until = self.pro_locks.get(&account_id).copied().unwrap_or(0);
        let now = env::block_timestamp();
        lock_until >= now.saturating_add(PRO_MIN_LOCK_NS)
    }

    /// View: raw lock-until timestamp (unix ns). 0 means never locked.
    pub fn get_pro_lock_until(&self, account_id: AccountId) -> u64 {
        self.pro_locks.get(&account_id).copied().unwrap_or(0)
    }

    /// View: the constants the UI needs to render the upgrade flow
    /// without hard-coding them on the frontend.
    pub fn get_pro_min_stake(&self) -> U128 {
        U128(PRO_MIN_STAKE_YOCTO)
    }

    pub fn get_pro_min_lock_seconds(&self) -> u64 {
        PRO_MIN_LOCK_NS / 1_000_000_000
    }
}
