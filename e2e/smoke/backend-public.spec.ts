// e2e/smoke/backend-public.spec.ts
//
// Day 20 — Active. Pokes the public backend endpoints from the test
// runner directly (no browser needed). Catches Render rolling-deploy
// regressions on the auth / health surface before they reach users.

import { test, expect, request } from "@playwright/test";

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL || "https://ironclaw-backend.onrender.com";

test("backend /health returns ok", async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BACKEND}/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
});

test("backend /api/auth/nonce mints a 43-char base64url nonce", async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BACKEND}/api/auth/nonce`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.nonce).toBe("string");
  expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(typeof body.expiresAt).toBe("number");
});

test("unsigned mutating call returns 401 missing-sig (Day 1 auth still in front)", async () => {
  const ctx = await request.newContext();
  const res = await ctx.post(`${BACKEND}/api/posts`, {
    headers: { "content-type": "application/json" },
    data: {},
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.code).toBe("missing-sig");
});

test("Day 16 treasury sources endpoint responds with a sources array", async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${BACKEND}/api/treasury/sources`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.sources)).toBe(true);
  // Two known sources at v0.9.0+: skill installs + NewsCoin fees.
  // Don't assert exact count — future days may add more.
  expect(body.sources.length).toBeGreaterThanOrEqual(1);
});
