#[test_only]
module azuka::agent_perms_tests {
    use std::string;
    use sui::clock;
    use sui::test_scenario as ts;

    use azuka::core::{Self, Config, AdminCap};
    use azuka::agents::{Self, AgentRegistry, AgentProfile};
    use azuka::agent_perms::{Self, AgentPermissionsRegistry};

    const ADMIN: address = @0xA11CE;
    const ALICE: address = @0xA01;
    const ORCH: address = @0x0CC;

    const E_UNKNOWN_PERM_BITS: u64 = 0;
    const E_NOT_OWNER: u64 = 1;
    const E_NOT_ORCHESTRATOR: u64 = 2;
    const E_DAILY_LIMIT_EXCEEDED: u64 = 3;

    fun bootstrap(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let ctx = ts::ctx(scenario);
            core::init_for_testing(ctx);
            agents::init_for_testing(ctx);
            agent_perms::init_for_testing(ctx);
        };
        // Point orchestrator at ORCH
        ts::next_tx(scenario, ADMIN);
        {
            let mut config = ts::take_shared<Config>(scenario);
            let cap = ts::take_from_sender<AdminCap>(scenario);
            core::set_orchestrator(&mut config, &cap, ORCH, ts::ctx(scenario));
            ts::return_shared(config);
            ts::return_to_sender(scenario, cap);
        };
    }

    fun new_clock(scenario: &mut ts::Scenario): clock::Clock {
        ts::next_tx(scenario, ADMIN);
        clock::create_for_testing(ts::ctx(scenario))
    }

    fun register_alice(scenario: &mut ts::Scenario, c: &clock::Clock) {
        ts::next_tx(scenario, ALICE);
        let mut registry = ts::take_shared<AgentRegistry>(scenario);
        let config = ts::take_shared<Config>(scenario);
        agents::register_agent(
            &mut registry,
            &config,
            string::utf8(b"alice"),
            string::utf8(b""),
            c,
            ts::ctx(scenario),
        );
        ts::return_shared(registry);
        ts::return_shared(config);
    }

    #[test]
    fun set_permissions_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_alice(&mut scenario, &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);

            let mask = agent_perms::perm_read_data() | agent_perms::perm_send_msg();
            agent_perms::set_permissions(&mut perms, &config, &profile, mask, ts::ctx(&mut scenario));

            let p = agent_perms::get_permissions(&perms, ALICE);
            assert!(agent_perms::mask(&p) == mask, 100);

            ts::return_shared(perms);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_UNKNOWN_PERM_BITS, location = azuka::agent_perms)]
    fun set_permissions_unknown_bits_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_alice(&mut scenario, &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            // Bit 7 (0x80) is outside PERM_ALL (0x1F)
            agent_perms::set_permissions(&mut perms, &config, &profile, 0x80, ts::ctx(&mut scenario));
            ts::return_shared(perms);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun record_spend_within_limit_passes() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_alice(&mut scenario, &c);

        // Alice sets a 100 MIST daily limit
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            agent_perms::set_daily_limit(&mut perms, &config, &profile, 100, &c, ts::ctx(&mut scenario));
            ts::return_shared(perms);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        // Orchestrator records two spends totaling 90 MIST — both fit
        ts::next_tx(&mut scenario, ORCH);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            agent_perms::record_spend(&mut perms, &config, ALICE, 50, &c, ts::ctx(&mut scenario));
            agent_perms::record_spend(&mut perms, &config, ALICE, 40, &c, ts::ctx(&mut scenario));
            let p = agent_perms::get_permissions(&perms, ALICE);
            assert!(agent_perms::daily_spent_mist(&p) == 90, 200);
            ts::return_shared(perms);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_DAILY_LIMIT_EXCEEDED, location = azuka::agent_perms)]
    fun record_spend_over_limit_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_alice(&mut scenario, &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            agent_perms::set_daily_limit(&mut perms, &config, &profile, 100, &c, ts::ctx(&mut scenario));
            ts::return_shared(perms);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        ts::next_tx(&mut scenario, ORCH);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            agent_perms::record_spend(&mut perms, &config, ALICE, 80, &c, ts::ctx(&mut scenario));
            agent_perms::record_spend(&mut perms, &config, ALICE, 30, &c, ts::ctx(&mut scenario));
            ts::return_shared(perms);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun record_spend_unlimited_when_zero_limit() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_alice(&mut scenario, &c);

        ts::next_tx(&mut scenario, ORCH);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            // No daily_limit set yet (defaults to 0 = unlimited)
            agent_perms::record_spend(&mut perms, &config, ALICE, 1_000_000, &c, ts::ctx(&mut scenario));
            let p = agent_perms::get_permissions(&perms, ALICE);
            assert!(agent_perms::daily_spent_mist(&p) == 1_000_000, 300);
            ts::return_shared(perms);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun record_spend_resets_on_day_rollover() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let mut c = new_clock(&mut scenario);
        register_alice(&mut scenario, &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            agent_perms::set_daily_limit(&mut perms, &config, &profile, 100, &c, ts::ctx(&mut scenario));
            ts::return_shared(perms);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        // Day 0: spend 80
        ts::next_tx(&mut scenario, ORCH);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            agent_perms::record_spend(&mut perms, &config, ALICE, 80, &c, ts::ctx(&mut scenario));
            ts::return_shared(perms);
            ts::return_shared(config);
        };

        // Advance clock 1 day + 1ms
        clock::increment_for_testing(&mut c, 24 * 3600 * 1000 + 1);

        // Day 1: spend 80 again — should pass because counter reset
        ts::next_tx(&mut scenario, ORCH);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            agent_perms::record_spend(&mut perms, &config, ALICE, 80, &c, ts::ctx(&mut scenario));
            let p = agent_perms::get_permissions(&perms, ALICE);
            assert!(agent_perms::daily_spent_mist(&p) == 80, 400);
            ts::return_shared(perms);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_ORCHESTRATOR, location = azuka::agent_perms)]
    fun non_orchestrator_record_spend_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_alice(&mut scenario, &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut perms = ts::take_shared<AgentPermissionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            // ALICE (not ORCH) tries to record her own spend
            agent_perms::record_spend(&mut perms, &config, ALICE, 1, &c, ts::ctx(&mut scenario));
            ts::return_shared(perms);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }
}
