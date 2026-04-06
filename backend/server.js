require("dotenv").config();
const express = require("express");
const app = express();
const db = require("./db/client");

app.use(express.json());
app.use(require("cors")());

// Routes — AI-powered
app.use("/api/summary",   require("./routes/summary.route"));
app.use("/api/research",  require("./routes/research.route"));
app.use("/api/verify",    require("./routes/verify.route"));
app.use("/api/portfolio", require("./routes/portfolio.route"));
app.use("/api/security",  require("./routes/security.route"));
app.use("/api/chat",      require("./routes/chat.route"));

// Routes — Data (contests, leaderboard, governance)
app.use("/api/contests",    require("./routes/contests.route"));
app.use("/api/leaderboard", require("./routes/leaderboard.route"));
app.use("/api/governance",  require("./routes/governance.route"));

// Health check
app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", service: "IronClaw API", db: "connected", ts: new Date() });
  } catch {
    res.json({ status: "ok", service: "IronClaw API", db: "disconnected", ts: new Date() });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error("IronClaw API error:", err);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

const PORT = process.env.BACKEND_PORT || 3001;

async function start() {
  // Run DB migration on startup
  try {
    await db.migrate();
  } catch (err) {
    console.warn("[Server] DB migration failed — running without database:", err.message);
  }
  app.listen(PORT, () => console.log(`IronClaw backend running on port ${PORT}`));
}

start();

module.exports = app;
