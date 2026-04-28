// backend/services/skills/verifier_listing.js
//
// Listing verifier — used by the Realtor + Background Checker Kits.
// Sanity-checks a classifieds listing for the standard "too good to
// be true" signals: price more than X% below market, missing/blurred
// photos hinted at in the title, demand for upfront payment, etc.

const PROMPT = (listing) =>
  `You are a real-estate / classifieds fraud screener. Score the following listing on a 0–10 scam-likelihood scale and list up to 3 concrete red flags. Reply with strict JSON of shape:
{"score": <0-10>, "verdict": "likely_legit"|"unclear"|"likely_scam", "red_flags": [<short string>, ...]}.

Listing:
${JSON.stringify(listing).slice(0, 1500)}

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
  id: "verifier_listing",
  manifest: {
    title:   "Listing verifier",
    summary: "Scores a classifieds listing on scam-likelihood (0–10) and lists red flags. LLM-only; no connector calls.",
    params: [
      { key: "listing", type: "json", required: true, hint: "Object with title, price, location, description, etc." },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent) throw new Error("verifier_listing requires a connected agent");
    if (!params.listing) throw new Error("verifier_listing: { listing } required");
    const reply = await agent({ message: PROMPT(params.listing) }).catch((e) => ({ reply: "", error: e.message }));
    const parsed = parseJson(reply.reply) || { score: null, verdict: "unclear", red_flags: [] };
    return { ...parsed, raw: reply.reply || "", error: reply.error || null };
  },
};
