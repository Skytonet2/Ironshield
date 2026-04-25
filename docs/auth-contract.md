# IronShield Signed-Message Auth Contract

**Status:** v1, Day 1 of launch sprint. Replaces the unsigned `x-wallet` header (`backend/services/feedHelpers.js:24`) on every mutating backend route.

**Audience:** anyone implementing the server middleware (`backend/middleware/requireWallet.js`) or the client wrapper (`src/lib/apiFetch.js`). Read once, implement either side.

---

## 1. Goal & threat model

Today every mutating route trusts a bare `x-wallet` header. An attacker can `curl -H "x-wallet: alice.near" -X POST ...` and impersonate Alice. We replace this with a NEAR signed-message scheme so that:

- Each request carries a cryptographic proof that the holder of `wallet`'s key signed *this exact request* (method + path + body).
- Replays of a captured request fail.
- Sigs captured from another NEAR app cannot be reused against IronShield.
- The server never trusts a client-supplied account id — it derives it from the signature.

**Out of scope for v1:** EVM, Solana, and Google sign-ins. Those wallets cannot produce NEP-413 signatures; users connected via those paths get read-only access until v1.1 adds a per-chain scheme.

---

## 2. Wire format

### 2.1 Headers (request)

Every request to a mutating endpoint MUST carry these four headers:

| Header           | Value                                                                |
|------------------|----------------------------------------------------------------------|
| `x-wallet`       | NEAR account id, e.g. `alice.near`                                   |
| `x-public-key`   | NEAR pubkey string, e.g. `ed25519:H9k5...`                           |
| `x-nonce`        | Base64url of the 32-byte server-issued nonce (no padding)            |
| `x-signature`    | Base64 of the 64-byte Ed25519 signature                              |

Read-only requests (GET, HEAD) carry none of these.

### 2.2 Signed payload (NEP-413)

The signature is produced by the wallet's `signMessage` per [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md). The wallet hashes a borsh-serialized struct:

```
SignMessageParams {
  prefix:      u32  = 2_147_484_061   // NEP-413 magic
  message:     string
  nonce:       [u8; 32]
  recipient:   string
  callbackUrl: Option<string>         // None for our use
}
```

then signs `sha256(borsh(...))` with the user's Ed25519 access key. Verifier reproduces the same bytes and calls `KeyPair.verify`.

The values IronShield uses:

- **`message`** = the body-binding string defined in §2.3.
- **`nonce`** = the raw 32 bytes whose base64url form is sent as `x-nonce`.
- **`recipient`** = the string literal `"ironshield.near"`. Fixed across mainnet and any preview environments — sigs are interchangeable across deploys but never with other apps.
- **`callbackUrl`** = absent.

### 2.3 Body-binding string (`message`)

```
ironshield-auth:v1
<METHOD>
<PATH>
<BODY_SHA256_HEX>
```

- `<METHOD>` is uppercase HTTP verb (`POST`, `PUT`, `PATCH`, `DELETE`).
- `<PATH>` is the request path **with query string** as it arrives at the server, e.g. `/api/posts?dryRun=1`. Leading slash, no host, no fragment.
- `<BODY_SHA256_HEX>` is `sha256(rawBody).hex()` of the exact bytes the client sent. For a request with no body, the empty-string hash `e3b0c44...b855` is used (NOT a literal "empty"). Backend must hash `req.rawBody` (server.js already stashes it, see §6.4).
- Lines are joined with a single `\n` (LF). No trailing newline.
- The literal `ironshield-auth:v1` line is a domain tag so a sig produced for a future v2 contract can never be replayed against v1.

The four lines lock the signature to one origin app, one HTTP verb, one URL, one body. Any tampering fails verification.

### 2.4 Response on success

The middleware sets `req.wallet = <accountId>` (taken from the verified `x-wallet`, lower-cased — NEAR account ids are case-insensitive but conventionally lower) and calls `next()`. Handlers MUST read `req.wallet` and MUST NOT trust `req.body.wallet` or `req.query.wallet`.

