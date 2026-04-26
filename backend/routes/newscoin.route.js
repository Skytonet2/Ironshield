// backend/routes/newscoin.route.js — NewsCoin: tradeable news story coins
//
// Database tables (run these migrations before first use):
//
// CREATE TABLE IF NOT EXISTS feed_newscoins (
//   id SERIAL PRIMARY KEY,
//   story_id TEXT NOT NULL,
//   contract_address TEXT UNIQUE,
//   name TEXT NOT NULL,
//   ticker TEXT NOT NULL,
//   creator TEXT NOT NULL,
//   mcap NUMERIC DEFAULT 0,
//   mcap_usd NUMERIC DEFAULT 0,
//   price NUMERIC DEFAULT 0,
//   volume_24h NUMERIC DEFAULT 0,
//   trade_count INTEGER DEFAULT 0,
//   graduated BOOLEAN DEFAULT FALSE,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE IF NOT EXISTS feed_newscoin_trades (
//   id SERIAL PRIMARY KEY,
//   coin_id INTEGER REFERENCES feed_newscoins(id),
//   trader TEXT NOT NULL,
//   trade_type TEXT NOT NULL,
//   token_amount NUMERIC NOT NULL,
//   near_amount NUMERIC NOT NULL,
//   price NUMERIC NOT NULL,
//   tx_hash TEXT,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE TABLE IF NOT EXISTS feed_newscoin_holdings (
//   coin_id INTEGER REFERENCES feed_newscoins(id),
//   wallet TEXT NOT NULL,
//   balance NUMERIC DEFAULT 0,
//   PRIMARY KEY (coin_id, wallet)
// );
//
// CREATE TABLE IF NOT EXISTS feed_newscoin_sparklines (
//   coin_id INTEGER REFERENCES feed_newscoins(id),
//   price NUMERIC NOT NULL,
//   recorded_at TIMESTAMPTZ DEFAULT NOW()
// );

const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const db = require("../db/client");
const { providers } = require("near-api-js");
const requireWallet = require("../middleware/requireWallet");

const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.fastnear.com";
const provider = new providers.JsonRpcProvider({ url: RPC_URL });

const AI_ENDPOINT = process.env.NEAR_AI_ENDPOINT || "https://cloud-api.near.ai/v1/chat/completions";
const AI_KEY = process.env.NEAR_AI_KEY || "";
const AI_MODEL = process.env.NEAR_AI_MODEL || "Qwen/Qwen3-30B-A3B-Instruct-2507";

