// backend/routes/portfolio.route.js
const express = require("express");
const router  = express.Router();
const agent   = require("../services/agentConnector");
const cache   = require("../services/cacheService");
const limiter = require("../services/rateLimiter");
const fs      = require("fs");
const path    = require("path");

const USERS_FILE = path.join(__dirname, "../../jobs/data/users.json");
const readUsers  = () => { try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch { return []; } };
const writeUsers = (data) => fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));

router.post("/", async (req, res) => {
  const { action = "fetch", userId, wallet } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: "userId required" });

  const limit = limiter.check(userId, "portfolio");
  if (!limit.allowed) return res.status(429).json({ success: false, error: `Rate limit hit. Retry in ${limit.retryAfter}s` });

  limiter.consume(userId, "portfolio");

  if (action === "add_wallet") {
    if (!wallet) return res.status(400).json({ success: false, error: "wallet required" });
    const users = readUsers();
    const user  = users.find(u => u.userId === userId) || { userId, wallets: [], chatId: null };
    if (!user.wallets.includes(wallet)) user.wallets.push(wallet);
    const updated = users.filter(u => u.userId !== userId);
    updated.push(user);
    writeUsers(updated);
    // fall through to fetch
  }

  if (action === "remove_wallet") {
    if (!wallet) return res.status(400).json({ success: false, error: "wallet required" });
    const users = readUsers();
    const user  = users.find(u => u.userId === userId);
    if (user) {
      user.wallets = user.wallets.filter(w => w !== wallet);
      writeUsers(users);
    }
    return res.json({ success: true, data: { message: "Wallet removed" } });
  }

  // Fetch portfolio
  const users   = readUsers();
  const user    = users.find(u => u.userId === userId);
  const wallets = user?.wallets || [];

  const key    = `portfolio:${userId}`;
  const cached = cache.get(key);
  if (cached && action === "fetch") return res.json({ success: true, cached: true, data: cached });

  try {
    const data = await agent.portfolio({ wallets });
    cache.set(key, data, 120);
    res.json({ success: true, cached: false, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
