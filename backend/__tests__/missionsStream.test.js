// backend/__tests__/missionsStream.test.js
//
// Tests for the GET /api/missions/:id/stream SSE handler. The handler
// is exported as a named function so each scenario is exercised
// directly: a mock res records writes, an injected eventBus is
// triggered manually, and snapshot + event fan-out + cleanup behaviour
// are all verified without a live HTTP roundtrip.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const EventEmitter = require("node:events");

// Stub db client before any backend module is loaded.
const clientPath = path.resolve(__dirname, "..", "db", "client.js");
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    pool: { connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }) },
  },
};

const { sseFrame, streamHandler } = require("../routes/missions.route");

// ─── Pure helper ─────────────────────────────────────────────────────

test("sseFrame: formats event name + JSON-serialised data with trailing blank line", () => {
  const frame = sseFrame("audit.appended", { step_seq: 3, mission_on_chain_id: 1 });
  assert.equal(
    frame,
    'event: audit.appended\ndata: {"step_seq":3,"mission_on_chain_id":1}\n\n',
  );
});

test("sseFrame: empty data object still produces a parseable frame", () => {
  assert.equal(sseFrame("ping", {}), "event: ping\ndata: {}\n\n");
});

// ─── Mocks ───────────────────────────────────────────────────────────

function makeReq({ id = "1" } = {}) {
  const handlers = {};
  return {
    params: { id },
    on(event, cb) { handlers[event] = cb; },
    _close() { handlers.close && handlers.close(); },
  };
}

function makeRes() {
  const writes = [];
  const headers = {};
  let flushed = false;
  return {
    statusCode: 200,
    writes,
    headers,
    flushed,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    flushHeaders() { flushed = true; },
    write(chunk) { writes.push(String(chunk)); return true; },
    status(c) { this.statusCode = c; return this; },
    json(b)   { this.body = b; return this; },
    end()     { this.ended = true; },
  };
}

function makeDeps({
  mission = { on_chain_id: 1, poster_wallet: "alice.near", claimant_wallet: "bob.near" },
  audit = [],
  escalations = [],
} = {}) {
  return {
    missionEngine: {
      getMission:   async (id) => (Number(id) === Number(mission?.on_chain_id) ? mission : null),
      getAuditLog:  async () => audit,
    },
    db: {
      query: async () => ({ rows: escalations }),
    },
    eventBus: new EventEmitter(),
  };
}

function parseFrame(s) {
  const m = s.match(/^event: ([^\n]+)\ndata: ([\s\S]+)\n\n$/);
  if (!m) return null;
  return { event: m[1], data: JSON.parse(m[2]) };
}

// ─── Handler tests ───────────────────────────────────────────────────

test("streamHandler: 400 when id is non-numeric", async () => {
  const deps = makeDeps();
  const res = makeRes();
  await streamHandler(makeReq({ id: "abc" }), res, deps);
  assert.equal(res.statusCode, 400);
});

test("streamHandler: 404 when mission absent", async () => {
  const deps = makeDeps({ mission: null });
  const res = makeRes();
  await streamHandler(makeReq({ id: "999" }), res, deps);
  assert.equal(res.statusCode, 404);
});

