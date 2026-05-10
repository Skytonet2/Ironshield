#[test_only]
module azuka::agents_tests {
    use std::string;
    use sui::clock;
    use sui::test_scenario as ts;

    use azuka::core::{Self, Config, AdminCap};
    use azuka::agents::{Self, AgentRegistry, AgentProfile};

    const ADMIN: address = @0xA11CE;
    const ALICE: address = @0xA01;
    const BOB: address = @0xB02;

    // Mirror of private constants in azuka::agents and azuka::core.
    const E_HANDLE_LEN: u64 = 0;
    const E_HANDLE_CHARS: u64 = 1;
    const E_HANDLE_TAKEN: u64 = 2;
    const E_BIO_LEN: u64 = 3;
    const E_NOT_OWNER: u64 = 4;
    const E_PAUSED: u64 = 2;

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

    fun register(scenario: &mut ts::Scenario, who: address, handle: vector<u8>, bio: vector<u8>, c: &clock::Clock) {
        ts::next_tx(scenario, who);
        let mut registry = ts::take_shared<AgentRegistry>(scenario);
        let config = ts::take_shared<Config>(scenario);
        agents::register_agent(
            &mut registry,
            &config,
            string::utf8(handle),
            string::utf8(bio),
            c,
            ts::ctx(scenario),
        );
        ts::return_shared(registry);
        ts::return_shared(config);
    }

    #[test]
    fun register_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register(&mut scenario, ALICE, b"AliceX", b"hello world", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            assert!(agents::profile_owner(&profile) == ALICE, 100);
            assert!(agents::profile_handle(&profile) == string::utf8(b"AliceX"), 101);
            assert!(agents::profile_bio(&profile) == string::utf8(b"hello world"), 102);
            assert!(!agents::profile_public_listed(&profile), 103);
            assert!(!agents::profile_subscribed(&profile), 104);
            ts::return_to_sender(&scenario, profile);
        };

        // Registry knows the (lowercase) handle is taken
        ts::next_tx(&mut scenario, ALICE);
        {
            let registry = ts::take_shared<AgentRegistry>(&scenario);
            assert!(!agents::is_handle_available(&registry, string::utf8(b"alicex")), 105);
            assert!(!agents::is_handle_available(&registry, string::utf8(b"ALICEX")), 106);
            assert!(agents::resolve_handle(&registry, string::utf8(b"AliceX")) == ALICE, 107);
            assert!(agents::handle_owner_or_zero(&registry, string::utf8(b"unknown")) == @0x0, 108);
            ts::return_shared(registry);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_HANDLE_TAKEN, location = azuka::agents)]
    fun register_duplicate_handle_case_insensitive_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register(&mut scenario, ALICE, b"Alice", b"hi", &c);
        // Bob tries the same handle in different case
        register(&mut scenario, BOB, b"ALICE", b"hi", &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_HANDLE_LEN, location = azuka::agents)]
    fun register_handle_too_short_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register(&mut scenario, ALICE, b"ab", b"hi", &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_HANDLE_LEN, location = azuka::agents)]
    fun register_handle_too_long_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        // 33 chars (max is 32)
        register(&mut scenario, ALICE, b"abcdefghijklmnopqrstuvwxyz0123456", b"hi", &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_HANDLE_CHARS, location = azuka::agents)]
    fun register_handle_bad_chars_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register(&mut scenario, ALICE, b"alice!", b"hi", &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun register_handle_allows_underscore_and_dash() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register(&mut scenario, ALICE, b"al-ice_42", b"", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            assert!(agents::profile_handle(&profile) == string::utf8(b"al-ice_42"), 200);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_BIO_LEN, location = azuka::agents)]
    fun register_bio_too_long_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        // 281 ASCII chars
        let mut long_bio = vector::empty<u8>();
        let mut i = 0;
        while (i < 281) { long_bio.push_back(0x61); i = i + 1; };

        register(&mut scenario, ALICE, b"alice", long_bio, &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun update_bio_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register(&mut scenario, ALICE, b"alice", b"first", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut profile = ts::take_from_sender<AgentProfile>(&scenario);
            agents::update_bio(&mut profile, string::utf8(b"second"), ts::ctx(&mut scenario));
            assert!(agents::profile_bio(&profile) == string::utf8(b"second"), 300);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun set_public_and_subscription() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        register(&mut scenario, ALICE, b"alice", b"", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut profile = ts::take_from_sender<AgentProfile>(&scenario);
            agents::set_public(&mut profile, true, ts::ctx(&mut scenario));
            agents::set_subscription(&mut profile, true, ts::ctx(&mut scenario));
            assert!(agents::profile_public_listed(&profile), 400);
            assert!(agents::profile_subscribed(&profile), 401);
            agents::set_public(&mut profile, false, ts::ctx(&mut scenario));
            assert!(!agents::profile_public_listed(&profile), 402);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_PAUSED, location = azuka::core)]
    fun paused_blocks_register() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            core::set_paused(&mut config, &cap, true, ts::ctx(&mut scenario));
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        register(&mut scenario, ALICE, b"alice", b"", &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }
}
