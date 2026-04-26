# Phase 9 — vote() pretoken_mode bugfix mainnet redeploy

End-of-Day-5 handoff flagged a real governance bug carried over from Phase 8: `governance.rs::vote()` ignored `self.pretoken_mode` and always summed pool stake for voting power, despite `pretoken.rs::get_pretoken_power()` being documented as "used by `vote()` when pretoken_mode == true". Net effect on mainnet: no `PromptUpdate` or `Mission` proposal could ever pass — every vote attempt failed `assert!(power > 0)` because no live mainnet wallet has staked tokens (the `$IRONCLAW` token does not exist yet) and `pretoken_mode` is `true`.

## What landed in the merged PR #50 (testnet)

`contract/src/governance.rs` now branches on `self.pretoken_mode` inside `vote()`:

```rust
let power: u128 = if self.pretoken_mode {
    self.get_pretoken_power(voter.clone()) as u128
} else {
    (0..self.pools.len())
        .map(|pid| {
            let key = get_user_key(&voter, pid);
            self.user_info.get(&key).map_or(0, |u| u.amount)
        })
        .sum()
};
```

The PR built and deployed only the testnet variant (gated by `--features testnet-fast`, which also shrinks `VOTING_PERIOD_NS` from 72h to 60s). Mainnet was left on the buggy Phase 8 wasm.

## Mainnet redeploy — facts

| | |
| --- | --- |
| Date | 2026-04-26 ~18:00Z |
| Account | `ironshield.near` |
| Old code_hash | `Eg9wkAuwXqZnopUG9zQf7Hc9ESYXu6USFjKFfvRL9huw` (Phase 8) |
| New code_hash | `GKwchnnRHoYvhQEzQBsD5M7EFzA58YCvobjz6puiUXcY` (Phase 9) |
| Wasm sha256 hex | `e3b983322f3b54535032e4411a6e988b728b5713d82048fb454a32da1a9d2fcd` |
| Wasm size | 658,714 bytes |
| Build | `cargo near build non-reproducible-wasm --no-abi` (no `--features testnet-fast`; default `VOTING_PERIOD_NS = 72h`) |
| Tx | [`J2fgjoD1jvj4gQMdSQ7W2Cn5u7M5MKipqinDfeKic5HD`](https://nearblocks.io/txns/J2fgjoD1jvj4gQMdSQ7W2Cn5u7M5MKipqinDfeKic5HD) |
| storage_usage Δ | 687,491 → 687,588 (+97 bytes — wasm size delta only, state shape unchanged) |

## Why no `migrate()` call

The existing [`scripts/deploy-contract.js`](../scripts/deploy-contract.js) sends an atomic `DeployContract + FunctionCall(migrate)`. That `migrate()` is the Phase 1 → Phase 2 path — it deserializes state as `OldStakingContract` (Phase 1 shape) and rebuilds the struct with empty `agent_profiles`, `agent_handles`, `skills` etc. Calling it against the live Phase 8 state would either:

1. Panic on deserialization (state shape ≠ Phase 1) — tx reverts atomically, contract stays on Phase 8 buggy code. No harm but no progress.
2. Coincidentally deserialize and **wipe all Phase 5–8 state** — agent profiles, skills, handles gone.

Neither outcome is acceptable. Phase 9 is a body-of-function fix only; the struct shape, all `Vector`/`UnorderedMap` prefixes, and all field names are byte-identical to Phase 8. So the right tool is a single `DeployContract` action with no migrate call.

[`scripts/deploy-contract-code-only.js`](../scripts/deploy-contract-code-only.js) is that tool. It:

- Loads `~/.near-credentials/mainnet/ironshield.near.json`.
- Sends a single `DeployContract(wasm)` action.
- Reads pre + post `code_hash` and `storage_usage`.
- Smokes four view methods (`get_pretoken_mode`, `get_vanguard_token_id_max`, `get_proposals`, `get_pools`) — all four must return successfully, otherwise the new code can't deserialize the existing storage and the contract is soft-bricked.

The smoke is the verify check: every view method that touches a `Vector` or `UnorderedMap` exercises `BorshDeserialize` against the storage layout. If any panicked we'd have evidence of a struct-shape regression before any user hit it.

## Verify post-deploy

All four smoke methods returned sane data:

```
get_pretoken_mode → true
get_vanguard_token_id_max → 1000
get_proposals → [{"id":0,"title":"Treasury report — 2026-04-07", ...}]
get_pools → [{"total_staked":0,"reward_multiplier":100, ...}]
```

The fixed `vote()` path is **not** exercised by these smokes (no active pretoken proposal with a vanguard or contributor voter to test against). The next pretoken-mode `PromptUpdate` or `Mission` proposal that gets a vanguard NFT holder voting will be the first real test of the fix on mainnet — at that point the proposal should reach `executed` instead of failing the `power > 0` assert.

## When to use `deploy-contract-code-only.js` vs `deploy-contract.js`

- **`deploy-contract.js`** — wasm includes a struct shape change (new field, prefix, removed field, etc.) AND there is a matching `migrate_*` method that knows how to convert old-shape → new-shape.
- **`deploy-contract-code-only.js`** — wasm only changes function bodies; struct, field names, and storage prefixes are byte-identical to the previously deployed wasm. Safest path for backports / behavior bugfixes.

When in doubt, run `--dry-run` first (both scripts support it), and inspect `storage_usage` post-deploy: if it changes by anything other than the wasm size delta, investigate.
