# Classifieds connector — compliance posture

Generic multi-site Playwright scraper. Adding a new market = drop a config file in `./sites/`. Same best-effort posture as the original `jiji` connector, scaled across regions.

**Read this before invoking.** This connector is best-effort by design. Selectors will rot. Sites will block IPs. The Realtor / Car Sales / similar Kits should chain `classifieds` alongside other scout sources and degrade gracefully when any one site fails.

## Auth model

None. Every supported site's search results are publicly indexable. We don't log in, set cookies, or impersonate registered users.

## ToS posture

- Each site's Terms of Use prohibits automated access in the abstract. Our position: we hit the same publicly-indexable URLs a logged-out browser sees, at low volume, on the user's behalf.
- We do **not** scrape behind login walls. We do **not** crawl seller contact info that requires a "show contact" interaction. We do **not** aggregate sellers into a directory for redistribution.
- Outbound contact (DM / email / call) is **never** done via this connector. Outreach is delegated to user-context channels (TG, X, WhatsApp, email) where the user has authenticated themselves.
- Per `robots.txt`: each site's `/search` (or equivalent) has been verified as indexable as of the dates in the per-site selector log below. If any site flips its `robots.txt`, the corresponding config should be removed pending review.

## Sites supported (selector confidence tiers)

**Tier 1 (high confidence — selectors based on stable, documented patterns).** Should work on first run.

| Site | Country | Backend / notes |
|---|---|---|
| `jiji_ng` | Nigeria | Jiji shared backend, in production since Tier 4 |
| `jiji_gh` | Ghana | Jiji shared backend |
| `jiji_ke` | Kenya | Jiji shared backend |
| `jiji_ug` | Uganda | Jiji shared backend |
| `jiji_tz` | Tanzania | Jiji shared backend |
| `jiji_zm` | Zambia | Jiji shared backend |
| `jiji_cm` | Cameroon | Jiji shared backend |
| `kleinanzeigen_de` | Germany | Stable `.aditem` class scheme post-eBay rebrand |
| `leboncoin_fr` | France | Stable `data-test-id` attribute scheme |
| `marktplaats_nl` | Netherlands | Stable `.hz-Listing` prefix |
| `olx_pl` | Poland | Stable OLX `data-cy` / `data-testid` scheme |

**Tier 2 (moderate confidence — heavy SPAs, may need first-run selector calibration).**

| Site | Country | Why tier 2 |
|---|---|---|
| `wallapop_es` | Spain | SPA hydration, selectors observed 2025; scroll-required |
| `subito_it` | Italy | Schibsted SPA with virtuoso virtual-scroller |

## Scrape hygiene

- Headless Chromium via Playwright (lazy-required — backend boots fine without it).
- User-agent rotated from a small pool of recent stable Chromes.
- One concurrent scrape per process (the `_busy` mutex on top of the rate-hub queue).
- Per-site `locale` set on the browser context so price formats / language render correctly.
- 30-second default timeout (45s for tier-2 SPAs).
- No persistent profile, no cookies retained between runs.
- `headless: true` — we are not driving visible browser sessions against any site.

## Rate limits

- `per_minute: 4, per_hour: 30`, scope `wallet`. Identical to the original jiji connector.
- Per_hour binds at ~2 minutes between actions sustained.
- The rate-hub queue cap (32) on top means a runaway agent gets `RATE_LIMIT_QUEUE_FULL` well before any one site notices.

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| `CLASSIFIEDS_PLAYWRIGHT_MISSING` | runtime playwright not installed | `npm i playwright && npx playwright install chromium` on the host |
| `CLASSIFIEDS_UNKNOWN_SITE` | site id not in `./sites/` | typo, or the config was removed; check `connectors.invoke('classifieds', 'list_sites')` |
| Empty `items[]` despite valid query | selector drift — site shipped a layout change | update the affected `sites/<id>.js` config, bump the selector log date |
| 403 / 429 from goto() | IP / fingerprint flagged | rotate exit IP, or accept dormancy for that site/wallet pair |
| `Timeout 30000ms exceeded` | site slow / blocking us / down | back off the wallet for ≥1h |
| Cloudflare / DataDome interstitial | site protection escalated | site is dead in this region until protection drops; remove the config from rotation |

## Per-site notes

### Africa (Jiji family)
All Jiji TLDs share the same backend, so `jiji_ng`'s selectors port directly. If one breaks, all break. If one site's rate limits get tighter, expect the others to follow.

### kleinanzeigen_de
Post-2024 rebrand from "eBay Kleinanzeigen". Don't confuse with eBay.de (which uses different selectors). Honour the German consumer-protection language requirements — output language matches the user's locale unless explicitly translated downstream.

### leboncoin_fr
Stricter GDPR posture than other sites. Do not retain extracted data beyond the calling Kit's mission audit log lifetime.

### marktplaats_nl
Owned by eBay; some markup converges with kleinanzeigen_de. Selectors here cover the current SPA rewrite (post-2023).

### olx_pl
OLX runs the same product across ~10 countries; if you want to add Portugal, Romania, Bulgaria, etc., they're the same selectors with a different `base_url` and locale. Consider a shared `olx_*` template if more land.

### wallapop_es (Tier 2)
Spain-only marketplace. Heavy SPA — initial render shows a skeleton, real items load via XHR after a viewport scroll. Config sets `scroll: true` and `wait_for` to nudge hydration. **Likely needs first-run calibration** if Wallapop ships a layout update.

### subito_it (Tier 2)
Italy-only. Uses a virtuoso virtual-scroller for the results list — only items in the viewport are in the DOM at any time. We catch the first batch (~20 items). For more, we'd need to scroll-then-scrape in a loop; deferred until a Kit needs it.

## When to disable a site

Remove the config (move to `_disabled/` or delete) when:
- Site updates `robots.txt` to disallow `/search` (or equivalent).
- Site issues a takedown / cease-and-desist.
- Cloudflare / DataDome makes the success rate drop below ~50% over a week.
- Maintenance cost exceeds value.

## PII / data handling

- Listing title, price text, location, and URL only. No contact info scraped.
- Results are returned to the calling Kit and persisted only in that Kit's mission audit log, not as a global table.
- We do not redistribute scraped data outside the calling user's session.

## Selector drift log

Update this when a config's selectors are edited.

- 2026-04-29: initial Tier 1 (Jiji family + Kleinanzeigen + Leboncoin + Marktplaats + OLX-PL) and Tier 2 (Wallapop + Subito) configs landed. Tier 1 expected to work first run; Tier 2 expected to need ≤1 selector adjustment after first live test.
