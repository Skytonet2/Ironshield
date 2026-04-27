// Load .env first, then .env.local on top (matches Next.js precedence so
// a single value set only in .env.local flows to both frontend + backend).
require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local"), override: true });
const http = require("http");
const express = require("express");
const app = express();
const db = require("./db/client");
const feedHub = require("./ws/feedHub");

// `verify` stashes the raw body on req.rawBody so HMAC-verifying
// webhooks (e.g. /api/ironclaw/bridge/inbound) can hash the exact
// bytes the upstream signed. Other routes ignore it.
//
// 256KB JSON cap + 64KB urlencoded cap defend against payload-bomb
// DoS. Multipart uploads (media.route /upload) are handled by busboy
// with its own 25MB limit and don't pass through express.json.
app.use(express.json({
  limit: "256kb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

// helmet sets sensible default security headers (X-DNS-Prefetch-Control,
// X-Frame-Options: SAMEORIGIN, Strict-Transport-Security, etc.). CSP is
// off because this process serves no HTML — every consumer is a JSON
// client whose own page sets its own policy.
app.use(require("helmet")({ contentSecurityPolicy: false }));

// CORS allowlist. Comma-separated CORS_ALLOWED_ORIGINS env, plus
// http://localhost:3000 in dev for `next dev`. Anything not on the list
// gets no Access-Control-Allow-Origin header → browsers reject. The
// previous bare cors() echoed every Origin, which is wide open.
const corsAllowed = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
);
if (process.env.NODE_ENV !== "production") {
  corsAllowed.add("http://localhost:3000");
}
app.use(require("cors")({
  origin: (origin, cb) => {
    // Same-origin (curl, server-to-server, native fetch with no Origin
    // header) gets through. Browser-issued cross-origin must be on the
    // allowlist.
    if (!origin) return cb(null, true);
    cb(null, corsAllowed.has(origin));
  },
  credentials: true,
}));

// Routes — Auth (nonce issuance for signed-message middleware; public)
app.use("/api/auth",      require("./routes/auth.route"));
app.use("/api/admin",     require("./routes/admin.route"));

// Routes — AI-powered
app.use("/api/summary",   require("./routes/summary.route"));
app.use("/api/research",  require("./routes/research.route"));
app.use("/api/verify",    require("./routes/verify.route"));
app.use("/api/portfolio", require("./routes/portfolio.route"));
app.use("/api/security",  require("./routes/security.route"));
app.use("/api/chat",      require("./routes/chat.route"));
// Mount /avatar BEFORE /agents so the specific prefix wins (Express
// dispatches in declaration order — agents.route falls through fine
// either way, but ordering by specificity reads cleaner).
app.use("/api/agents/avatar",   require("./routes/avatars.route"));
// Phase 10 v1 lock — every request to /api/agents/diy returns 403 until
// Phase 5 unlocks DIY composition. Mounted BEFORE /api/agents so it
// wins for the /diy subpath without disturbing the rest.
app.use("/api/agents/diy",      require("./routes/agentsDiy.route"));
app.use("/api/agents",    require("./routes/agents.route"));
app.use("/api/skills",    require("./routes/skills.route"));
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
app.use("/api/rewards",       require("./routes/rewards.route"));
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
app.use("/api/treasury",      require("./routes/treasury.route"));
app.use("/api/tg",            require("./routes/tg.route"));
app.use("/api/xfeed",         require("./routes/xfeed.route"));
app.use("/api/trading",       require("./routes/trading.route"));
app.use("/api/bridge",        require("./routes/bridge.route"));
app.use("/api/ai",            require("./routes/ai.route"));
app.use("/api/market",        require("./routes/market.route"));
app.use("/api/ironclaw",      require("./routes/ironclaw.route"));

// Phase 10 — Agent Economy
app.use("/api/missions",      require("./routes/missions.route"));
app.use("/api/kits",          require("./routes/kits.route"));
app.use("/api/escalations",   require("./routes/escalations.route"));

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

// Error handler — surface known categories clearly instead of a generic 500.
app.use((err, req, res, next) => {
  console.error("IronClaw API error:", err);
  const msg = String(err?.message || "");
  const code = err?.code || "";

  // Body-parser size cap: keep its 413 status (Day 2.4 sets the limits).
  // The generic 500 fallthrough below would otherwise mask the real cause.
  if (err.type === "entity.too.large" || err.statusCode === 413) {
    return res.status(413).json({
      success: false,
      error: "request entity too large",
      limit: err.limit,
    });
  }

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
  try { require("./services/orchestratorBot").start(); } catch (e) { console.warn("[orchestrator] not started:", e.message); }
  try { require("./services/agents/automationWorker").start(); } catch (e) { console.warn("[automation] not started:", e.message); }
}

start();

module.exports = app;
