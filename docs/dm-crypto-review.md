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
| 12 | DM media attachments (Day 8.4) | **WEAK (scoped)** | Sender uploads via `POST /api/media/upload` (Day 5.1 hardening: 5MB cap, magic-byte MIME, EXIF strip, 10/day quota), gets back `{ url }`. The URL + MIME are JSON-encoded and pass through `nacl.box` like any other message body — the *metadata* is E2E encrypted. The image bytes themselves sit at the (TLS-fronted but otherwise public) host URL. Anyone who learns the URL can fetch the image; they just can't see who sent it to whom. v1.1 work: per-message symmetric image encryption + a fetch-and-decrypt path so the host stores ciphertext only. |

## Threat model the implementation defends

- ✅ Passive server / DB read: server can correlate who-talked-to-whom + when, but not what was said (1:1 only).
- ✅ Passive network observer (TLS terminator at Cloudflare aside): same as above.
- ✅ Sender impersonation by an unrelated party: blocked by NEP-413 at `/api/dm/send`.
- ✅ Replay of an old ciphertext as a new message: server tags `created_at` server-side; the ciphertext-internal nonce makes per-message identity unique.

## Threats it does NOT defend

- ❌ XSS in the IronShield frontend → full DM history exfil for the affected user.
- ❌ Compromised backend DB → swap victim's `dm_pubkey` → MITM on **future** messages (mitigated by safety-number verification — see v1.1.2).
- ❌ Past-message recovery after key compromise (no FS — see v1.1.4 below).
- ❌ Cross-device DM continuity (no key sync).

## Required action in this task

**None.** Nothing is BROKEN. WEAK items are tracked here and many become v1.1 work:

- v1.1: DM safety-number UI (mitigates finding 8 — out-of-band pubkey verification).
- v1.1: Key sync via wallet-derived keypair or backed-up encrypted blob (mitigates 6, 9).
- v1.1: Migrate ciphertext format to include a 1-byte version + AAD covering `(from_id, to_id, sequence)` (mitigates 10).
- v1.1+: Group-chat E2E (large scope — needs MLS or sender-keys; non-trivial).

## Followup tasks within Day 8

- **8.2** (read receipts): adds `delivered_at` / `read_at` columns + `dm:state` WS push. No crypto change.
- **8.3** (key rotation): adds `sender_key_fp` / `recipient_key_fp` per ciphertext. Partially addresses finding 9.
- **8.4** (media attachments): URL+fingerprint inside the encrypted payload; image bytes themselves remain at an unencrypted URL — explicitly out of scope for v1, tracked here in finding 10's neighborhood.

## v1.1 hardening pass (post-launch)

Five of the six WEAK items above were addressed in a single v1.1 hardening pass. Item 12.4 (forward secrecy) is documented but intentionally **not** shipped — see the analysis at the end.

- **v1.1.6 — finding 10 (format versioning):** new `feed_dms.format_version SMALLINT` column. Default 0 (legacy bytes, no fingerprints) preserves backwards compat; new sends stamp version 1. The column is the future-proofing slot — adding a new version (e.g. AAD-bound, FS-ratcheted) doesn't require another schema migration. `dmCrypto.FORMAT_VERSION` exposes the current value to clients; the encrypt path returns it; the server validates it's in `[0, 16]` to bound the search space for future protocol decoders.

- **v1.1.3 — finding 9 (key rotation UI):** new `<DMKeysSection>` in /settings → Security. Lists the wallet's current dm_pubkey fingerprint, the count of historical keys kept locally, and a confirm-gated "Rotate DM key" button. Rotating mints a fresh keypair, appends it to the localStorage history, and publishes the new public half via the existing `POST /api/profile/dm-pubkey`. Past keys stay in history so older messages still decrypt; clearing site data after a rotation is the only destructive path. Replaces the previous devtools-only flow.

- **v1.1.2 — finding 8 (safety numbers / out-of-band pubkey verification):** new `feed_dm_verifications` table keyed on `(viewer_wallet, peer_wallet)` with the peer's `dm_pubkey` fingerprint at verify time. `<SafetyNumberSection>` in the DM context pane shows the peer's current fingerprint, and three states: not verified (default), verified with current fp matching ("✅ Verified"), and verified with current fp differing ("⚠ Key changed since you verified"). The third state is the load-bearing one — if the backend ever swaps the published `dm_pubkey` for a peer the viewer has previously verified, the UI surfaces the rotation explicitly rather than silently grandfathering the new key. Three new endpoints: `GET /api/dm/verifications/:peerWallet`, `POST /api/dm/verify`, `DELETE /api/dm/verify/:peerWallet`.

