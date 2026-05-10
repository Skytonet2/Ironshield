#[test_only]
module azuka::agent_connections_tests {
    use std::string;
    use sui::clock;
    use sui::test_scenario as ts;

    use azuka::core::{Self, Config, AdminCap};
    use azuka::agents::{Self, AgentRegistry, AgentProfile};
    use azuka::sub_agents::{Self, SubAgent};
    use azuka::agent_connections::{Self, AgentConnectionsRegistry};

    const ADMIN: address = @0xA11CE;
    const ALICE: address = @0xA01;
    const BOB: address = @0xB02;
    const ORCH: address = @0x0CC;

    const E_FRAMEWORK_LEN: u64 = 0;
    const E_LIMIT_REACHED: u64 = 4;
    const E_NOT_OWNER: u64 = 5;
    const E_NOT_ORCHESTRATOR: u64 = 6;
    const E_CONNECTION_NOT_FOUND: u64 = 7;
    const E_NO_CONNECTIONS: u64 = 8;

    fun bootstrap(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let ctx = ts::ctx(scenario);
            core::init_for_testing(ctx);
            agents::init_for_testing(ctx);
            agent_connections::init_for_testing(ctx);
        };
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

    fun register_primary(scenario: &mut ts::Scenario, who: address, handle: vector<u8>, c: &clock::Clock) {
        ts::next_tx(scenario, who);
        let mut registry = ts::take_shared<AgentRegistry>(scenario);
        let config = ts::take_shared<Config>(scenario);
        agents::register_agent(
            &mut registry, &config,
            string::utf8(handle), string::utf8(b""),
            c, ts::ctx(scenario),
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
            &mut registry, &config, &primary,
            string::utf8(handle), string::utf8(b""),
            c, ts::ctx(scenario),
        );
        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_to_sender(scenario, primary);
    }

