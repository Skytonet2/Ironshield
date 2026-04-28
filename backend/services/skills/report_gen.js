// backend/services/skills/report_gen.js
//
// Final-report synthesizer — used by the Background Checker Kit at
// the end of the chain. Takes everything the Kit gathered (scout
// outputs, verifier scores, scam_detect verdict) and produces a
// human-readable report suitable for delivery to the mission poster.
//
// Format is markdown by default; "json" format returns a machine-
// readable variant.

const PROMPT_MD = ({ subject, depth, bundle }) =>
  `You are a due-diligence reporter. Write a clear ${depth || "standard"}-depth markdown background check report on the subject below. Cite specific evidence by source. End with an explicit "verdict" line and a "confidence" line.

Subject: ${subject}

Bundle (all evidence gathered):
${JSON.stringify(bundle, null, 2).slice(0, 5000)}

Reply with ONLY the markdown report.`;

const PROMPT_JSON = ({ subject, bundle }) =>
  `Summarise the following due-diligence bundle into structured JSON:
{"subject": "${subject}", "verdict": "...", "confidence": "low|medium|high", "summary": "...", "key_findings": [...], "sources": [...]}.

Bundle:
${JSON.stringify(bundle, null, 2).slice(0, 5000)}

JSON ONLY.`;

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
  id: "report_gen",
  manifest: {
    title:   "Background-check report generator",
    summary: "Synthesises scout / verifier / scam_detect outputs into a single deliverable report (markdown by default; format='json' returns structured).",
    params: [
      { key: "subject", type: "string", required: true },
      { key: "bundle",  type: "json",   required: true, hint: "Object containing all upstream skill outputs" },
      { key: "format",  type: "string", default: "markdown", enum: ["markdown", "json"] },
      { key: "depth",   type: "string", default: "standard", enum: ["quick", "standard", "deep"] },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent) throw new Error("report_gen requires a connected agent");
    if (!params.subject || !params.bundle) {
      throw new Error("report_gen: { subject, bundle } required");
    }
    const format = params.format === "json" ? "json" : "markdown";
    const prompt = format === "json" ? PROMPT_JSON(params) : PROMPT_MD(params);
    const reply = await agent({ message: prompt }).catch((e) => ({ reply: "", error: e.message }));
    if (format === "json") {
      const parsed = parseJson(reply.reply) || { subject: params.subject, verdict: "unclear", confidence: "low" };
      return { format, ...parsed, raw: reply.reply || "", error: reply.error || null };
    }
    return { format, markdown: reply.reply || "", error: reply.error || null };
  },
};
