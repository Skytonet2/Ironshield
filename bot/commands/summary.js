// bot/commands/summary.js
// Fetches REAL messages from the chat, then sends them to the AI for summarization.
const fetch     = require("node-fetch");
const formatter = require("../utils/formatter");
const BACKEND   = process.env.BACKEND_URL || "http://localhost:3001";

// Maximum messages to collect for context
const MAX_MESSAGES = 100;

/**
 * Collect recent messages from a Telegram chat using getUpdates history
 * or by reading from the bot's message cache.
 * For groups the bot is in, we store messages as they arrive.
 */
const messageBuffer = new Map(); // chatId -> [{ from, text, date }]

function recordMessage(msg) {
  if (!msg.text || msg.text.startsWith("/")) return;
  const chatId = msg.chat.id.toString();
  if (!messageBuffer.has(chatId)) messageBuffer.set(chatId, []);
  const buf = messageBuffer.get(chatId);
  buf.push({
    from: msg.from?.first_name || msg.from?.username || "Unknown",
    text: msg.text,
    date: msg.date,
  });
  // Keep only last MAX_MESSAGES
  if (buf.length > MAX_MESSAGES) buf.splice(0, buf.length - MAX_MESSAGES);
}

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const text   = msg.text || "";
  const args   = text.replace(/^\/summarize?(@\w+)?\s*/i, "").trim();

  // Determine time range
  let hours = 24;
  if (args.includes("7d")) hours = 168;
  else if (args.includes("1h")) hours = 1;
  else if (args.includes("12h")) hours = 12;

  const rangeLabel = hours >= 168 ? "7d" : `${hours}h`;

  const waitMsg = await bot.sendMessage(chatId, "⏳ Collecting messages and generating summary...");

  try {
    // Get buffered messages for this chat
    const chatKey  = chatId.toString();
    const messages = messageBuffer.get(chatKey) || [];

    // Filter by time range
    const cutoff    = Math.floor(Date.now() / 1000) - (hours * 3600);
    const recent    = messages.filter(m => m.date >= cutoff);

    if (recent.length < 3) {
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId,
        `⚠️ Not enough messages to summarize (found ${recent.length}).\n\n` +
        `IronClaw needs to observe messages in this chat first. Keep chatting and try again later.\n` +
        `_Tip: IronClaw records messages as they come in. The longer it's in the group, the better the summaries._`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Format messages as transcript for the AI
    const transcript = recent
      .map(m => `[${new Date(m.date * 1000).toISOString().slice(11, 16)}] ${m.from}: ${m.text}`)
      .join("\n");

    // Send real messages to backend for AI analysis
    const res  = await fetch(`${BACKEND}/api/summary`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        identifier: chatKey,
        range: rangeLabel,
        userId: msg.from.id.toString(),
        messageCount: recent.length,
        transcript,
        requestedVia: "telegram",
      }),
    });
    const json = await res.json();
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

    if (json.success) {
      const header = `📋 Recent Message Summary from ${msg.chat.title || chatKey} (${rangeLabel})\n` +
                     `_Based on ${recent.length} messages_\n\n`;
      await bot.sendMessage(chatId, header + formatter.formatSummary(json.data), { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, `⚠️ ${json.error || "Summary failed. Please try again."}`);
    }
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Summary failed. Please try again.");
  }
}

module.exports = { handle, recordMessage, messageBuffer };
