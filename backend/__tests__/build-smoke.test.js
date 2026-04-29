// backend/__tests__/build-smoke.test.js
//
// Cheap guard against the "next build silently breaks because a
// transitive dep dropped" failure mode documented in
// project_pino_build_break.md. If this test fails, the build will
// fail too — fix the missing dep with `npm install --save <name>`.
//
// Pino is a known footgun: privy → walletconnect/logger requires it
// but doesn't declare it as a peer dep. We pinned it as a direct
// dep on 2026-04-29; this asserts that's still the case.

const test = require("node:test");
const assert = require("node:assert/strict");

test("build-smoke: pino is resolvable (privy → walletconnect/logger transitive)", () => {
  assert.doesNotThrow(() => require("pino"));
});
