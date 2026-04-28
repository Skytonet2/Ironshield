// backend/routes/ironguide.route.js
//
// Phase 10 Tier 2 — IronGuide concierge HTTP surface.
//
// Anonymous-friendly: a brand-new visitor can start an onboarding
// session before they connect a wallet. If a wallet header is present
// we attach it to the session so /onboard can resume on revisit.
//
// Endpoints:
//   POST /api/ironguide/start             { channel, tg_id? }
//   POST /api/ironguide/:id/reply         { content }
//   POST /api/ironguide/:id/recommend
//   POST /api/ironguide/:id/confirm       (after deploy wizard completes)
//   GET  /api/ironguide/open              ?channel=web|tg
//   GET  /api/ironguide/:id                full session

const router = require("express").Router();
const ironguide = require("../services/ironguide");

router.post("/start", async (req, res) => {
  try {
    const channel = req.body?.channel || "web";
    const subject = {};
    if (channel === "web") {
      subject.wallet = req.headers["x-wallet"]
        ? String(req.headers["x-wallet"]).toLowerCase()
        : null;
    } else if (channel === "tg") {
      const tgId = Number(req.body?.tg_id);
      if (!Number.isFinite(tgId)) return res.status(400).json({ error: "tg_id required for channel=tg" });
      subject.tg_id = tgId;
    }
    const result = await ironguide.start({ channel, subject });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:id/reply", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "id must be numeric" });
    const content = String(req.body?.content || "").trim();
    if (!content) return res.status(400).json({ error: "content required" });
    const result = await ironguide.reply({ sessionId, content });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:id/recommend", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "id must be numeric" });
    const result = await ironguide.recommend({ sessionId });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:id/confirm", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "id must be numeric" });
    const session = await ironguide.confirmDeployed({ sessionId });
    res.json({ ok: true, session });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/open", async (req, res) => {
  try {
    const channel = String(req.query.channel || "web");
    if (channel === "web") {
      const wallet = req.headers["x-wallet"]
        ? String(req.headers["x-wallet"]).toLowerCase()
        : null;
      if (!wallet) return res.json({ session: null });
      const session = await ironguide.findOpen({ channel: "web", wallet });
      return res.json({ session });
    }
    if (channel === "tg") {
      const tgId = Number(req.query.tg_id);
      if (!Number.isFinite(tgId)) return res.status(400).json({ error: "tg_id required" });
      const session = await ironguide.findOpen({ channel: "tg", tg_id: tgId });
      return res.json({ session });
    }
    res.status(400).json({ error: "unknown channel" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId)) return res.status(400).json({ error: "id must be numeric" });
    const session = await ironguide.loadSession(sessionId);
    if (!session) return res.status(404).json({ error: "not found" });
    res.json({ session });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
