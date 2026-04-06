// agent/tasks/summaryTask.js
exports.buildPrompt = ({ source, identifier, range }) =>
  `Summarize recent activity from ${source} "${identifier}" over the last ${range || "24h"}.
Focus on key discussions, notable mentions, and any security concerns.

Return JSON only:
{
  "title": "Summary of [source]",
  "keyPoints": ["point 1", "point 2"],
  "tokensMentioned": ["$TOKEN1"],
  "redFlags": ["any suspicious activity"],
  "actionableInsights": ["insight 1"]
}`;
