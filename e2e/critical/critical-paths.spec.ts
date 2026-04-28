// e2e/critical/critical-paths.spec.ts
//
// Day 20 — STUBS. Six critical-path tests scaffolded for Day 20 spec
// but skipped pending fixtures. See e2e/README.md for the activation
// matrix and order of unblocking.
//
// Each test stays in this file rather than a separate spec-per-path
// because they all share the same prerequisite (a stubbed wallet
// active via ?e2e=1) — co-locating keeps the activation patch small
// when the prerequisite lands.

import { test } from "@playwright/test";

test.describe("Critical paths (skipped pending fixtures)", () => {
  test.skip("3. Connect Meteor wallet → header pill", async ({ page }) => {
    // Needs: programmatic NEAR signer accepted by the AppShell wallet
    // store in place of Meteor's popup.
    // Plan: add `?e2e=1` query in src/lib/contexts/wallet.js that
    // hydrates from a deterministic test keypair injected via env.
    await page.goto("/?e2e=1");
  });

  test.skip("4. Register agent → name appears in /agents", async ({ page }) => {
    // Needs: Test 3's stubbed wallet + a testnet agent contract so
    // we don't pollute mainnet state.
    await page.goto("/agents/create?e2e=1");
  });

  test.skip("5. Create skill → appears in marketplace", async ({ page }) => {
    // Needs: Test 3 + funded testnet wallet (alice-test.testnet has
    // ~9.99 NEAR per Day 5 handoff).
    await page.goto("/skills/create?e2e=1");
  });

  test.skip("6. Vote on a proposal → vote count increments", async ({ page }) => {
    // Needs: Test 3 + active proposal on a testnet redeploy of the
    // staking contract with the testnet-fast Cargo feature (60s
    // voting period). Mainnet contract has 7-day periods which won't
    // fit a CI run.
    await page.goto("/governance?e2e=1");
  });

  test.skip("7. Send DM → recipient sees message in second context", async ({ page, context }) => {
    // Needs: Test 3 + a second browser context with a second test
    // wallet. DM flow uses NaCl box on dm_pubkey both wallets must
    // have published. Day 8 implementation is on main.
    await page.goto("/messages?e2e=1");
  });

  test.skip("8. Buy a skill (testnet) → appears in /skills/mine", async ({ page }) => {
    // Needs: Day 15 frontend wiring (skill purchase button + the
    // POST /api/skills/record-install hook from Day 16's backend).
    // Without the button there's nothing to click.
    await page.goto("/skills/view?e2e=1");
  });
});
