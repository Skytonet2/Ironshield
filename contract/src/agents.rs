use crate::*;
use near_sdk::json_types::U128;

// ── Weekly bucket math ──────────────────────────────────────────────────────
// Weeks run Saturday 21:00 UTC → next Saturday 21:00 UTC so the contract's
// weekly snapshots line up with the 7-week campaign's Sat-9pm payout cadence
// (see EarnPage.jsx `getWeekProgress`). The anchor is the first Sat-9pm after
// Unix epoch that falls on a Saturday — 2020-01-04 21:00:00 UTC.
const WEEK_ANCHOR_NS: u64 = 1_578_171_600_000_000_000;
const NS_PER_WEEK:    u64 = 7 * 24 * 3600 * 1_000_000_000;
const MAX_SNAPSHOTS:  usize = 7;
const MAX_ACTIVITY:   usize = 10;

fn current_week_index() -> u64 {
    env::block_timestamp().saturating_sub(WEEK_ANCHOR_NS) / NS_PER_WEEK
}

/// One row in an agent's recent-activity ring buffer. The `kind` is a short
/// machine tag the frontend maps to an icon + color; `description` is a
/// human-readable blurb the orchestrator or the contract fills in.
#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct ActivityEntry {
    pub kind:        String,
    pub amount:      u128,
    pub description: String,
    pub timestamp:   u64,
}

/// Everything that changes frequently about an agent: weekly snapshots for the
/// sparkline + trend delta, submission counters for the success rate, mission
/// counter, last-active timestamp, and a bounded recent-activity log.
///
/// Kept in a separate UnorderedMap from `AgentProfile` so Phase 4 can ship
/// without rewriting every existing profile — brand-new profiles lazy-create
/// their stats entry on first write.
#[near(serializers=[borsh, json])]
#[derive(Clone, Default)]
pub struct AgentStats {
    pub points_this_week:      u128,
    pub points_last_week:      u128,
    pub weekly_snapshots:      Vec<u128>,
    pub week_index_last_seen:  u64,
    pub submissions_approved:  u32,
    pub submissions_rejected:  u32,
    pub missions_completed:    u32,
    pub last_active:           u64,
    pub activity_log:          Vec<ActivityEntry>,
}

impl AgentStats {
    /// Roll the weekly counters forward if the current week is later than the
    /// last seen week. Idempotent within a week — cheap enough to call on
    /// every mutation.
    fn roll_weekly(&mut self, now: u64) {
        let cur = current_week_index();
        if self.week_index_last_seen == 0 {
            self.week_index_last_seen = cur;
            return;
        }
        if cur <= self.week_index_last_seen { return; }

        // The just-ended week's total becomes the newest snapshot and the
        // "last week" reference. Any fully-skipped weeks in between are
        // backfilled with zeros so the sparkline positions don't drift.
        self.weekly_snapshots.push(self.points_this_week);
        trim_front(&mut self.weekly_snapshots, MAX_SNAPSHOTS);
        self.points_last_week = self.points_this_week;
        self.points_this_week = 0;

        let gap = cur.saturating_sub(self.week_index_last_seen).saturating_sub(1);
        for _ in 0..gap.min(MAX_SNAPSHOTS as u64) {
            self.weekly_snapshots.push(0);
            trim_front(&mut self.weekly_snapshots, MAX_SNAPSHOTS);
        }
        self.week_index_last_seen = cur;
        let _ = now; // silence unused warning when we later remove env::block_timestamp caller
    }

    fn push_activity(&mut self, entry: ActivityEntry) {
        self.activity_log.push(entry);
        trim_front(&mut self.activity_log, MAX_ACTIVITY);
    }
}

fn trim_front<T>(v: &mut Vec<T>, cap: usize) {
    while v.len() > cap { v.remove(0); }
}

/// Public, platform-wide profile for a user's agent. One per owner account.
/// `agent_account` stays `None` until the owner creates and links the scoped
/// sub-wallet (Slice 1C). Points are in platform units — the $IRONCLAW
/// conversion rate is set by governance at token launch, and the full award
/// history is reconstructable from emitted `points_awarded` events.
#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct AgentProfile {
    pub owner: AccountId,
    pub handle: String,
    pub bio: String,
    pub agent_account: Option<AccountId>,
    pub points: u128,
    pub reputation: u32,
    pub created_at: u64,
}

#[near]
impl StakingContract {
    /// Register the caller's agent profile. One-shot: an account can only
    /// register once. Handle is case-insensitively unique across the platform.
    pub fn register_agent(&mut self, handle: String, bio: Option<String>) {
        assert!(!self.paused, "Contract is paused");
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_none(),
            "Agent already registered for this account"
        );

        let trimmed = handle.trim().to_string();
        assert!(
            trimmed.len() >= 3 && trimmed.len() <= 32,
            "Handle must be between 3 and 32 characters"
        );
        assert!(
            trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
            "Handle may only contain letters, digits, '_' and '-'"
        );

        let lower = trimmed.to_ascii_lowercase();
        assert!(
            self.agent_handles.get(&lower).is_none(),
            "Handle already taken"
        );

