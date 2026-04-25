// backend/routes/trading.route.js
//
// Trading read endpoints. Today just OHLCV for NEAR. Solana stays on
// the client-side GeckoTerminal path for now. When swap execution
// lands in Phase 3B, position + fee writes land here too.

const express = require("express");
const router = express.Router();
const ohlcvService = require("../services/ohlcvService");
const db = require("../db/client");
const requireWallet = require("../middleware/requireWallet");

// GET /api/trading/ohlcv?chain=near&pool=X&timeframe=1h&limit=300
// Returns: { source: 'newscoin' | 'ref', candles: [{time, open, high, low, close, volume}] }
router.get("/ohlcv", async (req, res) => {
  const chain     = String(req.query.chain || "").toLowerCase();
  const pool      = String(req.query.pool || "").trim();
  const timeframe = String(req.query.timeframe || "1h");
  const limit     = Number(req.query.limit) || 300;

  if (!pool) return res.status(400).json({ error: "pool required" });

  try {
    if (chain === "near") {
      const out = await ohlcvService.getNearOhlcv({ pool, timeframe, limit });
      return res.json(out);
    }
    // Solana stays on GeckoTerminal client-side until Tier 3 budget
    // clears. We could proxy/cache GT here to paper over rate limits,
    // but that's premature until a second chain needs the same path.
    return res.status(400).json({ error: `chain '${chain}' not served by backend yet` });
  } catch (e) {
    return res.status(500).json({ error: e.message || "ohlcv failed" });
  }
});

/* ── GET /positions — list positions for a wallet ────────────────
 *
 * Paginated DESC by created_at. `open=1` restricts to positions the
 * user hasn't closed (closed_at IS NULL) — the UI wants that by
 * default; the history tab passes open=0 for closed rows too. Wallet
 * scoping is case-insensitive because Solana uses mixed-case base58
 * and we've seen a Privy quirk return the same address in different
 * casings on refresh.
 */
router.get("/positions", async (req, res) => {
  const wallet = String(req.query.wallet || "").trim();
  const chain  = String(req.query.chain  || "").trim();
  const open   = req.query.open !== "0";
  const limit  = Math.min(Number(req.query.limit) || 50, 200);
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  try {
    const clauses = ["LOWER(wallet) = LOWER($1)"];
    const params = [wallet];
    if (chain) { clauses.push(`chain = $${params.length + 1}`); params.push(chain); }
    if (open)  { clauses.push("closed_at IS NULL"); }
    const sql =
      `SELECT id, wallet, chain, token_address, token_symbol, token_decimals,
              amount_base::text AS amount_base,
              entry_price_usd, cost_basis_usd, entry_tx_hash,
              closed_at, close_price_usd, realized_pnl_usd, close_tx_hash,
              created_at
         FROM trade_positions
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ${limit}`;
    const r = await db.query(sql, params);
    res.json({ positions: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /positions — log an open trade ──────────────────────────
 *
 * Called from the client right after a swap confirms. Body is the
 * camelCased TradeResult shape produced by src/lib/trading/execute.js.
 * We accept string amounts (NUMERIC(40,0) in schema) so big integers
 * survive JSON serialisation losslessly.
 *
 * Returns the inserted row's id. Soft-fails on partial data — the
 * client calls this fire-and-forget so a DB hiccup never blocks a
 * confirmed on-chain swap.
 */
router.post("/positions", requireWallet, async (req, res) => {
  const b = req.body || {};
  // Override any client-supplied wallet field with the verified signer.
  // Day 1.4 mandate: never trust a client-asserted wallet identifier.
  b.wallet = req.wallet;
  if (!b.chain || !b.token_address || !b.amount_base) {
    return res.status(400).json({ error: "chain, token_address, amount_base required" });
  }
  try {
    const r = await db.query(
      `INSERT INTO trade_positions (
         wallet, chain, token_address, token_symbol, token_decimals,
         amount_base, entry_price_usd, cost_basis_usd, entry_tx_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        b.wallet, b.chain, b.token_address, b.token_symbol || "",
        b.token_decimals || 0,
        String(b.amount_base),
        Number(b.entry_price_usd) || 0,
        Number(b.cost_basis_usd)  || 0,
        b.entry_tx_hash || null,
      ]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /fees — log a collected platform fee ────────────────────
 *
 * Same fire-and-forget semantics as /positions. fee_tx_hash equal to
 * swap_tx_hash means the fee landed atomically inside the swap tx
 * (Jupiter's platformFeeBps path). A null fee_tx_hash means the fee
 * transfer is still in flight — the later reconciler picks it up.
 */
router.post("/fees", requireWallet, async (req, res) => {
  const b = req.body || {};
  b.wallet = req.wallet;
  if (!b.chain || !b.platform_wallet || !b.amount_in_base) {
    return res.status(400).json({ error: "chain, platform_wallet, amount_in_base required" });
  }
  try {
    const r = await db.query(
      `INSERT INTO trade_fees (
         wallet, chain, token_in, token_out,
         amount_in_base, fee_amount_base, fee_amount_usd,
         swap_tx_hash, fee_tx_hash, platform_wallet
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        b.wallet, b.chain,
        b.token_in  || "",
        b.token_out || "",
        String(b.amount_in_base),
        String(b.fee_amount_base || 0),
        Number(b.fee_amount_usd) || 0,
        b.swap_tx_hash || null,
        b.fee_tx_hash  || null,
        b.platform_wallet,
      ]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
