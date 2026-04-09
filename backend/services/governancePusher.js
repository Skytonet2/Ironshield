// backend/services/governancePusher.js
// Pushes governance lifecycle events to a Telegram channel.
//
// Required env vars:
//   TELEGRAM_BOT_TOKEN          — same token the main bot uses
//   TELEGRAM_GOVERNANCE_CHAT_ID — channel ID or @channelname
//
// If either is missing, push functions are no-ops so the listener still
// works in headless mode.

let bot = null;
let chatId = null;

function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  chatId      = process.env.TELEGRAM_GOVERNANCE_CHAT_ID;
  if (!token || !chatId) return null;
  try {
    const TelegramBot = require("node-telegram-bot-api");
    bot = new TelegramBot(token, { polling: false });
    console.log(`[governancePusher] Telegram pusher armed → ${chatId}`);
    return bot;
  } catch (err) {
    console.error(`[governancePusher] Failed to init Telegram bot: ${err.message}`);
    return null;
  }
}

const escapeMd = (s = "") => String(s)
  .replace(/_/g,  "\\_")
  .replace(/\*/g, "\\*")
  .replace(/`/g,  "\\`")
  .replace(/\[/g, "\\[");

const truncate = (s = "", n = 280) => {
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

const TYPE_EMOJI = {
  Mission:      "🎯",
  PromptUpdate: "🧠",
  RuleChange:   "⚙️",
};

async function send(text) {
  const b = getBot();
  if (!b) return;
  try {
    await b.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error(`[governancePusher] sendMessage failed: ${err.message}`);
  }
}

function pushProposalCreated(p) {
  const emoji = TYPE_EMOJI[p.proposal_type] || "📜";
  const ends  = new Date(Number(p.expires_at) / 1_000_000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return send(
    `${emoji} *New Governance Proposal #${p.id}*\n` +
    `*${escapeMd(p.title)}*\n` +
    `Type: \`${p.proposal_type}\`\n` +
    `Proposer: \`${p.proposer}\`\n` +
    `Voting ends: ${ends}\n\n` +
    `${escapeMd(truncate(p.content))}\n\n` +
    `Cast your vote: ironshield.near.page/governance`
  );
}

function pushProposalFinalized(p) {
  const emoji  = p.passed ? "✅" : "❌";
  const result = p.passed ? "PASSED" : "REJECTED";
  return send(
    `${emoji} *Proposal #${p.id} ${result}*\n` +
    `*${escapeMd(p.title)}*\n` +
    `For: ${p.votes_for}  ·  Against: ${p.votes_against}\n` +
    (p.passed ? `Will execute shortly.` : `No further action.`)
  );
}

function pushProposalExecuted(p) {
  const emoji = TYPE_EMOJI[p.proposal_type] || "⚡";
  let summary;
  if (p.proposal_type === "Mission")        summary = `IronClaw's mission has been updated.`;
  else if (p.proposal_type === "PromptUpdate") summary = `IronClaw's AI system prompt has been updated.`;
  else if (p.proposal_type === "RuleChange") summary = `An IronClaw rule has been changed.`;
  else                                      summary = `Proposal executed.`;

  return send(
    `${emoji} *Proposal #${p.id} EXECUTED*\n` +
    `*${escapeMd(p.title)}*\n` +
    `${summary}\n\n` +
    `${escapeMd(truncate(p.content))}`
  );
}

module.exports = {
  pushProposalCreated,
  pushProposalFinalized,
  pushProposalExecuted,
};
