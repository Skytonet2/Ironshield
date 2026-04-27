// backend/services/authEngine.js
//
// Authorization Tier Engine.
//
// The trust dial. Before an agent takes any external action, the
// orchestrator calls `authEngine.check({ action, ctx })`. The engine
// resolves the right AuthProfile (mission-bound, then agent-bound,
// then user default, then system default), evaluates rules in order,
// and returns one of three verdicts:
//
//   { policy: 'auto'             }   proceed silently
//   { policy: 'notify',           escalationId? }
//                                    proceed but ping the owner
//   { policy: 'require_approval', escalationId, channel, expiresAt }
//                                    freeze the step, persist a row
//                                    in mission_escalations, dispatch
//                                    to the configured channel
//
// When a TG callback / in-app button / cron timeout fires, the
// callsite calls `resolveEscalation(escalationId, decision, by, note)`
// which flips the row and returns the resolved escalation. The
// orchestrator polls for resolved escalations to resume frozen steps.
//
// Rule eval (`evaluateRules`) is a pure function and is unit-tested
// without a database. The DB-backed surfaces (`check`,
// `freezeEscalation`, `resolveEscalation`) hit Postgres.

const db = require("../db/client");

const POLICY_AUTO              = "auto";
const POLICY_NOTIFY            = "notify";
const POLICY_REQUIRE_APPROVAL  = "require_approval";

const ACTION_TYPES = [
  "send_message",
  "commit_funds",
  "sign_tx",
  "share_data",
  "meet_irl",
  "final_terms",
  "public_post",
];

const VALID_POLICIES = [POLICY_AUTO, POLICY_NOTIFY, POLICY_REQUIRE_APPROVAL];
const VALID_CHANNELS = ["tg", "email", "sms", "in_app"];

// System-default rule set. Applied when no user / agent / mission
// profile resolves a verdict.
const SYSTEM_DEFAULT_RULES = [
  // Public posts on the owner's behalf — always confirm in v1.
  { action_type: "public_post",  policy: POLICY_REQUIRE_APPROVAL, escalation_channel: "tg" },
  // IRL meetings or location shares — never auto.
  { action_type: "meet_irl",     policy: POLICY_REQUIRE_APPROVAL, escalation_channel: "tg" },
  // Sensitive data (KYC, secrets) — confirm at sensitivity ≥ 2.
  { action_type: "share_data",   threshold: { data_sensitivity: 2 }, policy: POLICY_REQUIRE_APPROVAL, escalation_channel: "tg" },
  // Money + signing — always confirm.
  { action_type: "commit_funds", policy: POLICY_REQUIRE_APPROVAL, escalation_channel: "tg" },
  { action_type: "sign_tx",      policy: POLICY_REQUIRE_APPROVAL, escalation_channel: "tg" },
  { action_type: "final_terms",  policy: POLICY_REQUIRE_APPROVAL, escalation_channel: "tg" },
  // Mass DM — notify but don't freeze.
  { action_type: "send_message", threshold: { recipient_count: 5 }, policy: POLICY_NOTIFY, escalation_channel: "in_app" },
];

/** Threshold matcher. A rule's threshold is "met" when EVERY field on
 *  the threshold is ≤ the corresponding action field. Missing action
 *  fields fail the match (so a rule can't accidentally fire on an
 *  action that doesn't expose the comparison axis). */
function thresholdMet(threshold, action) {
  if (!threshold || Object.keys(threshold).length === 0) return true;
  if (threshold.amount != null) {
    if (action.amount == null || Number(action.amount) < Number(threshold.amount)) return false;
  }
  if (threshold.recipient_count != null) {
    if (action.recipient_count == null || Number(action.recipient_count) < Number(threshold.recipient_count)) return false;
  }
  if (threshold.data_sensitivity != null) {
    if (action.data_sensitivity == null || Number(action.data_sensitivity) < Number(threshold.data_sensitivity)) return false;
  }
  return true;
}

/** Evaluate `rules` against `action` and return the first matching
 *  policy. Rules are scanned in order — the first action_type +
 *  threshold match wins. Returns the system default if nothing
 *  matches. */
function evaluateRules(rules, action) {
  if (!action || !action.action_type) {
    throw new Error("action.action_type required");
  }
  if (!ACTION_TYPES.includes(action.action_type)) {
    throw new Error(`Unknown action_type: ${action.action_type}`);
  }

  const stack = [...(rules || []), ...SYSTEM_DEFAULT_RULES];
  for (const rule of stack) {
    if (!rule || rule.action_type !== action.action_type) continue;
    if (!VALID_POLICIES.includes(rule.policy)) continue;
    if (!thresholdMet(rule.threshold, action)) continue;
    return {
      policy: rule.policy,
      channel: rule.escalation_channel || "in_app",
      matchedRule: rule,
    };
  }

  // No rule (custom or system) matched at all → safest default.
  return { policy: POLICY_AUTO, channel: "in_app", matchedRule: null };
}

/** Resolve which AuthProfile applies to the action context.
 *  Lookup precedence (most specific wins):
 *    1. mission-bound profile          (mission_on_chain_id matches)
 *    2. agent-bound profile            (agent_owner_wallet matches, mission null)
 *    3. user default profile           (is_default = TRUE)
 *  Returns the rule array, or [] if nothing's stored. */
