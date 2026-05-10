# Sui Signed Auth Contract

Status: Phase A draft. This is the Sui-native replacement design for `docs/auth-contract.md`. It does not replace NEP-413 yet.

Audience: anyone implementing `backend/middleware/requireSuiWallet.js` or the future Sui branch of `src/lib/apiFetch.js`.

## 1. Goal

AZUKA needs the same basic proof as the current NEAR auth:

- The caller controls the wallet they claim.
- The signed message is bound to AZUKA, not reusable from another app.
- The signed message is bound to one HTTP method, path, and body.
- A captured signature cannot be replayed.
- Existing route handlers can keep reading `req.wallet` during the transition.

The new Sui auth runs beside NEP-413 during the dual-auth window. It does not remove `requireWallet`.

## 2. SDK decision

Use the current Mysten packages:

- Frontend wallet UI/actions: `@mysten/dapp-kit-react` plus `@mysten/dapp-kit-core`.
- Sui TypeScript primitives and verification: `@mysten/sui`.

Do not start new work on legacy `@mysten/dapp-kit`; Mysten's current docs mark it JSON-RPC only and recommend the new split packages.

Primary docs checked:

- https://sdk.mystenlabs.com/dapp-kit
- https://sdk.mystenlabs.com/dapp-kit/actions/sign-personal-message
- https://sdk.mystenlabs.com/typescript/cryptography/keypairs

## 3. Headers

Mutating Sui-authenticated requests use:

| Header | Meaning |
|---|---|
| `x-wallet-chain` | Must be `sui`. This prevents silent confusion with NEAR auth. |
| `x-wallet` | Sui address, lower-case full 32-byte hex, e.g. `0x` plus 64 hex chars. |
| `x-nonce` | Base64url 32-byte nonce from `GET /api/auth/nonce`. |
| `x-signature` | Base64 Sui personal-message signature returned by the wallet. |

No `x-public-key` header is required. Sui verification recovers/checks the public key from the signature with the expected address.

## 4. Signed message

The client signs this exact UTF-8 string as Sui personal-message bytes:

```text
azuka-sui-auth:v1
<METHOD>
<PATH_WITH_QUERY>
<SHA256_HEX_OF_RAW_BODY>
```

Rules:

- `METHOD` is uppercase, such as `POST`.
- `PATH_WITH_QUERY` is `req.originalUrl`, such as `/api/posts?draft=1`.
- For an empty body, hash the empty string.
- For JSON, hash the exact raw request body bytes, not a re-serialized object.
- Domain string is `azuka-sui-auth:v1`.

Example body hash:

```text
azuka-sui-auth:v1
POST
/api/auth/login
e3b0c44298fc1c149afbf4c8996fb924...
```

## 5. Server verification

For every request hitting `requireSuiWallet`:

1. If token auth is enabled in a future revision, accept only a token explicitly bound to `{ chain: "sui", wallet }`. A NEAR session token must never satisfy Sui auth.
2. Decode headers and require `x-wallet-chain: sui`.
3. Normalize and validate `x-wallet` as a full Sui address.
4. Decode `x-nonce` as base64url. It must be exactly 32 bytes.
5. Decode or pass through `x-signature` as returned by Sui wallet signing.
6. Load nonce from `auth_nonces`.
7. Reject unknown, used, or expired nonces.
8. Rebuild the signed message from method, path, and raw body.
9. Verify the personal-message signature for the expected Sui address.
10. Atomically mark the nonce used with `wallet = <sui address>`.
11. Set:

```js
req.wallet = address;
req.walletChain = "sui";
req.identity = { chain: "sui", address, wallet: address };
```

`req.wallet` is compatibility glue for old route handlers. New code should prefer `req.identity`.

## 6. Client signing plan

Future Sui `apiFetch` branch:

1. Fetch `/api/auth/nonce`.
2. Build the message string above.
3. Encode it with `new TextEncoder().encode(message)`.
4. Call dApp Kit `signPersonalMessage({ message })`.
5. Send headers from section 3.
6. Exchange that one signed request for a 24h session token only after tokens are chain-aware.

## 7. Address and unit rules

- A Sui address is not a username. Store display handles separately.
- Store and compare addresses lower-case.
- Native Sui base unit is MIST, 1 SUI = `10^9` MIST.
- Do not reuse NEAR column names like `*_yocto` for new Sui amounts. Prefer `*_mist` or chain-neutral names like `amount_base_units`.

## 8. Phase A limits

This draft intentionally does not:

- Mount `requireSuiWallet` on any live route.
- Replace `requireWallet`.
- Change frontend wallet behavior.
- Add Sui contract calls.
- Migrate DB rows.

Those belong to later phases after the cut-over strategy is confirmed.
