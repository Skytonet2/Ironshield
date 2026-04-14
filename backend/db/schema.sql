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

-- ============================================================
-- IronFeed (social feed) — all tables prefixed `feed_*`
-- ============================================================

CREATE TABLE IF NOT EXISTS feed_users (
  id              SERIAL PRIMARY KEY,
  wallet_address  TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE,
  display_name    TEXT,
  bio             TEXT DEFAULT '',
  pfp_url         TEXT,
  banner_url      TEXT,
  account_type    TEXT DEFAULT 'HUMAN', -- HUMAN | AGENT | ORG
  verified        BOOLEAN DEFAULT FALSE,
  org_verified_at TIMESTAMPTZ,
  org_payment_tx  TEXT,
  delegate_pubkey TEXT,                 -- platform function-call access key (granted once)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_users_username ON feed_users(username);

CREATE TABLE IF NOT EXISTS feed_posts (
  id             SERIAL PRIMARY KEY,
  author_id      INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  content        TEXT NOT NULL,
  media_urls     TEXT[],                -- Cloudinary URLs
  media_type     TEXT DEFAULT 'NONE',   -- IMAGE | VIDEO | GIF | NONE
  repost_of_id   INTEGER REFERENCES feed_posts(id) ON DELETE SET NULL,
  quoted_post_id INTEGER REFERENCES feed_posts(id) ON DELETE SET NULL,
  post_hash      TEXT,                  -- sha256(content+author+timestamp)
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_feed_posts_author  ON feed_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_created ON feed_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS feed_likes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  post_id    INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_likes_post ON feed_likes(post_id);

CREATE TABLE IF NOT EXISTS feed_comments (
  id         SERIAL PRIMARY KEY,
  author_id  INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  post_id    INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_reposts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  post_id    INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, post_id)
);

CREATE TABLE IF NOT EXISTS feed_follows (
  id           SERIAL PRIMARY KEY,
  follower_id  INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  following_id INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_follows_follower  ON feed_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_feed_follows_following ON feed_follows(following_id);

CREATE TABLE IF NOT EXISTS feed_engagement (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  post_id      INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
  dwell_ms     INTEGER NOT NULL DEFAULT 0,
  session_date DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_engagement_user_post ON feed_engagement(user_id, post_id);

CREATE TABLE IF NOT EXISTS feed_conversations (
  id              SERIAL PRIMARY KEY,
  participant_a   INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  participant_b   INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participant_a, participant_b)
);

CREATE TABLE IF NOT EXISTS feed_dms (
  id                SERIAL PRIMARY KEY,
  conversation_id   INTEGER REFERENCES feed_conversations(id) ON DELETE CASCADE,
  from_id           INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  to_id             INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  encrypted_payload TEXT NOT NULL,      -- NaCl-encrypted ciphertext (base64)
  nonce             TEXT NOT NULL,      -- NaCl nonce (base64)
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_dms_conv ON feed_dms(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_ad_campaigns (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  post_id     INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
  budget_cents INTEGER NOT NULL DEFAULT 500,
  start_date  TIMESTAMPTZ DEFAULT NOW(),
  end_date    TIMESTAMPTZ,
  active      BOOLEAN DEFAULT TRUE,
  impressions INTEGER DEFAULT 0,
  payment_tx  TEXT
);
CREATE INDEX IF NOT EXISTS idx_feed_ads_active ON feed_ad_campaigns(active);

CREATE TABLE IF NOT EXISTS feed_ironclaw_agents (
  id              SERIAL PRIMARY KEY,
  owner_id        INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  deployed_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  monthly_fee_tx  TEXT,
  post_style      TEXT DEFAULT '',
  personality     TEXT[] DEFAULT '{}',  -- chips: Professional|Witty|...
  post_schedule   TEXT DEFAULT '',      -- cron string
  comment_rules   TEXT DEFAULT '',
  repost_rules    TEXT DEFAULT '',
  active          BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_feed_agents_owner ON feed_ironclaw_agents(owner_id);

CREATE TABLE IF NOT EXISTS feed_org_registrations (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  org_name        TEXT NOT NULL,
  payment_tx      TEXT NOT NULL,
  paid_at         TIMESTAMPTZ DEFAULT NOW(),
  badge_granted   BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS feed_batch_queue (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  action_type  TEXT NOT NULL,           -- like | repost | comment | post | follow
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  tx_hash      TEXT
);
CREATE INDEX IF NOT EXISTS idx_feed_batch_pending ON feed_batch_queue(processed_at) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS feed_notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,             -- like | comment | follow | repost | agent | ad
  actor_id   INTEGER REFERENCES feed_users(id) ON DELETE SET NULL,
  post_id    INTEGER REFERENCES feed_posts(id) ON DELETE SET NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_notifs_user ON feed_notifications(user_id, created_at DESC);
