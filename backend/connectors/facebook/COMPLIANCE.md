# Facebook (Meta) connector — compliance posture

## Auth model
- **OAuth 2.0 user access token** — stored encrypted per-wallet in `connector_credentials` (AES-256-GCM under `CUSTODIAL_ENCRYPT_KEY`).
- **Page access tokens** — derived from the user token via `/me/accounts` at connect time, stored alongside under `page_tokens: { [page_id]: token }`. Page tokens have a longer lifetime than user tokens (60 days for short-lived → permanent for long-lived) and are the only way to send via Messenger.
- No app-secret-proof signing yet (recommended by Meta but not required for the endpoints we hit). Add `appsecret_proof` if abuse appears.

## ToS posture
- Official Graph API v19 only. No browser-automated flows on `facebook.com`. No userbot.
- Per [Platform Terms](https://developers.facebook.com/terms/) we do not redistribute Group content beyond the calling user's scope, do not store more than the API permits, and respect deletion within 24h of receiving a deletion signal.
- Page DM via Messenger Platform respects the 24-hour customer-care window — `messaging_type: RESPONSE` only. Outside that window we'd need a **Message Tag** approval that we don't currently hold.
- We do not implement audience-extension, look-alike-modeling, or any pixel-based tracking integration.

## Capability reality check
| Action | Graph API support | Status |
|---|---|---|
| `groups_read` | `groups_access_member_info` permission | **Restricted by Meta** since 2023; works only for apps with explicit approval. Code path is correct; default app review will fail. Document the gap to the user during connect. |
| `page_dm` | Messenger Platform (`/me/messages`) | Works inside 24h window. Needs Page Messaging permission. |
| `marketplace_search` | None | **Not exposed** at any tier. Connector throws `FACEBOOK_MARKETPLACE_UNSUPPORTED`. The Realtor / Car Sales Kits fall back to the `jiji` connector. |

## Rate limits
- Graph API uses app-level + user-level Block User Counters (BUC) — there is no published per-endpoint quota; Meta dynamically throttles based on observed load, error rate, and abuse signals.
- Our self-imposed budget: `per_minute: 30, per_hour: 60`, scope `wallet`. The hub picks the tightest binding (per_hour wins → ~1/min sustained).
- A 4-error in `error.code = 4` means BUC tripped — back off for at least an hour before retrying that user.

## Failure modes
- 190 (token expired) → trigger refresh on the user token via Graph API `/oauth/access_token`. Page tokens may need re-derivation from `/me/accounts`.
- 200 (permission missing) → user revoked or app review hasn't granted the scope. UX must re-route through `/api/connectors/facebook/connect` with the missing scopes flagged.
- 4 (BUC) → upstream rate limit. We don't retry; surface to caller.
- 10 (App not approved) → the production scope is in beta. Code path is correct but blocked at the platform layer until review passes.

## PII / data handling
- Group post bodies and Messenger message bodies flow through but are not persisted in AZUKA logs.
- Tokens never logged.
- Page DM recipients (PSIDs) are persisted only inside the calling Kit's mission audit log, not as a global table. Kit-level retention follows the mission's lifetime.

## Known gaps
- No `appsecret_proof` on outbound requests (low priority — abuse signal would surface in BUC first).
- No webhook subscription for incoming Messenger messages (lands when WhatsApp connector's webhook receiver is generalized).
- Marketplace search depends on the `jiji` connector for classifieds; if Meta ever opens a Marketplace API, swap in here.