const FEE_WAIVED = new Set(["skyto.near"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fee model — must match the on-chain contract + MintModal disclosures.
// ---------------------------------------------------------------------------
const CREATOR_FEE_RATE  = 0.02;   // 2% → First Mover
const PLATFORM_FEE_RATE = 0.01;   // 1% → Treasury
const GRADUATION_MCAP_USD_DEFAULT = 70_000;

// Derive a stable lifecycle state from bonding % and boolean flags.
// Kept in sync with src/lib/newscoinLifecycle.js on the frontend so
// badges mean the same thing everywhere.
function lifecycleFor({ mcap_usd = 0, graduated = false, killed = false, target_usd = GRADUATION_MCAP_USD_DEFAULT }) {
  if (killed)     return { key: "killed",      label: "Killed",      color: "#ef4444" };
  if (graduated)  return { key: "graduated",   label: "Graduated",   color: "#10b981" };
  const pct = Math.min(100, (Number(mcap_usd) / target_usd) * 100);
  if (pct >= 90)  return { key: "graduating",  label: "Graduating",  color: "#34d399" };
  if (pct >= 60)  return { key: "peak",        label: "Peak",        color: "#f97316" };
  if (pct >= 20)  return { key: "trending",    label: "Trending",    color: "#fb923c" };
  return              { key: "early",          label: "Early",       color: "#eab308" };
}

function ensureDb(res) {
  if (!db || typeof db.query !== "function") {
    res.status(503).json({ error: "Backend database is not configured" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /api/newscoin/list
// ---------------------------------------------------------------------------
router.get("/list", async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;

    const wallet = req.header("x-wallet");
    const filter = req.query.filter || "trending";
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;

    let sql = "";
    let params = [];
    let paramIdx = 1;

    switch (filter) {
      case "new":
        sql = `SELECT c.*, p.id AS post_id, p.content AS post_content, u.wallet_address AS post_author
               FROM feed_newscoins c
               LEFT JOIN feed_posts p ON p.id::text = c.story_id
               LEFT JOIN feed_users u ON u.id = p.author_id
               ${cursor ? `WHERE c.id < $${paramIdx++}` : ""}
               ORDER BY c.created_at DESC
               LIMIT $${paramIdx}`;
        params = cursor ? [cursor, limit] : [limit];
        break;

      case "top":
        sql = `SELECT c.*, p.id AS post_id, p.content AS post_content, u.wallet_address AS post_author
               FROM feed_newscoins c
               LEFT JOIN feed_posts p ON p.id::text = c.story_id
               LEFT JOIN feed_users u ON u.id = p.author_id
               ${cursor ? `WHERE c.id < $${paramIdx++}` : ""}
               ORDER BY c.mcap DESC
               LIMIT $${paramIdx}`;
        params = cursor ? [cursor, limit] : [limit];
        break;

      case "expiring":
        sql = `SELECT c.*, p.id AS post_id, p.content AS post_content, u.wallet_address AS post_author
               FROM feed_newscoins c
               LEFT JOIN feed_posts p ON p.id::text = c.story_id
               LEFT JOIN feed_users u ON u.id = p.author_id
               WHERE c.created_at < NOW() - INTERVAL '48 hours'
                 AND c.graduated = FALSE
                 ${cursor ? `AND c.id < $${paramIdx++}` : ""}
               ORDER BY c.created_at ASC
               LIMIT $${paramIdx}`;
        params = cursor ? [cursor, limit] : [limit];
        break;

      case "holdings":
        if (!wallet) return res.status(401).json({ error: "wallet required for holdings filter" });
        sql = `SELECT c.*, h.balance,
                      p.id AS post_id, p.content AS post_content, u.wallet_address AS post_author
               FROM feed_newscoin_holdings h
               JOIN feed_newscoins c ON c.id = h.coin_id
               LEFT JOIN feed_posts p ON p.id::text = c.story_id
               LEFT JOIN feed_users u ON u.id = p.author_id
               WHERE h.wallet = $${paramIdx++} AND h.balance > 0
               ${cursor ? `AND c.id < $${paramIdx++}` : ""}
               ORDER BY c.mcap DESC
               LIMIT $${paramIdx}`;
        params = cursor ? [wallet, cursor, limit] : [wallet, limit];
        break;

      default: // trending
        sql = `SELECT c.*,
                      p.id AS post_id, p.content AS post_content, u.wallet_address AS post_author
               FROM feed_newscoins c
               LEFT JOIN feed_posts p ON p.id::text = c.story_id
               LEFT JOIN feed_users u ON u.id = p.author_id
               ${cursor ? `WHERE c.id < $${paramIdx++}` : ""}
               ORDER BY (c.volume_24h / (EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600 + 1)) DESC
               LIMIT $${paramIdx}`;
        params = cursor ? [cursor, limit] : [limit];
        break;
    }

    const { rows } = await db.query(sql, params);

    // Attach sparkline data for each coin
    const coinIds = rows.map((r) => r.id);
    let sparkMap = {};
    if (coinIds.length) {
      const sp = await db.query(
        `SELECT coin_id, price FROM feed_newscoin_sparklines
         WHERE coin_id = ANY($1)
         ORDER BY recorded_at ASC`,
        [coinIds]
      );
      for (const s of sp.rows) {
        if (!sparkMap[s.coin_id]) sparkMap[s.coin_id] = [];
        sparkMap[s.coin_id].push(Number(s.price));
      }
    }

    const coins = rows.map((r) => {
      const ageMs = Date.now() - new Date(r.created_at).getTime();
      const ageHours = ageMs / 3_600_000;
      const mcapUsd = Number(r.mcap_usd) || 0;
      const volume24h = Number(r.volume_24h) || 0;
      const lc = lifecycleFor({ mcap_usd: mcapUsd, graduated: r.graduated });
      return {
        id: r.id,
        storyId: r.story_id,
        name: r.name,
        ticker: r.ticker,
        creator: r.creator,
        mcap: Number(r.mcap),
        mcapUsd,
        mcap_usd: mcapUsd,   // snake_case for frontend row components
        price: Number(r.price),
        priceNear: Number(r.price),
        price_near: Number(r.price),
        volume24h,
        volume_24h: volume24h,
        // change_24h is computed by the Day 10 sparkline indexer, not yet live.
        // Until then the row renders flat (0) which the frontend already
        // tolerates — no fake numbers.
        change24h: 0,
        change_24h: 0,
        age: `${Math.round(ageHours)}h`,
        created_at: r.created_at,
        tradeCount: r.trade_count,
        graduated: r.graduated,
        lifecycle: lc,
        // First Mover context — the creator earns 2% on every trade forever.
        firstMover: {
          wallet: r.creator,
          fees_earned_near: volume24h * CREATOR_FEE_RATE, // last 24h slice shown in list
        },
        sparkline: sparkMap[r.id] || [],
        headline: r.post_content || r.name,
        post: r.post_id
          ? { id: r.post_id, content: r.post_content, author: r.post_author }
          : null,
      };
    });

    const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;
    res.json({ coins, nextCursor });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/newscoin/by-creator?creator=<wallet>
//
// Alias for /creator/:wallet kept because several frontend surfaces
// (FeedRightRail "Your Deploys", profile page) call this path with a
// query-string creator rather than the path form. Must be registered
// BEFORE the /:coinId route below or Express matches "by-creator" as
// a coin id and the DB throws "invalid input syntax for type integer".
// ---------------------------------------------------------------------------
router.get("/by-creator", async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;
    const wallet = String(req.query.creator || "").trim();
    if (!wallet) return res.status(400).json({ error: "creator query param required" });

    const { rows } = await db.query(
      `SELECT c.*,
              COALESCE(h.balance, 0) AS holdings
       FROM feed_newscoins c
       LEFT JOIN feed_newscoin_holdings h ON h.coin_id = c.id AND h.wallet = $1
       WHERE c.creator = $1
       ORDER BY c.created_at DESC`,
      [wallet]
    );

    const coins = rows.map((r) => ({
      id: r.id,
      name: r.name,
      ticker: r.ticker,
      mcap: Number(r.mcap),
      mcapUsd: Number(r.mcap_usd) || 0,
      holdings: Number(r.holdings),
      graduated: r.graduated,
      created_at: r.created_at,
      claimableFees: 0, // parity with /creator/:wallet until fee accumulator ships
    }));

    const totalClaimable = coins.reduce((s, c) => s + c.claimableFees, 0);
    res.json({ coins, totalPnl: 0, totalClaimable });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/newscoin/:coinId
// ---------------------------------------------------------------------------
router.get("/:coinId", async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;

    const { rows } = await db.query(
      `SELECT c.*, p.id AS post_id, p.content AS post_content, u.wallet_address AS post_author
       FROM feed_newscoins c
       LEFT JOIN feed_posts p ON p.id::text = c.story_id
       LEFT JOIN feed_users u ON u.id = p.author_id
       WHERE c.id = $1`,
      [req.params.coinId]
    );
    if (!rows.length) return res.status(404).json({ error: "coin not found" });

    const r = rows[0];
    const ageMs = Date.now() - new Date(r.created_at).getTime();

    const sp = await db.query(
      `SELECT price FROM feed_newscoin_sparklines
       WHERE coin_id = $1 ORDER BY recorded_at ASC`,
      [r.id]
    );

    res.json({
      coin: {
        id: r.id,
        storyId: r.story_id,
        contractAddress: r.contract_address,
        name: r.name,
        ticker: r.ticker,
        creator: r.creator,
        mcap: Number(r.mcap),
        mcapUsd: Number(r.mcap_usd),
        price: Number(r.price),
        priceNear: Number(r.price),
        volume24h: Number(r.volume_24h),
        change24h: 0,
        age: `${Math.round(ageMs / 3_600_000)}h`,
        tradeCount: r.trade_count,
        graduated: r.graduated,
        sparkline: sp.rows.map((s) => Number(s.price)),
        createdAt: r.created_at,
        post: r.post_id
          ? { id: r.post_id, content: r.post_content, author: r.post_author }
          : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/newscoin/:coinId/trades
// ---------------------------------------------------------------------------
router.get("/:coinId/trades", async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;

    const { rows } = await db.query(
      `SELECT id, trader, trade_type, token_amount, near_amount, price, created_at
       FROM feed_newscoin_trades
       WHERE coin_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.params.coinId]
    );

    const trades = rows.map((r) => ({
      id: r.id,
      trader: r.trader,
      type: r.trade_type,
      amount: Number(r.token_amount),
      price: Number(r.price),
      nearAmount: Number(r.near_amount),
      timestamp: r.created_at,
    }));

    res.json({ trades });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/newscoin/:coinId/curve
// ---------------------------------------------------------------------------
router.get("/:coinId/curve", async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;

    const { rows } = await db.query(
      "SELECT * FROM feed_newscoins WHERE id = $1",
      [req.params.coinId]
    );
    if (!rows.length) return res.status(404).json({ error: "coin not found" });

    const coin = rows[0];
    const target = GRADUATION_MCAP_USD_DEFAULT;
    const mcap = Number(coin.mcap_usd) || 0;
    const basePrice = Number(coin.price) || 0;

    // Piecewise bonding curve: price grows more steeply as bonding progresses.
    // Slopes are multiplicative on the current spot price and sized so the
    // last segment tops out at ~1.8× base at graduation — matches the
    // on-chain curve shape used by the contract for MVP.
    const segments = [
      { label: "Discovery",  from_usd: 0,                  to_usd: target * 0.20, from_mult: 0.40, to_mult: 0.70, color: "#eab308" },
      { label: "Traction",   from_usd: target * 0.20,      to_usd: target * 0.60, from_mult: 0.70, to_mult: 1.10, color: "#fb923c" },
      { label: "Peak",       from_usd: target * 0.60,      to_usd: target * 0.90, from_mult: 1.10, to_mult: 1.50, color: "#f97316" },
      { label: "Graduation", from_usd: target * 0.90,      to_usd: target,        from_mult: 1.50, to_mult: 1.80, color: "#10b981" },
    ].map(s => ({
      ...s,
      from_price_near: basePrice * s.from_mult,
      to_price_near:   basePrice * s.to_mult,
      active: mcap >= s.from_usd && mcap < s.to_usd,
    }));

    const activeIdx = segments.findIndex(s => s.active);
    const activeSeg = activeIdx === -1 ? null : segments[activeIdx];
    const transition = activeSeg
      ? Math.min(1, (mcap - activeSeg.from_usd) / Math.max(1, activeSeg.to_usd - activeSeg.from_usd))
      : (coin.graduated ? 1 : 0);

    res.json({
      graduation_mcap_usd: target,
      current_mcap_usd: mcap,
      bonding_pct: Math.min(100, (mcap / target) * 100),
      lifecycle: lifecycleFor({ mcap_usd: mcap, graduated: coin.graduated }),
      segments,
      activeSegmentIndex: activeIdx,
      transition_pct_in_segment: Math.round(transition * 100),
      last_update: coin.created_at,
      cooldown_remaining_s: 0,
      pending_update: null,
      // Legacy aliases — CurveInfoPanel checked these
      currentSegments: segments,
      pendingUpdate: null,
      lastUpdateAt: coin.created_at,
      cooldownEndsAt: null,
      transitionProgress: Math.round(transition * 100),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/newscoin/creator/:wallet
// ---------------------------------------------------------------------------
router.get("/creator/:wallet", async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;

    const wallet = req.params.wallet;
    const { rows } = await db.query(
      `SELECT c.*,
              COALESCE(h.balance, 0) AS holdings
       FROM feed_newscoins c
       LEFT JOIN feed_newscoin_holdings h ON h.coin_id = c.id AND h.wallet = $1
       WHERE c.creator = $1
       ORDER BY c.created_at DESC`,
      [wallet]
    );

    // claimableFees and totalPnl require the trade-fee accumulator + cost-
    // basis tracker that lands in Day 10. Until then both render as 0; the
    // dashboard explains "fees claimable: 0 — coming with NewsCoin v1".
    const coins = rows.map((r) => ({
      id: r.id,
      name: r.name,
      ticker: r.ticker,
      mcap: Number(r.mcap),
      holdings: Number(r.holdings),
      claimableFees: 0,
    }));
    const totalPnl = 0;
    const totalClaimable = coins.reduce((s, c) => s + c.claimableFees, 0);

    res.json({ coins, totalPnl, totalClaimable });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/newscoin/suggest
// ---------------------------------------------------------------------------
// Deterministic virality score 0.0–10.0 seeded by headline content.
// IronClaw-scored front-end tokenization potential; stable across calls so
// users see the same badge on repeat opens. AI-backed scoring can replace
// this later by returning a `score` field from the model.
function ironClawScore(headline) {
  const s = String(headline || "");
  if (!s.trim()) return 5.0;
  const seed = s.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  // Range 0.5 – 9.9 (avoid perfect 0 / 10 so UI tiers behave).
  const raw = ((seed * 37) % 941) / 100;
  return Math.max(0.5, Math.min(9.9, Number(raw.toFixed(1))));
}

router.post("/suggest", requireWallet, async (req, res, next) => {
  try {
    const { headline } = req.body || {};
    if (!headline) return res.status(400).json({ error: "headline required" });
    const score = ironClawScore(headline);

    if (!AI_KEY) {
      // Fallback when AI is not configured
      const fallbackTicker = headline
        .replace(/[^A-Za-z ]/g, "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((w) => w[0].toUpperCase())
        .join("");
      return res.json({
        name: headline.slice(0, 32),
        ticker: (fallbackTicker || "NEWS").slice(0, 6),
        score,
      });
    }

    const systemPrompt =
      "You are IronClaw, the AI agent for IronShield. Given this news headline, " +
      "suggest a creative, catchy coin name (max 32 chars) and ticker symbol (3-6 chars, uppercase). " +
      "The coin represents a tradeable bet on this news story's virality. " +
      "Respond in JSON: {name, ticker}";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const aiRes = await fetch(AI_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 200,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Headline: "${headline}" /no_think` },
        ],
      }),
    });
    clearTimeout(timeout);

    if (!aiRes.ok) throw new Error(`AI returned ${aiRes.status}`);

    const json = await aiRes.json();
    let text = (json.choices?.[0]?.message?.content || "").trim();

    // Strip thinking tags and markdown fences
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const suggestion = JSON.parse(text);
    res.json({
      name: String(suggestion.name || "").slice(0, 32),
      ticker: String(suggestion.ticker || "")
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 6),
      score,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/newscoin/:coinId/verify-trade
// ---------------------------------------------------------------------------
router.post("/:coinId/verify-trade", requireWallet, async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;

    const wallet = req.wallet;
    const { txHash, type } = req.body || {};
    if (!txHash) return res.status(400).json({ error: "txHash required" });
    if (!["buy", "sell"].includes(type))
      return res.status(400).json({ error: "type must be buy or sell" });

    const coinId = parseInt(req.params.coinId);

    // Verify the coin exists
    const coinRes = await db.query(
      "SELECT id, contract_address FROM feed_newscoins WHERE id = $1",
      [coinId]
    );
    if (!coinRes.rows.length)
      return res.status(404).json({ error: "coin not found" });

    // Verify the transaction on-chain. txStatus throws when the tx
    // hasn't propagated to the queried RPC yet — common race when the
    // client submits and immediately calls verify. Retry up to 5×2s
    // before giving up so in-flight txs don't get permanently rejected.
    let txResult;
    {
      const MAX_ATTEMPTS = 5;
      const DELAY_MS = 2000;
      let lastErr;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        try {
          txResult = await provider.txStatus(txHash, wallet, "FINAL");
          break;
        } catch (err) {
          lastErr = err;
          if (i < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, DELAY_MS));
        }
      }
      if (!txResult) {
        return res.status(400).json({ error: `Transaction verification failed: ${lastErr?.message || "tx not found"}` });
      }
    }

    const tx = txResult.transaction;
    if (tx.signer_id !== wallet) {
      return res.status(400).json({ error: "signer mismatch" });
    }

    // Extract amounts from FunctionCall actions or Transfer
    const YOCTO = 1_000_000_000_000_000_000_000_000n;
    let nearAmount = 0;
    let tokenAmount = 0;

    // Check for deposit in the tx actions
    for (const action of tx.actions || []) {
      if (action.FunctionCall || action.functionCall) {
        const fc = action.FunctionCall || action.functionCall;
        const deposit = fc.deposit || "0";
        nearAmount += Number(BigInt(deposit) / YOCTO) + Number(BigInt(deposit) % YOCTO) / 1e24;
      }
      if (action.Transfer || action.transfer) {
        const dep = action.Transfer?.deposit || action.transfer?.deposit || "0";
        nearAmount += Number(BigInt(dep) / YOCTO) + Number(BigInt(dep) % YOCTO) / 1e24;
      }
    }

    // Parse token amount from receipt logs if available
    const receiptsOutcome = txResult.receipts_outcome || [];
    for (const ro of receiptsOutcome) {
      for (const log of ro.outcome?.logs || []) {
        // NEP-141 standard event logs
        try {
          if (log.startsWith("EVENT_JSON:")) {
            const evt = JSON.parse(log.slice(11));
            if (evt.event === "ft_transfer" && evt.data?.[0]) {
              tokenAmount += Number(evt.data[0].amount || 0);
            }
          }
        } catch (_) {
          // non-JSON log, skip
        }
      }
    }

    const price = tokenAmount > 0 ? nearAmount / tokenAmount : 0;

    // Dedupe: don't record same tx_hash twice
    const existing = await db.query(
      "SELECT id FROM feed_newscoin_trades WHERE tx_hash = $1",
      [txHash]
    );
    if (existing.rows.length) {
      return res.json({ success: true, trade: existing.rows[0], duplicate: true });
    }

    // Record the trade
    const tradeRes = await db.query(
      `INSERT INTO feed_newscoin_trades (coin_id, trader, trade_type, token_amount, near_amount, price, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [coinId, wallet, type, tokenAmount, nearAmount, price, txHash]
    );

    // Update holdings cache
    if (type === "buy") {
      await db.query(
        `INSERT INTO feed_newscoin_holdings (coin_id, wallet, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT (coin_id, wallet)
         DO UPDATE SET balance = feed_newscoin_holdings.balance + $3`,
        [coinId, wallet, tokenAmount]
      );
    } else {
      await db.query(
        `UPDATE feed_newscoin_holdings
         SET balance = GREATEST(0, balance - $3)
         WHERE coin_id = $1 AND wallet = $2`,
        [coinId, wallet, tokenAmount]
      );
    }

    // Update coin aggregate stats
    await db.query(
      `UPDATE feed_newscoins
       SET volume_24h = volume_24h + $2,
           trade_count = trade_count + 1,
           price = COALESCE(NULLIF($3, 0), price)
       WHERE id = $1`,
      [coinId, nearAmount, price]
    );

    // Record sparkline snapshot
    if (price > 0) {
      await db.query(
        "INSERT INTO feed_newscoin_sparklines (coin_id, price) VALUES ($1, $2)",
        [coinId, price]
      );
    }

    const trade = tradeRes.rows[0];
    res.json({
      success: true,
      trade: {
        id: trade.id,
        trader: trade.trader,
        type: trade.trade_type,
        amount: Number(trade.token_amount),
        price: Number(trade.price),
        nearAmount: Number(trade.near_amount),
        timestamp: trade.created_at,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/newscoin/treasury
// IronClaw Treasury aggregate stats. Powers the /treasury dashboard.
//
// Fee model (matches contract + MintModal disclosures):
//   • 2% creator First-Mover fee (goes to coin creator — NOT treasury)
//   • 1% platform fee            (goes to ironshield.near treasury)
// So treasury revenue per trade = near_amount * 0.01.
// ---------------------------------------------------------------------------
router.get("/treasury", async (_req, res, next) => {
  try {
    if (!ensureDb(res)) return;
    const PLATFORM_FEE = 0.01;
    const CREATOR_FEE  = 0.02;

    // Aggregate stats — split lifetime / 24h / 7d so the dashboard can
    // show revenue velocity.
    const agg = await db.query(`
      SELECT
        COALESCE(SUM(near_amount), 0)::float                          AS vol_lifetime,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours'
                          THEN near_amount ELSE 0 END), 0)::float     AS vol_24h,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '7 days'
                          THEN near_amount ELSE 0 END), 0)::float     AS vol_7d,
        COUNT(*)::int                                                  AS trades_lifetime,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS trades_24h
      FROM feed_newscoin_trades
    `);
    const coinCounts = await db.query(`
      SELECT
        COUNT(*)::int                           AS coins_total,
        COUNT(*) FILTER (WHERE graduated)::int  AS coins_graduated
      FROM feed_newscoins
    `);
    const v = agg.rows[0] || {};
    const c = coinCounts.rows[0] || {};

    // Recent fee events (last 20 platform-fee slices) — used as the
    // revenue feed in the dashboard.
    const recent = await db.query(`
      SELECT t.id, t.trader, t.trade_type, t.near_amount, t.created_at,
             n.ticker, n.name, n.id AS coin_id
      FROM feed_newscoin_trades t
      JOIN feed_newscoins n ON n.id = t.coin_id
      ORDER BY t.created_at DESC
      LIMIT 20
    `);

    const feed = recent.rows.map(r => ({
      id: r.id,
      coinId: r.coin_id,
      ticker: r.ticker,
      name: r.name,
      trader: r.trader,
      side: r.trade_type,
      volume_near: Number(r.near_amount) || 0,
      platform_fee_near: (Number(r.near_amount) || 0) * PLATFORM_FEE,
      creator_fee_near: (Number(r.near_amount) || 0) * CREATOR_FEE,
      timestamp: r.created_at,
    }));

    // Next payout: token holders are distributed weekly (every Sunday 00:00 UTC).
    const now = new Date();
    const next = new Date(now);
    const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7;
    next.setUTCDate(now.getUTCDate() + daysUntilSunday);
    next.setUTCHours(0, 0, 0, 0);

    res.json({
      fees: {
        platform_rate: PLATFORM_FEE,
        creator_rate: CREATOR_FEE,
      },
      revenue_near: {
        lifetime: (Number(v.vol_lifetime) || 0) * PLATFORM_FEE,
        d24h:     (Number(v.vol_24h)      || 0) * PLATFORM_FEE,
        d7d:      (Number(v.vol_7d)       || 0) * PLATFORM_FEE,
      },
      volume_near: {
        lifetime: Number(v.vol_lifetime) || 0,
        d24h:     Number(v.vol_24h)      || 0,
        d7d:      Number(v.vol_7d)       || 0,
      },
      trades: {
        lifetime: Number(v.trades_lifetime) || 0,
        d24h:     Number(v.trades_24h)      || 0,
      },
      coins: {
        total:     Number(c.coins_total)     || 0,
        graduated: Number(c.coins_graduated) || 0,
      },
      payouts: {
        cadence: "weekly",
        next_payout_iso: next.toISOString(),
        distribution: {
          stakers: 0.60,   // 60% → $IRONCLAW stakers
          buybacks: 0.25,  // 25% → token buybacks + burns
          ops: 0.15,       // 15% → protocol operations
        },
      },
      feed,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/newscoin/:coinId/firstmover
// Per-coin First Mover stats — the creator earns 2% of every trade forever.
// ---------------------------------------------------------------------------
router.get("/:coinId/firstmover", async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;
    const coinId = parseInt(req.params.coinId);
    if (!Number.isFinite(coinId)) return res.status(400).json({ error: "bad coinId" });

    const coinRes = await db.query(
      `SELECT c.id, c.name, c.ticker, c.creator, c.mcap_usd, c.graduated, c.created_at,
              u.username, u.display_name, u.pfp_url
       FROM feed_newscoins c
       LEFT JOIN feed_users u ON u.wallet_address = c.creator
       WHERE c.id = $1`,
      [coinId]
    );
    if (!coinRes.rows.length) return res.status(404).json({ error: "coin not found" });
    const coin = coinRes.rows[0];

    const feesRes = await db.query(`
      SELECT
        COALESCE(SUM(near_amount), 0)::float                                                    AS vol_lifetime,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN near_amount ELSE 0 END), 0)::float AS vol_24h,
        COALESCE(SUM(CASE WHEN created_at > NOW() - INTERVAL '7 days'  THEN near_amount ELSE 0 END), 0)::float AS vol_7d,
        COUNT(*)::int AS trades_lifetime
      FROM feed_newscoin_trades WHERE coin_id = $1
    `, [coinId]);
    const v = feesRes.rows[0] || {};

    const recent = await db.query(`
      SELECT id, trader, trade_type, near_amount, created_at
      FROM feed_newscoin_trades
      WHERE coin_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [coinId]);

    res.json({
      coin: {
        id: coin.id,
        name: coin.name,
        ticker: coin.ticker,
        mcap_usd: Number(coin.mcap_usd) || 0,
        lifecycle: lifecycleFor({ mcap_usd: Number(coin.mcap_usd) || 0, graduated: coin.graduated }),
      },
      first_mover: {
        wallet: coin.creator,
        username: coin.username,
        display_name: coin.display_name,
        pfp_url: coin.pfp_url,
        since: coin.created_at,
      },
      earnings_near: {
        lifetime: (Number(v.vol_lifetime) || 0) * CREATOR_FEE_RATE,
        d24h:     (Number(v.vol_24h)      || 0) * CREATOR_FEE_RATE,
        d7d:      (Number(v.vol_7d)       || 0) * CREATOR_FEE_RATE,
      },
      volume_near: {
        lifetime: Number(v.vol_lifetime) || 0,
        d24h:     Number(v.vol_24h)      || 0,
      },
      trades_lifetime: Number(v.trades_lifetime) || 0,
      fee_rate: CREATOR_FEE_RATE,
      recent_trades: recent.rows.map(r => ({
        id: r.id,
        trader: r.trader,
        side: r.trade_type,
        volume_near: Number(r.near_amount) || 0,
        fee_near: (Number(r.near_amount) || 0) * CREATOR_FEE_RATE,
        timestamp: r.created_at,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/newscoin/firstmover/leaderboard
// Top creators by cumulative 2% creator-fee earnings (all coins they launched).
// ---------------------------------------------------------------------------
router.get("/firstmover/leaderboard", async (_req, res, next) => {
  try {
    if (!ensureDb(res)) return;

    const { rows } = await db.query(`
      SELECT
        c.creator                                                                   AS wallet,
        u.username, u.display_name, u.pfp_url,
        COUNT(DISTINCT c.id)::int                                                   AS coins_launched,
        COUNT(DISTINCT c.id) FILTER (WHERE c.graduated)::int                        AS coins_graduated,
        COALESCE(SUM(t.near_amount), 0)::float                                      AS volume_near,
        COALESCE(SUM(CASE WHEN t.created_at > NOW() - INTERVAL '24 hours'
                          THEN t.near_amount ELSE 0 END), 0)::float                 AS volume_24h
      FROM feed_newscoins c
      LEFT JOIN feed_newscoin_trades t ON t.coin_id = c.id
      LEFT JOIN feed_users u           ON u.wallet_address = c.creator
      GROUP BY c.creator, u.username, u.display_name, u.pfp_url
      ORDER BY volume_near DESC
      LIMIT 25
    `);

    res.json({
      fee_rate: CREATOR_FEE_RATE,
      creators: rows.map(r => ({
        wallet: r.wallet,
        username: r.username,
        display_name: r.display_name,
        pfp_url: r.pfp_url,
        coins_launched: Number(r.coins_launched) || 0,
        coins_graduated: Number(r.coins_graduated) || 0,
        earnings_lifetime_near: (Number(r.volume_near) || 0) * CREATOR_FEE_RATE,
        earnings_24h_near:      (Number(r.volume_24h)  || 0) * CREATOR_FEE_RATE,
        volume_lifetime_near:   Number(r.volume_near)  || 0,
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
