# IronShield E2E suite (Day 20)

Playwright-based browser tests against the live frontend.

## Run

```bash
npx playwright install --with-deps chromium  # first run only
npm run e2e                                  # full suite
npm run e2e -- --headed                      # watch the browser
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run e2e   # against npm run dev
```

CI runs on every PR via `.github/workflows/e2e.yml`.

## Coverage at v0.9.0+

The Day 20 spec calls for 8 critical-path tests. Some need fixtures we
don't yet have. Below is the activation matrix.

| # | Path | Status | What it needs to enable |
|---|---|---|---|
| 1 | Frontend boots + critical routes return 200 | ✅ active | nothing |
| 2 | Public auth/nonce endpoint reachable | ✅ active | nothing |
| 3 | Connect Meteor wallet → header pill | 🚧 skipped | A programmatic NEAR signer that the AppShell wallet store accepts in place of Meteor's popup. Plan: add a test-only `?e2e=1` query that activates a stubbed wallet in `src/lib/contexts/wallet.js`. |
| 4 | Register agent → name in `/agents` | 🚧 skipped | Test 3's stubbed wallet + a dedicated testnet agent contract account so we don't pollute mainnet state. |
| 5 | Create skill → appears in marketplace | 🚧 skipped | Test 3 + funded testnet wallet (`alice-test.testnet` has 9.99 NEAR) + ensures Day 16's `record-install` hook in Day 15 lands first. |
| 6 | Vote on a proposal → count increments | 🚧 skipped | Test 3 + an active proposal on testnet's contract. Phase 9 contract is mainnet; would need a testnet redeploy of the staking contract with `testnet-fast` Cargo feature for a 60s voting period. |
| 7 | Send DM → recipient sees in second context | 🚧 skipped | Test 3 + a second browser context with a second test wallet. The DM flow uses NaCl box on the dm_pubkey both wallets must have published. |
| 8 | Buy a skill → appears in `/skills/mine` | 🚧 skipped | Day 15 frontend wiring (skill purchase button). Without it there's nothing to click. |
| 9 | Join a room → both contexts see each other | 🚧 skipped | Day 19 LiveKit production tier. Today's rooms are managed dev tier without persistent recording infra. |
| 10 | Create automation → fires on test event | 🚧 skipped | Test 3 + automation worker reachability from the test runner; webhook trigger paths need a callback URL the runner can receive. |

Today's two active tests prove the basic deploy is reachable. They're
useful as a tripwire: if Cloudflare or Render goes sideways, CI catches
it before users do.

## Activation order

The fastest unlock is **Test 3** (stubbed wallet). Once that lands,
tests 4, 5, 6, 7, 10 become writable in the same session because they
all share the wallet stub. Test 8 needs Day 15 separately. Test 9
needs Day 19.
