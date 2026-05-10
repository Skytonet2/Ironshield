module azuka::treasury {
    use std::string::String;
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::sui::SUI;

    use azuka::core::{Self, Config, AdminCap};

    const BPS_DENOM: u64 = 10_000;

    /// Default split: 40% contributor, 30% reserve, 30% proposer. NEAR's
    /// fourth "staker" bucket is dropped here because the staking module
    /// is deferred per the port plan; when it ships, the staker share
    /// re-enters via a treasury upgrade.
    const DEFAULT_CONTRIBUTOR_BPS: u32 = 4_000;
    const DEFAULT_RESERVE_BPS: u32 = 3_000;
    const DEFAULT_PROPOSER_BPS: u32 = 3_000;

    const E_DEPOSIT_REQUIRED: u64 = 0;
    const E_NOTHING_TO_DISTRIBUTE: u64 = 1;
    const E_BPS_SUM: u64 = 2;
    const E_RECIPIENT_NOT_SET: u64 = 3;

    public struct Treasury has key {
        id: UID,
        undistributed: Balance<SUI>,
        total_revenue_mist: u64,
        distributed_revenue_mist: u64,
        contributor_share_bps: u32,
        reserve_share_bps: u32,
        proposer_share_bps: u32,
        contributor_wallet: address,
        reserve_wallet: address,
        proposer_wallet: address,
    }

    public struct RevenueDeposited has copy, drop {
        amount_mist: u64,
        source: String,
        total_revenue_mist: u64,
    }

    public struct RevenueDistributed has copy, drop {
        total_mist: u64,
        contributor_mist: u64,
        reserve_mist: u64,
        proposer_mist: u64,
    }

    public struct SharesUpdated has copy, drop {
        contributor_bps: u32,
        reserve_bps: u32,
        proposer_bps: u32,
    }

    public struct RecipientsUpdated has copy, drop {
        contributor_wallet: address,
        reserve_wallet: address,
        proposer_wallet: address,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(Treasury {
            id: object::new(ctx),
            undistributed: balance::zero<SUI>(),
            total_revenue_mist: 0,
            distributed_revenue_mist: 0,
            contributor_share_bps: DEFAULT_CONTRIBUTOR_BPS,
            reserve_share_bps: DEFAULT_RESERVE_BPS,
            proposer_share_bps: DEFAULT_PROPOSER_BPS,
            contributor_wallet: @0x0,
            reserve_wallet: @0x0,
            proposer_wallet: @0x0,
        });
    }

    /// Anyone can deposit. The full Coin<SUI> value is added to the
    /// undistributed balance and the monotonic total_revenue_mist counter
    /// is bumped for indexer-friendly accounting.
    public fun deposit_revenue(
        treasury: &mut Treasury,
        config: &Config,
        payment: Coin<SUI>,
        source: String,
    ) {
        core::assert_not_paused(config);
        let amount = coin::value(&payment);
        assert!(amount > 0, E_DEPOSIT_REQUIRED);

        balance::join(&mut treasury.undistributed, coin::into_balance(payment));
        treasury.total_revenue_mist = treasury.total_revenue_mist + amount;

        event::emit(RevenueDeposited {
            amount_mist: amount,
            source,
            total_revenue_mist: treasury.total_revenue_mist,
        });
    }

    /// Permissionless distribute. Pulls all undistributed funds and pays
    /// out the three buckets per the configured bps. Aborts if any
    /// recipient is still @0x0 (admin must set them first via
    /// set_recipients).
    public fun distribute_revenue(
        treasury: &mut Treasury,
        ctx: &mut TxContext,
    ) {
        let total = balance::value(&treasury.undistributed);
        assert!(total > 0, E_NOTHING_TO_DISTRIBUTE);
        assert!(treasury.contributor_wallet != @0x0, E_RECIPIENT_NOT_SET);
        assert!(treasury.reserve_wallet != @0x0, E_RECIPIENT_NOT_SET);
        assert!(treasury.proposer_wallet != @0x0, E_RECIPIENT_NOT_SET);

        let contributor_mist = (total * (treasury.contributor_share_bps as u64)) / BPS_DENOM;
        let reserve_mist = (total * (treasury.reserve_share_bps as u64)) / BPS_DENOM;
        // Proposer absorbs rounding dust to keep the contract clean of leftover
        // sub-mist amounts that no caller can ever drain.
        let proposer_mist = total - contributor_mist - reserve_mist;

        if (contributor_mist > 0) {
            let bal = balance::split(&mut treasury.undistributed, contributor_mist);
            transfer::public_transfer(coin::from_balance(bal, ctx), treasury.contributor_wallet);
        };
        if (reserve_mist > 0) {
            let bal = balance::split(&mut treasury.undistributed, reserve_mist);
            transfer::public_transfer(coin::from_balance(bal, ctx), treasury.reserve_wallet);
        };
        if (proposer_mist > 0) {
            let bal = balance::split(&mut treasury.undistributed, proposer_mist);
            transfer::public_transfer(coin::from_balance(bal, ctx), treasury.proposer_wallet);
        };

        treasury.distributed_revenue_mist = treasury.distributed_revenue_mist + total;

        event::emit(RevenueDistributed {
            total_mist: total,
            contributor_mist,
            reserve_mist,
            proposer_mist,
        });
    }

    /// Admin: rotate the bps split. Must sum to 10000.
    public fun update_shares(
        treasury: &mut Treasury,
        config: &Config,
        cap: &AdminCap,
        contributor_bps: u32,
        reserve_bps: u32,
        proposer_bps: u32,
        ctx: &TxContext,
    ) {
        core::assert_admin(config, cap, ctx);
        assert!(
            contributor_bps + reserve_bps + proposer_bps == (BPS_DENOM as u32),
            E_BPS_SUM,
        );
        treasury.contributor_share_bps = contributor_bps;
        treasury.reserve_share_bps = reserve_bps;
        treasury.proposer_share_bps = proposer_bps;

        event::emit(SharesUpdated { contributor_bps, reserve_bps, proposer_bps });
    }

    /// Admin: set the three recipient wallets. Must be non-zero before
    /// distribute_revenue can succeed.
    public fun set_recipients(
        treasury: &mut Treasury,
        config: &Config,
        cap: &AdminCap,
        contributor_wallet: address,
        reserve_wallet: address,
        proposer_wallet: address,
        ctx: &TxContext,
    ) {
        core::assert_admin(config, cap, ctx);
        assert!(contributor_wallet != @0x0, E_RECIPIENT_NOT_SET);
        assert!(reserve_wallet != @0x0, E_RECIPIENT_NOT_SET);
        assert!(proposer_wallet != @0x0, E_RECIPIENT_NOT_SET);

        treasury.contributor_wallet = contributor_wallet;
        treasury.reserve_wallet = reserve_wallet;
        treasury.proposer_wallet = proposer_wallet;

        event::emit(RecipientsUpdated { contributor_wallet, reserve_wallet, proposer_wallet });
    }

    // ── Reads ────────────────────────────────────────────────────────

    public fun undistributed_mist(t: &Treasury): u64 { balance::value(&t.undistributed) }
    public fun total_revenue_mist(t: &Treasury): u64 { t.total_revenue_mist }
    public fun distributed_revenue_mist(t: &Treasury): u64 { t.distributed_revenue_mist }
    public fun contributor_share_bps(t: &Treasury): u32 { t.contributor_share_bps }
    public fun reserve_share_bps(t: &Treasury): u32 { t.reserve_share_bps }
    public fun proposer_share_bps(t: &Treasury): u32 { t.proposer_share_bps }
    public fun contributor_wallet(t: &Treasury): address { t.contributor_wallet }
    public fun reserve_wallet(t: &Treasury): address { t.reserve_wallet }
    public fun proposer_wallet(t: &Treasury): address { t.proposer_wallet }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
