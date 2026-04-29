# Codex / operator handoff — tasks Claude can't finish autonomously

Created: 2026-04-29
Last updated: 2026-04-29

This document is for Codex (or a human operator) to pick up work that is **blocked on real-world setup** — registering apps with third-party providers, provisioning credentials, clicking through OAuth flows in a real browser. None of these can be automated from a sandbox.

Each task includes:
1. **What** the work is.
2. **Why** Claude couldn't do it.
3. **Pre-requisites** (accounts, env vars, dashboard access).
4. **Step-by-step** instructions.
5. **How to verify** success.

Production references:
- Backend: `https://ironclaw-backend.onrender.com`
- Frontend: `https://azuka.pages.dev`
- DB: Neon `neondb` at `aws.neon.tech` (DATABASE_URL in Render env, surfaced via `Render API: GET /v1/services/srv-d7ev9v7lk1mc73c2ic0g/env-vars?limit=100`).
- Render service ID: `srv-d7ev9v7lk1mc73c2ic0g`

---

## Task 1 — Live OAuth manual smoke (4 providers)

### What
Verify that the four OAuth Connect flows work end-to-end against real provider apps:
- X (Twitter) — `POST /api/connectors/x/oauth/start` → click Authorize → callback stores token.
- Facebook — same shape.
- Email (Google) — `POST /api/connectors/email/oauth/google/start` etc.
- Email (Microsoft) — same shape.

### Why Claude couldn't do it
1. Claude has no provider creds (`X_CLIENT_ID`, `FACEBOOK_APP_ID`, etc. are all blank in Render env).
2. None of the four providers let scripts click "Authorize" — anti-bot, CAPTCHA, MFA. A human in a browser is the only path.
3. Claude can't sign in to your wallet (NEP-413 sig requires the user's NEAR private key) so it can't call `/oauth/start` with valid auth headers.

### Pre-requisites

For **each** of the four providers, register an OAuth application:

| Provider | Console | Required scopes |
|---|---|---|
| X | https://developer.x.com/en/portal/dashboard → OAuth 2.0 setup | `tweet.read tweet.write users.read dm.read dm.write offline.access` |
| Facebook | https://developers.facebook.com/apps → Add Product → Facebook Login | `pages_show_list,pages_messaging,groups_access_member_info` |
| Google | https://console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client IDs (Web app) | `https://mail.google.com/ openid email` |
| Microsoft | https://entra.microsoft.com → App registrations → New registration (multi-tenant + personal accounts) | `https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All openid email offline_access` |

For **each**, set the **Authorized Redirect URI** to:
- X: `https://ironclaw-backend.onrender.com/api/connectors/x/oauth/callback`
- Facebook: `https://ironclaw-backend.onrender.com/api/connectors/facebook/oauth/callback`
- Google: `https://ironclaw-backend.onrender.com/api/connectors/email/oauth/google/callback`
- Microsoft: `https://ironclaw-backend.onrender.com/api/connectors/email/oauth/microsoft/callback`

Then set the env vars on Render via API or dashboard. Use the Render API like this for each:
```bash
curl -X PUT "https://api.render.com/v1/services/srv-d7ev9v7lk1mc73c2ic0g/env-vars/X_CLIENT_ID" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"value":"<your-client-id>"}'
```

Vars to set per provider (all should already exist in `.env.example`):
- X: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_OAUTH_REDIRECT_URI`, plus `X_BEARER_TOKEN` for read-only.
- Facebook: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_OAUTH_REDIRECT_URI`.
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`.
- Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_OAUTH_REDIRECT_URI`.

Plus shared: `OAUTH_STATE_SECRET` (32-byte hex, used to HMAC-sign the OAuth state cookie). Generate with `openssl rand -hex 32`.

After setting env vars, **trigger a Render deploy** so the new env values land:
```bash
curl -X POST "https://api.render.com/v1/services/srv-d7ev9v7lk1mc73c2ic0g/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"commitId":"<latest-main-sha>"}'
```

### Step-by-step

For **each** of the four providers:

1. Open `https://azuka.pages.dev/connectors/` in a real browser.
2. Sign in with the NEAR wallet (the page handles this).
3. Click "Connect with OAuth" on the provider's card.
4. Browser redirects to the provider. Click "Authorize".
5. Provider redirects back to `azuka.pages.dev/connectors/?connected=<provider>`.
6. Page should show a green success banner.

If anything goes wrong, the page shows a red error banner with the provider's error code (sanitized to 80 chars by `oauthState.safeErrorTag`).

### How to verify

After each successful Connect:

