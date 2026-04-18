// backend/services/tgNotify.js — Telegram notification fan-out
//
// Resolves a feed_users.id (or wallet address) to any linked Telegram
// accounts and sends a message to each — respecting the per-user
// settings toggle map. This is the single entry point the rest of
// the backend uses for TG side-channel notifications.

const fetch = require("node-fetch");
const db = require("../db/client");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

if (!TOKEN) {
  console.warn("[tgNotify] TELEGRAM_BOT_TOKEN not set — Telegram alerts disabled");
}

/** Low-level send. Escapes nothing — callers pass pre-formatted Markdown. */
async function rawSend(chatId, text, { markdown = true, keyboard, buttons } = {}) {
  if (!API || !chatId) return null;
  try {
    const body = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
    if (markdown) body.parse_mode = "Markdown";
    if (keyboard) body.reply_markup = { keyboard, resize_keyboard: true };
    if (buttons) body.reply_markup = { inline_keyboard: buttons };
    const r = await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.warn("[tgNotify] send failed:", j.description);
    return j.result || null;
  } catch (e) {
    console.warn("[tgNotify] error:", e.message);
    return null;
  }
}

/**
 * Notify a feed user (by feed_users.id) across all their linked TG
 * accounts, filtered by the given setting key.
 */
async function notifyFeedUser(userId, settingKey, text, opts = {}) {
  if (!API || !userId) return 0;
  try {
    const r = await db.query(
      `SELECT tg_id, tg_chat_id, settings
         FROM feed_tg_links
        WHERE user_id = $1`,
      [userId]
    );
    let sent = 0;
    for (const row of r.rows) {
      const s = row.settings || {};
      if (settingKey && s[settingKey] === false) continue;
      const result = await rawSend(row.tg_chat_id, text, opts);
      if (result) {
        sent++;
        // Save message_id when caller asked for DM reply-relay so the
        // bot can map replies back to the original conversation.
        if (result.message_id && opts.replyMapConversationId) {
          db.query(
            `INSERT INTO feed_tg_reply_map (tg_msg_id, tg_chat_id, conversation_id, user_id)
             VALUES ($1,$2,$3,$4) ON CONFLICT (tg_msg_id) DO NOTHING`,
            [result.message_id, row.tg_chat_id, opts.replyMapConversationId, userId]
          ).catch(() => {});
        }
      }
    }
    return sent;
  } catch (e) {
    console.warn("[tgNotify] notifyFeedUser:", e.message);
    return 0;
  }
}

/** Notify by wallet — resolves wallet → feed_users.id → TG links. */
async function notifyWallet(wallet, settingKey, text, opts = {}) {
  if (!API || !wallet) return 0;
  const r = await db.query(
    "SELECT id FROM feed_users WHERE LOWER(wallet_address) = LOWER($1) LIMIT 1",
    [wallet]
  );
  if (!r.rows.length) return 0;
  return notifyFeedUser(r.rows[0].id, settingKey, text, opts);
}

/** Broadcast — e.g. "Alpha news" or "Site down". */
async function broadcast(settingKey, text, opts = {}) {
  if (!API) return 0;
  const r = await db.query(
    "SELECT tg_chat_id, settings FROM feed_tg_links"
  );
  let sent = 0;
  for (const row of r.rows) {
    const s = row.settings || {};
    if (settingKey && s[settingKey] === false) continue;
    const res = await rawSend(row.tg_chat_id, text, opts);
    if (res) sent++;
  }
  return sent;
}

module.exports = { rawSend, notifyFeedUser, notifyWallet, broadcast };