### 2.5 Error responses

All failures are `401 Unauthorized` with body `{ error: <human msg>, code: <slug> }`. The `code` is what the client switches on:

| Code              | Meaning                                                                     |
|-------------------|-----------------------------------------------------------------------------|
| `missing-sig`     | One or more of the four headers is absent.                                  |
| `bad-nonce`       | Nonce was never issued by this server, or is malformed.                     |
| `expired-nonce`   | Nonce was issued >5 min ago.                                                |
| `replay`          | Nonce was already used (its `used_at` is set).                              |
| `bad-sig`         | Ed25519 verification failed against `x-public-key`.                         |
| `bad-key`         | `x-public-key` is not a registered access key for `x-wallet` on chain.      |
| `wrong-recipient` | (reserved) Sig was bound to a recipient other than `ironshield.near`.       |
| `body-mismatch`   | Reproduced message-line hash doesn't match what was signed.                 |

Note: `wrong-recipient` and `body-mismatch` collapse into `bad-sig` in practice (both make verify return false), but they're documented separately so future debugging logs can disambiguate. The middleware MAY log the precise reason internally while returning `bad-sig` externally.

---

## 3. Nonce issuance endpoint

`GET /api/auth/nonce` — public, no auth required.

**Response 200:**
```json
{ "nonce": "<base64url-32B>", "expiresAt": 1745654321000 }
```

`expiresAt` is `Date.now() + 5*60*1000` for client UX only (e.g., disable submit button if expired). Server is the source of truth.

Server inserts `(nonce, NULL, NOW(), NULL)` into `auth_nonces`. The `wallet` column is filled at consumption time, not issuance — any wallet can spend a fresh nonce. (Issuance is unauthenticated; tying to wallet would require a chicken-and-egg sig.)

**Rate limit:** 60 nonces / IP / minute (Day 2 wires the actual limiter; for Day 1, doc the intent).

---

## 4. Server-side verification (step-by-step)

For each request hitting `requireWallet`:

1. **Headers present.** If any of the four are missing → 401 `missing-sig`.
2. **Decode headers.** Lower-case `x-wallet` to get `accountId`. Decode `x-nonce` (base64url → 32 bytes); reject if length ≠ 32 → `bad-nonce`. Decode `x-signature` (base64 → 64 bytes); reject if length ≠ 64 → `bad-sig`.
3. **Look up nonce.** `SELECT * FROM auth_nonces WHERE nonce = $1 LIMIT 1`.
   - No row → `bad-nonce`.
   - `used_at IS NOT NULL` → `replay`.
   - `issued_at < NOW() - 5 min` → `expired-nonce`.
4. **Reproduce the signed message.** Build the four-line `<message>` per §2.3 from `req.method`, `req.originalUrl`, and `sha256(req.rawBody ?? "").hex()`.
5. **Verify the NEP-413 signature.**
   ```js
   const { utils, KeyPair } = require("near-api-js");
   const { sha256 } = require("@noble/hashes/sha256");
   const borsh   = require("borsh");

   const payload = borsh.serialize(NEP413_SCHEMA, {
     prefix: 2_147_484_061,
     message,                // §2.3 string
     nonce: rawNonceBytes,   // 32 bytes
     recipient: "ironshield.near",
     callbackUrl: null,
   });
   const digest = sha256(payload);
   const pk = KeyPair.fromString(xPublicKey);     // throws on bad encoding
   const ok = pk.verify(digest, sigBytes);
   ```
   `ok === false` → `bad-sig`.
6. **Confirm the pubkey belongs to the wallet.** Call `view_access_key_list` (cached 60 s in memory by `accountId`). If `xPublicKey` is not present in the returned `keys[*].public_key`, → `bad-key`. Both `FullAccess` and `FunctionCall` permissions are accepted (Meteor/HERE/HOT sign messages with limited-access keys; rejecting FCAKs would break the wallet UX flow).
7. **Mark the nonce used.** `UPDATE auth_nonces SET used_at = NOW(), wallet = $1 WHERE nonce = $2 AND used_at IS NULL`. If `rowCount === 0`, a concurrent request beat us → `replay`. (Atomic single-use.)
8. **Set `req.wallet = accountId` and `next()`.**

