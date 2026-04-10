use crate::*;

#[near]
impl StakingContract {
    /// Orchestrator-only: reports the off-chain execution result of a mission.
    ///
    /// Called by the mission orchestrator bot after NEAR AI IronClaw finishes
    /// a task. Stores the result hash + CID + TEE attestation so anyone can
    /// independently verify what the agent actually did.
    ///
    /// Gated to `orchestrator_id` (settable by owner via `set_orchestrator`).
    /// The referenced proposal must:
    ///   - exist
    ///   - be of type "Mission"
    ///   - already be executed (status == "executed")
    ///   - not already have a reported result
    pub fn submit_mission_result(
        &mut self,
        proposal_id: u32,
        result_hash: String,
        result_cid: String,
        attestation: String,
        success: bool,
        session_id: String,
    ) {
        assert_eq!(
            env::predecessor_account_id(),
            self.orchestrator_id,
            "Only the orchestrator can submit mission results"
        );

        let proposal = self
            .proposals
            .get(proposal_id)
            .expect("Proposal not found")
            .clone();

        assert_eq!(
            proposal.proposal_type, "Mission",
            "Only Mission proposals can have results"
        );
        assert!(
            proposal.executed && proposal.status == "executed",
            "Mission proposal must be executed before reporting results"
        );
        assert!(
            self.mission_results.get(&proposal_id).is_none(),
            "Mission result already submitted for this proposal"
        );

        let result = MissionResult {
            proposal_id,
            result_hash: result_hash.clone(),
            result_cid: result_cid.clone(),
            attestation,
            success,
            session_id: session_id.clone(),
            completed_at: env::block_timestamp(),
        };

        self.mission_results.insert(proposal_id, result);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_completed\",\"data\":{{\"proposal_id\":{},\"success\":{},\"result_hash\":\"{}\",\"result_cid\":\"{}\",\"session_id\":\"{}\"}}}}",
            proposal_id, success, result_hash, result_cid, session_id
        ));
    }

    /// Owner: set the authorized orchestrator account.
    pub fn set_orchestrator(&mut self, orchestrator_id: AccountId) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "Only the contract owner can set the orchestrator"
        );
        self.orchestrator_id = orchestrator_id;
    }

    /// View: get the reported off-chain result for a mission, if any.
    pub fn get_mission_result(&self, proposal_id: u32) -> Option<MissionResult> {
        self.mission_results.get(&proposal_id).cloned()
    }

    /// View: all Mission proposals that are passed + executed but still
    /// awaiting an off-chain result report from the orchestrator.
    ///
    /// The orchestrator polls this to find work.
    pub fn get_approved_missions(&self) -> Vec<Proposal> {
        (0..self.proposals.len())
            .filter_map(|i| self.proposals.get(i).cloned())
            .filter(|p| {
                p.proposal_type == "Mission"
                    && p.executed
                    && p.status == "executed"
                    && self.mission_results.get(&p.id).is_none()
            })
            .collect()
    }

    /// View: the currently authorized orchestrator account.
    pub fn get_orchestrator(&self) -> AccountId {
        self.orchestrator_id.clone()
    }
}
