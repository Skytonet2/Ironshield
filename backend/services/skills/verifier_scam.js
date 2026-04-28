// backend/services/skills/verifier_scam.js
//
// Vehicle / commerce-focused scam screener. Used by the Car Sales Kit
// in place of verifier_listing, because the red-flag set is different
// (VIN/chassis mismatches, odometer claims, "no inspection allowed",
// shipping-only sellers, escrow-bypass language).
//
// LLM-only, no connector calls.

const PROMPT = (item) =>
  `You are a vehicle / second-hand commerce fraud screener. Score the following item on a 0–10 scam-likelihood scale and list up to 4 concrete red flags. Pay particular attention to:
- price more than 30% below comparable market
- VIN / chassis number missing, partial, or inconsistent
- "no inspection allowed" or "shipping only" language
- demand for full upfront payment / non-escrow payment rails
- stock photos or low-resolution / single-angle photography
- seller account very new with no review history

Reply with strict JSON of shape:
{"score": <0-10>, "verdict": "likely_legit"|"unclear"|"likely_scam", "red_flags": [<short string>, ...], "recommended_questions": [<string>, ...]}.

Item:
${JSON.stringify(item).slice(0, 1500)}

JSON ONLY — no preamble.`;

function parseJson(text) {
  if (!text) return null;
  const cleaned = String(text).trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
  try { return JSON.parse(cleaned); }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

module.exports = {
  id: "verifier_scam",
  manifest: {
    title:   "Commerce scam verifier",
    summary: "Vehicle / second-hand commerce fraud screener — VIN, odometer, escrow-bypass red flags. Returns score + verdict + recommended questions.",
    params: [
      { key: "item", type: "json", required: true, hint: "Object with title, price, location, description, photos[], seller, etc." },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent) throw new Error("verifier_scam requires a connected agent");
    if (!params.item) throw new Error("verifier_scam: { item } required");
    const reply = await agent({ message: PROMPT(params.item) }).catch((e) => ({ reply: "", error: e.message }));
    const parsed = parseJson(reply.reply) || { score: null, verdict: "unclear", red_flags: [], recommended_questions: [] };
    return { ...parsed, raw: reply.reply || "", error: reply.error || null };
  },
};
