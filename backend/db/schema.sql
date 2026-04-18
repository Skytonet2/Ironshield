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
  dm_pubkey       TEXT,                 -- Curve25519 public key for E2E DMs (base64)
  last_post_tx    TEXT,                 -- last social.near tx hash (for tamper-evident posts)
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

CREATE TABLE IF NOT EXISTS feed_group_chats (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  created_by      INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_group_chat_members (
  id         SERIAL PRIMARY KEY,
  group_id   INTEGER REFERENCES feed_group_chats(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS feed_group_messages (
  id         SERIAL PRIMARY KEY,
  group_id   INTEGER REFERENCES feed_group_chats(id) ON DELETE CASCADE,
  from_id    INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_members_user ON feed_group_chat_members(user_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON feed_group_messages(group_id, created_at DESC);

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

-- Idempotent additive migrations (safe to re-run)
ALTER TABLE feed_users ADD COLUMN IF NOT EXISTS dm_pubkey TEXT;
ALTER TABLE feed_users ADD COLUMN IF NOT EXISTS last_post_tx TEXT;
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS onchain_tx TEXT;

-- ============================================================
-- Monetization: tips, gates, rooms, creator revenue
-- ============================================================

-- Tip rows. One row per tip sent. Tips can be in any NEAR-native or NEP-141
-- token; each row records the token contract, raw base-unit amount, and
-- the USD value frozen at tip time (used for aggregate glow-tier math and
-- creator revenue scoring). `anonymous=true` hides tipper_id from public
-- responses — the row still exists for 24h dedupe + moderation.
CREATE TABLE IF NOT EXISTS feed_tips (
  id                BIGSERIAL PRIMARY KEY,
  post_id           INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
  tipper_id         INTEGER REFERENCES feed_users(id) ON DELETE SET NULL,
  author_id         INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  token_contract    TEXT NOT NULL,           -- 'near' for native, else FT contract id
  token_symbol      TEXT NOT NULL,
  token_decimals    INTEGER NOT NULL,
  amount_base       NUMERIC(40,0) NOT NULL,  -- raw base units as string-safe numeric
  amount_human      NUMERIC(40,18) NOT NULL, -- human-readable for quick reads
  amount_usd        NUMERIC(20,6)  NOT NULL, -- USD value frozen at tip time
  anonymous         BOOLEAN NOT NULL DEFAULT FALSE,
  waived_treasury   BOOLEAN NOT NULL DEFAULT FALSE, -- new-wallet 10% split waiver
  tx_hash           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_tips_post    ON feed_tips(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_tips_author  ON feed_tips(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_tips_tipper  ON feed_tips(tipper_id, created_at DESC);
-- 24h dedupe check: "same tipper tipped this post today"
CREATE INDEX IF NOT EXISTS idx_feed_tips_dedupe  ON feed_tips(post_id, tipper_id, created_at);

-- Gate metadata stored inline on feed_posts. Null = ungated.
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS gate_type         TEXT;          -- 'balance' | 'tier' | 'allowlist'
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS gate_min_balance  NUMERIC(40,18);
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS gate_min_tier     TEXT;          -- 'Bronze' | 'Silver' | 'Gold' | 'Legendary'
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS gate_allowlist    JSONB;         -- array of wallet addresses

-- Flag a post as a validated insight (surface in creator scoring).
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS validated         BOOLEAN DEFAULT FALSE;

-- Cached staking amount for revenue-share multiplier; refreshed by stakingSync job.
ALTER TABLE feed_users ADD COLUMN IF NOT EXISTS staked_amount     NUMERIC(40,18) DEFAULT 0;

-- Long-form articles. kind = 'post' (default) or 'article'. Articles get a
-- title and lift the 500-char body limit (handled in posts.route.js).
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS kind  TEXT DEFAULT 'post';
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS title TEXT;

-- ============================================================
-- Live Alpha Rooms (voice + text)
-- ============================================================
CREATE TABLE IF NOT EXISTS feed_rooms (
  id                   SERIAL PRIMARY KEY,
  host_id              INTEGER REFERENCES feed_users(id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  topic                TEXT DEFAULT '',
  access_type          TEXT NOT NULL DEFAULT 'open', -- 'open' | 'token_gated' | 'invite_only'
  -- Host's stake. Any token; IRONCLAW when launched, else NEAR/USDC/etc.
  stake_token_contract TEXT NOT NULL DEFAULT 'near',
  stake_token_symbol   TEXT NOT NULL DEFAULT 'NEAR',
  stake_token_decimals INTEGER NOT NULL DEFAULT 24,
  stake_amount_base    NUMERIC(40,0) NOT NULL DEFAULT 0,
  stake_amount_human   NUMERIC(40,18) NOT NULL DEFAULT 0,
  stake_usd_frozen     NUMERIC(20,6)  NOT NULL DEFAULT 0,
  stake_tx_hash        TEXT,
  refund_tx_hash       TEXT,
  duration_mins        INTEGER NOT NULL DEFAULT 60,
  voice_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  recording_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Gating (token_gated / invite_only)
  access_min_balance   NUMERIC(40,18),
  access_min_tier      TEXT,
  access_allowlist     JSONB,
  -- LiveKit
  livekit_room_name    TEXT UNIQUE NOT NULL,
  -- Lifecycle
  started_at           TIMESTAMPTZ DEFAULT NOW(),
  ends_at              TIMESTAMPTZ NOT NULL,
  closed_at            TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'live', -- 'live' | 'closed'
  flagged_violations   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_feed_rooms_status ON feed_rooms(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_rooms_host   ON feed_rooms(host_id);
ALTER TABLE feed_rooms ADD COLUMN IF NOT EXISTS recording_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS feed_room_participants (
  id               BIGSERIAL PRIMARY KEY,
  room_id          INTEGER REFERENCES feed_rooms(id) ON DELETE CASCADE,
  user_id          INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'listener', -- 'host' | 'speaker' | 'listener'
  bot_probability  INTEGER NOT NULL DEFAULT 0,       -- 0..100, seeded from wallet
  hand_raised      BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at        TIMESTAMPTZ DEFAULT NOW(),
  left_at          TIMESTAMPTZ,
  UNIQUE(room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_rp_room ON feed_room_participants(room_id, left_at);

CREATE TABLE IF NOT EXISTS feed_room_messages (
  id              BIGSERIAL PRIMARY KEY,
  room_id         INTEGER REFERENCES feed_rooms(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES feed_users(id) ON DELETE SET NULL,
  content         TEXT NOT NULL,
  is_alpha_call   BOOLEAN NOT NULL DEFAULT FALSE,
  alpha_upvotes   INTEGER NOT NULL DEFAULT 0,
  alpha_downvotes INTEGER NOT NULL DEFAULT 0,
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_rm_room ON feed_room_messages(room_id, created_at DESC);

-- Push notification subscriptions (Web Push API / VAPID)
CREATE TABLE IF NOT EXISTS feed_push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  subscription JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_push_user ON feed_push_subscriptions(user_id);

-- ═══════════════════════════════════════════════════════════════
-- NewsCoin: tradeable news tokens on bonding curves
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS feed_newscoins (
  id SERIAL PRIMARY KEY,
  story_id TEXT NOT NULL,
  contract_address TEXT UNIQUE,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  creator TEXT NOT NULL,
  headline TEXT,
  mcap NUMERIC DEFAULT 0,
  mcap_usd NUMERIC DEFAULT 0,
  price NUMERIC DEFAULT 0,
  volume_24h NUMERIC DEFAULT 0,
  change_24h NUMERIC DEFAULT 0,
  trade_count INTEGER DEFAULT 0,
  graduated BOOLEAN DEFAULT FALSE,
  killed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_newscoins_story ON feed_newscoins(story_id);
CREATE INDEX IF NOT EXISTS idx_newscoins_creator ON feed_newscoins(creator);
CREATE INDEX IF NOT EXISTS idx_newscoins_mcap ON feed_newscoins(mcap_usd DESC);

CREATE TABLE IF NOT EXISTS feed_newscoin_trades (
  id SERIAL PRIMARY KEY,
  coin_id INTEGER REFERENCES feed_newscoins(id),
  trader TEXT NOT NULL,
  trade_type TEXT NOT NULL CHECK (trade_type IN ('buy', 'sell')),
  token_amount NUMERIC NOT NULL,
  near_amount NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  tx_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_newscoin_trades_coin ON feed_newscoin_trades(coin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feed_newscoin_holdings (
  coin_id INTEGER REFERENCES feed_newscoins(id),
  wallet TEXT NOT NULL,
  balance NUMERIC DEFAULT 0,
  cost_basis NUMERIC DEFAULT 0,
  PRIMARY KEY (coin_id, wallet)
);

CREATE TABLE IF NOT EXISTS feed_newscoin_sparklines (
  id SERIAL PRIMARY KEY,
  coin_id INTEGER REFERENCES feed_newscoins(id),
  price NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_newscoin_sparklines ON feed_newscoin_sparklines(coin_id, recorded_at DESC);
