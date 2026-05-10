#[test_only]
module azuka::skills_tests {
    use std::string;
    use sui::clock;
    use sui::coin;
    use sui::sui::SUI;
    use sui::test_scenario as ts;

    use azuka::core::{Self, Config, AdminCap};
    use azuka::agents::{Self, AgentRegistry, AgentProfile};
    use azuka::skills::{Self, SkillCatalog, InstallRegistry};

    const ADMIN: address = @0xA11CE;
    const ALICE: address = @0xA01;
    const BOB: address = @0xB02;

    const E_NAME_LEN: u64 = 0;
    const E_NOT_AUTHOR: u64 = 5;
    const E_INSUFFICIENT_PAYMENT: u64 = 7;
    const E_ALREADY_INSTALLED: u64 = 8;
    const E_NOT_INSTALLED: u64 = 10;

    fun bootstrap(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let ctx = ts::ctx(scenario);
            core::init_for_testing(ctx);
            agents::init_for_testing(ctx);
            skills::init_for_testing(ctx);
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

    fun create_skill_as(scenario: &mut ts::Scenario, who: address, name: vector<u8>, price_mist: u64, c: &clock::Clock): u64 {
        ts::next_tx(scenario, who);
        let mut catalog = ts::take_shared<SkillCatalog>(scenario);
        let config = ts::take_shared<Config>(scenario);
        let profile = ts::take_from_sender<AgentProfile>(scenario);
        let id = skills::create_skill(
            &mut catalog, &config, &profile,
            string::utf8(name),
            string::utf8(b"description"),
            price_mist,
            string::utf8(b"trading"),
            vector[string::utf8(b"alpha"), string::utf8(b"BETA"), string::utf8(b"alpha")],
            string::utf8(b""),
            c, ts::ctx(scenario),
        );
        ts::return_shared(catalog);
        ts::return_shared(config);
        ts::return_to_sender(scenario, profile);
        id
    }

    #[test]
    fun create_skill_happy_path_with_tag_dedup_and_lowercase() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        let id = create_skill_as(&mut scenario, ALICE, b"Trader", 1_000_000, &c);
        assert!(id == 0, 100);

        ts::next_tx(&mut scenario, ALICE);
        {
            let catalog = ts::take_shared<SkillCatalog>(&scenario);
            let s = skills::borrow_skill(&catalog, 0);
            assert!(skills::skill_id(s) == 0, 101);
            assert!(skills::skill_author(s) == ALICE, 102);
            assert!(skills::skill_price_mist(s) == 1_000_000, 103);
            assert!(skills::skill_install_count(s) == 0, 104);
            assert!(!skills::skill_verified(s), 105);
            // Tags: alpha + BETA -> lowercased + deduped to [alpha, beta]
            let tags = skills::skill_tags(s);
            assert!(tags.length() == 2, 106);
            assert!(*tags.borrow(0) == string::utf8(b"alpha"), 107);
            assert!(*tags.borrow(1) == string::utf8(b"beta"), 108);
            assert!(skills::next_skill_id(&catalog) == 1, 109);
            ts::return_shared(catalog);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NAME_LEN, location = azuka::skills)]
    fun create_skill_empty_name_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            skills::create_skill(
                &mut catalog, &config, &profile,
                string::utf8(b"   "),
                string::utf8(b""),
                0,
                string::utf8(b""),
                vector[],
                string::utf8(b""),
                &c, ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun set_skill_verified_admin_only() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        create_skill_as(&mut scenario, ALICE, b"Trader", 0, &c);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            skills::set_skill_verified(&mut catalog, &config, &cap, 0, true, ts::ctx(&mut scenario));
            let s = skills::borrow_skill(&catalog, 0);
            assert!(skills::skill_verified(s), 200);
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun update_metadata_preserves_verified() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        create_skill_as(&mut scenario, ALICE, b"Trader", 0, &c);

        // Admin verifies
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            skills::set_skill_verified(&mut catalog, &config, &cap, 0, true, ts::ctx(&mut scenario));
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        // Author updates metadata — verified flag should NOT flip
        ts::next_tx(&mut scenario, ALICE);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            skills::update_skill_metadata(
                &mut catalog,
                0,
                string::utf8(b"defi"),
                vector[string::utf8(b"yield")],
                string::utf8(b"https://img.example/x.png"),
                ts::ctx(&mut scenario),
            );
            let s = skills::borrow_skill(&catalog, 0);
            assert!(skills::skill_category(s) == string::utf8(b"defi"), 300);
            assert!(skills::skill_verified(s), 301); // sticky
            ts::return_shared(catalog);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_AUTHOR, location = azuka::skills)]
    fun update_metadata_non_author_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_primary(&mut scenario, BOB, b"bob", &c);
        create_skill_as(&mut scenario, ALICE, b"Trader", 0, &c);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            skills::update_skill_metadata(
                &mut catalog,
                0,
                string::utf8(b"defi"),
                vector[],
                string::utf8(b""),
                ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun install_paid_skill_splits_85_15() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_primary(&mut scenario, BOB, b"bob", &c);
        create_skill_as(&mut scenario, ALICE, b"Trader", 1_000, &c);

        // Bob installs Alice's paid skill
        ts::next_tx(&mut scenario, BOB);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let mut installs = ts::take_shared<InstallRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            // Bob attaches exact price
            let coin_arg = coin::mint_for_testing<SUI>(1_000, ts::ctx(&mut scenario));
            skills::install_skill(&mut catalog, &mut installs, &config, &profile, 0, coin_arg, ts::ctx(&mut scenario));
            ts::return_shared(catalog);
            ts::return_shared(installs);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        // Alice should have received 850 (85%); Admin should have received 150 (15%)
        ts::next_tx(&mut scenario, ALICE);
        {
            let author_coin = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&author_coin) == 850, 400);
            ts::return_to_sender(&scenario, author_coin);
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let platform_coin = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&platform_coin) == 150, 401);
            ts::return_to_sender(&scenario, platform_coin);
        };

        // Skill install_count bumped, Bob's installed list contains skill 0
        ts::next_tx(&mut scenario, BOB);
        {
            let catalog = ts::take_shared<SkillCatalog>(&scenario);
            let installs = ts::take_shared<InstallRegistry>(&scenario);
            let s = skills::borrow_skill(&catalog, 0);
            assert!(skills::skill_install_count(s) == 1, 402);
            assert!(skills::is_installed(&installs, BOB, 0), 403);
            assert!(skills::installed_count(&installs, BOB) == 1, 404);
            ts::return_shared(catalog);
            ts::return_shared(installs);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun install_overpay_refunds_remainder() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_primary(&mut scenario, BOB, b"bob", &c);
        create_skill_as(&mut scenario, ALICE, b"Trader", 1_000, &c);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let mut installs = ts::take_shared<InstallRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            // Overpay by 500
            let coin_arg = coin::mint_for_testing<SUI>(1_500, ts::ctx(&mut scenario));
            skills::install_skill(&mut catalog, &mut installs, &config, &profile, 0, coin_arg, ts::ctx(&mut scenario));
            ts::return_shared(catalog);
            ts::return_shared(installs);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == 500, 500);
            ts::return_to_sender(&scenario, refund);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_INSUFFICIENT_PAYMENT, location = azuka::skills)]
    fun install_underpay_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_primary(&mut scenario, BOB, b"bob", &c);
        create_skill_as(&mut scenario, ALICE, b"Trader", 1_000, &c);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let mut installs = ts::take_shared<InstallRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            let coin_arg = coin::mint_for_testing<SUI>(500, ts::ctx(&mut scenario));
            skills::install_skill(&mut catalog, &mut installs, &config, &profile, 0, coin_arg, ts::ctx(&mut scenario));
            ts::return_shared(catalog);
            ts::return_shared(installs);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun install_free_skill_with_zero_coin() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_primary(&mut scenario, BOB, b"bob", &c);
        create_skill_as(&mut scenario, ALICE, b"Free", 0, &c);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let mut installs = ts::take_shared<InstallRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            let zero_coin = coin::zero<SUI>(ts::ctx(&mut scenario));
            skills::install_skill(&mut catalog, &mut installs, &config, &profile, 0, zero_coin, ts::ctx(&mut scenario));
            assert!(skills::is_installed(&installs, BOB, 0), 600);
            ts::return_shared(catalog);
            ts::return_shared(installs);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_ALREADY_INSTALLED, location = azuka::skills)]
    fun install_twice_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_primary(&mut scenario, BOB, b"bob", &c);
        create_skill_as(&mut scenario, ALICE, b"Free", 0, &c);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let mut installs = ts::take_shared<InstallRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            let z1 = coin::zero<SUI>(ts::ctx(&mut scenario));
            skills::install_skill(&mut catalog, &mut installs, &config, &profile, 0, z1, ts::ctx(&mut scenario));
            let z2 = coin::zero<SUI>(ts::ctx(&mut scenario));
            skills::install_skill(&mut catalog, &mut installs, &config, &profile, 0, z2, ts::ctx(&mut scenario));
            ts::return_shared(catalog);
            ts::return_shared(installs);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun uninstall_skill_decrements() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);
        register_primary(&mut scenario, BOB, b"bob", &c);
        create_skill_as(&mut scenario, ALICE, b"Free", 0, &c);

        ts::next_tx(&mut scenario, BOB);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let mut installs = ts::take_shared<InstallRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let profile = ts::take_from_sender<AgentProfile>(&scenario);
            let z = coin::zero<SUI>(ts::ctx(&mut scenario));
            skills::install_skill(&mut catalog, &mut installs, &config, &profile, 0, z, ts::ctx(&mut scenario));
            ts::return_shared(catalog);
            ts::return_shared(installs);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, profile);
        };

        ts::next_tx(&mut scenario, BOB);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let mut installs = ts::take_shared<InstallRegistry>(&scenario);
            skills::uninstall_skill(&mut catalog, &mut installs, 0, ts::ctx(&mut scenario));
            assert!(!skills::is_installed(&installs, BOB, 0), 700);
            let s = skills::borrow_skill(&catalog, 0);
            assert!(skills::skill_install_count(s) == 0, 701);
            ts::return_shared(catalog);
            ts::return_shared(installs);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_INSTALLED, location = azuka::skills)]
    fun uninstall_unknown_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        register_primary(&mut scenario, ALICE, b"alice", &c);

        ts::next_tx(&mut scenario, ALICE);
        {
            let mut catalog = ts::take_shared<SkillCatalog>(&scenario);
            let mut installs = ts::take_shared<InstallRegistry>(&scenario);
            skills::uninstall_skill(&mut catalog, &mut installs, 999, ts::ctx(&mut scenario));
            ts::return_shared(catalog);
            ts::return_shared(installs);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }
}
