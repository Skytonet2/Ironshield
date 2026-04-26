# Day 14 — Bridge end-to-end evidence

End-to-end proof that one bridge route — **NEAR → SOL via NEAR Intents 1-click** — works through IronShield's `bridge.route.js` proxy and a NEP-141 wrap+transfer sequence on `wrap.near`. This is the artifact backing `v0.95.0-beta`.

## Why mainnet (not testnet)

The Day 14 spec asked for a testnet route. **1-click has no testnet/devnet endpoints:**

- `GET https://1click.chaindefuser.com/v0/tokens` returns 156 assets across 31 chains (`adi, aleo, aptos, arb, avax, base, bera, bsc, btc, cardano, dash, doge, eth, gnosis, ltc, monad, near, op, plasma, pol, scroll, sol, starknet, stellar, sui, ton, tron, xlayer, xrp, zec` + `near`). Zero `*-testnet` / `*-devnet` / `*-sepolia` entries.
- DNS probes of `testnet-1click.chaindefuser.com` and `1click-testnet.chaindefuser.com` → NXDOMAIN.
- `/v0/testnet/tokens` → 404.

The chosen alternative was a **tiny mainnet transfer** (0.1 NEAR ≈ $0.14) so the bridge story is real, not mocked.

## Live transfer — facts

| Field | Value |
| --- | --- |
| Date | 2026-04-26 16:23:48Z – 16:24:15Z |
| Origin | `ironshield.near` (NEAR mainnet) |
| Destination | `6UP6LumJUY6Hy2TQzfhsuKhVtxzPriq99LS7qdeP2ruJ` (Solana mainnet) |
| Origin asset | `nep141:wrap.near` (wNEAR, decimals 24) |
| Destination asset | `nep141:sol.omft.near` (SOL, decimals 9) |
| Amount in | 0.1 NEAR (100000000000000000000000 yocto) |
| Amount out | 0.00158062 SOL (1,580,620 lamports) |
| 1-click ETA | 17s |
| **Actual elapsed** | **27.7s** (incl. one 5s poll tick) |
| 1-click final status | `SUCCESS` |
| 1-click intent hash | `FUk26F9ea9s2Ns3Gx3QZfnuc5SDGczHony7NtnpHSCX2` |
| 1-click correlation ID | `f8d58297-80cd-48c5-b03b-f6b713817417` |
| Deposit address (1-click) | `5fdc8e4e67234772f35275b897fb90afa0a09a3c5bf845e9dda2a443200c350c` |

### NEAR-side deposit transaction
- Hash: `59WMKwnFzpHnTbhWE6kCyuEvCU6oHfB7CzH1JDiA3SY6`
- Explorer: <https://nearblocks.io/txns/59WMKwnFzpHnTbhWE6kCyuEvCU6oHfB7CzH1JDiA3SY6>
- Receiver: `wrap.near`
- 4 actions, all to `wrap.near`:
  1. `storage_deposit({account_id: "ironshield.near"})` — 0.00125 NEAR
  2. `near_deposit({})` — 0.10 NEAR attached, mints 0.10 wNEAR to caller
  3. `storage_deposit({account_id: "5fdc...c350c"})` — 0.00125 NEAR (registers fresh 1-click implicit)
  4. `ft_transfer({receiver_id: "5fdc...c350c", amount: 0.10 wNEAR})` — bridge initiation
- `ironshield.near` NEAR balance: 7.18878 → 7.085584 (Δ 0.103196 NEAR; matches 0.1 bridge + 0.0025 storage + ~0.0007 gas)

### Solana-side destination transaction
- Hash: `56WtbVta3XBD4wBjxUvhQQcnpxotUH1ur2MEBXoEz2mLdfYBhbx1GWrRJhyJbDq6zh6oMmLg6WbbbvdgB6aYXes1`
- Explorer: <https://solscan.io/tx/56WtbVta3XBD4wBjxUvhQQcnpxotUH1ur2MEBXoEz2mLdfYBhbx1GWrRJhyJbDq6zh6oMmLg6WbbbvdgB6aYXes1>
- Slot: 415819196 · `meta.err: null` (success)
- Solver `HWjmoUNYckccg9Qrwi43JTzBcGcM1nbdAtATf9GXmz16`: balance Δ −1,580,620 lamports
- Recipient `6UP6...ruJ`: balance 5,672,317 → 7,252,937 lamports (Δ **+1,580,620**)

