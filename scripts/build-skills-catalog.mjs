// Parses docs/skills-catalog*.md into structured JSON for rendering
// under /docs/skills-catalog and /docs/skills-catalog-v2.
//
// Usage:
//   node scripts/build-skills-catalog.mjs            # build all volumes
//   node scripts/build-skills-catalog.mjs v1         # build only v1
//   node scripts/build-skills-catalog.mjs v2         # build only v2
//
// Re-commit the regenerated src/data/skillsCatalog{,V2}.json
// alongside any markdown change.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const VOLUMES = {
  v1: {
    src: resolve(ROOT, "docs/skills-catalog.md"),
    out: resolve(ROOT, "src/data/skillsCatalog.json"),
  },
  v2: {
    src: resolve(ROOT, "docs/skills-catalog-v2.md"),
    out: resolve(ROOT, "src/data/skillsCatalogV2.json"),
  },
};

const arg = process.argv[2];
const volumesToBuild = arg ? [arg] : Object.keys(VOLUMES);

for (const volume of volumesToBuild) {
  const cfg = VOLUMES[volume];
  if (!cfg) {
    console.error(`unknown volume: ${volume}`);
    process.exit(1);
  }
  buildVolume(cfg.src, cfg.out, volume);
}

function buildVolume(SRC, OUT, label) {
const md = readFileSync(SRC, "utf8");

// --- pull preamble (before the first category heading) -----------------
const firstCatIdx = md.search(/^## 1\. /m);
const preamble = md.slice(0, firstCatIdx);
const titleMatch = preamble.match(/^# (.+)$/m);
const blurbMatch = preamble.match(/^>([\s\S]+?)(?=\n\n|\n\*\*Status legend)/m);
const meta = {
  title: titleMatch ? titleMatch[1].trim() : "IronShield Skills Catalog",
  blurb: blurbMatch
    ? blurbMatch[1].split("\n").map(l => l.replace(/^>\s?/, "").trim()).filter(Boolean).join(" ")
    : "",
};

// --- split into category sections --------------------------------------
const catRe = /^## (\d+)\.\s+(.+?)\s*\((\d+)\s+skills?\)\s*$/gm;
const cats  = [];
let m;
const catIdxs = [];
while ((m = catRe.exec(md)) !== null) {
  catIdxs.push({ idx: m.index, num: +m[1], name: m[2].trim(), claimed: +m[3] });
}
// terminate at the appendix or EOF
const appendixIdx = md.search(/^## Appendix/m);
const endIdx = appendixIdx >= 0 ? appendixIdx : md.length;

for (let i = 0; i < catIdxs.length; i++) {
  const start = catIdxs[i].idx;
  const stop  = i + 1 < catIdxs.length ? catIdxs[i + 1].idx : endIdx;
  cats.push({ ...catIdxs[i], body: md.slice(start, stop) });
}

// --- parse a single skill entry ----------------------------------------
function parseEntry(block) {
  const slugMatch = block.match(/^### `([^`]+)`/);
  if (!slugMatch) return null;
  const slug = slugMatch[1];

  const fields = {};
  const fieldRe = /^\*\*([^*]+?)\.\*\*\s+([\s\S]*?)(?=\n\*\*[^*]+?\.\*\*\s|\n##|\n###|$)/gm;
  let fm;
  while ((fm = fieldRe.exec(block)) !== null) {
    const key  = fm[1].trim().toLowerCase();
    const val  = fm[2].trim();
    fields[key] = val;
  }

  // Status — split into status emoji + reason. Emoji are matched
  // explicitly because bracket classes with surrogate pairs misbehave.
  let statusKind = null, statusReason = "";
  if (fields.status) {
    const s = fields.status;
    if      (s.startsWith("🟢")) statusKind = "green";
    else if (s.startsWith("🟡")) statusKind = "yellow";
    else if (s.startsWith("🔴")) statusKind = "red";
    statusReason = s.replace(/^[🟢🟡🔴]\s*(?:—\s*)?/u, "").trim();
  }

  // Categories / tags — split on commas, strip backticks/brackets
  const splitList = (s) =>
    (s || "")
      .replace(/[`\[\]]/g, "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);

  return {
    slug,
    pitch:      fields.pitch      || "",
    inputs:     fields.inputs     || "",
    outputs:    fields.outputs    || "",
    pricing:    fields.pricing    || "",
    categories: splitList(fields.categories),
    tags:       splitList(fields.tags),
    status:     { kind: statusKind, reason: statusReason },
  };
}

// --- parse all entries within each category ----------------------------
const out = { meta, categories: [] };
let totalEntries = 0;

for (const cat of cats) {
  // Find all `### `slug`` heading positions, then slice between them.
  const headRe = /^### `[^`]+`/gm;
  const heads = [];
  let hm;
  while ((hm = headRe.exec(cat.body)) !== null) {
    heads.push(hm.index);
  }
  const entries = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i];
    const end   = i + 1 < heads.length ? heads[i + 1] : cat.body.length;
    const e     = parseEntry(cat.body.slice(start, end));
    if (e) entries.push(e);
  }
  if (entries.length !== cat.claimed) {
    console.warn(`[warn] category "${cat.name}" claimed ${cat.claimed} but parsed ${entries.length}`);
  }
  totalEntries += entries.length;
  out.categories.push({
    num:   cat.num,
    name:  cat.name,
    count: entries.length,
    skills: entries,
  });
}

out.meta.total = totalEntries;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log(`[${label}] wrote ${OUT}`);
console.log(`  ${out.categories.length} categories, ${totalEntries} skills`);
}