test("streamHandler: emits SSE headers + initial snapshot frame on connect", async () => {
  const deps = makeDeps({
    audit:       [{ step_seq: 1, action_type: "scout.start" }],
    escalations: [{ id: 7, step_seq: 1, action_type: "sign_tx", status: "pending" }],
  });
  const req = makeReq();
  const res = makeRes();
  await streamHandler(req, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/event-stream");
  assert.equal(res.headers["cache-control"], "no-cache, no-transform");
  assert.equal(res.headers["connection"], "keep-alive");
  assert.equal(res.headers["x-accel-buffering"], "no");

  const first = parseFrame(res.writes[0]);
  assert.equal(first.event, "snapshot");
  assert.equal(first.data.audit.length, 1);
  assert.equal(first.data.escalations.length, 1);
  assert.equal(first.data.escalations[0].id, 7);

  // Don't leak the keepalive interval beyond the test.
  req._close();
});

test("streamHandler: forwards mission.audit.appended events for THIS mission only", async () => {
  const deps = makeDeps();
  const req = makeReq();
  const res = makeRes();
  await streamHandler(req, res, deps);
  res.writes.length = 0; // discard snapshot

  // Same mission — should be forwarded.
  deps.eventBus.emit("mission.audit.appended", {
    mission_on_chain_id: 1,
    step_seq: 2, action_type: "outreach.dm",
    payload_hash: "h2",
  });
  // Different mission — should NOT be forwarded.
  deps.eventBus.emit("mission.audit.appended", {
    mission_on_chain_id: 999,
    step_seq: 5, action_type: "scout.start",
  });

  assert.equal(res.writes.length, 1, "only the matching event should be written");
  const frame = parseFrame(res.writes[0]);
  assert.equal(frame.event, "audit.appended");
  assert.equal(frame.data.step_seq, 2);

  req._close();
});

test("streamHandler: forwards escalation.created and escalation.resolved", async () => {
  const deps = makeDeps();
  const req = makeReq();
  const res = makeRes();
  await streamHandler(req, res, deps);
  res.writes.length = 0;

  deps.eventBus.emit("mission.escalation.created", {
    mission_on_chain_id: 1, escalation_id: 7, status: "pending", channel: "tg",
  });
  deps.eventBus.emit("mission.escalation.resolved", {
    mission_on_chain_id: 1, escalation_id: 7, status: "approved",
  });

  assert.equal(res.writes.length, 2);
  assert.equal(parseFrame(res.writes[0]).event, "escalation.created");
  assert.equal(parseFrame(res.writes[1]).event, "escalation.resolved");

  req._close();
});

test("streamHandler: req.close removes all bus listeners (no leak)", async () => {
  const deps = makeDeps();
  const req = makeReq();
  const res = makeRes();
  await streamHandler(req, res, deps);

  // Three subscriptions registered on connect.
  assert.equal(deps.eventBus.listenerCount("mission.audit.appended"),      1);
  assert.equal(deps.eventBus.listenerCount("mission.escalation.created"),  1);
  assert.equal(deps.eventBus.listenerCount("mission.escalation.resolved"), 1);

  req._close();

  assert.equal(deps.eventBus.listenerCount("mission.audit.appended"),      0);
  assert.equal(deps.eventBus.listenerCount("mission.escalation.created"),  0);
  assert.equal(deps.eventBus.listenerCount("mission.escalation.resolved"), 0);
});

test("streamHandler: a write failure on a forwarded event does NOT throw out", async () => {
  const deps = makeDeps();
  const req = makeReq();
  const res = makeRes();
  await streamHandler(req, res, deps);
  res.writes.length = 0;

  // Simulate the client disappearing — res.write throws.
  res.write = () => { throw new Error("client closed"); };

  // Should not propagate.
  deps.eventBus.emit("mission.audit.appended", {
    mission_on_chain_id: 1, step_seq: 2,
  });

  req._close();
});

// ─── Integration: missionEngine actually emits on appendAuditStep ────

test("missionEngine.appendAuditStep emits mission.audit.appended on the eventBus", async () => {
  // Replace the db module with a one-shot fake that lets the
  // transaction succeed without a real Postgres.
  const realCache = require.cache[clientPath].exports;
  require.cache[clientPath].exports = {
    ...realCache,
    transaction: async (fn) => fn({
      query: async (sql) => {
        if (/SELECT step_seq/i.test(sql))    return { rows: [] }; // first step
        if (/INSERT INTO mission_audit_log/i.test(sql)) {
          return { rows: [{
            id: 1, step_seq: 1, payload_hash: "abc", prev_hash: null,
            created_at: new Date().toISOString(),
          }] };
        }
        return { rows: [] };
      },
    }),
  };
  // Force a fresh require so the new fake propagates.
  delete require.cache[require.resolve("../services/missionEngine")];
  const me = require("../services/missionEngine");
  const eventBus = require("../services/eventBus");

  let captured = null;
  const off = eventBus.on("mission.audit.appended", (p) => { captured = p; });
  await me.appendAuditStep({
    mission_on_chain_id: 42,
    skill_id: 1, role: "scout",
    action_type: "scout.start",
    payload: { x: 1 },
    agent_wallet: "bob.near",
  });
  off();

  assert.ok(captured, "expected eventBus emit");
  assert.equal(captured.mission_on_chain_id, 42);
  assert.equal(captured.step_seq, 1);
  assert.equal(captured.action_type, "scout.start");
  assert.equal(captured.payload_hash, "abc");

  require.cache[clientPath].exports = realCache;
  delete require.cache[require.resolve("../services/missionEngine")];
});
