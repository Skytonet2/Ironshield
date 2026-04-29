// bot/attach.js — mount the IronShield Telegram bot inside the main
// backend's Express app instead of running it as a separate process.
//
// Why: render.yaml declares an `ironshield-worker-bot` service but
// it was never created in the Render UI (Day 3.5 caveat). The main
// `ironclaw-backend` web service is the only thing actually running
// in production, so the bot has been silently offline since launch.
// Folding it into the main backend means TG commands work without
// spinning up (and paying for) a second Render service.
//
// Standalone `bot/index.js` is preserved for local dev (`npm run bot`).
// In production, server.js calls `attachBot(app)` which:
//   - Builds the TelegramBot in webhook mode (no polling — same hostname
//     can't run polling AND webhook anyway).
//   - Mounts POST /tg/webhook/:secret on the existing app.
//   - Registers setWebhook() once on boot, cached in agent_state so we
//     don't pound Telegram's API on every restart.
//   - Wires the same message + callback handlers and background jobs
//     the standalone bot uses.
//
// Required env to start:
//   - TELEGRAM_BOT_TOKEN
//   - TELEGRAM_WEBHOOK_SECRET
//   - WEBHOOK_URL (public hostname, e.g. https://ironclaw-backend.onrender.com)
// Missing any of those → attach is a no-op (logged, not fatal — the
// rest of the backend keeps booting). That way a deploy without bot
// creds still ships, the bot just stays offline.

const crypto = require("crypto");
const TelegramBot = require("node-telegram-bot-api");
const { handleCommand }  = require("./handlers/commandHandler");
const { handleMessage }  = require("./handlers/messageHandler");
const { handleDM }       = require("./handlers/dmHandler");
const { handleCallback } = require("./handlers/callbackHandler");
const { recordMessage }  = require("./commands/summary");
// Phase 10 Tier 5 — bridge inbound TG messages to the scout_tg
// skill's ring buffer. Lazy-required so a bot deploy without the
// backend connector framework loaded still boots.
//
// Two-tier delivery:
//   1. In-process eventBus (fast, zero-RTT) when backend is co-located.
//   2. HTTP POST fallback to BACKEND_INBOUND_URL when the bot runs in a
//      separate Render service. Gated by ORCHESTRATOR_SHARED_SECRET.
//   3. If neither works, log a one-shot warning so an operator notices
//      that scout_tg's ring buffer will never fill.
let _connectorEventBus = null;
try { _connectorEventBus = require("../backend/services/eventBus"); } catch { /* optional */ }
const _BACKEND_INBOUND_URL = (process.env.BACKEND_INBOUND_URL || "").replace(/\/$/, "");
const _ORCH_SECRET = process.env.ORCHESTRATOR_SHARED_SECRET || "";
let _fallbackWarned = false;

async function _emitTgMessage(envelope) {
  // Fast path — in-process bus.
  if (_connectorEventBus?.emit) {
    try { _connectorEventBus.emit("connector:tg:message", envelope); return; }
    catch { /* fall through to HTTP */ }
  }
  // HTTP fallback — only if both env vars are set.
  if (_BACKEND_INBOUND_URL && _ORCH_SECRET) {
    try {
      await fetch(`${_BACKEND_INBOUND_URL}/api/connectors/tg/inbound`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orchestrator-secret": _ORCH_SECRET,
        },
        body: JSON.stringify(envelope),
      });
      return;
    } catch (e) {
      // Don't break the primary handler.
      console.warn("[bot] tg/inbound HTTP fallback failed:", e.message);
      return;
    }
  }
  if (!_fallbackWarned) {
    _fallbackWarned = true;
    console.warn("[bot] WARNING: backend eventBus not loadable AND HTTP fallback unset (BACKEND_INBOUND_URL + ORCHESTRATOR_SHARED_SECRET). scout_tg ring buffer will not fill — Freelancer Hunter Kit's TG scout will be permanently degraded.");
  }
}
const agentState = require("../backend/db/agentState");

const priceMonitor    = require("./jobs/priceMonitor");
const pumpMonitor     = require("./jobs/pumpMonitor");
const dailyDigest     = require("./jobs/dailyDigest");
const downtimeMonitor = require("./jobs/downtimeMonitor");

const COMMAND_MENU = [
  { command: "start",     description: "Link your wallet & get started" },
  { command: "balance",   description: "Your custodial balance" },
  { command: "deposit",   description: "Deposit to your trading account" },
  { command: "buy",       description: "Buy a token (alias for /swap)" },
  { command: "swap",      description: "Swap one token for another" },
  { command: "send",      description: "Send tokens to an address" },
  { command: "withdraw",  description: "Withdraw to your main wallet" },
  { command: "activate",  description: "Activate trading ($5 NEAR)" },
  { command: "portfolio", description: "Instant portfolio overview" },
  { command: "wallets",   description: "Switch or list linked wallets" },
  { command: "addwallet", description: "Add another wallet" },
  { command: "settings",  description: "Toggle notification types" },
  { command: "watch",     description: "Watch a token or user" },
  { command: "watchlist", description: "Your watchlist" },
  { command: "alert",     description: "Price alerts" },
  { command: "tip",       description: "Send a tip from Telegram" },
  { command: "digest",    description: "24h activity digest" },
  { command: "vote",      description: "List + vote on governance proposals" },
  { command: "research",  description: "Research any token" },
  { command: "summary",   description: "Summarize recent chat" },
  { command: "trending",  description: "Live market signals" },
  { command: "scan",      description: "Scan a URL or wallet" },
  { command: "verify",    description: "Fact-check a claim" },
  { command: "report",    description: "Report a scam" },
  { command: "help",      description: "Show all commands" },
  { command: "status",    description: "Bot health" },
];

