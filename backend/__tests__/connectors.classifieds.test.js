// backend/__tests__/connectors.classifieds.test.js
//
// Shape + dispatch + per-site URL building. Live Playwright scraping
// not tested here — best-effort by design, would be flaky CI noise.

const test = require("node:test");
const assert = require("node:assert/strict");

const cf = require("../connectors/classifieds");

const EXPECTED_SITES = [
  // Africa — Jiji family (tier 1)
  "jiji_ng", "jiji_gh", "jiji_ke", "jiji_ug", "jiji_tz", "jiji_zm", "jiji_cm",
  // Europe — tier 1
  "kleinanzeigen_de", "leboncoin_fr", "marktplaats_nl", "olx_pl",
  // Europe — tier 2
  "wallapop_es", "subito_it",
];

test("classifieds connector: contract shape", () => {
  assert.equal(cf.name, "classifieds");
  assert.deepEqual(cf.capabilities, ["search"]);
  assert.equal(cf.auth_method, "byo_account");
  assert.equal(cf.rate_limits.scope, "wallet");
  // Tight throttle — same posture as the original jiji connector.
  assert.ok(cf.rate_limits.per_hour <= 60, "per_hour should be conservative");
});

test("classifieds connector: list_sites returns all expected sites", async () => {
  const r = await cf.invoke("list_sites", {});
  const ids = r.sites.map((s) => s.id).sort();
  for (const expected of EXPECTED_SITES) {
    assert.ok(ids.includes(expected), `expected site ${expected} in list_sites`);
  }
  assert.equal(r.sites.length, EXPECTED_SITES.length);
});

test("classifieds connector: search without site throws", async () => {
  await assert.rejects(
    () => cf.invoke("search", { params: { query: "foo" } }),
    /\{ site \} required/,
  );
});

test("classifieds connector: search with unknown site throws structured error", async () => {
  let err;
  try { await cf.invoke("search", { params: { site: "no_such_site", query: "foo" } }); }
  catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.code, "CLASSIFIEDS_UNKNOWN_SITE");
});

test("classifieds connector: search with site but no query throws", async () => {
  await assert.rejects(
    () => cf.invoke("search", { params: { site: "jiji_ng" } }),
    /\{ query \} required/,
  );
});

test("classifieds connector: invoke rejects unknown action", async () => {
  await assert.rejects(
    () => cf.invoke("teleport", {}),
    /unknown action/,
  );
});

// Per-site sanity checks: each config must build a parsable URL when
// given basic params, and declare the required surface area.
for (const id of EXPECTED_SITES) {
  test(`classifieds site ${id}: config has required fields + builds a URL`, () => {
    const site = cf._SITES[id];
    assert.ok(site, `site ${id} missing from _SITES`);
    assert.equal(site.id, id);
    assert.ok(site.label,    "label required");
    assert.ok(site.country,  "country required");
    assert.ok(site.locale,   "locale required");
    assert.ok(site.base_url, "base_url required");
    assert.equal(typeof site.search_url, "function");
    assert.ok(site.card_selector, "card_selector required");

    const url = site.search_url({ query: "test apartment", location: "Lagos", minPrice: 100, maxPrice: 5000 });
    assert.equal(typeof url, "string");
    // Must be parseable as a URL.
    const parsed = new URL(url);
    assert.ok(parsed.protocol.startsWith("http"));
    assert.ok(parsed.hostname.length > 0);
  });
}
