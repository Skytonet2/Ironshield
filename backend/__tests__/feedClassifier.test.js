// backend/__tests__/feedClassifier.test.js
//
// Pure-helper tests for the agent-economy feed classifier. The DB-touching
// path classifyPost() is integration-tested separately when a Postgres URL
// is wired; these cover the deterministic prompt + parse + normalize
// pipeline so prompt drift, model hallucination, and enum slop are caught
// without an LLM round-trip.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSystemPrompt,
  parseClassifierReply,
  normalizeClassification,
  classifyText,
  CLASSIFIER_VERSION,
  VERTICALS,
  INTENTS,
  URGENCIES,
} = require("../services/feedClassifier");

test("CLASSIFIER_VERSION is stable and namespaced", () => {
  assert.match(CLASSIFIER_VERSION, /^feed-/);
});

test("buildSystemPrompt enumerates every closed-set vocabulary", () => {
  const p = buildSystemPrompt();
  for (const v of VERTICALS) assert.ok(p.includes(`"${v}"`), `prompt missing vertical ${v}`);
  for (const i of INTENTS)   assert.ok(p.includes(`"${i}"`), `prompt missing intent ${i}`);
  for (const u of URGENCIES) assert.ok(p.includes(`"${u}"`), `prompt missing urgency ${u}`);
  assert.ok(p.includes("ONLY a JSON object"), "prompt should pin JSON-only output");
});

test("parseClassifierReply extracts JSON from a bare object reply", () => {
  const r = parseClassifierReply('{"vertical":"automotive","confidence":0.9}');
  assert.equal(r.vertical, "automotive");
  assert.equal(r.confidence, 0.9);
});

test("parseClassifierReply unwraps ```json fences", () => {
  const r = parseClassifierReply("```json\n{\"vertical\":\"real_estate\"}\n```");
  assert.equal(r.vertical, "real_estate");
});

test("parseClassifierReply tolerates leading prose", () => {
  const r = parseClassifierReply('Sure! Here you go: {"vertical":"freelance","intent":"hire"} — let me know.');
  assert.equal(r.vertical, "freelance");
  assert.equal(r.intent,   "hire");
});

test("parseClassifierReply returns null on invalid JSON instead of throwing", () => {
  assert.equal(parseClassifierReply("nope, not even close"), null);
  assert.equal(parseClassifierReply("{not: valid}"), null);
  assert.equal(parseClassifierReply(""), null);
  assert.equal(parseClassifierReply(null), null);
});

test("normalizeClassification returns nulls + 0 confidence for empty input", () => {
  const n = normalizeClassification(null);
  assert.equal(n.vertical, null);
  assert.equal(n.intent, null);
  assert.equal(n.confidence, 0);
});

test("normalizeClassification coerces an enum miss to 'other' for vertical", () => {
  const n = normalizeClassification({ vertical: "rocketscience", confidence: 0.8 });
  assert.equal(n.vertical, "other");
  assert.equal(n.confidence, 0.8);
});

test("normalizeClassification keeps unknown intent/urgency null instead of guessing", () => {
  const n = normalizeClassification({ intent: "vibe", urgency: "yesterday" });
  assert.equal(n.intent, null);
  assert.equal(n.urgency, null);
});

test("normalizeClassification clamps confidence to [0,1]", () => {
  assert.equal(normalizeClassification({ confidence: 5 }).confidence, 1);
  assert.equal(normalizeClassification({ confidence: -2 }).confidence, 0);
  assert.equal(normalizeClassification({ confidence: "0.42" }).confidence, 0.42);
});

test("normalizeClassification uppercases currency and trims geo", () => {
  const n = normalizeClassification({
    budget_currency: "ngn",
    geo: "  Wuse, Abuja  ",
    language: "EN",
  });
  assert.equal(n.budget_currency, "NGN");
  assert.equal(n.geo, "Wuse, Abuja");
  assert.equal(n.language, "en");
});

test("normalizeClassification coerces stringified numbers to numeric budgets", () => {
  const n = normalizeClassification({ budget_min: "1000", budget_max: "5000" });
  assert.equal(n.budget_min, 1000);
  assert.equal(n.budget_max, 5000);
});

test("normalizeClassification drops non-numeric budgets", () => {
  const n = normalizeClassification({ budget_min: "negotiable", budget_max: null });
  assert.equal(n.budget_min, null);
  assert.equal(n.budget_max, null);
});

test("classifyText returns empty-shape classification for blank input without calling the client", async () => {
  let called = false;
  const fakeClient = {
    chat: async () => { called = true; return { reply: "{}" }; },
  };
  const r = await classifyText("   ", { client: fakeClient });
  assert.equal(called, false, "blank input should short-circuit");
  assert.equal(r.vertical, null);
  assert.equal(r.confidence, 0);
});

test("classifyText round-trips a realistic Naija mission post", async () => {
  const fakeClient = {
    chat: async ({ content, systemPrompt }) => {
      assert.ok(systemPrompt.includes("strict classifier"));
      assert.ok(content.includes("Camry"));
      return {
        reply: '{"vertical":"automotive","intent":"sell","budget_min":5000000,"budget_max":5000000,'
             + '"budget_currency":"NGN","geo":"Minna","urgency":"soon","language":"en","confidence":0.92}',
      };
    },
  };
  const r = await classifyText("Selling Camry 2015, ₦5M, Minna — need to sell soon", { client: fakeClient });
  assert.equal(r.vertical,        "automotive");
  assert.equal(r.intent,          "sell");
  assert.equal(r.budget_min,      5_000_000);
  assert.equal(r.budget_currency, "NGN");
  assert.equal(r.geo,             "Minna");
  assert.equal(r.urgency,         "soon");
  assert.equal(r.confidence,      0.92);
});

test("classifyText handles a real-estate buy intent in Wuse", async () => {
  const fakeClient = {
    chat: async () => ({
      reply: '```json\n{"vertical":"real_estate","intent":"find","budget_max":4000000,'
           + '"budget_currency":"NGN","geo":"Wuse","urgency":"flexible","confidence":0.88}\n```',
    }),
  };
  const r = await classifyText("Find me a 2-bed in Wuse under ₦4M", { client: fakeClient });
  assert.equal(r.vertical,        "real_estate");
  assert.equal(r.intent,          "find");
  assert.equal(r.budget_max,      4_000_000);
  assert.equal(r.geo,             "Wuse");
  assert.equal(r.urgency,         "flexible");
});

test("classifyText returns null vertical (not 'other') when the model returns unparseable garbage", async () => {
  // Distinct from the empty-object case below: a total parse failure
  // means we never reached a classification, so the cache row stays
  // null-everything and the matcher will skip the post entirely.
  const fakeClient = { chat: async () => ({ reply: "I don't know what to do here." }) };
  const r = await classifyText("vibes", { client: fakeClient });
  assert.equal(r.vertical, null);
  assert.equal(r.confidence, 0);
});

test("classifyText coerces a valid-but-empty JSON reply to vertical='other'", async () => {
  // The model said "I parsed your input but it doesn't fit any vertical"
  // — distinct from a parse failure. We want a concrete bucket so the
  // matcher's join is predictable.
  const fakeClient = { chat: async () => ({ reply: "{}" }) };
  const r = await classifyText("just saying hi", { client: fakeClient });
  assert.equal(r.vertical, "other");
  assert.equal(r.confidence, 0);
});