```bash
# Pull DATABASE_URL from Render
DBU=$(curl -sS "https://api.render.com/v1/services/srv-d7ev9v7lk1mc73c2ic0g/env-vars?limit=100" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  | jq -r '.[].envVar | select(.key=="DATABASE_URL").value')

# Check the credential row exists
DATABASE_URL="$DBU" node -e "
const db = require('./backend/db/client');
(async () => {
  const r = await db.pool.query(
    'SELECT user_wallet, connector_name, expires_at, updated_at FROM connector_credentials WHERE connector_name IN (\$1) ORDER BY updated_at DESC',
    ['x']  // or 'facebook' / 'email'
  );
  console.log(r.rows);
  await db.pool.end();
})();
"
```

Successful row has the matching `user_wallet`, `connector_name`, `expires_at` (an ISO string in the future), and recent `updated_at`. The encrypted blob is not exposed.

---

## Task 2 — Live scraper verification (selector calibration)

### What
Verify that the 13 classifieds site configs return real items against live websites. Calibrate any selectors that drifted between the time the configs were written and runtime.

### Why Claude couldn't do it
Until 2026-04-29 17:30 UTC, Playwright runtime wasn't installed on Render — every scraper invocation threw `*_PLAYWRIGHT_MISSING`. Claude **fixed that today** by adding `playwright` to deps and updating Render's buildCommand. But verifying that each site's selectors actually work requires a live run.

The first live verification opportunity is the new **drift cron** (P3 row 10), which fires its first tick 5 minutes after each Render deploy and walks all 13 sites.

