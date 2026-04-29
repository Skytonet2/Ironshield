// backend/connectors/linkedin/index.js
//
// LinkedIn connector. The official API tiers (LMP / Recruiter / Sales)
// are not accessible for our use case, so this connector uses
// session-cookie scraping via Playwright. Read /COMPLIANCE.md before
// invoking — this is the most fragile connector in the suite and
// account bans are the expected failure mode.
//
// Auth model: BYO LinkedIn cookies (specifically `li_at`), supplied by
// the user via the connect endpoint and stored encrypted per-wallet.
// Payload shape:
//   { li_at: "<cookie value>", csrf?: "<JSESSIONID-derived>" }
//
// Actions:
//   search   — jobs search by query + location.
//   scrape   — public profile fetch (URL slug input).
//   apply    — auto-apply to a job. **Disabled by default**; only fires
//              if LINKEDIN_AUTO_APPLY_ENABLED=true and the caller
//              passes confirm: true. Even then, ban risk is high.

const credentialStore = require("../credentialStore");

const NAME = "linkedin";
const APPLY_ENABLED = process.env.LINKEDIN_AUTO_APPLY_ENABLED === "true";

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const ua = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

let _busy = false;

async function _creds(wallet) {
  if (!wallet || wallet === "platform") {
    throw new Error("linkedin: per-wallet creds required");
  }
  const row = await credentialStore.getDecrypted({ wallet, connector: "linkedin" }).catch(() => null);
  if (!row?.payload?.li_at) {
    throw new Error("linkedin: connect first — supply li_at session cookie via /api/connectors/linkedin/connect");
  }
  return row.payload;
}

async function withSession(wallet, fn) {
  if (_busy) throw new Error("linkedin: another scrape is in progress in this process; retry shortly");
  let pw;
  try { pw = require("playwright"); }
  catch {
    const err = new Error(
      "linkedin: playwright not installed at runtime. Run `npm install playwright && npx playwright install chromium` on the backend host."
    );
    err.code = "LINKEDIN_PLAYWRIGHT_MISSING";
    throw err;
  }
  const creds = await _creds(wallet);
  _busy = true;
  let browser, ctx, page;
  try {
    browser = await pw.chromium.launch({ headless: true });
    ctx = await browser.newContext({ userAgent: ua(), locale: "en-US" });
    await ctx.addCookies([{
      name: "li_at",
      value: creds.li_at,
      domain: ".linkedin.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "None",
    }]);
    page = await ctx.newPage();
    return await fn(page, creds);
  } finally {
    try { await page?.close(); } catch {}
    try { await ctx?.close(); } catch {}
    try { await browser?.close(); } catch {}
    _busy = false;
  }
}

async function search({ wallet, query, location, limit = 10 }) {
  if (!query) throw new Error("search: { query } required");
  return withSession(wallet, async (page) => {
    const u = new URL("https://www.linkedin.com/jobs/search");
    u.searchParams.set("keywords", query);
    if (location) u.searchParams.set("location", location);
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    // LinkedIn rotates these class names frequently — see COMPLIANCE.md
    // selector-drift section. Match by data attribute when possible.
    const SEL = "[data-job-id], a.job-card-list__title";
    await page.waitForSelector(SEL, { timeout: 15_000 }).catch(() => null);
    const items = await page.$$eval(SEL, (nodes, max) =>
      nodes.slice(0, max).map((n) => {
        const card = n.closest("[data-job-id]") || n;
        return {
          job_id: card.getAttribute("data-job-id") || null,
          title: card.querySelector("a.job-card-list__title")?.textContent?.trim() || null,
          company: card.querySelector(".job-card-container__company-name, .artdeco-entity-lockup__subtitle")?.textContent?.trim() || null,
          location: card.querySelector(".job-card-container__metadata-item")?.textContent?.trim() || null,
          url: (card.querySelector("a.job-card-list__title") || n).getAttribute("href"),
        };
      }).filter(x => x.title), Math.min(25, Math.max(1, limit))
    );
    return { source: "linkedin.com/jobs", query, count: items.length, items };
  });
}

