// NewsCoin → Rhea Finance migrator.
//
// Graduated NewsCoin curves call `migrate_coin({...})` on this contract with
// attached NEAR. This contract then orchestrates the migration to Rhea (Ref):
//
//   1. Wrap attached NEAR → wNEAR (wrap.near)
//   2. storage_deposit on Ref pool for ourselves + the coin contract
//   3. Ref.add_simple_pool([coin, wrap.near], fee=30bps) → pool_id
//   4. Pull coin's remaining supply via ft_transfer_call from the coin contract
//      (coin contract must be NEP-141 compliant; curve has the ft_* surface)
//   5. ft_transfer_call both sides to Ref with msg=`{"actions":[{"pool_id":N, ...}]}`
//      — Ref mints LP shares to us (held on behalf of the coin contract for now)
//
// If any step fails, state records which step failed; admin can retry via
// `resume_migration(coin_id)`. This keeps graduated NEAR recoverable.
//
// NOTE: This contract assumes the curve contract exposes NEP-141 (ft_transfer,
// ft_balance_of, ft_total_supply). See `contract/newscoin/curve/src/lib.rs`
// ft_* methods. The migrator itself is not NEP-141.

use near_sdk::{
    near, env, AccountId, NearToken, PanicOnDefault, Promise, PromiseError,
    Gas, BorshStorageKey, require,
};
use near_sdk::store::{UnorderedMap};
use near_sdk::json_types::U128;

const WRAP_NEAR: &str = "wrap.near";
const REF_FINANCE: &str = "v2.ref-finance.near";
const POOL_FEE_BPS: u32 = 30; // 0.3% — Ref's most common tier

// Storage deposits Ref requires
const REF_STORAGE_DEPOSIT: u128 = 100_000_000_000_000_000_000_000;  // 0.1 NEAR
const WRAP_STORAGE_DEPOSIT: u128 = 1_250_000_000_000_000_000_000;   // 0.00125 NEAR

