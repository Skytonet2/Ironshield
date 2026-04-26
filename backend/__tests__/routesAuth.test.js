// backend/__tests__/routesAuth.test.js
// Static regression: every mutating endpoint on the five Day-1.4 routers
// is guarded by the requireWallet middleware (or has an explicit
// `// public:` annotation in the source — those are excluded by name).
//
// This is a structural check, not an integration test — it runs without
// a database. The middleware's runtime behaviour (401 missing-sig,
// expired-nonce, replay, etc.) is exercised in requireWallet.test.js.

const test   = require("node:test");
const assert = require("node:assert/strict");

const requireWallet = require("../middleware/requireWallet");

const ROUTES = {
  agents: {
    file:   require("../routes/agents.route"),
    public: [["post", "/automations/:id/webhook"]],
  },
  skills: {
    file:   require("../routes/skills.route"),
    public: [["post", "/http_callback/:token"]],
  },
  dm:         { file: require("../routes/dm.route"),         public: [] },
  posts:      { file: require("../routes/posts.route"),      public: [] },
  governance: {
    file:   require("../routes/governance.route"),
    public: [],  // /sync removed Day 4 — was never called.
  },
};

const MUTATING = new Set(["post", "put", "patch", "delete"]);

function isPublic(method, path, exempt) {
  return exempt.some(([m, p]) => m === method && p === path);
}

for (const [name, { file: router, public: exempt }] of Object.entries(ROUTES)) {
  test(`${name}.route — every mutating endpoint requires a signed wallet`, () => {
    const offenders = [];
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const methods = Object.keys(layer.route.methods).filter((m) => MUTATING.has(m));
      if (!methods.length) continue;
      const path = layer.route.path;
      for (const method of methods) {
        if (isPublic(method, path, exempt)) continue;
        const guarded = layer.route.stack.some((l) => l.handle === requireWallet);
        if (!guarded) offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Unguarded mutating endpoints on ${name}.route: ${offenders.join(", ")}`,
    );
  });
}
