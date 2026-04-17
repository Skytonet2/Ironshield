// NewsCoin Curve — per-coin bonding curve contract.
//
// One instance is deployed by the factory per coined story. Holds:
//   - Token balances (this IS the NEP-141-ish ledger; we keep it lightweight)
//   - Piecewise bonding curve segments, mutated by the IronClaw agent under
//     strict rules (delay, transition, cooldown, visibility)
//   - Fees: 1% protocol → revenue_wallet, 0.5% creator → claimable
//   - Creator sell restrictions (blocked pre-bond, 70% burn post-bond single-sell)
//   - Graduation at $70k mcap → hands liquidity to Rhea Finance
//   - Kill switch — agent can wind down; holders claim proportional NEAR refund

use near_sdk::{
    near, env, AccountId, NearToken, PanicOnDefault, Promise, BorshStorageKey,
    Gas, require,
};
use near_sdk::store::{UnorderedMap, Vector};
use near_sdk::json_types::U128;

// ─── Constants ────────────────────────────────────────────────────────
const BPS_DENOMINATOR: u128 = 10_000;
const DEFAULT_PROTOCOL_FEE_BPS: u16 = 100; // 1%
const DEFAULT_CREATOR_FEE_BPS: u16 = 50;   // 0.5%
const CREATOR_BURN_BPS: u128 = 7_000;      // 70% of single-sell burns
const GRADUATION_MCAP_USD: u128 = 70_000;  // threshold
const NEAR_PRICE_USD_CENTS: u128 = 520;    // $5.20 — adminable later

// Timing (nanoseconds)
const DEFAULT_UPDATE_DELAY: u64 = 15 * 60 * 1_000_000_000;           // 15 min
const DEFAULT_TRANSITION_DURATION: u64 = 30 * 60 * 1_000_000_000;    // 30 min
const DEFAULT_COOLDOWN: u64 = 60 * 60 * 1_000_000_000;               // 1 hour

// Fixed-point: segment slopes/intercepts use 1e18 scaling so u128 math stays stable.
const PRICE_SCALE: u128 = 1_000_000_000_000_000_000; // 1e18

