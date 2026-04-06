// bot/commands/summary.js
const fetch     = require("node-fetch");
const formatter = require("../utils/formatter");
const BACKEND   = process.env.BACKEND_URL || "http://localhost:3001";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text   = msg.text || "";
  const args   = text.replace(/^\/summary\s*/i, "").trim();

  let source     = "group";
  let identifier = chatId.toString();
  let range      = "24h";

  if (args.startsWith("@")) {
    source     = "group";
    identifier = args.split(" ")[0];
    range      = "24h";
  } else if (args.includes("last") || args.includes("24h") || args.includes("7d")) {
    range = args.includes("7d") ? "7d" : "24h";
  } else if (args === "this chat") {
    source     = "group";
    identifier = chatId.toString();
    range      = "24h";
  }

  const waitMsg = await bot.sendMessage(chatId, "⏳ Generating summary...");

  try {
    const res  = await fetch(`${BACKEND}/api/summary`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ source, identifier, range, userId, requestedVia: "telegram" }),
    });
    const json = await res.json();
    await bot.deleteMessage(chatId, waitMsg.message_id);
    if (json.success) {
      await bot.sendMessage(chatId, formatter.formatSummary(json.data), { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, `⚠️ ${json.error || "Summary failed. Please try again."}`);
    }
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Summary failed. Please try again.");
  }
}

module.exports = { handle };