        let bio_str = bio.unwrap_or_default();
        assert!(bio_str.len() <= 280, "Bio must be ≤280 characters");

        let profile = AgentProfile {
            owner: owner.clone(),
            handle: trimmed.clone(),
            bio: bio_str,
            agent_account: None,
            points: 0,
            reputation: 0,
            created_at: env::block_timestamp(),
        };

        self.agent_profiles.insert(owner.clone(), profile);
        self.agent_handles.insert(lower, owner.clone());

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"agent_registered\",\"data\":{{\"owner\":\"{}\",\"handle\":\"{}\"}}}}",
            owner, trimmed
        ));
    }

    /// Link the agent sub-wallet after the owner creates it. Slice 1C plumbs
    /// the CreateAccount + AddKey batch transaction that ends by calling this.
    /// Re-callable so the owner can rotate the sub-wallet if needed.
    pub fn set_agent_account(&mut self, agent_account: AccountId) {
        let owner = env::predecessor_account_id();
        let mut profile = self
            .agent_profiles
            .get(&owner)
            .cloned()
            .expect("No agent profile — register first");
        profile.agent_account = Some(agent_account.clone());
        self.agent_profiles.insert(owner.clone(), profile);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"agent_subwallet_set\",\"data\":{{\"owner\":\"{}\",\"agent_account\":\"{}\"}}}}",
            owner, agent_account
        ));
    }

    /// Update your agent's bio. Owner only.
    pub fn update_agent_bio(&mut self, bio: String) {
        let owner = env::predecessor_account_id();
        let mut profile = self
            .agent_profiles
            .get(&owner)
            .cloned()
            .expect("No agent profile");
        assert!(bio.len() <= 280, "Bio must be ≤280 characters");
        profile.bio = bio;
        self.agent_profiles.insert(owner, profile);
    }

    /// Award points to an agent's owner. Gated to the configured orchestrator
    /// — the off-chain judging bot that grades mission submissions. Each award
    /// emits a `points_awarded` event so the future $IRONCLAW conversion and
    /// any external indexer can rebuild full history. Also updates the stats
    /// ledger (weekly bucket, last-active timestamp, activity log) that the
    /// dashboard reads.
    pub fn award_points(&mut self, owner: AccountId, amount: U128, reason: String) {
        assert_eq!(
            env::predecessor_account_id(),
            self.orchestrator_id,
            "Only the orchestrator can award points"
        );
        assert!(reason.len() <= 128, "Reason must be ≤128 characters");
        let amt: u128 = amount.into();
        assert!(amt > 0, "Amount must be positive");

        let mut profile = self
            .agent_profiles
            .get(&owner)
            .cloned()
            .expect("Recipient has no agent profile");

        profile.points = profile.points.saturating_add(amt);
        self.total_points_issued = self.total_points_issued.saturating_add(amt);
        self.agent_profiles.insert(owner.clone(), profile);

        // Mirror into stats. Lazy-created the first time an agent gets points.
        let now = env::block_timestamp();
        let mut stats = self.agent_stats.get(&owner).cloned().unwrap_or_default();
        stats.roll_weekly(now);
        stats.points_this_week = stats.points_this_week.saturating_add(amt);
        stats.last_active = now;
        stats.push_activity(ActivityEntry {
            kind:        "points_awarded".to_string(),
            amount:      amt,
            description: reason.clone(),
            timestamp:   now,
        });
        self.agent_stats.insert(owner.clone(), stats);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"points_awarded\",\"data\":{{\"owner\":\"{}\",\"amount\":\"{}\",\"reason\":\"{}\"}}}}",
            owner, amt, reason
        ));
    }

    /// Record a graded submission: orchestrator judged a user's mission
    /// submission as approved or rejected. Drives the dashboard's success-rate
    /// tile. Does NOT award points — the orchestrator calls `award_points`
    /// separately for the approved cases so the two flows stay composable.
    pub fn record_submission(
        &mut self,
        owner: AccountId,
        approved: bool,
        description: String,
    ) {
        assert_eq!(
            env::predecessor_account_id(),
            self.orchestrator_id,
            "Only the orchestrator can record submissions"
        );
        assert!(description.len() <= 160, "Description must be ≤160 characters");
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Recipient has no agent profile"
        );

        let now = env::block_timestamp();
        let mut stats = self.agent_stats.get(&owner).cloned().unwrap_or_default();
        stats.roll_weekly(now);
        if approved {
            stats.submissions_approved = stats.submissions_approved.saturating_add(1);
        } else {
            stats.submissions_rejected = stats.submissions_rejected.saturating_add(1);
        }
        stats.last_active = now;
        stats.push_activity(ActivityEntry {
            kind:        if approved { "submission_approved" } else { "submission_rejected" }.to_string(),
            amount:      0,
            description: description.clone(),
            timestamp:   now,
        });
        self.agent_stats.insert(owner.clone(), stats);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"submission_recorded\",\"data\":{{\"owner\":\"{}\",\"approved\":{},\"description\":\"{}\"}}}}",
            owner, approved, description
        ));
    }

    /// Record a completed mission and (optionally) award points for it in one
    /// transaction. `reward_points` of 0 skips the award — useful when the
    /// reward is already being posted via a separate `award_points` call.
    pub fn record_mission_complete(
        &mut self,
        owner: AccountId,
        mission_name: String,
        reward_points: U128,
    ) {
        assert_eq!(
            env::predecessor_account_id(),
            self.orchestrator_id,
            "Only the orchestrator can record mission completions"
        );
        assert!(mission_name.len() <= 96, "Mission name must be ≤96 characters");
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Recipient has no agent profile"
        );

        let now = env::block_timestamp();
        let reward: u128 = reward_points.into();

        // Bump profile.points + total_points_issued if there's a reward.
        if reward > 0 {
            let mut profile = self.agent_profiles.get(&owner).cloned().expect("profile");
            profile.points = profile.points.saturating_add(reward);
            self.total_points_issued = self.total_points_issued.saturating_add(reward);
            self.agent_profiles.insert(owner.clone(), profile);
        }

        let mut stats = self.agent_stats.get(&owner).cloned().unwrap_or_default();
        stats.roll_weekly(now);
        stats.missions_completed = stats.missions_completed.saturating_add(1);
        if reward > 0 {
            stats.points_this_week = stats.points_this_week.saturating_add(reward);
        }
        stats.last_active = now;
        stats.push_activity(ActivityEntry {
            kind:        "mission_completed".to_string(),
            amount:      reward,
            description: mission_name.clone(),
            timestamp:   now,
        });
        self.agent_stats.insert(owner.clone(), stats);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"mission_completed\",\"data\":{{\"owner\":\"{}\",\"mission\":\"{}\",\"reward\":\"{}\"}}}}",
            owner, mission_name, reward
        ));
    }

    /// Adjust an agent's reputation score. Orchestrator-only. Placeholder for
    /// the reputation graph that Slice 2+ will flesh out (signal accuracy,
    /// peer endorsements, etc.).
    pub fn set_agent_reputation(&mut self, owner: AccountId, reputation: u32) {
        assert_eq!(
            env::predecessor_account_id(),
            self.orchestrator_id,
            "Only the orchestrator can set reputation"
        );
        let mut profile = self
            .agent_profiles
            .get(&owner)
            .cloned()
            .expect("No agent profile");
        profile.reputation = reputation;
        self.agent_profiles.insert(owner, profile);
    }

    // ── Views ──────────────────────────────────────────────────────────────

    pub fn get_agent(&self, owner: AccountId) -> Option<AgentProfile> {
        self.agent_profiles.get(&owner).cloned()
    }

    pub fn get_agent_by_handle(&self, handle: String) -> Option<AgentProfile> {
        let lower = handle.trim().to_ascii_lowercase();
        let owner = self.agent_handles.get(&lower).cloned()?;
        self.agent_profiles.get(&owner).cloned()
    }

    pub fn is_handle_available(&self, handle: String) -> bool {
        let lower = handle.trim().to_ascii_lowercase();
        self.agent_handles.get(&lower).is_none()
    }

    pub fn get_points(&self, owner: AccountId) -> U128 {
        U128(
            self.agent_profiles
                .get(&owner)
                .map(|p| p.points)
                .unwrap_or(0),
        )
    }

    /// Top-N agents ranked by lifetime points. `limit` is clamped to 200 so a
    /// misbehaving caller can't force an unbounded view over the entire map.
    pub fn get_leaderboard(&self, limit: u32) -> Vec<AgentProfile> {
        let cap = limit.min(200) as usize;
        let mut profiles: Vec<AgentProfile> =
            self.agent_profiles.values().cloned().collect();
        profiles.sort_by(|a, b| b.points.cmp(&a.points));
        profiles.truncate(cap);
        profiles
    }

    pub fn get_agents_count(&self) -> u32 {
        self.agent_profiles.len()
    }

    pub fn get_total_points_issued(&self) -> U128 {
        U128(self.total_points_issued)
    }

    // ── Stats views ────────────────────────────────────────────────────────

    /// Returns the agent's full stats block. `None` means the agent has never
    /// had any stats-worthy action (no awards, no submissions, no missions),
    /// which is different from "agent doesn't exist" — the caller should have
    /// already verified the profile exists.
    pub fn get_agent_stats(&self, owner: AccountId) -> Option<AgentStats> {
        self.agent_stats.get(&owner).cloned()
    }

    /// Convenience view: most-recent N activity entries, newest first. The
    /// ring buffer is stored oldest-first so we reverse here. `limit` is
    /// clamped to the on-chain cap (MAX_ACTIVITY).
    pub fn get_agent_activity(&self, owner: AccountId, limit: u32) -> Vec<ActivityEntry> {
        let stats = match self.agent_stats.get(&owner) {
            Some(s) => s,
            None => return vec![],
        };
        let cap = (limit as usize).min(MAX_ACTIVITY);
        stats.activity_log.iter().rev().take(cap).cloned().collect()
    }
}
