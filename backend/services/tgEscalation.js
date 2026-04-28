// backend/services/tgEscalation.js
//
// TG dispatcher for auth-engine escalations. Plugged into
// authEngine.check via the `dispatchEscalation` injection point so
// the engine itself stays DB-only and unit-testable.
//
// Flow:
//   authEngine writes mission_escalations row → calls our dispatch →
//   we look up the poster's TG link → send a sendMessage with
//   two inline buttons (callback_data 'escalation:approve:<id>' and
//   'escalation:reject:<id>') → record the resulting tg_message_id
//   so the bot callback handler can map back to the row.

const tgNotify = require("./tgNotify");
const authEngine = require("./authEngine");
const db = require("../db/client");

function fmtAmount(yocto) {
  if (yocto == null) return null;
  try {
    const near = Number(BigInt(yocto)) / 1e24;
    return `${near.toFixed(4)} NEAR`;
  } catch {
    return String(yocto);
  }
}

/** Build a human-friendly escalation message. Plain text + a small
 *  sprinkling of Markdown (the rawSend helper sets parse_mode). */
function formatMessage({ escalation, action, mission }) {
  const lines = [];
  lines.push("*Action approval needed*");
  lines.push("");
  if (mission) {
    lines.push(`Mission #${mission.on_chain_id}${mission.kit_slug ? ` (${mission.kit_slug})` : ""}`);
  }
  lines.push(`Step: \`${escalation.action_type}\``);

  if (action?.amount != null) {
    const formatted = fmtAmount(action.amount);
    if (formatted) lines.push(`Amount: ${formatted}`);
  }
  if (action?.recipient_count != null) {
    lines.push(`Recipients: ${action.recipient_count}`);
  }
  if (action?.summary) {
    lines.push(`Details: ${String(action.summary).slice(0, 240)}`);
  }
  lines.push("");
  lines.push("_Reply within the review window or the action will be aborted._");
  return lines.join("\n");
}

/** Dispatcher injected into authEngine.check. Resolves the poster
 *  wallet → TG, sends the inline-keyboard message, records the
 *  message id back on the escalation row.
 *
 *  Failure modes are swallowed: if TG is unreachable or the user has
 *  no link, the escalation row remains pending and the in-app surface
 *  picks it up. The auth engine never fails because of dispatch. */
async function dispatch({ escalation, action }) {
  if (!escalation) return false;
  if (escalation.channel && escalation.channel !== "tg") return false;

  // Resolve poster wallet for this escalation's mission.
  const { rows } = await db.query(
    `SELECT poster_wallet, kit_slug, on_chain_id
       FROM missions
      WHERE on_chain_id = $1`,
    [escalation.mission_on_chain_id],
  );
  const mission = rows[0];
  if (!mission?.poster_wallet) return false;

  const text = formatMessage({ escalation, action, mission });
  const buttons = [[
    { text: "✓ Approve", callback_data: `escalation:approve:${escalation.id}` },
    { text: "✗ Reject",  callback_data: `escalation:reject:${escalation.id}`  },
  ]];

  // notifyWallet returns count, but we also need the per-link message_id.
  // tgNotify.rawSend is the lower-level call; we resolve the chat id
  // first so we can capture the message_id reliably.
  const linkRows = await db.query(
    `SELECT l.tg_chat_id
       FROM feed_tg_links l
       JOIN feed_users u ON u.id = l.user_id
      WHERE LOWER(u.wallet_address) = LOWER($1)`,
    [mission.poster_wallet],
  );
  if (!linkRows.rows.length) return false;

  let attached = false;
  for (const row of linkRows.rows) {
    const result = await tgNotify.rawSend(row.tg_chat_id, text, {
      markdown: true,
      buttons,
    });
    if (result?.message_id && !attached) {
      await authEngine.attachTgMessage(escalation.id, row.tg_chat_id, result.message_id);
      attached = true;
    }
  }
  return attached;
}

module.exports = { dispatch, formatMessage };
