use crate::*;
use near_sdk::json_types::U128;

// Voting period gated by the `testnet-fast` Cargo feature. Default
// (mainnet builds) is 72 hours. Testnet sandbox builds compile a 60-
// second window so the Day-4.3 dry run completes in a single sitting
// instead of waiting three days. NEVER enable testnet-fast on mainnet.
#[cfg(feature = "testnet-fast")]
const VOTING_PERIOD_NS: u64 = 60 * 1_000_000_000; // 60 seconds (testnet only)

#[cfg(not(feature = "testnet-fast"))]
const VOTING_PERIOD_NS: u64 = 72 * 60 * 60 * 1_000_000_000; // 72 hours

#[near]
impl StakingContract {
    /// Create a new governance proposal. Requires staked tokens — UNLESS the
    /// caller is the configured `orchestrator_id` (the autonomous agent), in
    /// which case it may file proposals on behalf of the DAO without holding
    /// stake itself. Holders still vote normally.
    pub fn create_proposal(
        &mut self,
        title: String,
        description: String,
        proposal_type: String,
        content: String,
    ) {
        assert!(!self.paused, "Contract is paused");
        let proposer = env::predecessor_account_id();

        // The orchestrator (autonomous agent) is allowed to propose without stake.
        // Everyone else must have staked tokens in at least one pool.
        let is_orchestrator = proposer == self.orchestrator_id;
        if !is_orchestrator {
            let has_stake = (0..self.pools.len()).any(|pid| {
                let key = get_user_key(&proposer, pid);
                self.user_info.get(&key).map_or(false, |u| u.amount > 0)
            });
            assert!(has_stake, "Must have staked tokens to create a proposal");
        }

        assert!(
            ["Mission", "PromptUpdate", "RuleChange"].contains(&proposal_type.as_str()),
            "Invalid proposal type"
        );

        let now = env::block_timestamp();
        let id = self.proposals.len();

        let proposal = Proposal {
            id,
            title,
            description,
            proposal_type,
            proposer,
            content,
            votes_for: 0,
            votes_against: 0,
            status: "active".to_string(),
            passed: false,
            executed: false,
            created_at: now,
            expires_at: now + VOTING_PERIOD_NS,
        };

        self.proposals.push(proposal);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"proposal_created\",\"data\":{{\"id\":{}}}}}",
            id
        ));
    }

    /// Vote on a proposal. Voting power = total staked across all pools.
    pub fn vote(&mut self, proposal_id: u32, vote: String) {
        assert!(!self.paused, "Contract is paused");
        assert!(vote == "for" || vote == "against", "Vote must be 'for' or 'against'");

        let voter = env::predecessor_account_id();
        let vote_key = format!("{}:{}", proposal_id, voter);

        assert!(self.votes.get(&vote_key).is_none(), "Already voted on this proposal");

        let mut proposal = self.proposals.get(proposal_id).expect("Proposal not found").clone();
        assert!(proposal.status == "active", "Proposal is not active");
        assert!(env::block_timestamp() <= proposal.expires_at, "Voting period has ended");

        // Voting power source depends on pretoken_mode:
        //   on  → vanguard = 2, contributor = 1, otherwise 0 (NFT/contributor governance)
        //   off → sum of staked tokens across all pools (token governance)
        // Bug fix: the `vote()` body previously hardcoded the stake path even
        // when pretoken_mode was true, despite pretoken.rs's get_pretoken_power
        // being documented as "used by vote() when pretoken_mode == true".
        // That mismatch is why no PromptUpdate has ever passed on mainnet.
        let power: u128 = if self.pretoken_mode {
            self.get_pretoken_power(voter.clone()) as u128
        } else {
            (0..self.pools.len())
                .map(|pid| {
                    let key = get_user_key(&voter, pid);
                    self.user_info.get(&key).map_or(0, |u| u.amount)
                })
                .sum()
        };
        assert!(power > 0, "No voting power (need stake or contributor/vanguard status)");

        if vote == "for" {
            proposal.votes_for += power;
        } else {
            proposal.votes_against += power;
        }

        self.votes.insert(vote_key, vote);
        self.proposals.replace(proposal_id, proposal);
    }

    /// Finalize a proposal after voting period ends
    pub fn finalize_proposal(&mut self, proposal_id: u32) {
        let mut proposal = self.proposals.get(proposal_id).expect("Proposal not found").clone();
        assert!(proposal.status == "active", "Proposal already finalized");
        assert!(
            env::block_timestamp() > proposal.expires_at,
            "Voting period has not ended yet"
        );

        proposal.passed = proposal.votes_for > proposal.votes_against;
        proposal.status = if proposal.passed { "passed".to_string() } else { "rejected".to_string() };

        self.proposals.replace(proposal_id, proposal);
    }

    /// Execute a passed proposal (emits event for governance listener)
    pub fn execute_proposal(&mut self, proposal_id: u32) {
        let mut proposal = self.proposals.get(proposal_id).expect("Proposal not found").clone();
        assert!(proposal.status == "passed", "Proposal must be passed to execute");
        assert!(!proposal.executed, "Already executed");

        proposal.executed = true;
        proposal.status = "executed".to_string();

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"proposal_executed\",\"data\":{{\"id\":{},\"type\":\"{}\",\"title\":\"{}\"}}}}",
            proposal.id, proposal.proposal_type, proposal.title
        ));

        self.proposals.replace(proposal_id, proposal);
    }

    /// View: Get all proposals
    pub fn get_proposals(&self) -> Vec<Proposal> {
        (0..self.proposals.len())
            .filter_map(|i| self.proposals.get(i).cloned())
            .collect()
    }

    /// View: Get a single proposal
    pub fn get_proposal(&self, proposal_id: u32) -> Option<Proposal> {
        self.proposals.get(proposal_id).cloned()
    }

    /// View: Check if an account has voted on a proposal
    pub fn get_vote(&self, proposal_id: u32, account_id: AccountId) -> Option<String> {
        let key = format!("{}:{}", proposal_id, account_id);
        self.votes.get(&key).cloned()
    }

    /// View: Get voting power for an account (sum of staked across all pools)
    pub fn get_voting_power(&self, account_id: AccountId) -> U128 {
        let power: u128 = (0..self.pools.len())
            .map(|pid| {
                let key = get_user_key(&account_id, pid);
                self.user_info.get(&key).map_or(0, |u| u.amount)
            })
            .sum();
        U128(power)
    }
}
