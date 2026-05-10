module azuka::core {
    use sui::event;

    #[test_only]
    use sui::test_scenario;

    const VERSION: u64 = 1;
    const E_NOT_ADMIN: u64 = 0;
    const E_ZERO_ADDRESS: u64 = 1;
    const E_PAUSED: u64 = 2;

    /// Owned by the current AZUKA contract administrator.
    public struct AdminCap has key {
        id: UID,
    }

    /// Shared root object used by future Sui modules.
    public struct Config has key {
        id: UID,
        version: u64,
        admin: address,
        orchestrator: address,
        paused: bool,
    }

    public struct ConfigCreated has copy, drop {
        admin: address,
        orchestrator: address,
        version: u64,
    }

    public struct PausedSet has copy, drop {
        admin: address,
        paused: bool,
    }

    public struct OrchestratorSet has copy, drop {
        admin: address,
        orchestrator: address,
    }

    public struct AdminTransferred has copy, drop {
        old_admin: address,
        new_admin: address,
    }

    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);

        transfer::transfer(AdminCap {
            id: object::new(ctx),
        }, sender);

        transfer::share_object(Config {
            id: object::new(ctx),
            version: VERSION,
            admin: sender,
            orchestrator: sender,
            paused: false,
        });

        event::emit(ConfigCreated {
            admin: sender,
            orchestrator: sender,
            version: VERSION,
        });
    }

    public fun assert_admin(config: &Config, _cap: &AdminCap, ctx: &TxContext) {
        assert!(config.admin == tx_context::sender(ctx), E_NOT_ADMIN);
    }

    public fun assert_not_paused(config: &Config) {
        assert!(!config.paused, E_PAUSED);
    }

    public fun version(config: &Config): u64 {
        config.version
    }

    public fun admin(config: &Config): address {
        config.admin
    }

    public fun orchestrator(config: &Config): address {
        config.orchestrator
    }

    public fun is_paused(config: &Config): bool {
        config.paused
    }

    #[test_only]
    fun new_for_testing(ctx: &mut TxContext): (Config, AdminCap) {
        let sender = tx_context::sender(ctx);

        (
            Config {
                id: object::new(ctx),
                version: VERSION,
                admin: sender,
                orchestrator: sender,
                paused: false,
            },
            AdminCap {
                id: object::new(ctx),
            },
        )
    }

    #[test_only]
    fun destroy_for_testing(config: Config, cap: AdminCap) {
        let Config {
            id: config_id,
            version: _,
            admin: _,
            orchestrator: _,
            paused: _,
        } = config;
        let AdminCap { id: cap_id } = cap;

        object::delete(config_id);
        object::delete(cap_id);
    }

    public fun set_paused(
        config: &mut Config,
        cap: &AdminCap,
        paused: bool,
        ctx: &mut TxContext,
    ) {
        assert_admin(config, cap, ctx);
        config.paused = paused;

        event::emit(PausedSet {
            admin: tx_context::sender(ctx),
            paused,
        });
    }

    public fun set_orchestrator(
        config: &mut Config,
        cap: &AdminCap,
        orchestrator: address,
        ctx: &mut TxContext,
    ) {
        assert_admin(config, cap, ctx);
        assert!(orchestrator != @0x0, E_ZERO_ADDRESS);
        config.orchestrator = orchestrator;

        event::emit(OrchestratorSet {
            admin: tx_context::sender(ctx),
            orchestrator,
        });
    }

    public fun transfer_admin(
        config: &mut Config,
        cap: AdminCap,
        new_admin: address,
        ctx: &mut TxContext,
    ) {
        assert_admin(config, &cap, ctx);
        assert!(new_admin != @0x0, E_ZERO_ADDRESS);

        let old_admin = config.admin;
        config.admin = new_admin;
        transfer::transfer(cap, new_admin);

        event::emit(AdminTransferred {
            old_admin,
            new_admin,
        });
    }

    #[test]
    fun test_initial_config() {
        let mut scenario = test_scenario::begin(@0xA11CE);
        let (config, cap) = new_for_testing(scenario.ctx());

        assert!(version(&config) == VERSION, 100);
        assert!(admin(&config) == @0xA11CE, 101);
        assert!(orchestrator(&config) == @0xA11CE, 102);
        assert!(!is_paused(&config), 103);
        assert_not_paused(&config);

        destroy_for_testing(config, cap);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_admin_can_pause_and_unpause() {
        let mut scenario = test_scenario::begin(@0xA11CE);
        let (mut config, cap) = new_for_testing(scenario.ctx());

        set_paused(&mut config, &cap, true, scenario.ctx());
        assert!(is_paused(&config), 110);

        set_paused(&mut config, &cap, false, scenario.ctx());
        assert!(!is_paused(&config), 111);
        assert_not_paused(&config);

        destroy_for_testing(config, cap);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_admin_can_set_orchestrator() {
        let mut scenario = test_scenario::begin(@0xA11CE);
        let (mut config, cap) = new_for_testing(scenario.ctx());
        let next = @0xA11CE;

        set_orchestrator(&mut config, &cap, next, scenario.ctx());
        assert!(orchestrator(&config) == next, 120);

        destroy_for_testing(config, cap);
        test_scenario::end(scenario);
    }

    #[test, expected_failure(abort_code = E_PAUSED)]
    fun test_pause_guard_aborts() {
        let mut scenario = test_scenario::begin(@0xA11CE);
        let (mut config, cap) = new_for_testing(scenario.ctx());

        set_paused(&mut config, &cap, true, scenario.ctx());
        assert_not_paused(&config);

        destroy_for_testing(config, cap);
        test_scenario::end(scenario);
    }
}
