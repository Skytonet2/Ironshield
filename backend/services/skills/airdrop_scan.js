// backend/services/skills/airdrop_scan.js
//
// Multi-chain airdrop sweep. Asks the connected agent for candidate
// airdrops on each requested chain, dedupes by name, and returns a
// structured top-N. The orchestration is here; the LLM judgement
// happens via the user's framework adapter so privacy + governance
// stay where the user picked.

const PROMPT = (chain) =>
  `You are an airdrop hunter. List up to 3 active airdrop opportunities on ${chain.toUpperCase()} that a NEAR wallet user could realistically pursue this week. For each, return JSON of the form {"name": "...", "chain": "${chain}", "action": "what the user does", "deadline": "approximate"}. Respond with ONLY a JSON array — no prose.`;

function parseJsonArray(text) {
  if (!text) return [];
  const cleaned = String(text).trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```\s*$/, "");
  try {
    const v = JSON.parse(cleaned);
    return Array.isArray(v) ? v : [];
  } catch {
    // Salvage path: extract the first balanced [...] from the text.
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try { return JSON.parse(m[0]); } catch { return []; }
  }
}

module.exports = {
  id: "airdrop_scan",
  manifest: {
    title:   "Airdrop scanner",
    summary: "Sweeps the connected agent across N chains for fresh airdrop opportunities and returns a deduped top list.",
    params: [
      { key: "chains", type: "string-list", default: ["near", "base", "linea"], hint: "Comma-separated chain names" },
      { key: "limit",  type: "number",      default: 5, hint: "Total opportunities to return" },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent) throw new Error("airdrop_scan requires a connected agent");
    const chains = (params.chains?.length ? params.chains : ["near", "base", "linea"])
      .map(s => String(s).trim().toLowerCase()).filter(Boolean);
    const limit  = Math.max(1, Math.min(20, Number(params.limit) || 5));

    const all = [];
    for (const chain of chains) {
      // Sequential calls keep us inside per-framework rate limits and
      // make per-chain failures easier to attribute. Parallelism is a
      // future tweak once we measure real adapters.
      // eslint-disable-next-line no-await-in-loop
      const reply = await agent({ message: PROMPT(chain) }).catch(err => ({ reply: "", error: err.message }));
      const items = parseJsonArray(reply.reply).map(it => ({ ...it, chain }));
      all.push(...items);
    }

    // Dedupe by lower-cased name. First occurrence wins.
    const seen = new Set();
    const deduped = [];
    for (const item of all) {
      const k = String(item?.name || "").trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      deduped.push(item);
      if (deduped.length >= limit) break;
    }

    return {
      chains_scanned: chains,
      total_found:    all.length,
      returned:       deduped.length,
      airdrops:       deduped,
    };
  },
};
