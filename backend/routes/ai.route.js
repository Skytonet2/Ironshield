// backend/routes/ai.route.js
//
// AI-assist endpoints that the frontend composer + automations use.
// Thin wrappers over agentConnector — real LLM calls happen there,
// with graceful degradation when NEAR_AI_KEY isn't set.

const express = require("express");
const router = express.Router();
const agent = require("../services/agentConnector");
const requireWallet = require("../middleware/requireWallet");
const { rateLimit } = require("../services/rateLimiter");

// POST /api/ai/compose  body: { prompt, maxChars? }
//
// Returns { text } — a ready-to-post draft based on the user's
// prompt. Used by the mobile full-screen composer's AI Post
// Generator card. When no AI path is configured (no NEAR_AI_KEY
// and IronClaw-agent mode off), returns 503 so the UI can surface
// a "coming soon" message rather than a 500.
router.post("/compose", requireWallet, rateLimit("ai"), async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const maxChars = parseInt(req.body?.maxChars) || 500;

    // Short-circuit if no AI backend is wired — otherwise composePost
    // fires a fetch with an empty Bearer token, upstream 401s, and
    // the error handler turns that into a 500. Frontend can't tell
    // "not configured" from "transient failure" in that case.
    const keyConfigured      = Boolean(process.env.NEAR_AI_KEY);
    const ironclawConfigured = process.env.IRONCLAW_AGENT_MODE === "true"
      && Boolean(process.env.IRONCLAW_GATEWAY_TOKEN);
    if (!keyConfigured && !ironclawConfigured) {
      return res.status(503).json({
        error: "ai_not_configured",
        hint:  "Set NEAR_AI_KEY (or IRONCLAW_AGENT_MODE=true + IRONCLAW_GATEWAY_TOKEN) on the backend to enable the AI composer.",
      });
    }

    const result = await agent.composePost({ prompt, maxChars });
    if (!result?.text) {
      return res.status(502).json({ error: "ai_empty_reply" });
    }
    res.json({ text: result.text });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