let attached = null;

function attachBot(app) {
  if (attached) return attached;

  const TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
  const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const WEBHOOK_URL = (process.env.WEBHOOK_URL || "").replace(/\/+$/, "");

  if (!TOKEN || !SECRET || !WEBHOOK_URL) {
    console.warn("[bot] not started — missing TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, or WEBHOOK_URL");
    return null;
  }

  const bot = new TelegramBot(TOKEN, { polling: false });

  // Webhook handler. Constant-time secret compare so a leaked log
  // line doesn't grant the leaker access. Bad secret returns 403
  // without telling the caller anything — a known bot endpoint that
  // accepts arbitrary bodies would be a spam sink otherwise.
  app.post("/tg/webhook/:secret", (req, res) => {
    const provided = Buffer.from(req.params.secret || "", "utf8");
    const expected = Buffer.from(SECRET, "utf8");
    const ok = provided.length === expected.length &&
               crypto.timingSafeEqual(provided, expected);
    if (!ok) return res.status(403).end();
    try { bot.processUpdate(req.body); } catch (e) {
      console.error("[bot] processUpdate:", e.message);
    }
    res.status(200).end();
  });

  // Health probe so the runbook can verify the bot is mounted without
  // sending a real Telegram update.
  app.get("/tg/health", (_req, res) => res.json({ ok: true, attached: true }));

  // Message + callback dispatch. Same code path the standalone
  // bot/index.js uses — we share handlers, only the transport
  // changes.
  bot.on("message", async (msg) => {
    try {
      const isGroup   = msg.chat.type !== "private";
      const isCommand = msg.text?.startsWith("/");
      if (!isCommand && msg.text) recordMessage(msg);
      // Fan out non-command messages to the scout_tg skill's ring
      // buffer via _emitTgMessage (in-process bus → HTTP fallback).
      // Best-effort: failures don't kill the primary bot dispatch.
      if (!isCommand && msg.text) {
        _emitTgMessage({
          chat_id:    msg.chat.id,
          chat_title: msg.chat.title || null,
          chat_type:  msg.chat.type,
          from_user:  msg.from?.first_name || null,
          from_username: msg.from?.username || null,
          text:       msg.text,
          message_id: msg.message_id,
        }).catch(() => {});
      }
      if (isCommand)      await handleCommand(bot, msg);
      else if (isGroup)   await handleMessage(bot, msg);
      else                await handleDM(bot, msg);
    } catch (err) {
      console.error("[bot] message handler:", err.message);
    }
  });

  bot.on("callback_query", async (cq) => {
    try { await handleCallback(bot, cq); }
    catch (err) { console.error("[bot] callback handler:", err.message); }
  });

  // Register commands menu + setWebhook on boot. Both are best-effort —
  // if Telegram's API is flaky on startup, the bot still receives
  // updates (the webhook URL just doesn't update on this restart),
  // and the commands menu is cosmetic.
  bot.setMyCommands(COMMAND_MENU)
     .then(() => console.log("[bot] commands menu registered"))
     .catch((e) => console.warn("[bot] setMyCommands failed:", e.message));

  (async () => {
    const fullUrl = `${WEBHOOK_URL}/tg/webhook/${SECRET}`;
    let cached = null;
    try { cached = await agentState.get("tgWebhookUrl"); } catch {}
    if (cached?.url === fullUrl) {
      console.log(`[bot] webhook URL unchanged (cached), skipping setWebHook`);
      return;
    }
    try {
      await bot.setWebHook(fullUrl);
      await agentState.set("tgWebhookUrl", { url: fullUrl, setAt: new Date().toISOString() });
      console.log(`[bot] webhook registered at ${WEBHOOK_URL}/tg/webhook/<secret>`);
    } catch (e) {
      console.warn("[bot] setWebHook failed:", e.message);
    }
  })();

  // Background jobs. Each guarded — a misconfigured price monitor
  // shouldn't take down the whole backend. Ops sees the warning if
  // any of them fail to wire up.
  try { priceMonitor.start(bot); }    catch (e) { console.warn("[bot] priceMonitor:", e.message); }
  try { pumpMonitor.start(bot); }     catch (e) { console.warn("[bot] pumpMonitor:", e.message); }
  try { dailyDigest.start(bot); }     catch (e) { console.warn("[bot] dailyDigest:", e.message); }
  try { downtimeMonitor.start(bot); } catch (e) { console.warn("[bot] downtimeMonitor:", e.message); }

  attached = bot;
  console.log("[bot] attached to backend (webhook mode)");
  return bot;
}

module.exports = { attachBot };
