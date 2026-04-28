// bot/commands/missions.js — Phase 10 Agent Economy
//
// /missions   list active missions for the linked wallet
// /missions <id>   show one mission's status + audit-step count

const { tg, economy, BACKEND } = require("../services/backend");
const { shortWallet } = require("../utils/wallet");

const STATUS_EMOJI = {
  open:      "🟢",
  claimed:   "🛠",
  submitted: "📨",
  approved:  "✅",
  rejected:  "❌",
  expired:   "⌛",
  aborted:   "🚫",
};

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const tgId = msg.from?.id;
  if (!tgId) return;

  const text = msg.text || "";
  const parts = text.trim().split(/\s+/);
  if (parts[1] && /^\d+$/.test(parts[1])) {
    return handleOne(bot, chatId, parts[1]);
  }

  const s = await tg.settings(tgId);
  const wallets = s.ok ? (s.wallets || []) : [];
  if (!wallets.length) {
    return bot.sendMessage(
      chatId,
      "No wallet linked. Add one first — paste a NEAR address here or use /addwallet.",
    );
  }
  const active = s.activeWallet || wallets[0];
  const r = await economy.missions(active);
  if (!r.ok) {
    return bot.sendMessage(chatId, `Couldn't load missions: ${r.error || "unknown error"}`);
  }
  const list = r.missions || [];
  if (!list.length) {
    return bot.sendMessage(
      chatId,
      `No missions yet for \`${shortWallet(active)}\`. Post one at ${BACKEND.replace(/\/$/, "")}/missions.`,
      { parse_mode: "Markdown" },
    );
  }

  const lines = [`*Missions for ${shortWallet(active)}*`];
  for (const m of list.slice(0, 10)) {
    const emoji = STATUS_EMOJI[m.status] || "•";
    lines.push(
      `${emoji} #${m.on_chain_id} _${m.status}_${m.kit_slug ? ` · ${m.kit_slug}` : ""}`,
    );
  }
  if (list.length > 10) lines.push(`…and ${list.length - 10} more`);
  await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
}

async function handleOne(bot, chatId, id) {
  const r = await economy.mission(id);
  if (!r.ok) {
    return bot.sendMessage(chatId, `Mission #${id} — ${r.error || "not found"}`);
  }
  const m = r.mission || {};
  const audit = r.audit || [];
  const escalations = (r.escalations || []).filter(e => e.status === "pending");
  const lines = [];
  lines.push(`*Mission #${m.on_chain_id}*`);
  lines.push(`Status: ${STATUS_EMOJI[m.status] || ""} \`${m.status}\``);
  if (m.kit_slug) lines.push(`Kit: \`${m.kit_slug}\``);
  if (m.template_slug) lines.push(`Template: \`${m.template_slug}\``);
  if (m.claimant_wallet) lines.push(`Claimant: \`${shortWallet(m.claimant_wallet)}\``);
  lines.push(`Steps logged: ${audit.length}`);
  if (escalations.length) {
    lines.push("");
    lines.push(`⚠️ ${escalations.length} pending escalation${escalations.length > 1 ? "s" : ""}`);
  }
  await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
}

module.exports = { handle };
