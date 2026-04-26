// backend/routes/tg.route.js — Telegram integration endpoints
//
// Two distinct callers:
//   1. The website (signed-auth via requireWallet) — only /link-code
//      and /status. Both narrow surfaces a logged-in user can hit.
//   2. The bot worker (HMAC-auth via requireBotSig) — every other
//      route. The bot relays user input from Telegram into the
//      backend; the HMAC gate ensures only bot/services/backend.js
//      (which holds the shared secret) can hit these endpoints.
//
// Day 9 hardening was deferred and the routes shipped public, which
// allowed: custodial wallet drains, DM eavesdropping (claim/add-wallet
// upserting the caller's user_id to a victim's), and DM identity theft
// (anyone could /reply into anyone's conversation). All closed here.

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const db = require("../db/client");
const requireWallet = require("../middleware/requireWallet");
const requireBotSig = require("../middleware/requireBotSig");

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "IronShieldCore_bot";

function newCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ─── link-code: called from website by an authenticated wallet ──────
// The wallet identity comes from the NEP-413 signature on this
// request, NOT from the body. The body's `wallet` field used to be
// trusted — that allowed anyone to mint a code for any wallet, which
// /claim then trusted as proof of ownership. Locked: only req.wallet.
router.post("/link-code", requireWallet, async (req, res) => {
  const code = newCode();
  try {
    await db.query(
      "INSERT INTO feed_tg_link_codes (code, wallet) VALUES ($1,$2)",
      [code, req.wallet]
    );
    res.json({
      code,
      deepLink: `https://t.me/${BOT_USERNAME}?start=${code}`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── status: TG link status for the connected wallet. Wallet comes
// from the signed request, not query params — anyone with curl could
// otherwise probe any wallet's TG settings.
router.get("/status", requireWallet, async (req, res) => {
  const wallet = String(req.wallet || "").toLowerCase();
  if (!wallet) return res.json({ linked: false });
  try {
    const u = await db.query(
      "SELECT id FROM feed_users WHERE LOWER(wallet_address)=$1 LIMIT 1",
      [wallet]
    );
    if (!u.rows.length) return res.json({ linked: false });
    // Include tg_id + settings so the Settings → Telegram tab on the
    // web frontend can render + edit prefs in one round-trip instead
    // of chaining status → settings/:tgId.
    const t = await db.query(
      "SELECT tg_id, tg_username, wallets, settings FROM feed_tg_links WHERE user_id=$1 LIMIT 1",
      [u.rows[0].id]
    );
    if (!t.rows.length) return res.json({ linked: false });
    res.json({
      linked: true,
      tgId:     String(t.rows[0].tg_id),
      username: t.rows[0].tg_username,
      wallets:  t.rows[0].wallets || [],
      settings: t.rows[0].settings || {},
    });
  } catch (e) {
    res.json({ linked: false });
  }
});

// All routes below are bot-callable only. router.use(requireBotSig)
// gates every handler defined after this line — individual per-route
// requireBotSig calls left in place for readability are redundant
// but harmless (the middleware passes a second time).
router.use(requireBotSig);

// ─── claim: bot calls this after /start <code> OR after the user
// pastes a wallet directly ──────────────────────────────────────────
//
// Two paths now:
//   A. WITH `code` (the website-signed flow) — full link: sets
//      user_id, enables private DM / notification fan-out, mints the
//      custodial bot account.
//   B. WITHOUT `code`, just `wallet` — watch-only fallback for the
//      bot's "paste your wallet" UX. Adds the wallet to the TG row's
//      wallets[] for read-only price/feed alerts. Crucially does NOT
//      set user_id — that's the eavesdropping leak the original
//      implementation had. No proof of ownership, no private fan-out.
router.post("/claim", requireBotSig, async (req, res) => {
  const { code, tgId, tgChatId, tgUsername, wallet: pastedWallet } = req.body || {};
  if (!tgId || !tgChatId) return res.status(400).json({ error: "tgId + tgChatId required" });

  // Path B — watch-only paste. Returns a partial-link response so the
  // bot can tell the user "tracking, but link a code from the
  // website for full features".
  if (!code) {
    if (!pastedWallet) {
      // No code, no wallet — onboarding /start with no payload. Just
      // create the empty TG row + custodial account so future flows
      // have a row to update. No wallet associated yet.
      try {
        await db.query(
          `INSERT INTO feed_tg_links (tg_id, tg_chat_id, tg_username, last_seen_at)
             VALUES ($1, $2, $3, NOW())
           ON CONFLICT (tg_id) DO UPDATE SET
             tg_chat_id = EXCLUDED.tg_chat_id,
             tg_username = EXCLUDED.tg_username,
             last_seen_at = NOW()`,
          [tgId, tgChatId, tgUsername || null]
        );
        let custodialAccount = null;
        try {
          const custodial = require("../services/custodialBotWallet");
          const acct = await custodial.getOrCreateForTgId(tgId);
          custodialAccount = acct.accountId;
        } catch (e) {
          console.warn("[tg/claim] custodial skipped:", e.message);
        }
        return res.json({ ok: true, custodialAccount });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    // Watch-only: wallet pasted, no code → tracking only.
    const w = String(pastedWallet).toLowerCase();
    try {
      await db.query(
        `INSERT INTO feed_tg_links (tg_id, tg_chat_id, tg_username, wallets, active_wallet, last_seen_at)
           VALUES ($1, $2, $3, ARRAY[$4], $4, NOW())
         ON CONFLICT (tg_id) DO UPDATE SET
           tg_chat_id = EXCLUDED.tg_chat_id,
           tg_username = EXCLUDED.tg_username,
           wallets = ARRAY(SELECT DISTINCT UNNEST(feed_tg_links.wallets || EXCLUDED.wallets)),
           active_wallet = COALESCE(feed_tg_links.active_wallet, EXCLUDED.active_wallet),
           last_seen_at = NOW()`,
        [tgId, tgChatId, tgUsername || null, w]
      );
      let custodialAccount = null;
      try {
        const custodial = require("../services/custodialBotWallet");
        const acct = await custodial.getOrCreateForTgId(tgId);
        custodialAccount = acct.accountId;
      } catch (e) {
        console.warn("[tg/claim] custodial skipped:", e.message);
      }
      // linkedWallet returned so the existing bot's success branch
      // fires the "you're linked" message — accurate for watch-only
      // tracking. Ownership proof message can come in a later bot
      // deploy that distinguishes watch-only vs full.
      return res.json({ ok: true, linkedWallet: w, wallets: [w], watchOnly: true, custodialAccount });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Path A — code-based full link. Atomically consume the code.
  const codeRow = await db.query(
    "UPDATE feed_tg_link_codes SET consumed_at = NOW() WHERE code=$1 AND consumed_at IS NULL RETURNING wallet",
    [code]
  );
  if (!codeRow.rows.length) return res.status(401).json({ error: "invalid or already-used code", code: "bad-code" });
  const linkedWallet = codeRow.rows[0].wallet;
  if (!linkedWallet) {
    // Pre-hardening codes were created without a wallet (anonymous
    // /link-code). Refuse — the bot must walk the user back to the
    // website to mint a fresh, signed code.
    return res.status(401).json({ error: "code is missing wallet ownership proof; mint a new one from the website", code: "anonymous-code" });
  }

  const u = await db.query(
    `INSERT INTO feed_users (wallet_address)
       VALUES (LOWER($1))
     ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
     RETURNING id`,
    [linkedWallet]
  );
  const userId = u.rows[0].id;
  const wallets = [linkedWallet.toLowerCase()];

  try {
    const existing = await db.query(
      "SELECT wallets FROM feed_tg_links WHERE tg_id=$1",
      [tgId]
    );
    if (existing.rows.length) {
      // Merge: add the just-claimed wallet. user_id is set
      // authoritatively to the freshly verified wallet's user, NOT
      // COALESCE — a legit re-link must overwrite any stale user_id
      // from the pre-hardening days. link_code is also stamped so
      // the migration's "nullify rows with NULL link_code" check
      // recognises this row as legitimately re-linked.
      const merged = Array.from(new Set([...(existing.rows[0].wallets || []), ...wallets].map(w => String(w).toLowerCase())));
      await db.query(
        `UPDATE feed_tg_links
            SET tg_chat_id=$2, tg_username=$3, user_id=$4,
                wallets=$5, active_wallet=$6, link_code=$7,
                last_seen_at=NOW()
          WHERE tg_id=$1`,
        [tgId, tgChatId, tgUsername || null, userId, merged, linkedWallet.toLowerCase(), code]
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

// ──────────────────────────────────────────────────────────────
// Agent action layer (Phase 7-4)
//
// Free-form messages that parseIntent didn't catch route here. The
// agent proposes an action; we return it to the bot WITH a pending
// token the bot uses to execute after the user confirms in TG.
//
// Pending actions live in an in-process Map with a 2-minute TTL so a
// stale "yes" from 10 minutes ago doesn't accidentally fire a swap.
// Single-node only — if we multi-node the backend, promote to Redis
// or a DB table. For today's scale this is fine.
// ──────────────────────────────────────────────────────────────

const PENDING_TTL_MS = 2 * 60_000;
const pendingActions = new Map();  // tgId → { token, action, params, createdAt }

function savePending(tgId, action, params) {
  const token = require("crypto").randomBytes(16).toString("hex");
  pendingActions.set(String(tgId), {
    token, action, params, createdAt: Date.now(),
  });
  return token;
}
function takePending(tgId, token) {
  const key = String(tgId);
  const hit = pendingActions.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > PENDING_TTL_MS) {
    pendingActions.delete(key);
    return null;
  }
  if (token && hit.token !== token) return null;
  pendingActions.delete(key);
  return hit;
}

// POST /api/tg/agent
//   body: { tgId, message }
// Returns one of:
//   { kind:"reply",    reply }                       pure chat
//   { kind:"action",   action, params, confirm, pendingToken }
//                                                  action proposal
// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
router.post("/agent", async (req, res) => {
  try {
    const { tgId, message } = req.body || {};
    if (!tgId || !message) return res.status(400).json({ error: "tgId + message required" });

    const ironclaw = require("../services/ironclawClient");
    const tools    = require("../services/agentTools");

    const { reply } = await ironclaw.chat({
      content: String(message).slice(0, 1500),
      systemPrompt: tools.systemPrompt(),
      timeoutMs: 20_000,
    }).catch((e) => ({ reply: null, error: e.message }));

    if (!reply) {
      return res.json({
        kind: "reply",
        reply: "Agent is unreachable right now — use /help to see explicit commands.",
      });
    }

    const parsed = tools.parseAgentReply(reply);
    if (parsed.kind === "reply") {
      return res.json(parsed);
    }

    // Stash the action for confirmation. Returning `pendingToken`
    // means the bot can call /agent/confirm with the token after
    // the user replies "yes" — without re-trusting the LLM output
    // on the second turn.
    const pendingToken = savePending(tgId, parsed.action, parsed.params);
    return res.json({
      kind: "action",
      action:  parsed.action,
      params:  parsed.params,
      confirm: parsed.confirm,
      pendingToken,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tg/agent/confirm
//   body: { tgId, pendingToken }
// Looks up the pending action, executes it against the existing
// action endpoints, returns the execution result as-is. The action
// is consumed on match (single-fire).
// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
router.post("/agent/confirm", async (req, res) => {
  try {
    const { tgId, pendingToken } = req.body || {};
    if (!tgId) return res.status(400).json({ error: "tgId required" });
    const hit = takePending(tgId, pendingToken);
    if (!hit) {
      return res.status(410).json({ error: "No pending action (expired or already consumed)." });
    }

    // Dispatch. We do NOT invoke the Express handlers directly;
    // instead we duplicate the minimal orchestration so the agent
    // path is auditable on its own. Validation (activation, balance,
    // amounts) still lives in the action-execution endpoints — we
    // call them over HTTP so every code path goes through the same
    // gates.
    const tools = require("../services/agentTools");
    const backendUrl = `http://localhost:${process.env.BACKEND_PORT || 3001}`;
    const post = (path, body) => fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    switch (hit.action) {
      case "swap": {
        const { amount, fromTicker, toTicker } = hit.params;
        const originAsset      = tools.SWAP_TICKER_MAP[(fromTicker || "").toLowerCase()];
        const destinationAsset = tools.SWAP_TICKER_MAP[(toTicker   || "").toLowerCase()];
        if (!originAsset || !destinationAsset) {
          return res.status(400).json({ error: `Unknown ticker: ${!originAsset ? fromTicker : toTicker}` });
        }
        // Delegate amount scaling to the bot — it knows the token's
        // decimals + does the USD→token lookup. The agent-confirm
        // path expects the bot to POST /swap directly after this
        // returns success=true. So we just return the normalized
        // params; the bot handles execution + response formatting.
        return res.json({
          ok: true,
          execute: "swap",
          args: {
            originAsset, destinationAsset,
            amount,
            fromTicker, toTicker,
          },
        });
      }
      case "send": {
        return res.json({
          ok: true,
          execute: "send",
          args: hit.params,
        });
      }
      case "withdraw": {
        return res.json({
          ok: true,
          execute: "withdraw",
          args: hit.params,
        });
      }
      case "balance":
      case "deposit":
      case "activate":
        return res.json({ ok: true, execute: hit.action, args: {} });
      default:
        return res.status(400).json({ error: `Unknown action: ${hit.action}` });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────────────────────
// Activation gate
// ──────────────────────────────────────────────────────────────
//
// Bot trading is paywalled: users pay a one-time $5 NEAR fee to
// fees.ironshield.near before /swap, /send, /withdraw unlock. The
// fee covers IronClaw LLM + infra usage — agent calls aren't free
// and we don't want abandoned accounts spending our budget.
//
// Price resolution: CoinGecko simple/price for near/usd at the time
// of the /activate call. The user sees the USD-denominated
// confirmation; the NEAR amount is what actually moves. Stamped
// permanently in activation_near so we can prove what each user
// paid.

const ACTIVATION_USD = 5;
const FEE_WALLET = () =>
  process.env.PLATFORM_WALLET_NEAR ||
  process.env.BRIDGE_FEE_RECIPIENT  ||
  "fees.ironshield.near";

async function fetchNearUsd() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
  const j = await r.json();
  const px = j?.near?.usd;
  if (!px || !Number.isFinite(px)) throw new Error("No NEAR/USD price");
  return Number(px);
}

async function isActivated(tgId) {
  const r = await db.query(
    "SELECT activated_at FROM feed_tg_links WHERE tg_id = $1",
    [tgId]
  );
  return !!r.rows[0]?.activated_at;
}

async function requireActivation(tgId, res) {
  if (await isActivated(tgId)) return true;
  res.status(402).json({
    error: "Bot trading is locked. Pay a one-time $5 activation fee with /activate to unlock /swap, /send, and /withdraw. The fee covers IronClaw agent infra.",
    code: "not_activated",
  });
  return false;
}

// POST /api/tg/custodial/:tgId/activate
//   body: { confirm?: boolean }  confirm=true executes; default is
//   a dry-preview returning { preparedNear, usd } so the bot can show
//   the user the exact NEAR amount to approve.
// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
router.post("/custodial/:tgId/activate", async (req, res) => {
  try {
    const tgId = req.params.tgId;
    const { confirm } = req.body || {};
    if (await isActivated(tgId)) {
      return res.json({ ok: true, alreadyActivated: true });
    }

    const nearUsd = await fetchNearUsd();
    const nearAmount = ACTIVATION_USD / nearUsd;        // float — fine for display
    const yoctoFloat = nearAmount * 1e24;
    // BigInt-safe: scale through 6 decimals to survive float precision.
    const yocto = BigInt(Math.floor(nearAmount * 1_000_000)) * 10n ** 18n;

    if (!confirm) {
      return res.json({
        needsConfirm: true,
        usd: ACTIVATION_USD,
        nearAmount: nearAmount.toFixed(4),
        nearUsdPrice: nearUsd.toFixed(4),
        feeRecipient: FEE_WALLET(),
      });
    }

    // Balance check so a failed activation gives a clear message
    // instead of an on-chain reject.
    const custodial = require("../services/custodialBotWallet");
    const acct = await custodial.getOrCreateForTgId(tgId);
    const bal = BigInt(await custodial.getBalance(acct.accountId));
    if (bal < yocto + custodial.GAS_RESERVE_YOCTO) {
      return res.status(400).json({
        error: `Not enough NEAR. Need ${nearAmount.toFixed(4)} + 0.05 reserve = ${(nearAmount + 0.05).toFixed(4)} NEAR. You have ${formatNear(bal)}. Run /deposit to fund.`,
      });
    }

    const { transactions } = require("near-api-js");
    const tx = await custodial.sendRawTransaction(tgId, FEE_WALLET(), [
      transactions.transfer(yocto),
    ]);

    await db.query(
      `UPDATE feed_tg_links
          SET activated_at = NOW(),
              activated_tx_hash = $2,
              activation_near   = $3,
              activation_usd    = $4
        WHERE tg_id = $1`,
      [tgId, tx.txHash, nearAmount, ACTIVATION_USD]
    );

    res.json({
      ok: true,
      txHash: tx.txHash,
      paidNear: nearAmount.toFixed(4),
      usd: ACTIVATION_USD,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/tg/custodial/:tgId/transfer
// body: { to: string, amountNear: string | null }   (null = drain)
//
// Sends native NEAR from the user's custodial account. Reserves
// GAS_RESERVE_YOCTO so drains don't brick the account below storage.
// Used by both /send and /withdraw — the bot decides which semantic
// to apply client-side (explicit amount vs "drain everything").
// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
router.post("/custodial/:tgId/transfer", async (req, res) => {
  try {
    const tgId = req.params.tgId;
    if (!(await requireActivation(tgId, res))) return;
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
//   originAsset:      NEAR Intents assetId (e.g. "nep141:sol.omft.near")
//   destinationAsset: NEAR Intents assetId
//   amountBase:       string        (base units of originAsset)
//   recipient?:       string        (defaults to custodial — for
//                                    same-chain swaps back onto the
//                                    custodial; pass an external
//                                    address for cross-chain "send
//                                    to my Phantom" style swaps)
//   slippageBps?:     number        (default 100 = 1%)
// }
//
// All swaps flow through NEAR Intents (1click chaindefuser). No
// DEX-specific pool resolution; no Ref; no separate cross-chain
// handler. The solver handles every pair — NEP-141↔NEP-141 on NEAR,
// NEP-141→native on another chain, native→NEP-141 in — in one shape.
//
// 0.2% platform fee is stamped via 1click's appFees field so it
// lands atomically inside the solver's settlement. No separate
// ft_transfer.
// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
router.post("/custodial/:tgId/swap", async (req, res) => {
  try {
    const tgId = req.params.tgId;
    if (!(await requireActivation(tgId, res))) return;
    const {
      originAsset, destinationAsset, amountBase,
      slippageBps = 100, recipient,
    } = req.body || {};
    if (!originAsset || !destinationAsset || !amountBase) {
      return res.status(400).json({
        error: "originAsset, destinationAsset, amountBase required",
      });
    }

    const custodial = require("../services/custodialBotWallet");
    const acct = await custodial.getOrCreateForTgId(tgId);

    // Balance check on the user's originAsset. Implicit accounts can
    // only swap from NEP-141s they actually hold.
    const ftContract = originAsset.startsWith("nep141:")
      ? originAsset.slice("nep141:".length)
      : originAsset;
    const haveBase = BigInt(await custodial.getFtBalance(acct.accountId, ftContract));
    const needBase = BigInt(amountBase);
    if (haveBase < needBase) {
      return res.status(400).json({
        error: `Not enough ${ftContract}. You have ${haveBase.toString()}, need ${needBase.toString()} (base units).`,
      });
    }

    // 1click non-dry quote → deposit address. Uses the same
    // /api/bridge/submit flow as the web bridge but with our
    // custodial as both refund + recipient (unless caller overrides
    // recipient, e.g. for cross-chain send to a Solana wallet).
    const submitUrl = `http://localhost:${process.env.BACKEND_PORT || 3001}/api/bridge/submit`;
    const qRes = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originAsset,
        destinationAsset,
        amount: needBase.toString(),
        slippageBps,
        recipient: recipient || acct.accountId,
        refundTo:  acct.accountId,
      }),
    });
    const quote = await qRes.json().catch(() => ({}));
    if (!qRes.ok) {
      return res.status(qRes.status).json({
        error: quote.error || `Quote failed (${qRes.status})`,
      });
    }
    const depositAddress = quote?.quote?.depositAddress;
    const amountOut      = quote?.quote?.amountOut;
    const minOut         = quote?.quote?.minAmountOut;
    if (!depositAddress) {
      return res.status(502).json({ error: "1click didn't return a deposit address" });
    }

    // Single on-chain action: ft_transfer from the user's custodial
    // to the deposit address. 1click solver picks up the deposit,
    // executes the swap (possibly cross-chain), and delivers to
    // `recipient`. Our 0.2% appFee is stamped server-side in the
    // bridge route, so no second fee tx here.
    const { transactions } = require("near-api-js");
    const swapTx = await custodial.sendRawTransaction(tgId, ftContract, [
      transactions.functionCall(
        "ft_transfer",
        {
          receiver_id: depositAddress,
          amount: needBase.toString(),
          memo: "ironshield bot swap",
        },
        "30000000000000",
        "1"
      ),
    ]);

    res.json({
      ok: true,
      swapTxHash: swapTx.txHash,
      depositAddress,
      estimatedOut: amountOut,
      minOut,
      amountIn: needBase.toString(),
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

// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
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

// /add-wallet — watch-only.
//
// Adds a wallet to this TG account's `wallets[]` array for read-only
// price/feed alerts. Crucially, this does NOT touch `user_id` — that
// would route the wallet's private DM/notification fan-out to this
// TG, which is the eavesdropping vector. The previous implementation
// did `user_id = COALESCE(user_id, $3)` and upserted feed_users, so
// any TG could "track" any wallet and start receiving its private
// notifications. Locked.
//
// To actually own a wallet (DM fan-out, custodial wallet bound to it),
// use /link-code on the website + /start <code> in TG → /claim.
router.post("/add-wallet", requireBotSig, async (req, res) => {
  const { tgId, wallet } = req.body || {};
  if (!tgId || !wallet) return res.status(400).json({ error: "tgId + wallet required" });
  const w = String(wallet).toLowerCase();
  try {
    const upd = await db.query(
      `UPDATE feed_tg_links
          SET wallets = ARRAY(SELECT DISTINCT UNNEST(wallets || ARRAY[$2])),
              last_seen_at = NOW()
        WHERE tg_id=$1
        RETURNING wallets, active_wallet`,
      [tgId, w]
    );
    if (!upd.rows.length) {
      return res.status(404).json({ error: "tgId not linked — /start the bot first", code: "no-link" });
    }
    res.json({ ok: true, wallets: upd.rows[0].wallets || [], activeWallet: upd.rows[0].active_wallet, watchOnly: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
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
//
// Caller (the bot) must pass the tgId of the user who actually sent
// the TG reply. The previous version trusted the user_id stored in
// feed_tg_reply_map — anyone with the tgMsgId could then post into
// that conversation as the wallet owner (DM identity theft). Now we
// require the caller's tgId AND verify that tgId is linked to the
// user_id stored in the reply map.
router.post("/reply", requireBotSig, async (req, res) => {
  const { tgMsgId, tgId, text } = req.body || {};
  if (!tgMsgId || !text) {
    return res.status(400).json({ error: "tgMsgId + text required" });
  }
  try {
    // When tgId is provided (post-hardening bot), join-verify that
    // tgId actually owns the user_id stored in the reply map — closes
    // identity theft. When tgId is NOT provided (pre-hardening bot
    // version still in prod), fall back to the looser lookup with a
    // warning, so reply relay keeps working through the bot rollout.
    // Re-tighten by enforcing tgId once the bot worker is updated.
    if (!tgId) {
      console.warn("[tg/reply] tgId missing — falling back to legacy lookup; redeploy bot to use tgId-verified path");
    }
    const map = tgId
      ? await db.query(
          `SELECT m.conversation_id, m.user_id
             FROM feed_tg_reply_map m
             JOIN feed_tg_links l
               ON l.tg_id = $2
              AND l.user_id IS NOT NULL
              AND l.user_id = m.user_id
            WHERE m.tg_msg_id = $1`,
          [tgMsgId, tgId]
        )
      : await db.query(
          `SELECT conversation_id, user_id FROM feed_tg_reply_map WHERE tg_msg_id = $1`,
          [tgMsgId]
        );
    if (!map.rows.length) {
      const code = tgId ? "not-owner" : "no-conversation";
      const msg  = tgId ? "tgId is not the owner of this conversation" : "no conversation for tgMsgId";
      return res.status(tgId ? 403 : 404).json({ error: msg, code });
    }
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

// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
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

// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
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

// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
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

// public: telegram bridge — bot↔backend channel auth deferred to Day 9 hardening
router.post("/price-alerts/remove", async (req, res) => {
  const { id } = req.body || {};
  try {
    await db.query("UPDATE feed_tg_price_alerts SET active=FALSE WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
