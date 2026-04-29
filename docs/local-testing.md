# Local testing environment

A throw-away copy of AZUKA that runs entirely on your laptop —
test Postgres, test backend, test frontend. Everything resets every
time you tear it down. Use it for breaking-things experiments where
you don't want to touch the live deploy.

## What you get

- A fresh Postgres on `localhost:5433` (separate from any local
  Postgres you might already have on `:5432`)
- A backend on `localhost:3002` (separate from `:3001` so you can
  also run a "real" local backend side-by-side if you want)
- The Next.js frontend on `localhost:3000` pointed at the test
  backend
- Schema applied on first boot via the existing `migrate()` flow
- All state in RAM — `npm run test:db:down` wipes everything

## What it can't do

- Touch the production database (good)
- Send real Telegram messages, real push notifications, or real
  Cloudinary uploads — the example env unsets those keys
- Run mainnet contract calls — the example points at
  `ironshield-test.testnet`, so use the `alice-test.testnet` /
  `ironshield-test.testnet` keypairs from `~/.near-credentials/testnet/`

## First-time setup (5 minutes)

1. Install Docker Desktop if you don't have it.
2. Copy the env template:
   ```bash
   cp .env.test.example .env.test
   ```
   Open `.env.test` and replace `WS_TICKET_SECRET` with a random
   value (`openssl rand -hex 32`).
3. Spin up the test Postgres:
   ```bash
   npm run test:db:up
   ```
   First run pulls the `postgres:16-alpine` image (~80MB). Subsequent
   starts are instant.

## Daily flow

Two terminals:

```bash
# Terminal 1 — backend against test DB
npm run backend:test
# (logs that env is loaded, schema migrates, server listens on :3002)

# Terminal 2 — frontend
npm run dev
# (Next.js on :3000, NEXT_PUBLIC_BACKEND_URL points at :3002)
```

Or one terminal:

```bash
npm run dev:test
# concurrently runs backend:test + next dev
```

Browse to `http://localhost:3000`. Connect a testnet wallet
(Meteor/MyNearWallet/Here in testnet mode). The first wallet you
connect becomes admin (per `ADMIN_WALLET_SEED=alice-test.testnet`
in the template — change to your test wallet if you prefer).

## Wiping state

```bash
npm run test:db:down    # stop + delete the container + volume
npm run test:db:reset   # down + up (fresh schema on next backend boot)
```

Because the Postgres data lives on a `tmpfs` mount, even
`docker-compose stop` discards everything. The compose file is
deliberately volume-less.

## Running Playwright against this stack

Once Day 20's e2e/ scaffold lands on main:

```bash
npm run test:db:up
npm run dev:test                          # in one terminal
PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  PLAYWRIGHT_BACKEND_URL=http://localhost:3002 \
  npm run e2e                             # in another
```

The smoke specs (`e2e/smoke/`) run as-is. The critical-path stubs
in `e2e/critical/` need a stubbed-wallet fixture before they
activate — see `e2e/README.md`.

## Troubleshooting

- **"connection refused" on `:5433`** — `npm run test:db:up` didn't
  finish starting. The `--wait` flag holds until healthcheck passes;
  if it timed out, check Docker Desktop is running.
- **"too many clients already"** — you forgot to stop a prior backend
  process. `lsof -i :3002` to find the stragglers.
- **Schema migration fails on boot** — the backend's `migrate()`
  is idempotent, but a corrupted volume can still error. Run
  `npm run test:db:reset`.
- **Frontend hits the live backend instead of the test one** —
  Next.js caches `NEXT_PUBLIC_*` at build time. Restart `npm run dev`
  after editing `.env.test`.
- **CORS error in the browser** — the example env allows
  `http://localhost:3000` and `:3001`. If you ran the frontend on a
  different port, add it to `CORS_ALLOWED_ORIGINS` in `.env.test`.

## When NOT to use this stack

- **PgBouncer experiments at scale.** The local Postgres has its own
  connection cap (~100). For real PgBouncer rollout testing you'd
  need a Render preview env or a paid local Postgres tier with
  configurable `max_connections`.
- **Mainnet-state-dependent flows.** Anything that reads from the
  production NewsCoin/skills contracts needs the real RPC + accounts.
  Switch `.env.test` back to mainnet at your own risk; nothing here
  prevents it.
- **Concurrency tests.** The tmpfs-backed Postgres is fast but small.
  Don't run 1000-concurrent smokes against it.
