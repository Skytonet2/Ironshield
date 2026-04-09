use crate::*;
use near_sdk::json_types::U128;

const VOTING_PERIOD_NS: u64 = 72 * 60 * 60 * 1_000_000_000; // 72 hours in nanoseconds

#[near]
impl StakingContract {
    /// Create a new governance proposal.
    /// - Pre-token mode: any approved contributor or verified vanguard may propose.
    /// - Post-token mode: must have staked $IRONCLAW in at least one pool.
    pub fn create_proposal(
        &mut self,
        title: String,
        description: String,
        proposal_type: String,
        content: String,
    ) {
        assert!(!self.paused, "Contract is paused");
        let proposer = env::predecessor_account_id();

        if self.pretoken_mode {
            let allowed = self.contributors.contains_key(&proposer)
                       || self.vanguard_verified.contains(&proposer);
            assert!(allowed, "Pre-token mode: only approved contributors or verified vanguards may propose");
        } else {
            // Proposer must have staked tokens in at least one pool
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

        // Voting power depends on the mode.
        //   pretoken_mode == true  → vanguard = 2, contributor = 1, else 0
        //   pretoken_mode == false → sum of staked $IRONCLAW across all pools
        let power: u128 = if self.pretoken_mode {
            if self.vanguard_verified.contains(&voter) {
                2
            } else if self.contributors.contains_key(&voter) {
                1
            } else {
                0
            }
        } else {
            (0..self.pools.len())
                .map(|pid| {
                    let key = get_user_key(&voter, pid);
                    self.user_info.get(&key).map_or(0, |u| u.amount)
                })
                .sum()
        };
        assert!(
            power > 0,
            "No voting power. Pre-token mode: become a contributor or vanguard. Post-token: stake $IRONCLAW."
        );

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
