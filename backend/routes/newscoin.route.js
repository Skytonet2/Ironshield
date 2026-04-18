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

const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.fastnear.com";
const provider = new providers.JsonRpcProvider({ url: RPC_URL });

const AI_ENDPOINT = process.env.NEAR_AI_ENDPOINT || "https://cloud-api.near.ai/v1/chat/completions";
const AI_KEY = process.env.NEAR_AI_KEY || "";
const AI_MODEL = process.env.NEAR_AI_MODEL || "Qwen/Qwen3-30B-A3B-Instruct-2507";

const FEE_WAIVED = new Set(["skyto.near"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      return {
        id: r.id,
        storyId: r.story_id,
        name: r.name,
        ticker: r.ticker,
        creator: r.creator,
        mcap: Number(r.mcap),
        mcapUsd: Number(r.mcap_usd),
        price: Number(r.price),
        priceNear: Number(r.price),
        volume24h: Number(r.volume_24h),
        change24h: 0, // TODO: compute from sparkline
        age: `${Math.round(ageHours)}h`,
        tradeCount: r.trade_count,
        graduated: r.graduated,
        sparkline: sparkMap[r.id] || [],
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

    // Bonding curve segments derived from current price / mcap
    // In the future this can read from a dedicated curve-config table.
    const currentSegments = [
      { from: 0, to: 1000, pricePerToken: Number(coin.price) * 0.5 },
      { from: 1000, to: 10000, pricePerToken: Number(coin.price) * 0.8 },
      { from: 10000, to: 100000, pricePerToken: Number(coin.price) },
    ];

    // TODO: pending curve updates will come from governance proposals
    res.json({
      currentSegments,
      pendingUpdate: null,
      lastUpdateAt: coin.created_at,
      cooldownEndsAt: null,
      transitionProgress: null,
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

    const coins = rows.map((r) => ({
      id: r.id,
      name: r.name,
      ticker: r.ticker,
      mcap: Number(r.mcap),
      holdings: Number(r.holdings),
      claimableFees: 0, // TODO: compute from trade fee accumulator
    }));

    // Total PnL is placeholder until we track cost basis
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
router.post("/suggest", async (req, res, next) => {
  try {
    const { headline } = req.body || {};
    if (!headline) return res.status(400).json({ error: "headline required" });

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
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/newscoin/:coinId/verify-trade
// ---------------------------------------------------------------------------
router.post("/:coinId/verify-trade", async (req, res, next) => {
  try {
    if (!ensureDb(res)) return;

    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "wallet required" });

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

    // Verify the transaction on-chain
    let txResult;
    try {
      txResult = await provider.txStatus(txHash, wallet, "FINAL");
    } catch (err) {
      return res.status(400).json({ error: `Transaction verification failed: ${err.message}` });
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

module.exports = router;
