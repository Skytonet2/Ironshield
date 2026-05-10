#[test_only]
module azuka::kits_tests {
    use std::string;
    use sui::clock;
    use sui::test_scenario as ts;

    use azuka::core::{Self, Config, AdminCap};
    use azuka::kits::{Self, KitCatalog, Kit};

    const ADMIN: address = @0xA11CE;
    const CURATOR: address = @0xCAFE;

    // Abort codes mirror the private constants in azuka::kits and azuka::core.
    // Kept as raw numbers because Move constants are module-private by default.
    const E_BPS_SUM: u64 = 5;
    const E_SLUG_TAKEN: u64 = 6;
    const E_INVALID_STATUS: u64 = 7;
    const E_KIT_NOT_FOUND: u64 = 8;
    const E_PAUSED: u64 = 2;

    fun bootstrap(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let ctx = ts::ctx(scenario);
            core::init_for_testing(ctx);
            kits::init_for_testing(ctx);
        };
    }

    fun new_clock(scenario: &mut ts::Scenario): clock::Clock {
        ts::next_tx(scenario, ADMIN);
        clock::create_for_testing(ts::ctx(scenario))
    }

    fun register_baseline_kit(scenario: &mut ts::Scenario, c: &clock::Clock) {
        let mut catalog = ts::take_shared<KitCatalog>(scenario);
        let config = ts::take_shared<Config>(scenario);
        let cap = ts::take_from_sender<AdminCap>(scenario);
        kits::register_kit(
            &mut catalog,
            &config,
            &cap,
            string::utf8(b"realtor"),
            string::utf8(b"Realtor scout"),
            string::utf8(b"real-estate"),
            CURATOR,
            string::utf8(b"sha256:abc"),
            8000,
            1000,
            1000,
            string::utf8(kits::status_beta()),
            c,
            ts::ctx(scenario),
        );
        ts::return_shared(catalog);
        ts::return_shared(config);
        ts::return_to_sender(scenario, cap);
    }

    #[test]
    fun register_kit_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        register_baseline_kit(&mut scenario, &c);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let catalog = ts::take_shared<KitCatalog>(&scenario);
            assert!(kits::has_kit(&catalog, string::utf8(b"realtor")), 100);
            let kit: &Kit = kits::borrow_kit(&catalog, string::utf8(b"realtor"));
            assert!(kits::kit_curator(kit) == CURATOR, 101);
            let (a, b, p) = kits::kit_revenue_bps(kit);
            assert!(a == 8000 && b == 1000 && p == 1000, 102);
            assert!(kits::kit_status(kit) == string::utf8(b"beta"), 103);
            ts::return_shared(catalog);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_SLUG_TAKEN, location = azuka::kits)]
    fun register_kit_duplicate_slug_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        register_baseline_kit(&mut scenario, &c);

        ts::next_tx(&mut scenario, ADMIN);
        register_baseline_kit(&mut scenario, &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_BPS_SUM, location = azuka::kits)]
    fun register_kit_bad_split_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<KitCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            kits::register_kit(
                &mut catalog,
                &config,
                &cap,
                string::utf8(b"bad-bps"),
                string::utf8(b"Bad BPS"),
                string::utf8(b"misc"),
                CURATOR,
                string::utf8(b"sha256:x"),
                7000,
                1000,
                1000,
                string::utf8(kits::status_beta()),
                &c,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };
        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_INVALID_STATUS, location = azuka::kits)]
    fun register_kit_invalid_status_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<KitCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            kits::register_kit(
                &mut catalog,
                &config,
                &cap,
                string::utf8(b"weird"),
                string::utf8(b"Weird"),
                string::utf8(b"misc"),
                CURATOR,
                string::utf8(b"sha256:x"),
                8000,
                1000,
                1000,
                string::utf8(b"draft"),
                &c,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };
        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun update_kit_manifest_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let mut c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        register_baseline_kit(&mut scenario, &c);

        clock::increment_for_testing(&mut c, 1_000);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<KitCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            kits::update_kit_manifest(
                &mut catalog,
                &config,
                &cap,
                string::utf8(b"realtor"),
                string::utf8(b"sha256:def"),
                &c,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        ts::next_tx(&mut scenario, ADMIN);
        {
            let catalog = ts::take_shared<KitCatalog>(&scenario);
            let kit: &Kit = kits::borrow_kit(&catalog, string::utf8(b"realtor"));
            assert!(kits::kit_manifest_hash(kit) == string::utf8(b"sha256:def"), 200);
            assert!(kits::kit_updated_at_ms(kit) == 1_000, 201);
            ts::return_shared(catalog);
        };
        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_KIT_NOT_FOUND, location = azuka::kits)]
    fun update_kit_manifest_not_found_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<KitCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            kits::update_kit_manifest(
                &mut catalog,
                &config,
                &cap,
                string::utf8(b"ghost"),
                string::utf8(b"sha256:x"),
                &c,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };
        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun set_kit_status_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        register_baseline_kit(&mut scenario, &c);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<KitCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            kits::set_kit_status(
                &mut catalog,
                &config,
                &cap,
                string::utf8(b"realtor"),
                string::utf8(kits::status_active()),
                &c,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        ts::next_tx(&mut scenario, ADMIN);
        {
            let catalog = ts::take_shared<KitCatalog>(&scenario);
            let kit: &Kit = kits::borrow_kit(&catalog, string::utf8(b"realtor"));
            assert!(kits::kit_status(kit) == string::utf8(b"active"), 300);
            ts::return_shared(catalog);
        };
        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun update_revenue_split_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        register_baseline_kit(&mut scenario, &c);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<KitCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            kits::update_kit_revenue_split(
                &mut catalog,
                &config,
                &cap,
                string::utf8(b"realtor"),
                7000,
                2000,
                1000,
                &c,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        ts::next_tx(&mut scenario, ADMIN);
        {
            let catalog = ts::take_shared<KitCatalog>(&scenario);
            let kit: &Kit = kits::borrow_kit(&catalog, string::utf8(b"realtor"));
            let (a, b, p) = kits::kit_revenue_bps(kit);
            assert!(a == 7000 && b == 2000 && p == 1000, 400);
            ts::return_shared(catalog);
        };
        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_BPS_SUM, location = azuka::kits)]
    fun update_revenue_split_bad_sum_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        register_baseline_kit(&mut scenario, &c);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut catalog = ts::take_shared<KitCatalog>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            kits::update_kit_revenue_split(
                &mut catalog,
                &config,
                &cap,
                string::utf8(b"realtor"),
                5000,
                2000,
                1000,
                &c,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(catalog);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
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

        ts::next_tx(&mut scenario, ADMIN);
        register_baseline_kit(&mut scenario, &c);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }
}
