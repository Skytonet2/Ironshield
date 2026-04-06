// contract/src/governance.rs
// Add this as a module in your existing contract.
// In lib.rs add: pub mod governance;
// and add GovernanceState fields to your main contract struct.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near_bindgen, AccountId, NearToken};
use near_sdk::collections::UnorderedMap;

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub enum ProposalType {
    Mission,
    PromptUpdate,
    RuleChange,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct Proposal {
    pub id:              u64,
    pub proposer:        AccountId,
    pub proposal_type:   String,
    pub title:           String,
    pub content:         String,
    pub votes_for:       u128,
    pub votes_against:   u128,
    pub start_timestamp: u64,
    pub end_timestamp:   u64,
    pub executed:        bool,
    pub passed:          bool,
}

// ── Add these fields to your main Contract struct ──────────────
//
// proposals:       Vector<Proposal>
// proposal_count:  u64
// user_votes:      UnorderedMap<String, bool>  // key = "proposal_id:account_id"
//
// ── Add these methods to your #[near_bindgen] impl Contract ───

impl Contract {

    // ── VIEW: get all proposals ─────────────────────────────────
    pub fn get_proposals(&self) -> Vec<Proposal> {
        self.proposals.to_vec()
    }

    // ── VIEW: get single proposal ───────────────────────────────
    pub fn get_proposal(&self, id: u64) -> Option<Proposal> {
        self.proposals.iter().find(|p| p.id == id)
    }

    // ── VIEW: get user's vote on a proposal ─────────────────────
    pub fn get_user_vote(
        &self,
        proposal_id: u64,
        account_id:  AccountId,
    ) -> Option<bool> {
        let key = format!("{}:{}", proposal_id, account_id);
        self.user_votes.get(&key)
    }

    // ── CALL: create a proposal ─────────────────────────────────
    pub fn create_proposal(
        &mut self,
        proposal_type: String,
        title:         String,
        content:       String,
    ) {
        let proposer = env::predecessor_account_id();

        // Require minimum 1000 IRONCLAW staked
        let user = self.get_user(0, proposer.clone());
        let staked = user.map(|u| u.amount).unwrap_or(0);
        assert!(
            staked >= 1_000 * 10u128.pow(24),
            "Need at least 1000 staked IRONCLAW to propose"
        );

        let now = env::block_timestamp();
        let proposal = Proposal {
            id:              self.proposal_count,
            proposer:        proposer.clone(),
            proposal_type,
            title,
            content,
            votes_for:       0,
            votes_against:   0,
            start_timestamp: now,
            end_timestamp:   now + 72 * 3_600 * 1_000_000_000, // 72h in nanoseconds
            executed:        false,
            passed:          false,
        };

        self.proposals.push(&proposal);
        self.proposal_count += 1;

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"proposal_created\",\"data\":{{\"id\":{},\"title\":\"{}\"}}}}",
            proposal.id, proposal.title
        ));
    }

    // ── CALL: vote on a proposal ────────────────────────────────
    pub fn vote(&mut self, proposal_id: u64, vote_for: bool) {
        let voter = env::predecessor_account_id();
        let key   = format!("{}:{}", proposal_id, voter);

        assert!(
            self.user_votes.get(&key).is_none(),
            "Already voted on this proposal"
        );

        let mut proposal = self
            .proposals
            .iter()
            .find(|p| p.id == proposal_id)
            .expect("Proposal not found");

        assert!(
            env::block_timestamp() < proposal.end_timestamp,
            "Voting period has ended"
        );

        // Voting power = staked amount
        let user   = self.get_user(0, voter.clone());
        let power  = user.map(|u| u.amount).unwrap_or(0);
        assert!(power > 0, "No staked tokens — no voting power");

        if vote_for {
            proposal.votes_for += power;
        } else {
            proposal.votes_against += power;
        }

        // Update proposal in vector
        let idx = self.proposals.iter().position(|p| p.id == proposal_id).unwrap();
        self.proposals.replace(idx as u64, &proposal);

        // Record vote
        self.user_votes.insert(&key, &vote_for);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"voted\",\"data\":{{\"proposal_id\":{},\"voter\":\"{}\",\"vote_for\":{}}}}}",
            proposal_id, voter, vote_for
        ));
    }

    // ── CALL: execute a passed proposal ─────────────────────────
    pub fn execute_proposal(&mut self, proposal_id: u64) {
        let mut proposal = self
            .proposals
            .iter()
            .find(|p| p.id == proposal_id)
            .expect("Proposal not found");

        assert!(
            env::block_timestamp() >= proposal.end_timestamp,
            "Voting period not ended yet"
        );
        assert!(!proposal.executed, "Already executed");

        let passed = proposal.votes_for > proposal.votes_against;
        proposal.executed = true;
        proposal.passed   = passed;

        let idx = self.proposals.iter().position(|p| p.id == proposal_id).unwrap();
        self.proposals.replace(idx as u64, &proposal);

        // Emit event — IronClaw backend listener reads this
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"proposal_executed\",\"data\":{{\"id\":{},\"type\":\"{}\",\"content\":\"{}\",\"passed\":{}}}}}",
            proposal.id,
            proposal.proposal_type,
            proposal.content.replace('"', "\\\""),
            passed
        ));
    }
}
