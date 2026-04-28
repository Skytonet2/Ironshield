// backend/__tests__/connectors.credentialStore.test.js
// Roundtrip tests for connector credential encryption (Phase 10 Tier 4).
// DB-touching paths are covered by the migration smoke; here we
// only verify the AES-256-GCM blob shape and JSON roundtrip.

const test = require("node:test");
const assert = require("node:assert/strict");

// Set a deterministic 32-byte hex key before requiring the module.
process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const store = require("../connectors/credentialStore");

test("encrypt produces a Buffer with iv(12) + tag(16) + ciphertext", () => {
  const blob = store.encrypt({ access_token: "abc", refresh_token: "def" });
  assert.ok(Buffer.isBuffer(blob));
  // 12 + 16 + at least 1 byte of ciphertext (json: ~50 bytes plaintext)
  assert.ok(blob.length > 28);
});

test("decrypt is the inverse of encrypt", () => {
  const original = {
    access_token: "abc",
    refresh_token: "def",
    expires_at: "2027-01-01T00:00:00Z",
    nested: { foo: "bar", n: 42 },
  };
  const blob = store.encrypt(original);
  const back = store.decrypt(blob);
  assert.deepEqual(back, original);
});

test("decrypt with wrong key throws (auth-tag mismatch)", () => {
  const blob = store.encrypt({ x: 1 });
  process.env.CUSTODIAL_ENCRYPT_KEY =
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  // Module already has its key reader bound at function-call time —
  // each encrypt/decrypt re-reads env. So flipping the key here is
  // enough to make decrypt panic.
  assert.throws(() => store.decrypt(blob));
  // Restore for any later tests in this file.
  process.env.CUSTODIAL_ENCRYPT_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

test("missing key throws helpful error", () => {
  const orig = process.env.CUSTODIAL_ENCRYPT_KEY;
  delete process.env.CUSTODIAL_ENCRYPT_KEY;
  assert.throws(() => store.encrypt({ x: 1 }), /CUSTODIAL_ENCRYPT_KEY not set/);
  process.env.CUSTODIAL_ENCRYPT_KEY = orig;
});

test("wrong-length key throws", () => {
  const orig = process.env.CUSTODIAL_ENCRYPT_KEY;
  process.env.CUSTODIAL_ENCRYPT_KEY = "abcd";
  assert.throws(() => store.encrypt({ x: 1 }), /must be 32 bytes hex/);
  process.env.CUSTODIAL_ENCRYPT_KEY = orig;
});
