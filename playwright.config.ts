// playwright.config.ts — Day 20 E2E suite config
//
// Tests run against an HTTP target — by default the live frontend at
// ironshield.pages.dev. Override locally with PLAYWRIGHT_BASE_URL when
// running against `npm run dev` or a future staging environment.
//
// Critical-path coverage is intentionally partial at v0.9.0+: tests
// that need wallet-popup interaction or environment fixtures we don't
// yet have (test wallets, dedicated test contract, LiveKit dev tier)
// are scaffolded with .skip() and an explicit reason — see e2e/README.md
// for the activation matrix.

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://ironshield.pages.dev";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,            // 8 specs is small; sequential keeps state predictable
  forbidOnly: !!process.env.CI,    // fails CI if a `test.only` slipped through
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // 30s per-action — slow first paints on Render cold-starts
    // (Day 7 soft-load saw cold-start spikes up to 2.7s).
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
