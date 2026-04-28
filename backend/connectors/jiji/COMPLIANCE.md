# Jiji connector — compliance posture

**Read this before invoking.** This connector is best-effort by design. The Realtor and Car Sales Kits use it as one of several scout sources; they degrade gracefully if it fails.

## Why scraping
Jiji.ng has no public API. Every classifieds aggregator in the Nigerian market is in the same position. Our options are:
1. Don't cover this market.
2. Build a scraper, accept the failure modes, document them.

We picked (2) because Nigeria is a primary target market for the Realtor / Car Sales Kits.

## Auth model
None. Jiji search results are publicly indexable. We don't log in, set cookies, or impersonate a registered user.

## ToS posture
- Jiji's Terms of Use prohibit automated access in the abstract, but the search results we hit are the same pages a logged-out browser sees — same URLs, same HTML, same data.
- We do not scrape behind login walls. We do not crawl seller contact info that requires a "show contact" click. We do not aggregate sellers into a directory.
- Outbound contact (DM / call) is **never** done via this connector. Outreach is delegated to user-context channels (TG, X, WhatsApp) where the user has authenticated themselves.
- Per `robots.txt`: as of the last check, `/search` and listing detail pages are not disallowed. If that changes, this connector should be disabled until manual review.

## Scrape hygiene
- Headless Chromium via Playwright (lazy-required — backend boots fine without it).
- User-agent rotated from a small pool of recent stable Chromes.
- One concurrent scrape per process (the connector keeps a `_busy` flag in addition to the rate-hub queue).
- 30s per-page timeout, no infinite waits.
- No persistent profile, no cookies retained between runs.
- `headless: true` — we are not driving a visible browser session against the site.

## Rate limits
- `per_minute: 4, per_hour: 30`, scope `wallet`. Per_hour binds at ~1 every 2 minutes sustained.
- Bursts up to 4 in a minute are absorbed by the bucket.
- The rate hub queue cap (32) layered on top means a runaway agent gets `RATE_LIMIT_QUEUE_FULL` well before Jiji notices.

## Failure modes
| Symptom | Cause | Recovery |
|---|---|---|
| `JIJI_PLAYWRIGHT_MISSING` | runtime playwright not installed | install on host: `npm i playwright && npx playwright install chromium` |
| `Timeout 30000ms exceeded` | Jiji slow / blocking our IP / site down | back off the wallet for ≥1h; do not retry tightly |
| Empty `items[]` despite valid query | selector drift (Jiji shipped a layout change) | update `SEL_CARD` and the inner `[class*='…']` selectors in `index.js`; bump COMPLIANCE.md drift log below |
| 403 / 429 from goto() | IP or fingerprint flagged | rotate exit IP (or accept dormancy); do not retry |
| Cloudflare interstitial | site protection escalated | connector is dead in this region until protection drops; flag to user |

## Selector drift log
- 2026-04-28: initial selectors `a[href*='/'][class*='b-list-advert']` for cards; inner `[class*='title' / 'price' / 'region']`. Tested against `jiji.ng/search?query=apartment+lagos`. Update this log on every selector edit.

## PII / data handling
- Listing title, price text, location, and URL only. We do not scrape contact info.
- Results are returned to the calling Kit and are not persisted globally; mission audit log retains them per-mission.

## When to disable
Disable (remove from `connectors/index.js` candidates list) immediately if:
- Jiji updates `robots.txt` to disallow `/search`.
- Jiji issues a takedown / cease-and-desist.
- Cloudflare protection makes the success rate drop below ~50% over a week.
- Maintenance cost exceeds the value the Realtor / Car Sales Kits derive (we have alternatives in those Kits).
