# DM E2E crypto review — Day 8.1

Audit of the existing 1:1 DM end-to-end encryption. Scope: `src/lib/dmCrypto.js` (client crypto), `backend/routes/dm.route.js` (server storage + routing), `backend/routes/profile.route.js:74-82` (pubkey publication), `backend/db/schema.sql:257-267` (ciphertext storage).

**Verdict at a glance:** primitives sound, no BROKEN findings, several WEAK items tracked for v1.1. Day 8 ships with E2E intact for 1:1 DMs as marketed.

## What the implementation actually does

1. Each wallet generates a Curve25519 keypair on first visit ([src/lib/dmCrypto.js:20-32](../src/lib/dmCrypto.js#L20)). Secret key is base64-encoded into `localStorage` at `ironfeed:dm:sk:<wallet>`. Public key is published via `POST /api/profile/dm-pubkey` (wallet-signed; [backend/routes/profile.route.js:74-82](../backend/routes/profile.route.js#L74)) and stored in `feed_users.dm_pubkey`.
2. Sender calls `nacl.box(plaintext, 24-byte-random-nonce, peerPubkey, mySecret)` ([dmCrypto.js:38-46](../src/lib/dmCrypto.js#L38)) — Curve25519-X25519 ECDH + XSalsa20 stream + Poly1305 MAC. Ciphertext + nonce go to the server as base64 in `POST /api/dm/send`.
3. Server stores `feed_dms.encrypted_payload` + `feed_dms.nonce` ([schema.sql:257-267](../backend/db/schema.sql#L257)) and routes ciphertext to the recipient. Server never has plaintext.
4. Recipient pulls via `GET /api/dm/:cid/messages`, runs `nacl.box.open(...)` with their secret + sender's published pubkey.

## Findings

| # | Item | Verdict | Notes |
|---|------|---------|-------|
| 1 | Primitive choice (Curve25519 + XSalsa20-Poly1305 via tweetnacl) | **OK** | `nacl.box` is authenticated encryption. tweetnacl-js was independently audited (NCC Group, 2017). Right primitive for the job. |
| 2 | Library: tweetnacl + tweetnacl-util | **OK** | Library-vetted. No hand-rolled crypto in `dmCrypto.js`. |
| 3 | Nonce policy: 24 random bytes per message | **OK** | `nacl.randomBytes(24)` uses `crypto.getRandomValues`. Birthday bound on 192 bits is astronomical — collision risk negligible. No counter, no reuse risk. |
| 4 | Server confidentiality | **OK** | Verified by reading `dm.route.js` `/send` handler + schema. Server sees ciphertext + nonce + metadata (`from_id`, `to_id`, `conversation_id`, `created_at`, `read_at`). Cannot read message bodies. |
| 5 | Sender authentication at the API edge | **OK** | `requireWallet` (NEP-413) gates `POST /api/dm/send`; server sets `from_id` from the verified `req.wallet`. An attacker without the wallet's signing key cannot impersonate the sender at the routing layer. |
| 6 | Secret-key storage in browser | **WEAK** | `localStorage` is readable by any same-origin script. An XSS exfiltrates all past DMs to that user. Standard browser E2E tradeoff — no better private store without an OS-level keystore. |
| 7 | Forward secrecy | **WEAK (absent)** | Static long-lived keypair, no ratchet. Compromise of one secret key → all stored ciphertext (past + future) decrypts. Acceptable for "reasonable privacy" claim; not "Signal-grade". |
| 8 | Out-of-band pubkey verification | **WEAK** | Peer's pubkey is fetched from the backend (`feed_users.dm_pubkey`). A compromised DB or rogue admin could swap a victim's pubkey for one the attacker controls; future messages encrypt to attacker. Mitigation requires fingerprint display + manual verification (deferred to v1.1 — DM safety-numbers UI). |
| 9 | Key rotation / device transfer | **WEAK** | Clearing site data wipes the secret key — all historical DMs become permanently unreadable. New browser/device = new keypair = silent identity discontinuity. Day 8.3 starts to address this (per-message key fingerprints + graceful placeholder for messages encrypted under rotated keys). |
| 10 | Ciphertext format / versioning | **WEAK** | No protocol version byte, no associated data (AAD). If we ever need to change the wire format (add chunked attachments, swap to ChaCha20-Poly1305, etc.), there's no signal in old ciphertext to tell decryptors which scheme was used. Tracked for v1.1; non-blocking today since the format is monolithic. |
| 11 | Group chats | **OK (scoped)** | `feed_group_messages.content` is plaintext TEXT in the DB. The `messages/page.js` UI comments this explicitly: "group chats are plaintext per the backend contract." Day 8.4 keeps this — DM media-attachment URL+fp encryption only. Marketing copy must read "1:1 DMs are E2E encrypted; group chats are not yet." |

## Threat model the implementation defends

- ✅ Passive server / DB read: server can correlate who-talked-to-whom + when, but not what was said (1:1 only).
- ✅ Passive network observer (TLS terminator at Cloudflare aside): same as above.
- ✅ Sender impersonation by an unrelated party: blocked by NEP-413 at `/api/dm/send`.
- ✅ Replay of an old ciphertext as a new message: server tags `created_at` server-side; the ciphertext-internal nonce makes per-message identity unique.

## Threats it does NOT defend

- ❌ XSS in the IronShield frontend → full DM history exfil for the affected user.
- ❌ Compromised backend DB → swap victim's `dm_pubkey` → MITM on all future messages.
- ❌ Past-message recovery after key compromise (no FS).
- ❌ Group-chat confidentiality (server reads plaintext).
- ❌ Cross-device DM continuity (no key sync).

## Required action in this task

**None.** Nothing is BROKEN. WEAK items are tracked here and become v1.1 work:

- v1.1: DM safety-number UI (mitigates finding 8 — out-of-band pubkey verification).
- v1.1: Key sync via wallet-derived keypair or backed-up encrypted blob (mitigates 6, 9).
- v1.1: Migrate ciphertext format to include a 1-byte version + AAD covering `(from_id, to_id, sequence)` (mitigates 10).
- v1.1+: Group-chat E2E (large scope — needs MLS or sender-keys; non-trivial).

## Followup tasks within Day 8

- **8.2** (read receipts): adds `delivered_at` / `read_at` columns + `dm:state` WS push. No crypto change.
- **8.3** (key rotation): adds `sender_key_fp` / `recipient_key_fp` per ciphertext. Partially addresses finding 9.
- **8.4** (media attachments): URL+fingerprint inside the encrypted payload; image bytes themselves remain at an unencrypted URL — explicitly out of scope for v1, tracked here in finding 10's neighborhood.
