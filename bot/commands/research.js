// bot/commands/research.js
const fetch     = require("node-fetch");
const formatter = require("../utils/formatter");
const BACKEND   = process.env.BACKEND_URL || "http://localhost:3001";

const CONTRACT_REGEX = /^0x[a-fA-F0-9]{40}$/;

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text   = msg.text || "";

  // Extract query — strip command, bot mention, and natural language prefixes
  const query = text
    .replace(/^\/research(@\w+)?\s*/i, "")
    .replace(/^(research|analyse|analyze|check token|tell me about)\s*/i, "")
    .trim();

  if (!query) {
    return bot.sendMessage(chatId, "Usage: /research TOKEN or /research 0xContractAddress");
  }

  const queryType = CONTRACT_REGEX.test(query) ? "contract" : query.startsWith("$") ? "ticker" : "project_name";
  const cleanQuery = query.replace(/^\$/, "");

  const waitMsg = await bot.sendMessage(chatId, `🔍 Researching *${cleanQuery}*...`, { parse_mode: "Markdown" });

  try {
    const res  = await fetch(`${BACKEND}/api/research`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ query: cleanQuery, queryType, userId, chain: "auto" }),
    });
    const json = await res.json();
    await bot.deleteMessage(chatId, waitMsg.message_id);
    if (json.success) {
      await bot.sendMessage(chatId, formatter.formatResearch(json.data), { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, `⚠️ ${json.error || "Research failed. Please try again."}`);
    }
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Research failed. Please try again.");
  }
}

module.exports = { handle };