### Pre-requisites
- Playwright installed on Render (already done).
- Drift cron deployed (PR #119 — currently merged but not yet deployed at time of writing this doc).
- Admin wallet on `ironshield.near` allowlist (check `admin_wallets` table).

### Step-by-step

1. After the next deploy, wait 5 minutes for the boot kick to fire.
2. Pull the per-site results:

```bash
# Fire on-demand and inspect synchronously (admin-authed)
# Use whatever signed-fetch helper your test harness has — example via apiFetch:
curl -X POST "https://ironclaw-backend.onrender.com/api/admin/classifieds-drift/run" \
  -H "Authorization: Bearer $SESSION_TOKEN"
```

Or, if you don't want to authenticate, query the event_counters DB directly:

```bash
DATABASE_URL="$DBU" node -e "
const db = require('./backend/db/client');
(async () => {
  const r = await db.pool.query(\`
    SELECT event_name, label, count, last_seen
      FROM event_counters
      WHERE event_name LIKE 'classifieds.drift.%'
      ORDER BY label, event_name
  \`);
  for (const row of r.rows) console.log(row.event_name, '|', row.label, '|', row.count);
  await db.pool.end();
})();
"
```

### How to verify

Healthy state — every site has a `classifieds.drift.ok` counter row with count > 0:

```
classifieds.drift.ok | jiji_ng         | 1
classifieds.drift.ok | jiji_gh         | 1
classifieds.drift.ok | jiji_ke         | 1
classifieds.drift.ok | jiji_ug         | 1
classifieds.drift.ok | jiji_tz         | 1
classifieds.drift.ok | jiji_zm         | 1
classifieds.drift.ok | jiji_cm         | 1
classifieds.drift.ok | kleinanzeigen_de| 1
classifieds.drift.ok | leboncoin_fr    | 1
classifieds.drift.ok | marktplaats_nl  | 1
classifieds.drift.ok | olx_pl          | 1
classifieds.drift.ok | wallapop_es     | 1
classifieds.drift.ok | subito_it       | 1
```

**If a site shows `classifieds.drift.empty` or `classifieds.drift.failure` instead** — that site's selectors need calibration. To debug:

1. Open the site in a real browser.
2. Use DevTools to find the actual current card selector.
3. Update `backend/connectors/classifieds/sites/<site>.js` with the new selector.
4. Update the "Selector drift log" section in `backend/connectors/classifieds/COMPLIANCE.md` with the date and what changed.
5. Commit, push, deploy.
6. Re-run the drift trigger.

Selectors most likely to drift first: `wallapop_es` and `subito_it` (Tier 2, heavy SPAs).

---

## Task 3 — WhatsApp webhook live verification

### What
Verify the WhatsApp Cloud API webhook endpoint receives real events from Meta and `connector:whatsapp:message` fires on the eventBus.

### Why Claude couldn't do it
1. Requires a Meta Business Account and a WhatsApp Business phone number (KYC, business verification).
2. The webhook URL must be registered on Meta's side, which requires a temporary verify-token round-trip from a real Meta call.
3. Sending a test message requires a real phone number on the user's WhatsApp Business app.

### Pre-requisites
- Meta Business Account: https://business.facebook.com
- WhatsApp Business app for your phone number (download the regular WhatsApp Business app from app store and set up).
- A WhatsApp Cloud API system-user access token (https://developers.facebook.com/apps → WhatsApp → API Setup).
- Render env vars set:
  - `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — any random hex string (32 chars). Generate with `openssl rand -hex 16`.
  - `WHATSAPP_APP_SECRET` — from Facebook app settings (optional but enables HMAC sig verification).

### Step-by-step

1. **Register the webhook with Meta:**
   - In Meta dashboard → WhatsApp → Configuration → Webhook → Edit.
   - Callback URL: `https://ironclaw-backend.onrender.com/api/connectors/whatsapp/webhook`.
   - Verify token: paste the same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
   - Click Verify and Save.
   - Subscribe to `messages` field.

2. **First connect via the UI:**
   - Open `https://azuka.pages.dev/connectors/`.
   - Click "Connect" on the WhatsApp card.
   - Fill the form: `access_token`, `phone_number_id`, `business_account_id`, optional `app_secret`.
   - Submit.

3. **Send a test message** from your phone (one that's been previously paired) to the Business phone number.

4. **Watch the backend logs** in real time:

```bash
curl -sS "https://api.render.com/v1/logs?ownerId=tea-cul5ja52ng1s739h8a5g&resource=srv-d7ev9v7lk1mc73c2ic0g&type=app&direction=backward&limit=50" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  | jq -r '.logs[] | select(.message | contains("connector:whatsapp"))'
```

### How to verify

You should see structured log lines like:
```
{"level":30,"time":"...","service":"ironclaw-backend","event":"connector:whatsapp:message","phone_number_id":"...","from":"...","msg":"..."}
```

(Note: the existing implementation does NOT log every message — it only emits to eventBus. To see them in logs, you'd need to add a logger call or write a tiny test consumer that subscribes via `eventBus.on("connector:whatsapp:message", ...)`. That's a small follow-up commit if needed.)

The simpler verification: hit the verify endpoint manually and confirm 200:
```bash
curl -i "https://ironclaw-backend.onrender.com/api/connectors/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<your-token>&hub.challenge=test123"
# Expect: HTTP 200 with body "test123"
```

If verify token mismatches, response is 403 (`{"error":"verify_token mismatch"}`).

---

## Task 4 (optional, related to 3) — Verify HMAC signature path

### What
The WhatsApp webhook accepts signed payloads via `X-Hub-Signature-256: sha256=<hmac>`. If `WHATSAPP_APP_SECRET` is set, the connector's `verifySignature` middleware validates each inbound POST.

### Why Claude couldn't do it
Requires real Meta-generated signatures. Forging them is the security boundary we're verifying.

### Step-by-step

1. Set `WHATSAPP_APP_SECRET` in Render env (matches the value in Meta's app dashboard → Settings → Basic).
2. Deploy.
3. Send a real test message from your phone (Meta will sign it).
4. Confirm the backend processes it (eventBus event fires).
5. Try a forged POST:
   ```bash
   curl -i -X POST "https://ironclaw-backend.onrender.com/api/connectors/whatsapp/webhook" \
     -H "Content-Type: application/json" \
     -H "X-Hub-Signature-256: sha256=deadbeef" \
     -d '{"object":"whatsapp_business_account","entry":[]}'
   # Expect: HTTP 401 with body {"error":"signature mismatch"}
   ```

### How to verify
- Real Meta-signed POST → 200, eventBus event fires.
- Forged signature → 401.
- Missing `WHATSAPP_APP_SECRET` env → all POSTs accepted (logged warning at boot).

---

## Notes for whoever picks this up

- **Don't skip the Render redeploy** after setting env vars. Render does not hot-reload env values.
- **Memory budget on starter plan is tight.** Each Playwright launch is ~200MB. If the drift cron OOMs the process, expect the worker to restart and the cron to retry next tick. If it's persistent, upgrade the Render plan or move scrapers off-process (a separate Render Cron Job — though "new paid services not allowed" was hit during initial setup; check current account state).
- **Telemetry is your friend.** `GET /api/admin/event-counters` (admin-authed) shows live counts of:
  - `connector.invoke` per connector — who's using what.
  - `rate_limit.queue_full` per connector — what's hitting limits.
  - `refresh.success` / `refresh.failure` per OAuth connector — auto-refresh health.
  - `connector.connect` per connector — first-time connections.
  - `mission.run_kit` per kit — Kit usage.
  - `classifieds.drift.{ok|empty|failure}` per site — selector health.
- **Branch hygiene:** Render service tracks `main` (fixed 2026-04-29). Manual deploys via API with `commitId` pinned. autoDeploy intentionally off.

If you hit anything unexpected, the most useful starting points are:
- `~/.claude/projects/C--Users-SKYTONET-ironshield/memory/MEMORY.md` — durable session memory index.
- `backend/connectors/<name>/COMPLIANCE.md` — per-connector ToS + selector posture.
- `docs/auth-contract.md` — NEP-413 sig protocol if you need to script signed-fetch from outside the browser.
