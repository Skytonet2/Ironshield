// backend/services/skills/pitch_gen.js
//
// LLM-only skill — drafts a personalised cold pitch for a freelancer
// outreach. Used by the Freelancer Hunter Kit before outreach_dm.

const PROMPT = ({ service_offered, prospect_blurb, pricing_hint, language, tone }) =>
  `You are a freelancer writing a short cold-outreach pitch (under 100 words). Service you offer: "${service_offered}". Prospect's recent activity / blurb: "${(prospect_blurb || "").slice(0, 600)}". Pricing hint: "${pricing_hint || "open to discussion"}". Tone: ${tone || "warm-professional"}. Language: ${language || "English"}.

Reply with ONLY the message body — no preamble, no headers, no signature.`;

module.exports = {
  id: "pitch_gen",
  manifest: {
    title:   "Cold pitch generator",
    summary: "Drafts a personalised cold-outreach pitch for a freelancer prospect. LLM-only; no connector calls.",
    params: [
      { key: "service_offered",  type: "string", required: true },
      { key: "prospect_blurb",   type: "string", hint: "Short blurb about the prospect (a tweet, bio, recent post). Used for personalisation." },
      { key: "pricing_hint",     type: "string", default: "open to discussion" },
      { key: "language",         type: "string", default: "English" },
      { key: "tone",             type: "string", default: "warm-professional" },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent) throw new Error("pitch_gen requires a connected agent");
    if (!params.service_offered) throw new Error("pitch_gen: { service_offered } required");
    const reply = await agent({ message: PROMPT(params) }).catch((e) => ({ reply: "", error: e.message }));
    return { message: (reply.reply || "").trim(), error: reply.error || null };
  },
};