### 4.1 `view_access_key_list` cache

In-memory `Map<accountId, { keys, fetchedAt }>`, TTL 60 s. RPC failure during a cache miss → 503, not 401 (it's a server problem, not the client's). Cache hit serves stale-on-error: if RPC is down and we have any value, use it.

---

## 5. Database schema

New table, added to `backend/db/schema.sql` and applied as a migration:

```sql
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce      TEXT        PRIMARY KEY,         -- base64url 32B
  wallet     TEXT,                            -- NULL until consumed
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at    TIMESTAMPTZ
);

-- Clean up old rows so the table doesn't grow forever.
-- Either a periodic DELETE in a job, or a partial index for the active set:
CREATE INDEX IF NOT EXISTS auth_nonces_active_idx
  ON auth_nonces (issued_at)
  WHERE used_at IS NULL;
```

**Retention policy:** a janitor query `DELETE FROM auth_nonces WHERE issued_at < NOW() - INTERVAL '1 hour'` runs daily. Used nonces are kept ≥1 h so a slow replay attempt still produces a deterministic `replay` (not `bad-nonce`) error.

---

## 6. Client implementation (`src/lib/apiFetch.js`)

### 6.1 Public surface

```ts
apiFetch(path: string, options?: RequestInit & { public?: boolean }): Promise<Response>
```

- GET / HEAD or `options.public === true` → plain `fetch(BACKEND + path, options)` with no signing.
- Otherwise: full sign-and-send flow below.

### 6.2 Sign-and-send flow

1. `nonceRes = await fetch(BACKEND + "/api/auth/nonce")`. Read `{ nonce }`.
2. Compute `bodySha = sha256Hex(options.body ?? "")`. (Empty body → `e3b0c44...b855`.)
3. Build `message`:
   ```
   ironshield-auth:v1
   <METHOD>
   <path>
   <bodySha>
   ```
4. Get the wallet from `WalletProvider.selector` (see `src/lib/contexts.js`). Call `(await selector.wallet()).signMessage({ message, recipient: "ironshield.near", nonce: base64urlDecode(nonce) })`.
5. Attach headers to a clone of `options`:
   ```
   x-wallet:      <signed.accountId>
   x-public-key:  <signed.publicKey>
   x-nonce:       <nonce>             // pass through, base64url
   x-signature:   <signed.signature>  // base64
   ```
6. `fetch(BACKEND + path, opts)`.
7. On `401 { code: "expired-nonce" }`, retry **once** with a fresh nonce. Other 401 codes: do not retry, surface to caller.

### 6.3 Edge cases

- **No wallet connected:** `selector.wallet()` will throw or `signMessage` returns null. `apiFetch` rethrows with `Error("not-connected")` so callers can show a "Connect wallet" CTA.
- **Non-NEAR wallet (EVM/Sol/Google):** `walletType !== "near"` → throw `Error("wallet-type-unsupported")`. Read-only flows still work via GET.
- **Body shape:** if `options.body` is a `string`, hash directly. If `FormData` or `Blob`, the caller is on their own — multipart uploads are rare, and §6.4 below explains the server-side hashing.

### 6.4 Server raw-body capture (already in place)

`backend/server.js:13-15` already stores the verbatim request bytes on `req.rawBody` via the `express.json({ verify })` hook. Middleware uses those bytes for the body hash, so encoding round-trips can't break verification. Keep that hook intact when adding the middleware.

---

## 7. Worked examples

### 7.1 curl (no auth) — should fail

```bash
$ curl -i -X POST https://ironclaw-backend.onrender.com/api/posts \
       -H 'content-type: application/json' \
       -d '{"content":"hi"}'
HTTP/1.1 401 Unauthorized
content-type: application/json

{"error":"missing signature headers","code":"missing-sig"}
```

