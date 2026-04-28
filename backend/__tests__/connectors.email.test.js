// backend/__tests__/connectors.email.test.js
// Shape + dispatch checks. Live SMTP/IMAP not tested — needs a real
// mailbox (BYO design). Lazy-require errors are also asserted so we
// know the dormant path stays informative.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const email = require("../connectors/email");

test("email connector: contract shape", () => {
  assert.equal(email.name, "email");
  assert.deepEqual(email.capabilities.sort(), ["monitor", "read", "write"]);
  assert.equal(email.auth_method, "byo_account");
  assert.equal(email.rate_limits.scope, "wallet");
});

test("email connector: send rejects without to/subject/body", async () => {
  await assert.rejects(
    () => email.invoke("send", { wallet: "alice.near", params: {} }),
    /required/
  );
});

test("email connector: list_inbox without creds throws connect-first", async () => {
  const credStore = require("../connectors/credentialStore");
  const orig = credStore.getDecrypted;
  credStore.getDecrypted = async () => null;
  try {
    await assert.rejects(
      () => email.invoke("list_inbox", { wallet: "alice.near", params: {} }),
      /connect mailbox first/
    );
  } finally {
    credStore.getDecrypted = orig;
  }
});

test("email connector: send without smtp config throws", async () => {
  const credStore = require("../connectors/credentialStore");
  const orig = credStore.getDecrypted;
  credStore.getDecrypted = async () => ({ payload: { imap: { host: "x", user: "u", pass: "p" } } });
  try {
    let err;
    try {
      await email.invoke("send", {
        wallet: "alice.near",
        params: { to: "x@y.z", subject: "s", text: "t" },
      });
    } catch (e) { err = e; }
    assert.ok(err);
    // Either nodemailer is installed and we hit "smtp config missing",
    // or it isn't and we hit EMAIL_DEP_MISSING. Both are valid dormant paths.
    assert.ok(/smtp config missing|EMAIL_DEP_MISSING|nodemailer/.test(err.message + (err.code || "")));
  } finally {
    credStore.getDecrypted = orig;
  }
});

test("email connector: invoke rejects unknown action", async () => {
  await assert.rejects(
    () => email.invoke("teleport", { wallet: "alice.near" }),
    /unknown action/
  );
});
