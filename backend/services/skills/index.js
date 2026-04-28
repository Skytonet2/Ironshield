// backend/services/skills/index.js
//
// Skill execution registry. The on-chain Skill row holds metadata
// (name, description, price, install_count); execution code lives
// here and is bound to a row by a convention in SkillMetadata:
//
//   category = "builtin:<key>"
//
// e.g. a skill listing with `category: "builtin:airdrop_scan"` runs
// the airdrop_scan module below when its `call_skill` automation
// action fires. Skills without a `builtin:` prefix are still
// installable on the marketplace but won't execute server-side —
// they're either author-supplied workflows (requires the future
// sandboxed runner) or pure-metadata listings.
//
// Each skill module exports:
//   { id, manifest, execute(ctx) }
// where ctx = { owner, agent_account, params, agent }
// and `agent` is a closure that calls the user's connected framework
// (the same path the sandbox chat takes).

const airdropScan   = require("./airdrop_scan");
const dailyBriefing = require("./daily_briefing");
const summariseUrl  = require("./summarise_url");
const httpRunner    = require("./http_runner");

// Phase 10 Tier 4 — Realtor / Car Sales bundle.
const scoutFb         = require("./scout_fb");
const scoutJiji       = require("./scout_jiji");
const outreachDm      = require("./outreach_dm");
const negotiator      = require("./negotiator");
const verifierListing = require("./verifier_listing");
const verifierScam    = require("./verifier_scam");
// Phase 10 Tier 4 — Freelancer Hunter bundle.
const scoutX          = require("./scout_x");
const scoutTg         = require("./scout_tg");
const pitchGen        = require("./pitch_gen");

const REGISTRY = {};
function register(mod) {
  if (!mod?.id) throw new Error("skill module must export `id`");
  REGISTRY[mod.id] = mod;
}
register(airdropScan);
register(dailyBriefing);
register(summariseUrl);
// Tier 4 — first wave (Realtor Kit dependencies).
register(scoutFb);
register(scoutJiji);
register(outreachDm);
register(negotiator);
register(verifierListing);
register(verifierScam);
register(scoutX);
register(scoutTg);
register(pitchGen);

/** Resolve a SkillMetadata.category to an executable shape:
 *    "builtin:<id>" → { kind: "builtin", key }     (registered above)
 *    "http:<url>"   → { kind: "http", url }         (HTTP runner)
 *    anything else  → null                           (metadata-only)
 */
function classifyCategory(category) {
  if (!category || typeof category !== "string") return null;
  const b = category.match(/^builtin:([a-z0-9_]+)$/);
  if (b) return { kind: "builtin", key: b[1] };
  if (category.startsWith("http:")) {
    const url = category.slice(5);
    if (/^https?:\/\//i.test(url)) return { kind: "http", url };
  }
  return null;
}

/** Legacy alias retained for callers that only care about built-ins. */
function keyFromCategory(category) {
  const c = classifyCategory(category);
  return c?.kind === "builtin" ? c.key : null;
}

function listManifests() {
  return Object.values(REGISTRY).map(m => ({
    id:        m.id,
    title:     m.manifest?.title    || m.id,
    summary:   m.manifest?.summary  || "",
    params:    m.manifest?.params   || [],
    category:  `builtin:${m.id}`,
  }));
}

function get(id) { return REGISTRY[id] || null; }

/** Run by built-in id (legacy callers + the automation executor). */
async function run({ id, ctx }) {
  const mod = get(id);
  if (!mod) throw new Error(`Unknown built-in skill: ${id}`);
  return mod.execute(ctx || {});
}

/** Run by category — accepts both "builtin:<id>" and "http:<url>".
 *  This is what the automation executor calls when a skill is
 *  resolved from on-chain metadata; centralising the dispatch here
 *  means the route layer doesn't need to know about HTTP skills.
 *
 *  Safety gate: HTTP skills are author-hosted code at an arbitrary
 *  URL we don't control. The orchestrator sends user params there
 *  AND mints a callback token the endpoint can use to talk to the
 *  user's agent — so a malicious skill could exfiltrate prompts +
 *  replies. We block HTTP execution unless `verified === true`,
 *  forcing admin review before any new endpoint runs. Built-in
 *  skills bypass the gate (we wrote them).
 */
async function runByCategory({ category, ctx, verified = false }) {
  const c = classifyCategory(category);
  if (!c) throw new Error(`Unrunnable skill category: ${category}`);
  if (c.kind === "builtin") return run({ id: c.key, ctx });
  if (c.kind === "http") {
    if (!verified) {
      const err = new Error("HTTP skill awaiting admin verification");
      err.code = "SKILL_UNVERIFIED";
      throw err;
    }
    return httpRunner.execute({ ...ctx, http_url: c.url });
  }
  throw new Error(`Unsupported runtime: ${c.kind}`);
}

module.exports = {
  REGISTRY, listManifests, get, run, runByCategory,
  classifyCategory, keyFromCategory,
};
