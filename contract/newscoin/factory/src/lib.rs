use near_sdk::{near, env, AccountId, NearToken, PanicOnDefault, Promise, Gas, BorshStorageKey};
use near_sdk::store::{UnorderedMap, Vector};
use near_sdk::json_types::{U128, Base64VecU8};
use near_sdk::serde::{Deserialize, Serialize};

/// 2 NEAR creation fee
const DEFAULT_CREATION_FEE: u128 = 2_000_000_000_000_000_000_000_000;
/// Max coins per story
const MAX_COINS_PER_STORY: usize = 3;
/// Gas for deploying a sub-account
const GAS_FOR_DEPLOY: Gas = Gas::from_tgas(100);
/// Gas for registry call
const GAS_FOR_REGISTRY: Gas = Gas::from_tgas(20);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    StoryCoins,
    AllCoins,
    FeeWaived,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct CoinInfo {
    pub story_id: String,
    pub coin_address: AccountId,
    pub name: String,
    pub ticker: String,
    pub creator: AccountId,
    pub created_at: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NewsCoinFactory {
    owner_id: AccountId,
    revenue_wallet: AccountId,
    agent_id: AccountId,
    registry_id: AccountId,
    rhea_router: AccountId,
    story_coins: UnorderedMap<String, Vec<AccountId>>,
    all_coins: Vector<CoinInfo>,
    creation_fee: u128,
    coin_counter: u64,
    /// The compiled WASM of the curve contract, stored on-chain for deployment.
    curve_wasm: Vec<u8>,
    /// Accounts that can create coins without paying the creation_fee.
    fee_waived: near_sdk::store::LookupSet<AccountId>,
}

#[near]
impl NewsCoinFactory {
    #[init]
    pub fn new(
        owner_id: AccountId,
        revenue_wallet: AccountId,
        agent_id: AccountId,
        registry_id: AccountId,
        rhea_router: AccountId,
    ) -> Self {
        Self {
            owner_id,
            revenue_wallet,
            agent_id,
            registry_id,
            rhea_router,
            story_coins: UnorderedMap::new(StorageKey::StoryCoins),
            all_coins: Vector::new(StorageKey::AllCoins),
            creation_fee: DEFAULT_CREATION_FEE,
            coin_counter: 0,
            curve_wasm: Vec::new(),
            fee_waived: near_sdk::store::LookupSet::new(StorageKey::FeeWaived),
        }
    }

    /// Migration from v0 (pre-waiver) state. Call once after redeploy.
    /// Reads the old struct without the fee_waived field and adds an empty set.
    #[private]
    #[init(ignore_state)]
    pub fn migrate_v1() -> Self {
        #[derive(near_sdk::borsh::BorshDeserialize)]
        #[borsh(crate = "near_sdk::borsh")]
        struct OldFactory {
            owner_id: AccountId,
            revenue_wallet: AccountId,
            agent_id: AccountId,
            registry_id: AccountId,
            rhea_router: AccountId,
            story_coins: UnorderedMap<String, Vec<AccountId>>,
            all_coins: Vector<CoinInfo>,
            creation_fee: u128,
            coin_counter: u64,
            curve_wasm: Vec<u8>,
        }
        let old: OldFactory = env::state_read().expect("No old state");
        Self {
            owner_id: old.owner_id,
            revenue_wallet: old.revenue_wallet,
            agent_id: old.agent_id,
            registry_id: old.registry_id,
            rhea_router: old.rhea_router,
            story_coins: old.story_coins,
            all_coins: old.all_coins,
            creation_fee: old.creation_fee,
            coin_counter: old.coin_counter,
            curve_wasm: old.curve_wasm,
            fee_waived: near_sdk::store::LookupSet::new(StorageKey::FeeWaived),
        }
    }

    /// Add an account to the fee-waived list. Owner only.
    pub fn add_fee_waived(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.fee_waived.insert(account_id);
    }

    pub fn remove_fee_waived(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.fee_waived.remove(&account_id);
    }

    pub fn is_fee_waived(&self, account_id: AccountId) -> bool {
        self.fee_waived.contains(&account_id)
    }

    // ─── Admin ──────────────────────────────────────────────────────

    /// Upload the curve contract WASM. Owner only. Call once after factory deploy.
    pub fn store_curve_wasm(&mut self, wasm: Base64VecU8) {
        self.assert_owner();
        let bytes: Vec<u8> = wasm.into();
        assert!(!bytes.is_empty(), "WASM must not be empty");
        let len = bytes.len();
        self.curve_wasm = bytes;
        env::log_str(&format!("Curve WASM stored ({} bytes)", len));
    }

    pub fn update_revenue_wallet(&mut self, new_wallet: AccountId) {
        self.assert_owner();
        self.revenue_wallet = new_wallet;
    }

    pub fn update_agent(&mut self, new_agent: AccountId) {
        self.assert_owner();
        self.agent_id = new_agent;
    }

    pub fn update_creation_fee(&mut self, fee: U128) {
        self.assert_owner();
        self.creation_fee = fee.0;
    }

    pub fn update_registry(&mut self, registry_id: AccountId) {
        self.assert_owner();
        self.registry_id = registry_id;
    }

    pub fn update_rhea_router(&mut self, rhea_router: AccountId) {
        self.assert_owner();
        self.rhea_router = rhea_router;
    }

    /// Remove an orphan coin entry (sub-account never successfully deployed).
    /// Owner only. Takes the index in `all_coins` and scrubs it from both
    /// `all_coins` and `story_coins[story_id]`.
    pub fn admin_remove_orphan_coin(&mut self, index: u32, story_id: String) {
        self.assert_owner();
        let len = self.all_coins.len();
        assert!(index < len, "index out of bounds");
        // Swap-remove in Vector to drop the entry.
        let ci = self.all_coins.get(index).unwrap().clone();
        self.all_coins.swap_remove(index);
        // Remove the coin_address from the story's vector.
        if let Some(mut addrs) = self.story_coins.get(&story_id).cloned() {
            addrs.retain(|a| a != &ci.coin_address);
            if addrs.is_empty() {
                self.story_coins.remove(&story_id);
            } else {
                self.story_coins.insert(story_id, addrs);
            }
        }
        env::log_str(&format!("Orphan coin removed: {}", ci.coin_address));
    }

    // ─── Create ─────────────────────────────────────────────────────

    #[payable]
    pub fn create_coin(
        &mut self,
        story_id: String,
        name: String,
        ticker: String,
        headline: String,
    ) -> Promise {
        let caller = env::predecessor_account_id();
        let is_waived = self.fee_waived.contains(&caller);
        let deposit = env::attached_deposit();
        if !is_waived {
            assert!(
                deposit.as_yoctonear() >= self.creation_fee,
                "Attached deposit must be at least {} yoctoNEAR",
                self.creation_fee
            );
        }
        assert!(!story_id.is_empty(), "story_id must not be empty");
        assert!(!name.is_empty(), "name must not be empty");
        assert!(ticker.len() >= 2 && ticker.len() <= 10, "ticker must be 2-10 chars");
        assert!(!self.curve_wasm.is_empty(), "Curve WASM not stored yet");

        // Check max 3 coins per story
        let existing = self.story_coins.get(&story_id);
        let count = existing.map_or(0, |v| v.len());
        assert!(
            count < MAX_COINS_PER_STORY,
            "Story already has {} coins (max {})",
            count,
            MAX_COINS_PER_STORY
        );

        let creator = caller.clone();
        let coin_index = self.coin_counter;
        self.coin_counter += 1;

        // Sub-account: coin0.factory.near, coin1.factory.near, etc.
        let sub_account_str = format!("coin{}.{}", coin_index, env::current_account_id());
        let coin_address: AccountId = sub_account_str
            .parse()
            .unwrap_or_else(|_| env::panic_str("Invalid sub-account"));

        // Record locally
        let coin_info = CoinInfo {
            story_id: story_id.clone(),
            coin_address: coin_address.clone(),
            name: name.clone(),
            ticker: ticker.clone(),
            creator: creator.clone(),
            created_at: env::block_timestamp(),
        };
        self.all_coins.push(coin_info);

        let mut addrs = self.story_coins.get(&story_id).cloned().unwrap_or_default();
        addrs.push(coin_address.clone());
        self.story_coins.insert(story_id.clone(), addrs);

        // Init args for the curve contract
        let init_args = near_sdk::serde_json::json!({
            "owner_id": env::current_account_id(),
            "creator": creator,
            "agent_id": self.agent_id,
            "revenue_wallet": self.revenue_wallet,
            "rhea_router": self.rhea_router,
            "registry_id": self.registry_id,
            "name": name,
            "ticker": ticker,
            "story_id": story_id,
        })
        .to_string()
        .into_bytes();

        // Emit event
        let event = near_sdk::serde_json::json!({
            "standard": "newscoin",
            "version": "1.0",
            "event": "coin_created",
            "data": [{
                "story_id": story_id,
                "coin_address": coin_address,
                "name": name,
                "ticker": ticker,
                "creator": creator,
                "headline": headline,
            }]
        });
        env::log_str(&format!("EVENT_JSON:{}", event));

        // 1. Deploy curve contract to sub-account
        // 2. Send creation_fee to revenue_wallet
        // 3. Call registry to index
        //
        // The curve WASM is ~280KB; NEAR requires ~1 NEAR per 100KB of state,
        // so the sub-account needs ~2.8 NEAR locked for storage + a little
        // headroom for runtime state. 3 NEAR is safe.
        let deploy_deposit = NearToken::from_near(3);
        let fee_amount = NearToken::from_yoctonear(if is_waived { 0 } else { self.creation_fee });

        let registry_args = near_sdk::serde_json::json!({
            "story_id": story_id,
            "coin_address": coin_address,
            "creator": creator,
            "name": name,
            "ticker": ticker,
        })
        .to_string()
        .into_bytes();

        Promise::new(coin_address.clone())
            .create_account()
            .transfer(deploy_deposit)
            .deploy_contract(self.curve_wasm.clone())
            .function_call("new".to_string(), init_args, NearToken::from_yoctonear(0), GAS_FOR_DEPLOY)
            .then(
                Promise::new(self.revenue_wallet.clone()).transfer(fee_amount),
            )
            .then(
                Promise::new(self.registry_id.clone()).function_call(
                    "register_coin".to_string(),
                    registry_args,
                    NearToken::from_yoctonear(0),
                    GAS_FOR_REGISTRY,
                ),
            )
    }

    // ─── Views ──────────────────────────────────────────────────────

    pub fn get_coins_for_story(&self, story_id: String) -> Vec<AccountId> {
        self.story_coins.get(&story_id).cloned().unwrap_or_default()
    }

    pub fn get_all_coins(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<CoinInfo> {
        let start = from_index.unwrap_or(0) as usize;
        let lim = limit.unwrap_or(50).min(100) as usize;
        let len = self.all_coins.len() as usize;
        if start >= len {
            return vec![];
        }
        let end = (start + lim).min(len);
        (start..end)
            .map(|i| self.all_coins.get(i as u32).unwrap().clone())
            .collect()
    }

    pub fn get_coin_count(&self) -> u32 {
        self.all_coins.len()
    }

    pub fn get_creation_fee(&self) -> U128 {
        U128(self.creation_fee)
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    // ─── Internal ───────────────────────────────────────────────────

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Only owner can call this method"
        );
    }
}
