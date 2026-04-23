// Load .env first, then .env.local on top (matches Next.js precedence so
// a single value set only in .env.local flows to both frontend + backend).
require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local"), override: true });
const http = require("http");
const express = require("express");
const app = express();
const db = require("./db/client");
const feedHub = require("./ws/feedHub");

app.use(express.json());
app.use(require("cors")());

// Routes — AI-powered
app.use("/api/summary",   require("./routes/summary.route"));
app.use("/api/research",  require("./routes/research.route"));
app.use("/api/verify",    require("./routes/verify.route"));
app.use("/api/portfolio", require("./routes/portfolio.route"));
app.use("/api/security",  require("./routes/security.route"));
app.use("/api/chat",      require("./routes/chat.route"));
app.use("/api/trending",  require("./routes/trending.route"));
app.use("/api/alpha",    require("./routes/alpha.route"));

// Routes — Data (contests, leaderboard, governance)
app.use("/api/contests",    require("./routes/contests.route"));
app.use("/api/leaderboard", require("./routes/leaderboard.route"));
app.use("/api/governance",  require("./routes/governance.route"));

// Routes — IronFeed (Twitter-style social feed)
app.use("/api/feed",          require("./routes/feed.route"));
app.use("/api/posts",         require("./routes/posts.route"));
app.use("/api/social",        require("./routes/social.route"));
app.use("/api/profile",       require("./routes/profile.route"));
app.use("/api/users",         require("./routes/users.route"));
app.use("/api/dm",            require("./routes/dm.route"));
app.use("/api/feed-org",      require("./routes/feedOrg.route"));
app.use("/api/feed-agent",    require("./routes/feedAgent.route"));
app.use("/api/ads",           require("./routes/ads.route"));
app.use("/api/notifications", require("./routes/notifications.route"));
app.use("/api/media",         require("./routes/media.route"));
app.use("/api/feed-news",     require("./routes/feedNews.route"));
app.use("/api/tips",          require("./routes/tips.route"));
app.use("/api/rooms",         require("./routes/rooms.route"));
app.use("/api/livekit",       require("./routes/livekit.route"));
app.use("/api/revenue",       require("./routes/revenue.route"));
app.use("/api/push",          require("./routes/push.route"));
app.use("/api/newscoin",      require("./routes/newscoin.route"));
app.use("/api/tg",            require("./routes/tg.route"));
app.use("/api/xfeed",         require("./routes/xfeed.route"));
app.use("/api/trading",       require("./routes/trading.route"));
app.use("/api/bridge",        require("./routes/bridge.route"));
app.use("/api/ai",            require("./routes/ai.route"));
app.use("/api/market",        require("./routes/market.route"));

// Root
app.get("/", (req, res) => {
  res.json({ service: "IronClaw API", version: "1.0.0", docs: "/health" });
});

// Health check
app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", service: "IronClaw API", db: "connected", ts: new Date() });
  } catch {
    res.json({ status: "ok", service: "IronClaw API", db: "disconnected", ts: new Date() });
  }
});

// Error handler — surface DB-offline state clearly instead of a generic 500
app.use((err, req, res, next) => {
  console.error("IronClaw API error:", err);
  const msg = String(err?.message || "");
  const code = err?.code || "";
  const dbDown = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH/i.test(msg)
    || /relation .* does not exist/i.test(msg)
    || code === "ECONNREFUSED" || code === "57P03";
  if (dbDown) {
    return res.status(503).json({
      success: false,
      error: "Backend database is not configured. Ask the admin to set DATABASE_URL on Render.",
      dbOffline: true,
    });
  }
  res.status(500).json({ success: false, error: msg || "Internal server error" });
});

const PORT = process.env.BACKEND_PORT || 3001;

async function start() {
  // Run DB migration on startup
  try {
    await db.migrate();
  } catch (err) {
    console.warn("[Server] DB migration failed — running without database:", err.message);
  }
  // Wrap the Express app in an explicit HTTP server so the WS hub can
  // share the same port. Render's single-port allocation needs this —
  // app.listen() would claim the socket exclusively.
  const server = http.createServer(app);
  feedHub.attach(server);
  server.listen(PORT, () => console.log(`IronClaw backend running on port ${PORT} (HTTP + WS /ws/feed)`));
  try { require("./services/batchWorker").start(); } catch (e) { console.warn("[batch] not started:", e.message); }
  try { require("./jobs/newsBot.job").start(); } catch (e) { console.warn("[newsbot] not started:", e.message); }
  try { require("./services/trendingAgent").start(); } catch (e) { console.warn("[trendingAgent] not started:", e.message); }
}

start();

module.exports = app;
