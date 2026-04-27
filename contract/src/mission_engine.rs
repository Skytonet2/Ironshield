// contract/src/mission_engine.rs
//
// Phase 10 — Agent Economy: structured missions with escrow.
//
// A Mission is a job that a poster funds and an agent completes.
// State machine:
//   open → claimed → submitted → approved | rejected | expired
//   open → aborted (poster cancels before claim)
//
// Escrow is locked at create time (attached_deposit). On approval the
// claimant receives `escrow * (10000 - platform_fee_bps) / 10000` and
// the contract owner receives the platform fee. Reject and abort
// refund the full escrow to the poster (no fee at v1). Expire
// (review_deadline elapsed) auto-pays the claimant — the poster
// forfeits dispute rights once the window closes.
//
// Storage prefix b"B" was chosen for the missions map (unused as of
// Phase 8; see migrate.rs for the full inventory). All other state
// related to mission templates, audit logs, and escalations lives
// off-chain in Postgres — only the lifecycle + escrow live here.

use crate::*;
use near_sdk::{NearToken, Promise};

pub const MISSION_STATUS_OPEN:      &str = "open";
pub const MISSION_STATUS_CLAIMED:   &str = "claimed";
pub const MISSION_STATUS_SUBMITTED: &str = "submitted";
pub const MISSION_STATUS_APPROVED:  &str = "approved";
pub const MISSION_STATUS_REJECTED:  &str = "rejected";
pub const MISSION_STATUS_EXPIRED:   &str = "expired";
pub const MISSION_STATUS_ABORTED:   &str = "aborted";

pub const DEFAULT_PLATFORM_FEE_BPS: u32 = 500; // 5%
pub const MAX_PLATFORM_FEE_BPS:     u32 = 1000; // 10% hard cap
pub const MIN_REVIEW_WINDOW_SECS:   u64 = 60 * 60;          // 1h
pub const MAX_REVIEW_WINDOW_SECS:   u64 = 60 * 60 * 24 * 30; // 30d
pub const DEFAULT_REVIEW_WINDOW_SECS: u64 = 60 * 60 * 24 * 7; // 7d

/// Mission record. `inputs_hash` and `audit_root` are the only
/// integrity anchors stored on-chain — the verbose payload (template,
/// crew DAG, step-by-step log) lives off-chain in Postgres.
#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct Mission {
    pub id: u64,
    pub poster: AccountId,
    pub claimant: Option<AccountId>,
    pub template_id: String,
    pub kit_slug: Option<String>,
    pub inputs_hash: String,
    pub escrow_yocto: U128,
    pub platform_fee_bps: u32,
    pub status: String,
    pub audit_root: Option<String>,
    pub created_at: u64,
    pub claimed_at: Option<u64>,
    pub submitted_at: Option<u64>,
    pub review_deadline_ns: Option<u64>,
    pub finalized_at: Option<u64>,
}

