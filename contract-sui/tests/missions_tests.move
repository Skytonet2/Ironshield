#[test_only]
module azuka::missions_tests {
    use std::option;
    use std::string;
    use sui::clock;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_scenario as ts;

    use azuka::core::{Self, Config, AdminCap};
    use azuka::missions::{Self, MissionRegistry, Mission};

    const ADMIN: address = @0xA11CE;
    const POSTER: address = @0xB05;
    const CLAIMANT: address = @0xC11;
    const RANDO: address = @0xD12;

    const E_TEMPLATE_REQUIRED: u64 = 2;
    const E_INPUTS_REQUIRED: u64 = 3;
    const E_FEE_TOO_HIGH: u64 = 5;
    const E_NOT_OPEN: u64 = 6;
    const E_NOT_SUBMITTED: u64 = 8;
    const E_POSTER_CANNOT_CLAIM: u64 = 9;
    const E_NOT_POSTER: u64 = 10;
    const E_NOT_CLAIMANT: u64 = 11;
    const E_DEADLINE_NOT_PASSED: u64 = 12;
    const E_ESCROW_REQUIRED: u64 = 1;

    fun bootstrap(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let ctx = ts::ctx(scenario);
            core::init_for_testing(ctx);
            missions::init_for_testing(ctx);
        };
    }

    fun new_clock(scenario: &mut ts::Scenario): clock::Clock {
        ts::next_tx(scenario, ADMIN);
        clock::create_for_testing(ts::ctx(scenario))
    }

    fun create_mission_as(
        scenario: &mut ts::Scenario,
        poster: address,
        escrow_mist: u64,
        review_window_secs: option::Option<u64>,
        c: &clock::Clock,
    ): u64 {
        ts::next_tx(scenario, poster);
        let mut registry = ts::take_shared<MissionRegistry>(scenario);
        let config = ts::take_shared<Config>(scenario);
        let payment = coin::mint_for_testing<SUI>(escrow_mist, ts::ctx(scenario));
        let id = missions::create_mission(
            &mut registry,
            &config,
            string::utf8(b"template-x"),
            option::some(string::utf8(b"realtor")),
            string::utf8(b"sha256:inputs"),
            review_window_secs,
            payment,
            c,
            ts::ctx(scenario),
        );
        ts::return_shared(registry);
        ts::return_shared(config);
        id
    }

    #[test]
    fun create_mission_happy_locks_escrow_and_increments_id() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        let id0 = create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);
        assert!(id0 == 0, 100);

        ts::next_tx(&mut scenario, POSTER);
        {
            let mission = ts::take_shared<Mission>(&scenario);
            assert!(missions::mission_id(&mission) == 0, 101);
            assert!(missions::poster(&mission) == POSTER, 102);
            assert!(missions::status(&mission) == missions::status_open(), 103);
            assert!(missions::escrow_mist(&mission) == 1_000, 104);
            assert!(missions::platform_fee_bps(&mission) == 500, 105);
            ts::return_shared(mission);
        };

        let id1 = create_mission_as(&mut scenario, POSTER, 2_000, option::none(), &c);
        assert!(id1 == 1, 106);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_ESCROW_REQUIRED, location = azuka::missions)]
    fun create_mission_zero_escrow_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, POSTER);
        let mut registry = ts::take_shared<MissionRegistry>(&scenario);
        let config = ts::take_shared<Config>(&scenario);
        let zero = coin::zero<SUI>(ts::ctx(&mut scenario));
        missions::create_mission(
            &mut registry, &config,
            string::utf8(b"t"), option::none(), string::utf8(b"i"),
            option::none(), zero, &c, ts::ctx(&mut scenario),
        );
        ts::return_shared(registry);
        ts::return_shared(config);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_TEMPLATE_REQUIRED, location = azuka::missions)]
    fun create_mission_empty_template_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, POSTER);
        let mut registry = ts::take_shared<MissionRegistry>(&scenario);
        let config = ts::take_shared<Config>(&scenario);
        let payment = coin::mint_for_testing<SUI>(100, ts::ctx(&mut scenario));
        missions::create_mission(
            &mut registry, &config,
            string::utf8(b""), option::none(), string::utf8(b"i"),
            option::none(), payment, &c, ts::ctx(&mut scenario),
        );
        ts::return_shared(registry);
        ts::return_shared(config);

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun claim_mission_happy_path() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);

        ts::next_tx(&mut scenario, CLAIMANT);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::claim_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            assert!(missions::status(&mission) == missions::status_claimed(), 200);
            assert!(option::contains(&missions::claimant(&mission), &CLAIMANT), 201);
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_POSTER_CANNOT_CLAIM, location = azuka::missions)]
    fun poster_cannot_claim_own_mission() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);

        ts::next_tx(&mut scenario, POSTER);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::claim_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun submit_mission_work_sets_review_deadline() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let mut c = new_clock(&mut scenario);
        // Use min review window for fast deadline math
        create_mission_as(&mut scenario, POSTER, 1_000, option::some(60 * 60), &c);

        ts::next_tx(&mut scenario, CLAIMANT);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::claim_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        clock::increment_for_testing(&mut c, 5_000);

        ts::next_tx(&mut scenario, CLAIMANT);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::submit_mission_work(
                &mut mission, &config,
                string::utf8(b"sha256:audit"),
                &c, ts::ctx(&mut scenario),
            );
            assert!(missions::status(&mission) == missions::status_submitted(), 300);
            // 5_000 ms now + (3600 * 1000) ms = 3_605_000
            let deadline = *option::borrow(&missions::review_deadline_ms(&mission));
            assert!(deadline == 3_605_000, 301);
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_CLAIMANT, location = azuka::missions)]
    fun submit_by_non_claimant_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);

        ts::next_tx(&mut scenario, CLAIMANT);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::claim_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        ts::next_tx(&mut scenario, RANDO);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::submit_mission_work(&mut mission, &config, string::utf8(b"x"), &c, ts::ctx(&mut scenario));
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    fun walk_through_submit(scenario: &mut ts::Scenario, c: &clock::Clock) {
        ts::next_tx(scenario, CLAIMANT);
        let mut mission = ts::take_shared<Mission>(scenario);
        let config = ts::take_shared<Config>(scenario);
        missions::claim_mission(&mut mission, &config, c, ts::ctx(scenario));
        ts::return_shared(mission);
        ts::return_shared(config);

        ts::next_tx(scenario, CLAIMANT);
        let mut mission = ts::take_shared<Mission>(scenario);
        let config = ts::take_shared<Config>(scenario);
        missions::submit_mission_work(&mut mission, &config, string::utf8(b"sha256:audit"), c, ts::ctx(scenario));
        ts::return_shared(mission);
        ts::return_shared(config);
    }

    #[test]
    fun approve_mission_pays_95_5_split() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);
        walk_through_submit(&mut scenario, &c);

        ts::next_tx(&mut scenario, POSTER);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::approve_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            assert!(missions::status(&mission) == missions::status_approved(), 400);
            assert!(missions::escrow_mist(&mission) == 0, 401);
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        // Claimant should have 950, admin 50
        ts::next_tx(&mut scenario, CLAIMANT);
        {
            let payout = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&payout) == 950, 402);
            ts::return_to_sender(&scenario, payout);
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let cut = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&cut) == 50, 403);
            ts::return_to_sender(&scenario, cut);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_POSTER, location = azuka::missions)]
    fun approve_by_non_poster_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);
        walk_through_submit(&mut scenario, &c);

        ts::next_tx(&mut scenario, RANDO);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::approve_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun reject_refunds_full_escrow_to_poster() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);
        walk_through_submit(&mut scenario, &c);

        ts::next_tx(&mut scenario, POSTER);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            missions::reject_mission(&mut mission, string::utf8(b"bad work"), &c, ts::ctx(&mut scenario));
            assert!(missions::status(&mission) == missions::status_rejected(), 500);
            assert!(missions::escrow_mist(&mission) == 0, 501);
            ts::return_shared(mission);
        };

        ts::next_tx(&mut scenario, POSTER);
        {
            let refund = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == 1_000, 502);
            ts::return_to_sender(&scenario, refund);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun abort_open_mission_refunds() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);

        ts::next_tx(&mut scenario, POSTER);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            missions::abort_mission(&mut mission, &c, ts::ctx(&mut scenario));
            assert!(missions::status(&mission) == missions::status_aborted(), 600);
            ts::return_shared(mission);
        };

        ts::next_tx(&mut scenario, POSTER);
        {
            let refund = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&refund) == 1_000, 601);
            ts::return_to_sender(&scenario, refund);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOT_OPEN, location = azuka::missions)]
    fun abort_claimed_mission_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);

        ts::next_tx(&mut scenario, CLAIMANT);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::claim_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        ts::next_tx(&mut scenario, POSTER);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            missions::abort_mission(&mut mission, &c, ts::ctx(&mut scenario));
            ts::return_shared(mission);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun expire_after_deadline_pays_claimant() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let mut c = new_clock(&mut scenario);
        // 1h review window
        create_mission_as(&mut scenario, POSTER, 1_000, option::some(60 * 60), &c);
        walk_through_submit(&mut scenario, &c);

        // Advance clock 1h + 1ms
        clock::increment_for_testing(&mut c, 60 * 60 * 1000 + 1);

        // Anyone (RANDO) can call expire
        ts::next_tx(&mut scenario, RANDO);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::expire_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            assert!(missions::status(&mission) == missions::status_expired(), 700);
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        // Claimant gets 950, admin 50
        ts::next_tx(&mut scenario, CLAIMANT);
        {
            let payout = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&payout) == 950, 701);
            ts::return_to_sender(&scenario, payout);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_DEADLINE_NOT_PASSED, location = azuka::missions)]
    fun expire_before_deadline_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);
        create_mission_as(&mut scenario, POSTER, 1_000, option::some(60 * 60), &c);
        walk_through_submit(&mut scenario, &c);

        ts::next_tx(&mut scenario, RANDO);
        {
            let mut mission = ts::take_shared<Mission>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            missions::expire_mission(&mut mission, &config, &c, ts::ctx(&mut scenario));
            ts::return_shared(mission);
            ts::return_shared(config);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    fun set_default_fee_admin_only() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        let c = new_clock(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut registry = ts::take_shared<MissionRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            missions::set_default_platform_fee_bps(&mut registry, &config, &cap, 800, ts::ctx(&mut scenario));
            assert!(missions::default_platform_fee_bps(&registry) == 800, 800);
            ts::return_shared(registry);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        // New mission snapshots the new fee
        let _ = create_mission_as(&mut scenario, POSTER, 1_000, option::none(), &c);
        ts::next_tx(&mut scenario, POSTER);
        {
            let mission = ts::take_shared<Mission>(&scenario);
            assert!(missions::platform_fee_bps(&mission) == 800, 801);
            ts::return_shared(mission);
        };

        clock::destroy_for_testing(c);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_FEE_TOO_HIGH, location = azuka::missions)]
    fun set_default_fee_above_cap_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut registry = ts::take_shared<MissionRegistry>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            missions::set_default_platform_fee_bps(&mut registry, &config, &cap, 1_500, ts::ctx(&mut scenario));
            ts::return_shared(registry);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        ts::end(scenario);
    }
}
