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
-- Nested-thread support: a comment can reply to another comment in
-- the same post. NULL = top-level. ON DELETE SET NULL keeps child
-- comments alive if the parent is deleted; the UI shows "in reply
-- to a deleted comment." Added via ALTER so existing deployments
-- pick it up on next migrate() without a manual step.
ALTER TABLE feed_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id INTEGER REFERENCES feed_comments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_comments_parent ON feed_comments(parent_comment_id) WHERE parent_comment_id IS NOT NULL;

-- Likes on comments. Mirrors feed_likes shape; UNIQUE constraint
-- gives us idempotent toggles + uniqueness without a separate
-- constraint. ON DELETE CASCADE so likes vanish with their parent.
CREATE TABLE IF NOT EXISTS feed_comment_likes (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES feed_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_comment_likes_comment ON feed_comment_likes(comment_id);

-- Quote-repost a comment. When a user "reposts" a comment, we
-- create a NEW feed_post with quoted_comment_id pointing at the
-- referenced comment + optional body text — same pattern as
-- quoted_post_id for post quotes. The comment row itself isn't
-- modified; the renderer fetches + embeds the quoted comment by id.
ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS quoted_comment_id INTEGER REFERENCES feed_comments(id) ON DELETE SET NULL;

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

-- Per-message reply target. Nullable — most messages aren't replies.
-- ON DELETE SET NULL keeps the replying message alive if its parent
-- is removed; the UI falls back to "Replying to a deleted message".
-- IF NOT EXISTS (pg 9.6+) so existing deployments pick it up on the
-- next migrate() run without a manual step.
ALTER TABLE feed_group_messages
  ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES feed_group_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_group_members_user ON feed_group_chat_members(user_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON feed_group_messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_reply ON feed_group_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

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
-- Day 8.2: per-message delivery state. read_at already exists.
ALTER TABLE feed_dms ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
-- v1.1: ciphertext envelope format version. 0 (or NULL) = legacy
-- nacl.box bytes, no fingerprints. 1 = nacl.box bytes + sender/recipient
-- fingerprints (Day 8.3 rows). Future versions slot in here without
-- another schema change. Decoders branch on this column; legacy rows
-- still decrypt via the v0 path.
ALTER TABLE feed_dms ADD COLUMN IF NOT EXISTS format_version SMALLINT NOT NULL DEFAULT 0;

-- v1.1: DM safety numbers (out-of-band pubkey verification). One row
-- per (viewer, peer) — the viewer has compared the peer's pubkey
-- fingerprint via a side channel and marked it as theirs. We store
-- the fingerprint AT verify time so a later peer rotation surfaces
-- as a mismatch ("their key changed since you verified") rather than
-- silently grandfathering the new key.
CREATE TABLE IF NOT EXISTS feed_dm_verifications (
  viewer_wallet     TEXT NOT NULL,
  peer_wallet       TEXT NOT NULL,
  peer_pubkey_fp    TEXT NOT NULL,
  verified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (viewer_wallet, peer_wallet)
);
CREATE INDEX IF NOT EXISTS idx_dm_verifications_viewer ON feed_dm_verifications(viewer_wallet);

-- v1.1: AI-evaluated automation triggers (Day 12.3 deferred). The
-- worker walks new feed_posts since the last id it evaluated for
-- this rule, calls classify() per item, and fires the action when
-- match=true. ai_last_id is the cursor; default 0 means "haven't
-- evaluated anything yet" so the first tick after enable starts
-- from the most recent posts (worker clamps to a lookback window
-- to avoid blasting through the whole archive).
ALTER TABLE agent_automations ADD COLUMN IF NOT EXISTS ai_last_id INTEGER NOT NULL DEFAULT 0;

-- v1.1: group-chat E2E (sender-keys flavor). Opt-in at group creation
-- — owner mints a 32-byte symmetric key, wraps it via nacl.box to
-- each member's dm_pubkey, and POSTs the wraps. Encrypted send/list
-- branch on whether feed_group_messages.encrypted_content is set; the
-- existing plaintext `content` column stays for legacy rows AND for
-- groups that never opted in (existing groups continue to behave as
-- before).
ALTER TABLE feed_group_chats ADD COLUMN IF NOT EXISTS e2e_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE feed_group_messages ADD COLUMN IF NOT EXISTS encrypted_content TEXT;
ALTER TABLE feed_group_messages ADD COLUMN IF NOT EXISTS nonce             TEXT;
ALTER TABLE feed_group_messages ADD COLUMN IF NOT EXISTS sender_key_fp     TEXT;
-- One wrapped copy of the group symmetric key per (group, member).
-- The owner is the only writer (writes their wraps on creation, and
-- writes new wraps when adding members). Members read their own row
-- on first decrypt and cache the unwrapped key client-side.
CREATE TABLE IF NOT EXISTS feed_group_keys (
  group_id            INTEGER NOT NULL REFERENCES feed_group_chats(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES feed_users(id)       ON DELETE CASCADE,
  wrapped_key         TEXT    NOT NULL,
  wrap_nonce          TEXT    NOT NULL,
  wrapped_by_pubkey   TEXT    NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_keys_user ON feed_group_keys(user_id);
-- Day 8.3: per-message key fingerprints so the recipient can locate
-- the matching secret key even after their wallet has rotated keys.
-- 16-hex-char prefix of BLAKE2b(pubkey raw bytes); collision-resistant
-- enough to distinguish the handful of keys a single wallet ever holds.
-- Nullable: legacy rows from before 8.3 stay readable via the current
-- keypair (the only keypair the client knew about back then).
ALTER TABLE feed_dms ADD COLUMN IF NOT EXISTS sender_key_fp TEXT;
ALTER TABLE feed_dms ADD COLUMN IF NOT EXISTS recipient_key_fp TEXT;

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

-- DM presence (Day 8.x follow-up). Updated by feedHub on every WS
-- disconnect — represents the wall-clock time the user's last
-- authed socket closed. NULL for users who've never connected.
-- Online state is derived live from feedHub.hasAuthedSocket(); this
-- column only carries the offline "last seen" timestamp.
ALTER TABLE feed_users ADD COLUMN IF NOT EXISTS last_seen_at      TIMESTAMPTZ;

-- Onboarding completion timestamp. NULL = first-time user; needs to
-- run through the username/display-name/pfp/banner setup modal. Set
-- by POST /api/profile/onboard once the modal submits.
--
-- Existing rows pre-migration are NULL by default. They'll see the
-- modal once on next visit — that's a feature, not a bug: they have
-- auto-generated usernames + display names from their wallet prefix
-- and the modal is their chance to set real ones. They can submit
-- with whatever values are pre-filled if they like the defaults.
ALTER TABLE feed_users ADD COLUMN IF NOT EXISTS onboarded_at      TIMESTAMPTZ;

-- Referral system. ref_code is the user's invite code (auto-generated
-- on first /api/rewards/me; customizable via POST /api/rewards/ref-code).
-- referrer_id points back to the inviter once
-- /api/rewards/claim-referrer lands a /?ref=<code> visit.
--
-- backend/routes/rewards.route.js falls back to an in-process Map when
-- these columns aren't present — that fallback wipes on every Render
-- redeploy, which is why pre-this-migration codes never persisted.
-- ON DELETE SET NULL on referrer_id keeps the invitee's row alive if
-- the inviter ever deletes their account.
ALTER TABLE feed_users ADD COLUMN IF NOT EXISTS ref_code          TEXT;
ALTER TABLE feed_users ADD COLUMN IF NOT EXISTS referrer_id       INTEGER REFERENCES feed_users(id) ON DELETE SET NULL;
-- Case-insensitive uniqueness: rewards.route.js looks up via
-- LOWER(ref_code)=LOWER($1) and POST /ref-code rejects duplicates
-- through codeInUse(). Partial keeps NULL rows cheap.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_users_ref_code_lower
  ON feed_users (LOWER(ref_code)) WHERE ref_code IS NOT NULL;
-- Index for /me's referral count: SELECT COUNT(*) FROM feed_users
-- WHERE referrer_id=$1.
CREATE INDEX IF NOT EXISTS idx_feed_users_referrer
  ON feed_users (referrer_id) WHERE referrer_id IS NOT NULL;

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
-- Day 19 — LiveKit Egress wiring. egress_id is opaque to us; recording_url
-- is the final S3 object URL once egress reports EGRESS_COMPLETE. Both
-- stay null until the host first toggles recording on with creds set.
ALTER TABLE feed_rooms ADD COLUMN IF NOT EXISTS recording_egress_id  TEXT;
ALTER TABLE feed_rooms ADD COLUMN IF NOT EXISTS recording_started_at TIMESTAMPTZ;
ALTER TABLE feed_rooms ADD COLUMN IF NOT EXISTS recording_ended_at   TIMESTAMPTZ;
ALTER TABLE feed_rooms ADD COLUMN IF NOT EXISTS recording_url        TEXT;

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

-- ─── Telegram bot integration ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feed_tg_links (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES feed_users(id) ON DELETE SET NULL,
  tg_id BIGINT UNIQUE NOT NULL,
  tg_chat_id BIGINT NOT NULL,
  tg_username TEXT,
  wallets TEXT[] DEFAULT '{}',
  active_wallet TEXT,
  settings JSONB DEFAULT '{"likes":true,"reposts":true,"comments":true,"follows":true,"tips":true,"dms":true,"coin_created":true,"pump":true,"alpha":true,"downtime":true}'::jsonb,
  link_code TEXT,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_links_user ON feed_tg_links(user_id);
CREATE INDEX IF NOT EXISTS idx_tg_links_active_wallet ON feed_tg_links(LOWER(active_wallet));

CREATE TABLE IF NOT EXISTS feed_tg_link_codes (
  code TEXT PRIMARY KEY,
  wallet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS feed_tg_watchlist (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tg_id, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_tg_watchlist_tg ON feed_tg_watchlist(tg_id);

CREATE TABLE IF NOT EXISTS feed_tg_price_alerts (
  id SERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL,
  token TEXT NOT NULL,
  op TEXT NOT NULL,
  value NUMERIC NOT NULL,
  base_price NUMERIC,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  triggered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tg_alerts_active ON feed_tg_price_alerts(active, token);

CREATE TABLE IF NOT EXISTS feed_tg_reply_map (
  tg_msg_id BIGINT PRIMARY KEY,
  tg_chat_id BIGINT NOT NULL,
  conversation_id INTEGER NOT NULL,
  user_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tg_reply_conv ON feed_tg_reply_map(conversation_id);

-- ============================================================
-- Group chat extensions: public handle, invite link, pfp
-- ============================================================
ALTER TABLE feed_group_chats ADD COLUMN IF NOT EXISTS handle       TEXT;
ALTER TABLE feed_group_chats ADD COLUMN IF NOT EXISTS invite_token TEXT;
ALTER TABLE feed_group_chats ADD COLUMN IF NOT EXISTS pfp_url      TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_group_chats_handle ON feed_group_chats(LOWER(handle)) WHERE handle IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_group_chats_invite ON feed_group_chats(invite_token) WHERE invite_token IS NOT NULL;

-- ============================================================
-- IronFeed "Voices" tab — per-wallet X/Twitter handle follow list.
-- Each row is (wallet, handle) with handle normalized case-insensitively
-- via the unique index. Missing rows = wallet hasn't customized their
-- list and the xfeed route falls back to the curated CT preset.
-- ============================================================
CREATE TABLE IF NOT EXISTS feed_xfeed_follows (
  id SERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  handle TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_xfeed_follows_unique ON feed_xfeed_follows(wallet, LOWER(handle));
CREATE INDEX IF NOT EXISTS idx_xfeed_follows_wallet ON feed_xfeed_follows(wallet);

-- ============================================================
-- Platform build Phase 0 — additive schema for trading terminal,
-- Coin It, impression tracking, and per-user mute list.
--
-- feed_users.account_type='AGENT' + verified cover the news bot's
-- is_bot/is_verified flags (no new columns). The bot is seeded in
-- the news-bot cron as an AGENT feed_user row with verified=true.
-- ============================================================

-- Cached impression count on each post (denormalized for fast reads).
-- Source of truth is feed_post_impressions; this counter is bumped in
-- the same transaction when a new (user, post, session) row is
-- inserted — never from feed_engagement, which is the dwell-time
-- ledger and records multiple rows per session.
ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS impressions INTEGER DEFAULT 0;

-- One row per (user, post, session_date). INSERT ... ON CONFLICT DO
-- NOTHING gives the spec's "one impression per user per post per
-- session" dedupe without any application-side bookkeeping. Authors
-- are filtered in the route — never in SQL — so an author's own
-- views short-circuit before we hit the DB.
CREATE TABLE IF NOT EXISTS feed_post_impressions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  post_id      INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
  session_date DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_post_impressions_uniq
  ON feed_post_impressions(user_id, post_id, session_date);
CREATE INDEX IF NOT EXISTS idx_feed_post_impressions_post
  ON feed_post_impressions(post_id);

-- Per-user mute list. Target can be any feed_user (including the
-- IronNews agent) — UI filters these out before render. Separate
-- from feed_follows so unfollowing and muting are independent.
CREATE TABLE IF NOT EXISTS feed_muted_accounts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  muted_user_id INTEGER REFERENCES feed_users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, muted_user_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_muted_user ON feed_muted_accounts(user_id);

-- Open + historical positions from the multi-chain trading terminal.
-- `wallet` holds whichever chain-appropriate address the trade was
-- signed from (NEAR implicit, SOL base58, EVM hex). Not tied to a
-- feed_users row because Privy-only users trade without creating
-- a feed_users entry until they post. One row per position; closed
-- trades set closed_at + realized_pnl_usd rather than deleting so
-- trade_history can replay.
CREATE TABLE IF NOT EXISTS trade_positions (
  id                BIGSERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES feed_users(id) ON DELETE SET NULL,
  wallet            TEXT NOT NULL,
  chain             TEXT NOT NULL CHECK (chain IN ('near','sol','bnb')),
  token_address     TEXT NOT NULL,       -- pair / mint / contract
  token_symbol      TEXT NOT NULL,
  token_decimals    INTEGER NOT NULL,
  -- Entry side. `amount_base` is the token balance the position was
  -- opened with; `cost_basis_usd` freezes the USD at fill time.
  amount_base       NUMERIC(40,0) NOT NULL,
  entry_price_usd   NUMERIC(30,12) NOT NULL,
  cost_basis_usd    NUMERIC(20,6)  NOT NULL,
  entry_tx_hash     TEXT,
  -- Close side. Null on open positions; the UI reads `realized_pnl_usd`
  -- for closed rows and computes unrealized from live price for open.
  closed_at         TIMESTAMPTZ,
  close_price_usd   NUMERIC(30,12),
  realized_pnl_usd  NUMERIC(20,6),
  close_tx_hash     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trade_positions_wallet_open
  ON trade_positions(wallet, chain) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trade_positions_user
  ON trade_positions(user_id, created_at DESC);

-- 0.2% platform fee audit log. One row per collected fee, written in
-- the same unit of work as the swap — if the swap fails, no row. The
-- route reconciles `fee_tx_hash` when the atomic/adjacent fee transfer
-- confirms, so a row with NULL fee_tx_hash == in-flight; ops can query
-- these to catch stuck transfers. Platform wallet addresses live in
-- env (PLATFORM_WALLET_{NEAR,SOL,BNB}) — we never hardcode them here.
CREATE TABLE IF NOT EXISTS trade_fees (
  id                BIGSERIAL PRIMARY KEY,
  position_id       BIGINT REFERENCES trade_positions(id) ON DELETE SET NULL,
  user_id           INTEGER REFERENCES feed_users(id) ON DELETE SET NULL,
  wallet            TEXT NOT NULL,
  chain             TEXT NOT NULL CHECK (chain IN ('near','sol','bnb')),
  token_in          TEXT NOT NULL,
  token_out         TEXT NOT NULL,
  amount_in_base    NUMERIC(40,0) NOT NULL,
  fee_amount_base   NUMERIC(40,0) NOT NULL,
  fee_amount_usd    NUMERIC(20,6)  NOT NULL,
  swap_tx_hash      TEXT,
  fee_tx_hash       TEXT,                  -- null until fee transfer confirms
  platform_wallet   TEXT NOT NULL,         -- destination (echoed for audit)
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trade_fees_pending
  ON trade_fees(created_at DESC) WHERE fee_tx_hash IS NULL;
CREATE INDEX IF NOT EXISTS idx_trade_fees_user
  ON trade_fees(user_id, created_at DESC);

-- "Coin It" conversion log: which source (feed post or news article)
-- produced which token. One row per successful launch. External
-- launchpad flows (Pump.fun, meme.cooking, four.meme, …) record
-- platform='pump.fun' etc. with a null coin_address since those live
-- outside our on-chain index. Analytics reads this to rank sources
-- by launch success rate.
CREATE TABLE IF NOT EXISTS coin_it_events (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            INTEGER REFERENCES feed_users(id) ON DELETE SET NULL,
  source_type        TEXT NOT NULL CHECK (source_type IN ('post','news','external')),
  source_post_id     INTEGER REFERENCES feed_posts(id) ON DELETE SET NULL,
  source_url         TEXT,
  chain              TEXT NOT NULL CHECK (chain IN ('near','sol','bnb')),
  platform           TEXT NOT NULL,         -- 'ironshield' | 'pump.fun' | 'meme.cooking' | …
  name               TEXT NOT NULL,
  ticker             TEXT NOT NULL,
  coin_address       TEXT,                  -- null for external redirects
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coin_it_events_user ON coin_it_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coin_it_events_source ON coin_it_events(source_post_id);

-- ============================================================
-- Telegram notifications — additional toggles + custodial bot
-- account columns (Phase 7).
--
-- Settings JSONB extended with room_start, group_msg, voice_post,
-- recruit_post. Existing rows keep working; the missing keys are
-- treated as "true" in tgNotify's check (opt-out model).
--
-- Custodial bot account columns let the TG bot execute /swap, /send,
-- /withdraw on behalf of the user without requiring a per-tx wallet
-- popup. Private key is AES-256-GCM encrypted at rest using
-- process.env.CUSTODIAL_ENCRYPT_KEY (generated once, stored in
-- /secrets/platform-wallets.json). On-chain account is a NEAR
-- implicit account (64-char hex of the ed25519 public key) — costs
-- zero NEAR to "create" since implicit accounts materialize on
-- first deposit.
-- ============================================================

-- Additional setting keys added to the default JSONB. Existing rows
-- keep whatever settings they had; new rows get the expanded defaults.
ALTER TABLE feed_tg_links
  ALTER COLUMN settings SET DEFAULT
    '{"likes":true,"reposts":true,"comments":true,"follows":true,"tips":true,"dms":true,"coin_created":true,"pump":true,"alpha":true,"downtime":true,"room_start":true,"group_msg":true,"voice_post":true,"recruit_post":true}'::jsonb;

-- Custodial bot-account columns. Null until the user first /starts
-- the bot, then minted once and reused forever. bot_key_encrypted is
-- a base64-encoded {iv,tag,ciphertext} payload — format documented
-- in backend/services/custodialBotWallet.js. Never expose these in
-- any API response.
ALTER TABLE feed_tg_links ADD COLUMN IF NOT EXISTS bot_account_id    TEXT;
ALTER TABLE feed_tg_links ADD COLUMN IF NOT EXISTS bot_public_key    TEXT;
ALTER TABLE feed_tg_links ADD COLUMN IF NOT EXISTS bot_key_encrypted TEXT;
ALTER TABLE feed_tg_links ADD COLUMN IF NOT EXISTS bot_created_at    TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_links_bot_account
  ON feed_tg_links(bot_account_id) WHERE bot_account_id IS NOT NULL;

-- Bot activation: one-time $5-in-NEAR fee to fees.ironshield.near
-- that unlocks /swap /send /withdraw. Covers IronClaw agent-usage
-- costs (LLM call + infra). `activated_tx_hash` is the on-chain
-- proof so activations can be audited without hitting Nearblocks.
ALTER TABLE feed_tg_links ADD COLUMN IF NOT EXISTS activated_at      TIMESTAMPTZ;
ALTER TABLE feed_tg_links ADD COLUMN IF NOT EXISTS activated_tx_hash TEXT;
ALTER TABLE feed_tg_links ADD COLUMN IF NOT EXISTS activation_near   NUMERIC(40,18);
ALTER TABLE feed_tg_links ADD COLUMN IF NOT EXISTS activation_usd    NUMERIC(10,2);

-- ── Phase 8 staging: external-framework agent connections ─────────────
-- IronShield is a launchpad + control plane on top of agent frameworks
-- (OpenClaw / IronClaw / self-hosted). On-chain register_agent stays
-- the source of truth for identity; this table stores the framework
-- credentials + endpoint that on-chain rows can't safely hold (API
-- keys, bot tokens, webhook secrets). Promoted to chain in Phase 8
-- once the shape stabilises — until then this is the live store the
-- adapters read from.
--
-- One row per (owner, agent_account, framework) tuple — an owner CAN
-- connect the same agent to multiple frameworks simultaneously, e.g.
-- the same handle linked to both OpenClaw and a webhook fallback.
CREATE TABLE IF NOT EXISTS agent_connections (
  id              SERIAL PRIMARY KEY,
  owner           TEXT NOT NULL,                            -- NEAR account (parent)
  agent_account   TEXT NOT NULL,                            -- agent's NEAR account (e.g. agent2.alice.near)
  framework       TEXT NOT NULL,                            -- 'openclaw' | 'ironclaw' | 'self_hosted'
  external_id     TEXT,                                     -- agent id inside the framework
  endpoint        TEXT,                                     -- base URL we POST to
  auth_encrypted  TEXT,                                     -- AES-256-GCM blob (API key / token / HMAC secret)
  status          TEXT NOT NULL DEFAULT 'pending',          -- pending | active | disconnected
  last_seen       TIMESTAMPTZ,                              -- updated by health poll
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,       -- framework-specific extras (HMAC alg, ironclaw thread id, etc.)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner, agent_account, framework)
);
CREATE INDEX IF NOT EXISTS idx_agent_connections_owner   ON agent_connections(owner);
CREATE INDEX IF NOT EXISTS idx_agent_connections_account ON agent_connections(agent_account);

-- ── Automation rules ──────────────────────────────────────────────────
-- Cross-framework if-this-then-that rules. The orchestrator polls the
-- triggers, asks the user's agent for LLM judgement when needed, and
-- fires the action. Rules live off-chain (volume + iteration speed)
-- but their fingerprint will be promoted on-chain in Phase 9 once
-- the trigger / action vocabulary stabilises.
--
-- Trigger types (`trigger.type`):
--   schedule  — cron expression in `trigger.cron`, evaluated UTC
--   webhook   — fires on POST /api/agents/automations/:id/fire
--   message   — fires when the agent receives a message via sandbox
--
-- Action types (`action.type`):
--   ask_agent       — sends `action.prompt` to the agent and stores reply
--   call_skill      — invokes an installed Phase-7 skill (skill_id in action)
--   webhook_out     — POSTs `action.payload` to action.url
--
-- We keep both blobs free-form JSON so adding a new trigger or action
-- type doesn't require a migration.
CREATE TABLE IF NOT EXISTS agent_automations (
  id              SERIAL PRIMARY KEY,
  owner           TEXT NOT NULL,
  agent_account   TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  trigger         JSONB NOT NULL,                          -- { type, cron?, channel?, ... }
  action          JSONB NOT NULL,                          -- { type, prompt?, url?, skill_id?, ... }
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at     TIMESTAMPTZ,
  last_run_status TEXT,                                    -- 'ok' | 'error'
  last_run_output TEXT,
  next_run_at     TIMESTAMPTZ,                             -- pre-computed for schedule triggers
  run_count       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_automations_owner   ON agent_automations(owner);
CREATE INDEX IF NOT EXISTS idx_automations_account ON agent_automations(agent_account);
CREATE INDEX IF NOT EXISTS idx_automations_due
  ON agent_automations(next_run_at) WHERE enabled = TRUE AND next_run_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_automation_runs (
  id           SERIAL PRIMARY KEY,
  automation_id INTEGER NOT NULL REFERENCES agent_automations(id) ON DELETE CASCADE,
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source       TEXT NOT NULL,                              -- 'schedule' | 'webhook' | 'manual'
  status       TEXT NOT NULL,                              -- 'ok' | 'error'
  output       TEXT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_aid ON agent_automation_runs(automation_id, fired_at DESC);

-- ── Avatar uploads ────────────────────────────────────────────────────
-- One row per uploaded avatar image. Resized to 256×256 JPEG client-
-- side before upload, so each row is bounded (≈30–60KB typical). The
-- SHA-256 column lets us de-duplicate identical uploads and serve the
-- same id for repeats. Uploads are owned by the wallet that uploaded
-- them — overwrite-protected via UNIQUE(owner, sha256).
CREATE TABLE IF NOT EXISTS agent_avatars (
  id            SERIAL PRIMARY KEY,
  owner         TEXT NOT NULL,
  agent_account TEXT,                                       -- nullable: pre-launch uploads
  content_type  TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes         BYTEA NOT NULL,
  sha256        TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner, sha256)
);
CREATE INDEX IF NOT EXISTS idx_agent_avatars_owner ON agent_avatars(owner);

-- ── Auth nonces (NEP-413 signed-message auth) ─────────────────────────
-- One row per nonce issued via GET /api/auth/nonce. Marked used by
-- the requireWallet middleware on the first valid signed request that
-- consumes it. Layout, TTL, and verification rules: docs/auth-contract.md.
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce      TEXT        PRIMARY KEY,         -- base64url of 32 random bytes
  wallet     TEXT,                            -- NULL until consumed
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_nonces_active_idx
  ON auth_nonces (issued_at) WHERE used_at IS NULL;

-- ── Admin wallet allowlist (replaces NEXT_PUBLIC_ADMIN_PW) ────────────
-- One row per wallet that may access AdminPanel + admin-only mutations.
-- Seeded from $ADMIN_WALLET_SEED on first boot if the table is empty,
-- so a fresh deploy isn't locked out. After that, manage rows directly
-- via SQL — no admin-management UI in v1 by design.
CREATE TABLE IF NOT EXISTS admin_wallets (
  wallet               TEXT        PRIMARY KEY,
  role                 TEXT        NOT NULL DEFAULT 'admin',
  daily_ai_budget_usd  NUMERIC,
  added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Agent runtime state (Day 3.2 — replaces 4 mutable JSON files) ─────
-- Single key→jsonb store for IronClaw runtime config + listener state.
-- Replaces agent/activePrompt.json, agent/activeMission.json,
-- agent/listenerState.json, and agent/loopState.json — those lived on
-- ephemeral container disk, which meant duplicate Telegram pushes after
-- every Render restart and lost prompt updates on cold deploys.
--
-- Used keys (informal, no constraint):
--   activePrompt    — { content, updatedAt, proposalId }
--   activeMission   — { content, updatedAt, proposalId }
--   listenerState   — { lastSeenId, announcedIds: { created, finalized, executed } }
--   loopState       — autonomousLoop.js bookkeeping
CREATE TABLE IF NOT EXISTS agent_state (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Media upload audit + per-wallet daily quota (Day 5.1) ─────────────
-- One row per successful upload. The quota check is a 24-hour rolling
-- count keyed on `wallet`. Admins (admin_wallets) bypass the cap; for
-- everyone else: default 10/day. The index keeps the COUNT query off
-- the heap.
CREATE TABLE IF NOT EXISTS media_uploads (
  id          SERIAL      PRIMARY KEY,
  wallet      TEXT        NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bytes       INTEGER     NOT NULL,
  content_type TEXT       NOT NULL,
  url         TEXT        NOT NULL,
  host        TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_uploads_wallet_at
  ON media_uploads (wallet, uploaded_at DESC);

-- ── Per-wallet AI $ cap (Day 5.3) ────────────────────────────────────
-- wallet_budgets: per-wallet daily cap in USD. Missing rows default to
-- the constant in aiBudget.js. Admins (admin_wallets row) get
-- admin_wallets.daily_ai_budget_usd instead — see aiBudget.getBudget.
CREATE TABLE IF NOT EXISTS wallet_budgets (
  wallet              TEXT       PRIMARY KEY,
  daily_ai_budget_usd NUMERIC    NOT NULL DEFAULT 5.0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- wallet_ai_spend: today's accumulated cost. Row keyed (wallet, day).
-- Updated via UPSERT after each NEAR AI call lands.
CREATE TABLE IF NOT EXISTS wallet_ai_spend (
  wallet    TEXT    NOT NULL,
  day       DATE    NOT NULL,
  cost_usd  NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (wallet, day)
);

-- ── Skill sales (Day 16) ──────────────────────────────────────────────
-- One row per successful install_skill purchase indexed off-chain. The
-- on-chain event emits {owner, skill_id, price_yocto, paid}; we derive
-- creator_take_yocto = price * 0.99 and treasury_take_yocto = price * 0.01
-- to match the contract's hardcoded PLATFORM_FEE_BPS at index time. If
-- the platform cut ever changes on-chain, indexer math diverges — for
-- v1 the cut is fixed so this is fine.
--
-- tx_hash is the dedupe key: a paranoid double-call to the verify
-- endpoint or a future block-scanning backfill won't double-count.
-- paid=false rows are skipped at index time — free installs aren't
-- revenue and would skew the dashboards.
CREATE TABLE IF NOT EXISTS skill_sales (
  tx_hash             TEXT        PRIMARY KEY,
  block_height        BIGINT,
  skill_id            TEXT        NOT NULL,
  buyer_wallet        TEXT        NOT NULL,
  creator_wallet      TEXT        NOT NULL,
  price_yocto         NUMERIC(40,0) NOT NULL,
  creator_take_yocto  NUMERIC(40,0) NOT NULL,
  treasury_take_yocto NUMERIC(40,0) NOT NULL,
  sold_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_sales_creator ON skill_sales (creator_wallet, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_sales_skill   ON skill_sales (skill_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_sales_sold_at ON skill_sales (sold_at DESC);

-- ── Hot-path indexes (Day 6.1) ────────────────────────────────────────
-- Functional and partial indexes added after auditing every pool.query
-- callsite in backend/routes against existing schema coverage. Each
-- entry below corresponds to a query that fires per page-load or per
-- user action and was demonstrably index-less prior to this section.

-- feed_users wallet/username lookup. Every profile, DM, social,
-- tips, and posts route resolves identity via
-- `WHERE LOWER(wallet_address)=$1 OR LOWER(username)=$1`. The raw
-- UNIQUE on wallet_address and idx_feed_users_username don't apply
-- under LOWER(); functional indexes do. Postgres planner unions both
-- via BitmapOr for the OR'd lookup.
CREATE INDEX IF NOT EXISTS idx_feed_users_wallet_lower
  ON feed_users (LOWER(wallet_address));
CREATE INDEX IF NOT EXISTS idx_feed_users_username_lower
  ON feed_users (LOWER(username));

-- Profile post list and post-count: `WHERE author_id=$1 AND deleted_at
-- IS NULL ORDER BY created_at DESC LIMIT 50`. Existing
-- idx_feed_posts_author finds the rows but forces a sort + post-filter;
-- this partial index pre-orders and skips deleted rows, so the LIMIT 50
-- is a straight scan of the index head.
CREATE INDEX IF NOT EXISTS idx_feed_posts_author_active
  ON feed_posts (author_id, created_at DESC) WHERE deleted_at IS NULL;

-- Bulk read-all on notifications: `UPDATE ... WHERE user_id=$1 AND
-- read_at IS NULL`. The existing (user_id, created_at DESC) reads all
-- of a user's notifications and filters in-memory; for a power user
-- with thousands of read rows that's wasteful. Partial index lets
-- the UPDATE touch only the unread set.
CREATE INDEX IF NOT EXISTS idx_feed_notifs_unread
  ON feed_notifications (user_id) WHERE read_at IS NULL;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ Phase 10 — Agent Economy (Phase 1 of the Economy build)             ║
-- ╠══════════════════════════════════════════════════════════════════════╣
-- ║ Adds the off-chain side of the agent-economy primitives. The        ║
-- ║ on-chain anchors live in the StakingContract monolith (mission +    ║
-- ║ kit registries, prefixes b"B" and b"k"). Everything that's verbose, ║
-- ║ mutable, or doesn't need consensus lives here:                      ║
-- ║   - skill_runtime_manifests   (prompts, tool bindings, IO schema)   ║
-- ║   - mission_templates         (catalog of structured jobs)          ║
-- ║   - missions                  (off-chain mirror of on-chain row)    ║
-- ║   - mission_audit_log         (hash-chained step log)               ║
-- ║   - mission_escalations       (auth-engine require_approval queue)  ║
-- ║   - auth_profiles             (per-user/agent/mission rule sets)    ║
-- ║   - agent_kits + kit_versions (Kit catalog + history)               ║
-- ║   - kit_deployments           (per-instance deploy of a Kit)        ║
-- ║   - connector_credentials     (encrypted Web2 connector creds)      ║
-- ║   - reputation_cache          (subject score mirror)                ║
-- ║                                                                      ║
-- ║ At v1 most of these are read-only or write-rarely; the loops that   ║
-- ║ populate them (mission engine, auth engine, skills runtime) ship in ║
-- ║ Phase 1 of the Economy build.                                       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── Skill runtime manifests ───────────────────────────────────────────
-- Off-chain side of an on-chain Skill. The on-chain row carries identity,
-- price, and category; the manifest carries the actual runtime payload —
-- prompt fragment, tool bindings, IO schema, connector deps. Pinned via
-- manifest_hash so a future Phase-5 on-chain skill_registry can validate
-- that what runs matches what the catalog claims.
--
-- skill_id is the u64 from the contract. multiple versions per skill are
-- allowed; the active one is whichever has the highest version with
-- status='active'.
CREATE TABLE IF NOT EXISTS skill_runtime_manifests (
  id                  BIGSERIAL    PRIMARY KEY,
  skill_id            BIGINT       NOT NULL,
  version             TEXT         NOT NULL,
  category            TEXT         NOT NULL,
  vertical_tags       TEXT[]       NOT NULL DEFAULT '{}',
  prompt_fragment     TEXT         NOT NULL,
  tool_manifest_json  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  required_connectors TEXT[]       NOT NULL DEFAULT '{}',
  io_schema_json      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  manifest_hash       TEXT         NOT NULL,
  status              TEXT         NOT NULL DEFAULT 'internal',
  deployed_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (skill_id, version)
);
CREATE INDEX IF NOT EXISTS idx_skill_manifests_skill_id
  ON skill_runtime_manifests (skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_manifests_active
  ON skill_runtime_manifests (skill_id, deployed_at DESC)
  WHERE status = 'active';

-- ── Mission templates ─────────────────────────────────────────────────
-- Catalog row a mission is created from. Inputs schema is JSON Schema;
-- default_crew is an ordered list of role tags ['scout','outreach',...].
-- compatible_kits is informational at v1 — no enforcement yet, the spec
-- says any agent with the right skills can fulfill any compatible
-- template.
CREATE TABLE IF NOT EXISTS mission_templates (
  id                    BIGSERIAL    PRIMARY KEY,
  slug                  TEXT         NOT NULL UNIQUE,
  vertical              TEXT         NOT NULL,
  title                 TEXT         NOT NULL,
  description           TEXT         NOT NULL DEFAULT '',
  required_inputs_json  JSONB        NOT NULL DEFAULT '[]'::jsonb,
  default_crew_json     JSONB        NOT NULL DEFAULT '[]'::jsonb,
  compatible_kits       TEXT[]       NOT NULL DEFAULT '{}',
  auth_profile_id       BIGINT,
  estimated_duration    TEXT,
  estimated_cost_min    NUMERIC(40,0),
  estimated_cost_max    NUMERIC(40,0),
  cost_token            TEXT         NOT NULL DEFAULT 'NEAR',
  success_criteria      TEXT,
  geo_scope             TEXT         CHECK (geo_scope IS NULL OR geo_scope IN ('local','national','global')),
  language_support      TEXT[]       NOT NULL DEFAULT '{en}',
  status                TEXT         NOT NULL DEFAULT 'active',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mission_templates_vertical
  ON mission_templates (vertical, status);

-- ── Missions (off-chain mirror) ───────────────────────────────────────
-- on_chain_id is the u64 from create_mission. Indexed off the
-- mission_created event; if the indexer drops a row, the orchestrator
-- can backfill from contract state. inputs_hash matches the value
-- escrowed on-chain so we can prove tampering.
CREATE TABLE IF NOT EXISTS missions (
  on_chain_id      BIGINT       PRIMARY KEY,
  template_slug    TEXT         REFERENCES mission_templates(slug),
  poster_wallet    TEXT         NOT NULL,
  claimant_wallet  TEXT,
  kit_slug         TEXT,
  inputs_json      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  inputs_hash      TEXT         NOT NULL,
  escrow_yocto     NUMERIC(40,0) NOT NULL,
  platform_fee_bps INTEGER      NOT NULL,
  status           TEXT         NOT NULL,
  audit_root       TEXT,
  tx_create        TEXT,
  tx_finalize      TEXT,
  created_at       TIMESTAMPTZ  NOT NULL,
  claimed_at       TIMESTAMPTZ,
  submitted_at     TIMESTAMPTZ,
  review_deadline  TIMESTAMPTZ,
  finalized_at     TIMESTAMPTZ,
  indexed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_missions_status
  ON missions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_missions_poster
  ON missions (poster_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_missions_claimant
  ON missions (claimant_wallet, created_at DESC)
  WHERE claimant_wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_missions_kit
  ON missions (kit_slug, created_at DESC)
  WHERE kit_slug IS NOT NULL;

-- ── Mission audit log ─────────────────────────────────────────────────
-- One row per agent step in a mission. payload_hash is the sha256 of
-- payload_json; prev_hash is the previous row's payload_hash for the
-- same mission, forming a hash chain whose root is what gets committed
-- on-chain via submit_mission_work(audit_root). Roots are computed off-
-- chain — we don't reconstruct from prev_hash on read.
CREATE TABLE IF NOT EXISTS mission_audit_log (
  id                  BIGSERIAL    PRIMARY KEY,
  mission_on_chain_id BIGINT       NOT NULL REFERENCES missions(on_chain_id) ON DELETE CASCADE,
  step_seq            INTEGER      NOT NULL,
  skill_id            BIGINT,
  role                TEXT,
  action_type         TEXT         NOT NULL,
  payload_json        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  payload_hash        TEXT         NOT NULL,
  prev_hash           TEXT,
  agent_wallet        TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (mission_on_chain_id, step_seq)
);
CREATE INDEX IF NOT EXISTS idx_mission_audit_log_mission
  ON mission_audit_log (mission_on_chain_id, step_seq);

-- ── Mission escalations ───────────────────────────────────────────────
-- The auth engine writes a row here whenever a 'require_approval' rule
-- fires. The corresponding step is frozen until status flips to
-- 'approved' or 'rejected'. tg_message_id + tg_chat_id are populated
-- when the escalation went out via Telegram so the callback can find
-- the right row.
CREATE TABLE IF NOT EXISTS mission_escalations (
  id                  BIGSERIAL    PRIMARY KEY,
  mission_on_chain_id BIGINT       NOT NULL REFERENCES missions(on_chain_id) ON DELETE CASCADE,
  step_seq            INTEGER,
  action_type         TEXT         NOT NULL,
  payload_json        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT         NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','approved','rejected','expired','aborted')),
  channel             TEXT         NOT NULL DEFAULT 'in_app'
                                   CHECK (channel IN ('tg','email','sms','in_app')),
  tg_message_id       BIGINT,
  tg_chat_id          BIGINT,
  decided_by_wallet   TEXT,
  decision_note       TEXT,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mission_escalations_mission
  ON mission_escalations (mission_on_chain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mission_escalations_pending
  ON mission_escalations (status, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_mission_escalations_tg
  ON mission_escalations (tg_chat_id, tg_message_id)
  WHERE tg_chat_id IS NOT NULL;

-- ── Authorization profiles ────────────────────────────────────────────
-- A profile is a set of AuthRules. Resolution order: mission-bound profile,
-- then agent-bound profile, then user default, then system default. v1
-- ships only system + user defaults; agent and mission scoping land in
-- Phase 2 with the crew orchestrator.
CREATE TABLE IF NOT EXISTS auth_profiles (
  id                  BIGSERIAL    PRIMARY KEY,
  user_wallet         TEXT         NOT NULL,
  agent_owner_wallet  TEXT,
  mission_on_chain_id BIGINT,
  rules_json          JSONB        NOT NULL DEFAULT '[]'::jsonb,
  is_default          BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_profiles_user
  ON auth_profiles (user_wallet);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_profiles_user_default
  ON auth_profiles (user_wallet) WHERE is_default = TRUE;

-- ── Kit catalog (off-chain mirror + verbose body) ─────────────────────
-- The on-chain Kit row holds slug, vertical, curator, revenue split, and
-- manifest_hash. The verbose body — bundled skill ids, preset config
-- schema, hero image, marketing copy — lives here. manifest_hash
-- matches the on-chain pin, so a tampered Kit catalog is detectable.
CREATE TABLE IF NOT EXISTS agent_kits (
  slug                       TEXT         PRIMARY KEY,
  title                      TEXT         NOT NULL,
  vertical                   TEXT         NOT NULL,
  description                TEXT         NOT NULL DEFAULT '',
  hero_image_url             TEXT,
  example_missions           TEXT[]       NOT NULL DEFAULT '{}',
  required_connectors        TEXT[]       NOT NULL DEFAULT '{}',
  bundled_skill_ids          BIGINT[]     NOT NULL DEFAULT '{}',
  preset_config_schema_json  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  default_auth_profile_id    BIGINT       REFERENCES auth_profiles(id),
  default_pricing_json       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  curator_wallet             TEXT         NOT NULL,
  manifest_hash              TEXT         NOT NULL,
  kit_curator_bps            INTEGER      NOT NULL,
  agent_owner_bps            INTEGER      NOT NULL,
  platform_bps               INTEGER      NOT NULL,
  status                     TEXT         NOT NULL DEFAULT 'beta'
                                          CHECK (status IN ('active','beta','deprecated')),
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_kits_revenue_sums_to_10000
    CHECK (kit_curator_bps + agent_owner_bps + platform_bps = 10000)
);
CREATE INDEX IF NOT EXISTS idx_agent_kits_vertical
  ON agent_kits (vertical, status);

-- ── Kit version history ───────────────────────────────────────────────
-- Each manifest update writes a row here. The current Kit row in
-- agent_kits is the latest version; this table is the history feed.
CREATE TABLE IF NOT EXISTS kit_versions (
  id                         BIGSERIAL    PRIMARY KEY,
  kit_slug                   TEXT         NOT NULL REFERENCES agent_kits(slug),
  version                    TEXT         NOT NULL,
  bundled_skill_ids          BIGINT[]     NOT NULL DEFAULT '{}',
  preset_config_schema_json  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  required_connectors        TEXT[]       NOT NULL DEFAULT '{}',
  manifest_hash              TEXT         NOT NULL,
  deployed_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (kit_slug, version)
);

-- ── Kit deployments ───────────────────────────────────────────────────
-- A user picks a Kit, fills the preset form, and gets a deployment row.
-- agent_owner_wallet references the on-chain agent_profile. For Phase 10
-- v1 the on-chain agent record predates Kits, so this is informational
-- only — the actual agent identity is what's already in agent_profiles.
CREATE TABLE IF NOT EXISTS kit_deployments (
  id                  BIGSERIAL    PRIMARY KEY,
  kit_slug            TEXT         NOT NULL REFERENCES agent_kits(slug),
  kit_version_id     BIGINT       REFERENCES kit_versions(id),
  agent_owner_wallet  TEXT         NOT NULL,
  preset_config_json  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT         NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('pending','active','paused','retired')),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kit_deployments_owner
  ON kit_deployments (agent_owner_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kit_deployments_kit
  ON kit_deployments (kit_slug, status);

-- ── Connector credentials ─────────────────────────────────────────────
-- BYO-account credentials for Web2 connectors (X, Facebook, WhatsApp,
-- LinkedIn, Jiji, etc.). encrypted_blob is opaque payload — the
-- connector module decrypts it at use time using the platform key. v1
-- ships with an empty connector framework; rows arrive in Phase 4.
CREATE TABLE IF NOT EXISTS connector_credentials (
  id              BIGSERIAL    PRIMARY KEY,
  user_wallet     TEXT         NOT NULL,
  connector_name  TEXT         NOT NULL,
  encrypted_blob  BYTEA        NOT NULL,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_wallet, connector_name)
);

-- ── Reputation cache ──────────────────────────────────────────────────
-- subject_type is 'agent' or 'skill' (Phase 5 may add 'kit'). subject_id
-- is the corresponding identifier — agent owner wallet for agents, the
-- u64 skill_id for skills. score is a derived integer 0..10_000. This
-- is a cache; the source of truth is mission outcomes + the Phase 5
-- on-chain reputation ledger (not yet deployed).
CREATE TABLE IF NOT EXISTS reputation_cache (
  subject_type        TEXT         NOT NULL CHECK (subject_type IN ('agent','skill')),
  subject_id          TEXT         NOT NULL,
  score               INTEGER      NOT NULL DEFAULT 0,
  missions_completed  INTEGER      NOT NULL DEFAULT 0,
  missions_failed     INTEGER      NOT NULL DEFAULT 0,
  success_rate_bps    INTEGER      NOT NULL DEFAULT 0,
  last_synced_block   BIGINT,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_reputation_cache_score
  ON reputation_cache (subject_type, score DESC);

-- ╔═════════════════════════════════════════════════════════════════════╗
-- ║  Phase 10 Tier 2 — IronGuide concierge                              ║
-- ║   - ironguide_sessions  (free concierge interview state)            ║
-- ║   - kit_requests        (gap log when no Kit fits the user)         ║
-- ╚═════════════════════════════════════════════════════════════════════╝

-- ── IronGuide sessions ────────────────────────────────────────────────
-- One row per onboarding interview. Channel is 'web' or 'tg'. Subject
-- key (wallet for web, tg_id for tg) is unique per channel so a single
-- user gets one in-progress interview at a time per surface. Conversation
-- state is the message history; classified_json is the structured
-- vertical/geo/budget/language signal extracted from the answers.
CREATE TABLE IF NOT EXISTS ironguide_sessions (
  id                       BIGSERIAL    PRIMARY KEY,
  channel                  TEXT         NOT NULL CHECK (channel IN ('web','tg')),
  subject_wallet           TEXT,
  subject_tg_id            BIGINT,
  ironclaw_thread_id       TEXT,
  status                   TEXT         NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active','recommended','deployed','abandoned')),
  messages_json            JSONB        NOT NULL DEFAULT '[]'::jsonb,
  classified_json          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  recommended_kit_id       TEXT         REFERENCES agent_kits(slug),
  recommended_presets_json JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ironguide_sessions_wallet
  ON ironguide_sessions (subject_wallet)
  WHERE subject_wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ironguide_sessions_tg
  ON ironguide_sessions (subject_tg_id)
  WHERE subject_tg_id IS NOT NULL;
-- Defensive idempotent column adds in case an older shape exists.
ALTER TABLE ironguide_sessions
  ADD COLUMN IF NOT EXISTS recommended_kit_id TEXT REFERENCES agent_kits(slug);
ALTER TABLE ironguide_sessions
  ADD COLUMN IF NOT EXISTS recommended_presets_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── Kit requests (gap log) ────────────────────────────────────────────
-- When IronGuide can't recommend any existing Kit for the classified
-- profile, it logs the gap here so the curation team can decide whether
-- to author a new Kit. status='open' until a curator triages.
CREATE TABLE IF NOT EXISTS kit_requests (
  id                  BIGSERIAL    PRIMARY KEY,
  ironguide_session_id BIGINT      REFERENCES ironguide_sessions(id) ON DELETE SET NULL,
  classified_json     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  summary             TEXT,
  channel             TEXT,
  subject_wallet      TEXT,
  subject_tg_id       BIGINT,
  status              TEXT         NOT NULL DEFAULT 'open'
                                   CHECK (status IN ('open','triaged','authored','dismissed')),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kit_requests_status
  ON kit_requests (status, created_at DESC);
-- ── Event counters (Phase 10 Tier 5 — observability) ────────────────
-- Tiny aggregate counter table for "is anyone using this?" telemetry.
-- bump(event, label) atomically increments via INSERT ... ON CONFLICT.
-- Labels are connector names / kit slugs etc. — NEVER user wallets.
-- This is operator-facing summary telemetry, not per-user analytics.
CREATE TABLE IF NOT EXISTS event_counters (
  event_name  TEXT          NOT NULL,
  label       TEXT          NOT NULL DEFAULT '',
  count       BIGINT        NOT NULL DEFAULT 0,
  first_seen  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_seen   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_name, label)
);
CREATE INDEX IF NOT EXISTS idx_event_counters_last_seen
  ON event_counters (last_seen DESC);

-- ── Telegram link hardening (post-Day 9) ─────────────────────────────
-- Pre-hardening, /api/tg/claim accepted a bare `wallet` body field
-- and /api/tg/add-wallet upserted feed_users.id into the caller's
-- feed_tg_links row — both with no proof of wallet ownership. That
-- routed the wallet's private DM/notification fan-out to the caller,
-- which is the eavesdropping leak the user reported.
--
-- The new /claim path stamps `link_code` on every legitimate link
-- (and rejects anonymous codes). Rows that lack `link_code` therefore
-- predate the hardening and may carry a borrowed user_id. Nullify so
-- private fan-out stops; affected users re-link via the website +
-- /start <code> in TG to restore notifications.
--
-- Idempotent: post-fix, every legit row has link_code set, so this
-- only fires on stale rows. Runs on every boot via schema.sql.
UPDATE feed_tg_links
   SET user_id = NULL
 WHERE link_code IS NULL
   AND user_id IS NOT NULL;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ Phase 10 Tier 5 — catalog scale + admin + authors                   ║
-- ╠══════════════════════════════════════════════════════════════════════╣
-- ║ Additive only. Existing runtime read paths (status='active') are    ║
-- ║ unchanged. lifecycle_status is the new moderation channel that      ║
-- ║ admin UI flips independently of the runtime active flag.            ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- Mirror of on-chain skill metadata into the runtime manifest row, so
-- FTS / catalog queries don't need RPC fan-out. Nullable; populated
-- by the search endpoint's lazy backfill (Tier 5 slice 2).
ALTER TABLE skill_runtime_manifests
  ADD COLUMN IF NOT EXISTS name        TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Moderation state, distinct from the runtime "active" flag in `status`.
-- Admin UI (slice 3) flips this; runtime never reads it.
ALTER TABLE skill_runtime_manifests
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'internal';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_manifests_lifecycle_status_chk'
  ) THEN
    ALTER TABLE skill_runtime_manifests
      ADD CONSTRAINT skill_manifests_lifecycle_status_chk
      CHECK (lifecycle_status IN ('internal','curated','public','deprecated','slashed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_skill_manifests_lifecycle
  ON skill_runtime_manifests (lifecycle_status);

-- FTS over name + description + prompt_fragment. GIN over a tsvector
-- expression — the english config is the standard catalog-text choice.
CREATE INDEX IF NOT EXISTS idx_skill_manifests_fts
  ON skill_runtime_manifests
  USING GIN (to_tsvector('english',
    coalesce(name,'') || ' ' ||
    coalesce(description,'') || ' ' ||
    coalesce(prompt_fragment,'')
  ));

-- One row per (skill, reviewer wallet). Author leaderboard reads
-- AVG(rating) GROUP BY skill_id; per-skill detail page lists bodies.
CREATE TABLE IF NOT EXISTS skill_reviews (
  id               BIGSERIAL    PRIMARY KEY,
  skill_id         BIGINT       NOT NULL,
  reviewer_wallet  TEXT         NOT NULL,
  rating           SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body             TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (skill_id, reviewer_wallet)
);
CREATE INDEX IF NOT EXISTS idx_skill_reviews_skill_id
  ON skill_reviews (skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_reviews_reviewer
  ON skill_reviews (reviewer_wallet, created_at DESC);

-- ╔═════════════════════════════════════════════════════════════════════╗
-- ║  Agent-economy feed — receipts, missions, bounties                   ║
-- ║                                                                      ║
-- ║  Turns the social feed into a daily-return surface where every post  ║
-- ║  is actionable by an agent. Three post types live alongside chat:    ║
-- ║    chat     — existing free-form social posts (default)              ║
-- ║    mission  — free-form intent ("selling Camry, ₦5M, Minna"); the    ║
-- ║               classifier extracts vertical/budget/geo, the matcher   ║
-- ║               surfaces ranked agents, agents bid (stake-gated), the  ║
-- ║               poster picks one → a real mission launches via the     ║
-- ║               Tier 4 Kit runtime                                     ║
-- ║    bounty   — escrowed challenge; multiple agents compete; public    ║
-- ║               attempt feed + leaderboard                             ║
-- ║                                                                      ║
-- ║  Receipts are not a post type — they are auto-authored chat posts    ║
-- ║  by the orchestrator on mission terminal transitions, carrying       ║
-- ║  structured fields in intent_json so FeedPostCard can render the     ║
-- ║  "Use this Kit" + "Hire this agent" CTAs.                            ║
-- ╚═════════════════════════════════════════════════════════════════════╝

-- Extend feed_posts with the four economic columns. type=chat is the
-- default so every existing row keeps working unchanged. status only
-- has meaning for type IN ('mission','bounty'); chat posts ignore it.
ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'chat'
    CHECK (type IN ('chat','mission','bounty','receipt'));
ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS intent_json   JSONB;
ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS escrow_tx     TEXT;
ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS escrow_yocto  NUMERIC(40,0);
ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','hired','fulfilled','expired','cancelled'));

-- Pinning lets the orchestrator surface fresh receipts at the top of
-- For You for a short window. Boolean instead of timestamp to keep
-- indexing cheap; the unpin sweep clears it.
ALTER TABLE feed_posts
  ADD COLUMN IF NOT EXISTS pinned        BOOLEAN NOT NULL DEFAULT FALSE;

-- Composite index for the mission/bounty list queries: WHERE
-- type IN ('mission','bounty') AND status='open' ORDER BY created_at.
CREATE INDEX IF NOT EXISTS idx_feed_posts_type_status
  ON feed_posts (type, status, created_at DESC)
  WHERE type IN ('mission','bounty');
CREATE INDEX IF NOT EXISTS idx_feed_posts_pinned
  ON feed_posts (created_at DESC)
  WHERE pinned = TRUE AND deleted_at IS NULL;

-- ── Post classifications ──────────────────────────────────────────────
-- One row per classified post. Cached so we don't re-call IronClaw on
-- every list render. classifier_version lets us invalidate cheaply if
-- the prompt changes — readers can choose to ignore old versions or
-- re-run.
CREATE TABLE IF NOT EXISTS post_classifications (
  post_id            INTEGER     PRIMARY KEY REFERENCES feed_posts(id) ON DELETE CASCADE,
  vertical           TEXT,
  intent             TEXT,
  budget_min         NUMERIC(20,2),
  budget_max         NUMERIC(20,2),
  budget_currency    TEXT,
  geo                TEXT,
  urgency            TEXT,
  language           TEXT,
  confidence         REAL        NOT NULL DEFAULT 0,
  classifier_version TEXT        NOT NULL,
  raw_json           JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_classifications_vertical
  ON post_classifications (vertical, geo)
  WHERE vertical IS NOT NULL;

-- ── Post agent bids ───────────────────────────────────────────────────
-- A pitch from an agent on a mission post. stake_yocto is the locked
-- bond (refunded on accept, slashed on a verified report). UNIQUE on
-- (post_id, agent_owner_wallet) enforces one-bid-per-agent without
-- needing a separate guard in the bid engine.
CREATE TABLE IF NOT EXISTS post_agent_bids (
  id                 BIGSERIAL   PRIMARY KEY,
  post_id            INTEGER     NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  agent_owner_wallet TEXT        NOT NULL,
  pitch              TEXT        NOT NULL,
  stake_tx           TEXT,
  stake_yocto        NUMERIC(40,0) NOT NULL DEFAULT 0,
  status             TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','accepted','rejected','withdrawn','slashed','refunded')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at         TIMESTAMPTZ,
  UNIQUE (post_id, agent_owner_wallet)
);
CREATE INDEX IF NOT EXISTS idx_post_agent_bids_post
  ON post_agent_bids (post_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_agent_bids_agent
  ON post_agent_bids (agent_owner_wallet, status, created_at DESC);

-- ── Post hires ────────────────────────────────────────────────────────
-- Once a poster picks a bid, a row lands here and a real mission
-- launches via the Tier 4 Kit runtime. mission_on_chain_id is nullable
-- because the hire decision is recorded synchronously while the actual
-- chain call may complete a few seconds later.
CREATE TABLE IF NOT EXISTS post_hires (
  post_id              INTEGER     PRIMARY KEY REFERENCES feed_posts(id) ON DELETE CASCADE,
  agent_owner_wallet   TEXT        NOT NULL,
  bid_id               BIGINT      REFERENCES post_agent_bids(id) ON DELETE SET NULL,
  mission_on_chain_id  BIGINT      REFERENCES missions(on_chain_id) ON DELETE SET NULL,
  hired_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_hires_agent
  ON post_hires (agent_owner_wallet, hired_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_hires_mission
  ON post_hires (mission_on_chain_id)
  WHERE mission_on_chain_id IS NOT NULL;

-- ── Per-vertical mute controls ────────────────────────────────────────
-- Lets a poster suppress a whole vertical of unsolicited bids/DMs.
-- Distinct from feed_muted_accounts which mutes a specific user.
CREATE TABLE IF NOT EXISTS post_vertical_mutes (
  user_id    INTEGER     NOT NULL REFERENCES feed_users(id) ON DELETE CASCADE,
  vertical   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, vertical)
);

-- ── Bounty attempts ───────────────────────────────────────────────────
-- One row per agent submission against a bounty post. The poster (or
-- a judge skill) marks is_winner on the final pick. score is the
-- ranking signal for the leaderboard — judges or a kit can fill it.
CREATE TABLE IF NOT EXISTS bounty_attempts (
  id                  BIGSERIAL   PRIMARY KEY,
  post_id             INTEGER     NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  agent_owner_wallet  TEXT        NOT NULL,
  result_json         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  score               INTEGER,
  is_winner           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bounty_attempts_post
  ON bounty_attempts (post_id, score DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bounty_attempts_winner
  ON bounty_attempts (post_id) WHERE is_winner = TRUE;

-- ── Post reports → governance slash flow ──────────────────────────────
-- A reporter flags a bid (typically for spam or off-topic pitches).
-- The governance vote engine reads pending rows and either dismisses
-- them or upholds them — upheld reports flip the bid to 'slashed' and
-- forfeit the stake to the platform fee account.
CREATE TABLE IF NOT EXISTS post_reports (
  id           BIGSERIAL   PRIMARY KEY,
  post_id      INTEGER     REFERENCES feed_posts(id) ON DELETE CASCADE,
  bid_id       BIGINT      REFERENCES post_agent_bids(id) ON DELETE CASCADE,
  reporter_id  INTEGER     NOT NULL REFERENCES feed_users(id) ON DELETE CASCADE,
  reason       TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','upheld','dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_post_reports_pending
  ON post_reports (status, created_at DESC) WHERE status = 'pending';

-- ── Premium DM eligibility ───────────────────────────────────────────
-- Agents pay $4-equivalent in NEAR (env-overridable) to unlock the DM
-- channel to mission posters. Cost-to-spam doubles as a revenue line.
-- premium_until is a timestamp; an agent with premium_until > NOW() is
-- eligible. The /api/feed/premium endpoint flips this after verifying
-- a NEAR transfer to the platform treasury via txVerify.
ALTER TABLE feed_users
  ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ;
ALTER TABLE feed_users
  ADD COLUMN IF NOT EXISTS premium_last_tx TEXT;
CREATE INDEX IF NOT EXISTS idx_feed_users_premium_until
  ON feed_users (premium_until) WHERE premium_until IS NOT NULL;

-- ── Mission post DMs ─────────────────────────────────────────────────
-- A premium agent's private message to a mission poster. Distinct from
-- feed_conversations (the general DM thread surface) so the feed-side
-- rate limit and premium gate don't entangle the social DM path.
CREATE TABLE IF NOT EXISTS post_dms (
  id                 BIGSERIAL   PRIMARY KEY,
  post_id            INTEGER     NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
  agent_owner_wallet TEXT        NOT NULL,
  body               TEXT        NOT NULL,
  read_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_dms_post
  ON post_dms (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_dms_agent_recent
  ON post_dms (agent_owner_wallet, created_at DESC);

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ PingPay hosted-checkout integration                                  ║
-- ╠══════════════════════════════════════════════════════════════════════╣
-- ║ Mission-funding fiat on-ramp. Buyer hits the deploy wizard, picks    ║
-- ║ "Pay with PingPay", pays card / bank / USDC on the hosted page,      ║
-- ║ PingPay routes funds via NEAR Intents into the buyer's NEAR wallet.  ║
-- ║ The buyer then signs create_mission with the now-funded NEAR — i.e.  ║
-- ║ settlement shape (a) per the design doc: cleanest custody, two-step  ║
-- ║ UX. The contract is unchanged.                                       ║
-- ║                                                                      ║
-- ║ Why a separate pending_missions table instead of extending missions:  ║
-- ║ missions.on_chain_id is NOT NULL PK and is also the FK target for     ║
-- ║ mission_audit_log + mission_escalations. Adding a "pending_payment"   ║
-- ║ row with NULL on_chain_id would require dropping/reshaping that PK    ║
-- ║ — way out of scope for an additive payment integration. We hold       ║
-- ║ the pre-chain intent here; once the buyer signs create_mission the    ║
-- ║ existing missionEngine.recordCreated path inserts the missions row    ║
-- ║ exactly as it does for every other poster, and we link forward via    ║
-- ║ resolved_on_chain_id.                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS pending_missions (
  id                    BIGSERIAL    PRIMARY KEY,
  poster_wallet         TEXT         NOT NULL,
  template_slug         TEXT,
  kit_slug              TEXT,
  inputs_json           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  inputs_hash           TEXT         NOT NULL,
  escrow_amount_usd     NUMERIC(12,2) NOT NULL,
  -- Yocto value is set at the moment the buyer signs create_mission
  -- (we don't lock a USD↔NEAR rate before the user actually has the
  -- funds in-wallet). NULL until then.
  escrow_yocto          NUMERIC(40,0),
  -- pingpay_session_id mirrors pingpay_payments.session_id for the
  -- one-to-one happy path. Kept here for cheap status reads from the
  -- frontend without joining.
  pingpay_session_id    TEXT,
  pingpay_status        TEXT,
  status                TEXT         NOT NULL DEFAULT 'pending_payment'
                                     CHECK (status IN (
                                       'pending_payment',  -- session created, awaiting buyer payment
                                       'funded',           -- PingPay completed; NEAR landed in buyer wallet
                                       'signed',           -- buyer signed create_mission; resolved_on_chain_id set
                                       'cancelled',        -- buyer hit cancelUrl
                                       'expired',          -- never paid; janitor (future) reaps
                                       'failed'            -- PingPay reported a hard failure
                                     )),
  resolved_on_chain_id  BIGINT,        -- set after recordCreated lands; not FK because missions PK is BIGINT not BIGSERIAL
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  funded_at             TIMESTAMPTZ,
  signed_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pending_missions_poster
  ON pending_missions (poster_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_missions_session
  ON pending_missions (pingpay_session_id)
  WHERE pingpay_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_missions_status
  ON pending_missions (status, created_at DESC);

-- Audit trail of every PingPay session we create, plus every webhook
-- event we accept (one row per inbound `checkout.session.completed`).
-- raw_event_json is what PingPay sent us, post-signature-verification —
-- it's the answer to "what did the upstream say happened" if a buyer
-- disputes a charge. Never log the raw body or signature anywhere
-- *else*; this table is the one durable record.
CREATE TABLE IF NOT EXISTS pingpay_payments (
  id                  BIGSERIAL    PRIMARY KEY,
  session_id          TEXT         NOT NULL,
  pending_mission_id  BIGINT       REFERENCES pending_missions(id) ON DELETE SET NULL,
  amount_usd          NUMERIC(12,2),
  amount_yocto        NUMERIC(40,0),
  status              TEXT         NOT NULL,   -- mirrors PingPay session.status: PENDING|COMPLETED|FAILED|CANCELLED
  raw_event_json      JSONB,                   -- last webhook payload for this session
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  UNIQUE (session_id)
);
CREATE INDEX IF NOT EXISTS idx_pingpay_payments_pending
  ON pingpay_payments (pending_mission_id)
  WHERE pending_mission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pingpay_payments_status
  ON pingpay_payments (status, created_at DESC);
