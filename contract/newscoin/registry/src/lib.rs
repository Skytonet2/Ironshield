use near_sdk::{near, env, AccountId, PanicOnDefault, BorshStorageKey};
use near_sdk::store::UnorderedMap;
use near_sdk::json_types::U128;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Coins,
    StoryCoins,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct CoinIndex {
    pub story_id: String,
    pub coin_address: AccountId,
    pub creator: AccountId,
    pub name: String,
    pub ticker: String,
    pub mcap: u128,
    pub volume_24h: u128,
    pub trade_count: u64,
    pub created_at: u64,
    pub last_trade_at: u64,
    pub graduated: bool,
    pub killed: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NewsCoinRegistry {
    owner_id: AccountId,
    factory_id: AccountId,
    agent_id: AccountId,
    coins: UnorderedMap<AccountId, CoinIndex>,
    story_coins: UnorderedMap<String, Vec<AccountId>>,
    total_volume: u128,
}

#[near]
impl NewsCoinRegistry {
    #[init]
    pub fn new(owner_id: AccountId, factory_id: AccountId, agent_id: AccountId) -> Self {
        Self {
            owner_id,
            factory_id,
            agent_id,
            coins: UnorderedMap::new(StorageKey::Coins),
            story_coins: UnorderedMap::new(StorageKey::StoryCoins),
            total_volume: 0,
        }
    }

    // ─── Mutations (restricted) ─────────────────────────────────────

    /// Called by the factory when a new coin is created.
    pub fn register_coin(
        &mut self,
        story_id: String,
        coin_address: AccountId,
        creator: AccountId,
        name: String,
        ticker: String,
    ) {
        self.assert_factory_or_owner();

        assert!(
            self.coins.get(&coin_address).is_none(),
            "Coin already registered"
        );

        let index = CoinIndex {
            story_id: story_id.clone(),
            coin_address: coin_address.clone(),
            creator,
            name,
            ticker,
            mcap: 0,
            volume_24h: 0,
            trade_count: 0,
            created_at: env::block_timestamp(),
            last_trade_at: 0,
            graduated: false,
            killed: false,
        };
        self.coins.insert(coin_address.clone(), index);

        let mut addrs = self.story_coins.get(&story_id).cloned().unwrap_or_default();
        addrs.push(coin_address);
        self.story_coins.insert(story_id, addrs);
    }

    /// Update stats for a coin. Called by factory, agent, or the coin contract itself.
    pub fn update_coin_stats(
        &mut self,
        coin_address: AccountId,
        mcap: U128,
        volume_24h: U128,
        trade_count: u64,
        last_trade_at: u64,
        graduated: bool,
        killed: bool,
    ) {
        self.assert_factory_or_agent_or_owner();

        let entry = self
            .coins
            .get_mut(&coin_address)
            .unwrap_or_else(|| env::panic_str("Coin not found"));

        // Track volume delta for total
        if volume_24h.0 > entry.volume_24h {
            self.total_volume += volume_24h.0 - entry.volume_24h;
        }

        entry.mcap = mcap.0;
        entry.volume_24h = volume_24h.0;
        entry.trade_count = trade_count;
        entry.last_trade_at = last_trade_at;
        entry.graduated = graduated;
        entry.killed = killed;
    }

    pub fn update_factory(&mut self, factory_id: AccountId) {
        self.assert_owner();
        self.factory_id = factory_id;
    }

    pub fn update_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        self.agent_id = agent_id;
    }

    // ─── Views ──────────────────────────────────────────────────────

    /// Get coins with optional filter. Returns paginated results.
    /// filter: "trending" (by volume_24h), "new" (by created_at desc), "top" (by mcap), "all"
    pub fn get_coins(
        &self,
        filter: Option<String>,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<CoinIndex> {
        let start = from_index.unwrap_or(0) as usize;
        let lim = limit.unwrap_or(50).min(100) as usize;
        let filter_str = filter.unwrap_or_else(|| "all".to_string());

        let mut entries: Vec<CoinIndex> = self.coins.values().cloned().collect();

        // Filter out killed coins unless explicitly showing all
        match filter_str.as_str() {
            "trending" => {
                entries.retain(|c| !c.killed);
                entries.sort_by(|a, b| b.volume_24h.cmp(&a.volume_24h));
            }
            "new" => {
                entries.retain(|c| !c.killed);
                entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            }
            "top" => {
                entries.retain(|c| !c.killed);
                entries.sort_by(|a, b| b.mcap.cmp(&a.mcap));
            }
            _ => {
                entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            }
        }

        if start >= entries.len() {
            return vec![];
        }
        let end = (start + lim).min(entries.len());
        entries[start..end].to_vec()
    }

    pub fn get_coin(&self, coin_address: AccountId) -> Option<CoinIndex> {
        self.coins.get(&coin_address).cloned()
    }

    pub fn get_coins_by_story(&self, story_id: String) -> Vec<CoinIndex> {
        let addrs = self.story_coins.get(&story_id).cloned().unwrap_or_default();
        addrs
            .iter()
            .filter_map(|addr| self.coins.get(addr).cloned())
            .collect()
    }

    pub fn get_total_coins(&self) -> u32 {
        self.coins.len()
    }

    pub fn get_total_volume(&self) -> U128 {
        U128(self.total_volume)
    }

    // ─── Internal ───────────────────────────────────────────────────

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Only owner can call this method"
        );
    }

    fn assert_factory_or_owner(&self) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.factory_id || caller == self.owner_id,
            "Only factory or owner can call this method"
        );
    }

    fn assert_factory_or_agent_or_owner(&self) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.factory_id || caller == self.agent_id || caller == self.owner_id,
            "Only factory, agent, or owner can call this method"
        );
    }
}
