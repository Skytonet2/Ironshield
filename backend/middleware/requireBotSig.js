// backend/middleware/requireBotSig.js
// HMAC channel auth between the Telegram bot worker (bot/services/backend.js)
// and this backend. Every /api/tg/* route the bot calls must pass:
//   X-TG-Timestamp: <epoch_ms>
//   X-TG-Signature: hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
//
// Without this gate, anyone on the internet could hit /api/tg/claim,
// /add-wallet, /custodial/*/transfer, /reply etc. and drain bot wallets,
// impersonate users in DM threads, or eavesdrop on private DM fan-out.
// Day 9 hardening was deferred — this closes it.
//
// The matching signer lives at bot/services/backend.js (req() wrapper).
// Both sides read TELEGRAM_BOT_BACKEND_SECRET from env. Without the
// env set in production the middleware fails closed (503) — there is
// no usable mode without the secret.

const crypto = require("crypto");

const REPLAY_WINDOW_MS = 5 * 60_000;

function timingSafeEqHex(a, b) {
  let ab, bb;
  try { ab = Buffer.from(a, "hex"); bb = Buffer.from(b, "hex"); } catch { return false; }
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireBotSig(req, res, next) {
  const SECRET = process.env.TELEGRAM_BOT_BACKEND_SECRET || "";
  if (!SECRET) {
    // Fail closed in prod; in dev (no env) allow through so localhost
    // testing keeps working. Render must set the secret.
    if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
      console.error("[requireBotSig] TELEGRAM_BOT_BACKEND_SECRET unset in production");
      return res.status(503).json({ error: "bot channel not configured" });
    }
    return next();
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
  next();
}

module.exports = requireBotSig;
