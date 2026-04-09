use crate::*;
use near_sdk::{ext_contract, Gas, PromiseError};
use near_contract_standards::non_fungible_token::{Token, TokenId};

const GAS_FOR_NFT_TOKEN: Gas       = Gas::from_tgas(5);
const GAS_FOR_VANGUARD_CALLBACK: Gas = Gas::from_tgas(5);

/// Minimal trait for cross-contract `nft_token` calls into NEP-171 contracts
/// (e.g. nearlegion.nfts.tg). We only need ownership, so the standard
/// `Token` type from near-contract-standards is enough.
#[ext_contract(ext_nft_contract)]
pub trait NftContract {
    fn nft_token(&self, token_id: TokenId) -> Option<Token>;
}

#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct ContributorApplication {
    pub account_id:   AccountId,
    pub telegram:     String,
    pub reason:       String,
    pub submitted_at: u64,
}

#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct ContributorInfo {
    pub telegram:     String,
    pub approved_at:  u64,
    pub approved_by:  AccountId,
}

#[near]
impl StakingContract {

    // ── Contributor application flow ─────────────────────────────────

    /// Anyone can apply to be a contributor. The owner approves or rejects.
    /// Application is keyed by `predecessor_account_id()`, so each wallet has
    /// at most one pending or approved entry at a time.
    pub fn request_contributor(&mut self, telegram: String, reason: String) {
        assert!(!self.paused, "Contract is paused");
        let account_id = env::predecessor_account_id();
        assert!(
            !self.contributors.contains_key(&account_id),
            "Already an approved contributor"
        );
        assert!(telegram.len() <= 64, "Telegram handle too long");
        assert!(reason.len()   <= 500, "Reason too long");

        let app = ContributorApplication {
            account_id:   account_id.clone(),
            telegram,
            reason,
            submitted_at: env::block_timestamp(),
        };
        self.pending_applications.insert(account_id, app);
    }

    /// Owner: approve a pending contributor application.
    pub fn approve_contributor(&mut self, account_id: AccountId) {
        self.assert_owner();
        let app = self.pending_applications
            .remove(&account_id)
            .expect("No pending application for this account");
        let info = ContributorInfo {
            telegram:    app.telegram,
            approved_at: env::block_timestamp(),
            approved_by: env::predecessor_account_id(),
        };
        self.contributors.insert(account_id, info);
    }

    /// Owner: reject (delete) a pending contributor application.
    pub fn reject_contributor(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.pending_applications.remove(&account_id);
    }

    /// Owner: revoke an already-approved contributor.
    pub fn revoke_contributor(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.contributors.remove(&account_id);
    }

    // ── Vanguard NFT verification ────────────────────────────────────

    /// Owner: append an NFT contract to the Vanguard whitelist.
    pub fn add_vanguard_nft_contract(&mut self, contract_id: AccountId) {
        self.assert_owner();
        let already = (0..self.vanguard_nft_contracts.len())
            .any(|i| self.vanguard_nft_contracts.get(i).map_or(false, |c| c == &contract_id));
        assert!(!already, "Contract already whitelisted");
        self.vanguard_nft_contracts.push(contract_id);
    }

    /// Owner: replace the Vanguard "top N token IDs" rule.
    /// Default at deploy time is 1000 (top 30% of NEAR Legion's 3,333 supply).
    pub fn set_vanguard_token_id_max(&mut self, max: u64) {
        self.assert_owner();
        assert!(max > 0, "max must be > 0");
        self.vanguard_token_id_max = max;
    }

