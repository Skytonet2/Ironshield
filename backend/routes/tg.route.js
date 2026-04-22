// backend/routes/tg.route.js — Telegram integration endpoints
//
// Exposes:
//   POST /api/tg/link-code   { wallet? } → { code, deepLink }
//   GET  /api/tg/status?wallet=...       → { linked, username, wallets }
//   POST /api/tg/claim       { code, tgId, tgChatId, tgUsername, wallet? }
//   GET  /api/tg/settings/:tgId          → { wallets, activeWallet, settings }
//   POST /api/tg/settings    { tgId, settings?, activeWallet?, wallets? }
//   POST /api/tg/add-wallet  { tgId, wallet }
//   POST /api/tg/remove-wallet { tgId, wallet }
//   POST /api/tg/reply       { tgMsgId, text }  (bot → site DM relay)
//   POST /api/tg/tip         { tgId, toHandle, amountHuman, tokenSymbol }
//   GET  /api/tg/watchlist/:tgId
//   POST /api/tg/watchlist/add   { tgId, kind, value }
//   POST /api/tg/watchlist/remove{ tgId, kind, value }
//   GET  /api/tg/price-alerts/:tgId
//   POST /api/tg/price-alerts/add { tgId, token, op, value, basePrice? }
//   POST /api/tg/price-alerts/remove { id }

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const db = require("../db/client");

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "IronShieldCore_bot";

function newCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ─── link-code: called from website to start the link flow ──────────
router.post("/link-code", async (req, res) => {
  const { wallet } = req.body || {};
  const code = newCode();
  try {
    await db.query(
      "INSERT INTO feed_tg_link_codes (code, wallet) VALUES ($1,$2)",
      [code, wallet || null]
    );
    res.json({
      code,
      deepLink: `https://t.me/${BOT_USERNAME}?start=${code}`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── status: does this wallet already have a TG link? ───────────────
router.get("/status", async (req, res) => {
  const wallet = String(req.query.wallet || "").toLowerCase();
  if (!wallet) return res.json({ linked: false });
  try {
    const u = await db.query(
      "SELECT id FROM feed_users WHERE LOWER(wallet_address)=$1 LIMIT 1",
      [wallet]
    );
    if (!u.rows.length) return res.json({ linked: false });
    const t = await db.query(
      "SELECT tg_username, wallets FROM feed_tg_links WHERE user_id=$1 LIMIT 1",
      [u.rows[0].id]
    );
    if (!t.rows.length) return res.json({ linked: false });
    res.json({
      linked: true,
      username: t.rows[0].tg_username,
      wallets: t.rows[0].wallets || [],
    });
  } catch (e) {
    res.json({ linked: false });
  }
});

// ─── claim: bot calls this after /start <code> ──────────────────────
// If `code` is provided and matches a row with a wallet, we link the
// wallet directly. Otherwise the bot passes the wallet the user sent
// later.
router.post("/claim", async (req, res) => {
  const { code, tgId, tgChatId, tgUsername, wallet } = req.body || {};
  if (!tgId || !tgChatId) return res.status(400).json({ error: "tgId + tgChatId required" });

  let linkedWallet = wallet || null;
  if (code && !linkedWallet) {
    const r = await db.query(
      "UPDATE feed_tg_link_codes SET consumed_at = NOW() WHERE code=$1 AND consumed_at IS NULL RETURNING wallet",
      [code]
    );
    if (r.rows[0]?.wallet) linkedWallet = r.rows[0].wallet;
  }

  let userId = null;
  let wallets = [];
  if (linkedWallet) {
    const u = await db.query(
      `INSERT INTO feed_users (wallet_address)
         VALUES (LOWER($1))
       ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
       RETURNING id`,
      [linkedWallet]
    );
    userId = u.rows[0].id;
    wallets = [linkedWallet.toLowerCase()];
  }

  try {
    const existing = await db.query(
      "SELECT wallets FROM feed_tg_links WHERE tg_id=$1",
      [tgId]
    );
    if (existing.rows.length) {
      // Merge: add new wallet to existing array.
      const merged = Array.from(new Set([...(existing.rows[0].wallets || []), ...wallets].map(w => String(w).toLowerCase())));
      await db.query(
        `UPDATE feed_tg_links
            SET tg_chat_id=$2, tg_username=$3, user_id=COALESCE($4,user_id),
                wallets=$5, active_wallet=COALESCE(active_wallet,$6),
                last_seen_at=NOW()
          WHERE tg_id=$1`,
        [tgId, tgChatId, tgUsername || null, userId, merged, merged[0] || null]
      );
    } else {
      await db.query(
        `INSERT INTO feed_tg_links
          (tg_id, tg_chat_id, tg_username, user_id, wallets, active_wallet, link_code)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tgId, tgChatId, tgUsername || null, userId, wallets, wallets[0] || null, code || null]
      );
    }
    // Provision (or fetch) the custodial bot-trading account so
    // /deposit, /balance, /swap etc. have somewhere to point. Fire-
    // and-forget — a blown DB call here shouldn't fail the /claim.
    try {
      const custodial = require("../services/custodialBotWallet");
      const acct = await custodial.getOrCreateForTgId(tgId);
      res.json({ ok: true, linkedWallet, wallets, custodialAccount: acct.accountId });
      return;
    } catch (custErr) {
      // Missing CUSTODIAL_ENCRYPT_KEY etc. — still surface the link
      // success so the TG flow completes. /deposit will ask the user
      // to re-run when config lands.
      console.warn("[tg/claim] custodial provision skipped:", custErr.message);
    }
    res.json({ ok: true, linkedWallet, wallets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tg/custodial/:tgId — fetch the custodial bot account for
// a TG user. Never returns key material, only the public address.
router.get("/custodial/:tgId", async (req, res) => {
  try {
    const custodial = require("../services/custodialBotWallet");
    const acct = await custodial.getOrCreateForTgId(req.params.tgId);
    res.json({
      accountId: acct.accountId,
      publicKey: acct.publicKey,
      existing: acct.existing,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tg/custodial/:tgId/transfer
// body: { to: string, amountNear: string | null }   (null = drain)
//
// Sends native NEAR from the user's custodial account. Reserves
// GAS_RESERVE_YOCTO so drains don't brick the account below storage.
// Used by both /send and /withdraw — the bot decides which semantic
// to apply client-side (explicit amount vs "drain everything").
router.post("/custodial/:tgId/transfer", async (req, res) => {
  try {
    const tgId = req.params.tgId;
    const { to, amountNear } = req.body || {};
    if (!to) return res.status(400).json({ error: "to required" });

    const custodial = require("../services/custodialBotWallet");
    const acct = await custodial.getOrCreateForTgId(tgId);
    const balYocto = BigInt(await custodial.getBalance(acct.accountId));

    // Resolve the transfer amount.
    let sendYocto;
    if (amountNear == null || amountNear === "all" || amountNear === "max") {
      sendYocto = balYocto - custodial.GAS_RESERVE_YOCTO;
    } else {
      // Scale a human amount (e.g. "0.5") into yocto (10^24). BigInt-safe
      // via a 6-decimal intermediate so Number() precision doesn't bite.
      const n = Number(amountNear);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: "amountNear invalid" });
      const asMicro = BigInt(Math.floor(n * 1_000_000));         // 6-decimal
      sendYocto = asMicro * 10n ** 18n;                          // → yocto
    }
    if (sendYocto <= 0n) {
      return res.status(400).json({
        error: `Not enough balance. You have ${formatNear(balYocto)} NEAR; ${formatNear(custodial.GAS_RESERVE_YOCTO)} NEAR is reserved for storage.`,
      });
    }
    if (sendYocto + custodial.GAS_RESERVE_YOCTO > balYocto) {
      return res.status(400).json({
        error: `Not enough balance. You have ${formatNear(balYocto)} NEAR; need ${formatNear(sendYocto + custodial.GAS_RESERVE_YOCTO)} including reserve.`,
      });
    }

    const { transactions } = require("near-api-js");
    const result = await custodial.sendRawTransaction(tgId, to, [
      transactions.transfer(sendYocto),
    ]);

    res.json({
      ok: true,
      txHash: result.txHash,
      fromAccountId: acct.accountId,
      to,
      amountYocto: sendYocto.toString(),
      amountNear: formatNear(sendYocto),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/tg/custodial/:tgId/swap
// body: {
//   tokenIn:  NEP-141 contract id,
//   tokenOut: NEP-141 contract id,
//   amountBase: string,              // base units of tokenIn
//   slippageBps?: number,             // default 100 = 1%
// }
//
// Swap via Ref Finance on the user's custodial NEAR account. Follows
// the same hand-rolled pattern as src/lib/trading/ref.js: get_return
// for a quote, build ft_transfer_call to the router with the swap
// action payload, 0.2% fee prepended as ft_transfer to
// fees.ironshield.near. Returns the swap tx hash.
router.post("/custodial/:tgId/swap", async (req, res) => {
  try {
    const tgId = req.params.tgId;
    const { tokenIn, tokenOut, amountBase, slippageBps = 100 } = req.body || {};
    if (!tokenIn || !tokenOut || !amountBase) {
      return res.status(400).json({ error: "tokenIn, tokenOut, amountBase required" });
    }

    const custodial = require("../services/custodialBotWallet");
    const acct = await custodial.getOrCreateForTgId(tgId);
    const { connect, keyStores, transactions } = require("near-api-js");

    // Ref Finance quote via view method — anonymous read account.
    const near = await connect({
      networkId: "mainnet",
      nodeUrl: process.env.NEAR_RPC_URL || "https://rpc.fastnear.com",
      keyStore: new keyStores.InMemoryKeyStore(),
    });
    const view = await near.account("anonymous");

    // 1. Find a Ref pool that contains both tokens. We iterate the
    //    user's pair to cover the common case; deep pathfinding can
    //    come later. get_pool_by_ids would be ideal but isn't a view.
    //    Fallback: iterate known-good pools per ticker in a future
    //    migration. For this turn we require the caller to know or
    //    we query Ref's simple routing.
    //
    //    Simpler: use get_return on a guess pool, adjust if needed.
    //    For stablest MVP we pass `pool_id` in the body and let the
    //    bot caller resolve it via search. But the current parser
    //    doesn't know pool IDs...
    //
    //    Pragmatic MVP: require `poolId` in the body. Bot will hit
    //    our /trading/ohlcv discovery to find a pool, or pass the
    //    canonical wrap.near/stablecoin pools. Surface the error
    //    cleanly when poolId is missing so the bot tells the user.
    const poolId = req.body?.poolId;
    if (poolId == null) {
      return res.status(400).json({
        error: "poolId required — the bot's /swap handler should resolve a Ref pool for the token pair before calling.",
      });
    }

    const FEE_BPS = 20;
    const inAmount = BigInt(amountBase);
    const feeAmount = (inAmount * BigInt(FEE_BPS)) / 10_000n;
    const swapAmount = inAmount - feeAmount;

    let estimatedOut;
    try {
      estimatedOut = await view.viewFunction({
        contractId: "v2.ref-finance.near",
        methodName: "get_return",
        args: {
          pool_id: Number(poolId),
          token_in: tokenIn,
          amount_in: swapAmount.toString(),
          token_out: tokenOut,
        },
      });
    } catch (e) {
      return res.status(400).json({ error: `Ref quote failed: ${e.message || e}` });
    }
    if (!estimatedOut || estimatedOut === "0") {
      return res.status(400).json({ error: "Ref returned zero output — pool drained or wrong pair." });
    }
    const mult = BigInt(10_000 - slippageBps);
    const minOut = ((BigInt(estimatedOut) * mult) / 10_000n).toString();

    // Balance check on the user's tokenIn holding.
    const ftBal = BigInt(await custodial.getFtBalance(acct.accountId, tokenIn));
    if (ftBal < inAmount) {
      return res.status(400).json({
        error: `Not enough ${tokenIn}. You have ${ftBal.toString()}, need ${inAmount.toString()} (base units).`,
      });
    }

    // Fire two transactions: ft_transfer(fee) + ft_transfer_call(swap).
    // Two separate sends keep the fee landing even if Ref rejects the
    // swap (preserves our 0.2% on failed attempts — matches the
    // on-chain behavior in src/lib/trading/ref.js).
    const feeReceiver = process.env.PLATFORM_WALLET_NEAR || "fees.ironshield.near";
    const feeTx = await custodial.sendRawTransaction(tgId, tokenIn, [
      transactions.functionCall(
        "ft_transfer",
        {
          receiver_id: feeReceiver,
          amount: feeAmount.toString(),
          memo: "ironshield platform fee (tg bot)",
        },
        "30000000000000",
        "1"
      ),
    ]);

    const swapMsg = JSON.stringify({
      actions: [{
        pool_id: Number(poolId),
        token_in: tokenIn,
        amount_in: swapAmount.toString(),
        token_out: tokenOut,
        min_amount_out: minOut,
      }],
    });
    const swapTx = await custodial.sendRawTransaction(tgId, tokenIn, [
      transactions.functionCall(
        "ft_transfer_call",
        {
          receiver_id: "v2.ref-finance.near",
          amount: swapAmount.toString(),
          msg: swapMsg,
        },
        "180000000000000",
        "1"
      ),
    ]);

    res.json({
      ok: true,
      swapTxHash: swapTx.txHash,
      feeTxHash:  feeTx.txHash,
      estimatedOut,
      minOut,
      amountIn: inAmount.toString(),
      feeAmount: feeAmount.toString(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function formatNear(yocto) {
  const n = BigInt(yocto);
  const whole = n / (10n ** 24n);
  const frac  = (n % (10n ** 24n)).toString().padStart(24, "0").slice(0, 4);
  return `${whole}${frac ? "." + frac.replace(/0+$/, "") : ""}`;
}

// GET /api/tg/custodial/:tgId/balance — native NEAR balance on the
// custodial account. Zero-balance implicit accounts look "not exist"
// to the RPC; treat that as 0 rather than erroring.
router.get("/custodial/:tgId/balance", async (req, res) => {
  try {
    const custodial = require("../services/custodialBotWallet");
    const acct = await custodial.getOrCreateForTgId(req.params.tgId);
    // Lazy-load near-api-js + provider to avoid startup cost when
    // nobody calls this endpoint.
    const { connect, keyStores } = require("near-api-js");
    const near = await connect({
      networkId: "mainnet",
      nodeUrl: process.env.NEAR_RPC_URL || "https://rpc.fastnear.com",
      keyStore: new keyStores.InMemoryKeyStore(),
    });
    let yocto = "0";
    try {
      const a = await near.account(acct.accountId);
      const s = await a.state();
      yocto = s.amount;
    } catch {
      // Implicit account with no balance isn't on-chain yet.
    }
    res.json({
      accountId: acct.accountId,
      balanceYocto: yocto,
      // Convert to NEAR with 4 decimal precision for display.
      balanceNear: (Number(BigInt(yocto) / 10n ** 20n) / 10_000).toFixed(4),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── settings ───────────────────────────────────────────────────────
router.get("/settings/:tgId", async (req, res) => {
  const r = await db.query(
    "SELECT wallets, active_wallet, settings FROM feed_tg_links WHERE tg_id=$1",
    [req.params.tgId]
  );
  if (!r.rows.length) return res.status(404).json({ error: "not linked" });
  res.json({
    wallets: r.rows[0].wallets || [],
    activeWallet: r.rows[0].active_wallet,
    settings: r.rows[0].settings || {},
  });
});

router.post("/settings", async (req, res) => {
  const { tgId, settings, activeWallet, wallets } = req.body || {};
  if (!tgId) return res.status(400).json({ error: "tgId required" });
  try {
    if (settings) {
      await db.query(
        "UPDATE feed_tg_links SET settings = settings || $2::jsonb WHERE tg_id=$1",
        [tgId, JSON.stringify(settings)]
      );
    }
    if (activeWallet) {
      await db.query(
        "UPDATE feed_tg_links SET active_wallet=LOWER($2) WHERE tg_id=$1",
        [tgId, activeWallet]
      );
    }
    if (wallets) {
      await db.query(
        "UPDATE feed_tg_links SET wallets=$2 WHERE tg_id=$1",
        [tgId, wallets.map(w => String(w).toLowerCase())]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/add-wallet", async (req, res) => {
  const { tgId, wallet } = req.body || {};
  if (!tgId || !wallet) return res.status(400).json({ error: "tgId + wallet required" });
  const w = String(wallet).toLowerCase();
  try {
    const u = await db.query(
      `INSERT INTO feed_users (wallet_address) VALUES ($1)
        ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
        RETURNING id`,
      [w]
    );
    await db.query(
      `UPDATE feed_tg_links
          SET wallets = ARRAY(SELECT DISTINCT UNNEST(wallets || ARRAY[$2])),
              active_wallet = COALESCE(active_wallet, $2),
              user_id = COALESCE(user_id, $3),
              last_seen_at = NOW()
        WHERE tg_id=$1`,
      [tgId, w, u.rows[0].id]
    );
    const r = await db.query("SELECT wallets, active_wallet FROM feed_tg_links WHERE tg_id=$1", [tgId]);
    res.json({ ok: true, wallets: r.rows[0]?.wallets || [], activeWallet: r.rows[0]?.active_wallet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/remove-wallet", async (req, res) => {
  const { tgId, wallet } = req.body || {};
  const w = String(wallet || "").toLowerCase();
  try {
    await db.query(
      `UPDATE feed_tg_links
          SET wallets = ARRAY_REMOVE(wallets, $2),
              active_wallet = CASE WHEN active_wallet=$2 THEN NULL ELSE active_wallet END
        WHERE tg_id=$1`,
      [tgId, w]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Reply relay: bot posts the user's TG reply into feed_dm_messages ──
router.post("/reply", async (req, res) => {
  const { tgMsgId, text } = req.body || {};
  if (!tgMsgId || !text) return res.status(400).json({ error: "tgMsgId + text required" });
  try {
    const map = await db.query(
      "SELECT conversation_id, user_id FROM feed_tg_reply_map WHERE tg_msg_id=$1",
      [tgMsgId]
    );
    if (!map.rows.length) return res.status(404).json({ error: "no conversation for message" });
    const { conversation_id, user_id } = map.rows[0];
    // Insert into feed_dm_messages. We store ciphertext = plain text
    // with an "unencrypted" flag so the site renders it as a Telegram
    // bridge message. The site already handles a "plain" body.
    await db.query(
      `INSERT INTO feed_dm_messages (conversation_id, sender_id, ciphertext, nonce, sender_pub, created_at)
       VALUES ($1, $2, $3, '', '', NOW())`,
      [conversation_id, user_id, JSON.stringify({ plain: text, via: "telegram" })]
    ).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Watchlist ──────────────────────────────────────────────────────
router.get("/watchlist/:tgId", async (req, res) => {
  const r = await db.query(
    "SELECT id, kind, value, created_at FROM feed_tg_watchlist WHERE tg_id=$1 ORDER BY created_at DESC",
    [req.params.tgId]
  );
  res.json({ items: r.rows });
});

router.post("/watchlist/add", async (req, res) => {
  const { tgId, kind, value } = req.body || {};
  if (!tgId || !kind || !value) return res.status(400).json({ error: "tgId+kind+value required" });
  try {
    await db.query(
      "INSERT INTO feed_tg_watchlist (tg_id, kind, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [tgId, kind, value]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/watchlist/remove", async (req, res) => {
  const { tgId, kind, value } = req.body || {};
  try {
    await db.query(
      "DELETE FROM feed_tg_watchlist WHERE tg_id=$1 AND kind=$2 AND value=$3",
      [tgId, kind, value]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Price alerts ───────────────────────────────────────────────────
router.get("/price-alerts/:tgId", async (req, res) => {
  const r = await db.query(
    "SELECT id, token, op, value, base_price, active, created_at FROM feed_tg_price_alerts WHERE tg_id=$1 ORDER BY id DESC",
    [req.params.tgId]
  );
  res.json({ alerts: r.rows });
});

router.post("/price-alerts/add", async (req, res) => {
  const { tgId, token, op, value, basePrice } = req.body || {};
  if (!tgId || !token || !op || value == null) return res.status(400).json({ error: "tgId+token+op+value required" });
  try {
    const r = await db.query(
      `INSERT INTO feed_tg_price_alerts (tg_id, token, op, value, base_price)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tgId, String(token).toUpperCase(), op, value, basePrice || null]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/price-alerts/remove", async (req, res) => {
  const { id } = req.body || {};
  try {
    await db.query("UPDATE feed_tg_price_alerts SET active=FALSE WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
