require("dotenv").config();
const express = require("express");
const app = express();

app.use(express.json());
app.use(require("cors")());

// Routes
app.use("/api/summary",   require("./routes/summary.route"));
app.use("/api/research",  require("./routes/research.route"));
app.use("/api/verify",    require("./routes/verify.route"));
app.use("/api/portfolio", require("./routes/portfolio.route"));
app.use("/api/security",  require("./routes/security.route"));

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", service: "IronClaw API", ts: new Date() }));

// Error handler
app.use((err, req, res, next) => {
  console.error("IronClaw API error:", err);
  res.status(500).json({ success: false, error: err.message || "Internal server error" });
});

const PORT = process.env.BACKEND_PORT || 3001;
app.listen(PORT, () => console.log(`IronClaw backend running on port ${PORT}`));

module.exports = app;
