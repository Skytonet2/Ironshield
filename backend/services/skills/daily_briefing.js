// backend/services/skills/daily_briefing.js
//
// 3-bullet daily briefing on the topics the user cares about. Single
// LLM round-trip; the heavy lifting is in keeping the prompt tight
// so different frameworks all return parseable output.

const PROMPT = (topics) => `You are a market briefing analyst. Produce exactly 3 short bullets covering what's worth knowing today across these topics: ${topics.join(", ")}. Each bullet must be ≤25 words and start with a single emoji. Respond with ONLY the three bullets, one per line, no preamble.`;

module.exports = {
  id: "daily_briefing",
  manifest: {
    title:   "Daily briefing",
    summary: "3-bullet morning briefing across the topics you care about, delivered every time the schedule fires.",
    params: [
      { key: "topics", type: "string-list", default: ["NEAR ecosystem", "AI agents", "DeFi"],
        hint: "Comma-separated topics to brief on" },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent) throw new Error("daily_briefing requires a connected agent");
    const topics = (params.topics?.length ? params.topics : ["NEAR ecosystem", "AI agents", "DeFi"])
      .map(s => String(s).trim()).filter(Boolean).slice(0, 8);
    const reply = await agent({ message: PROMPT(topics) });
    const bullets = String(reply.reply || "").split(/\n+/).map(l => l.trim()).filter(Boolean).slice(0, 3);
    return {
      topics,
      bullets,
      raw: reply.reply || "",
    };
  },
};
