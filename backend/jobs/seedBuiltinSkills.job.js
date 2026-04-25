// backend/jobs/seedBuiltinSkills.job.js
//
// One-shot seeder: registers every backend built-in skill on-chain
// at ironshield.near so the marketplace surfaces them. Each registry
// module's manifest becomes a Skill row with:
//
//   name        = manifest.title
//   description = manifest.summary
//   price_yocto = "0"                  (built-ins are free; the
//                                       orchestrator is "author")
//   category    = "builtin:<id>"       (binds to the executor module)
//   tags        = ["builtin"]
//   image_url   = ""
//
// Idempotent: list_skills_with_metadata is queried first, and any
// skill whose metadata.category already matches `builtin:<id>` is
// skipped.
//
// Run from the backend/ directory:
//   node jobs/seedBuiltinSkills.job.js
//
// Requires ORCHESTRATOR_ACCOUNT + ORCHESTRATOR_KEY in env (the
// orchestrator account is the on-chain author of the built-ins).

require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env.local"), override: true });

const { providers } = require("near-api-js");
const { getOrchestratorAccount } = require("../services/nearSigner");
const skills = require("../services/skills");

const STAKING_CONTRACT = process.env.STAKING_CONTRACT || "ironshield.near";
const RPC_URL          = process.env.NEAR_RPC_URL     || "https://rpc.mainnet.near.org";
const GAS              = 100_000_000_000_000n; // 100 Tgas

async function fetchExisting() {
  // Pull a wide page of marketplace listings; the catalogue is small
  // and bounded by the on-chain cap of 100 per call. If we ever exceed
  // that we'll add pagination — until then, one call is enough.
  const provider = new providers.JsonRpcProvider({ url: RPC_URL });
  const args = Buffer.from(JSON.stringify({ limit: 100, offset: 0 })).toString("base64");
  const res = await provider.query({
    request_type: "call_function",
    finality:     "final",
    account_id:   STAKING_CONTRACT,
    method_name:  "list_skills_with_metadata",
    args_base64:  args,
  });
  const text = Buffer.from(res.result).toString();
  const list = JSON.parse(text);
  // Each entry is [Skill, SkillMetadata|null].
  const byCategory = new Map();
  for (const [skill, metadata] of list || []) {
    const cat = metadata?.category;
    if (typeof cat === "string" && cat.startsWith("builtin:")) {
      byCategory.set(cat, { skill, metadata });
    }
  }
  return byCategory;
}

async function createOne({ orchestrator, manifest }) {
  const id = manifest.category.split(":")[1];
  const args = {
    name:        manifest.title.slice(0, 48),
    description: (manifest.summary || `Built-in ${id} skill.`).slice(0, 240),
    price_yocto: "0",
    category:    manifest.category,
    tags:        ["builtin"],
    image_url:   "",
  };
  console.log(`[seed] create_skill(${id}) →`, args.name);
  const out = await orchestrator.functionCall({
    contractId: STAKING_CONTRACT,
    methodName: "create_skill",
    args,
    gas: GAS,
    attachedDeposit: 0n,
  });
  // create_skill returns the new u64 id; near-api-js v6 surfaces it
  // through the txn outcome's status.SuccessValue base64 blob.
  const succ = out?.status?.SuccessValue;
  let onchainId = null;
  try {
    const decoded = succ ? Buffer.from(succ, "base64").toString("utf8") : "";
    onchainId = decoded ? Number(decoded.replace(/^"|"$/g, "")) : null;
  } catch { /* ignore */ }
  return { args, onchainId, txHash: out?.transaction?.hash || null };
}

async function main() {
  const orchestrator = getOrchestratorAccount();
  if (!orchestrator) {
    console.error("ORCHESTRATOR_ACCOUNT / ORCHESTRATOR_KEY not configured. Aborting.");
    process.exit(1);
  }

  const manifests = skills.listManifests();
  if (!manifests.length) {
    console.log("[seed] Registry empty — nothing to do.");
    return;
  }

  console.log(`[seed] Registry has ${manifests.length} built-in skill(s). Checking on-chain state…`);
  let existing;
  try { existing = await fetchExisting(); }
  catch (err) {
    console.error(`[seed] Couldn't read on-chain catalogue: ${err.message}`);
    process.exit(2);
  }
  console.log(`[seed] Found ${existing.size} existing builtin entries on-chain.`);

  const results = { created: [], skipped: [], failed: [] };
  for (const manifest of manifests) {
    if (existing.has(manifest.category)) {
      const { skill } = existing.get(manifest.category);
      results.skipped.push({ id: manifest.id, onchainId: skill.id, name: skill.name });
      console.log(`[seed] skip ${manifest.id} — already on-chain as skill_id=${skill.id} ("${skill.name}")`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await createOne({ orchestrator, manifest });
      results.created.push({ id: manifest.id, onchainId: r.onchainId, tx: r.txHash });
    } catch (err) {
      results.failed.push({ id: manifest.id, error: err.message });
      console.error(`[seed] create_skill(${manifest.id}) failed: ${err.message}`);
    }
  }

  console.log("\n[seed] Summary:");
  console.log(`  created: ${results.created.length}`);
  console.log(`  skipped: ${results.skipped.length}`);
  console.log(`  failed:  ${results.failed.length}`);
  if (results.created.length) console.log("  IDs:", results.created.map(r => `${r.id}=${r.onchainId}`).join(", "));
  process.exit(results.failed.length ? 3 : 0);
}

if (require.main === module) {
  main().catch((err) => { console.error("[seed] fatal:", err); process.exit(99); });
}

module.exports = { main, fetchExisting, createOne };
