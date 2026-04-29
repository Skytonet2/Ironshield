// backend/__tests__/telemetry.test.js
//
// Tests the helper's contract:
//   - bump increments via SQL upsert (covered by stub-asserting the SQL).
//   - DB failures NEVER bubble out of bump or bumpFireAndForget.
//   - list passes a sane limit through to the query.

const test = require("node:test");
const assert = require("node:assert/strict");

// Stub backend/db/client BEFORE requiring telemetry so the module
// picks up our fake.
const db = require("../db/client");
const ORIG_QUERY = db.query;

function withDbStub(fn, stub) {
  const prev = db.query;
  db.query = stub;
  return Promise.resolve(fn()).finally(() => { db.query = prev; });
}

const telemetry = require("../services/telemetry");

test("telemetry.bump issues an INSERT … ON CONFLICT … DO UPDATE", async () => {
  let calledWith = null;
  await withDbStub(
    () => telemetry.bump("connector.invoke", "x"),
    async (sql, params) => {
      calledWith = { sql, params };
      return { rowCount: 1 };
    },
  );
  assert.match(calledWith.sql, /INSERT INTO event_counters/);
  assert.match(calledWith.sql, /ON CONFLICT \(event_name, label\) DO UPDATE/);
  assert.deepEqual(calledWith.params, ["connector.invoke", "x", 1]);
});

test("telemetry.bump: ignores empty event name", async () => {
  let called = false;
  await withDbStub(
    () => telemetry.bump("", "x"),
    async () => { called = true; return { rowCount: 0 }; },
  );
  assert.equal(called, false);
});

test("telemetry.bump: caps label length and never throws on DB error", async () => {
  // Long label gets sliced to 120 chars.
  let observed;
  await withDbStub(
    () => telemetry.bump("e", "x".repeat(500)),
    async (_sql, params) => { observed = params[1]; throw new Error("ECONNRESET"); },
  );
  assert.equal(observed.length, 120);
  // Did not throw despite the DB error.
});

test("telemetry.bumpFireAndForget never returns a rejected promise", async () => {
  await withDbStub(
    () => Promise.resolve(telemetry.bumpFireAndForget("e", "x")),
    async () => { throw new Error("oh no"); },
  );
  // Reaching here means no unhandled rejection.
  assert.ok(true);
});

test("telemetry.list clamps limit to [1, 1000]", async () => {
  for (const [input, expected] of [[0, 1], [-5, 1], [99999, 1000], [50, 50]]) {
    let observed;
    await withDbStub(
      () => telemetry.list({ limit: input }),
      async (_sql, params) => { observed = params[0]; return { rows: [] }; },
    );
    assert.equal(observed, expected, `limit ${input} → ${expected}`);
  }
});