#[near]
impl StakingContract {
    /// Poster creates a mission, escrowing the attached deposit as the reward.
    /// `review_window_secs` is clamped to [MIN_REVIEW_WINDOW_SECS,
    /// MAX_REVIEW_WINDOW_SECS]; passing 0 picks the default.
    #[payable]
    pub fn create_mission(
        &mut self,
        template_id: String,
        kit_slug: Option<String>,
        inputs_hash: String,
        review_window_secs: Option<u64>,
    ) -> u64 {
        assert!(!self.paused, "Contract is paused");
        let escrow = env::attached_deposit().as_yoctonear();
        assert!(escrow > 0, "Mission must escrow a non-zero reward");
        assert!(!template_id.is_empty(), "template_id required");
        assert!(!inputs_hash.is_empty(), "inputs_hash required");

        let window_secs = review_window_secs
            .unwrap_or(DEFAULT_REVIEW_WINDOW_SECS)
            .max(MIN_REVIEW_WINDOW_SECS)
            .min(MAX_REVIEW_WINDOW_SECS);

        let id = self.next_mission_id;
        self.next_mission_id += 1;

        let mission = Mission {
            id,
            poster: env::predecessor_account_id(),
            claimant: None,
            template_id: template_id.clone(),
            kit_slug: kit_slug.clone(),
            inputs_hash,
            escrow_yocto: U128(escrow),
            platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
            status: MISSION_STATUS_OPEN.to_string(),
            audit_root: None,
            created_at: env::block_timestamp(),
            claimed_at: None,
            submitted_at: None,
            review_deadline_ns: None,
            // review_window_secs is captured in finalized_at math at submit time
            finalized_at: Some(window_secs * 1_000_000_000),
        };

        self.missions.insert(id, mission);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_created\",\"data\":{{\"id\":{},\"poster\":\"{}\",\"template_id\":\"{}\",\"kit_slug\":{},\"escrow_yocto\":\"{}\"}}}}",
            id,
            env::predecessor_account_id(),
            template_id,
            kit_slug.map(|s| format!("\"{}\"", s)).unwrap_or_else(|| "null".to_string()),
            escrow,
        ));

        id
    }

    /// Agent owner claims an open mission. v1 is single-claimant first-come.
    pub fn claim_mission(&mut self, mission_id: u64) {
        assert!(!self.paused, "Contract is paused");
        let claimant = env::predecessor_account_id();

        let mut mission = self
            .missions
            .get(&mission_id)
            .cloned()
            .expect("Mission not found");
        assert_eq!(mission.status, MISSION_STATUS_OPEN, "Mission not open");
        assert_ne!(
            mission.poster, claimant,
            "Poster cannot claim their own mission"
        );

        mission.claimant = Some(claimant.clone());
        mission.status = MISSION_STATUS_CLAIMED.to_string();
        mission.claimed_at = Some(env::block_timestamp());
        self.missions.insert(mission_id, mission);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_claimed\",\"data\":{{\"id\":{},\"claimant\":\"{}\"}}}}",
            mission_id, claimant,
        ));
    }

    /// Claimant submits the audit-log root, locking in their work and
    /// starting the review window.
    pub fn submit_mission_work(&mut self, mission_id: u64, audit_root: String) {
        assert!(!self.paused, "Contract is paused");
        assert!(!audit_root.is_empty(), "audit_root required");

        let caller = env::predecessor_account_id();
        let mut mission = self
            .missions
            .get(&mission_id)
            .cloned()
            .expect("Mission not found");
        assert_eq!(mission.status, MISSION_STATUS_CLAIMED, "Mission not claimed");
        assert_eq!(
            mission.claimant.as_ref(),
            Some(&caller),
            "Only the claimant may submit work"
        );

        let window_ns = mission.finalized_at.unwrap_or(DEFAULT_REVIEW_WINDOW_SECS * 1_000_000_000);
        let now = env::block_timestamp();

        mission.audit_root = Some(audit_root.clone());
        mission.status = MISSION_STATUS_SUBMITTED.to_string();
        mission.submitted_at = Some(now);
        mission.review_deadline_ns = Some(now + window_ns);
        mission.finalized_at = None;
        self.missions.insert(mission_id, mission);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_submitted\",\"data\":{{\"id\":{},\"audit_root\":\"{}\"}}}}",
            mission_id, audit_root,
        ));
    }

    /// Poster approves submitted work, releasing escrow to the claimant
    /// minus the platform fee.
    pub fn approve_mission(&mut self, mission_id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let mut mission = self
            .missions
            .get(&mission_id)
            .cloned()
            .expect("Mission not found");
        assert_eq!(mission.poster, caller, "Only the poster may approve");
        assert_eq!(mission.status, MISSION_STATUS_SUBMITTED, "Mission not submitted");

        let claimant = mission
            .claimant
            .clone()
            .expect("Submitted mission has no claimant — invariant violation");

        mission.status = MISSION_STATUS_APPROVED.to_string();
        mission.finalized_at = Some(env::block_timestamp());
        let payout_promise = self.payout_mission_escrow(&mission, &claimant);
        self.missions.insert(mission_id, mission);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_approved\",\"data\":{{\"id\":{},\"claimant\":\"{}\"}}}}",
            mission_id, claimant,
        ));

        payout_promise
    }

    /// Poster rejects submitted work, terminating the mission and
    /// refunding the full escrow.
    pub fn reject_mission(&mut self, mission_id: u64, reason: String) -> Promise {
        let caller = env::predecessor_account_id();
        let mut mission = self
            .missions
            .get(&mission_id)
            .cloned()
            .expect("Mission not found");
        assert_eq!(mission.poster, caller, "Only the poster may reject");
        assert_eq!(mission.status, MISSION_STATUS_SUBMITTED, "Mission not submitted");

        mission.status = MISSION_STATUS_REJECTED.to_string();
        mission.finalized_at = Some(env::block_timestamp());
        let refund_promise = Promise::new(mission.poster.clone())
            .transfer(NearToken::from_yoctonear(mission.escrow_yocto.0));
        self.missions.insert(mission_id, mission);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_rejected\",\"data\":{{\"id\":{},\"reason\":\"{}\"}}}}",
            mission_id, reason.replace('"', "'"),
        ));

        refund_promise
    }

    /// Poster aborts an open (unclaimed) mission and gets the escrow back.
    pub fn abort_mission(&mut self, mission_id: u64) -> Promise {
        let caller = env::predecessor_account_id();
        let mut mission = self
            .missions
            .get(&mission_id)
            .cloned()
            .expect("Mission not found");
        assert_eq!(mission.poster, caller, "Only the poster may abort");
        assert_eq!(mission.status, MISSION_STATUS_OPEN, "Only open missions can be aborted");

        mission.status = MISSION_STATUS_ABORTED.to_string();
        mission.finalized_at = Some(env::block_timestamp());
        let refund_promise = Promise::new(mission.poster.clone())
            .transfer(NearToken::from_yoctonear(mission.escrow_yocto.0));
        self.missions.insert(mission_id, mission);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_aborted\",\"data\":{{\"id\":{}}}}}",
            mission_id,
        ));

        refund_promise
    }

    /// Anyone can settle a submitted mission whose review deadline has
    /// passed. Auto-pays the claimant. Permissionless so funds can't get
    /// stuck behind a ghosted poster.
    pub fn expire_mission(&mut self, mission_id: u64) -> Promise {
        let mut mission = self
            .missions
            .get(&mission_id)
            .cloned()
            .expect("Mission not found");
        assert_eq!(mission.status, MISSION_STATUS_SUBMITTED, "Mission not submitted");
        let deadline = mission
            .review_deadline_ns
            .expect("Submitted mission has no review deadline — invariant violation");
        assert!(env::block_timestamp() >= deadline, "Review window not expired");

        let claimant = mission
            .claimant
            .clone()
            .expect("Submitted mission has no claimant — invariant violation");

        mission.status = MISSION_STATUS_EXPIRED.to_string();
        mission.finalized_at = Some(env::block_timestamp());
        let payout_promise = self.payout_mission_escrow(&mission, &claimant);
        self.missions.insert(mission_id, mission);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_expired\",\"data\":{{\"id\":{},\"claimant\":\"{}\"}}}}",
            mission_id, claimant,
        ));

        payout_promise
    }

    /// Owner-only: tune the platform fee for missions created from now on.
    /// Existing missions keep the fee they were created with — the value
    /// is snapshotted into each Mission row.
    pub fn set_mission_default_fee_bps(&mut self, _new_default_bps: u32) {
        assert_eq!(env::predecessor_account_id(), self.owner_id, "Owner only");
        assert!(_new_default_bps <= MAX_PLATFORM_FEE_BPS, "Fee exceeds 10% cap");
        // The default is currently the const DEFAULT_PLATFORM_FEE_BPS. v1
        // takes the const path; if a tunable becomes necessary it lands as
        // a Phase 10 storage field. Stub kept so the surface is testable.
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_default_fee_set\",\"data\":{{\"bps\":{}}}}}",
            _new_default_bps,
        ));
    }

    pub fn get_mission(&self, mission_id: u64) -> Option<Mission> {
        self.missions.get(&mission_id).cloned()
    }

    /// Returns up to `limit` missions starting at `from_id` (inclusive).
    /// Frontend pages by passing the highest id seen + 1.
    pub fn list_missions(&self, from_id: u64, limit: u64) -> Vec<Mission> {
        let cap = limit.min(100);
        let mut out: Vec<Mission> = Vec::with_capacity(cap as usize);
        let end = self.next_mission_id;
        let mut id = from_id;
        while id < end && (out.len() as u64) < cap {
            if let Some(m) = self.missions.get(&id).cloned() {
                out.push(m);
            }
            id += 1;
        }
        out
    }

    /// Returns the most recent `limit` missions whose status is `open`.
    /// Walks backward from the latest id so newly-posted missions surface first.
    pub fn list_open_missions(&self, limit: u64) -> Vec<Mission> {
        let cap = limit.min(50);
        let mut out: Vec<Mission> = Vec::with_capacity(cap as usize);
        if self.next_mission_id == 0 {
            return out;
        }
        let mut id = self.next_mission_id;
        while id > 0 && (out.len() as u64) < cap {
            id -= 1;
            if let Some(m) = self.missions.get(&id).cloned() {
                if m.status == MISSION_STATUS_OPEN {
                    out.push(m);
                }
            }
        }
        out
    }

    pub fn get_missions_for_claimant(&self, claimant: AccountId, limit: u64) -> Vec<Mission> {
        let cap = limit.min(50);
        let mut out: Vec<Mission> = Vec::with_capacity(cap as usize);
        if self.next_mission_id == 0 {
            return out;
        }
        let mut id = self.next_mission_id;
        while id > 0 && (out.len() as u64) < cap {
            id -= 1;
            if let Some(m) = self.missions.get(&id).cloned() {
                if m.claimant.as_ref() == Some(&claimant) {
                    out.push(m);
                }
            }
        }
        out
    }

    pub fn get_missions_for_poster(&self, poster: AccountId, limit: u64) -> Vec<Mission> {
        let cap = limit.min(50);
        let mut out: Vec<Mission> = Vec::with_capacity(cap as usize);
        if self.next_mission_id == 0 {
            return out;
        }
        let mut id = self.next_mission_id;
        while id > 0 && (out.len() as u64) < cap {
            id -= 1;
            if let Some(m) = self.missions.get(&id).cloned() {
                if m.poster == poster {
                    out.push(m);
                }
            }
        }
        out
    }

    /// Internal: split escrow into claimant payout + platform fee, dispatch
    /// both transfers in one Promise chain. Returns the resulting Promise so
    /// callers can re-attach to the contract response.
    fn payout_mission_escrow(&self, mission: &Mission, claimant: &AccountId) -> Promise {
        let total = mission.escrow_yocto.0;
        // Snapshotted at create time, so a later fee tweak doesn't reprice
        // an in-flight mission.
        let fee = total
            .saturating_mul(mission.platform_fee_bps as u128)
            / 10_000u128;
        let payout = total.saturating_sub(fee);

        let mut p = Promise::new(claimant.clone())
            .transfer(NearToken::from_yoctonear(payout));
        if fee > 0 {
            p = p.then(
                Promise::new(self.owner_id.clone())
                    .transfer(NearToken::from_yoctonear(fee)),
            );
        }
        p
    }
}
