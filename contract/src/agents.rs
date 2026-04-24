use crate::*;
use near_sdk::json_types::U128;
use near_sdk::{NearToken, Promise};

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

// ── Phase 7 (Sub-PR A): skill metadata caps ────────────────────────────────
pub const MAX_SKILL_TAGS:            usize = 5;
pub const MAX_SKILL_TAG_LEN:         usize = 24;
pub const MAX_SKILL_CATEGORY_LEN:    usize = 32;
pub const MAX_SKILL_IMAGE_URL_LEN:   usize = 256;

/// Basis-points split on paid skill installs. 10_000 = 100%, so
/// PLATFORM_FEE_BPS=100 → 1% platform / 99% author. Constants so the
/// split is auditable in one place and can't drift between the Rust
/// call site and whatever the frontend displays.
pub const PLATFORM_FEE_BPS:          u32 = 100;
pub const BPS_DENOM:                 u32 = 10_000;

// ── Phase 7 (Sub-PR C): multi-agent caps ──────────────────────────────────
/// An owner can register up to this many **sub-agents** on top of their
/// primary `AgentProfile`. Keeps the per-owner Vec bounded so a single
/// `list_sub_agents` call can never exceed contract gas limits.
pub const MAX_SUB_AGENTS_PER_OWNER: usize = 10;

// ── Phase 7 (Sub-PR B): capability bitmask ─────────────────────────────────
// Five flags that the owner flips to authorise what their agent can do. The
// contract stores the mask but does NOT enforce it on every call path here —
// enforcement lives wherever an orchestrator/off-chain service reads the
// mask before acting. Storing the authorisation on-chain makes it auditable
// and lets the owner revoke from their own wallet with a single tx.
pub const PERM_READ_DATA:   u8 = 1 << 0; // Read wallet balances, history, account info
pub const PERM_SIGN_TX:     u8 = 1 << 1; // Sign + submit transactions on the owner's behalf
pub const PERM_INTERACT:    u8 = 1 << 2; // Call smart contracts
pub const PERM_SEND_MSG:    u8 = 1 << 3; // Post social messages / interact in apps
pub const PERM_TRANSFER:    u8 = 1 << 4; // Transfer NEAR or tokens out of the owner's wallet
pub const PERM_ALL:         u8 = PERM_READ_DATA
                                | PERM_SIGN_TX
                                | PERM_INTERACT
                                | PERM_SEND_MSG
                                | PERM_TRANSFER;
/// Default permissions for a brand-new profile: read-only. Anything more
/// has to be explicitly granted — least-privilege by default.
pub const PERM_DEFAULT:     u8 = PERM_READ_DATA;

/// Days-since-epoch helper. Used to reset the daily-spend counter when the
/// UTC date rolls over. Keeping it at UTC instead of a user timezone keeps
/// the comparison cheap on-chain and matches the existing weekly-bucket
/// anchor (see `current_week_index` just below).
const NS_PER_DAY: u64 = 24 * 3600 * 1_000_000_000;
fn current_day_index() -> u32 {
    (env::block_timestamp() / NS_PER_DAY) as u32
}

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

/// Phase 7 companion row stored in a parallel map keyed by `skill_id`.
/// Kept separate from `Skill` so the Phase 5 skills already on-chain
/// don't need to be re-encoded (borsh has no schema embedded, so adding
/// fields to `Skill` would require rewriting every existing row — we
/// dodge that by attaching metadata here instead). Populated eagerly by
/// `create_skill` on new listings; legacy skills show `None` until the
/// author calls `update_skill_metadata`.
#[near(serializers=[borsh, json])]
#[derive(Clone, Default)]
pub struct SkillMetadata {
    pub category:  String,
    pub tags:      Vec<String>,
    pub image_url: String,
    /// Admin-toggled trust signal. Surfaced as a blue-check on the
    /// marketplace; skills start `false` and can only be flipped by
    /// `owner_id` via `set_skill_verified`.
    pub verified:  bool,
}