    #[test]
    fun set_connection_for_profile_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"),
                string::utf8(b"ext-1"),
                string::utf8(b"https://x.example/agent"),
                string::utf8(b"{}"),
                &c,
                ts::ctx(&mut scenario),
            );

            let id = sui::object::id(&profile);
            assert!(agent_connections::has_connection(&conns, id, string::utf8(b"openclaw")), 100);
            assert!(agent_connections::connection_count(&conns, id) == 1, 101);
            assert!(agent_connections::connection_endpoint(&conns, id, string::utf8(b"openclaw"))
                == string::utf8(b"https://x.example/agent"), 102);

            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun set_connection_idempotent_on_framework() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);

            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"),
                string::utf8(b"ext-1"),
                string::utf8(b"https://old.example"),
                string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            // Re-set same framework — overwrites endpoint, doesn't add row
            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"),
                string::utf8(b"ext-2"),
                string::utf8(b"https://new.example"),
                string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );

            let id = sui::object::id(&profile);
            assert!(agent_connections::connection_count(&conns, id) == 1, 200);
            assert!(agent_connections::connection_endpoint(&conns, id, string::utf8(b"openclaw"))
                == string::utf8(b"https://new.example"), 201);

            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_LIMIT_REACHED, location = azuka::agent_connections)]
    fun connection_cap_enforced() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);

            // Add 8 (the cap)
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw01"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw02"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw03"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw04"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw05"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw06"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw07"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw08"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));
            // 9th should abort
            agent_connections::set_connection_for_profile(&mut conns, &config, &profile, string::utf8(b"fw09"), string::utf8(b""), string::utf8(b""), string::utf8(b""), &c, ts::ctx(&mut scenario));

            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_FRAMEWORK_LEN, location = azuka::agent_connections)]
    fun empty_framework_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"   "), // whitespace only -> trim -> empty
                string::utf8(b""), string::utf8(b""), string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun mark_seen_orchestrator() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let mut c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        // Alice sets a connection
        ts::next_tx(&mut scenario, ALICE);
        let profile_id;
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            profile_id = sui::object::id(&profile);
            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"), string::utf8(b""), string::utf8(b""), string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::increment_for_testing(&mut c, 5_000);

        // Orchestrator marks seen
        ts::next_tx(&mut scenario, ORCH);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            agent_connections::mark_seen(&mut conns, &config, profile_id, string::utf8(b"openclaw"), &c, ts::ctx(&mut scenario));
            assert!(
                agent_connections::connection_last_seen_ms(&conns, profile_id, string::utf8(b"openclaw")) == 5_000,
                300,
            );
            ts::return_shared(conns);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_ORCHESTRATOR, location = azuka::agent_connections)]
    fun non_orchestrator_mark_seen_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        let profile_id;
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            profile_id = sui::object::id(&profile);
            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"), string::utf8(b""), string::utf8(b""), string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            // Alice tries to mark her own connection seen
            agent_connections::mark_seen(&mut conns, &config, profile_id, string::utf8(b"openclaw"), &c, ts::ctx(&mut scenario));
            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun remove_connection_clears_and_re_adds() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            let id = sui::object::id(&profile);

            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"), string::utf8(b""), string::utf8(b""), string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            agent_connections::remove_connection_for_profile(
                &mut conns, &profile, string::utf8(b"openclaw"), ts::ctx(&mut scenario),
            );
            assert!(agent_connections::connection_count(&conns, id) == 0, 400);

            // Re-add works after clear
            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"), string::utf8(b""), string::utf8(b""), string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            assert!(agent_connections::connection_count(&conns, id) == 1, 401);

            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_CONNECTION_NOT_FOUND, location = azuka::agent_connections)]
    fun remove_unknown_framework_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"), string::utf8(b""), string::utf8(b""), string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            agent_connections::remove_connection_for_profile(
                &mut conns, &profile, string::utf8(b"missing"), ts::ctx(&mut scenario),
            );
            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun set_connection_for_sub_agent() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_sub(&mut scenario, ALICE, b"alice2", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let sub = ts::take_from_sender<SubAgent>(&scenario);
            let id = sui::object::id(&sub);
            agent_connections::set_connection_for_sub(
                &mut conns, &config, &sub,
                string::utf8(b"ironclaw"), string::utf8(b""), string::utf8(b""), string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            assert!(agent_connections::connection_count(&conns, id) == 1, 500);
            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, sub);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NO_CONNECTIONS, location = azuka::agent_connections)]
    fun mark_seen_unknown_agent_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        let profile_id;
        {
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            profile_id = sui::object::id(&profile);
            ts::return_to_sender(&scenario, profile);
        };

        ts::next_tx(&mut scenario, ORCH);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            // Alice never set a connection — mark_seen aborts
            agent_connections::mark_seen(&mut conns, &config, profile_id, string::utf8(b"openclaw"), &c, ts::ctx(&mut scenario));
            ts::return_shared(conns);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_OWNER, location = azuka::agent_connections)]
    fun non_owner_set_connection_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        // Bob takes Alice's profile (would never happen via Sui transfer rules,
        // but we simulate via test_scenario ID-based access). For the assertion
        // path: Bob registers his own profile, then tries to set on Alice's
        // ID via Bob's sender context but using Bob's profile reference is
        // owned by Bob — Sui object resolution would block taking Alice's.
        // Instead test the explicit sender check: Bob registers, then a
        // hypothetical Alice-profile reference would not be Bob's, so we
        // simulate by Bob registering with his own profile and trying to
        // address it as if he owned a different one.
        register_primary(&mut scenario, BOB, b"bob", &c);

        // Bob sets a connection, but profile.owner != sender? In practice
        // Sui blocks this at the runtime layer (Bob can't take_from_sender
        // Alice's profile). The E_NOT_OWNER assertion is a defensive guard.
        // To exercise it cleanly, we need a profile where owner mismatches
        // sender. Achievable by transferring profiles between addresses,
        // but AgentProfile only has `key` (no `store`), so transfer::transfer
        // cross-module isn't allowed here.
        //
        // Skip the explicit failure-path test via ID forgery — the type
        // system enforcement is sufficient. Force an abort to satisfy the
        // expected_failure attribute by using a known-bad input on Bob's
        // own profile through a non-owning-but-typed call.
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut conns = ts::take_shared<AgentConnectionsRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            // ALICE takes BOB's profile? Only possible if BOB transferred it,
            // which they didn't. ts::take_from_address would let us, but that
            // bypasses Sui's resolution rules and tests our defense-in-depth.
            let profile = ts::take_from_address<AgentProfile>(&scenario, BOB);
            agent_connections::set_connection_for_profile(
                &mut conns, &config, &profile,
                string::utf8(b"openclaw"), string::utf8(b""), string::utf8(b""), string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            ts::return_shared(conns);
            ts::return_shared(config);
            ts::return_to_address(BOB, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }
}
