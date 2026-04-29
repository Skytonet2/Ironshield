// backend/__tests__/classifiedsDrift.test.js
//
// Unit-tests runOnce() with stubbed connector + telemetry. Live
// Playwright is not exercised — that's the on-prod smoke.

const test = require("node:test");
const assert = require("node:assert/strict");

const drift = require("../services/classifiedsDrift");

function withStubs(stubs, fn) {
  // Reach into the module's lazy-required slots by re-loading them
  // through the same require paths the runOnce() helper uses.
  const cf = require("../connectors/classifieds");
  const telemetry = require("../services/telemetry");

  const origInvoke = cf.invoke;
  const origSites = cf._SITES;
  const origBump  = telemetry.bumpFireAndForget;

  if (stubs.invoke) cf.invoke = stubs.invoke;
  if (stubs.sites)  Object.defineProperty(cf, "_SITES", { value: stubs.sites, configurable: true });
  if (stubs.bump)   telemetry.bumpFireAndForget = stubs.bump;

  return Promise.resolve(fn()).finally(() => {
    cf.invoke = origInvoke;
    if (stubs.sites) Object.defineProperty(cf, "_SITES", { value: origSites, configurable: true });
    telemetry.bumpFireAndForget = origBump;
  });
}

test("classifiedsDrift.runOnce: walks every configured site and records ok/empty/failure", async () => {
  const bumps = [];
  await withStubs(
    {
      sites: { siteA: {}, siteB: {}, siteC: {} },
      invoke: async (action, ctx) => {
        const id = ctx?.params?.site;
        if (id === "siteA") return { count: 12, items: new Array(12).fill({ title: "x" }) };
        if (id === "siteB") return { count: 0,  items: [] };
        if (id === "siteC") throw Object.assign(new Error("boom"), { code: "BOOM" });
        throw new Error("unreachable");
      },
      bump: (event, label) => bumps.push([event, label]),
    },
    async () => {
      const out = await drift.runOnce();
      assert.equal(out.sites.length, 3);
      const byId = Object.fromEntries(out.sites.map((r) => [r.site, r]));
      assert.equal(byId.siteA.status, "ok");
      assert.equal(byId.siteA.count, 12);
      assert.equal(byId.siteB.status, "empty");
      assert.equal(byId.siteB.count, 0);
      assert.equal(byId.siteC.status, "failure");
      assert.equal(byId.siteC.code, "BOOM");

      assert.deepEqual(out.summary, { total: 3, ok: 1, empty: 1, failure: 1 });

      // Each site bumped a counter exactly once.
      const labels = bumps.map(([e, l]) => `${e}:${l}`).sort();
      assert.deepEqual(labels, [
        "classifieds.drift.empty:siteB",
        "classifieds.drift.failure:siteC",
        "classifieds.drift.ok:siteA",
      ]);
    }
  );
});

test("classifiedsDrift.runOnce: skips when no sites are configured", async () => {
  await withStubs(
    { sites: {}, invoke: async () => { throw new Error("should not be called"); } },
    async () => {
      const out = await drift.runOnce();
      assert.equal(out.skipped, true);
      assert.equal(out.reason, "no-sites");
    }
  );
});

test("classifiedsDrift.summarise: counts statuses correctly", () => {
  const rows = [
    { status: "ok" }, { status: "ok" }, { status: "empty" }, { status: "failure" },
  ];
  assert.deepEqual(drift.summarise(rows), { total: 4, ok: 2, empty: 1, failure: 1 });
});
