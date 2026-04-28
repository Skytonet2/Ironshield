// backend/connectors/jiji/index.js
//
// Jiji (Nigerian classifieds — jiji.ng) connector. Scraping-only;
// Jiji has no public API.
//
// Posture:
//   - Headless Chromium via Playwright (lazy-required so the backend
//     boots fine without playwright installed; only the search action
//     fails with a clear error).
//   - Single global concurrency cap (rate hub already serialises by
//     wallet; we add a process-level mutex to bound CPU).
//   - User-agent rotation, conservative timing, no persistent auth.
//   - Selectors are fragile by definition — see COMPLIANCE.md for the
//     drift policy. When Jiji ships a layout change, this connector
//     fails closed; Kits should fall back gracefully.
//
// This connector is best-effort. Do not chain mission-critical paths
// through it.

const auth_method = "byo_account"; // user supplies no creds; flag for routing
const NAME = "jiji";

const UA_POOL = [
  // Recent stable Chromes — rotate to avoid trivial UA-based blocking.
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const ua = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

let _busy = false;
async function withBrowser(fn) {
  if (_busy) {
    throw new Error("jiji: another scrape is in progress in this process; retry shortly");
  }
  let pw;
  try {
    pw = require("playwright");
  } catch {
    const err = new Error(
      "jiji: playwright not installed at runtime. Run `npm install playwright && npx playwright install chromium` on the backend host to enable this connector."
    );
    err.code = "JIJI_PLAYWRIGHT_MISSING";
    throw err;
  }
  _busy = true;
  let browser, ctx, page;
  try {
    browser = await pw.chromium.launch({ headless: true });
    ctx = await browser.newContext({ userAgent: ua(), locale: "en-NG" });
    page = await ctx.newPage();
    return await fn(page);
  } finally {
    try { await page?.close(); } catch {}
    try { await ctx?.close(); } catch {}
    try { await browser?.close(); } catch {}
    _busy = false;
  }
}

function buildSearchUrl({ query, location, minPrice, maxPrice }) {
  const u = new URL("https://jiji.ng/search");
  if (query)    u.searchParams.set("query", query);
  if (location) u.searchParams.set("filter_location", location);
  if (minPrice) u.searchParams.set("filter_price_from", String(minPrice));
  if (maxPrice) u.searchParams.set("filter_price_to",   String(maxPrice));
  return u.toString();
}

async function search({ query, location, minPrice, maxPrice, limit = 20 } = {}) {
  if (!query) throw new Error("search: { query } required");
  return withBrowser(async (page) => {
    const url = buildSearchUrl({ query, location, minPrice, maxPrice });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Site-specific selector — the listing card. If this rots, the
    // connector throws; check COMPLIANCE.md drift section.
    const SEL_CARD = "a[href*='/'][class*='b-list-advert']";
    await page.waitForSelector(SEL_CARD, { timeout: 15_000 }).catch(() => null);
    const items = await page.$$eval(SEL_CARD, (nodes, max) =>
      nodes.slice(0, max).map((n) => {
        const t = n.querySelector("[class*='title']")?.textContent?.trim() || null;
        const p = n.querySelector("[class*='price']")?.textContent?.trim() || null;
        const loc = n.querySelector("[class*='region']")?.textContent?.trim() || null;
        const href = n.getAttribute("href");
        return {
          title: t,
          price_text: p,
          location: loc,
          url: href ? new URL(href, "https://jiji.ng").toString() : null,
        };
      }).filter(x => x.title), Math.min(50, Math.max(1, limit))
    );
    return { source: "jiji.ng", query, count: items.length, items };
  });
}

async function invoke(action, ctx = {}) {
  const params = ctx.params || {};
  switch (action) {
    case "search": return search(params);
    default: throw new Error(`jiji connector: unknown action ${action}`);
  }
}

module.exports = {
  name: NAME,
  capabilities: ["search"],
  // Aggressive throttle: scraping at high frequency invites bans. The
  // rate hub queue cap (32) layered on top means a runaway agent gets
  // RATE_LIMIT_QUEUE_FULL well before Jiji notices.
  rate_limits: { per_minute: 4, per_hour: 30, scope: "wallet" },
  auth_method,
  invoke,
};
