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

// ── Phase 5: tasks + skills caps ────────────────────────────────────────────
// Bound per-agent task list so the storage cost per profile stays predictable.
// An agent can have up to 10 active tasks at once; completed/cancelled tasks
// fall off the list via the ring-buffer trim in `assign_task`.
pub const MAX_TASKS_PER_AGENT:       usize = 10;
pub const MAX_INSTALLED_PER_AGENT:   usize = 25;
pub const MAX_SKILL_NAME_LEN:        usize = 48;
pub const MAX_SKILL_DESCRIPTION_LEN: usize = 240;
pub const MAX_TASK_DESCRIPTION_LEN:  usize = 280;

fn current_week_index() -> u64 {
    env::block_timestamp().saturating_sub(WEEK_ANCHOR_NS) / NS_PER_WEEK
}

/// A user-assigned task the agent should work on. Status flows:
/// "active" → "completed" (orchestrator reports success=true) / "failed"
/// (success=false) / "cancelled" (owner revoked before completion).
#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct AgentTask {
    pub id:           u64,
    pub owner:        AccountId,
    pub description:  String,
    /// Optional link to an existing on-chain mission proposal when the task is
    /// "work on mission #N"; None for free-form instructions.
    pub mission_id:   Option<u32>,
    pub status:       String,
    pub created_at:   u64,
    pub completed_at: u64,
    pub result:       String,
}

/// A skill is a reusable capability module agents can install — "trading",
/// "airdrop hunter", "content writer", etc. Skills are authored by anyone with
/// an agent; the platform takes a cut on paid installs (enforced off-chain for
/// now; pricing is informational until the skill marketplace v2 slice).
#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct Skill {
    pub id:            u64,
    pub name:          String,
    pub description:   String,
    pub author:        AccountId,
    pub price_yocto:   u128,
    pub install_count: u64,
    pub created_at:    u64,
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

/// Phase 5 flags kept in a separate map keyed by owner so AgentProfile's
/// storage shape stays stable (no profile-rewrite migration needed). Every
/// field defaults to false; entries are created lazily on first toggle.
#[near(serializers=[borsh, json])]
#[derive(Clone, Default)]
pub struct AgentFlags {
    /// When true the agent appears in the public /agents directory.
    pub public: bool,
    /// When true the agent is subscribed to the IronClaw DAO signal feed
    /// (mission proposals + alerts). Purely informational on-chain; the
    /// off-chain relay decides what to forward based on this flag.
    pub subscribed_to_ironclaw: bool,
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

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 5: tasks, IronClaw subscription, public directory, skills
    // ═════════════════════════════════════════════════════════════════════════

    // ── Tasks ──────────────────────────────────────────────────────────────

    /// Owner assigns a new task to their agent. Optional `mission_id` links
    /// the task to an existing on-chain mission proposal; free-form tasks
    /// (no mission) accept any description within the length cap.
    pub fn assign_task(
        &mut self,
        description: String,
        mission_id: Option<u32>,
    ) -> u64 {
        assert!(!self.paused, "Contract is paused");
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register an agent before assigning tasks"
        );
        let trimmed = description.trim();
        assert!(!trimmed.is_empty(), "Description required");
        assert!(
            trimmed.len() <= MAX_TASK_DESCRIPTION_LEN,
            "Description must be ≤280 chars"
        );
        if let Some(mid) = mission_id {
            assert!(
                self.proposals.get(mid).is_some(),
                "Referenced mission does not exist"
            );
        }

        let id = self.next_task_id;
        self.next_task_id = self.next_task_id.saturating_add(1);

