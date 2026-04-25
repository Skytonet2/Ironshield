// backend/__tests__/aiBudget.test.js
// Day 5.3 unit tests for the per-wallet AI $ cap. Mocks the db client
// so tests run without Postgres.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const clientPath = path.resolve(__dirname, "..", "db", "client.js");
const fakeAdmin   = new Map();   // wallet → { daily_ai_budget_usd }
const fakeBudgets = new Map();   // wallet → daily_ai_budget_usd
const fakeSpend   = new Map();   // `${wallet}|${day}` → cost_usd

require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    async query(sql, params) {
      if (sql.startsWith("SELECT daily_ai_budget_usd FROM admin_wallets")) {
        const r = fakeAdmin.get(params[0]);
        return { rows: r ? [r] : [] };
      }
      if (sql.startsWith("SELECT daily_ai_budget_usd FROM wallet_budgets")) {
        const v = fakeBudgets.get(params[0]);
        return { rows: v == null ? [] : [{ daily_ai_budget_usd: v }] };
      }
      if (sql.startsWith("SELECT cost_usd FROM wallet_ai_spend")) {
        const k = `${params[0]}|today`;
        const v = fakeSpend.get(k);
        return { rows: v == null ? [] : [{ cost_usd: v }] };
      }
      if (sql.startsWith("INSERT INTO wallet_ai_spend")) {
        const k = `${params[0]}|today`;
        fakeSpend.set(k, (fakeSpend.get(k) || 0) + Number(params[1]));
        return { rowCount: 1 };
      }
      throw new Error("unexpected query: " + sql);
    },
  },
};

const aiBudget = require("../services/aiBudget");

function reset() {
  fakeAdmin.clear(); fakeBudgets.clear(); fakeSpend.clear();
}

test("estimateCost: known model uses its rate", () => {
  // qwen3-30b: input $0.001/1k, output $0.002/1k
  const cost = aiBudget.estimateCost(
    { prompt_tokens: 1000, completion_tokens: 500 },
    "Qwen/Qwen3-30B-A3B-Instruct-2507"
  );
  // 1.0 * 0.001 + 0.5 * 0.002 = 0.001 + 0.001 = 0.002
  assert.equal(Math.round(cost * 1000) / 1000, 0.002);
});

test("estimateCost: zero usage → zero cost", () => {
  assert.equal(aiBudget.estimateCost({}, "qwen-30b"), 0);
});

test("getBudget: admin override takes precedence over wallet_budgets", async () => {
  reset();
  fakeAdmin.set("alice.near", { daily_ai_budget_usd: 100 });
  fakeBudgets.set("alice.near", 5);
  assert.equal(await aiBudget.getBudget("alice.near"), 100);
});

test("getBudget: wallet_budgets used when no admin row", async () => {
  reset();
  fakeBudgets.set("bob.near", 12.5);
  assert.equal(await aiBudget.getBudget("bob.near"), 12.5);
});

test("getBudget: defaults when neither table has the wallet", async () => {
  reset();
  assert.equal(await aiBudget.getBudget("noone.near"), aiBudget.DEFAULT_BUDGET_USD);
});

test("checkBudget: under cap → no throw", async () => {
  reset();
  fakeBudgets.set("alice.near", 1);
  fakeSpend.set("alice.near|today", 0.5);
  await aiBudget.checkBudget("alice.near"); // shouldn't throw
});

test("checkBudget: at cap → throws BudgetExceededError with 402", async () => {
  reset();
  fakeBudgets.set("alice.near", 1);
  fakeSpend.set("alice.near|today", 1.0);
  await assert.rejects(
    () => aiBudget.checkBudget("alice.near"),
    (err) => {
      assert.equal(err.code, "ai-budget-exceeded");
      assert.equal(err.statusCode, 402);
      assert.equal(err.cap, 1);
      assert.equal(err.used, 1);
      return true;
    },
  );
});

test("recordSpend: accumulates day's cost", async () => {
  reset();
  await aiBudget.recordSpend("alice.near", { prompt_tokens: 1000, completion_tokens: 0 }, "qwen-30b");
  await aiBudget.recordSpend("alice.near", { prompt_tokens: 1000, completion_tokens: 0 }, "qwen-30b");
  // 2 × $0.001 = $0.002
  assert.equal(Math.round(fakeSpend.get("alice.near|today") * 1000) / 1000, 0.002);
});

test("checkBudget: no-op when wallet is undefined (system caller)", async () => {
  reset();
  await aiBudget.checkBudget(undefined); // shouldn't throw or query
});