async function loadProfileRules({ user_wallet, agent_owner_wallet, mission_on_chain_id }) {
  if (mission_on_chain_id != null) {
    const { rows } = await db.query(
      `SELECT rules_json FROM auth_profiles
        WHERE mission_on_chain_id = $1 LIMIT 1`,
      [mission_on_chain_id],
    );
    if (rows[0]) return rows[0].rules_json || [];
  }
  if (agent_owner_wallet) {
    const { rows } = await db.query(
      `SELECT rules_json FROM auth_profiles
        WHERE agent_owner_wallet = $1 AND mission_on_chain_id IS NULL LIMIT 1`,
      [agent_owner_wallet],
    );
    if (rows[0]) return rows[0].rules_json || [];
  }
  if (user_wallet) {
    const { rows } = await db.query(
      `SELECT rules_json FROM auth_profiles
        WHERE user_wallet = $1 AND is_default = TRUE LIMIT 1`,
      [user_wallet],
    );
    if (rows[0]) return rows[0].rules_json || [];
  }
  return [];
}

/** Persist an escalation row. Called when policy is `require_approval`
 *  or `notify` (the latter records the notification but doesn't expect
 *  a decision back). Returns the inserted row. */
async function freezeEscalation({
  mission_on_chain_id,
  step_seq,
  action_type,
  payload,
  channel,
  expires_at = null,
}) {
  if (!mission_on_chain_id) throw new Error("mission_on_chain_id required");
  if (!ACTION_TYPES.includes(action_type)) throw new Error("Invalid action_type");
  if (!VALID_CHANNELS.includes(channel)) throw new Error("Invalid channel");

  const { rows } = await db.query(
    `INSERT INTO mission_escalations
       (mission_on_chain_id, step_seq, action_type, payload_json,
        status, channel, expires_at, created_at)
     VALUES ($1, $2, $3, $4::jsonb, 'pending', $5, $6, NOW())
     RETURNING id, mission_on_chain_id, step_seq, action_type, status,
               channel, created_at, expires_at`,
    [
      mission_on_chain_id,
      step_seq ?? null,
      action_type,
      JSON.stringify(payload || {}),
      channel,
      expires_at,
    ],
  );
  return rows[0];
}

/** Resolve a pending escalation. Called by the TG callback handler,
 *  the in-app approval UI, or the cron expiry worker. Idempotent: a
 *  second call returns null. */
async function resolveEscalation(escalation_id, decision, decided_by_wallet, note) {
  if (!["approved", "rejected", "expired", "aborted"].includes(decision)) {
    throw new Error(`Invalid decision: ${decision}`);
  }
  const { rows } = await db.query(
    `UPDATE mission_escalations
        SET status = $2,
            decided_by_wallet = $3,
            decision_note = $4,
            decided_at = NOW()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, mission_on_chain_id, step_seq, action_type, status,
                decided_by_wallet, decided_at, channel`,
    [escalation_id, decision, decided_by_wallet || null, note || null],
  );
  return rows[0] || null;
}

async function getEscalation(escalation_id) {
  const { rows } = await db.query(
    `SELECT id, mission_on_chain_id, step_seq, action_type, payload_json,
            status, channel, tg_message_id, tg_chat_id,
            decided_by_wallet, decision_note, decided_at, created_at, expires_at
       FROM mission_escalations WHERE id = $1`,
    [escalation_id],
  );
  return rows[0] || null;
}

/** Stamp the TG message id on an escalation so the callback handler
 *  can find it again. Called by the TG dispatcher right after sending
 *  the inline-keyboard message. */
async function attachTgMessage(escalation_id, tg_chat_id, tg_message_id) {
  const { rows } = await db.query(
    `UPDATE mission_escalations
        SET tg_chat_id = $2, tg_message_id = $3
      WHERE id = $1 AND status = 'pending'
      RETURNING id`,
    [escalation_id, tg_chat_id, tg_message_id],
  );
  return rows[0] || null;
}

/** Public surface — what the orchestrator calls before each agent
 *  step. `dispatchEscalation` is injected so the engine stays
 *  testable; production wires it to the TG dispatcher. */
async function check({ action, ctx, dispatchEscalation = null }) {
  if (!action) throw new Error("action required");
  if (!ctx) throw new Error("ctx required");

  const rules = await loadProfileRules(ctx);
  const verdict = evaluateRules(rules, action);

  if (verdict.policy === POLICY_AUTO) {
    return { policy: POLICY_AUTO };
  }

  // notify + require_approval both write a row. The difference is
  // whether the orchestrator should freeze the step waiting for a
  // decision. notify rows are auto-resolved by the dispatcher.
  const escalation = await freezeEscalation({
    mission_on_chain_id: ctx.mission_on_chain_id,
    step_seq: ctx.step_seq,
    action_type: action.action_type,
    payload: action.payload || action,
    channel: verdict.channel,
  });

  if (typeof dispatchEscalation === "function") {
    try {
      await dispatchEscalation({
        escalation,
        action,
        ctx,
      });
    } catch (e) {
      console.warn("[authEngine] dispatch failed:", e.message);
    }
  }

  return {
    policy: verdict.policy,
    escalationId: escalation.id,
    channel: verdict.channel,
  };
}

module.exports = {
  POLICY_AUTO,
  POLICY_NOTIFY,
  POLICY_REQUIRE_APPROVAL,
  ACTION_TYPES,
  SYSTEM_DEFAULT_RULES,
  thresholdMet,
  evaluateRules,
  loadProfileRules,
  freezeEscalation,
  resolveEscalation,
  getEscalation,
  attachTgMessage,
  check,
};
