// backend/middleware/requireBotSig.js
// HMAC channel auth between the Telegram bot worker (bot/services/backend.js)
// and this backend. Every /api/tg/* route the bot calls passes:
//   X-TG-Timestamp: <epoch_ms>
//   X-TG-Signature: hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
//
// Opt-in gate: enforcement is gated on TG_REQUIRE_BOT_SIG=1.
// Default off so the backend doesn't lock out a bot worker that
// hasn't been redeployed with the matching secret yet — flip on
// once the bot side ships TELEGRAM_BOT_BACKEND_SECRET.
//
// When off, /api/tg/* are public again — that's the pre-Day-9 state.
// The wallet-shortcut + ownership-proof fixes on /claim and /reply
// still apply, so the eavesdropping + identity-theft holes stay
// closed. The remaining holes (custodial drain, watchlist tampering)
// re-open until the gate flips on.

const crypto = require("crypto");

const REPLAY_WINDOW_MS = 5 * 60_000;

function timingSafeEqHex(a, b) {
  let ab, bb;
  try { ab = Buffer.from(a, "hex"); bb = Buffer.from(b, "hex"); } catch { return false; }
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireBotSig(req, res, next) {
  const ENABLED = ["1", "true", "yes"].includes(
    String(process.env.TG_REQUIRE_BOT_SIG || "").toLowerCase()
  );
  if (!ENABLED) return next();

  const SECRET = process.env.TELEGRAM_BOT_BACKEND_SECRET || "";
  if (!SECRET) {
    console.error("[requireBotSig] TG_REQUIRE_BOT_SIG=1 but TELEGRAM_BOT_BACKEND_SECRET unset");
    return res.status(503).json({ error: "bot channel not configured" });
  }
  const sig = req.header("x-tg-signature") || "";
  const ts  = req.header("x-tg-timestamp") || "";
  if (!sig || !ts) return res.status(401).json({ error: "missing bot signature", code: "missing-bot-sig" });

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > REPLAY_WINDOW_MS) {
    return res.status(401).json({ error: "stale or future bot signature", code: "stale-bot-sig" });
  }

  const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
  const expected = crypto.createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  if (!timingSafeEqHex(expected, sig)) {
    return res.status(401).json({ error: "bad bot signature", code: "bad-bot-sig" });
  }
  return next();
}

module.exports = requireBotSig;