async function scrape({ wallet, profileSlug }) {
  if (!profileSlug) throw new Error("scrape: { profileSlug } required");
  return withSession(wallet, async (page) => {
    await page.goto(`https://www.linkedin.com/in/${encodeURIComponent(profileSlug)}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    // Public profile fields. Selectors WILL drift.
    const data = await page.evaluate(() => {
      const $ = (s) => document.querySelector(s);
      return {
        name: $("h1")?.textContent?.trim() || null,
        headline: $(".text-body-medium.break-words")?.textContent?.trim() || null,
        location: $(".text-body-small.inline.t-black--light.break-words")?.textContent?.trim() || null,
        about: $("#about + * + * .display-flex .visually-hidden")?.textContent?.trim() || null,
      };
    });
    return { source: "linkedin.com/in", profileSlug, ...data };
  });
}

async function apply({ wallet, jobId, confirm }) {
  if (!APPLY_ENABLED) {
    const err = new Error(
      "apply: disabled. Set LINKEDIN_AUTO_APPLY_ENABLED=true on the host AND pass confirm:true to enable. Read /COMPLIANCE.md first — auto-apply is account-ban territory on LinkedIn."
    );
    err.code = "LINKEDIN_APPLY_DISABLED";
    throw err;
  }
  if (confirm !== true) {
    const err = new Error("apply: refusing to fire without explicit confirm:true");
    err.code = "LINKEDIN_APPLY_CONFIRM_MISSING";
    throw err;
  }
  if (!jobId) throw new Error("apply: { jobId } required");
  return withSession(wallet, async (page) => {
    await page.goto(`https://www.linkedin.com/jobs/view/${encodeURIComponent(jobId)}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    // Easy Apply happy path only — multi-step flows or external-redirect
    // applications fail silently and return { applied: false, reason }.
    const easyBtn = await page.$("button:has-text('Easy Apply'), button[aria-label*='Easy Apply']");
    if (!easyBtn) return { applied: false, reason: "not-easy-apply" };
    await easyBtn.click();
    await page.waitForSelector("button[aria-label='Submit application']", { timeout: 10_000 }).catch(() => null);
    const submit = await page.$("button[aria-label='Submit application']");
    if (!submit) return { applied: false, reason: "multi-step-form-not-supported" };
    await submit.click();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => null);
    return { applied: true, jobId };
  });
}

async function invoke(action, ctx = {}) {
  const params = ctx.params || {};
  const wallet = ctx.wallet;
  switch (action) {
    case "search": return search({ wallet, ...params });
    case "scrape": return scrape({ wallet, ...params });
    case "apply":  return apply({ wallet, ...params });
    default: throw new Error(`linkedin connector: unknown action ${action}`);
  }
}

/**
 * No automated refresh path is possible for LinkedIn:
 *   - LinkedIn does not issue a refresh token (we use cookies, not OAuth).
 *   - The "Sign In with LinkedIn" OAuth product gives only r_liteprofile
 *     + r_emailaddress — none of search / scrape / apply work, so it's
 *     a regression, not an alternative.
 *   - Any "heartbeat" check would require Playwright every cycle and
 *     LinkedIn breaks the selectors regularly. Maintenance > value.
 *
 * Returning null tells connectorRefresh worker to skip cleanly (its
 * `if (fresh?.payload)` check stays false, nothing logged). When the
 * cookie expires, the next invoke surfaces the failure to the user
 * via the normal "checkpoint challenge" path; they re-paste a fresh
 * `li_at` via /api/connectors/linkedin/connect.
 */
async function refresh() {
  return null;
}

module.exports = {
  name: NAME,
  capabilities: ["search", "read", "write"],
  // Aggressively low. LinkedIn's anti-bot is the most sensitive of the
  // sites we touch. The rate hub queue cap (32) layered on top means
  // a runaway agent gets RATE_LIMIT_QUEUE_FULL well before the session
  // gets challenged.
  rate_limits: { per_minute: 2, per_hour: 10, scope: "wallet" },
  auth_method: "session_token",
  invoke,
  refresh,
};
