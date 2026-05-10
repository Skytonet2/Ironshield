#[test_only]
module azuka::sub_agents_tests {
    use std::string;
    use sui::clock;
    use sui::test_scenario as ts;

    use azuka::core::{Self, Config};
    use azuka::agents::{Self, AgentRegistry, AgentProfile};
    use azuka::sub_agents::{Self, SubAgent};

    const ADMIN: address = @0xA11CE;
    const ALICE: address = @0xA01;
    const BOB: address = @0xB02;

    const E_HANDLE_TAKEN: u64 = 2;
    const E_BIO_LEN: u64 = 3;
    const E_LIMIT_REACHED: u64 = 5;

    fun bootstrap(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let ctx = ts::ctx(scenario);
            core::init_for_testing(ctx);
            agents::init_for_testing(ctx);
        };
    }

    fun new_clock(scenario: &mut ts::Scenario): clock::Clock {
        ts::next_tx(scenario, ADMIN);
        clock::create_for_testing(ts::ctx(scenario))
    }

    fun register_primary(scenario: &mut ts::Scenario, who: address, handle: vector<u8>, c: &clock::Clock) {
        ts::next_tx(scenario, who);
        let mut registry = ts::take_shared<AgentRegistry>(scenario);
        let config = ts::take_shared<Config>(scenario);
        agents::register_agent(
            &mut registry,
            &config,
            string::utf8(handle),
            string::utf8(b""),
            c,
            ts::ctx(scenario),
        );
        ts::return_shared(registry);
        ts::return_shared(config);
    }

    fun register_sub(scenario: &mut ts::Scenario, who: address, handle: vector<u8>, c: &clock::Clock) {
        ts::next_tx(scenario, who);
        let mut registry = ts::take_shared<AgentRegistry>(scenario);
        let config = ts::take_shared<Config>(scenario);
        let primary = ts::take_from_sender<AgentProfile>(scenario);
        sub_agents::register_sub_agent(
            &mut registry,
            &config,
            &primary,
            string::utf8(handle),
            string::utf8(b""),
            c,
            ts::ctx(scenario),
        );
        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_to_sender(scenario, primary);
    }

    #[test]
    fun register_sub_agent_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_sub(&mut scenario, ALICE, b"alice2", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let registry = ts::take_shared<AgentRegistry>(&scenario);
            let sub = ts::take_from_sender<SubAgent>(&scenario);
            assert!(sub_agents::sub_owner(&sub) == ALICE, 100);
            assert!(sub_agents::sub_handle(&sub) == string::utf8(b"alice2"), 101);
            assert!(sub_agents::sub_agent_count(&registry, ALICE) == 1, 102);
            // Handle reserved (case-insensitive)
            assert!(!agents::is_handle_available(&registry, string::utf8(b"ALICE2")), 103);
            ts::return_to_sender(&scenario, sub);
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_HANDLE_TAKEN, location = azuka::sub_agents)]
    fun sub_agent_handle_collides_with_primary() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_primary(&mut scenario, BOB, b"bob", &c);
        // Alice tries to register a sub-agent with Bob's primary handle
        register_sub(&mut scenario, ALICE, b"BOB", &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun remove_sub_agent_frees_handle_and_decrements() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_sub(&mut scenario, ALICE, b"alice2", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut registry = ts::take_shared<AgentRegistry>(&scenario);
            let sub = ts::take_from_sender<SubAgent>(&scenario);
            sub_agents::remove_sub_agent(&mut registry, sub, ts::ctx(&mut scenario));
            assert!(sub_agents::sub_agent_count(&registry, ALICE) == 0, 200);
            assert!(agents::is_handle_available(&registry, string::utf8(b"alice2")), 201);
            ts::return_shared(registry);
        };

        // Re-register the freed handle
        register_sub(&mut scenario, ALICE, b"alice2", &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_LIMIT_REACHED, location = azuka::sub_agents)]
    fun sub_agent_limit_enforced() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register_primary(&mut scenario, ALICE, b"alice", &c);

        // Register 10 sub-agents (the cap)
        register_sub(&mut scenario, ALICE, b"sub01", &c);
        register_sub(&mut scenario, ALICE, b"sub02", &c);
        register_sub(&mut scenario, ALICE, b"sub03", &c);
        register_sub(&mut scenario, ALICE, b"sub04", &c);
        register_sub(&mut scenario, ALICE, b"sub05", &c);
        register_sub(&mut scenario, ALICE, b"sub06", &c);
        register_sub(&mut scenario, ALICE, b"sub07", &c);
        register_sub(&mut scenario, ALICE, b"sub08", &c);
        register_sub(&mut scenario, ALICE, b"sub09", &c);
        register_sub(&mut scenario, ALICE, b"sub10", &c);

        // 11th should abort
        register_sub(&mut scenario, ALICE, b"sub11", &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun update_sub_agent_bio() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_sub(&mut scenario, ALICE, b"alice2", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut sub = ts::take_from_sender<SubAgent>(&scenario);
            sub_agents::update_bio(&mut sub, string::utf8(b"updated"), ts::ctx(&mut scenario));
            assert!(sub_agents::sub_bio(&sub) == string::utf8(b"updated"), 300);
            ts::return_to_sender(&scenario, sub);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_BIO_LEN, location = azuka::sub_agents)]
    fun update_sub_agent_bio_too_long_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_sub(&mut scenario, ALICE, b"alice2", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut sub = ts::take_from_sender<SubAgent>(&scenario);
            let mut long = vector::empty<u8>();
            let mut i = 0;
            while (i < 281) { long.push_back(0x61); i = i + 1; };
            sub_agents::update_bio(&mut sub, string::utf8(long), ts::ctx(&mut scenario));
            ts::return_to_sender(&scenario, sub);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }
}
