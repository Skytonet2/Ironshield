# Skill purchase flow (Day 15)

## On-chain method

`install_skill(skill_id: u64)` in `contract/src/agents.rs`. `#[payable]`.
Caller must attach `>= skill.price_yocto`. Contract splits the
*exact* price 85% to author / 15% to platform; any overpay refunds
back to the caller in the same Promise batch.

Free skills (price 0) accept zero-deposit calls; if a caller
mistakenly attaches funds they're refunded in full.

Event emitted on success:

```
EVENT_JSON:{"standard":"ironshield","version":"1.0","event":"skill_installed",
  "data":{"owner":"<buyer>","skill_id":<id>,"price_yocto":"<wei>","paid":<bool>}}
```

The off-chain indexer at `backend/routes/skills.route.js
POST /api/skills/record-install` consumes this event and writes a
row to `skill_sales` so the creator-revenue dashboard
(`/skills/revenue`) picks up the sale.

## Refund semantics

NEAR's runtime auto-refunds the attached deposit if the receipt that
collected it panics **before** any `Promise::new(...).transfer(...)`
fires. In `install_skill`, all `assert!`s (registered agent check,
already-installed check, slot-limit check) execute before the
85/15 split transfers. If any of those panics:

- The whole receipt aborts.
- No transfer Promise is scheduled.
- The runtime returns the full attached deposit minus gas to the
  caller's account in the same block.

This means we don't need defensive Rust refund code — the runtime
guarantee is sufficient for the failure modes the spec calls out:

| Scenario | Refund path |
|---|---|
| No registered agent | Runtime auto-refund |
| Already installed | Runtime auto-refund |
| 25-skill cap reached | Runtime auto-refund |
| Underpayment | Runtime auto-refund (assert panics before any transfer) |
| Skill deleted between view + tx | `self.skills.get` returns None → `.expect("Skill not found")` panics → runtime auto-refund |
| Overpayment | Explicit refund Promise in the contract (`refund = attached - price`) |

## Failure modes the runtime guarantee does NOT cover

None at v1. The refund logic is fully in-receipt — there are no
cross-contract calls or callbacks involved. If a future revision
adds an XCC step (e.g. royalty splits to NEP-141 token receivers),
this section needs to be revisited because XCC failures land the
deposit in limbo unless an explicit refund callback is wired.

## Frontend hook

`src/hooks/useAgent.js installSkill(skillId, priceYocto)` →
`callMethod(STAKING_CONTRACT, "install_skill", { skill_id }, priceYocto)`.

The marketplace's Buy button shows a confirmation modal for paid
installs (free skips the modal — friction without upside) and after
a successful `signAndSendTransaction` posts the tx hash to the
`/api/skills/record-install` indexer. Redirect wallets
(MyNearWallet) never reach the post-call code path — recording
their installs through URL-return parsing is a follow-up.

## Fee schedule history

| Phase | Split | Reason |
|---|---|---|
| Phase 7 → Phase 9 | 1% / 99% | Initial conservative cut while the marketplace was empty. |
| Day 15 (v1) | 15% / 85% | Aligns skill revenue with platform economics; mirrors NewsCoin's 1% bonding-curve fee at a higher rate because skill purchases are less elastic. |

The constant lives in **two** places that must move together:
- `contract/src/agents.rs PLATFORM_FEE_BPS`
- `backend/routes/skills.route.js PLATFORM_FEE_BPS`

If they diverge, dashboards lie about creator earnings vs treasury
take. A linkcheck in CI is a v1.1 follow-up.

## Mainnet rollout

The Day 15 split (15/85) lives on testnet (`ironshield-test.testnet`
tx `4UmAJVxPyko7yjcZJ7sUorb78BTWUqPdgk7z2hayozSD`). Mainnet stays
on 1/99 until the Day 21 cutover redeploys `ironshield.near`.

The backend `PLATFORM_FEE_BPS` constant deliberately stays at 100
(1%) in this PR even though the contract testnet build moved to
1500 (15%). Reason: production `/api/skills/record-install` calls
land on mainnet, which is still on 1/99 — flipping the backend
constant ahead of the mainnet redeploy would write wrong creator
vs treasury split numbers into `skill_sales` and the
`/skills/revenue` dashboard would lie. The Day 21 cutover PR moves
the contract on mainnet AND the backend constant in the same
deploy.

For the Day 21 cutover playbook see `docs/runbook.md`.
