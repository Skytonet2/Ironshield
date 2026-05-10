module azuka::missions {
    use std::option::{Self, Option};
    use std::string::String;
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::sui::SUI;

    use azuka::core::{Self, Config, AdminCap};

    /// Status enum encoded as u8 for cheap storage. Indexers map back to
    /// the NEAR string vocabulary via the `status_label` helper.
    const STATUS_OPEN: u8 = 1;
    const STATUS_CLAIMED: u8 = 2;
    const STATUS_SUBMITTED: u8 = 3;
    const STATUS_APPROVED: u8 = 4;
    const STATUS_REJECTED: u8 = 5;
    const STATUS_EXPIRED: u8 = 6;
    const STATUS_ABORTED: u8 = 7;

    /// Caps mirror NEAR contract/src/mission_engine.rs.
    const DEFAULT_PLATFORM_FEE_BPS: u32 = 500;   // 5%
    const MAX_PLATFORM_FEE_BPS: u32 = 1000;      // 10% hard cap
    const BPS_DENOM: u64 = 10_000;
    const MS_PER_SEC: u64 = 1_000;
    const MIN_REVIEW_WINDOW_SECS: u64 = 60 * 60;
    const MAX_REVIEW_WINDOW_SECS: u64 = 60 * 60 * 24 * 30;
    const DEFAULT_REVIEW_WINDOW_SECS: u64 = 60 * 60 * 24 * 7;

    const E_PAUSED_REQUIRED: u64 = 0;
    const E_ESCROW_REQUIRED: u64 = 1;
    const E_TEMPLATE_REQUIRED: u64 = 2;
    const E_INPUTS_REQUIRED: u64 = 3;
    const E_AUDIT_ROOT_REQUIRED: u64 = 4;
    const E_FEE_TOO_HIGH: u64 = 5;
    const E_NOT_OPEN: u64 = 6;
    const E_NOT_CLAIMED: u64 = 7;
    const E_NOT_SUBMITTED: u64 = 8;
    const E_POSTER_CANNOT_CLAIM: u64 = 9;
    const E_NOT_POSTER: u64 = 10;
    const E_NOT_CLAIMANT: u64 = 11;
    const E_DEADLINE_NOT_PASSED: u64 = 12;
    const E_BAD_REVIEW_WINDOW: u64 = 13;

    /// Shared registry: monotonic id counter + tunable default fee.
    public struct MissionRegistry has key {
        id: UID,
        next_mission_id: u64,
        default_platform_fee_bps: u32,
    }

    /// Each mission is its own shared object so poster, claimant, and any
    /// caller (for expire) can mutate lifecycle state without contending
    /// on a global registry lock. Holds its own Balance<SUI> escrow.
    public struct Mission has key {
        id: UID,
        mission_id: u64,
        poster: address,
        claimant: Option<address>,
        template_id: String,
        kit_slug: Option<String>,
        inputs_hash: String,
        escrow: Balance<SUI>,
        platform_fee_bps: u32,
        status: u8,
        audit_root: Option<String>,
        review_window_ms: u64,
        created_at_ms: u64,
        claimed_at_ms: Option<u64>,
        submitted_at_ms: Option<u64>,
        review_deadline_ms: Option<u64>,
        finalized_at_ms: Option<u64>,
    }

    public struct MissionCreated has copy, drop {
        mission_id: u64,
        mission_object_id: ID,
        poster: address,
        template_id: String,
        escrow_mist: u64,
        platform_fee_bps: u32,
    }

    public struct MissionClaimed has copy, drop {
        mission_id: u64,
        claimant: address,
    }

    public struct MissionSubmitted has copy, drop {
        mission_id: u64,
        audit_root: String,
        review_deadline_ms: u64,
    }

    public struct MissionApproved has copy, drop {
        mission_id: u64,
        claimant: address,
        payout_mist: u64,
        platform_cut_mist: u64,
    }

    public struct MissionRejected has copy, drop {
        mission_id: u64,
        reason: String,
        refund_mist: u64,
    }

    public struct MissionAborted has copy, drop {
        mission_id: u64,
        refund_mist: u64,
    }

    public struct MissionExpired has copy, drop {
        mission_id: u64,
        claimant: address,
        payout_mist: u64,
        platform_cut_mist: u64,
    }

    public struct MissionDefaultFeeChanged has copy, drop {
        old_bps: u32,
        new_bps: u32,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(MissionRegistry {
            id: object::new(ctx),
            next_mission_id: 0,
            default_platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
        });
    }

    /// Create a mission. The `payment` Coin<SUI> becomes the escrow — its
    /// full value is locked. Caller (poster) is the sender.
    public fun create_mission(
        registry: &mut MissionRegistry,
        config: &Config,
        template_id: String,
        kit_slug: Option<String>,
        inputs_hash: String,
        review_window_secs: Option<u64>,
        payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): u64 {
        core::assert_not_paused(config);
        assert!(template_id.length() > 0, E_TEMPLATE_REQUIRED);
        assert!(inputs_hash.length() > 0, E_INPUTS_REQUIRED);

        let escrow_mist = coin::value(&payment);
        assert!(escrow_mist > 0, E_ESCROW_REQUIRED);

        let raw_secs = if (option::is_some(&review_window_secs)) {
            *option::borrow(&review_window_secs)
        } else {
            DEFAULT_REVIEW_WINDOW_SECS
        };
        let clamped_secs = clamp(raw_secs, MIN_REVIEW_WINDOW_SECS, MAX_REVIEW_WINDOW_SECS);
        let review_window_ms = clamped_secs * MS_PER_SEC;

        let mission_id = registry.next_mission_id;
        registry.next_mission_id = registry.next_mission_id + 1;
        let now = clock::timestamp_ms(clock);
        let poster = tx_context::sender(ctx);
        let fee_bps = registry.default_platform_fee_bps;

        let mission = Mission {
            id: object::new(ctx),
            mission_id,
            poster,
            claimant: option::none(),
            template_id,
            kit_slug,
            inputs_hash,
            escrow: coin::into_balance(payment),
            platform_fee_bps: fee_bps,
            status: STATUS_OPEN,
            audit_root: option::none(),
            review_window_ms,
            created_at_ms: now,
            claimed_at_ms: option::none(),
            submitted_at_ms: option::none(),
            review_deadline_ms: option::none(),
            finalized_at_ms: option::none(),
        };
        let mission_object_id = object::id(&mission);

        event::emit(MissionCreated {
            mission_id,
            mission_object_id,
            poster,
            template_id: mission.template_id,
            escrow_mist,
            platform_fee_bps: fee_bps,
        });

        transfer::share_object(mission);
        mission_id
    }

    public fun claim_mission(
        mission: &mut Mission,
        config: &Config,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        core::assert_not_paused(config);
        assert!(mission.status == STATUS_OPEN, E_NOT_OPEN);
        let claimant = tx_context::sender(ctx);
        assert!(claimant != mission.poster, E_POSTER_CANNOT_CLAIM);

        mission.claimant = option::some(claimant);
        mission.status = STATUS_CLAIMED;
        mission.claimed_at_ms = option::some(clock::timestamp_ms(clock));

        event::emit(MissionClaimed { mission_id: mission.mission_id, claimant });
    }

    public fun submit_mission_work(
        mission: &mut Mission,
        config: &Config,
        audit_root: String,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        core::assert_not_paused(config);
        assert!(mission.status == STATUS_CLAIMED, E_NOT_CLAIMED);
        assert!(audit_root.length() > 0, E_AUDIT_ROOT_REQUIRED);
        assert_claimant(mission, ctx);

        let now = clock::timestamp_ms(clock);
        mission.audit_root = option::some(audit_root);
        mission.status = STATUS_SUBMITTED;
        mission.submitted_at_ms = option::some(now);
        mission.review_deadline_ms = option::some(now + mission.review_window_ms);

        event::emit(MissionSubmitted {
            mission_id: mission.mission_id,
            audit_root: *option::borrow(&mission.audit_root),
            review_deadline_ms: *option::borrow(&mission.review_deadline_ms),
        });
    }

    public fun approve_mission(
        mission: &mut Mission,
        config: &Config,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(mission.status == STATUS_SUBMITTED, E_NOT_SUBMITTED);
        assert_poster(mission, ctx);
        let claimant = *option::borrow(&mission.claimant);

        let (payout_mist, platform_cut_mist) = pay_out_escrow(mission, config, claimant, ctx);
        mission.status = STATUS_APPROVED;
        mission.finalized_at_ms = option::some(clock::timestamp_ms(clock));

        event::emit(MissionApproved {
            mission_id: mission.mission_id,
            claimant,
            payout_mist,
            platform_cut_mist,
        });
    }

    public fun reject_mission(
        mission: &mut Mission,
        reason: String,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(mission.status == STATUS_SUBMITTED, E_NOT_SUBMITTED);
        assert_poster(mission, ctx);

        let refund_mist = refund_escrow(mission, ctx);
        mission.status = STATUS_REJECTED;
        mission.finalized_at_ms = option::some(clock::timestamp_ms(clock));

        event::emit(MissionRejected {
            mission_id: mission.mission_id,
            reason,
            refund_mist,
        });
    }

    public fun abort_mission(
        mission: &mut Mission,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(mission.status == STATUS_OPEN, E_NOT_OPEN);
        assert_poster(mission, ctx);

        let refund_mist = refund_escrow(mission, ctx);
        mission.status = STATUS_ABORTED;
        mission.finalized_at_ms = option::some(clock::timestamp_ms(clock));

        event::emit(MissionAborted { mission_id: mission.mission_id, refund_mist });
    }

    /// Permissionless: anyone can settle a submitted mission whose review
    /// deadline has passed. Auto-pays the claimant. Prevents funds being
    /// trapped behind a ghosted poster.
    public fun expire_mission(
        mission: &mut Mission,
        config: &Config,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(mission.status == STATUS_SUBMITTED, E_NOT_SUBMITTED);
        let deadline = *option::borrow(&mission.review_deadline_ms);
        let now = clock::timestamp_ms(clock);
        assert!(now >= deadline, E_DEADLINE_NOT_PASSED);
        let claimant = *option::borrow(&mission.claimant);

        let (payout_mist, platform_cut_mist) = pay_out_escrow(mission, config, claimant, ctx);
        mission.status = STATUS_EXPIRED;
        mission.finalized_at_ms = option::some(now);

        event::emit(MissionExpired {
            mission_id: mission.mission_id,
            claimant,
            payout_mist,
            platform_cut_mist,
        });
    }

    /// Admin-only: tune the default platform fee for missions created
    /// from now on. Existing missions keep the fee snapshotted at create.
    public fun set_default_platform_fee_bps(
        registry: &mut MissionRegistry,
        config: &Config,
        cap: &AdminCap,
        new_bps: u32,
        ctx: &TxContext,
    ) {
        core::assert_admin(config, cap, ctx);
        assert!(new_bps <= MAX_PLATFORM_FEE_BPS, E_FEE_TOO_HIGH);
        let old = registry.default_platform_fee_bps;
        registry.default_platform_fee_bps = new_bps;
        event::emit(MissionDefaultFeeChanged { old_bps: old, new_bps });
    }

    // ── Reads ────────────────────────────────────────────────────────

    public fun mission_id(m: &Mission): u64 { m.mission_id }
    public fun poster(m: &Mission): address { m.poster }
    public fun claimant(m: &Mission): Option<address> { m.claimant }
    public fun status(m: &Mission): u8 { m.status }
    public fun escrow_mist(m: &Mission): u64 { balance::value(&m.escrow) }
    public fun platform_fee_bps(m: &Mission): u32 { m.platform_fee_bps }
    public fun review_deadline_ms(m: &Mission): Option<u64> { m.review_deadline_ms }
    public fun audit_root(m: &Mission): Option<String> { m.audit_root }
    public fun next_mission_id(r: &MissionRegistry): u64 { r.next_mission_id }
    public fun default_platform_fee_bps(r: &MissionRegistry): u32 { r.default_platform_fee_bps }

    public fun status_open(): u8 { STATUS_OPEN }
    public fun status_claimed(): u8 { STATUS_CLAIMED }
    public fun status_submitted(): u8 { STATUS_SUBMITTED }
    public fun status_approved(): u8 { STATUS_APPROVED }
    public fun status_rejected(): u8 { STATUS_REJECTED }
    public fun status_expired(): u8 { STATUS_EXPIRED }
    public fun status_aborted(): u8 { STATUS_ABORTED }

    // ── Internals ────────────────────────────────────────────────────

    fun assert_poster(mission: &Mission, ctx: &TxContext) {
        assert!(mission.poster == tx_context::sender(ctx), E_NOT_POSTER);
    }

    fun assert_claimant(mission: &Mission, ctx: &TxContext) {
        let sender = tx_context::sender(ctx);
        let stored = *option::borrow(&mission.claimant);
        assert!(stored == sender, E_NOT_CLAIMANT);
    }

    /// Splits the escrow into platform cut + claimant payout, transfers
    /// both. Returns (payout_mist, platform_cut_mist) for events.
    fun pay_out_escrow(
        mission: &mut Mission,
        config: &Config,
        claimant: address,
        ctx: &mut TxContext,
    ): (u64, u64) {
        let total = balance::value(&mission.escrow);
        let platform_cut_mist = (total * (mission.platform_fee_bps as u64)) / BPS_DENOM;
        let payout_mist = total - platform_cut_mist;

        if (platform_cut_mist > 0) {
            let cut_balance = balance::split(&mut mission.escrow, platform_cut_mist);
            let cut_coin = coin::from_balance(cut_balance, ctx);
            transfer::public_transfer(cut_coin, core::admin(config));
        };
        if (payout_mist > 0) {
            let payout_balance = balance::split(&mut mission.escrow, payout_mist);
            let payout_coin = coin::from_balance(payout_balance, ctx);
            transfer::public_transfer(payout_coin, claimant);
        };
        (payout_mist, platform_cut_mist)
    }

    /// Refunds the full escrow to the poster. Returns the refunded amount.
    fun refund_escrow(mission: &mut Mission, ctx: &mut TxContext): u64 {
        let amount = balance::value(&mission.escrow);
        if (amount > 0) {
            let refund_balance = balance::split(&mut mission.escrow, amount);
            let refund_coin = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund_coin, mission.poster);
        };
        amount
    }

    fun clamp(value: u64, lo: u64, hi: u64): u64 {
        if (value < lo) lo else if (value > hi) hi else value
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
