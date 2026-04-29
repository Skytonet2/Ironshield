# LinkedIn connector — compliance posture

**Read all of this before invoking.** This is the most ToS-fragile connector in the suite. Account bans are the **expected** failure mode, not the exception. Use only with the user's explicit consent and an awareness that their LinkedIn account is at risk.

## Why this exists at all
The official LinkedIn API tiers (Marketing Developer Platform, Recruiter, Sales Solutions) gate the endpoints we'd need behind partnership programs that aren't realistically open to a small platform. Our options were:
1. Skip LinkedIn entirely.
2. Build a session-cookie scraper, document the risks, ship it as best-effort.

We picked (2) because the Freelancer Hunter and Background Checker Kits both list LinkedIn as a primary scout source. **No mission-critical path goes through this connector** — Kits chain LinkedIn alongside other sources and continue gracefully when it fails.

## Auth model
**Session cookies, not API tokens.** The user pastes their `li_at` cookie value (extracted from their browser DevTools while logged into linkedin.com) into the connect form. Stored encrypted per-wallet in `connector_credentials` with payload `{ li_at, csrf? }`.

We are **not** an OAuth client of LinkedIn. We are operating as the user, from the server side, with their explicit consent.

## ToS posture (read this carefully)
- LinkedIn's User Agreement §8.2 prohibits scraping. Our position: the user has authorized us to operate their account from the server, in the same way they could run a userscript locally. This is **not** a defensible position in court — it is a "best-effort, low-volume, user-consented" posture.
- **Do not** use this connector for:
  - Mass connection-request automation
  - Aggregating profiles into a separate database for resale
  - Job-application spam
  - Any operation that would draw a notice from LinkedIn's Trust & Safety
- **Do** use this connector for:
  - Read-only reconnaissance on a small handful of profiles (Background Checker)
  - Job search aggregation (Freelancer Hunter)
  - Single-shot Easy Apply with explicit user confirmation per job

## Capability reality
| Action | Status |
|---|---|
| `search` | Works as of 2026-04-28 against `/jobs/search`. Selector drift expected; see drift log. |
| `scrape` | Works on public profiles. Profile fields are gated behind login; cookie auth is enough for most. Some fields (recent posts, full experience) require an active session in good standing. |
| `apply`  | **Disabled by default.** Requires `LINKEDIN_AUTO_APPLY_ENABLED=true` AND `confirm: true` per call. Throws `LINKEDIN_APPLY_DISABLED` / `LINKEDIN_APPLY_CONFIRM_MISSING` otherwise. Multi-step Easy Apply forms are unsupported (returns `applied: false, reason: 'multi-step-form-not-supported'`). External-redirect applications fail. |

## Rate limits
- `per_minute: 2, per_hour: 10`, scope `wallet`. Per_hour binds at ~6 minutes between actions sustained.
- This is **deliberately aggressive**. LinkedIn's anti-bot challenges (`/checkpoint/...`) trigger at far lower thresholds than other sites. Even within these caps, a freshly-issued cookie may be challenged on the first scrape.

## Failure modes
| Symptom | Likely cause | Recovery |
|---|---|---|
| Redirect to `/checkpoint/challenge/` | session challenge — IP, fingerprint, or behavior flagged | user must re-auth in their browser, complete 2FA / captcha, then re-paste a fresh `li_at`. The cookie is dead until then. |
| Empty `items[]` from search | selector drift OR session degraded | check selectors first; if HTML still has the cards, the session is degraded |
| `999` HTTP status | LinkedIn aggressive rate limit / abuse signal | back off this wallet for **at least 24h**. Do not retry tightly. |
| `LINKEDIN_PLAYWRIGHT_MISSING` | runtime playwright not installed | install on host: `npm i playwright && npx playwright install chromium` |
| `applied: false, reason: ...` from apply | normal — many jobs aren't Easy Apply or have multi-step forms | surface to caller; not a bug |

## Selector drift log
- 2026-04-28: search uses `[data-job-id]` cards + `a.job-card-list__title`. Profile scrape uses `h1` for name and `.text-body-medium.break-words` for headline. Update this log on every selector edit.

## PII / data handling
- `li_at` cookie is the user's session token — same security weight as their LinkedIn password. Encrypted at rest, decrypted only inside the connector. Never logged.
- Scraped profile data is returned to the calling Kit and persisted only inside that Kit's mission audit log, not as a global table. Background Checker reports must include a "data was retrieved with the user's consent on <date>" disclosure.
- We do not redistribute scraped data outside the calling user's session.

## When to disable
Disable (remove from `connectors/index.js` candidates list) if:
- A LinkedIn legal notice arrives.
- Account-ban rate among AZUKA users exceeds ~10% in any week.
- Cloudflare / LinkedIn anti-bot changes make the success rate drop below 30%.

## Roadmap notes
- No DM / message send (intentional — too easy to mass-spam).
- No connection-request automation (intentional — same reason).
- No company-page scraping (deferred; works the same way as profile scrape if needed).
- Apply path supports Easy Apply happy path only by design; multi-step forms are pure footgun territory.
