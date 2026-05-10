#[test_only]
module azuka::treasury_tests {
    use std::string;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_scenario as ts;

    use azuka::core::{Self, Config, AdminCap};
    use azuka::treasury::{Self, Treasury};

    const ADMIN: address = @0xA11CE;
    const CONTRIBUTOR: address = @0xC1;
    const RESERVE: address = @0xC2;
    const PROPOSER: address = @0xC3;
    const DEPOSITOR: address = @0xD0;

    const E_DEPOSIT_REQUIRED: u64 = 0;
    const E_NOTHING_TO_DISTRIBUTE: u64 = 1;
    const E_BPS_SUM: u64 = 2;
    const E_RECIPIENT_NOT_SET: u64 = 3;

    fun bootstrap(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        {
            let ctx = ts::ctx(scenario);
            core::init_for_testing(ctx);
            treasury::init_for_testing(ctx);
        };
    }

    fun set_recipients(scenario: &mut ts::Scenario) {
        ts::next_tx(scenario, ADMIN);
        let mut treasury = ts::take_shared<Treasury>(scenario);
        let config = ts::take_shared<Config>(scenario);
        let cap = ts::take_from_sender<AdminCap>(scenario);
        treasury::set_recipients(&mut treasury, &config, &cap, CONTRIBUTOR, RESERVE, PROPOSER, ts::ctx(scenario));
        ts::return_shared(treasury);
        ts::return_shared(config);
        ts::return_to_sender(scenario, cap);
    }

    fun deposit_as(scenario: &mut ts::Scenario, who: address, amount: u64) {
        ts::next_tx(scenario, who);
        let mut treasury = ts::take_shared<Treasury>(scenario);
        let config = ts::take_shared<Config>(scenario);
        let payment = coin::mint_for_testing<SUI>(amount, ts::ctx(scenario));
        treasury::deposit_revenue(&mut treasury, &config, payment, string::utf8(b"test"));
        ts::return_shared(treasury);
        ts::return_shared(config);
    }