- **v1.1.5 — finding 12 (full image-byte encryption):** image attachments now upload as **opaque ciphertext**. The sender mints a fresh 32-byte symmetric key + 24-byte nonce per attachment, runs `nacl.secretbox` over the file bytes client-side, and POSTs the ciphertext to `/api/media/upload?encrypted=1` (bypasses the magic-byte MIME check + sharp/EXIF strip — which can't run on opaque bytes — but keeps the 5MB cap, daily quota, and host cascade). The symmetric key + nonce ride along inside the dmCrypto-encrypted message body alongside the URL, so only the recipient can recover them. Receiver fetches the URL, decrypts to a Uint8Array, wraps in a `Blob`, and renders via `blob:` URL. Day 8.4 bodies (URL-only) still render via the legacy plaintext path. The image bytes at the host are now ciphertext; without the message-embedded key, a host operator (or anyone with the URL) gets random bytes.

- **v1.1.1 — finding 11 (group-chat E2E, sender-keys flavor):** opt-in at group creation via `e2e_enabled` on `feed_group_chats`. Owner mints a 32-byte symmetric `group_key`, wraps a copy to each member by `nacl.box`-encrypting it to that member's published `dm_pubkey`, and POSTs the wraps to `/api/dm/groups/:id/key/distribute`. Members fetch their wrap via `GET /api/dm/groups/:id/key`, unwrap with their own dmCrypto secret, and cache the symmetric key in `localStorage` keyed by `(wallet, group_id)`. Send: `nacl.secretbox` with the group key. Receive: same. Existing groups (e2e_enabled=false) continue plaintext. **Limitations** — single key per group, never rotated, so members joining LATER receive the same key and can read all prior history. This trades retroactive privacy on member-add for protocol simplicity; v1.2 should add per-epoch rotation (TreeKEM or similar). Plaintext content column stays for legacy/non-e2e rows. New columns: `feed_group_messages.encrypted_content`, `nonce`, `sender_key_fp`. New table: `feed_group_keys (group_id, user_id, wrapped_key, wrap_nonce, wrapped_by_pubkey)`.

## Forward secrecy (finding 7) — analysis, not shipped

A symmetric ratchet on top of static `nacl.box` keys is technically possible: derive an initial chain key from `ECDH(my_sk, peer_pk)`, then `chain_key_{n+1} = HKDF(chain_key_n, "next")` and `message_key_n = HKDF(chain_key_n, "msg")`. Sender encrypts with `message_key_n`, includes the message number, recipient derives the same chain. Deleting old chain keys gives forward secrecy on messages going forward from initiation.

The blocker is **state synchronization**, not the math:

1. Each side maintains a chain state in `localStorage`. If the user clears site data, opens incognito, or signs in from a different browser, their chain desyncs from the peer's. Without a recovery path, future messages stop decrypting — and there's no way to recover, because deleting chain keys is the whole point of FS.

2. Multi-device support requires a sync mechanism (Signal solves this with sealed-sender + per-device prekey bundles + key-transparency). IronShield has none of those today; users routinely sign in from desktop and mobile, and we don't have a way to ratchet across devices.

3. Wallet-derived deterministic chain seeds (use `signMessage` with a per-conversation domain string to seed the ratchet) would solve the multi-device problem cleanly: any device with the wallet can re-derive the chain. But the signing required for each new conversation is a UX cost we'd need to weigh — and it shifts the threat model to "wallet-key compromise = full chain exposure," which somewhat undermines the FS gain.

For v1.1, the WEAK label stays. Treating FS as a v1.2 problem is the responsible call: shipping a half-working ratchet that silently loses messages on multi-device use would be worse than the current static-key model.

**Recommended v1.2 path:** wallet-derived deterministic chain seeds. Per-conversation `signMessage` once at conversation creation, hash the signature into a 32-byte chain seed, ratchet from there. Multi-device works because every device with the wallet can re-derive. Does *not* protect against wallet-key compromise — but neither does anything else we ship today, so it's not a regression.
