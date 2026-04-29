# TG connector — compliance posture

## Auth model
Shared platform bot token (`TELEGRAM_BOT_TOKEN`). The bot acts on behalf of AZUKA, not on behalf of an end-user's Telegram identity. Per-user delivery is gated by `feed_tg_links` — a user must have linked their TG account to receive bot DMs.

## ToS posture
- Standard Telegram Bot API. No scraping, no userbot, no MTProto. We use only documented `sendMessage` flows.
- We do not impersonate humans, we do not add users to chats unsolicited, we do not deliver third-party advertising.

## Rate limits
- Telegram's documented soft limits: ~30 messages/second to different chats, ~1/second to the same chat, 20/minute to the same group.
- Enforced budget: `rate_limits.per_minute = 600` (platform-wide), bucketed by the connector hub. All callers share one bucket — the Telegram API quota is global per bot.

## Failure modes
- Token unset → `rawSend` returns `null` and logs a warning at boot. The connector still registers (dispatcher won't reject `invoke`); fan-outs become no-ops.
- Telegram API errors are swallowed at the `tgNotify` layer (warning log only). The connector returns the underlying result or `null`.

## PII / data handling
- We do not log message bodies.
- `tg_chat_id` is stored in plaintext alongside `feed_users` because chat IDs are not secrets.
- Reply mapping (`feed_tg_reply_map`) holds chat + message IDs only — no message content.

## Known gaps
- No automated detection of users who block our bot. A blocked user gets `bot was blocked by the user` from the API; we log+drop. Cleanup of dead `feed_tg_links` rows is manual.