/// Phase 7 (Sub-PR B): per-agent capability mask + daily spend guard.
/// Stored in a parallel map keyed by owner so AgentProfile's on-chain
/// encoding stays stable — same migration strategy as SkillMetadata.
///
/// `mask` is a bitmask of PERM_* constants. `daily_limit_yocto == 0`
/// means no limit. `daily_spent_*` form a rolling counter: if the
/// current UTC day index differs from `daily_spent_day`, the spent
/// counter is reset to 0 before the incoming amount is charged.
///
/// The contract does NOT automatically dock the counter on every
/// transfer — the orchestrator calls `record_agent_spend(owner, yocto)`
/// when it forwards a spend, so the owner gets a single source of
/// truth for "how much has my agent spent today" across every runtime.
#[near(serializers=[borsh, json])]
#[derive(Clone, Default)]
pub struct AgentPermissions {
    pub mask:              u8,
    pub daily_limit_yocto: u128,
    pub daily_spent_yocto: u128,
    pub daily_spent_day:   u32,
}

/// Phase 7 (Sub-PR C): a secondary agent owned by the same wallet as the
/// primary `AgentProfile`. Each one is a separate on-chain NEAR account
/// (e.g. `agent2.alice.near`) with its own handle, bio, and point balance.
///
/// Stored as entries in `owner_agents: UnorderedMap<owner, Vec<SubAgent>>`
/// so the primary `AgentProfile` encoding stays stable — same strategy as
/// `AgentPermissions` and `SkillMetadata`. Handles are deduped across the
/// primary + sub namespaces via a parallel `sub_agent_handles` map.
#[near(serializers=[borsh, json])]
#[derive(Clone)]
pub struct SubAgent {
    /// The sub-account the owner registered for this agent. Must be a
    /// child of the caller — e.g. `agent2.alice.near` for owner
    /// `alice.near`. Enforced at registration time.
    pub agent_account: AccountId,
    pub handle:        String,
    pub bio:           String,
    pub points:        u128,
    pub reputation:    u32,
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

        let lower = self.validate_fresh_handle(&handle);
        let trimmed = handle.trim().to_string();

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

    // ── Phase 7 Sub-PR B: agent permissions + spend limit ──────────────────

    /// Owner updates the capability bitmask on their own agent profile.
    /// Any bits outside PERM_ALL are rejected up front so the on-chain
    /// representation can't drift. Pass 0 to revoke everything.
    pub fn set_agent_permissions(&mut self, mask: u8) {
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register an agent first"
        );
        assert!(mask & !PERM_ALL == 0, "Unknown permission bits set");