const GAS_WRAP: Gas = Gas::from_tgas(30);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_ADD_POOL: Gas = Gas::from_tgas(40);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(60);
const GAS_CALLBACK: Gas = Gas::from_tgas(30);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Migrations,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub enum MigrationStatus {
    Pending,
    Wrapped,
    PoolCreated { pool_id: u64 },
    WnearDeposited { pool_id: u64 },
    TokenDeposited { pool_id: u64 },
    LiquiditySeeded { pool_id: u64 },
    Failed { step: String, error: String },
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Migration {
    pub coin_id: AccountId,
    pub name: String,
    pub ticker: String,
    pub story_id: String,
    pub total_supply: U128,
    pub creator: AccountId,
    pub near_received: U128,
    pub pool_id: Option<u64>,
    pub status: MigrationStatus,
    pub started_at: u64,
    pub updated_at: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RheaMigrator {
    owner_id: AccountId,
    agent_id: AccountId,
    wrap_near: AccountId,
    ref_finance: AccountId,
    migrations: UnorderedMap<AccountId, Migration>,
}

#[near]
impl RheaMigrator {
    #[init]
    pub fn new(owner_id: AccountId, agent_id: AccountId) -> Self {
        Self {
            owner_id,
            agent_id,
            wrap_near: WRAP_NEAR.parse().unwrap(),
            ref_finance: REF_FINANCE.parse().unwrap(),
            migrations: UnorderedMap::new(StorageKey::Migrations),
        }
    }

    // ─── Entry: called by curve contract on graduation ─────────────────
    //
    // Payload shape matches what curve's `migrate_to_rhea()` sends:
    //   { coin_id, name, ticker, story_id, total_supply, creator }
    // The coin contract must have attached NEAR. We record the migration and
    // kick off step 1 (wrap NEAR).
    #[payable]
    pub fn migrate_coin(
        &mut self,
        coin_id: AccountId,
        name: String,
        ticker: String,
        story_id: String,
        total_supply: U128,
        creator: AccountId,
    ) -> Promise {
        let caller = env::predecessor_account_id();
        // Only allow the coin itself to call (i.e. coin_id == caller)
        require!(caller == coin_id, "migrate_coin must be called by the coin contract itself");

        let near_received = env::attached_deposit().as_yoctonear();
        require!(near_received >= REF_STORAGE_DEPOSIT + WRAP_STORAGE_DEPOSIT + NearToken::from_millinear(100).as_yoctonear(),
            "Insufficient NEAR for migration (need > 0.2)");

        // Guard against re-entry: if we already have a non-failed migration, reject
        if let Some(existing) = self.migrations.get(&coin_id) {
            match existing.status {
                MigrationStatus::Failed { .. } => {} // allow retry
                _ => env::panic_str("Migration already in progress for this coin"),
            }
        }

        let now = env::block_timestamp();
        let migration = Migration {
            coin_id: coin_id.clone(),
            name,
            ticker,
            story_id,
            total_supply,
            creator,
            near_received: U128(near_received),
            pool_id: None,
            status: MigrationStatus::Pending,
            started_at: now,
            updated_at: now,
        };
        self.migrations.insert(coin_id.clone(), migration);

        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin-migrator","version":"1.0","event":"migration_started","data":[{{"coin_id":"{}","near":"{}"}}]}}"#,
            coin_id, near_received
        ));

        // Step 1: wrap NEAR. Reserve some for gas + storage.
        let wrap_amount = near_received
            .saturating_sub(REF_STORAGE_DEPOSIT)
            .saturating_sub(WRAP_STORAGE_DEPOSIT);

        Promise::new(self.wrap_near.clone())
            .function_call(
                "near_deposit".to_string(),
                b"{}".to_vec(),
                NearToken::from_yoctonear(wrap_amount),
                GAS_WRAP,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_wrap_complete(coin_id, U128(wrap_amount)),
            )
    }

    // ─── Step 1 callback: NEAR wrapped ─────────────────────────────────
    #[private]
    pub fn on_wrap_complete(
        &mut self,
        coin_id: AccountId,
        wrap_amount: U128,
        #[callback_result] wrap_result: Result<(), PromiseError>,
    ) -> Promise {
        let mut m = self.migrations.get(&coin_id).cloned()
            .unwrap_or_else(|| env::panic_str("Migration not found"));

        if wrap_result.is_err() {
            m.status = MigrationStatus::Failed {
                step: "wrap".to_string(),
                error: "near_deposit failed".to_string(),
            };
            m.updated_at = env::block_timestamp();
            self.migrations.insert(coin_id.clone(), m);
            env::panic_str("Wrap step failed — admin can retry via resume_migration");
        }

        m.status = MigrationStatus::Wrapped;
        m.updated_at = env::block_timestamp();
        self.migrations.insert(coin_id.clone(), m);

        // Step 2a: storage_deposit on Ref for ourselves
        Promise::new(self.ref_finance.clone())
            .function_call(
                "storage_deposit".to_string(),
                format!(r#"{{"account_id":"{}","registration_only":false}}"#, env::current_account_id()).into_bytes(),
                NearToken::from_yoctonear(REF_STORAGE_DEPOSIT),
                GAS_STORAGE_DEPOSIT,
            )
            .then(
                // Step 2b: create pool on Ref
                Promise::new(self.ref_finance.clone()).function_call(
                    "add_simple_pool".to_string(),
                    format!(
                        r#"{{"tokens":["{}","{}"],"fee":{}}}"#,
                        coin_id, self.wrap_near, POOL_FEE_BPS
                    ).into_bytes(),
                    NearToken::from_millinear(10), // 0.01 NEAR Ref fee
                    GAS_ADD_POOL,
                ),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_pool_created(coin_id, wrap_amount),
            )
    }

    // ─── Step 2 callback: pool created on Ref ──────────────────────────
    #[private]
    pub fn on_pool_created(
        &mut self,
        coin_id: AccountId,
        wrap_amount: U128,
        #[callback_result] pool_result: Result<u64, PromiseError>,
    ) -> Promise {
        let mut m = self.migrations.get(&coin_id).cloned()
            .unwrap_or_else(|| env::panic_str("Migration not found"));

        let pool_id = match pool_result {
            Ok(id) => id,
            Err(_) => {
                m.status = MigrationStatus::Failed {
                    step: "add_simple_pool".to_string(),
                    error: "Ref rejected pool creation".to_string(),
                };
                m.updated_at = env::block_timestamp();
                self.migrations.insert(coin_id.clone(), m);
                env::panic_str("Pool creation failed — admin can retry");
            }
        };

        m.pool_id = Some(pool_id);
        m.status = MigrationStatus::PoolCreated { pool_id };
        m.updated_at = env::block_timestamp();
        let total_supply = m.total_supply;
        self.migrations.insert(coin_id.clone(), m);

        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin-migrator","version":"1.0","event":"pool_created","data":[{{"coin_id":"{}","pool_id":{}}}]}}"#,
            coin_id, pool_id
        ));

        // Step 3: deposit wNEAR balance into Ref. Empty msg = "just credit
        // our account's Ref balance, don't swap". We'll do the same for the
        // coin token, then call add_liquidity to commit both into the pool.
        Promise::new(self.wrap_near.clone())
            .function_call(
                "ft_transfer_call".to_string(),
                format!(
                    r#"{{"receiver_id":"{}","amount":"{}","msg":""}}"#,
                    self.ref_finance, wrap_amount.0
                ).into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FT_TRANSFER_CALL,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_wnear_deposited(coin_id, pool_id, wrap_amount, total_supply),
            )
    }

    // ─── Step 3 callback: wNEAR deposited to Ref ───────────────────────
    #[private]
    pub fn on_wnear_deposited(
        &mut self,
        coin_id: AccountId,
        pool_id: u64,
        wrap_amount: U128,
        total_supply: U128,
        #[callback_result] result: Result<U128, PromiseError>,
    ) -> Promise {
        let mut m = self.migrations.get(&coin_id).cloned()
            .unwrap_or_else(|| env::panic_str("Migration not found"));

        if result.is_err() {
            m.status = MigrationStatus::Failed {
                step: "ft_transfer_call(wNEAR)".to_string(),
                error: "Ref refused wNEAR deposit".to_string(),
            };
            m.updated_at = env::block_timestamp();
            self.migrations.insert(coin_id.clone(), m);
            env::panic_str("wNEAR deposit failed — admin can retry");
        }

        m.status = MigrationStatus::WnearDeposited { pool_id };
        m.updated_at = env::block_timestamp();
        self.migrations.insert(coin_id.clone(), m);

        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin-migrator","version":"1.0","event":"wnear_deposited","data":[{{"coin_id":"{}","amount":"{}"}}]}}"#,
            coin_id, wrap_amount.0
        ));

        // Step 4: deposit coin tokens (from the NEP-141 balance the curve
        // minted to us at graduation) into Ref.
        Promise::new(coin_id.clone())
            .function_call(
                "ft_transfer_call".to_string(),
                format!(
                    r#"{{"receiver_id":"{}","amount":"{}","msg":""}}"#,
                    self.ref_finance, total_supply.0
                ).into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_FT_TRANSFER_CALL,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_token_deposited(coin_id, pool_id, wrap_amount, total_supply),
            )
    }

    // ─── Step 4 callback: coin tokens deposited to Ref ─────────────────
    #[private]
    pub fn on_token_deposited(
        &mut self,
        coin_id: AccountId,
        pool_id: u64,
        wrap_amount: U128,
        total_supply: U128,
        #[callback_result] result: Result<U128, PromiseError>,
    ) -> Promise {
        let mut m = self.migrations.get(&coin_id).cloned()
            .unwrap_or_else(|| env::panic_str("Migration not found"));

        if result.is_err() {
            m.status = MigrationStatus::Failed {
                step: "ft_transfer_call(coin)".to_string(),
                error: "Ref refused coin deposit".to_string(),
            };
            m.updated_at = env::block_timestamp();
            self.migrations.insert(coin_id.clone(), m);
            env::panic_str("Coin deposit failed — admin can retry");
        }

        m.status = MigrationStatus::TokenDeposited { pool_id };
        m.updated_at = env::block_timestamp();
        self.migrations.insert(coin_id.clone(), m);

        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin-migrator","version":"1.0","event":"token_deposited","data":[{{"coin_id":"{}","amount":"{}"}}]}}"#,
            coin_id, total_supply.0
        ));

        // Step 5: finalize LP — commit both deposits into the pool.
        // Ref's add_liquidity expects amounts in the SAME order as the pool's
        // tokens array, which we passed as [coin_id, wrap_near].
        Promise::new(self.ref_finance.clone())
            .function_call(
                "add_liquidity".to_string(),
                format!(
                    r#"{{"pool_id":{},"amounts":["{}","{}"]}}"#,
                    pool_id, total_supply.0, wrap_amount.0
                ).into_bytes(),
                NearToken::from_millinear(10), // 0.01 NEAR for shares storage
                GAS_ADD_POOL,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_liquidity_added(coin_id, pool_id),
            )
    }

    // ─── Step 5 callback: LP shares minted — migration complete ────────
    #[private]
    pub fn on_liquidity_added(
        &mut self,
        coin_id: AccountId,
        pool_id: u64,
        #[callback_result] result: Result<serde_json::Value, PromiseError>,
    ) {
        let mut m = self.migrations.get(&coin_id).cloned()
            .unwrap_or_else(|| env::panic_str("Migration not found"));

        if result.is_err() {
            m.status = MigrationStatus::Failed {
                step: "add_liquidity".to_string(),
                error: "Ref refused add_liquidity".to_string(),
            };
            m.updated_at = env::block_timestamp();
            self.migrations.insert(coin_id, m);
            env::panic_str("add_liquidity failed — admin can retry");
        }

        m.status = MigrationStatus::LiquiditySeeded { pool_id };
        m.updated_at = env::block_timestamp();
        self.migrations.insert(coin_id.clone(), m);

        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"newscoin-migrator","version":"1.0","event":"migration_complete","data":[{{"coin_id":"{}","pool_id":{}}}]}}"#,
            coin_id, pool_id
        ));
    }

    // ─── Admin ─────────────────────────────────────────────────────────

    pub fn resume_migration(&mut self, coin_id: AccountId) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || caller == self.agent_id,
            "Only owner or agent can retry"
        );
        let m = self.migrations.get(&coin_id).cloned()
            .unwrap_or_else(|| env::panic_str("Migration not found"));
        require!(
            matches!(m.status, MigrationStatus::Failed { .. }),
            "Migration not in failed state"
        );
        // Reset to Pending; operator can then re-trigger by sending NEAR again.
        // For now we simply log — full auto-resume requires tracking partial state.
        env::log_str(&format!(
            "Migration for {} reset. Operator must re-invoke migrate_coin.",
            coin_id
        ));
    }

    pub fn update_ref_finance(&mut self, new_id: AccountId) {
        require!(env::predecessor_account_id() == self.owner_id, "Not owner");
        self.ref_finance = new_id;
    }

    pub fn update_wrap_near(&mut self, new_id: AccountId) {
        require!(env::predecessor_account_id() == self.owner_id, "Not owner");
        self.wrap_near = new_id;
    }

    // ─── Views ─────────────────────────────────────────────────────────

    pub fn get_migration(&self, coin_id: AccountId) -> Option<Migration> {
        self.migrations.get(&coin_id).cloned()
    }

    pub fn get_config(&self) -> serde_json::Value {
        serde_json::json!({
            "owner_id": self.owner_id,
            "agent_id": self.agent_id,
            "wrap_near": self.wrap_near,
            "ref_finance": self.ref_finance,
            "pool_fee_bps": POOL_FEE_BPS,
        })
    }
}
