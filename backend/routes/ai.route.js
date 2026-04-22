// backend/routes/ai.route.js
//
// AI-assist endpoints that the frontend composer + automations use.
// Thin wrappers over agentConnector — real LLM calls happen there,
// with graceful degradation when NEAR_AI_KEY isn't set.

const express = require("express");
const router = express.Router();
const agent = require("../services/agentConnector");

// POST /api/ai/compose  body: { prompt, maxChars? }
//
// Returns { text } — a ready-to-post draft based on the user's
// prompt. Used by the mobile full-screen composer's AI Post
// Generator card. When NEAR_AI_KEY is missing, returns 503 so the
// UI can surface a "coming soon" message rather than crash.
router.post("/compose", async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const maxChars = parseInt(req.body?.maxChars) || 500;
    const result = await agent.composePost({ prompt, maxChars });
    if (!result?.text) {
      return res.status(503).json({
        error: "ai_not_configured",
        hint: "Set NEAR_AI_KEY on the backend to enable the AI composer.",
      });
    }
    res.json({ text: result.text });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