### 7.2 TypeScript (using `apiFetch`)

```ts
import { apiFetch } from "@/lib/apiFetch";

const r = await apiFetch("/api/posts", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "hello world" }),
});
if (!r.ok) {
  const { code } = await r.json();
  if (code === "not-connected") promptConnect();
  else throw new Error(code);
}
const post = await r.json();
```

What goes on the wire:

```
POST /api/posts HTTP/1.1
host: ironclaw-backend.onrender.com
content-type: application/json
x-wallet: alice.near
x-public-key: ed25519:H9k5eiU4xX7c...
x-nonce: 7p3NkX...AbCd
x-signature: 4hQ2k...==

{"content":"hello world"}
```

Server reproduces:
```
ironshield-auth:v1
POST
/api/posts
9595c9df90075148...   ← sha256("{\"content\":\"hello world\"}")
```
borsh-encodes with `nonce=base64url-decode("7p3NkX...AbCd")`, `recipient="ironshield.near"`, sha256s, Ed25519-verifies → 200 OK, `req.wallet = "alice.near"`.

### 7.3 Curl with a manually crafted signature (debugging)

You normally won't do this — the wallet handles signing — but for backend debugging:

```bash
NONCE=$(curl -s https://.../api/auth/nonce | jq -r .nonce)
PATH_=/api/posts
BODY='{"content":"hi"}'
HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 -hex | awk '{print $2}')
MSG="ironshield-auth:v1
POST
$PATH_
$HASH"
# Then encode SignMessageParams via borsh and sign with your local key.
# Easiest path: write a tiny Node script that uses near-api-js KeyPair.sign
# over the borsh blob. See backend/__tests__/requireWallet.test.js for a
# reference implementation once Task 1.2 lands.
```

---

## 8. UX notes (informational)

- Meteor / HERE / HOT / Intear all support `signMessage` via NEP-413. They sign **silently** with the dApp's function-call access key — no popup per request once the wallet is connected. This is why §4 step 6 must accept FunctionCall keys.
- A wallet without an active FCAK (e.g., MyNEAR) will pop up its UI on every signed request. That's a poor UX but a wallet-side issue — IronShield's contract is unchanged.

---

## 9. What this doc does NOT cover

- **Rate limiting** — Day 2.3 wires `backend/services/rateLimiter.js`. Auth and rate limits are independent.
- **Admin authorization** — Day 2.2 layers a `requireAdmin` check on top that consults `admin_wallets`. This doc covers only the identity proof, not authZ.
- **Per-wallet AI budget** — Day 5 work; uses `req.wallet` set by this middleware.
- **Webhook routes** (e.g., `/api/tg/webhook/:secret`) — those use a shared secret in the URL, not signed messages. Day 2.1 marks them with `// public: <reason>` comments.
- **WebSocket auth** — `/ws/feed` is currently public; signed-message handshake is a v1.1 follow-up.

---

## 10. Acceptance checklist (for Day 1)

- [ ] `docs/auth-contract.md` exists and matches this spec (Task 1.1 — this PR).
- [ ] `backend/middleware/requireWallet.js` implements §4 verification under 150 lines (Task 1.2).
- [ ] `backend/db/schema.sql` adds `auth_nonces` per §5; migration runs on boot.
- [ ] `GET /api/auth/nonce` returns a fresh 32-byte nonce per §3.
- [ ] `backend/__tests__/requireWallet.test.js` covers: missing headers, bad-nonce, expired-nonce, replay, bad-sig, bad-key, valid.
- [ ] `src/lib/apiFetch.js` implements §6 and is wired on `CreateAgentPage` register-agent submit (smoke test).
- [ ] Five mutating routers (`agents`, `skills`, `dm`, `posts`, `governance`) gate POST/PUT/PATCH/DELETE on the new middleware (Task 1.4).
- [ ] Hard exit: unsigned `curl -X POST .../api/agents/register` → 401 `missing-sig`.
