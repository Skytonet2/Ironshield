// backend/__tests__/connectors.route.test.js
// Static regression on the connectors router:
//   - GET / (registry list) and the WhatsApp webhook endpoints are public.
//   - Every other mutating endpoint is guarded by requireWallet.
//   - GET /me is wallet-guarded too (it leaks per-wallet data).

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const requireWallet = require("../middleware/requireWallet");
const router = require("../routes/connectors.route");
const connectors = require("../connectors");

// (method, path) pairs that intentionally bypass requireWallet.
const PUBLIC = new Set([
  "get /",
  "get /whatsapp/webhook",
  "post /whatsapp/webhook",
  // OAuth callbacks are top-level GETs from the provider — they auth
  // via the signed cookie set during /start, not the wallet middleware.
  "get /x/oauth/callback",
  "get /facebook/oauth/callback",
  "get /email/oauth/google/callback",
  "get /email/oauth/microsoft/callback",
  // tg/inbound is the bot HTTP fallback — gated by
  // ORCHESTRATOR_SHARED_SECRET, not the wallet middleware.
  "post /tg/inbound",
]);

test("connectors.route — public surface stays public, everything else is wallet-guarded", () => {
  const offenders = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    for (const method of Object.keys(layer.route.methods)) {
      const key = `${method} ${path}`;
      const guarded = layer.route.stack.some((l) => l.handle === requireWallet);
      if (PUBLIC.has(key)) {
        if (guarded) offenders.push(`${key} should be public but is guarded`);
      } else {
        if (!guarded) offenders.push(`${key} should be guarded but is public`);
      }
    }
  }
  assert.deepEqual(offenders, [], `Auth-guard mismatches: ${offenders.join("; ")}`);
});

test("connectors.route — GET / returns the connectors registry shape", async () => {
  // Simulate Express by walking the layer for "GET /" directly.
  const layer = router.stack.find(
    (l) => l.route?.path === "/" && l.route?.methods?.get
  );
  assert.ok(layer, "no GET / layer");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let body;
  await handler(
    { method: "GET" },
    { json: (b) => { body = b; }, status() { return this; } }
  );
  assert.ok(Array.isArray(body.connectors));
  // Every registered connector should appear with the public contract fields.
  const names = body.connectors.map((c) => c.name).sort();
  for (const expected of ["tg", "x", "facebook", "jiji", "email", "whatsapp", "linkedin"]) {
    assert.ok(names.includes(expected), `expected ${expected} in registry`);
  }
  for (const c of body.connectors) {
    assert.ok(typeof c.name === "string");
    assert.ok(Array.isArray(c.capabilities));
    assert.ok(typeof c.auth_method === "string");
    // Encrypted blob shape MUST NOT leak through the public list.
    assert.equal(c.payload, undefined);
    assert.equal(c.invoke,  undefined);
  }
});

test("connectors.route — POST /:name/connect rejects unknown connector with 404", async () => {
  const layer = router.stack.find(
    (l) => l.route?.path === "/:name/connect" && l.route?.methods?.post
  );
  assert.ok(layer);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let status, body;
  await handler(
    { params: { name: "no-such-connector" }, body: { payload: { x: 1 } }, wallet: "alice.near" },
    { status(c) { status = c; return this; }, json(b) { body = b; } }
  );
  assert.equal(status, 404);
  assert.match(body.error, /unknown connector/);
});

test("connectors.route — POST /:name/connect rejects empty payload with 400", async () => {
  const layer = router.stack.find(
    (l) => l.route?.path === "/:name/connect" && l.route?.methods?.post
  );
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let status, body;
  await handler(
    { params: { name: "x" }, body: {}, wallet: "alice.near" },
    { status(c) { status = c; return this; }, json(b) { body = b; } }
  );
  assert.equal(status, 400);
  assert.match(body.error, /payload/);
});

test("connectors.route — POST /tg/inbound enforces shared secret + emits", async () => {
  const layer = router.stack.find(
    (l) => l.route?.path === "/tg/inbound" && l.route?.methods?.post
  );
  assert.ok(layer, "no /tg/inbound layer");
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;

  const eventBus = require("../services/eventBus");
  const SAVED = process.env.ORCHESTRATOR_SHARED_SECRET;
  process.env.ORCHESTRATOR_SHARED_SECRET = "shh";

  function mkRes() {
    const r = {
      statusCode: 200, body: null,
      status(c) { r.statusCode = c; return r; },
      json(b)   { r.body = b; return r; },
    };
    return r;
  }

  // 1) Missing secret → 403.
  let res = mkRes();
  await handler({ headers: {}, body: { text: "hi" } }, res);
  assert.equal(res.statusCode, 403);

  // 2) Wrong secret → 403.
  res = mkRes();
  await handler({ headers: { "x-orchestrator-secret": "nope" }, body: { text: "hi" } }, res);
  assert.equal(res.statusCode, 403);

  // 3) Right secret + missing text → 400.
  res = mkRes();
  await handler({ headers: { "x-orchestrator-secret": "shh" }, body: {} }, res);
  assert.equal(res.statusCode, 400);

  // 4) Right secret + valid body → 200, eventBus receives it.
  let received = null;
  const onMsg = (m) => { received = m; };
  eventBus.on("connector:tg:message", onMsg);
  try {
    res = mkRes();
    await handler(
      { headers: { "x-orchestrator-secret": "shh" }, body: { text: "hello", chat_id: 9 } },
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(received, { text: "hello", chat_id: 9 });
  } finally {
    eventBus.off("connector:tg:message", onMsg);
    if (SAVED) process.env.ORCHESTRATOR_SHARED_SECRET = SAVED;
    else delete process.env.ORCHESTRATOR_SHARED_SECRET;
  }
});
