// backend/routes/chat.route.js
const express = require("express");
const router  = express.Router();
const agent   = require("../services/agentConnector");

router.post("/", async (req, res) => {
  try {
    const { message, userId } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "No message provided" });

    const response = await agent.chat({ message, userId });
    res.json({ success: true, data: { reply: response } });
  } catch (err) {
    console.error("[Chat] Error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
