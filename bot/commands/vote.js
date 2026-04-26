// bot/commands/vote.js — list governance proposals and link out to vote
//
// `/vote`        → list active proposals with title, type, time-left, and a
//                  deep link to /governance for each.
// `/vote <id>`   → single-proposal detail with vote tallies + a For/Against
//                  pair of buttons that open the web governance page on the
//                  right proposal (the actual on-chain vote() call needs a
//                  signed wallet tx; the bot doesn't carry that key).
//
// Day 9: rounds out the command set the sprint plan asks for. Built thin on
// top of the existing /api/governance/proposals route — no new backend.

const fetch = require("node-fetch");
const { BACKEND } = require("../services/backend");

const WEB_BASE = process.env.IRONSHIELD_WEB_URL || "https://ironshield.near.page";
const GOVERNANCE_PATH = "/#/Governance"; // matches the legacy hash route the AppShell mounts

function timeLeft(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "ended";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

function statusEmoji(status) {
  switch (status) {
    case "active":   return "🗳️";
    case "passed":   return "✅";
    case "rejected": return "❌";
    case "executed": return "🚀";
    default:         return "•";
  }
}

async function fetchProposals(filter = "") {
  const url = `${BACKEND}/api/governance/proposals${filter ? `?${filter}` : ""}`;
  const r = await fetch(url, { timeout: 8_000 });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.success) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.data || [];
}

async function fetchProposal(id) {
  const r = await fetch(`${BACKEND}/api/governance/proposals/${encodeURIComponent(id)}`, { timeout: 8_000 });
  const j = await r.json().catch(() => null);
  if (r.status === 404) return null;
  if (!r.ok || !j?.success) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.data || null;
}

async function handleList(bot, chatId) {
  const wait = await bot.sendMessage(chatId, "🗳️ Pulling active proposals…");
  let proposals;
  try { proposals = await fetchProposals("status=active"); }
  catch (e) {
    await bot.deleteMessage(chatId, wait.message_id).catch(() => {});
    return bot.sendMessage(chatId, `⚠️ Couldn't reach governance: ${e.message}`);
  }
  await bot.deleteMessage(chatId, wait.message_id).catch(() => {});

  if (!proposals.length) {
    return bot.sendMessage(chatId, "No active proposals right now. Past results: " +
      `${WEB_BASE}${GOVERNANCE_PATH}`, { disable_web_page_preview: true });
  }

  // Bound the response so a sudden flurry of proposals doesn't blow up
  // a single TG message. Telegram caps at 4096 chars per message.
  const top = proposals.slice(0, 8);
  const lines = top.map((p) => {
    const left = timeLeft(p.expires_at);
    const meta = [p.proposal_type, left].filter(Boolean).join(" · ");
    return `${statusEmoji(p.status)} *#${p.id}* ${p.title}\n   _${meta}_  →  /vote ${p.id}`;
  });
  const more = proposals.length > top.length
    ? `\n\n…and ${proposals.length - top.length} more on the web.`
    : "";

  await bot.sendMessage(chatId,
    `*Active proposals*\n\n${lines.join("\n\n")}${more}`,
    {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[
          { text: "🌐 Open governance", url: `${WEB_BASE}${GOVERNANCE_PATH}` },
        ]],
      },
    },
  );
}

async function handleDetail(bot, chatId, idRaw) {
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id < 0) {
    return bot.sendMessage(chatId, "Usage: /vote <id>  — see /vote for the list.");
  }

  const wait = await bot.sendMessage(chatId, `🗳️ Loading proposal #${id}…`);
  let p;
  try { p = await fetchProposal(id); }
  catch (e) {
    await bot.deleteMessage(chatId, wait.message_id).catch(() => {});
    return bot.sendMessage(chatId, `⚠️ ${e.message}`);
  }
  await bot.deleteMessage(chatId, wait.message_id).catch(() => {});

  if (!p) return bot.sendMessage(chatId, `No proposal #${id} found.`);

  const left = timeLeft(p.expires_at);
  const desc = (p.description || "").slice(0, 400);
  const tally = `*${Number(p.votes_for || 0).toFixed(2)}* for · *${Number(p.votes_against || 0).toFixed(2)}* against`;
  const header = `${statusEmoji(p.status)} *Proposal #${p.id}* — ${p.title}\n_${[p.proposal_type, p.status, left].filter(Boolean).join(" · ")}_`;
  const body = [header, "", desc || "_(no description)_", "", tally].join("\n");

  // Voting on-chain needs a signed wallet tx; the bot doesn't carry the
  // signing key. Both buttons deep-link to the web governance page on
  // the specific proposal so the user can finalize the vote with their
  // wallet of choice. Web-side voting respects the same NEP-413 auth
  // every other mutating route uses.
  const votingClosed = p.status !== "active" || left === "ended";
  const kb = votingClosed
    ? [[ { text: "🌐 View on web", url: `${WEB_BASE}${GOVERNANCE_PATH}?proposal=${p.id}` } ]]
    : [[
        { text: "👍 Vote For",     url: `${WEB_BASE}${GOVERNANCE_PATH}?proposal=${p.id}&vote=for` },
        { text: "👎 Vote Against", url: `${WEB_BASE}${GOVERNANCE_PATH}?proposal=${p.id}&vote=against` },
      ]];

  await bot.sendMessage(chatId, body, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: kb },
  });
}

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const parts = (msg.text || "").trim().split(/\s+/);
  if (parts.length < 2) return handleList(bot, chatId);
  return handleDetail(bot, chatId, parts[1]);
}

module.exports = { handle };
