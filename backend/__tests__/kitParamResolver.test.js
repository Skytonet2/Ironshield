// backend/__tests__/kitParamResolver.test.js
// Pure-resolver tests — no DB, no orchestrator.

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveTemplate, resolveParams, makeStepResolver, getPath } = require("../services/kitParamResolver");

test("getPath: walks dot + bracket paths and bottoms out as undefined", () => {
  const obj = { a: { b: [{ c: 7 }, { c: 8 }] } };
  assert.equal(getPath(obj, "a.b[0].c"), 7);
  assert.equal(getPath(obj, "a.b.1.c"),  8);   // dot-numeric form also works
  assert.equal(getPath(obj, "a.b[2].c"), undefined); // missing index → undefined, no throw
  assert.equal(getPath(obj, "a.x.y.z"),  undefined);
  assert.equal(getPath(null, "a"),       undefined);
});

test("resolveTemplate: pass-through on non-string and non-template strings", () => {
  assert.equal(resolveTemplate(42,            { results: [] }), 42);
  assert.equal(resolveTemplate("plain text",  { results: [] }), "plain text");
  assert.equal(resolveTemplate("$",           { results: [] }), "$");      // not a valid template
});

test("resolveTemplate: $prev and $<index> roots", () => {
  const env = { results: [{ items: [{ title: "A" }] }, { ok: true }] };
  assert.equal(resolveTemplate("$prev.ok",        env), true);
  assert.equal(resolveTemplate("$0.items[0].title", env), "A");
  assert.equal(resolveTemplate("$1",              env).ok, true);
});

test("resolveTemplate: $preset and $mission roots", () => {
  const env = {
    results: [],
    preset:  { target_price: 1500 },
    mission: { poster_wallet: "alice.near" },
  };
  assert.equal(resolveTemplate("$preset.target_price", env), 1500);
  assert.equal(resolveTemplate("$mission.poster_wallet", env), "alice.near");
});

test("resolveTemplate: unknown root left as literal", () => {
  assert.equal(resolveTemplate("$nope.foo", { results: [] }), "$nope.foo");
});

test("resolveParams: walks nested objects + arrays without mutating input", () => {
  const env = {
    results: [{ items: [{ title: "Apt 1", price_text: "₦2.5M" }] }],
    preset:  { target_price: "₦2M" },
  };
  const params = {
    listing_title: "$0.items[0].title",
    listing_price: "$0.items[0].price_text",
    target_price:  "$preset.target_price",
    nested: {
      meta: ["$0.items[0].title", 42, "literal"],
    },
  };
  const before = JSON.stringify(params);
  const out = resolveParams(params, env);
  // Input untouched.
  assert.equal(JSON.stringify(params), before);
  assert.deepEqual(out, {
    listing_title: "Apt 1",
    listing_price: "₦2.5M",
    target_price:  "₦2M",
    nested: { meta: ["Apt 1", 42, "literal"] },
  });
});

test("makeStepResolver: produces a per-step callback honouring priorResults", () => {
  const resolve = makeStepResolver({
    mission: { id: 7 },
    preset:  { tone: "warm" },
  });
  const out = resolve({
    step: { params: { tone: "$preset.tone", prior: "$prev.summary" } },
    priorResults: [{ summary: "ok" }],
  });
  assert.deepEqual(out, { tone: "warm", prior: "ok" });
});

test("resolveParams: missing references resolve to undefined, not crashes", () => {
  const out = resolveParams(
    { x: "$prev.does.not.exist", y: "$5.also.gone" },
    { results: [{}], preset: {}, mission: {} }
  );
  assert.equal(out.x, undefined);
  assert.equal(out.y, undefined);
});
