// backend/services/feedClassifier.js
//
// Agent-economy feed: classifier for mission/bounty posts.
//
// Calls IronClaw with a strict-JSON system prompt and extracts the
// structured fields the matcher and ranker need: vertical, intent,
// budget, geo, urgency, language, confidence. Cached per post in
// post_classifications keyed on (post_id, classifier_version) so
// re-renders don't re-call the LLM.
//
// Pure helpers — buildSystemPrompt(), parseClassifierReply(),
// normalizeClassification() — are exported for unit testing without
// any IronClaw round-trip. The orchestrator path classifyPost() takes
// an injectable client for the same reason.

const ironclawClient = require("./ironclawClient");
const db             = require("../db/client");

const CLASSIFIER_VERSION = "feed-v1";

// Closed-set vocabularies. Open free-text on the LLM side leads to
// drift ("realty" vs "real_estate" vs "property"); pinning the enum
// keeps the matcher's joins predictable.
const VERTICALS = [
  "real_estate", "automotive", "freelance", "services",
  "ecommerce", "trading", "crypto", "jobs", "social", "other",
];
const INTENTS = ["sell", "buy", "hire", "list", "find", "trade", "other"];
const URGENCIES = ["now", "soon", "flexible"];

function buildSystemPrompt() {
  return [
    "You are a strict classifier for the AZUKA agent-economy feed.",
    "Given a free-form post body, return ONLY a JSON object — no prose, no markdown fences.",
    "Schema:",
    "  vertical:        one of " + JSON.stringify(VERTICALS),
    "  intent:          one of " + JSON.stringify(INTENTS),
    "  budget_min:      number or null (in budget_currency units, not yocto)",
    "  budget_max:      number or null",
    "  budget_currency: ISO-ish code (USD, NGN, EUR, NEAR, USDT, etc.) or null",
    "  geo:             short location string ('Wuse, Abuja', 'Lagos', 'remote') or null",
    "  urgency:         one of " + JSON.stringify(URGENCIES) + " or null",
    "  language:        ISO-639-1 code (en, fr, es, ha, yo, ig, …) or null",
    "  confidence:      number 0..1 — your own confidence in the classification",
    "When the post does not match any vertical (pure social chat, jokes,",
    "links), set vertical='other' and confidence below 0.3 so downstream",
    "code can skip the matcher.",
  ].join("\n");
}

function _coerceNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _coerceEnum(v, allowed) {
  if (typeof v !== "string") return null;
  const lower = v.toLowerCase().trim();
  return allowed.includes(lower) ? lower : null;
}

// Tolerant parser: the model may wrap JSON in ```json fences, prepend
// "Here you go:" or trail with explanation. Find the first {…} block
// and JSON.parse it. Returns null on any failure — the caller decides
// the fallback (we treat it as 'other' / low confidence).
function parseClassifierReply(reply) {
  if (typeof reply !== "string") return null;
  // Strip code fences if present.
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : reply;
  // Find the outermost {...} substring.
  const start = candidate.indexOf("{");
  const end   = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function normalizeClassification(raw) {
  // Default-everything-null shape; the only required field is
  // classifier_version which the caller fills in.
  const out = {
    vertical:        null,
    intent:          null,
    budget_min:      null,
    budget_max:      null,
    budget_currency: null,
    geo:             null,
    urgency:         null,
    language:        null,
    confidence:      0,
  };
  if (!raw || typeof raw !== "object") return out;

  out.vertical = _coerceEnum(raw.vertical, VERTICALS) || "other";
  out.intent   = _coerceEnum(raw.intent,   INTENTS);
  out.urgency  = _coerceEnum(raw.urgency,  URGENCIES);

  out.budget_min      = _coerceNumber(raw.budget_min);
  out.budget_max      = _coerceNumber(raw.budget_max);
  out.budget_currency = typeof raw.budget_currency === "string"
    ? raw.budget_currency.toUpperCase().slice(0, 8) : null;

  if (typeof raw.geo === "string" && raw.geo.trim()) {
    out.geo = raw.geo.trim().slice(0, 120);
  }
  if (typeof raw.language === "string") {
    out.language = raw.language.toLowerCase().slice(0, 8) || null;
  }
  const conf = _coerceNumber(raw.confidence);
  if (conf != null) out.confidence = Math.max(0, Math.min(1, conf));
  return out;
}

// Round-trip an arbitrary post body through IronClaw. Returns the
// normalized classification record without writing to the database —
// callers (typically via classifyPost) handle persistence.
async function classifyText(text, { client = ironclawClient, timeoutMs = 20000 } = {}) {
  const trimmed = String(text || "").slice(0, 2000);
  if (!trimmed.trim()) return normalizeClassification(null);
  const { reply } = await client.chat({
    content:      trimmed,
    systemPrompt: buildSystemPrompt(),
    timeoutMs,
  });
  const parsed = parseClassifierReply(reply);
  return normalizeClassification(parsed);
}

// Cache layer. Returns { cached: boolean, classification }.
async function getClassification(postId) {
  const r = await db.query(
    `SELECT * FROM post_classifications
      WHERE post_id = $1
        AND classifier_version = $2`,
    [postId, CLASSIFIER_VERSION]
  );
  return r.rows[0] || null;
}

async function classifyPost(postId, content, opts = {}) {
  const existing = await getClassification(postId);
  if (existing && !opts.force) return { cached: true, classification: existing };

  const norm = await classifyText(content, opts);
  const inserted = await db.query(
    `INSERT INTO post_classifications
       (post_id, vertical, intent, budget_min, budget_max, budget_currency,
        geo, urgency, language, confidence, classifier_version, raw_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (post_id) DO UPDATE SET
       vertical           = EXCLUDED.vertical,
       intent             = EXCLUDED.intent,
       budget_min         = EXCLUDED.budget_min,
       budget_max         = EXCLUDED.budget_max,
       budget_currency    = EXCLUDED.budget_currency,
       geo                = EXCLUDED.geo,
       urgency            = EXCLUDED.urgency,
       language           = EXCLUDED.language,
       confidence         = EXCLUDED.confidence,
       classifier_version = EXCLUDED.classifier_version,
       raw_json           = EXCLUDED.raw_json,
       created_at         = NOW()
     RETURNING *`,
    [
      postId,
      norm.vertical, norm.intent,
      norm.budget_min, norm.budget_max, norm.budget_currency,
      norm.geo, norm.urgency, norm.language,
      norm.confidence, CLASSIFIER_VERSION,
      JSON.stringify(norm),
    ]
  );
  return { cached: false, classification: inserted.rows[0] };
}

module.exports = {
  CLASSIFIER_VERSION,
  VERTICALS,
  INTENTS,
  URGENCIES,
  // Pure helpers — exported for unit tests.
  buildSystemPrompt,
  parseClassifierReply,
  normalizeClassification,
  // I/O paths — take an injectable client for tests.
  classifyText,
  classifyPost,
  getClassification,
};
