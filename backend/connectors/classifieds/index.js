// backend/connectors/classifieds/index.js
//
// Generic classifieds scraper. Multi-site via config files in ./sites/.
// Adding a new market = drop a config file; no new connector module.
//
// Same Playwright-via-lazy-require posture as the original jiji
// connector: backend boots fine without runtime playwright; the search
// action throws CLASSIFIEDS_PLAYWRIGHT_MISSING with a clear install
// hint when the dep is absent.
//
// Site configs export:
//   {
//     id:           "<slug>",                // matches the file basename
//     label:        "Human-friendly name",
//     country:      "ISO-2",
//     locale:       "en-NG",                 // BCP-47 for the Playwright context
//     base_url:     "https://...",
//     // search_url is a function so configs can encode whatever query-
//     // param contract the site uses without us shoehorning a single
//     // template string. Receives { query, location, minPrice, maxPrice }.
//     search_url:   (params) => string,
//     // CSS / XPath selectors for the listing cards + their fields.
//     card_selector: "string",
//     fields: {
//       title:    "string",   // selector returning textContent
//       price:    "string",
//       location: "string",
//       url:      "string",   // selector returning href attribute
//     },
//     // Optional: override defaults.
//     wait_for?:  string,      // explicit waitForSelector before scrape
//     scroll?:    boolean,     // SPA-heavy sites need a scroll to populate
//     timeout_ms?: number,
//     // Tier 1 (high confidence) | Tier 2 (moderate; needs first-run calibration)
//     selector_tier?: 1 | 2,
//   }
//
// Any one site failing (selectors rotted, network blip) does not affect
// other sites — each search() call is independent.

const path = require("node:path");
const fs   = require("node:fs");

const NAME = "classifieds";

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const ua = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

const SITES_DIR = path.join(__dirname, "sites");
const SITES = (() => {
  const out = {};
  if (!fs.existsSync(SITES_DIR)) return out;
  for (const file of fs.readdirSync(SITES_DIR)) {
    if (!file.endsWith(".js")) continue;
    try {
      const cfg = require(path.join(SITES_DIR, file));
      if (!cfg?.id) throw new Error(`${file}: missing id`);
      out[cfg.id] = cfg;
    } catch (e) {
      console.warn(`[classifieds] failed to load site config ${file}:`, e.message);
    }
  }
  return out;
})();

let _busy = false;
async function withBrowser(site, fn) {
  if (_busy) {
    throw new Error("classifieds: another scrape is in progress in this process; retry shortly");
  }
  let pw;
  try { pw = require("playwright"); }
  catch {
    const err = new Error(
      "classifieds: playwright not installed at runtime. Run `npm install playwright && npx playwright install chromium` on the backend host."
    );
    err.code = "CLASSIFIEDS_PLAYWRIGHT_MISSING";
    throw err;
  }
  _busy = true;
  let browser, ctx, page;
  try {
    browser = await pw.chromium.launch({ headless: true });
    ctx = await browser.newContext({ userAgent: ua(), locale: site.locale || "en-US" });
    page = await ctx.newPage();
    return await fn(page);
  } finally {
    try { await page?.close(); } catch {}
    try { await ctx?.close(); } catch {}
    try { await browser?.close(); } catch {}
    _busy = false;
  }
}

async function search({ site: siteId, query, location, minPrice, maxPrice, limit = 20 } = {}) {
  if (!siteId) throw new Error("search: { site } required");
  const site = SITES[siteId];
  if (!site) {
    const err = new Error(`classifieds: unknown site ${siteId}. Known: ${Object.keys(SITES).sort().join(", ") || "(none)"}`);
    err.code = "CLASSIFIEDS_UNKNOWN_SITE";
    throw err;
  }
  if (!query) throw new Error("search: { query } required");
  return withBrowser(site, async (page) => {
    const url = site.search_url({ query, location, minPrice, maxPrice });
    const timeout = site.timeout_ms || 30_000;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout });
    const wait = site.wait_for || site.card_selector;
    await page.waitForSelector(wait, { timeout: Math.min(15_000, timeout) }).catch(() => null);
    if (site.scroll) {
      // SPA-heavy sites: scroll once to nudge lazy-loaded cards.
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(800);
    }
    const items = await page.$$eval(
      site.card_selector,
      (nodes, args) => {
        const max = args.max;
        const fields = args.fields;
        const baseUrl = args.baseUrl;
        return nodes.slice(0, max).map((n) => {
          const get = (sel) => sel ? (n.querySelector(sel)?.textContent || "").trim() : null;
          const getAttr = (sel, attr) => sel ? (n.querySelector(sel) || n).getAttribute(attr) : null;
          const href = fields.url ? getAttr(fields.url, "href") : n.getAttribute?.("href");
          let resolvedUrl = null;
          if (href) {
            try { resolvedUrl = new URL(href, baseUrl).toString(); } catch { resolvedUrl = href; }
          }
          return {
            title:      get(fields.title),
            price_text: get(fields.price),
            location:   get(fields.location),
            url:        resolvedUrl,
          };
        }).filter((x) => x.title);
      },
      { max: Math.min(50, Math.max(1, limit)), fields: site.fields || {}, baseUrl: site.base_url },
    );
    return {
      source: site.id,
      label:  site.label,
      query,
      count:  items.length,
      items,
    };
  });
}

function listSites() {
  return Object.values(SITES).map((s) => ({
    id: s.id,
    label: s.label,
    country: s.country,
    selector_tier: s.selector_tier || 1,
  }));
}

async function invoke(action, ctx = {}) {
  const params = ctx.params || {};
  switch (action) {
    case "search":     return search(params);
    case "list_sites": return { sites: listSites() };
    default: throw new Error(`classifieds connector: unknown action ${action}`);
  }
}

module.exports = {
  name: NAME,
  capabilities: ["search"],
  // Aggressive throttle. Same posture as the standalone jiji connector
  // — scraping at high frequency invites bans across all sites.
  rate_limits: { per_minute: 4, per_hour: 30, scope: "wallet" },
  auth_method: "byo_account",
  invoke,
  // Test hook
  _SITES: SITES,
};