const GAS_FOR_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FOR_RHEA_MIGRATE: Gas = Gas::from_tgas(80);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Balances,
    Refunds,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct CurveSegment {
    /// Upper supply bound for this segment (exclusive). Last segment uses u128::MAX.
    pub supply_threshold: U128,
    /// Linear slope in fixed-point 1e18. price(s) = intercept + slope * (s - prev_threshold).
    pub slope: U128,
    /// Price at the start of this segment (yoctoNEAR per token, 1e18 fixed).
    pub intercept: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PendingCurveUpdate {
    pub new_segments: Vec<CurveSegment>,
    pub old_segments: Vec<CurveSegment>,
    pub trigger_metric: String,
    pub trigger_value: String,
    pub submitted_at: u64,
    pub executes_at: u64,
    pub transition_end: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NewsCoinCurve {
    // Identity / roles
    pub owner_id: AccountId,      // factory
    pub creator: AccountId,        // original minter
    pub agent_id: AccountId,       // ironclaw-agent.near
    pub revenue_wallet: AccountId, // ironshield-revenue.near
    pub rhea_router: AccountId,    // Rhea Finance pool creator / migrator
    pub registry_id: AccountId,    // NewsCoin registry for stats updates

    pub name: String,
    pub ticker: String,
    pub story_id: String,

    // Ledger
    pub total_supply: u128,
    pub balances: UnorderedMap<AccountId, u128>,

    // Curve
    pub current_segments: Vec<CurveSegment>,
    pub pending_update: Option<PendingCurveUpdate>,
    pub last_update_executed_at: u64,

    pub update_delay_ns: u64,
    pub transition_duration_ns: u64,
    pub cooldown_ns: u64,

    // Fees
    pub protocol_fee_bps: u16,
    pub creator_fee_bps: u16,
    pub creator_claimable: u128,

    // State flags
    pub graduated: bool,
    pub killed: bool,

    // Holders used for kill refunds
    pub refunds: UnorderedMap<AccountId, u128>,
    pub refund_pool: u128,
}

#[near]
impl NewsCoinCurve {
    #[init]
    #[payable]
    pub fn new(
        owner_id: AccountId,
        creator: AccountId,
        agent_id: AccountId,
        revenue_wallet: AccountId,
        rhea_router: AccountId,
        registry_id: AccountId,
        name: String,
        ticker: String,
        story_id: String,
    ) -> Self {
        // Default curve: 3 piecewise segments - gentle start, acceleration, steep.
        let default_segments = vec![
            CurveSegment {
                supply_threshold: U128(100_000 * PRICE_SCALE),
                slope: U128(PRICE_SCALE / 10_000),
                intercept: U128(PRICE_SCALE / 1_000_000),
            },
            CurveSegment {
                supply_threshold: U128(500_000 * PRICE_SCALE),
                slope: U128(PRICE_SCALE / 2_000),
                intercept: U128(PRICE_SCALE / 100_000),
            },
            CurveSegment {
                supply_threshold: U128(u128::MAX),
                slope: U128(PRICE_SCALE / 500),
                intercept: U128(PRICE_SCALE / 10_000),
            },
        ];

        Self {
            owner_id,
            creator,
            agent_id,
            revenue_wallet,
            rhea_router,
            registry_id,
            name,
            ticker,
            story_id,
            total_supply: 0,
            balances: UnorderedMap::new(StorageKey::Balances),
            current_segments: default_segments,
            pending_update: None,
            last_update_executed_at: 0,
            update_delay_ns: DEFAULT_UPDATE_DELAY,
            transition_duration_ns: DEFAULT_TRANSITION_DURATION,
            cooldown_ns: DEFAULT_COOLDOWN,
            protocol_fee_bps: DEFAULT_PROTOCOL_FEE_BPS,
            creator_fee_bps: DEFAULT_CREATOR_FEE_BPS,
            creator_claimable: 0,
            graduated: false,
            killed: false,
            refunds: UnorderedMap::new(StorageKey::Refunds),
            refund_pool: 0,
        }
    }

    // ─── Curve math ────────────────────────────────────────────────────

    /// Returns the active segment list. If we're in a transition window, we
    /// return an interpolated snapshot blended from old→new over the window.
    fn effective_segments(&self) -> Vec<CurveSegment> {
        if let Some(pending) = &self.pending_update {
            let now = env::block_timestamp();
            if now >= pending.executes_at && now < pending.transition_end {
                let total = pending.transition_end.saturating_sub(pending.executes_at).max(1);
                let elapsed = now.saturating_sub(pending.executes_at);
                let progress_bps = (elapsed as u128 * BPS_DENOMINATOR) / total as u128;
                // Interpolate segment-by-segment. If new has more/fewer segments,
                // the longer array dominates beyond the overlap.
                let len = pending.old_segments.len().max(pending.new_segments.len());
                let mut out = Vec::with_capacity(len);
                for i in 0..len {
                    let old = pending
                        .old_segments
                        .get(i)
                        .cloned()
                        .unwrap_or_else(|| pending.new_segments[i].clone());
                    let newb = pending
                        .new_segments
                        .get(i)
                        .cloned()
                        .unwrap_or_else(|| old.clone());
                    out.push(CurveSegment {
                        supply_threshold: U128(lerp_u128(old.supply_threshold.0, newb.supply_threshold.0, progress_bps)),
                        slope: U128(lerp_u128(old.slope.0, newb.slope.0, progress_bps)),
                        intercept: U128(lerp_u128(old.intercept.0, newb.intercept.0, progress_bps)),
                    });
                }
                return out;
            }
        }
        self.current_segments.clone()
    }

    /// Integrate the piecewise curve from supply `from` to `to` to get the
    /// yoctoNEAR cost (or proceeds). Uses trapezoidal-at-segment math.
    fn integral(&self, segs: &[CurveSegment], from: u128, to: u128) -> u128 {
        if to <= from {
            return 0;
        }
        let mut total: u128 = 0;
        let mut cursor = from;
        let mut seg_start: u128 = 0;
        for s in segs {
            let seg_end = s.supply_threshold.0;
            if cursor >= seg_end {
                seg_start = seg_end;
                continue;
            }
            let start_in_seg = cursor.saturating_sub(seg_start);
            let hi = to.min(seg_end);
            let width = hi.saturating_sub(cursor);
            if width > 0 {
                // price(x) = intercept + slope * (x - seg_start)
                // integral over [cursor..hi] = intercept*width + slope * (end_in_seg^2 - start_in_seg^2) / 2
                let end_in_seg = hi.saturating_sub(seg_start);
                let intercept_part = mul_scaled(s.intercept.0, width);
                let slope_part = mul_scaled(
                    s.slope.0,
                    (end_in_seg.saturating_mul(end_in_seg)
                        .saturating_sub(start_in_seg.saturating_mul(start_in_seg)))
                        / 2,
                );
                total = total.saturating_add(intercept_part).saturating_add(slope_part);
            }
            if hi >= to {
                break;
            }
            cursor = hi;
            seg_start = seg_end;
        }
        total
    }

    /// Invert the integral: how many tokens can we buy with near_amount at current supply?
    /// Uses binary search over supply delta.
    fn tokens_for_near(&self, segs: &[CurveSegment], near_amount: u128) -> u128 {
        if near_amount == 0 {
            return 0;
        }
        let base = self.total_supply;
        let mut lo: u128 = 0;
        let mut hi: u128 = 10_000_000 * PRICE_SCALE; // upper bound supply delta
        // Expand hi until the cost exceeds near_amount
        while self.integral(segs, base, base.saturating_add(hi)) < near_amount
            && hi < u128::MAX / 2
        {
            hi = hi.saturating_mul(2);
        }
        while lo + 1 < hi {
            let mid = lo + (hi - lo) / 2;
            let cost = self.integral(segs, base, base.saturating_add(mid));
            if cost <= near_amount {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        lo
    }

    pub fn quote_buy(&self, near_amount: U128) -> U128 {
        let segs = self.effective_segments();
        U128(self.tokens_for_near(&segs, near_amount.0))
    }

    pub fn quote_sell(&self, amount: U128) -> U128 {
        let segs = self.effective_segments();
        let from = self.total_supply.saturating_sub(amount.0);
        U128(self.integral(&segs, from, self.total_supply))
    }

    pub fn current_price(&self) -> U128 {
        let segs = self.effective_segments();
        // Price at current supply
        let mut seg_start: u128 = 0;
        for s in &segs {
            if self.total_supply < s.supply_threshold.0 {
                let within = self.total_supply.saturating_sub(seg_start);
                let price = s
                    .intercept
                    .0
                    .saturating_add(mul_scaled(s.slope.0, within));
                return U128(price);
            }
            seg_start = s.supply_threshold.0;
        }
        U128(0)
    }

    // ─── Trading ───────────────────────────────────────────────────────

    #[payable]
    pub fn buy(&mut self) -> U128 {
        require!(!self.killed, "Coin has been killed");
        require!(!self.graduated, "Graduated — trade on Rhea Finance");
        let trader = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached > 0, "Attach NEAR to buy");

        let protocol_fee = (attached * self.protocol_fee_bps as u128) / BPS_DENOMINATOR;
        let creator_fee = (attached * self.creator_fee_bps as u128) / BPS_DENOMINATOR;
        let net = attached.saturating_sub(protocol_fee).saturating_sub(creator_fee);

        let segs = self.effective_segments();
        let tokens = self.tokens_for_near(&segs, net);
        require!(tokens > 0, "Buy amount too small");

        // Mint to trader
        let prev = self.balances.get(&trader).copied().unwrap_or(0);
        self.balances.insert(trader.clone(), prev.saturating_add(tokens));
        self.total_supply = self.total_supply.saturating_add(tokens);

        // Track creator-claimable
        self.creator_claimable = self.creator_claimable.saturating_add(creator_fee);

        // Pay protocol fee out (fire-and-forget, fees go to revenue wallet for buybacks)
        if protocol_fee > 0 {
            Promise::new(self.revenue_wallet.clone())
                .transfer(NearToken::from_yoctonear(protocol_fee));
        }

        let price = self.current_price().0;
        let mcap = self.mcap_usd();

        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin","version":"1.0","event":"trade","data":[{{"trader":"{}","type":"buy","token_amount":"{}","near_amount":"{}","price":"{}","mcap_usd":"{}"}}]}}"#,
            trader, tokens, attached, price, mcap
        ));

        // Graduation check
        if !self.graduated && mcap >= GRADUATION_MCAP_USD {
            self.graduated = true;
            env::log_str(&format!(
                r#"EVENT_JSON:{{"standard":"newscoin","version":"1.0","event":"graduated","data":[{{"mcap_usd":"{}","supply":"{}"}}]}}"#,
                mcap, self.total_supply
            ));
            self.migrate_to_rhea();
        }

        U128(tokens)
    }

    #[payable]
    pub fn sell(&mut self, amount: U128) -> U128 {
        require!(!self.killed, "Coin has been killed");
        let trader = env::predecessor_account_id();
        let mut to_sell = amount.0;

        let bal = self.balances.get(&trader).copied().unwrap_or(0);
        require!(bal >= to_sell, "Insufficient balance");

        // Creator sell restrictions
        if trader == self.creator {
            require!(self.graduated, "Creator cannot sell before bonding ($70k mcap)");
            // Post-graduation single-sell: burn 70%, only 30% actually sells
            let burn = (to_sell * CREATOR_BURN_BPS) / BPS_DENOMINATOR;
            let remaining = to_sell.saturating_sub(burn);
            // Burn the 70%
            self.balances.insert(trader.clone(), bal.saturating_sub(burn));
            self.total_supply = self.total_supply.saturating_sub(burn);
            env::log_str(&format!(
                r#"EVENT_JSON:{{"standard":"newscoin","version":"1.0","event":"creator_burn","data":[{{"creator":"{}","burned":"{}","remaining_sold":"{}"}}]}}"#,
                trader, burn, remaining
            ));
            to_sell = remaining;
        }

        let segs = self.effective_segments();
        let from_supply = self.total_supply.saturating_sub(to_sell);
        let gross = self.integral(&segs, from_supply, self.total_supply);

        // Deduct fees
        let protocol_fee = (gross * self.protocol_fee_bps as u128) / BPS_DENOMINATOR;
        let creator_fee = (gross * self.creator_fee_bps as u128) / BPS_DENOMINATOR;
        let payout = gross.saturating_sub(protocol_fee).saturating_sub(creator_fee);

        // Burn tokens from trader
        let new_bal = bal.saturating_sub(to_sell);
        if new_bal == 0 {
            self.balances.remove(&trader);
        } else {
            self.balances.insert(trader.clone(), new_bal);
        }
        self.total_supply = from_supply;
        self.creator_claimable = self.creator_claimable.saturating_add(creator_fee);

        if protocol_fee > 0 {
            Promise::new(self.revenue_wallet.clone())
                .transfer(NearToken::from_yoctonear(protocol_fee));
        }
        if payout > 0 {
            Promise::new(trader.clone()).transfer(NearToken::from_yoctonear(payout));
        }

        let price = self.current_price().0;
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin","version":"1.0","event":"trade","data":[{{"trader":"{}","type":"sell","token_amount":"{}","near_amount":"{}","price":"{}","mcap_usd":"{}"}}]}}"#,
            trader, to_sell, payout, price, self.mcap_usd()
        ));

        U128(payout)
    }

    pub fn claim_fees(&mut self) -> U128 {
        let caller = env::predecessor_account_id();
        require!(caller == self.creator, "Only creator can claim fees");
        let amt = self.creator_claimable;
        require!(amt > 0, "Nothing to claim");
        self.creator_claimable = 0;
        Promise::new(caller).transfer(NearToken::from_yoctonear(amt));
        U128(amt)
    }

    // ─── Rhea Finance graduation ──────────────────────────────────────
    //
    // On graduation we hand the bonded NEAR + remaining supply metadata to
    // `rhea_router`. The router contract (deployed separately) seeds a Rhea
    // liquidity pool. Here we:
    //   1. Transfer bonded NEAR (minus creator_claimable, minus storage buffer)
    //   2. Cross-contract call rhea_router.migrate_coin({name, ticker, supply, ...})
    //   3. Ping registry so UI can flip to "Trade on Rhea" CTA
    //
    // If the router call fails, NEAR sits in the contract; admin can retry
    // via `retry_rhea_migration`. Trading stays frozen either way.
    fn migrate_to_rhea(&mut self) {
        // Reserve 0.1 NEAR for contract storage, keep creator_claimable intact.
        let storage_reserve: u128 = 100_000_000_000_000_000_000_000; // 0.1 NEAR
        let balance = env::account_balance().as_yoctonear();
        let reserved = self.creator_claimable.saturating_add(storage_reserve);
        let migratable = balance.saturating_sub(reserved);

        if migratable == 0 {
            env::log_str("EVENT_JSON:{\"standard\":\"newscoin\",\"version\":\"1.0\",\"event\":\"rhea_migration_skipped\",\"data\":[{\"reason\":\"no_balance\"}]}");
            return;
        }

        // Mint an LP-seed supply to the migrator equal to total_supply.
        // This doubles the circulating supply at graduation — the curve side
        // supply stays with holders (they can ft_transfer freely post-grad),
        // and the migrator's copy gets paired with bonded NEAR on Ref.
        // Holders effectively get a 2x effective supply but the DEX price
        // anchors to the curve's terminal price * 2 which is fine for v1.
        let grad_supply = self.total_supply;
        self.total_supply = self.total_supply.saturating_add(grad_supply);
        let router = self.rhea_router.clone();
        let router_bal = self.balances.get(&router).copied().unwrap_or(0);
        self.balances.insert(router.clone(), router_bal + grad_supply);
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"nep141","version":"1.0.0","event":"ft_mint","data":[{{"owner_id":"{}","amount":"{}","memo":"graduation_lp"}}]}}"#,
            router, grad_supply
        ));

        let payload = format!(
            r#"{{"coin_id":"{}","name":"{}","ticker":"{}","story_id":"{}","total_supply":"{}","creator":"{}"}}"#,
            env::current_account_id(),
            self.name,
            self.ticker,
            self.story_id,
            grad_supply,
            self.creator,
        );

        Promise::new(self.rhea_router.clone())
            .function_call(
                "migrate_coin".to_string(),
                payload.into_bytes(),
                NearToken::from_yoctonear(migratable),
                GAS_FOR_RHEA_MIGRATE,
            );

        // Mark graduated in registry (best-effort, separate promise).
        let reg_payload = format!(
            r#"{{"coin_id":"{}","mcap_usd":"{}","volume_24h":"0","holders":{},"graduated":true}}"#,
            env::current_account_id(),
            self.mcap_usd(),
            self.balances.len(),
        );
        Promise::new(self.registry_id.clone())
            .function_call(
                "update_coin_stats".to_string(),
                reg_payload.into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(15),
            );
    }

    /// Admin retry if initial migration promise failed (NEAR still on contract).
    pub fn retry_rhea_migration(&mut self) {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner_id || caller == self.agent_id, "Not authorized");
        require!(self.graduated, "Not graduated yet");
        self.migrate_to_rhea();
    }

    // ─── Agent curve management ───────────────────────────────────────

    pub fn submit_curve_update(
        &mut self,
        new_segments: Vec<CurveSegment>,
        trigger_metric: String,
        trigger_value: String,
    ) {
        let caller = env::predecessor_account_id();
        require!(caller == self.agent_id, "Only agent can update curve");
        require!(!self.killed, "Coin killed");
        require!(!self.graduated, "Graduated — curve frozen");
        require!(self.pending_update.is_none(), "Update already pending");

        let now = env::block_timestamp();
        require!(
            now.saturating_sub(self.last_update_executed_at) >= self.cooldown_ns,
            "Cooldown not elapsed"
        );

        let executes_at = now + self.update_delay_ns;
        let transition_end = executes_at + self.transition_duration_ns;

        let pending = PendingCurveUpdate {
            new_segments: new_segments.clone(),
            old_segments: self.current_segments.clone(),
            trigger_metric: trigger_metric.clone(),
            trigger_value: trigger_value.clone(),
            submitted_at: now,
            executes_at,
            transition_end,
        };

        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin","version":"1.0","event":"curve_update_submitted","data":[{{"trigger_metric":"{}","trigger_value":"{}","submitted_at":"{}","executes_at":"{}","transition_end":"{}"}}]}}"#,
            trigger_metric, trigger_value, now, executes_at, transition_end
        ));

        self.pending_update = Some(pending);
    }

    /// Anyone can call this once the transition window ends — it just
    /// "promotes" the pending curve into current. Before the window ends,
    /// the interpolated curve is used automatically via effective_segments().
    pub fn finalize_curve_update(&mut self) {
        if let Some(pending) = self.pending_update.take() {
            let now = env::block_timestamp();
            if now < pending.transition_end {
                // Not ready — put it back
                self.pending_update = Some(pending);
                env::panic_str("Transition not complete");
            }
            self.current_segments = pending.new_segments.clone();
            self.last_update_executed_at = now;
            env::log_str(&format!(
                r#"EVENT_JSON:{{"standard":"newscoin","version":"1.0","event":"curve_update_executed","data":[{{"executed_at":"{}"}}]}}"#,
                now
            ));
        }
    }

    pub fn kill_coin(&mut self) {
        let caller = env::predecessor_account_id();
        require!(caller == self.agent_id, "Only agent can kill");
        require!(!self.killed, "Already killed");
        self.killed = true;
        // Snapshot refund pool = all NEAR currently in contract beyond
        // creator_claimable (which the creator still owns).
        let bal = env::account_balance().as_yoctonear();
        let available = bal.saturating_sub(self.creator_claimable);
        self.refund_pool = available;
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin","version":"1.0","event":"coin_killed","data":[{{"refund_pool":"{}","total_supply":"{}"}}]}}"#,
            available, self.total_supply
        ));
    }

    /// Holders claim their proportional share of the refund pool.
    pub fn claim_refund(&mut self) -> U128 {
        require!(self.killed, "Coin is still active");
        let caller = env::predecessor_account_id();
        let bal = self.balances.get(&caller).copied().unwrap_or(0);
        require!(bal > 0, "No holdings to refund");
        require!(
            self.refunds.get(&caller).copied().unwrap_or(0) == 0,
            "Already claimed"
        );
        require!(self.total_supply > 0, "No supply");

        // Proportional share: (holder_bal / total_supply) * refund_pool
        let share = (bal as u128).saturating_mul(self.refund_pool) / self.total_supply;
        self.refunds.insert(caller.clone(), share);
        // Burn their tokens
        self.balances.remove(&caller);

        if share > 0 {
            Promise::new(caller).transfer(NearToken::from_yoctonear(share));
        }
        U128(share)
    }

    // ─── NEP-141 surface (so Ref Finance / Rhea can index the token) ──
    //
    // We intentionally implement a minimal subset — enough for Ref's
    // ft_transfer_call flow and wallet balance queries. Pre-graduation the
    // token is trade-restricted (buy/sell only via curve), so ft_transfer is
    // callable but the only meaningful use is the migrator pulling supply
    // into Ref at graduation. Post-graduation, Ref takes over price
    // discovery and holders can freely transfer.
    //
    // Storage registration is a no-op: we use UnorderedMap keyed by
    // AccountId with no per-user storage deposit. Rooms for improvement
    // but good enough for v1.

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, _memo: Option<String>) {
        require!(env::attached_deposit().as_yoctonear() == 1, "Requires 1 yocto");
        let sender = env::predecessor_account_id();
        let amt = amount.0;
        require!(amt > 0, "Zero transfer");
        let sender_bal = self.balances.get(&sender).copied().unwrap_or(0);
        require!(sender_bal >= amt, "Insufficient balance");
        self.balances.insert(sender.clone(), sender_bal - amt);
        let recv_bal = self.balances.get(&receiver_id).copied().unwrap_or(0);
        self.balances.insert(receiver_id.clone(), recv_bal + amt);
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{{"old_owner_id":"{}","new_owner_id":"{}","amount":"{}"}}]}}"#,
            sender, receiver_id, amt
        ));
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        _memo: Option<String>,
        msg: String,
    ) -> Promise {
        require!(env::attached_deposit().as_yoctonear() == 1, "Requires 1 yocto");
        let sender = env::predecessor_account_id();
        let amt = amount.0;
        require!(amt > 0, "Zero transfer");
        let sender_bal = self.balances.get(&sender).copied().unwrap_or(0);
        require!(sender_bal >= amt, "Insufficient balance");
        self.balances.insert(sender.clone(), sender_bal - amt);
        let recv_bal = self.balances.get(&receiver_id).copied().unwrap_or(0);
        self.balances.insert(receiver_id.clone(), recv_bal + amt);

        // Fire ft_on_transfer on receiver; on callback we'd refund unused.
        // Minimal version: fire-and-forget. Ref's ft_on_transfer always
        // returns "0" (used all), so refund path isn't strictly needed here.
        let payload = format!(
            r#"{{"sender_id":"{}","amount":"{}","msg":"{}"}}"#,
            sender, amt, msg.replace('\\', "\\\\").replace('"', "\\\"")
        );
        Promise::new(receiver_id).function_call(
            "ft_on_transfer".to_string(),
            payload.into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(30),
        )
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_metadata(&self) -> serde_json::Value {
        serde_json::json!({
            "spec": "ft-1.0.0",
            "name": self.name,
            "symbol": self.ticker,
            "icon": serde_json::Value::Null,
            "reference": serde_json::Value::Null,
            "reference_hash": serde_json::Value::Null,
            "decimals": 18u8,
        })
    }

    // Ref calls storage_deposit before ft_transfer_call — make it a no-op
    // with minimal refund so registration doesn't block migration.
    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        _registration_only: Option<bool>,
    ) -> serde_json::Value {
        let attached = env::attached_deposit().as_yoctonear();
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        // We don't actually track per-account storage — refund everything
        // beyond a nominal 0.00125 NEAR bond.
        let bond: u128 = 1_250_000_000_000_000_000_000;
        if attached > bond {
            Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(attached - bond));
        }
        serde_json::json!({
            "total": U128(bond),
            "available": U128(0),
            "account_id": who,
        })
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<serde_json::Value> {
        Some(serde_json::json!({
            "total": U128(1_250_000_000_000_000_000_000u128),
            "available": U128(0),
            "account_id": account_id,
        }))
    }

    pub fn storage_balance_bounds(&self) -> serde_json::Value {
        serde_json::json!({
            "min": U128(1_250_000_000_000_000_000_000u128),
            "max": U128(1_250_000_000_000_000_000_000u128),
        })
    }

    // ─── Views ─────────────────────────────────────────────────────────

    pub fn get_info(&self) -> serde_json::Value {
        serde_json::json!({
            "name": self.name,
            "ticker": self.ticker,
            "story_id": self.story_id,
            "creator": self.creator,
            "total_supply": U128(self.total_supply),
            "price": self.current_price(),
            "mcap_usd": U128(self.mcap_usd()),
            "graduated": self.graduated,
            "killed": self.killed,
            "creator_claimable": U128(self.creator_claimable),
            "protocol_fee_bps": self.protocol_fee_bps,
            "creator_fee_bps": self.creator_fee_bps,
        })
    }

    pub fn get_balance(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_curve_state(&self) -> serde_json::Value {
        let now = env::block_timestamp();
        let cooldown_ends_at = self.last_update_executed_at.saturating_add(self.cooldown_ns);
        let transition_progress = self
            .pending_update
            .as_ref()
            .and_then(|p| {
                if now < p.executes_at {
                    Some(0u128)
                } else if now >= p.transition_end {
                    Some(BPS_DENOMINATOR)
                } else {
                    let total = p.transition_end.saturating_sub(p.executes_at).max(1);
                    Some(((now - p.executes_at) as u128 * BPS_DENOMINATOR) / total as u128)
                }
            })
            .unwrap_or(0);
        serde_json::json!({
            "current_segments": self.current_segments,
            "pending_update": self.pending_update,
            "last_update_at": self.last_update_executed_at.to_string(),
            "cooldown_ends_at": cooldown_ends_at.to_string(),
            "cooldown_ns": self.cooldown_ns.to_string(),
            "update_delay_ns": self.update_delay_ns.to_string(),
            "transition_duration_ns": self.transition_duration_ns.to_string(),
            "transition_progress_bps": transition_progress.to_string(),
            "effective_segments": self.effective_segments(),
        })
    }

    pub fn mcap_usd(&self) -> u128 {
        // mcap (yocto) ≈ price_per_token * total_supply / PRICE_SCALE
        let price = self.current_price().0;
        let mcap_yocto = mul_scaled(price, self.total_supply);
        // yocto NEAR → USD: (yocto / 1e24) * (NEAR_PRICE_USD_CENTS / 100)
        (mcap_yocto / 10u128.pow(24)) * NEAR_PRICE_USD_CENTS / 100
    }

    pub fn get_refund(&self, account_id: AccountId) -> U128 {
        U128(self.refunds.get(&account_id).copied().unwrap_or(0))
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────

fn mul_scaled(a: u128, b: u128) -> u128 {
    // Multiply two fixed-point-ish values, scaling down by PRICE_SCALE.
    // Uses u256-ish manual splitting to avoid overflow on intermediate product.
    let a_hi = a >> 64;
    let a_lo = a & ((1u128 << 64) - 1);
    let b_hi = b >> 64;
    let b_lo = b & ((1u128 << 64) - 1);
    // (a_hi*2^64 + a_lo)(b_hi*2^64 + b_lo) = a_hi*b_hi*2^128 + (a_hi*b_lo + a_lo*b_hi)*2^64 + a_lo*b_lo
    // For our use cases (near amounts × prices) we bound the inputs so a_hi*b_hi is usually 0.
    // If it overflows we saturate — stops weird huge numbers bricking the contract.
    let hi_hi = a_hi.checked_mul(b_hi).unwrap_or(u128::MAX);
    if hi_hi > 0 {
        return u128::MAX;
    }
    let cross = a_hi.saturating_mul(b_lo).saturating_add(a_lo.saturating_mul(b_hi));
    let lo = a_lo.saturating_mul(b_lo);
    // Combine: result = (cross << 64) + lo ... then / PRICE_SCALE
    let combined = cross.checked_shl(64).unwrap_or(u128::MAX).saturating_add(lo);
    combined / PRICE_SCALE
}

fn lerp_u128(a: u128, b: u128, progress_bps: u128) -> u128 {
    let progress_bps = progress_bps.min(BPS_DENOMINATOR);
    if a <= b {
        a.saturating_add((b - a).saturating_mul(progress_bps) / BPS_DENOMINATOR)
    } else {
        a.saturating_sub((a - b).saturating_mul(progress_bps) / BPS_DENOMINATOR)
    }
}
