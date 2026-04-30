// backend/__tests__/ironguideSteps.test.js
//
// Pure unit tests for the AZUKA Guide step machine. No DB needed —
// the step graph and canonicalization are pure functions.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Hijack db client require so transitively-loaded modules don't try
// to open Postgres connections — the step machine itself is pure but
// it lives next to db-touching siblings.
const clientPath = path.resolve(__dirname, "..", "db", "client.js");
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    pool: { connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }) },
  },
};

const steps = require("../services/ironguide/steps");

test("INITIAL_STEP is country", () => {
  assert.equal(steps.INITIAL_STEP, "country");
});

test("country step has the expected option set", () => {
  const q = steps.publicQuestion("country");
  assert.equal(q.id, "country");
  const values = q.options.map((o) => o.value);
  assert.ok(values.includes("ng"));
  assert.ok(values.includes("ke"));
  assert.ok(values.includes("us"));
  assert.ok(values.includes("other"));
  assert.equal(q.allow_other, true);
});

test("publicQuestion strips internal next() resolver", () => {
  const q = steps.publicQuestion("country");
  // Public shape only carries id/text/options/allow_other.
  assert.deepEqual(Object.keys(q).sort(), ["allow_other", "id", "options", "text"]);
});

test("publicQuestion returns null for terminal step", () => {
  assert.equal(steps.publicQuestion("recommend"), null);
});

test("resolveNext: country → category for any answer", () => {
  assert.equal(steps.resolveNext("country", "ng"), "category");
  assert.equal(steps.resolveNext("country", "other"), "category");
  assert.equal(steps.resolveNext("country", "Mongolia (free text)"), "category");
});

test("resolveNext: category branches by value", () => {
  assert.equal(steps.resolveNext("category", "sell"), "sell_item");
  assert.equal(steps.resolveNext("category", "find_work"), "work_type");
  assert.equal(steps.resolveNext("category", "watch_wallet"), "wallet_address");
  assert.equal(steps.resolveNext("category", "background_check"), "bg_subject");
  assert.equal(steps.resolveNext("category", "other"), "free_describe");
  // Unknown / free-text "other" answer also falls into the catch-all.
  assert.equal(steps.resolveNext("category", "I want to do something weird"), "free_describe");
});

test("resolveNext: sell_item → sell_price", () => {
  assert.equal(steps.resolveNext("sell_item", "car"), "sell_price");
});

test("resolveNext: budget_window is the last gate before recommend", () => {
  assert.equal(steps.resolveNext("budget_window", "free"), "recommend");
  assert.equal(steps.resolveNext("budget_window", "high"), "recommend");
});

test("resolveNext: terminal step returns null", () => {
  assert.equal(steps.resolveNext("recommend", "anything"), null);
});

test("canonicalize: matches a known option", () => {
  const c = steps.canonicalize("country", "ng");
  assert.equal(c.value, "ng");
  assert.equal(c.label, "🇳🇬 Nigeria");
});

test("canonicalize: free-text falls through when allow_other", () => {
  const c = steps.canonicalize("country", "Mongolia");
  assert.equal(c.value, "Mongolia");
  assert.equal(c.label, "Mongolia");
});

test("canonicalize: rejects unknown value on strict step (allow_other=false)", () => {
  // budget_window has allow_other: false; only the four bucket values
  // are legal. Unknown values must return null so the route can re-ask.
  assert.equal(steps.canonicalize("budget_window", "weird"), null);
  // Known values work.
  const c = steps.canonicalize("budget_window", "low");
  assert.equal(c.value, "low");
  assert.equal(c.label, "Up to $5 / mo");
});

test("canonicalize: trims + caps long free text at 240 chars", () => {
  const long = "x".repeat(500);
  const c = steps.canonicalize("free_describe", "  " + long + "  ");
  assert.equal(c.value.length, 240);
  assert.equal(c.label.length, 240);
});

test("canonicalize: empty input returns null", () => {
  assert.equal(steps.canonicalize("country", ""), null);
  assert.equal(steps.canonicalize("country", "   "), null);
});

test("canonicalize: throws on terminal step", () => {
  assert.throws(() => steps.canonicalize("recommend", "x"), /terminal/);
});

test("getStep: throws on unknown id", () => {
  assert.throws(() => steps.getStep("does_not_exist"), /Unknown ironguide step/);
});

test("every non-terminal step has a next() resolver", () => {
  for (const [id, step] of Object.entries(steps.STEPS)) {
    if (step.terminal) continue;
    assert.equal(typeof step.next, "function", `${id} missing next()`);
  }
});

test("every reachable next() target is a real step id", () => {
  const probeAnswers = ["ng", "sell", "find_work", "watch_wallet", "background_check", "other", "car", "freelance", "free", "anything"];
  for (const [id, step] of Object.entries(steps.STEPS)) {
    if (step.terminal) continue;
    for (const probe of probeAnswers) {
      const next = step.next(probe);
      assert.ok(steps.STEPS[next], `${id} → ${next} (probe=${probe}) is not a known step`);
    }
  }
});
