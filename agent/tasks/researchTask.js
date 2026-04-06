// agent/tasks/researchTask.js
exports.buildPrompt = ({ query, queryType, chain }) =>
  `Research this crypto token/project: "${query}" (type: ${queryType}, chain: ${chain}).
Use your knowledge of on-chain data, market data, and security signals.

Return JSON only:
{
  "overview": "Brief description",
  "metrics": {
    "price": "$0.00",
    "marketCap": "$0",
    "volume24h": "$0",
    "holders": 0,
    "liquidityLocked": true,
    "auditStatus": "Unaudited"
  },
  "risks": ["risk 1", "risk 2"],
  "redFlags": ["flag 1"],
  "trustScore": 0,
  "sources": ["CoinGecko", "Etherscan"]
}`;
