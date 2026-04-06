-- IronShield Database Schema
-- PostgreSQL 14+

-- Users (Telegram users + NEAR wallet links)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  telegram_id   TEXT UNIQUE,
  near_wallet   TEXT,
  username      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_wallet   ON users(near_wallet);

-- Tracked wallets per user (portfolio)
CREATE TABLE IF NOT EXISTS wallets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  address    TEXT NOT NULL,
  chain      TEXT DEFAULT 'near',
  label      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, address)
);

-- Contests / Missions
CREATE TABLE IF NOT EXISTS contests (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  reward      TEXT,
  difficulty  TEXT DEFAULT 'medium',
  status      TEXT DEFAULT 'active', -- active, ended, upcoming
  start_date  TIMESTAMPTZ DEFAULT NOW(),
  end_date    TIMESTAMPTZ,
  created_by  TEXT, -- near wallet of creator
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Contest submissions
CREATE TABLE IF NOT EXISTS submissions (
  id          SERIAL PRIMARY KEY,
  contest_id  INTEGER REFERENCES contests(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  proof_link  TEXT,
  notes       TEXT,
  image_url   TEXT,
  status      TEXT DEFAULT 'pending', -- pending, approved, rejected
  reviewed_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contest_id, user_id)
);

-- Leaderboard scores
CREATE TABLE IF NOT EXISTS leaderboard (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  points     INTEGER DEFAULT 0,
  rank_tier  TEXT DEFAULT 'bronze', -- bronze, silver, gold, diamond
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Governance proposals cache (mirrors on-chain data)
CREATE TABLE IF NOT EXISTS proposals (
  id              SERIAL PRIMARY KEY,
  chain_id        INTEGER UNIQUE, -- on-chain proposal ID
  title           TEXT NOT NULL,
  description     TEXT,
  proposal_type   TEXT NOT NULL, -- Mission, PromptUpdate, RuleChange
  proposer        TEXT NOT NULL, -- near wallet
  content         TEXT,
  votes_for       INTEGER DEFAULT 0,
  votes_against   INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active', -- active, passed, rejected, executed
  executed        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  executed_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_type   ON proposals(proposal_type);

-- User votes on proposals
CREATE TABLE IF NOT EXISTS votes (
  id          SERIAL PRIMARY KEY,
  proposal_id INTEGER REFERENCES proposals(id) ON DELETE CASCADE,
  user_wallet TEXT NOT NULL,
  vote        TEXT NOT NULL, -- for, against
  power       NUMERIC DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(proposal_id, user_wallet)
);

-- Security: flagged URLs and wallets
CREATE TABLE IF NOT EXISTS flagged_urls (
  id         SERIAL PRIMARY KEY,
  url        TEXT NOT NULL,
  domain     TEXT,
  reason     TEXT,
  severity   TEXT DEFAULT 'medium', -- low, medium, high, critical
  reported_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flagged_domain ON flagged_urls(domain);

CREATE TABLE IF NOT EXISTS flagged_wallets (
  id          SERIAL PRIMARY KEY,
  address     TEXT UNIQUE NOT NULL,
  chain       TEXT DEFAULT 'near',
  reason      TEXT,
  severity    TEXT DEFAULT 'medium',
  reported_by TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Bot conversation log (for context in DMs)
CREATE TABLE IF NOT EXISTS conversations (
  id         SERIAL PRIMARY KEY,
  chat_id    TEXT NOT NULL,
  user_id    TEXT,
  role       TEXT NOT NULL, -- user, assistant
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_chat ON conversations(chat_id, created_at DESC);

-- Tracked groups for daily summaries
CREATE TABLE IF NOT EXISTS tracked_groups (
  id       SERIAL PRIMARY KEY,
  chat_id  TEXT UNIQUE NOT NULL,
  name     TEXT,
  added_by TEXT,
  active   BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Price alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  chat_id    TEXT NOT NULL,
  token_id   TEXT NOT NULL, -- coingecko ID
  token      TEXT NOT NULL, -- display name
  alert_type TEXT NOT NULL, -- price_above, price_below
  threshold  NUMERIC NOT NULL,
  triggered  BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
