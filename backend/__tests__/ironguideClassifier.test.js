// backend/__tests__/ironguideClassifier.test.js
//
// Unit tests for the IronGuide classifier — the pure, dependency-free
// component that maps free-text answers onto vertical/geo/budget/lang
// and scores Kits against the resulting profile.

const test = require("node:test");
const assert = require("node:assert/strict");

const { classify, scoreKit, pickKit } = require("../services/ironguide/classifier");

test("classify returns nulls for empty input", () => {
  const c = classify("");
  assert.equal(c.vertical, null);
  assert.equal(c.geo,      null);
  assert.equal(c.budget,   null);
  assert.equal(c.language, null);
});

test("classify pulls vertical, geo, budget, language from a realistic answer", () => {
  const c = classify(
    "I run a small Shopify store selling streetwear and most of my customers are in Nigeria. " +
    "Budget is small — maybe $50 a month. Spanish responses would be great.",
  );
  assert.equal(c.vertical, "commerce");
  assert.equal(c.geo,      "africa");
  assert.equal(c.budget,   "low");
  assert.equal(c.language, "es");
});

test("classify recognises the trading vertical and high budget", () => {
  const c = classify("Looking for a crypto trading agent. Enterprise budget, no real cap.");
  assert.equal(c.vertical, "trading");
  assert.equal(c.budget,   "high");
});

test("classify keeps unknown signals null instead of guessing", () => {
  const c = classify("Just curious what you can do, no specific use case yet.");
  // No verticals/geos hit → all null. We do not synthesize a default.
  assert.equal(c.vertical, null);
  assert.equal(c.geo,      null);
});

test("scoreKit awards 5 points for an exact vertical match", () => {
  const kit = { vertical: "commerce", default_pricing_json: {} };
  const s = scoreKit(kit, { vertical: "commerce", geo: null, budget: null, language: null });
  assert.equal(s, 5);
});

test("scoreKit returns 0 when vertical mismatches and no tags overlap", () => {
  const kit = { vertical: "trading", default_pricing_json: {} };
  const s = scoreKit(kit, { vertical: "commerce", geo: "africa", budget: "low", language: "en" });
  assert.equal(s, 0);
});

test("pickKit picks the highest-scoring Kit and ignores zero-score Kits", () => {
  const kits = [
    { slug: "trader",   vertical: "trading",  default_pricing_json: {} },
    { slug: "shop-pro", vertical: "commerce", default_pricing_json: { tags: ["africa", "low"] } },
    { slug: "support",  vertical: "support",  default_pricing_json: {} },
  ];
  const winner = pickKit(kits, { vertical: "commerce", geo: "africa", budget: "low", language: null });
  assert.ok(winner);
  assert.equal(winner.kit.slug, "shop-pro");
  assert.equal(winner.score, 7); // 5 vertical + 1 geo + 1 budget
});

test("pickKit returns null when nothing scores above zero", () => {
  const kits = [
    { slug: "trader", vertical: "trading", default_pricing_json: {} },
  ];
  const winner = pickKit(kits, { vertical: "support", geo: null, budget: null, language: null });
  assert.equal(winner, null);
});
