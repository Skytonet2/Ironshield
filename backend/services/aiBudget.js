// backend/services/aiBudget.js
// Per-wallet daily AI $ cap (Day 5.3). Three responsibilities:
//
//   1. getBudget(wallet) — resolve the wallet's daily cap. Admins
//      override via admin_wallets.daily_ai_budget_usd; everyone else
//      reads wallet_budgets, defaulting to DEFAULT_BUDGET_USD when no
//      row exists.
//   2. checkBudget(wallet) — throw a BudgetExceededError when today's
//      accumulated spend ≥ cap. Routes catch this and return 402.
//   3. recordSpend(wallet, usage) — translate the OpenAI-compatible
//      usage object ({ prompt_tokens, completion_tokens }) into a
//      USD estimate and UPSERT into wallet_ai_spend.
//
// Token cost is a hardcoded constant per model (per spec — "we can tune
// later"). The Qwen3-30B numbers below are rough estimates for the
// near.ai cloud endpoint; if the upstream changes pricing, edit here.

const db = require("../db/client");

const DEFAULT_BUDGET_USD = 5.0;

// $/1K tokens. Source: rough estimate for a 30B-class OSS LLM hosted on
// near.ai cloud. Update when upstream publishes a real price sheet.
// Keys are matched against process.env.NEAR_AI_MODEL (substring) so a
// model swap doesn't silently fall through to a wrong number.
const COSTS_PER_1K = [
  { match: /qwen.*30b|qwen3-30b/i,                input: 0.001,  output: 0.002  },
  { match: /llama-3\.1-70b/i,                     input: 0.0009, output: 0.0009 },
  { match: /llama|qwen|deepseek|mistral|claude/i, input: 0.001,  output: 0.002  }, // generic OSS fallback
];
const FALLBACK_COST = { input: 0.001, output: 0.002 };

class BudgetExceededError extends Error {
  constructor(wallet, used, cap) {
    super(`ai-budget-exceeded`);
    this.code = "ai-budget-exceeded";
    this.statusCode = 402;
    this.wallet = wallet;
    this.used   = used;
    this.cap    = cap;
  }
}

function costFor(model = "") {
  for (const c of COSTS_PER_1K) if (c.match.test(model)) return { input: c.input, output: c.output };
  return FALLBACK_COST;
}

// USD cost given an OpenAI-compatible usage object.
function estimateCost(usage, model) {
  const c = costFor(model);
  const promptTokens     = Number(usage?.prompt_tokens     || 0);
  const completionTokens = Number(usage?.completion_tokens || 0);
  return (promptTokens / 1000) * c.input + (completionTokens / 1000) * c.output;
}

async function getBudget(wallet) {
  if (!wallet) return DEFAULT_BUDGET_USD;
  // Admin override first.
  const admin = await db.query(
    "SELECT daily_ai_budget_usd FROM admin_wallets WHERE wallet = $1 LIMIT 1",
    [wallet]
  ).catch(() => ({ rows: [] }));
  if (admin.rows[0]?.daily_ai_budget_usd != null) {
    return Number(admin.rows[0].daily_ai_budget_usd);
  }
  const r = await db.query(
    "SELECT daily_ai_budget_usd FROM wallet_budgets WHERE wallet = $1 LIMIT 1",
    [wallet]
  ).catch(() => ({ rows: [] }));
  if (r.rows[0]?.daily_ai_budget_usd != null) return Number(r.rows[0].daily_ai_budget_usd);
  return DEFAULT_BUDGET_USD;
}

async function getTodaySpend(wallet) {
  if (!wallet) return 0;
  const r = await db.query(
    "SELECT cost_usd FROM wallet_ai_spend WHERE wallet = $1 AND day = CURRENT_DATE",
    [wallet]
  ).catch(() => ({ rows: [] }));
  return Number(r.rows[0]?.cost_usd || 0);
}

// Pre-call gate. Throws BudgetExceededError if the wallet has burned
// its cap today; caller (route or dispatch) maps that to a 402.
async function checkBudget(wallet) {
  if (!wallet) return; // unsigned/system caller — let it through (rate-limit + auth gate apply elsewhere)
  const [cap, used] = await Promise.all([getBudget(wallet), getTodaySpend(wallet)]);
  if (used >= cap) throw new BudgetExceededError(wallet, used, cap);
}

// Post-call ledger. Best-effort — if the DB blip happens we don't fail
// the user's request, but we log so ops sees drift.
async function recordSpend(wallet, usage, model = process.env.NEAR_AI_MODEL || "") {
  if (!wallet) return;
  const cost = estimateCost(usage, model);
  if (cost <= 0) return;
  try {
    await db.query(
      `INSERT INTO wallet_ai_spend (wallet, day, cost_usd)
         VALUES ($1, CURRENT_DATE, $2)
         ON CONFLICT (wallet, day) DO UPDATE SET cost_usd = wallet_ai_spend.cost_usd + EXCLUDED.cost_usd`,
      [wallet, cost]
    );
  } catch (e) {
    console.warn(`[aiBudget] recordSpend failed for ${wallet}:`, e.message);
  }
}

module.exports = {
  DEFAULT_BUDGET_USD,
  BudgetExceededError,
  getBudget, getTodaySpend, checkBudget, recordSpend, estimateCost,
};
