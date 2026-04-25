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

const REGISTRY = {};
function register(mod) {
  if (!mod?.id) throw new Error("skill module must export `id`");
  REGISTRY[mod.id] = mod;
}
register(airdropScan);
register(dailyBriefing);
register(summariseUrl);

/** Returns the registry-bound key extracted from on-chain
 *  SkillMetadata.category, or null if the skill isn't builtin. */
function keyFromCategory(category) {
  if (!category || typeof category !== "string") return null;
  const m = category.match(/^builtin:([a-z0-9_]+)$/);
  return m ? m[1] : null;
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

async function run({ id, ctx }) {
  const mod = get(id);
  if (!mod) throw new Error(`Unknown built-in skill: ${id}`);
  return mod.execute(ctx || {});
}

module.exports = { REGISTRY, listManifests, get, run, keyFromCategory };