    /// Anyone can claim Vanguard status by proving they own a Vanguard NFT.
    /// Cross-contract calls `nft_token(token_id)` on the NFT contract; the
    /// callback verifies that `token.owner_id == predecessor` AND that the
    /// token ID is within `[1, vanguard_token_id_max]`.
    pub fn register_vanguard(&mut self, nft_contract: AccountId, token_id: TokenId) -> near_sdk::Promise {
        assert!(!self.paused, "Contract is paused");

        // Whitelist check
        let whitelisted = (0..self.vanguard_nft_contracts.len())
            .any(|i| self.vanguard_nft_contracts.get(i).map_or(false, |c| c == &nft_contract));
        assert!(whitelisted, "NFT contract is not whitelisted as a Vanguard source");

        // Token ID range check (top-N rule). NEAR Legion uses numeric IDs.
        let id_num: u64 = token_id.parse()
            .unwrap_or_else(|_| env::panic_str("Token ID must be numeric for the top-N rule"));
        assert!(id_num >= 1, "Token ID must be >= 1");
        assert!(id_num <= self.vanguard_token_id_max, "Token ID is not in the Vanguard range");

        let claimant = env::predecessor_account_id();

        ext_nft_contract::ext(nft_contract.clone())
            .with_static_gas(GAS_FOR_NFT_TOKEN)
            .nft_token(token_id.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_VANGUARD_CALLBACK)
                    .register_vanguard_callback(claimant, nft_contract, token_id)
            )
    }

    #[private]
    pub fn register_vanguard_callback(
        &mut self,
        claimant:     AccountId,
        nft_contract: AccountId,
        token_id:     TokenId,
        #[callback_result] result: Result<Option<Token>, PromiseError>,
    ) -> bool {
        let token = match result {
            Ok(Some(t)) => t,
            Ok(None)    => return false,
            Err(_)      => return false,
        };
        if token.owner_id != claimant {
            return false;
        }
        // Range and whitelist were already validated in the entry method;
        // ownership is the only thing that can change between call and callback.
        self.vanguard_verified.insert(claimant.clone());
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"vanguard_verified\",\"data\":{{\"account\":\"{}\",\"contract\":\"{}\",\"token_id\":\"{}\"}}}}",
            claimant, nft_contract, token_id
        ));
        true
    }

    /// Owner: revoke a previously-verified vanguard (e.g. they sold the NFT).
    pub fn revoke_vanguard(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.vanguard_verified.remove(&account_id);
    }

    // ── Mode toggle ──────────────────────────────────────────────────

    /// Owner: flip pre-token mode on or off. Off = vote weight = staked tokens.
    pub fn set_pretoken_mode(&mut self, enabled: bool) {
        self.assert_owner();
        self.pretoken_mode = enabled;
    }

    // ── View methods ─────────────────────────────────────────────────

    pub fn get_pretoken_mode(&self) -> bool {
        self.pretoken_mode
    }

    pub fn is_contributor(&self, account_id: AccountId) -> bool {
        self.contributors.contains_key(&account_id)
    }

    pub fn is_vanguard(&self, account_id: AccountId) -> bool {
        self.vanguard_verified.contains(&account_id)
    }

    pub fn get_contributor(&self, account_id: AccountId) -> Option<ContributorInfo> {
        self.contributors.get(&account_id).cloned()
    }

    pub fn get_pending_applications(&self) -> Vec<ContributorApplication> {
        self.pending_applications.values().cloned().collect()
    }

    pub fn get_contributors(&self) -> Vec<(AccountId, ContributorInfo)> {
        self.contributors
            .iter()
            .map(|(k, v): (&AccountId, &ContributorInfo)| (k.clone(), v.clone()))
            .collect()
    }

    pub fn get_vanguard_nft_contracts(&self) -> Vec<AccountId> {
        (0..self.vanguard_nft_contracts.len())
            .filter_map(|i| self.vanguard_nft_contracts.get(i).cloned())
            .collect()
    }

    pub fn get_vanguard_token_id_max(&self) -> u64 {
        self.vanguard_token_id_max
    }

    /// Pretoken voting power lookup. Returns:
    ///   - 2 if vanguard
    ///   - 1 if contributor
    ///   - 0 otherwise
    /// Used by `vote()` when `pretoken_mode == true`.
    pub fn get_pretoken_power(&self, account_id: AccountId) -> u8 {
        if self.vanguard_verified.contains(&account_id) {
            2
        } else if self.contributors.contains_key(&account_id) {
            1
        } else {
            0
        }
    }
}
