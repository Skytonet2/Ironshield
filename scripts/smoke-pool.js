#!/usr/bin/env node
// scripts/smoke-pool.js — Day 6.2 pool-tuning smoke
//
// Fires 200 parallel SELECT 1 queries through the shared pg pool.
// Asserts: all 200 resolve, in under 5s, with zero connection errors.
// Validates the post-Day-6.2 pool config (max=30) absorbs a burst that
// the old max=10 would have queued/dropped.
//
// Run against a local dev DB:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ironshield \
//     node scripts/smoke-pool.js

const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local"), override: true });

const { pool, close } = require("../backend/db/client");

const N = 200;
const BUDGET_MS = 5_000;

(async () => {
  const errors = [];
  const onPoolError = (e) => errors.push({ source: "pool", message: e.message });
  pool.on("error", onPoolError);

  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      pool.query("SELECT $1::int AS i", [i + 1])
    )
  );
  const elapsed = Date.now() - t0;

  const failures = results.filter((r) => r.status === "rejected");
  failures.forEach((r) =>
    errors.push({ source: "query", message: r.reason?.message || String(r.reason) })
  );

  pool.off("error", onPoolError);
  await close();

  const ok = failures.length === 0 && errors.length === 0 && elapsed < BUDGET_MS;
  const summary = {
    fired: N,
    succeeded: results.length - failures.length,
    failed: failures.length,
    elapsed_ms: elapsed,
    budget_ms: BUDGET_MS,
    errors: errors.slice(0, 5),
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("[smoke-pool] fatal:", e);
  process.exit(1);
});
