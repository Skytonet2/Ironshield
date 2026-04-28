// backend/routes/skills.route.js
//
// Skill execution registry surface. The on-chain skill marketplace
// owns metadata + installs (Phase 7); this route surfaces the
// **runnable** subset — first-party modules the orchestrator can
// actually execute on behalf of the user's agent.
//
// Mounted under /api/skills. The on-chain id ↔ registry key binding
// is documented at services/skills/index.js: skills with
// SkillMetadata.category = "builtin:<key>" run the matching module.

const router = require("express").Router();
const { providers } = require("near-api-js");
const adapters = require("../services/agents");
const connectionStore = require("../services/agents/connectionStore");
const skills = require("../services/skills");
const httpRunner = require("../services/skills/http_runner");
const requireWallet = require("../middleware/requireWallet");
const db = require("../db/client");

const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.fastnear.com";
const provider = new providers.JsonRpcProvider({ url: RPC_URL });
const SKILLS_CONTRACT = process.env.STAKING_CONTRACT_ID || process.env.CONTRACT_ID || "ironshield.near";
// Platform cut on skill installs. Must match the contract's
// PLATFORM_FEE_BPS — change here if the contract ever rotates.
// Day 15 raised the constant to 1500 (15%) on testnet but mainnet
// contract still runs 100 (1%) until the Day 21 cutover redeploys
// ironshield.near. Hold this at 100 until then or the dashboard
// over-states treasury take on every mainnet install. Day 21 PR
// must move both in lockstep.
const PLATFORM_FEE_BPS = 100; // 1.00% — bumps to 1500 at Day 21 cutover

/** GET /api/skills/registry
 *  Public list of every executable built-in skill + its expected
 *  params. Used by the wizard / automation modal so users can pick a
 *  built-in without guessing the registry key.
 */
router.get("/registry", (_req, res) => {
  res.json({ skills: skills.listManifests() });
});

/** POST /api/skills/run
 *  One-shot execution. Used by the dashboard "Run skill" button.
 *  Body: { agent_account, skill_key, params? }
 *
 *  The same code path is exercised by automationExecutor.callSkill
 *  when a rule's action is `call_skill` — they share the registry,
 *  so a manual run mirrors what a scheduled rule would do.
 */
