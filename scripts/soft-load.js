#!/usr/bin/env node
// scripts/soft-load.js — Day 7.1 soft load smoke
//
// Hits TWO read-only endpoints against the live backend:
//   GET /health              — pure healthcheck (transport baseline)
//   GET /api/auth/nonce      — DB write to auth_nonces, no auth required
//
// Mutations and AI calls are intentionally excluded — this runs against
// the live shared backend and we don't want to disturb real users or
// burn AI budget. Use the full k6 suite in scripts/load.k6.js (when it
// exists) against a dedicated preview env for the harder load profile
// the spec calls for at 250 / 500 concurrent.
//
// Usage:
//   node scripts/soft-load.js [--target=https://...] [--concurrency=50] [--duration=60]
//
// Output: JSON-line per stage with requests, RPS, p50/p95/p99, error count.

const autocannon = require("autocannon");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

const TARGET = args.target || "https://ironclaw-backend.onrender.com";
const DURATION = Number(args.duration || 60);
const STAGES = (args.stages || "50,100").split(",").map(Number);

async function runStage(stage, path, label) {
  const url = `${TARGET}${path}`;
  process.stderr.write(`\n--- ${label} | ${url} | ${stage} concurrent | ${DURATION}s ---\n`);
  const result = await autocannon({
    url,
    connections: stage,
    duration: DURATION,
    timeout: 10,
    headers: { "user-agent": "ironshield-soft-load/1.0" },
  });
  return {
    label,
    path,
    concurrency: stage,
    duration_s: DURATION,
    requests_total: result.requests.total,
    rps_avg: result.requests.average,
    latency_p50_ms: result.latency.p50,
    latency_p95_ms: result.latency.p95,
    latency_p99_ms: result.latency.p99,
    latency_max_ms: result.latency.max,
    errors: result.errors,
    timeouts: result.timeouts,
    non_2xx: result.non2xx,
    status_codes: {
      "1xx": result["1xx"],
      "2xx": result["2xx"],
      "3xx": result["3xx"],
      "4xx": result["4xx"],
      "5xx": result["5xx"],
    },
  };
}

(async () => {
  const summary = [];
  for (const stage of STAGES) {
    summary.push(await runStage(stage, "/health", `health@${stage}`));
    summary.push(await runStage(stage, "/api/auth/nonce", `nonce@${stage}`));
  }
  console.log(JSON.stringify({ target: TARGET, stages: STAGES, results: summary }, null, 2));
})().catch((e) => {
  console.error("[soft-load] fatal:", e);
  process.exit(1);
});