        let mut row = self.agent_permissions.get(&owner).cloned().unwrap_or_default();
        row.mask = mask;
        self.agent_permissions.insert(owner.clone(), row);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"agent_permissions_changed\",\"data\":{{\"owner\":\"{}\",\"mask\":{}}}}}",
            owner, mask
        ));
    }

    /// Owner sets the max yoctoNEAR their agent can spend in a rolling
    /// UTC day. Pass 0 for "unlimited". Resets the spent counter if the
    /// day has rolled over since the last recorded spend.
    pub fn set_agent_daily_limit(&mut self, daily_limit_yocto: U128) {
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register an agent first"
        );
        let limit: u128 = daily_limit_yocto.into();

        let mut row = self.agent_permissions.get(&owner).cloned().unwrap_or_default();
        row.daily_limit_yocto = limit;
        // If the day rolled over since the last spend, reset the counter
        // so the new limit isn't blown immediately by stale state.
        let today = current_day_index();
        if row.daily_spent_day != today {
            row.daily_spent_day   = today;
            row.daily_spent_yocto = 0;
        }
        self.agent_permissions.insert(owner.clone(), row);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"agent_daily_limit_changed\",\"data\":{{\"owner\":\"{}\",\"daily_limit_yocto\":\"{}\"}}}}",
            owner, limit
        ));
    }

    /// Orchestrator-only: report a spend. The contract resets the day
    /// counter if today differs from the last recorded day, then bumps
    /// the spent amount. Aborts when the would-be new total exceeds the
    /// configured daily limit (0 = unlimited, so no guard).
    ///
    /// Exposed as a contract method so the owner's daily cap is the
    /// single source of truth across any runtime the orchestrator
    /// forwards through.
    pub fn record_agent_spend(&mut self, owner: AccountId, amount_yocto: U128) {
        assert_eq!(
            env::predecessor_account_id(),
            self.orchestrator_id,
            "Only the orchestrator can record agent spend"
        );
        let amount: u128 = amount_yocto.into();
        let mut row = self.agent_permissions.get(&owner).cloned().unwrap_or_default();

        let today = current_day_index();
        if row.daily_spent_day != today {
            row.daily_spent_day   = today;
            row.daily_spent_yocto = 0;
        }
        let new_total = row.daily_spent_yocto.saturating_add(amount);
        if row.daily_limit_yocto > 0 {
            assert!(
                new_total <= row.daily_limit_yocto,
                "Daily spend limit exceeded: {}/{} yoctoNEAR",
                new_total, row.daily_limit_yocto
            );
        }
        row.daily_spent_yocto = new_total;
        self.agent_permissions.insert(owner.clone(), row);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"agent_spend_recorded\",\"data\":{{\"owner\":\"{}\",\"amount_yocto\":\"{}\",\"day\":{}}}}}",
            owner, amount, today
        ));
    }

    /// View: current permission row for an owner. Returns `None` when
    /// the owner hasn't touched permissions yet — callers should treat
    /// `None` as PERM_DEFAULT (read-only) + 0 daily limit.
    pub fn get_agent_permissions(&self, owner: AccountId) -> Option<AgentPermissions> {
        self.agent_permissions.get(&owner).cloned()
    }

    /// View: today's UTC day-index. Exposed so frontends can
    /// reconcile the `daily_spent_day` they read against "is this
    /// the current bucket". Keeps clients honest across timezones.
    pub fn get_current_day_index(&self) -> u32 {
        current_day_index()
    }

    // ── Phase 7 Sub-PR C: multi-agent per wallet ───────────────────────────
    //
    // `register_agent` keeps writing the *primary* profile into
    // `agent_profiles`. Each owner can also attach up to
    // MAX_SUB_AGENTS_PER_OWNER additional agents here — each one a fresh
    // NEAR sub-account the owner created before calling in. The contract
    // trusts the caller for account creation (NEAR enforces that only the
    // parent can spawn `*.<parent>` accounts) but still validates the
    // string shape defensively so a typo can't cross-register under the
    // wrong owner.
    //
    // Handles are globally unique across the primary + sub namespaces —
    // enforced by checking both `agent_handles` and `sub_agent_handles`
    // before inserting.

    /// Returns true iff `child` is a direct sub-account of `parent`,
    /// e.g. `agent2.alice.near` is a child of `alice.near`. We check
    /// "ends with .parent" and also require that the label before the
    /// dot is non-empty — so `alice.near` is NOT considered its own
    /// child, and `.alice.near` is rejected.
    fn is_child_subaccount(child: &AccountId, parent: &AccountId) -> bool {
        let c = child.as_str();
        let p = parent.as_str();
        let suffix = format!(".{}", p);
        if !c.ends_with(&suffix) { return false; }
        let prefix_len = c.len().saturating_sub(suffix.len());
        prefix_len > 0
    }

    /// Shared handle-validation + uniqueness check used by both primary
    /// `register_agent` and `register_sub_agent`. Kept out of a free
    /// function so it can read `self.agent_handles` / `self.sub_agent_handles`.
    fn validate_fresh_handle(&self, handle: &str) -> String {
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
        assert!(
            self.sub_agent_handles.get(&lower).is_none(),
            "Handle already taken"
        );
        lower
    }

    /// Register a secondary agent owned by the caller. Requires a primary
    /// profile to already exist (so the caller has established platform
    /// identity). `agent_account` must be a direct child of the caller —
    /// the frontend creates it in the same wallet-approval batch, so by
    /// the time we're executing here the sub-account is guaranteed to
    /// exist at the NEAR layer.
    pub fn register_sub_agent(
        &mut self,
        agent_account: AccountId,
        handle: String,
        bio: Option<String>,
    ) {
        assert!(!self.paused, "Contract is paused");
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register a primary agent before adding sub-agents"
        );
        assert!(
            Self::is_child_subaccount(&agent_account, &owner),
            "agent_account must be a direct sub-account of the caller"
        );

        // Cap per-owner list + reject duplicate sub-account registration.
        let mut list = self.owner_agents.get(&owner).cloned().unwrap_or_default();
        assert!(
            list.len() < MAX_SUB_AGENTS_PER_OWNER,
            "Sub-agent limit reached ({} per owner)",
            MAX_SUB_AGENTS_PER_OWNER
        );
        assert!(
            !list.iter().any(|s| s.agent_account == agent_account),
            "Sub-agent already registered for this account"
        );

        let bio_str = bio.unwrap_or_default();
        assert!(bio_str.len() <= 280, "Bio must be ≤280 characters");
        let lower = self.validate_fresh_handle(&handle);
        let trimmed = handle.trim().to_string();

        let entity = SubAgent {
            agent_account: agent_account.clone(),
            handle:        trimmed.clone(),
            bio:           bio_str,
            points:        0,
            reputation:    0,
            created_at:    env::block_timestamp(),
        };
        list.push(entity);
        self.owner_agents.insert(owner.clone(), list);
        self.sub_agent_handles.insert(lower, owner.clone());

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"sub_agent_registered\",\"data\":{{\"owner\":\"{}\",\"agent_account\":\"{}\",\"handle\":\"{}\"}}}}",
            owner, agent_account, trimmed
        ));
    }

    /// Owner-only: rewrite one sub-agent's bio. Leaves the handle +
    /// account id untouched — those two are the stable identity.
    pub fn update_sub_agent_bio(&mut self, agent_account: AccountId, bio: String) {
        let owner = env::predecessor_account_id();
        assert!(bio.len() <= 280, "Bio must be ≤280 characters");
        let mut list = self.owner_agents.get(&owner).cloned()
            .expect("No sub-agents for this owner");
        let pos = list.iter().position(|s| s.agent_account == agent_account)
            .expect("Sub-agent not found");
        list[pos].bio = bio;
        self.owner_agents.insert(owner, list);
    }

    /// Owner-only: drop a sub-agent. Frees the handle so the owner
    /// (or someone else) can reuse it on a future `register_sub_agent`.
    /// Does **not** touch the NEAR sub-account itself — the owner
    /// retains the keys and can repurpose it off-platform.
    pub fn remove_sub_agent(&mut self, agent_account: AccountId) {
        let owner = env::predecessor_account_id();
        let mut list = self.owner_agents.get(&owner).cloned()
            .expect("No sub-agents for this owner");
        let pos = list.iter().position(|s| s.agent_account == agent_account)
            .expect("Sub-agent not found");
        let removed = list.remove(pos);

        if list.is_empty() {
            self.owner_agents.remove(&owner);
        } else {
            self.owner_agents.insert(owner.clone(), list);
        }
        let lower = removed.handle.to_ascii_lowercase();
        self.sub_agent_handles.remove(&lower);

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"sub_agent_removed\",\"data\":{{\"owner\":\"{}\",\"agent_account\":\"{}\"}}}}",
            owner, agent_account
        ));
    }

    /// All sub-agents owned by `owner`. Primary agent (from
    /// `get_agent`) is NOT included — surface both in the UI to show
    /// the full roster.
    pub fn list_sub_agents(&self, owner: AccountId) -> Vec<SubAgent> {
        self.owner_agents.get(&owner).cloned().unwrap_or_default()
    }

    /// Fetch one sub-agent by its `agent_account`. Linear scan over the
    /// owner's small list — fine inside the 10-item cap.
    pub fn get_sub_agent(&self, owner: AccountId, agent_account: AccountId) -> Option<SubAgent> {
        self.owner_agents.get(&owner).and_then(|list| {
            list.iter().find(|s| s.agent_account == agent_account).cloned()
        })
    }

    /// Total number of sub-agents across all owners. Useful for admin
    /// telemetry; linear over the owner map so bounded by
    /// MAX_SUB_AGENTS_PER_OWNER × owner_count.
    pub fn get_sub_agents_total(&self) -> u32 {
        let mut total: u32 = 0;
        for (_, list) in self.owner_agents.iter() {
            total = total.saturating_add(list.len() as u32);
        }
        total
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

    /// Normalize + validate a tags vector. Case-insensitive dedupe, empty
    /// strings dropped, bounded length per tag + total. Reused by create +
    /// update paths so both share identical rules.
    fn sanitize_tags(raw: Vec<String>) -> Vec<String> {
        let mut out: Vec<String> = Vec::with_capacity(raw.len().min(MAX_SKILL_TAGS));
        for t in raw.into_iter() {
            let trimmed = t.trim().to_lowercase();
            if trimmed.is_empty() { continue; }
            assert!(
                trimmed.len() <= MAX_SKILL_TAG_LEN,
                "Each tag must be ≤{} chars",
                MAX_SKILL_TAG_LEN
            );
            if !out.iter().any(|existing| existing == &trimmed) {
                out.push(trimmed);
            }
            if out.len() >= MAX_SKILL_TAGS { break; }
        }
        out
    }

    /// Phase 7: `create_skill` now also accepts category / tags /
    /// image_url. All four metadata fields are optional in the borsh
    /// surface — passing empty string / empty vec writes a default
    /// `SkillMetadata` row so the skill still has a metadata entry
    /// (distinguishes "Phase 7 skill with blank metadata" from "legacy
    /// Phase 5/6 skill that pre-dates metadata").
    pub fn create_skill(
        &mut self,
        name:        String,
        description: String,
        price_yocto: U128,
        category:    String,
        tags:        Vec<String>,
        image_url:   String,
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
        let cat_t = category.trim();
        assert!(
            cat_t.len() <= MAX_SKILL_CATEGORY_LEN,
            "Category must be ≤{} chars",
            MAX_SKILL_CATEGORY_LEN
        );
        let img_t = image_url.trim();
        assert!(
            img_t.len() <= MAX_SKILL_IMAGE_URL_LEN,
            "Image URL must be ≤{} chars",
            MAX_SKILL_IMAGE_URL_LEN
        );
        let clean_tags = Self::sanitize_tags(tags);

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
        self.skill_metadata.insert(id, SkillMetadata {
            category:  cat_t.to_string(),
            tags:      clean_tags,
            image_url: img_t.to_string(),
            verified:  false,
        });
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"skill_created\",\"data\":{{\"id\":{},\"author\":\"{}\",\"name\":\"{}\",\"category\":\"{}\"}}}}",
            id, author, name_t, cat_t
        ));
        id
    }

    /// Phase 7: skill authors can retroactively add or rewrite their
    /// skill's metadata — category/tags/image. Verified stays sticky
    /// (authors can't self-verify; only `set_skill_verified` by the
    /// contract owner can flip it).
    pub fn update_skill_metadata(
        &mut self,
        skill_id:  u64,
        category:  String,
        tags:      Vec<String>,
        image_url: String,
    ) {
        let caller = env::predecessor_account_id();
        let skill = self.skills.get(&skill_id).cloned()
            .expect("Skill not found");
        assert_eq!(skill.author, caller, "Only the skill author can update metadata");

        let cat_t = category.trim();
        assert!(cat_t.len() <= MAX_SKILL_CATEGORY_LEN,
            "Category must be ≤{} chars", MAX_SKILL_CATEGORY_LEN);
        let img_t = image_url.trim();
        assert!(img_t.len() <= MAX_SKILL_IMAGE_URL_LEN,
            "Image URL must be ≤{} chars", MAX_SKILL_IMAGE_URL_LEN);
        let clean_tags = Self::sanitize_tags(tags);

        // Preserve the existing verified flag — authors can never flip it.
        let current_verified = self.skill_metadata.get(&skill_id)
            .map(|m| m.verified)
            .unwrap_or(false);

        self.skill_metadata.insert(skill_id, SkillMetadata {
            category:  cat_t.to_string(),
            tags:      clean_tags,
            image_url: img_t.to_string(),
            verified:  current_verified,
        });
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"skill_metadata_updated\",\"data\":{{\"id\":{},\"author\":\"{}\"}}}}",
            skill_id, caller
        ));
    }

    /// Owner-only: toggle the verified flag. Writes a metadata row if
    /// the skill pre-dates Phase 7 and doesn't have one yet.
    pub fn set_skill_verified(&mut self, skill_id: u64, verified: bool) {
        assert_eq!(env::predecessor_account_id(), self.owner_id,
            "Only the contract owner can verify skills");
        assert!(self.skills.get(&skill_id).is_some(), "Skill not found");
        let mut meta = self.skill_metadata.get(&skill_id).cloned().unwrap_or_default();
        meta.verified = verified;
        self.skill_metadata.insert(skill_id, meta);
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"skill_verified_changed\",\"data\":{{\"id\":{},\"verified\":{}}}}}",
            skill_id, verified
        ));
    }

    /// Phase 7: `install_skill` is now `#[payable]`. Caller must attach
    /// at least `skill.price_yocto` yoctoNEAR. The deposit is split
    /// 99% → skill author, 1% → contract owner. Free skills (price 0)
    /// accept a zero-deposit call and do no transfers.
    #[payable]
    pub fn install_skill(&mut self, skill_id: u64) {
        let owner = env::predecessor_account_id();
        assert!(
            self.agent_profiles.get(&owner).is_some(),
            "Register an agent first"
        );
        let mut skill = self.skills.get(&skill_id).cloned()
            .expect("Skill not found");

        // Payment enforcement. Free skills short-circuit all the way
        // through; paid skills require at least `price_yocto` and split
        // the attached deposit 99/1.
        let attached = env::attached_deposit().as_yoctonear();
        let price    = skill.price_yocto;
        if price > 0 {
            assert!(
                attached >= price,
                "Insufficient deposit: skill costs {} yoctoNEAR, received {}",
                price, attached
            );
            // Split the EXACT price; any overpay is refunded on transfer
            // below so an accidental drag-and-drop doesn't move funds
            // beyond the install.
            let platform_cut = price.saturating_mul(PLATFORM_FEE_BPS as u128) / (BPS_DENOM as u128);
            let author_cut   = price.saturating_sub(platform_cut);
            if author_cut > 0 {
                Promise::new(skill.author.clone())
                    .transfer(NearToken::from_yoctonear(author_cut));
            }
            if platform_cut > 0 {
                Promise::new(self.owner_id.clone())
                    .transfer(NearToken::from_yoctonear(platform_cut));
            }
            // Refund overpay back to caller.
            let refund = attached.saturating_sub(price);
            if refund > 0 {
                Promise::new(owner.clone())
                    .transfer(NearToken::from_yoctonear(refund));
            }
        } else {
            // Free skill — if the caller attached funds anyway, send
            // them straight back rather than silently absorbing.
            if attached > 0 {
                Promise::new(owner.clone())
                    .transfer(NearToken::from_yoctonear(attached));
            }
        }

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
        self.skills.insert(skill_id, skill.clone());

        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"ironshield\",\"version\":\"1.0\",\"event\":\"skill_installed\",\"data\":{{\"owner\":\"{}\",\"skill_id\":{},\"price_yocto\":\"{}\",\"paid\":{}}}}}",
            owner, skill_id, price, price > 0
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

    /// Phase 7: fetch a skill's metadata row. Legacy skills that
    /// pre-date Phase 7 return `None` — callers should render the
    /// base skill without category/tags/badge.
    pub fn get_skill_metadata(&self, skill_id: u64) -> Option<SkillMetadata> {
        self.skill_metadata.get(&skill_id).cloned()
    }

    /// Skill marketplace listing — newest first. Limit capped at 100.
    pub fn list_skills(&self, limit: u32, offset: u32) -> Vec<Skill> {
        let cap  = (limit as usize).min(100);
        let skip = offset as usize;
        let mut all: Vec<Skill> = self.skills.values().cloned().collect();
        all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        all.into_iter().skip(skip).take(cap).collect()
    }

    /// Phase 7: one-shot view that joins skills with their metadata.
    /// Avoids N+1 RPCs when the marketplace renders cards that need both
    /// the base skill and its tags/category/verified flag. Metadata is
    /// `None` for legacy skills.
    pub fn list_skills_with_metadata(
        &self,
        limit: u32,
        offset: u32,
    ) -> Vec<(Skill, Option<SkillMetadata>)> {
        let cap  = (limit as usize).min(100);
        let skip = offset as usize;
        let mut all: Vec<Skill> = self.skills.values().cloned().collect();
        all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        all.into_iter()
            .skip(skip).take(cap)
            .map(|s| {
                let meta = self.skill_metadata.get(&s.id).cloned();
                (s, meta)
            })
            .collect()
    }

    pub fn get_installed_skills(&self, owner: AccountId) -> Vec<Skill> {
        let ids = self.installed_skills.get(&owner).cloned().unwrap_or_default();
        ids.iter().filter_map(|id| self.skills.get(id).cloned()).collect()
    }

    /// Phase 7 counterpart to `get_installed_skills` that returns the
    /// metadata alongside each installed skill. Same `None`-for-legacy
    /// caveat applies.
    pub fn get_installed_skills_with_metadata(
        &self,
        owner: AccountId,
    ) -> Vec<(Skill, Option<SkillMetadata>)> {
        let ids = self.installed_skills.get(&owner).cloned().unwrap_or_default();
        ids.iter().filter_map(|id| {
            self.skills.get(id).cloned().map(|s| {
                let meta = self.skill_metadata.get(id).cloned();
                (s, meta)
            })
        }).collect()
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
