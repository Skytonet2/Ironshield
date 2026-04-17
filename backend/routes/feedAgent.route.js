// backend/routes/feedAgent.route.js — IronClaw user-agents (10N/month)
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet } = require("../services/feedHelpers");
const { verifyTransfer } = require("../services/txVerify");
const agent = require("../services/agentConnector");

// Wallets that bypass payment for premium features (team / founders).
const FEE_WAIVED = new Set(["skyto.near"]);

// POST /api/feed-agent/deploy  body: { paymentTxHash, postStyle, personality, postSchedule, commentRules, repostRules, waived? }
router.post("/deploy", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { paymentTxHash, postStyle = "", personality = [], postSchedule = "", commentRules = "", repostRules = "" } = req.body || {};
    const waived = FEE_WAIVED.has(String(req.wallet).toLowerCase());
    if (!paymentTxHash) return res.status(400).json({ error: "paymentTxHash required" });

    if (!waived) {
      const check = await verifyTransfer({ txHash: paymentTxHash, signerId: req.wallet, minAmountNear: 10 });
      if (!check.ok) return res.status(402).json({ error: `Payment verification failed: ${check.reason}` });
    }

    const expires = new Date(Date.now() + 30 * 86400_000);
    const r = await db.query(
      `INSERT INTO feed_ironclaw_agents (owner_id, expires_at, monthly_fee_tx, post_style, personality, post_schedule, comment_rules, repost_rules, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
      [user.id, expires, paymentTxHash, postStyle, personality, postSchedule, commentRules, repostRules]);
    await db.query("UPDATE feed_users SET account_type='AGENT' WHERE id=$1", [user.id]);
    res.json({ agent: r.rows[0] });
  } catch (e) { next(e); }
});

// PATCH /api/feed-agent/:id/config
router.patch("/:id/config", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { postStyle, personality, postSchedule, commentRules, repostRules, active } = req.body || {};
    const r = await db.query(
      `UPDATE feed_ironclaw_agents SET
         post_style    = COALESCE($2, post_style),
         personality   = COALESCE($3, personality),
         post_schedule = COALESCE($4, post_schedule),
         comment_rules = COALESCE($5, comment_rules),
         repost_rules  = COALESCE($6, repost_rules),
         active        = COALESCE($7, active)
       WHERE id=$1 AND owner_id=$8 RETURNING *`,
      [req.params.id, postStyle, personality, postSchedule, commentRules, repostRules, active, user.id]);
    if (!r.rows.length) return res.status(404).json({ error: "agent not found or not yours" });
    res.json({ agent: r.rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    await db.query("UPDATE feed_ironclaw_agents SET active=FALSE WHERE id=$1 AND owner_id=$2", [req.params.id, user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/:id/status", async (req, res, next) => {
  try {
    const r = await db.query("SELECT * FROM feed_ironclaw_agents WHERE id=$1", [req.params.id]);
    res.json({ agent: r.rows[0] || null });
  } catch (e) { next(e); }
});

// GET /api/feed-agent/mine — current user's agent
router.get("/mine/info", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const r = await db.query("SELECT * FROM feed_ironclaw_agents WHERE owner_id=$1 AND active=TRUE ORDER BY deployed_at DESC LIMIT 1", [user.id]);
    res.json({ agent: r.rows[0] || null });
  } catch (e) { next(e); }
});

router.post("/suggest-format", requireWallet, async (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    const kind = String(req.body?.kind || "post").trim();
    const title = String(req.body?.title || "").trim();
    if (!content) return res.status(400).json({ error: "content required" });

    let suggestion;
    try {
      suggestion = await agent.suggestPostFormats({ content, kind, title, wallet: req.wallet });
    } catch {
      suggestion = null;
    }

    if (!suggestion?.formats?.length) {
      const trimmed = content.replace(/\s+/g, " ").trim();
      const baseTitle = title || trimmed.slice(0, 54) || "Idea";
      suggestion = {
        summary: "This draft has a strong core idea and could land better with clearer packaging.",
        recommendedFormat: trimmed.length > 240 ? "Mini article" : "Punchy post",
        formats: [
          {
            id: "punchy-post",
            label: "Punchy post",
            kind: "post",
            why: "Best when you want a sharp single-post take.",
            title: "",
            content: trimmed.slice(0, 500),
          },
          {
            id: "thread-opener",
            label: "Thread opener",
            kind: "post",
            why: "Good when the idea needs a hook and follow-up context.",
            title: "",
            content: `1/ ${trimmed.slice(0, 496)}`,
          },
          {
            id: "mini-article",
            label: "Mini article",
            kind: "article",
            why: "Useful when the idea wants more framing and a clearer thesis.",
            title: baseTitle,
            content: `${trimmed}\n\nWhy this matters:\n- \n- \n\nWhat happens next:\n- `,
          },
        ],
      };
    }

    res.json({ suggestion });
  } catch (e) { next(e); }
});

module.exports = router;
