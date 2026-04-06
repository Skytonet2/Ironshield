// agent/tasks/portfolioTask.js
exports.buildPrompt = ({ wallets }) =>
  `Analyze these crypto wallets and return portfolio data: ${JSON.stringify(wallets)}
If the list is empty, return a zero portfolio.

Return JSON only:
{
  "totalNetWorthUSD": 0,
  "change24hUSD": 0,
  "change24hPct": "0%",
  "wallets": [
    {
      "address": "0x...",
      "chain": "eth",
      "balanceUSD": 0,
      "tokens": [
        { "symbol": "ETH", "amount": 0, "valueUSD": 0 }
      ],
      "riskFlags": []
    }
  ],
  "defiPositions": []
}`;