End-to-end consistent: amount-out reported by 1-click = lamports debited from solver = lamports credited to recipient.

## Fee stamping — important divergence from spec

The `bridge.route.js` proxy stamps `appFees: [{recipient: "fees.ironshield.near", fee: 20}]` on every quote, where `20` = 0.20% in basis points. **1-click's upstream rewrites this** before returning it. On both dry and live quotes against this route, the response carries:

```json
"appFees": [
  { "recipient": "fees.ironshield.near", "fee": 10 },
  { "recipient": "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd", "fee": 30 }
]
```

So:
- Our recipient (`fees.ironshield.near`) **is stamped on every bridge** — confirmed.
- Our `fee` value is normalized from `20` → `10` (10 bps = 0.10%, half of what we requested).
- An additional 30-bps fee for a 1-click solver-side recipient (`5880ad...9247dd`) is appended.

Day 14 spec's verify check (`appFees: [{recipient: "fees.ironshield.near", fee: 20}]`) does not literally match. The substantive intent — IronShield earns a platform fee on every bridge — holds, with a current rate of 10 bps instead of 20. Whether to negotiate the 20-bps allocation back, accept 10 bps as the upstream-imposed rate, or split with the solver-side recipient is a product call, not a Day 14 blocker.

## Defects in `BridgeModal.jsx` exposed by this run

The on-`main` BridgeModal's `bridge()` function has **two latent defects** that would have caused real-money loss / panic for any first user. Both are fixed in this PR:

1. **`ft_transfer` panics on every fresh quote.** 1-click issues a new NEAR implicit account (64-char hex) per quote; none are pre-registered on `wrap.near`. The first attempt of this evidence run reproduced the bug:

   > `FATAL: ServerTransactionError: Smart contract panicked: The account 65fbaa7b13a5d01b6aa98fc3620aa3b6752b00e912df1d117feace85a24d890a is not registered`

   Fix: insert a `storage_deposit({account_id: depositAddress, registration_only: true})` action immediately before `ft_transfer`. Cost: 0.00125 NEAR per bridge (one-time per deposit address). Full transaction is now 4 actions to `wrap.near` instead of 1.

2. **Non-NEAR destinations bridge to a placeholder address.** Original `BridgeModal.jsx:211`:
   ```js
   const recipient = toToken.blockchain === "near"
     ? nearCtx.address
     : (PLACEHOLDER_RECIPIENT[toToken.blockchain] || nearCtx.address);
   ```
   `PLACEHOLDER_RECIPIENT` is a chain-of-format-valid dummies (e.g. `7ZbEHHu4...XYZ` for Solana) used for **dry quotes only**. The live `bridge()` path uses the same map — so any user bridging NEAR → SOL (or NEAR → ETH, NEAR → BTC, etc.) would have sent real funds to a wallet IronShield does not control. Fix: surface a `recipient` text input for non-NEAR destinations, validate-non-empty before allowing the Bridge button.

The recipient bug is the more dangerous of the two. A reproducer run from the existing UI without these fixes would either lose the funds (if the placeholder happens to be a real wallet someone owns) or stall in 1-click's solver since the depositAddress storage panic also catches placeholder runs at action 4.

## Reproducer

```bash
node scripts/day14-bridge-evidence.js
```

Loads `~/.near-credentials/mainnet/ironshield.near.json`. Hardcoded:
- 0.1 NEAR amount
- destination `6UP6LumJUY6Hy2TQzfhsuKhVtxzPriq99LS7qdeP2ruJ`
- 1-click base `https://1click.chaindefuser.com/v0`

Each invocation initiates a real bridge. Don't run it casually.

Machine-readable evidence object: [bridge-mainnet-evidence.json](./bridge-mainnet-evidence.json).
