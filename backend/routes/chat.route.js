// backend/routes/chat.route.js
const express       = require("express");
const router        = express.Router();
const agent         = require("../services/agentConnector");
const tokenLookup   = require("../services/tokenLookup");
const socialMonitor = require("../services/socialMonitor");
const requireWallet = require("../middleware/requireWallet");
const { rateLimit } = require("../services/rateLimiter");

/**
 * Detect if the user message is asking about a specific token/crypto.
 * Returns the token query string or null.
 */
function extractTokenQuery(message) {
  const lower = message.toLowerCase();

  // Direct token patterns: "$NEAR", "$BTC", etc.
  const tickerMatch = message.match(/\$([A-Za-z]{2,10})/);
  if (tickerMatch) return tickerMatch[1];

  // NEAR contract patterns: something.near, something.tkn.near
  const nearMatch = message.match(/([a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.near)/i);
  if (nearMatch) return nearMatch[1];

  // EVM contract address
  const evmMatch = message.match(/(0x[a-fA-F0-9]{40})/);
  if (evmMatch) return evmMatch[1];

  // Price/market questions about known terms
  const pricePatterns = [
    /(?:price|value|worth|cost|market cap|mcap|volume)\s+(?:of\s+)?([a-zA-Z]{2,20})/i,
    /(?:how much is|what(?:'s| is))\s+([a-zA-Z]{2,20})(?:\s+(?:worth|trading|priced|at|now|today))?/i,
    /([a-zA-Z]{2,20})\s+(?:price|value|market cap|mcap|volume)/i,
  ];

  for (const p of pricePatterns) {
    const m = lower.match(p);
    if (m) {
      const term = m[1].trim();
      // Filter out common non-crypto words
      const stopWords = ["the", "a", "an", "is", "are", "was", "were", "what", "how", "why", "this", "that", "your", "my", "its"];
      if (!stopWords.includes(term) && term.length >= 2) return term;
    }
  }

  return null;
}

router.post("/", requireWallet, rateLimit("ai"), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "No message provided" });

    // Check if the user is asking about a specific token — fetch real data first
    const tokenQuery = extractTokenQuery(message);
    let realDataContext = "";

    if (tokenQuery) {
      try {
        const data = await tokenLookup.lookup(tokenQuery);
        if (data && Object.keys(data.data || {}).length > 0) {
          realDataContext = `\n\n--- LIVE MARKET DATA (fetched just now from APIs) ---\nQuery: ${tokenQuery}\n${JSON.stringify(data.data, null, 2)}\n--- END LIVE DATA ---\nUse this real-time data to answer the user's question accurately. Cite specific numbers from this data.`;
        }
      } catch (err) {
        console.warn("[Chat] Token lookup failed:", err.message);
      }
    }

    // For trend/market questions, also inject live social intelligence
    const trendWords = ["trending", "trend", "hot", "popular", "hype", "market", "what's moving", "whats moving", "movers", "gainers"];
    let socialContext = "";
    if (trendWords.some(w => message.toLowerCase().includes(w))) {
      try {
        socialContext = "\n\n" + await socialMonitor.getSocialContext();
      } catch { /* non-critical */ }
    }

    const enrichedMessage = `${message}${realDataContext}${socialContext}`;

    const response = await agent.chat({ message: enrichedMessage, userId });
    res.json({ success: true, data: { reply: response } });
  } catch (err) {
    console.error("[Chat] Error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