        let mut list = self.agent_tasks.get(&owner).cloned().unwrap_or_default();
        // Ring-buffer behaviour: if the owner already has MAX_TASKS active
        // tasks, drop the oldest to make room.
        if list.len() >= MAX_TASKS_PER_AGENT {
            list.remove(0);
        }
        let task = AgentTask {
            id,
            owner:        owner.clone(),
            description:  trimmed.to_string(),
            mission_id,
            status:       "active".to_string(),
            created_at:   env::block_timestamp(),
            completed_at: 0,
            result:       String::new(),
        };
        list.push(task);
        self.agent_tasks.insert(owner.clone(), list);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"task_assigned\",\"data\":{{\"owner\":\"{}\",\"task_id\":{},\"mission_id\":{}}}}}",
            owner, id, mission_id.map(|m| m.to_string()).unwrap_or_else(|| "null".to_string())
        ));
        id
    }

    /// Owner cancels one of their active tasks.
    pub fn cancel_task(&mut self, task_id: u64) {
        let owner = env::predecessor_account_id();
        let mut list = self.agent_tasks.get(&owner).cloned()
            .expect("No tasks for this owner");
        let pos = list.iter().position(|t| t.id == task_id)
            .expect("Task not found");
        let mut t = list[pos].clone();
        assert!(t.status == "active", "Task already resolved");
        t.status = "cancelled".to_string();
        t.completed_at = env::block_timestamp();
        list[pos] = t;
        self.agent_tasks.insert(owner.clone(), list);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"task_cancelled\",\"data\":{{\"owner\":\"{}\",\"task_id\":{}}}}}",
            owner, task_id
        ));
    }

    /// Orchestrator reports the outcome of a task. `success=true` → completed
    /// (and optionally awards points via a separate award_points call);
    /// `success=false` → failed.
    pub fn complete_task(
        &mut self,
        owner: AccountId,
        task_id: u64,
        success: bool,
        result: String,
    ) {
        assert_eq!(
            env::predecessor_account_id(),
            self.orchestrator_id,
            "Only the orchestrator can complete tasks"
        );
        assert!(result.len() <= 280, "Result must be ≤280 chars");
        let mut list = self.agent_tasks.get(&owner).cloned()
            .expect("No tasks for this owner");
        let pos = list.iter().position(|t| t.id == task_id)
            .expect("Task not found");
        let mut t = list[pos].clone();
        assert!(t.status == "active", "Task already resolved");
        t.status = if success { "completed" } else { "failed" }.to_string();
        t.completed_at = env::block_timestamp();
        t.result = result.clone();
        list[pos] = t;
        self.agent_tasks.insert(owner.clone(), list);

        // Mirror into the activity feed so the dashboard shows the outcome
        // without a separate fetch.
        if let Some(mut stats) = self.agent_stats.get(&owner).cloned() {
            stats.push_activity(ActivityEntry {
                kind:        if success { "task_completed" } else { "task_failed" }.to_string(),
                amount:      0,
                description: format!("Task #{}: {}", task_id, result),
                timestamp:   env::block_timestamp(),
            });
            stats.last_active = env::block_timestamp();
            self.agent_stats.insert(owner.clone(), stats);
        }

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"task_{}\",\"data\":{{\"owner\":\"{}\",\"task_id\":{}}}}}",
            if success { "completed" } else { "failed" }, owner, task_id
        ));
    }

    pub fn get_agent_tasks(&self, owner: AccountId) -> Vec<AgentTask> {
        self.agent_tasks.get(&owner).cloned().unwrap_or_default()
    }

    // ── IronClaw subscription + public toggle ──────────────────────────────

    pub fn set_subscription(&mut self, enable: bool) {
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register an agent first"
        );
        let mut flags = self.agent_flags.get(&owner).cloned().unwrap_or_default();
        flags.subscribed_to_ironclaw = enable;
        self.agent_flags.insert(owner.clone(), flags);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"subscription_changed\",\"data\":{{\"owner\":\"{}\",\"enabled\":{}}}}}",
            owner, enable
        ));
    }

    pub fn set_public(&mut self, public: bool) {
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register an agent first"
        );
        let mut flags = self.agent_flags.get(&owner).cloned().unwrap_or_default();
        flags.public = public;
        self.agent_flags.insert(owner.clone(), flags);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"public_changed\",\"data\":{{\"owner\":\"{}\",\"public\":{}}}}}",
            owner, public
        ));
    }

    pub fn get_agent_flags(&self, owner: AccountId) -> AgentFlags {
        self.agent_flags.get(&owner).cloned().unwrap_or_default()
    }

    /// Public directory of agents whose owners have opted in via set_public.
    /// Returned newest-first; limit capped at 100 to keep the call bounded.
    pub fn get_public_agents(&self, limit: u32, offset: u32) -> Vec<AgentProfile> {
        let cap  = (limit as usize).min(100);
        let skip = offset as usize;
        // Walk agent_flags (small set — only agents that ever toggled), join
        // with agent_profiles, filter for public=true.
        let mut profiles: Vec<AgentProfile> = self.agent_flags
            .iter()
            .filter_map(|(owner, flags)| {
                if flags.public {
                    self.agent_profiles.get(owner).cloned()
                } else {
                    None
                }
            })
            .collect();
        profiles.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        profiles.into_iter().skip(skip).take(cap).collect()
    }

    // ── Skills marketplace ─────────────────────────────────────────────────

    pub fn create_skill(
        &mut self,
        name: String,
        description: String,
        price_yocto: U128,
    ) -> u64 {
        assert!(!self.paused, "Contract is paused");
        let author = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&author).is_some(),
            "Register an agent before authoring skills"
        );
        let name_t = name.trim();
        assert!(
            !name_t.is_empty() && name_t.len() <= MAX_SKILL_NAME_LEN,
            "Skill name required and ≤48 chars"
        );
        let desc_t = description.trim();
        assert!(
            desc_t.len() <= MAX_SKILL_DESCRIPTION_LEN,
            "Skill description must be ≤240 chars"
        );

        let id = self.next_skill_id;
        self.next_skill_id = self.next_skill_id.saturating_add(1);
        let skill = Skill {
            id,
            name:          name_t.to_string(),
            description:   desc_t.to_string(),
            author:        author.clone(),
            price_yocto:   price_yocto.into(),
            install_count: 0,
            created_at:    env::block_timestamp(),
        };
        self.skills.insert(id, skill);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"skill_created\",\"data\":{{\"id\":{},\"author\":\"{}\",\"name\":\"{}\"}}}}",
            id, author, name_t
        ));
        id
    }

    pub fn install_skill(&mut self, skill_id: u64) {
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register an agent first"
        );
        let mut skill = self.skills.get(&skill_id).cloned()
            .expect("Skill not found");
        let mut installed = self.installed_skills.get(&owner).cloned().unwrap_or_default();
        assert!(
            !installed.contains(&skill_id),
            "Skill already installed"
        );
        assert!(
            installed.len() < MAX_INSTALLED_PER_AGENT,
            "Installed-skills limit reached (25)"
        );
        installed.push(skill_id);
        self.installed_skills.insert(owner.clone(), installed);

        skill.install_count = skill.install_count.saturating_add(1);
        self.skills.insert(skill_id, skill);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"skill_installed\",\"data\":{{\"owner\":\"{}\",\"skill_id\":{}}}}}",
            owner, skill_id
        ));
    }

    pub fn uninstall_skill(&mut self, skill_id: u64) {
        let owner = env::predecessor_account_id();
        let mut installed = self.installed_skills.get(&owner).cloned()
            .expect("No skills installed");
        let pos = installed.iter().position(|id| *id == skill_id)
            .expect("Skill not installed");
        installed.remove(pos);
        self.installed_skills.insert(owner.clone(), installed);

        if let Some(mut s) = self.skills.get(&skill_id).cloned() {
            s.install_count = s.install_count.saturating_sub(1);
            self.skills.insert(skill_id, s);
        }

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"skill_uninstalled\",\"data\":{{\"owner\":\"{}\",\"skill_id\":{}}}}}",
            owner, skill_id
        ));
    }

    pub fn get_skill(&self, skill_id: u64) -> Option<Skill> {
        self.skills.get(&skill_id).cloned()
    }

    /// Skill marketplace listing — newest first. Limit capped at 100.
    pub fn list_skills(&self, limit: u32, offset: u32) -> Vec<Skill> {
        let cap  = (limit as usize).min(100);
        let skip = offset as usize;
        let mut all: Vec<Skill> = self.skills.values().cloned().collect();
        all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        all.into_iter().skip(skip).take(cap).collect()
    }

    pub fn get_installed_skills(&self, owner: AccountId) -> Vec<Skill> {
        let ids = self.installed_skills.get(&owner).cloned().unwrap_or_default();
        ids.iter().filter_map(|id| self.skills.get(id).cloned()).collect()
    }

    pub fn get_skills_count(&self) -> u64 {
        self.next_skill_id
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 6: link an existing IronClaw agent to this platform profile
    // ═════════════════════════════════════════════════════════════════════════
    //
    // Users with an agent already running on ironclaw.com can "bring it over"
    // by registering a profile here that stores the source URL / handle. The
    // off-chain orchestrator uses this field to forward posts + actions
    // between the two runtimes so a linked agent can participate on IronShield
    // without being re-built from scratch.

    /// Link this profile to an existing IronClaw agent. `source` is a free-
    /// form string — a URL like "ironclaw.com/a/hunter" or a bare handle —
    /// that the off-chain relay resolves. Caller must already have a profile.
    pub fn link_to_ironclaw(&mut self, source: String) {
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register an agent profile first"
        );
        let trimmed = source.trim().to_string();
        assert!(
            !trimmed.is_empty() && trimmed.len() <= 160,
            "Source required and ≤160 chars"
        );
        self.ironclaw_sources.insert(owner.clone(), trimmed.clone());
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"ironclaw_linked\",\"data\":{{\"owner\":\"{}\",\"source\":\"{}\"}}}}",
            owner, trimmed
        ));
    }

    pub fn unlink_from_ironclaw(&mut self) {
        let owner = env::predecessor_account_id();
        self.ironclaw_sources.remove(&owner);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"ironclaw_unlinked\",\"data\":{{\"owner\":\"{}\"}}}}",
            owner
        ));
    }

    pub fn get_ironclaw_source(&self, owner: AccountId) -> Option<String> {
        self.ironclaw_sources.get(&owner).cloned()
    }
}
