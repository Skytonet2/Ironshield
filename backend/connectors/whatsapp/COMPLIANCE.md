# WhatsApp Business connector — compliance posture

## Auth model
**BYO Business Account.** The user provides:
- A permanent **system-user access token** issued from their Meta Business Manager.
- A **phone number ID** (the WhatsApp Business phone they've registered with Meta).
- A **WhatsApp Business Account (WABA) ID**.
- Optionally, an **app secret** for inbound webhook signature verification.

Stored encrypted per-wallet in `connector_credentials` (AES-256-GCM under `CUSTODIAL_ENCRYPT_KEY`).

We never share platform credentials across users. Every WhatsApp action is sent from the user's own registered phone.

## ToS posture
- **Cloud API only.** No Business API ((on-prem)), no scraping, no userbot, no third-party gateways routing through unofficial channels.
- **24-hour customer-service window** strictly enforced: free-form `send` works only after the recipient messaged the user's WhatsApp Business number within the last 24h. Outside that window we only send pre-approved **template messages** via `send_template`.
- **Templates require prior Meta approval** — we never auto-bypass approval. The user submits templates through Meta Business Manager.
- We do not implement bulk number-discovery / scraping of WhatsApp users. Recipients come from the user's own contact lists.
- We respect inbound STOP / opt-out signals: a `stopped` status from Meta should be propagated to the user's outreach Kit so it stops sending. Implementation lives in the Kit, not the connector.

## Webhook receiver
`backend/connectors/whatsapp/webhook.js` exports:
- `handleVerify` — `GET /api/connectors/whatsapp/webhook` for Meta's `hub.challenge` handshake.
- `handleEvent`  — `POST /api/connectors/whatsapp/webhook` for inbound messages + status events. Acks immediately (200), processes async, fans out via `eventBus`:
  - `connector:whatsapp:message` — inbound text/media.
  - `connector:whatsapp:status`  — sent/delivered/read/failed status.
- `verifySignature` — optional middleware. If `WHATSAPP_APP_SECRET` is set, requires a valid `X-Hub-Signature-256` header (constant-time compare). If unset, accepts unsigned posts (development mode).

The route is mounted by the `/api/connectors/:name/connect` commit. Until then this module sits dormant; the connector's outbound actions still work.

## Rate limits
- Meta enforces per-day quality-tier caps:
  - Tier 1: 1,000 unique recipients / 24h
  - Tier 2: 10,000
  - Tier 3: 100,000
  - Tier 4: unlimited
- Our budget: `per_minute: 30, per_hour: 200`, scope `wallet`. Per_hour wins → ~3.3/min sustained. Comfortable inside a Tier 1 baseline (200/h × 24 = 4800 attempts; with retries the unique-recipient count stays well under the 1,000 cap).
- Production deployers on a higher tier should bump these caps in the connector module.

## Failure modes
| Symptom | Cause | Recovery |
|---|---|---|
| 24-hour window expired | recipient hasn't messaged in 24h | use `send_template` with a pre-approved template |
| 132012 (re-engagement message) | template not approved or wrong language code | submit / fix template in Business Manager |
| 131056 (pair rate limit) | per-recipient daily cap | back off this recipient for 24h |
| 132000 (unsupported message type) | sending media via wrong endpoint | not implemented; v1 is text-only |
| 401 from Graph | token revoked or expired | re-run /connect with a fresh system-user token |
| Webhook signature 401 | app secret mismatch or stale request | check `WHATSAPP_APP_SECRET`; rotate if compromised |

## PII / data handling
- Recipient phone numbers are E.164 strings. They are never logged at the connector boundary.
- Message bodies (in + out) flow through `eventBus`; downstream consumers (Kits) decide retention. The connector itself does not persist them.
- Credentials are encrypted at rest, decrypted server-side only.

## Known gaps
- Text messages only at v1. Media (image, document, audio, video, location) is documented in Cloud API but not yet wired here.
- No rate-limit tier autodetection — operator picks the cap manually.
- No outbound idempotency (Meta provides `messaging_product` but no client-side request-id at the connector layer).
- No automatic conversation-window tracking — the Kit is responsible for choosing `send` vs `send_template`.
