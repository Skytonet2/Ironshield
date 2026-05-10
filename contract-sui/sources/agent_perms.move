module azuka::agent_perms {
    use sui::clock::{Self, Clock};
    use sui::dynamic_field as df;
    use sui::event;

    use azuka::core::{Self, Config};
    use azuka::agents::{Self, AgentProfile};

    // Permission bits — match NEAR layout in contract/src/agents.rs
    const PERM_READ_DATA: u8 = 1 << 0;
    const PERM_SIGN_TX: u8 = 1 << 1;
    const PERM_INTERACT: u8 = 1 << 2;
    const PERM_SEND_MSG: u8 = 1 << 3;
    const PERM_TRANSFER: u8 = 1 << 4;
    const PERM_ALL: u8 = PERM_READ_DATA | PERM_SIGN_TX | PERM_INTERACT | PERM_SEND_MSG | PERM_TRANSFER;

    const MS_PER_DAY: u64 = 24 * 3600 * 1000;

    const E_UNKNOWN_PERM_BITS: u64 = 0;
    const E_NOT_OWNER: u64 = 1;
    const E_NOT_ORCHESTRATOR: u64 = 2;
    const E_DAILY_LIMIT_EXCEEDED: u64 = 3;

    public struct AgentPermissionsRegistry has key {
        id: UID,
    }

    public struct AgentPermissions has copy, drop, store {
        mask: u8,
        daily_limit_mist: u64,
        daily_spent_day: u32,
        daily_spent_mist: u64,
    }

    public struct PermissionsChanged has copy, drop {
        owner: address,
        mask: u8,
    }

    public struct DailyLimitChanged has copy, drop {
        owner: address,
        daily_limit_mist: u64,
    }

    public struct SpendRecorded has copy, drop {
        owner: address,
        amount_mist: u64,
        day: u32,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(AgentPermissionsRegistry {
            id: object::new(ctx),
        });
    }

    public fun set_permissions(
        registry: &mut AgentPermissionsRegistry,
        config: &Config,
        profile: &AgentProfile,
        mask: u8,
        ctx: &TxContext,
    ) {
        core::assert_not_paused(config);
        // Sui's owned-object resolution already proves the caller owns
        // `profile`, so this is defense-in-depth against future refactors
        // that take an immutable reference from a shared wrapper.
        assert!(agents::profile_owner(profile) == tx_context::sender(ctx), E_NOT_OWNER);
        assert!(mask & (PERM_ALL ^ 0xFF) == 0, E_UNKNOWN_PERM_BITS);

        let owner = agents::profile_owner(profile);
        let mut row = take_or_default(registry, owner);
        row.mask = mask;
        write(registry, owner, row);

        event::emit(PermissionsChanged { owner, mask });
    }

    public fun set_daily_limit(
        registry: &mut AgentPermissionsRegistry,
        config: &Config,
        profile: &AgentProfile,
        daily_limit_mist: u64,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        core::assert_not_paused(config);
        assert!(agents::profile_owner(profile) == tx_context::sender(ctx), E_NOT_OWNER);

        let owner = agents::profile_owner(profile);
        let mut row = take_or_default(registry, owner);
        row.daily_limit_mist = daily_limit_mist;

        let today = current_day_index(clock);
        if (row.daily_spent_day != today) {
            row.daily_spent_day = today;
            row.daily_spent_mist = 0;
        };
        write(registry, owner, row);

        event::emit(DailyLimitChanged { owner, daily_limit_mist });
    }

    /// Orchestrator-only: stamp a spend on `owner`'s rolling daily counter.
    /// Aborts when the new total would exceed daily_limit_mist (0 = unlimited).
    public fun record_spend(
        registry: &mut AgentPermissionsRegistry,
        config: &Config,
        owner: address,
        amount_mist: u64,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        core::assert_not_paused(config);
        assert!(tx_context::sender(ctx) == core::orchestrator(config), E_NOT_ORCHESTRATOR);

        let mut row = take_or_default(registry, owner);
        let today = current_day_index(clock);
        if (row.daily_spent_day != today) {
            row.daily_spent_day = today;
            row.daily_spent_mist = 0;
        };
        let new_total = row.daily_spent_mist + amount_mist;
        if (row.daily_limit_mist > 0) {
            assert!(new_total <= row.daily_limit_mist, E_DAILY_LIMIT_EXCEEDED);
        };
        row.daily_spent_mist = new_total;
        write(registry, owner, row);

        event::emit(SpendRecorded { owner, amount_mist, day: today });
    }

    public fun get_permissions(registry: &AgentPermissionsRegistry, owner: address): AgentPermissions {
        if (df::exists_<address>(&registry.id, owner)) {
            *df::borrow<address, AgentPermissions>(&registry.id, owner)
        } else {
            default()
        }
    }

    public fun has_permissions(registry: &AgentPermissionsRegistry, owner: address): bool {
        df::exists_<address>(&registry.id, owner)
    }

    public fun mask(p: &AgentPermissions): u8 { p.mask }
    public fun daily_limit_mist(p: &AgentPermissions): u64 { p.daily_limit_mist }
    public fun daily_spent_day(p: &AgentPermissions): u32 { p.daily_spent_day }
    public fun daily_spent_mist(p: &AgentPermissions): u64 { p.daily_spent_mist }

    public fun perm_read_data(): u8 { PERM_READ_DATA }
    public fun perm_sign_tx(): u8 { PERM_SIGN_TX }
    public fun perm_interact(): u8 { PERM_INTERACT }
    public fun perm_send_msg(): u8 { PERM_SEND_MSG }
    public fun perm_transfer(): u8 { PERM_TRANSFER }
    public fun perm_all(): u8 { PERM_ALL }
    public fun perm_default(): u8 { PERM_READ_DATA }

    fun current_day_index(clock: &Clock): u32 {
        ((clock::timestamp_ms(clock) / MS_PER_DAY) as u32)
    }

    fun default(): AgentPermissions {
        AgentPermissions {
            mask: PERM_READ_DATA,
            daily_limit_mist: 0,
            daily_spent_day: 0,
            daily_spent_mist: 0,
        }
    }

    fun take_or_default(registry: &mut AgentPermissionsRegistry, owner: address): AgentPermissions {
        if (df::exists_<address>(&registry.id, owner)) {
            df::remove<address, AgentPermissions>(&mut registry.id, owner)
        } else {
            default()
        }
    }

    fun write(registry: &mut AgentPermissionsRegistry, owner: address, row: AgentPermissions) {
        df::add(&mut registry.id, owner, row);
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
