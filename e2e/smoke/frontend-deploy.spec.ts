// e2e/smoke/frontend-deploy.spec.ts
//
// Day 20 — Active. Walks the public surface to confirm the Cloudflare
// Pages deploy is alive and serving the expected routes. No wallet,
// no signed requests; this is the "is the lights on" smoke that runs
// in CI on every PR.

import { test, expect } from "@playwright/test";

test("home page loads with brand mark", async ({ page }) => {
  await page.goto("/");
  // The Next.js export embeds <title> at build time; checking it
  // proves we're hitting the deployed bundle, not a Cloudflare 404.
  await expect(page).toHaveTitle(/AZUKA/i);
});

test("/feed route returns 200", async ({ page }) => {
  const res = await page.goto("/feed/");
  expect(res?.status()).toBeLessThan(400);
});

test("/treasury route renders the dashboard heading", async ({ page }) => {
  await page.goto("/treasury/");
  // TreasuryPage hydrates "IronClaw Treasury" as the H-equivalent
  // header. If a regression breaks the page, the text disappears.
  await expect(page.getByText("IronClaw Treasury")).toBeVisible();
});

test("/skills/revenue route is reachable (Day 16 marker)", async ({ page }) => {
  // Confirms Day 16's new route survived the build. The page itself
  // shows the connect-wallet stub for unauth viewers — that's fine,
  // we only need the route to exist.
  const res = await page.goto("/skills/revenue/");
  expect(res?.status()).toBeLessThan(400);
});
