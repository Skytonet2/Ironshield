# X (Twitter) connector — compliance posture

## Auth model
- **App bearer (`X_BEARER_TOKEN`)** — read-only paths (`search`, `mentions` fallback). Required at platform level.
- **User OAuth 2.0 access tokens** — for `post` and `dm`. Stored encrypted per-wallet in `connector_credentials` (AES-256-GCM under `CUSTODIAL_ENCRYPT_KEY`). Refresh tokens stored alongside; refresh worker (post-MVP) re-mints before expiry.

## ToS posture
- Official X API v2 only. No scraping of x.com, no reverse-engineered private endpoints, no Nitter mirrors.
- Per [X Developer Agreement](https://developer.x.com/en/developer-terms): we do not redistribute Tweet content beyond the calling user, do not aggregate users into profiles for resale, and do not derivative-cache more than what the API explicitly permits.
- DM sends are gated on user OAuth — we never DM from a platform-shared identity.
- Mass-following / mass-unfollowing / spam-like patterns are not implemented and not on the roadmap.

## Rate limits
- Free tier (current default): 60/15min app for search, 17/24h app for post — hostile for production. Production deployments should be on at least the Basic tier.
- `rate_limits.per_minute = 12, per_hour = 180`, scope `wallet`. The hub picks the tightest binding (per_hour wins → ~3/min sustained), comfortable inside the user-context bucket. Bursts up to 12 in a minute are absorbed by the bucket.
- Tighten the rate hub config before production traffic exceeds beta volume. The defaults will not survive a popular Realtor / Car-Sales Kit at scale on the Free tier.

## Failure modes
- Bearer unset → `search` throws `x: no bearer/user token available`. Connector still registers. Caller should catch and skip.
- User token missing → `post` / `dm` throw `no user token for wallet — connect X first`. UX must route the user to `/api/connectors/x/connect` before invoking.
- 401 from X → likely token revoked or expired without refresh. The dispatcher returns `err.status = 401`; the connect flow should re-mint.
- 429 from X → upstream rate limit. We don't retry inside the connector — the rate hub already throttles us; a 429 means we underestimated the user's existing burn from outside our app.

## PII / data handling
- Tweet bodies, search queries, and user IDs flow through but are not persisted in IronShield logs.
- `access_token` and `refresh_token` are NEVER logged. Decrypt path runs server-side only.
- DM bodies are end-to-end visible to X — we are not a privacy-preserving channel.

## Known gaps
- No automatic OAuth refresh worker yet (lands with `/api/connectors/:name/connect`).
- No backoff on 429 — upstream caller sees the error. Acceptable for MVP; queueing with respect-of-`Retry-After` is a follow-up.
- No webhook subscription for streaming mentions (PowerTrack / Filtered Stream require an Enterprise plan we don't have).
