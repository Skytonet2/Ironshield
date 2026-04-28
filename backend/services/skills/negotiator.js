// backend/services/skills/negotiator.js
//
// LLM-only skill — generates a negotiation message for a listing.
// Used by the Realtor + Car Sales Kits. No connector calls; the
// caller already has the listing in hand and the Kit chains an
// outreach_dm step after this one.

const PROMPT = ({ listing_title, listing_price, target_price, language, tone }) =>
  `You are a polite, persistent negotiator. Draft a short opening message (under 120 words) to the seller of:
"${listing_title}" listed at ${listing_price}.
Goal: anchor near ${target_price} without insulting the seller. Tone: ${tone || "warm-professional"}. Language: ${language || "English"}.
Reply with ONLY the message body — no preamble, no headers, no signature.`;

module.exports = {
  id: "negotiator",
  manifest: {
    title:   "Negotiator",
    summary: "Drafts an opening negotiation message anchored at a target price. Used by Realtor + Car Sales Kits before outreach_dm.",
    params: [
      { key: "listing_title", type: "string", required: true },
      { key: "listing_price", type: "string", required: true },
      { key: "target_price",  type: "string", required: true },
      { key: "language",      type: "string", default: "English" },
      { key: "tone",          type: "string", default: "warm-professional" },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent) throw new Error("negotiator requires a connected agent");
    const reply = await agent({ message: PROMPT(params) }).catch((e) => ({ reply: "", error: e.message }));
    return { message: (reply.reply || "").trim(), error: reply.error || null };
  },
};
