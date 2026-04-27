// backend/routes/agentsDiy.route.js
//
// Phase 10 v1 lock — DIY agent composition is gated until Phase 5 of
// the Agent Economy roadmap. The hard rule: every agent in v1 is a
// deployment of a curated Kit, no exceptions. This route exists so a
// frontend or third-party trying the spec's documented endpoint gets
// a deterministic, telemetry-able 403 instead of a 404.
//
// To open the gate later, delete this route file and remove the
// app.use line in server.js — the Phase 5 DIY composer will then
// land at its target path under the existing /api/agents mount.

const router = require("express").Router();

router.all(/.*/, (_req, res) => {
  res.status(403).json({
    error: "kit_deploy_only",
    phase: "v1",
    message:
      "DIY agent composition is gated to Phase 5. At v1 every agent is a deployment of a curated Kit.",
  });
});

module.exports = router;