router.post("/run", requireWallet, async (req, res) => {
  const wallet = req.wallet;
  // `verified` is set by callers that have already verified the on-
  // chain SkillMetadata.verified flag (e.g. automationExecutor when
  // it loads the rule's skill_id). Manual /run calls from the UI
  // currently leave it false, so HTTP skills only execute through
  // automation rules tied to verified listings — that's the intended
  // safety boundary.
  const { agent_account, skill_key, category, params, verified } = req.body || {};
  if (!agent_account || (!skill_key && !category)) {
    return res.status(400).json({ error: "agent_account and (skill_key OR category) required" });
  }
  if (skill_key && !skills.get(skill_key)) {
    return res.status(404).json({ error: `Unknown built-in skill: ${skill_key}` });
  }
  if (!skill_key) {
    // category-only path — must classify to something runnable.
    const c = skills.classifyCategory(category);
    if (!c) return res.status(400).json({ error: `Unrunnable category: ${category}` });
  }

  // Resolve the user's framework connection so the skill can call
  // their agent for LLM judgement.
  let conn;
  try {
    const list = await connectionStore.listForOwner(wallet);
    conn = list.find(c => c.agent_account === agent_account && c.status !== "disconnected");
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!conn) return res.status(404).json({ error: "No active framework connection on this agent" });

  const adapter = adapters.get(conn.framework);
  let auth = null;
  try { auth = await connectionStore.getDecryptedAuth({ owner: wallet, agent_account, framework: conn.framework }); }
  catch { /* treat missing auth as anonymous; adapter will reject if needed */ }

  const agentFn = ({ message, systemPrompt, meta } = {}) =>
    adapter.sendMessage({
      external_id: conn.external_id,
      endpoint:    conn.endpoint,
      auth,
      message,
      systemPrompt,
      meta,
    });

  try {
    const ctx = {
      owner:         wallet,
      agent_account,
      params:        params || {},
      agent:         agentFn,
    };
    const result = skill_key
      ? await skills.run({ id: skill_key, ctx })
      : await skills.runByCategory({ category, ctx, verified: Boolean(verified) });
    res.json({ ok: true, skill_key: skill_key || null, category: category || null, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** POST /api/skills/http_callback/:token
 *  Author-hosted skills POST here while their /run is in flight to
 *  ask the user's connected framework agent for an LLM hop.
 *
 *  Body: { kind: "agent_message", message, system?, framework? }
 *  Returns: { reply }
 */
// public: HMAC-signed short-lived token in the URL is the credential —
// the author's server-side process has no NEAR wallet to sign with.
router.post("/http_callback/:token", async (req, res) => {
  const payload = httpRunner.verifyCallbackToken(req.params.token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });

  const { kind, message, system, framework: requestedFw } = req.body || {};
  if (kind !== "agent_message") {
    return res.status(400).json({ error: "Only agent_message callbacks are supported right now" });
  }
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message required" });
  }
  if (Buffer.byteLength(message, "utf8") > 64 * 1024) {
    return res.status(413).json({ error: "message > 64KB cap" });
  }

  // Resolve the user's framework connection. Prefer `requestedFw`
  // when supplied; otherwise pick the first active connection.
  let conn;
  try {
    const list = await connectionStore.listForOwner(payload.owner);
    const filtered = list.filter(c => c.agent_account === payload.agent_account && c.status !== "disconnected");
    conn = requestedFw
      ? filtered.find(c => c.framework === requestedFw)
      : filtered[0];
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!conn) return res.status(404).json({ error: "No active framework on this agent" });

  let adapter;
  try { adapter = adapters.get(conn.framework); }
  catch (err) { return res.status(500).json({ error: err.message }); }

  let auth = null;
  try { auth = await connectionStore.getDecryptedAuth({ owner: payload.owner, agent_account: payload.agent_account, framework: conn.framework }); }
  catch { /* anonymous adapter call ok */ }

  try {
    const out = await adapter.sendMessage({
      external_id:  conn.external_id,
      endpoint:     conn.endpoint,
      auth,
      message,
      systemPrompt: system,
    });
    res.json({ reply: out?.reply || "", framework: conn.framework });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── Skill sales — Day 16 ─────────────────────────────────────────────
//
// Client-reports-server-verifies pattern (mirrors NewsCoin verify-trade).
// Frontend calls this right after a successful install_skill tx; the
// server pulls the tx from the chain, parses the skill_installed event
// log, derives revenue split from PLATFORM_FEE_BPS, and inserts into
// skill_sales. Dedupe is by tx_hash PK so retries are safe.

/** POST /api/skills/record-install
 *  Body: { txHash }
 *  Client posts immediately after install_skill confirms; server
 *  re-verifies on-chain. Free installs (paid=false) are accepted but
 *  not persisted — they aren't revenue.
 */
router.post("/record-install", requireWallet, async (req, res) => {
  try {
    const wallet = req.wallet;
    const { txHash } = req.body || {};
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({ error: "txHash required" });
    }

    // Idempotent shortcut — already indexed.
    const existing = await db.query(
      "SELECT tx_hash FROM skill_sales WHERE tx_hash=$1 LIMIT 1",
      [txHash]
    );
    if (existing.rows.length) return res.json({ ok: true, indexed: true, deduped: true });

    // Verify on-chain. Retry up to 5×2s for in-flight propagation
    // (same pattern as Day 11 newscoin verify-trade).
    let txResult;
    {
      const MAX = 5, DELAY = 2000;
      let lastErr;
      for (let i = 0; i < MAX; i++) {
        try { txResult = await provider.txStatus(txHash, wallet, "FINAL"); break; }
        catch (err) { lastErr = err; if (i < MAX - 1) await new Promise(r => setTimeout(r, DELAY)); }
      }
      if (!txResult) {
        return res.status(400).json({ error: `tx verification failed: ${lastErr?.message || "not found"}` });
      }
    }

    if (txResult.transaction.signer_id !== wallet) {
      return res.status(400).json({ error: "signer mismatch" });
    }
    if (txResult.transaction.receiver_id !== SKILLS_CONTRACT) {
      return res.status(400).json({ error: "tx not against skills contract" });
    }

    // Find skill_installed event in the receipt logs.
    let evt = null;
    let blockHeight = null;
    for (const ro of txResult.receipts_outcome || []) {
      if (ro.outcome?.block_hash) {
        // Block height isn't directly on the outcome; pull it via the
        // block hash if we want it — keep null for v1, the column is
        // nullable and dashboards don't rely on it.
      }
      for (const log of ro.outcome?.logs || []) {
        if (!log.startsWith("EVENT_JSON:")) continue;
        try {
          const parsed = JSON.parse(log.slice("EVENT_JSON:".length));
          if (parsed?.event !== "skill_installed") continue;
          // The contract emits `data` as a flat object, not the
          // NEP-297-canonical array. Accept either shape so a future
          // contract migration to NEP-297 doesn't break this indexer.
          if (Array.isArray(parsed.data)) { evt = parsed.data[0]; break; }
          if (parsed.data && typeof parsed.data === "object") { evt = parsed.data; break; }
        } catch { /* non-JSON log, skip */ }
      }
      if (evt) break;
    }
    if (!evt) return res.status(400).json({ error: "skill_installed event not in tx logs" });

    // Free installs aren't revenue. Tell client we accepted the tx
    // but don't persist a row — keeps SUM(price_yocto) honest.
    if (!evt.paid) return res.json({ ok: true, indexed: false, reason: "free install" });

    const skillId = String(evt.skill_id);
    const priceYocto = String(evt.price_yocto || "0");
    const owner = String(evt.owner || wallet);

    // Resolve the creator wallet from the on-chain skill metadata. The
    // event itself doesn't include it — the contract has a get_skill
    // view that returns the author. If the lookup fails (RPC blip,
    // skill removed) we fall through to "" so the row still records;
    // the dashboard surfaces a "creator unknown" state for those.
    let creator = "";
    try {
      const view = await provider.query({
        request_type: "call_function",
        finality: "final",
        account_id: SKILLS_CONTRACT,
        method_name: "get_skill",
        args_base64: Buffer.from(JSON.stringify({ skill_id: Number(skillId) })).toString("base64"),
      });
      const decoded = JSON.parse(Buffer.from(view.result).toString());
      if (decoded?.author) creator = String(decoded.author);
    } catch { /* leave creator blank — see comment above */ }

    // Derive split from PLATFORM_FEE_BPS. NUMERIC math via BigInt to
    // avoid float drift on yocto-scale numbers.
    const priceBig = BigInt(priceYocto);
    const treasuryTake = (priceBig * BigInt(PLATFORM_FEE_BPS)) / 10000n;
    const creatorTake = priceBig - treasuryTake;

    await db.query(
      `INSERT INTO skill_sales
       (tx_hash, block_height, skill_id, buyer_wallet, creator_wallet,
        price_yocto, creator_take_yocto, treasury_take_yocto)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [txHash, blockHeight, skillId, owner, creator,
       priceYocto, creatorTake.toString(), treasuryTake.toString()]
    );
    res.json({ ok: true, indexed: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/skills/revenue?wallet=<>
 *  Per-creator revenue dashboard data. Signed-auth required; the
 *  server enforces req.wallet === query.wallet so a creator can only
 *  read their own numbers.
 */
router.get("/revenue", requireWallet, async (req, res) => {
  try {
    const wallet = String(req.query.wallet || "").toLowerCase();
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    if (wallet !== req.wallet.toLowerCase()) {
      return res.status(403).json({ error: "wallet mismatch" });
    }

    const totalsQ = db.query(
      `SELECT
         COUNT(*)::int                                          AS sales_total,
         COALESCE(SUM(creator_take_yocto), 0)::text             AS earned_total,
         COALESCE(SUM(creator_take_yocto)
           FILTER (WHERE sold_at >= NOW() - INTERVAL '24 hours'), 0)::text AS earned_24h,
         COALESCE(SUM(creator_take_yocto)
           FILTER (WHERE sold_at >= NOW() - INTERVAL '7 days'), 0)::text  AS earned_7d
       FROM skill_sales WHERE creator_wallet = $1`,
      [wallet]
    );
    const perSkillQ = db.query(
      `SELECT skill_id,
              COUNT(*)::int                              AS sales,
              SUM(creator_take_yocto)::text              AS earned_yocto
       FROM skill_sales WHERE creator_wallet = $1
       GROUP BY skill_id ORDER BY SUM(creator_take_yocto) DESC LIMIT 50`,
      [wallet]
    );
    const recentQ = db.query(
      `SELECT tx_hash, skill_id, buyer_wallet,
              creator_take_yocto::text AS creator_take_yocto,
              price_yocto::text AS price_yocto,
              sold_at
       FROM skill_sales WHERE creator_wallet = $1
       ORDER BY sold_at DESC LIMIT 30`,
      [wallet]
    );
    const [totals, perSkill, recent] = await Promise.all([totalsQ, perSkillQ, recentQ]);
    res.json({
      totals: totals.rows[0],
      perSkill: perSkill.rows,
      recent: recent.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/skills/history?wallet=<>&before=<iso>
 *  Lifetime purchase history for the connected wallet. Reads
 *  skill_sales filtered by buyer_wallet. Cursor pagination on sold_at
 *  DESC; pass `before=<sold_at>` of the last row of the previous page
 *  to fetch the next 50.
 */
router.get("/history", requireWallet, async (req, res) => {
  try {
    const wallet = String(req.query.wallet || "").toLowerCase();
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    if (wallet !== req.wallet.toLowerCase()) {
      return res.status(403).json({ error: "wallet mismatch" });
    }
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    const params = [wallet];
    let where = "buyer_wallet = $1";
    if (before && !isNaN(before.getTime())) {
      params.push(before.toISOString());
      where += ` AND sold_at < $${params.length}`;
    }
    const r = await db.query(
      `SELECT tx_hash, skill_id, creator_wallet,
              price_yocto::text         AS price_yocto,
              creator_take_yocto::text  AS creator_take_yocto,
              treasury_take_yocto::text AS treasury_take_yocto,
              sold_at
         FROM skill_sales
        WHERE ${where}
        ORDER BY sold_at DESC
        LIMIT 51`,
      params
    );
    const hasMore = r.rows.length > 50;
    const rows = hasMore ? r.rows.slice(0, 50) : r.rows;
    res.json({
      rows,
      nextBefore: hasMore ? rows[rows.length - 1].sold_at : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
