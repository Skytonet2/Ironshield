// backend/__tests__/connectors.whatsapp.test.js
// Shape + dispatch + webhook handler tests. No live Cloud API calls.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "vt-fixture";

const wa = require("../connectors/whatsapp");

function fakeReqRes(over = {}) {
  const res = {
    statusCode: 200, body: null, ended: false,
    status(c) { res.statusCode = c; return res; },
    json(b)   { res.body = b; return res; },
    send(b)   { res.body = b; return res; },
    end()     { res.ended = true; return res; },
    get()     { return ""; },
  };
  return { req: { query: {}, body: {}, ...over }, res };
}

test("whatsapp connector: contract shape", () => {
  assert.equal(wa.name, "whatsapp");
  assert.deepEqual(wa.capabilities.sort(), ["monitor", "write"]);
  assert.equal(wa.auth_method, "byo_account");
  assert.equal(wa.rate_limits.scope, "wallet");
  assert.equal(typeof wa.webhook.handleVerify, "function");
  assert.equal(typeof wa.webhook.handleEvent,  "function");
});

test("whatsapp connector: send without creds throws connect-first", async () => {
  const credStore = require("../connectors/credentialStore");
  const orig = credStore.getDecrypted;
  credStore.getDecrypted = async () => null;
  try {
    await assert.rejects(
      () => wa.invoke("send", { wallet: "alice.near", params: { to: "234...", text: "hi" } }),
      /connect WhatsApp Business first/
    );
  } finally {
    credStore.getDecrypted = orig;
  }
});

test("whatsapp connector: invoke rejects unknown action", async () => {
  await assert.rejects(
    () => wa.invoke("teleport", { wallet: "alice.near" }),
    /unknown action/
  );
});

test("whatsapp webhook: verify accepts matching token + returns challenge", () => {
  const { req, res } = fakeReqRes({
    query: { "hub.mode": "subscribe", "hub.verify_token": "vt-fixture", "hub.challenge": "echo-me" },
  });
  wa.webhook.handleVerify(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "echo-me");
});

test("whatsapp webhook: verify rejects mismatched token", () => {
  const { req, res } = fakeReqRes({
    query: { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "x" },
  });
  wa.webhook.handleVerify(req, res);
  assert.equal(res.statusCode, 403);
});

test("whatsapp webhook: handleEvent acks 200 even on malformed body", async () => {
  const { req, res } = fakeReqRes({ body: { not_a: "real_event" } });
  await wa.webhook.handleEvent(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.ended, true);
});
