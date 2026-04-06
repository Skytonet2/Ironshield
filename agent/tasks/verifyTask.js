// agent/tasks/verifyTask.js
exports.buildPrompt = ({ claim, context, relatedContract }) =>
  `Fact-check this claim: "${claim}"
Context: ${context || "Telegram message"}
${relatedContract ? `Related contract: ${relatedContract}` : ""}

Return JSON only:
{
  "verdict": "VERIFIED",
  "breakdown": [
    { "claim": "specific claim", "result": "VERIFIED", "source": "source name", "detail": "explanation" }
  ],
  "overallConfidence": 0.9
}
verdict must be one of: VERIFIED, FALSE, PARTIALLY_FALSE, UNVERIFIED`;
