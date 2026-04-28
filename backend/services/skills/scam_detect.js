// backend/services/skills/scam_detect.js
//
// Subject-focused scam detector — used by the Background Checker Kit.
// Distinct from verifier_listing (which scores a single classifieds
// row): this one takes evidence across several sources about a SUBJECT
// (handle, name, phone, etc.) and flags fraud-likely patterns:
//   - account age vs. claimed history
//   - inconsistent profile claims across sources
//   - history of complaint posts mentioning the subject
//   - language patterns common in romance / advance-fee fraud
//
// LLM-only; the calling Kit gathers the evidence via scout_x +
// scout_fb beforehand and passes it in.

const PROMPT = ({ subject, evidence }) =>
  `You are a fraud / due-diligence analyst. Score the following SUBJECT on a 0-10 scam-likelihood scale based on the supplied evidence. Be specific about which evidence supports each red flag.

Subject: "${subject}"

Evidence (gathered from public sources):
${JSON.stringify(evidence, null, 2).slice(0, 4000)}

Reply with strict JSON of shape:
{
  "score": <0-10>,
  "verdict": "likely_legit" | "unclear" | "likely_scam",
  "red_flags": [{"flag": "...", "evidence_ref": "..."}],
  "supporting_signals": [{"signal": "...", "evidence_ref": "..."}],
  "confidence": "low" | "medium" | "high"
}

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
  id: "scam_detect",
  manifest: {
    title:   "Subject scam detector",
    summary: "Cross-source fraud screener for a SUBJECT (handle, name, phone). LLM scores evidence into a structured verdict.",
    params: [
      { key: "subject",  type: "string", required: true, hint: "The handle / name / phone being checked" },
      { key: "evidence", type: "json",   required: true, hint: "Object aggregating outputs from scout_x / scout_fb / etc." },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent) throw new Error("scam_detect requires a connected agent");
    if (!params.subject || !params.evidence) {
      throw new Error("scam_detect: { subject, evidence } required");
    }
    const reply = await agent({ message: PROMPT(params) }).catch((e) => ({ reply: "", error: e.message }));
    const parsed = parseJson(reply.reply) || {
      score: null, verdict: "unclear", red_flags: [], supporting_signals: [], confidence: "low",
    };
    return { ...parsed, raw: reply.reply || "", error: reply.error || null };
  },
};