    #[test]
    fun deposit_revenue_accumulates() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);

        deposit_as(&mut scenario, DEPOSITOR, 1_000);
        deposit_as(&mut scenario, DEPOSITOR, 500);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let treasury = ts::take_shared<Treasury>(&scenario);
            assert!(treasury::undistributed_mist(&treasury) == 1_500, 100);
            assert!(treasury::total_revenue_mist(&treasury) == 1_500, 101);
            assert!(treasury::distributed_revenue_mist(&treasury) == 0, 102);
            ts::return_shared(treasury);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_DEPOSIT_REQUIRED, location = azuka::treasury)]
    fun deposit_zero_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, DEPOSITOR);
        let mut treasury = ts::take_shared<Treasury>(&scenario);
        let config = ts::take_shared<Config>(&scenario);
        let zero = coin::zero<SUI>(ts::ctx(&mut scenario));
        treasury::deposit_revenue(&mut treasury, &config, zero, string::utf8(b"test"));
        ts::return_shared(treasury);
        ts::return_shared(config);

        ts::end(scenario);
    }

    #[test]
    fun distribute_revenue_splits_40_30_30() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        set_recipients(&mut scenario);
        deposit_as(&mut scenario, DEPOSITOR, 1_000);

        // Permissionless distribute
        ts::next_tx(&mut scenario, DEPOSITOR);
        {
            let mut treasury = ts::take_shared<Treasury>(&scenario);
            treasury::distribute_revenue(&mut treasury, ts::ctx(&mut scenario));
            assert!(treasury::undistributed_mist(&treasury) == 0, 200);
            assert!(treasury::distributed_revenue_mist(&treasury) == 1_000, 201);
            ts::return_shared(treasury);
        };

        // Defaults: 40% / 30% / 30%
        ts::next_tx(&mut scenario, CONTRIBUTOR);
        {
            let c = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&c) == 400, 202);
            ts::return_to_sender(&scenario, c);
        };
        ts::next_tx(&mut scenario, RESERVE);
        {
            let c = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&c) == 300, 203);
            ts::return_to_sender(&scenario, c);
        };
        ts::next_tx(&mut scenario, PROPOSER);
        {
            let c = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&c) == 300, 204);
            ts::return_to_sender(&scenario, c);
        };

        ts::end(scenario);
    }

    #[test]
    fun distribute_proposer_absorbs_rounding_dust() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        set_recipients(&mut scenario);
        // 7 mist with 40/30/30 → contributor 2, reserve 2, proposer = 7-2-2 = 3
        deposit_as(&mut scenario, DEPOSITOR, 7);

        ts::next_tx(&mut scenario, DEPOSITOR);
        {
            let mut treasury = ts::take_shared<Treasury>(&scenario);
            treasury::distribute_revenue(&mut treasury, ts::ctx(&mut scenario));
            assert!(treasury::undistributed_mist(&treasury) == 0, 300);
            ts::return_shared(treasury);
        };

        ts::next_tx(&mut scenario, CONTRIBUTOR);
        {
            let c = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&c) == 2, 301);
            ts::return_to_sender(&scenario, c);
        };
        ts::next_tx(&mut scenario, RESERVE);
        {
            let c = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&c) == 2, 302);
            ts::return_to_sender(&scenario, c);
        };
        ts::next_tx(&mut scenario, PROPOSER);
        {
            let c = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&c) == 3, 303); // 7 - 2 - 2 = 3 (dust absorbed)
            ts::return_to_sender(&scenario, c);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_RECIPIENT_NOT_SET, location = azuka::treasury)]
    fun distribute_without_recipients_set_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        deposit_as(&mut scenario, DEPOSITOR, 1_000);

        ts::next_tx(&mut scenario, DEPOSITOR);
        {
            let mut treasury = ts::take_shared<Treasury>(&scenario);
            treasury::distribute_revenue(&mut treasury, ts::ctx(&mut scenario));
            ts::return_shared(treasury);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_NOTHING_TO_DISTRIBUTE, location = azuka::treasury)]
    fun distribute_with_zero_balance_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        set_recipients(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut treasury = ts::take_shared<Treasury>(&scenario);
            treasury::distribute_revenue(&mut treasury, ts::ctx(&mut scenario));
            ts::return_shared(treasury);
        };

        ts::end(scenario);
    }

    #[test]
    fun update_shares_admin_only() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);
        set_recipients(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut treasury = ts::take_shared<Treasury>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            treasury::update_shares(&mut treasury, &config, &cap, 5_000, 3_000, 2_000, ts::ctx(&mut scenario));
            assert!(treasury::contributor_share_bps(&treasury) == 5_000, 400);
            assert!(treasury::reserve_share_bps(&treasury) == 3_000, 401);
            assert!(treasury::proposer_share_bps(&treasury) == 2_000, 402);
            ts::return_shared(treasury);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        // New split applied to next distribute: 1000 → 500/300/200
        deposit_as(&mut scenario, DEPOSITOR, 1_000);
        ts::next_tx(&mut scenario, DEPOSITOR);
        {
            let mut treasury = ts::take_shared<Treasury>(&scenario);
            treasury::distribute_revenue(&mut treasury, ts::ctx(&mut scenario));
            ts::return_shared(treasury);
        };
        ts::next_tx(&mut scenario, CONTRIBUTOR);
        {
            let c = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&c) == 500, 403);
            ts::return_to_sender(&scenario, c);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_BPS_SUM, location = azuka::treasury)]
    fun update_shares_bad_sum_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut treasury = ts::take_shared<Treasury>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            treasury::update_shares(&mut treasury, &config, &cap, 5_000, 3_000, 1_000, ts::ctx(&mut scenario));
            ts::return_shared(treasury);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = E_RECIPIENT_NOT_SET, location = azuka::treasury)]
    fun set_zero_recipient_fails() {
        let mut scenario = ts::begin(ADMIN);
        bootstrap(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut treasury = ts::take_shared<Treasury>(&scenario);
            let config = ts::take_shared<Config>(&scenario);
            let cap = ts::take_from_sender<AdminCap>(&scenario);
            treasury::set_recipients(&mut treasury, &config, &cap, @0x0, RESERVE, PROPOSER, ts::ctx(&mut scenario));
            ts::return_shared(treasury);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, cap);
        };

        ts::end(scenario);
    }
}
