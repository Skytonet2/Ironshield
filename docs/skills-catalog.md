# AZUKA Skills Catalog (v1 — 200 skills)

> Backlog for the AZUKA Skills SDK. Each row is a plausible
> skill that can be built against the existing platform without new
> infra. Grouped by category. See `docs/skills-sdk.md` (TBD) for the
> SDK contract every skill ships against.

**Status legend:**
- 🟢 = obviously buildable today against the live backend
- 🟡 = needs one missing piece (specify in the row)
- 🔴 = needs a substantial new platform capability (specify)

**Notes on pricing.** The on-chain `Skill` struct only models a one-time
install fee. Subscription and per-fire pricing in this catalog are
implemented off-chain by the skill itself (debiting on each `execute`
via the wallet proxy, or by a stake-lock checked at runtime). Skills
that sign trades take a setup fee on install plus a per-fire fee that
includes the platform 80% NewsCoin / 15% skill-marketplace splits where
they apply. See `backend/routes/skills.route.js` and
`contract/src/agents.rs` for the on-chain mechanics.

---

## 1. News + NewsCoin (20 skills)

### `newscoin-sniper`
**Pitch.** When a NewsCoin drops from a verified poster matching your filters (tags, creator wallet age, max market cap, headline keywords), auto-buy with a preset NEAR budget. You wake up to a position, not a chart.
**Inputs.** `{ filters: { tags?: string[], min_creator_wallet_age_days?: number, max_mcap_usd?: number, headline_must_match?: string[] }, budget_near: number, max_positions_per_day?: number }`
**Outputs.** `{ matched_coins: [{ coin_id, ticker, bought_amount_near, tx_hash }], summary: string }`
**Pricing.** 5 NEAR setup, 0.5 NEAR per fire (cap at 10 fires/day).
**Categories.** `newscoin`, `automation`, `trading`
**Tags.** `[sniper, news, automation, trading, near]`
**Status.** 🟢 — `/api/newscoin/list` + `/api/newscoin/:coinId/verify-trade` + agent wallet proxy.

### `newscoin-exit-ladder`
**Pitch.** Stake-aware tiered take-profit / stop-loss ladders for any NewsCoin position. Sells in 25/25/25/25 chunks across configured price marks; trails the bottom mark on a runner.
**Inputs.** `{ coin_id: string, entries: { price_near: number, sell_pct: number }[], trail_floor_pct?: number }`
**Outputs.** `{ orders_armed: int, sells_executed: [{ price, amount, tx_hash }] }`
**Pricing.** 3 NEAR setup, 0.3 NEAR per executed leg.
**Categories.** `newscoin`, `automation`
**Tags.** `[exit, ladder, take-profit, trailing-stop]`
**Status.** 🟢 — polls `/api/newscoin/:coinId/curve` + `/verify-trade`.

### `newscoin-story-scoring`
**Pitch.** Scores a fresh NewsCoin 0–100 on virality (tag heat, creator track record, headline punch, source quality). One-shot when you're staring at the launch and need to decide in 30 seconds.
**Inputs.** `{ coin_id: string }`
**Outputs.** `{ score: number, breakdown: { virality, creator, headline, source }, verdict: string }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `newscoin`, `analytics`
**Tags.** `[scoring, news, virality, signal]`
**Status.** 🟢 — `/api/newscoin/:coinId` + `/firstmover` + `/api/feed/trending`.

### `newscoin-curve-calculator`
**Pitch.** Preview slippage and final fill price for a buy or sell of size N on a given coin's bonding curve, including segment transitions. Saves you from eating 6% slippage on a chunky entry.
**Inputs.** `{ coin_id: string, side: "buy"|"sell", amount_near: number }`
**Outputs.** `{ avg_price, slippage_pct, segments_crossed, final_curve_state }`
**Pricing.** Free.
**Categories.** `newscoin`, `analytics`
**Tags.** `[slippage, curve, calculator, preview]`
**Status.** 🟢 — `/api/newscoin/:coinId/curve`.

### `newscoin-firstmover-tracker`
**Pitch.** Watch a list of high-conviction creators; alert via TG and DM the moment one of them launches a new coin, before it hits the trending feed.
**Inputs.** `{ watched_creators: string[], min_creator_volume_near?: number }`
**Outputs.** `{ alerts: [{ coin_id, creator, ticker, launched_at }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `newscoin`, `discovery`
**Tags.** `[firstmover, alerts, creators]`
**Status.** 🟢 — `/api/newscoin/by-creator` polled + `/api/tg/price-alerts/add`.

### `newscoin-dca-bot`
**Pitch.** Dollar-cost-average into a coin over N hours/days at fixed intervals, with optional volatility-based pause if price spikes >X% in any interval.
**Inputs.** `{ coin_id: string, total_near: number, slices: number, interval_minutes: number, pause_if_pump_pct?: number }`
**Outputs.** `{ slices_filled, avg_entry_price_near, status }`
**Pricing.** 2 NEAR setup, 0.1 NEAR per slice.
**Categories.** `newscoin`, `automation`
**Tags.** `[dca, automation, scheduled]`
**Status.** 🟢 — agent automation cron + `/verify-trade`.

### `newscoin-graveyard-detector`
**Pitch.** Daily scan of your NewsCoin holdings; flags coins entering decline (volume <30% of 7d avg, holders dropping, expiring soon). Tells you which to exit, not which to hold.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ at_risk: [{ coin_id, reason, days_to_expiry }], suggested_action: string }`
**Pricing.** 3 NEAR/month.
**Categories.** `newscoin`, `analytics`
**Tags.** `[graveyard, decay, risk, holdings]`
**Status.** 🟢 — `/api/newscoin/list?filter=expiring` + holdings + `/candles`.

### `newscoin-portfolio-rebalancer`
**Pitch.** Rebalance your NewsCoin bag back to target weights on a schedule. Sells winners, tops up laggards, respects min-trade size to avoid death-by-fees.
**Inputs.** `{ targets: [{ coin_id, weight_pct }], cadence: "weekly"|"monthly", drift_threshold_pct?: number }`
**Outputs.** `{ trades_executed: [{ coin_id, side, amount }], new_weights }`
**Pricing.** 4 NEAR setup, 0.4 NEAR per rebalance.
**Categories.** `newscoin`, `automation`, `trading`
**Tags.** `[rebalance, portfolio, weights]`
**Status.** 🟢 — `/api/newscoin/by-creator` (holdings) + `/verify-trade`.

### `newscoin-arbitrage-watcher`
**Pitch.** When two NewsCoins about the same story diverge in price by >X%, alert; optionally fire a long/short pair if both are still live.
**Inputs.** `{ pair: [coin_id, coin_id], threshold_pct: number, auto_trade?: bool, max_size_near?: number }`
**Outputs.** `{ events: [{ at, divergence_pct, action }] }`
**Pricing.** 6 NEAR setup, 0.5 NEAR per fire.
**Categories.** `newscoin`, `trading`
**Tags.** `[arbitrage, pairs, divergence]`
**Status.** 🟢 — `/api/newscoin/:coinId/candles`.

### `newscoin-creator-fee-claimer`
**Pitch.** Auto-claims your accumulated creator fees across all your launched NewsCoins on a schedule. Threshold-gated so you don't burn gas on dust.
**Inputs.** `{ min_claim_near: number, cadence: "weekly"|"on-threshold" }`
**Outputs.** `{ claims: [{ coin_id, amount_near, tx_hash }] }`
**Pricing.** 3 NEAR setup, 0.2 NEAR per claim.
**Categories.** `newscoin`, `creator`, `automation`
**Tags.** `[fees, claim, creator, automation]`
**Status.** 🟢 — `/api/newscoin/by-creator` (claimable) + claim tx via wallet proxy.

### `newscoin-pitch-writer`
**Pitch.** Drop a URL or 2-paragraph headline; get a launchable name, ticker, hero quote, and 3-bullet thesis tuned to the platform's `/api/newscoin/suggest` style. For people who launch faster than they write copy.
**Inputs.** `{ source_url?: string, raw_text?: string, voice?: "neutral"|"degen"|"analyst" }`
**Outputs.** `{ name, ticker, thesis, hero_quote }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `newscoin`, `content`, `creator`
**Tags.** `[pitch, launch, naming, content]`
**Status.** 🟢 — wraps `/api/newscoin/suggest` with extra LLM hops.

### `newscoin-launch-companion`
**Pitch.** Walks a first-time launcher through pitch → ticker → curve config → social tease → launch tx. Prevents the "launched at midnight with no one watching" failure mode.
**Inputs.** `{ headline_or_url: string }`
**Outputs.** `{ steps_completed, launch_tx_hash, teaser_post_id }`
**Pricing.** Free (funnel skill).
**Categories.** `newscoin`, `onboarding`, `creator`
**Tags.** `[onboarding, launch, first-time]`
**Status.** 🟢 — chains `/suggest` + `/api/posts` + launch tx.

### `newscoin-thesis-tracker`
**Pitch.** When you bought, you wrote down why ("Coinbase IPO -> alts season"). This skill checks weekly whether the thesis is playing out by re-querying related news + price action and grades it. Forces reflection.
**Inputs.** `{ coin_id: string, thesis_text: string }`
**Outputs.** `{ thesis_score: 0-100, supporting_signals: string[], contradicting_signals: string[] }`
**Pricing.** 2 NEAR/month per tracked thesis.
**Categories.** `newscoin`, `analytics`
**Tags.** `[thesis, journaling, reflection]`
**Status.** 🟢 — `/api/feed/news` + `/api/newscoin/:coinId/candles` + LLM hop.

### `newscoin-volume-anomaly`
**Pitch.** Detects volume spikes >3σ above 24h baseline on coins you watch or hold. Fires fast (sub-minute) so you can react before the trending feed catches up.
**Inputs.** `{ coin_ids?: string[], hold_only?: bool, sigma_threshold?: number }`
**Outputs.** `{ anomalies: [{ coin_id, sigma, current_volume, baseline }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `newscoin`, `analytics`, `alerts`
**Tags.** `[anomaly, volume, alerts]`
**Status.** 🟢 — `/api/newscoin/:coinId/candles`.

### `newscoin-pump-and-dump-detector`
**Pitch.** Flags suspicious patterns on a coin: rapid buys from <5 wallets, late dump by same wallets, wash-trading footprint. Saves you from being exit liquidity.
**Inputs.** `{ coin_id: string }`
**Outputs.** `{ pnd_score: 0-100, evidence: string[], verdict: string }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `newscoin`, `security`
**Tags.** `[pump-dump, wash-trade, security]`
**Status.** 🟢 — `/api/newscoin/:coinId/trades`.

### `newscoin-trade-tax-export`
**Pitch.** Export your full NewsCoin trade history as CSV with USD basis at trade time, ready for Koinly/CoinTracker/your accountant. Settles the "but what was the cost basis" argument.
**Inputs.** `{ wallet?: string, year: number, format: "koinly"|"cointracker"|"csv" }`
**Outputs.** `{ download_url, row_count }`
**Pricing.** 2 NEAR per export.
**Categories.** `newscoin`, `tax`, `export`
**Tags.** `[tax, csv, koinly, export]`
**Status.** 🟢 — `/api/newscoin/:coinId/trades` + `/api/trading/positions`.

### `newscoin-leaderboard-digest`
**Pitch.** Weekly DM digest: top 10 NewsCoin creators by earnings, biggest movers, highest-volume coins. One screen instead of clicking through six pages.
**Inputs.** `{ delivery: "dm"|"telegram", day_of_week: 0-6 }`
**Outputs.** `{ digest_message_id }`
**Pricing.** Free.
**Categories.** `newscoin`, `digest`, `discovery`
**Tags.** `[leaderboard, digest, weekly]`
**Status.** 🟢 — `/api/newscoin/firstmover/leaderboard` + `/api/newscoin/treasury` + `/api/dm/send`.

### `newscoin-dilution-watcher`
**Pitch.** A bonding-curve coin's economics shift when it crosses segment transitions. This skill alerts when one of your holdings is approaching a transition so you can pre-position.
**Inputs.** `{ wallet?: string, transition_distance_pct?: number }`
**Outputs.** `{ approaching: [{ coin_id, current_pct, segment_next }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `newscoin`, `analytics`
**Tags.** `[dilution, segments, transitions]`
**Status.** 🟢 — `/api/newscoin/:coinId/curve`.

### `newscoin-correlation-mapper`
**Pitch.** Given a coin you hold, finds the 5 most correlated NewsCoins by hourly returns (90d window). Helps you avoid building a "diversified" bag that's actually one bet.
**Inputs.** `{ coin_id: string, lookback_days?: number }`
**Outputs.** `{ correlated: [{ coin_id, r, sample_size }] }`
**Pricing.** 0.4 NEAR per call.
**Categories.** `newscoin`, `analytics`
**Tags.** `[correlation, diversification]`
**Status.** 🟢 — `/api/newscoin/:coinId/candles` + math.

### `newscoin-sentiment-scout`
**Pitch.** For a coin, fuses on-chain trade flow with IronFeed comment sentiment around the underlying story. Gives you a single bullishness number you can compare across the leaderboard.
**Inputs.** `{ coin_id: string }`
**Outputs.** `{ sentiment_score: -100..100, social_volume, on_chain_flow_bias }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `newscoin`, `analytics`, `social`
**Tags.** `[sentiment, social, on-chain]`
**Status.** 🟢 — `/api/newscoin/:coinId/trades` + `/api/posts/:id` (story post comments).

---

## 2. Social engagement (18 skills)

### `feed-reply-drafter`
**Pitch.** Pick a post, get 3 reply drafts in your prior posting voice (analyzed from your last 50 posts). You pick + ship; nothing posts without your tap.
**Inputs.** `{ post_id: string, intent?: "agree"|"disagree"|"add-context"|"jokes" }`
**Outputs.** `{ drafts: string[3] }`
**Pricing.** 0.2 NEAR per call.
**Categories.** `social`, `content`
**Tags.** `[reply, drafter, voice]`
**Status.** 🟢 — `/api/posts/:id` + `/api/feed/foryou` (voice profile build).

### `feed-quote-with-take`
**Pitch.** Quote-post a trending post with your contrarian or supporting take, generated from your historical positions on similar topics. Differs from generic reply tools by remembering your stance.
**Inputs.** `{ post_id: string, stance: "support"|"contrarian"|"nuanced" }`
**Outputs.** `{ draft: string, suggested_tags: string[] }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `social`, `content`
**Tags.** `[quote-post, take, opinion]`
**Status.** 🟢 — `/api/posts/:id` + your post history.

### `feed-audience-builder`
**Pitch.** Daily list of 20 accounts you should follow based on your engagement patterns and graph distance — already-engaged-with-you accounts excluded. Lifts followback rate by skipping the obvious.
**Inputs.** `{ niche_tags?: string[], max_per_day?: number }`
**Outputs.** `{ suggested: [{ wallet, handle, why }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `social`, `discovery`
**Tags.** `[audience, follow, growth]`
**Status.** 🟢 — `/api/feed/foryou` + `/api/feed/voices` + engagement table.

### `feed-engagement-cycler`
**Pitch.** Each morning, queues 5–10 posts in your niche worth a thoughtful reply, with drafted replies. Builds presence without doomscrolling. Approve in <2 minutes.
**Inputs.** `{ niche_tags: string[], replies_per_day: 5..10 }`
**Outputs.** `{ daily_queue: [{ post_id, draft }] }`
**Pricing.** 5 NEAR/month.
**Categories.** `social`, `automation`
**Tags.** `[engagement, growth, daily]`
**Status.** 🟢 — `/api/feed/foryou` + reply drafter.

### `feed-thread-composer`
**Pitch.** Long-form input (essay, transcript, doc) → 5–10 post thread sized to IronFeed character limits, with hook post and CTA. Auto-numbers; auto-pulls quotes.
**Inputs.** `{ source_text: string, length: 5..10, voice?: "analyst"|"raconteur" }`
**Outputs.** `{ thread: string[], hook_idx: 0 }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `social`, `content`
**Tags.** `[thread, longform, composer]`
**Status.** 🟢 — pure LLM, posts via `/api/posts`.

### `feed-hashtag-optimizer`
**Pitch.** Given your draft, suggests 3 tags that lift visibility based on current trending volume vs. your follower-tag overlap. Avoids the "everyone uses #crypto so it's noise" trap.
**Inputs.** `{ draft_text: string }`
**Outputs.** `{ tags: [{ tag, projected_lift }] }`
**Pricing.** 0.1 NEAR per call.
**Categories.** `social`, `analytics`
**Tags.** `[hashtag, seo, visibility]`
**Status.** 🟢 — `/api/trending/` + `/api/feed/foryou` (your followers).

### `feed-best-posting-time`
**Pitch.** Analyzes your last 90 days of impressions/engagement and outputs the 3 best windows for you (timezone-localized) with confidence intervals. Stops debating "is morning better."
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ windows: [{ start, end, score }], confidence: number }`
**Pricing.** 1 NEAR per report (refresh weekly).
**Categories.** `social`, `analytics`
**Tags.** `[timing, posting, schedule]`
**Status.** 🟢 — `/api/feed/engagement` + `/api/feed/impression`.

### `feed-mute-recommender`
**Pitch.** Suggests accounts to mute based on your dwell time + reply patterns (you keep scrolling past or rage-replying). Every keep-mute is a vote for sanity.
**Inputs.** `{ }`
**Outputs.** `{ candidates: [{ handle, reason, recommended_action }] }`
**Pricing.** Free.
**Categories.** `social`, `wellbeing`
**Tags.** `[mute, hygiene, signal]`
**Status.** 🟢 — `/api/feed/engagement` + `/api/feed/mute`.

### `feed-cross-poster`
**Pitch.** Mirror your X posts (via the connected Nitter feed) into IronFeed with attribution and your wallet's badge. Saves typing twice.
**Inputs.** `{ x_handle: string, mirror_replies?: bool, gate?: "free"|"pro" }`
**Outputs.** `{ mirrored_count }`
**Pricing.** 4 NEAR/month.
**Categories.** `social`, `automation`, `content`
**Tags.** `[cross-post, x-twitter, mirror]`
**Status.** 🟢 — `/api/trending/twitter` (Nitter) + `/api/posts`.

### `feed-ironclaw-reply`
**Pitch.** Auto-replies to `ironclaw-alerts` posts that mention you (e.g., "@you flagged in proposal #41"), drafting a measured response and flagging the urgent ones for human review.
**Inputs.** `{ auto_send_threshold?: "draft"|"send" }`
**Outputs.** `{ replies_drafted, replies_sent }`
**Pricing.** 3 NEAR/month.
**Categories.** `social`, `governance`, `automation`
**Tags.** `[ironclaw, alerts, autoreply]`
**Status.** 🟢 — `/api/feed/ironclaw-alerts` + reply drafter.

### `feed-quote-amplifier`
**Pitch.** When a verified poster quotes or cites you, broadcasts a follow-up to your own followers with a "here's what they missed" angle. Turns one mention into a small wave.
**Inputs.** `{ self_handle: string, only_verified?: bool }`
**Outputs.** `{ amplifications: [{ src_post_id, my_post_id }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `social`, `automation`, `growth`
**Tags.** `[amplify, quote, mentions]`
**Status.** 🟢 — `/api/posts/:id` polled for quotes-of-you + `/api/posts` post.

### `feed-comment-summarizer`
**Pitch.** Collapses 200+ comments on a post into a 5-bullet recap of where consensus + dispute land, so you can reply to the conversation, not the noise.
**Inputs.** `{ post_id: string }`
**Outputs.** `{ recap_bullets: string[5], dispute_axes: string[] }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `social`, `analytics`
**Tags.** `[summary, comments, consensus]`
**Status.** 🟢 — `/api/posts/:id` (hydrated comments).

### `feed-poster-credibility`
**Pitch.** Score a poster 0–100 on track-record reliability across their last 12 months: NewsCoin call hit rate, governance votes vs. outcomes, follower retention.
**Inputs.** `{ wallet_or_handle: string }`
**Outputs.** `{ score, breakdown: { calls, gov, retention } }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `social`, `analytics`, `risk`
**Tags.** `[credibility, score, track-record]`
**Status.** 🟢 — `/api/feed/foryou` (history) + `/api/governance/proposals` + `/api/newscoin/by-creator`.

### `feed-niche-radar`
**Pitch.** Daily list of new accounts gaining traction in tags you specify (engagement growth >50% week over week, started <60 days ago). Catches future heavyweights early.
**Inputs.** `{ niche_tags: string[] }`
**Outputs.** `{ rising: [{ handle, growth_pct, age_days }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `social`, `discovery`
**Tags.** `[radar, niche, rising]`
**Status.** 🟢 — `/api/feed/voices` + engagement deltas.

### `feed-trending-narrative-tracker`
**Pitch.** Daily 1-paragraph "what changed in the discourse today" — clusters trending tags into narratives, names them, attaches example posts.
**Inputs.** `{ delivery: "dm"|"telegram"|"none" }`
**Outputs.** `{ narratives: [{ name, summary, posts: string[] }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `social`, `discovery`, `digest`
**Tags.** `[narrative, trending, daily]`
**Status.** 🟢 — `/api/feed/trending` + `/api/feed/foryou`.

### `feed-impression-debugger`
**Pitch.** A specific post underperformed; this skill compares it to your last 20 hits and explains why (timing, hook strength, tag mix, follower decay).
**Inputs.** `{ post_id: string }`
**Outputs.** `{ verdict: string, contributing_factors: string[] }`
**Pricing.** 0.4 NEAR per call.
**Categories.** `social`, `analytics`
**Tags.** `[debug, impression, postmortem]`
**Status.** 🟢 — `/api/feed/impression` + `/api/feed/engagement` + `/api/posts/:id`.

### `feed-poll-creator`
**Pitch.** Drop a topic; get a poll question plus 4 distinct, defensible options that drive thoughtful votes. Avoids the lazy "yes/no/maybe/idk" pattern.
**Inputs.** `{ topic: string, audience?: "traders"|"builders"|"general" }`
**Outputs.** `{ question, options: string[4] }`
**Pricing.** 0.2 NEAR per call.
**Categories.** `social`, `content`
**Tags.** `[poll, content]`
**Status.** 🟡 — needs poll post `kind` in `/api/posts` (gov polls exist but not feed polls).

### `feed-reply-gap-finder`
**Pitch.** Finds high-engagement posts (top 5% by impressions) in your niche with <10 replies — the open mic moments. Lists 5 a day, with drafted opening replies.
**Inputs.** `{ niche_tags: string[] }`
**Outputs.** `{ opportunities: [{ post_id, impressions, draft }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `social`, `growth`, `discovery`
**Tags.** `[gap, opportunity, growth]`
**Status.** 🟢 — `/api/feed/foryou` + `/api/posts/:id`.

---

## 3. DM productivity (15 skills)

### `dm-triager`
**Pitch.** Classifies inbound DMs into urgent / business / info / spam buckets and routes them. Drafts replies for "info" requests so you only handle the urgent ones live.
**Inputs.** `{ rules?: { urgent_keywords?: string[], spam_threshold?: number } }`
**Outputs.** `{ classified_count, drafts_ready, urgent_count }`
**Pricing.** 5 NEAR/month.
**Categories.** `dm`, `productivity`
**Tags.** `[triage, inbox, dm]`
**Status.** 🟢 — `/api/dm/conversations` + `/api/dm/:cid/messages` + drafts via `/api/dm/assistant`.

### `dm-auto-responder`
**Pitch.** Stronger than out-of-office: drafts a contextual reply for any inbound DM (knows the thread history), holds it for your one-tap approval before send.
**Inputs.** `{ approval_mode: "auto"|"approve" }`
**Outputs.** `{ drafts_sent, drafts_pending }`
**Pricing.** 4 NEAR/month.
**Categories.** `dm`, `productivity`, `automation`
**Tags.** `[autoreply, drafts, dm]`
**Status.** 🟢 — `/api/dm/send` (encrypted send) + LLM drafts.

### `dm-out-of-office`
**Pitch.** Plain "I'm out, back on X" auto-reply with optional escalation rule (urgent keywords still get pinged via TG). Cheaper, simpler than triager — for vacations only.
**Inputs.** `{ message: string, until: ISO-date, escalate_urgent?: bool }`
**Outputs.** `{ replies_sent: number }`
**Pricing.** Free.
**Categories.** `dm`, `productivity`
**Tags.** `[ooo, autoreply, vacation]`
**Status.** 🟢 — `/api/dm/send`.

### `dm-summary-digest`
**Pitch.** Once a day, a 3-bullet recap of unread threads ("Alice asked about X", "Group ABC pivoting strategy"). Run after coffee instead of opening 14 tabs.
**Inputs.** `{ delivery_time: HH:MM, channel: "dm"|"tg" }`
**Outputs.** `{ digest_message_id }`
**Pricing.** 3 NEAR/month.
**Categories.** `dm`, `productivity`, `digest`
**Tags.** `[digest, summary, daily]`
**Status.** 🟡 — needs server-side decryption hook for encrypted threads (currently decrypt is client-only). Plaintext groups work today.

### `dm-fingerprint-verifier`
**Pitch.** First DM from a new peer? Auto-prompts verification flow ("Confirm fingerprint: ABC123 with them out-of-band"). Flags any peer whose key changes after verification.
**Inputs.** `{ }`
**Outputs.** `{ verified_count, mismatch_count }`
**Pricing.** Free (security funnel).
**Categories.** `dm`, `security`
**Tags.** `[fingerprint, verify, e2e]`
**Status.** 🟢 — `/api/dm/verifications/:peerWallet` + `/api/dm/verify`.

### `dm-mention-extractor`
**Pitch.** Pulls all $TICKERS, contract addresses, links, and named wallets out of a DM thread into a clean table. Handy when a friend dumps research at you.
**Inputs.** `{ conversation_id: string, lookback_days?: number }`
**Outputs.** `{ tickers: string[], contracts: string[], wallets: string[], links: string[] }`
**Pricing.** 0.2 NEAR per call.
**Categories.** `dm`, `productivity`
**Tags.** `[extract, tickers, contracts]`
**Status.** 🟢 — `/api/dm/:cid/messages` + regex/LLM.

### `dm-spam-filter`
**Pitch.** Silently moves low-trust senders (new wallets, no followers, scam-list match) to a quarantine bucket. Doesn't auto-reply (replying confirms aliveness).
**Inputs.** `{ rules?: { min_wallet_age_days?: number, min_followers?: number } }`
**Outputs.** `{ quarantined_count, allowed_count }`
**Pricing.** 2 NEAR/month.
**Categories.** `dm`, `security`
**Tags.** `[spam, filter, quarantine]`
**Status.** 🟡 — needs a `dm_quarantine` flag on conversation rows (read endpoint exists, write doesn't).

### `dm-followup-reminder`
**Pitch.** If you haven't replied to an opened thread in N hours, nudges you with a draft reply. Specifically for threads you marked "important", not all unreads.
**Inputs.** `{ threshold_hours: number, watched_conversation_ids?: string[] }`
**Outputs.** `{ nudges_sent }`
**Pricing.** 2 NEAR/month.
**Categories.** `dm`, `productivity`
**Tags.** `[followup, nudge, reminder]`
**Status.** 🟢 — `/api/dm/conversations` (last_read_at) + cron action.

### `dm-group-recap`
**Pitch.** Daily/weekly recap for a chosen group DM (plaintext groups only). Names the threads, top opinions, and any decisions.
**Inputs.** `{ group_id: string, cadence: "daily"|"weekly" }`
**Outputs.** `{ recap_post_id }`
**Pricing.** 3 NEAR/month per group.
**Categories.** `dm`, `groups`, `digest`
**Tags.** `[recap, group, digest]`
**Status.** 🟢 — `/api/dm/groups/:id/messages` + LLM.

### `dm-action-item-extractor`
**Pitch.** Scans your last 7 days of DMs and outputs a TODO list with source links. Nothing fancier — just "you said you'd send Alice the deck. Still need to."
**Inputs.** `{ lookback_days?: number }`
**Outputs.** `{ todos: [{ text, source_msg_id }] }`
**Pricing.** 1 NEAR per run.
**Categories.** `dm`, `productivity`
**Tags.** `[todo, action-items, productivity]`
**Status.** 🟡 — needs server-side decrypt hook for E2E threads (plaintext groups work).

### `dm-meeting-scheduler`
**Pitch.** Inside a thread, polls both sides for availability windows, picks an overlap, drops the calendar invite. Stops the "what about Tuesday" tennis match.
**Inputs.** `{ conversation_id: string, duration_min: number, range: "this-week"|"next-2-weeks" }`
**Outputs.** `{ proposed_slot, confirmed_by_both }`
**Pricing.** 0.5 NEAR per booking.
**Categories.** `dm`, `productivity`
**Tags.** `[scheduler, calendar, meet]`
**Status.** 🟡 — needs ICS/calendar emission pathway. DM coordination works today.

### `dm-translator`
**Pitch.** Translates inbound foreign-language DMs into your preferred language inline; preserves the encrypted source so the recipient still owns the plaintext.
**Inputs.** `{ target_lang: string }`
**Outputs.** `{ translated_count }`
**Pricing.** 0.05 NEAR per translated message.
**Categories.** `dm`, `productivity`, `i18n`
**Tags.** `[translate, language]`
**Status.** 🟡 — needs server-side decrypt for E2E. Group plaintext works today.

### `dm-key-rotation-helper`
**Pitch.** Walks you through rotating your DM keypair safely (back up old key, distribute new key per active peer, mark stale). Most users won't otherwise.
**Inputs.** `{ }`
**Outputs.** `{ steps_completed, peers_rekeyed }`
**Pricing.** Free (security).
**Categories.** `dm`, `security`, `onboarding`
**Tags.** `[key-rotation, security]`
**Status.** 🟢 — uses `/api/dm/groups/:id/key/distribute` + verify endpoints.

### `dm-leak-scanner`
**Pitch.** Before send, scans your draft for accidentally-pasted private keys, seed phrases, API keys, screenshots with EXIF leaks. One late-night save can repay a year's subscription.
**Inputs.** `{ draft_text: string, attachments?: { url, type }[] }`
**Outputs.** `{ leaks: [{ kind, severity }] }`
**Pricing.** 0.05 NEAR per scan, 1 NEAR/month for unlimited.
**Categories.** `dm`, `security`
**Tags.** `[leak, scan, security]`
**Status.** 🟢 — pure pre-send hook on the draft string.

### `dm-tone-checker`
**Pitch.** Reviews your draft DM before send; flags if tone reads passive-aggressive, accusatory, or off-brand for the relationship type. One-tap rewrite.
**Inputs.** `{ draft_text: string, relationship?: "client"|"friend"|"team"|"unknown" }`
**Outputs.** `{ tone_score, issues: string[], rewrite_suggestion: string }`
**Pricing.** 0.1 NEAR per check.
**Categories.** `dm`, `productivity`, `wellbeing`
**Tags.** `[tone, draft, communication]`
**Status.** 🟢 — pure LLM hop.

---

## 4. Trading terminal (20 skills)

### `trading-slippage-simulator`
**Pitch.** Simulate the actual fill price for a given size against a chosen pool's depth, factoring fees and route splits. Stops the "I expected 0.4% slippage and got 6%" surprise.
**Inputs.** `{ chain: "near"|"sol"|"bnb", pool: string, size_in_base: number, side: "buy"|"sell" }`
**Outputs.** `{ avg_fill_price, slippage_bps, fee_paid, route }`
**Pricing.** 0.1 NEAR per call.
**Categories.** `trading`, `analytics`
**Tags.** `[slippage, simulator, depth]`
**Status.** 🟢 — `/api/trading/ohlcv` + `/api/bridge/quote` (1click).

### `trading-copy-trade`
**Pitch.** Mirror trades from a wallet you trust, with a per-trade cap and a daily ceiling. Skips trades into tokens flagged by `risk-token-scorer`.
**Inputs.** `{ source_wallet: string, daily_cap_near: number, per_trade_cap_near: number, blocked_tokens?: string[] }`
**Outputs.** `{ copies_executed: [{ token, side, amount }] }`
**Pricing.** 8 NEAR setup, 0.4 NEAR per copy.
**Categories.** `trading`, `automation`
**Tags.** `[copy-trade, mirror, wallet]`
**Status.** 🟢 — `/api/trading/positions` (poll source) + own `/positions` POST.

### `trading-alpha-track-record`
**Pitch.** For any wallet, computes hit rate, ROI per trade, max drawdown, average hold, win/loss ratio over the last 90/180/365 days. Backs claims of "I'm up 4x" with math.
**Inputs.** `{ wallet: string, window_days: 90|180|365 }`
**Outputs.** `{ hit_rate, mean_roi, mdd, avg_hold_hrs, n_trades }`
**Pricing.** 1 NEAR per call.
**Categories.** `trading`, `analytics`, `social`
**Tags.** `[track-record, alpha, score]`
**Status.** 🟢 — `/api/trading/positions` (open=0).

### `trading-position-monitor`
**Pitch.** Watches your open positions for TP/SL hits and pings via DM and TG. Different from native price alerts — knows about your entry, not just price.
**Inputs.** `{ positions: [{ id, tp_pct, sl_pct }] }`
**Outputs.** `{ events: [{ position_id, kind, at }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `trading`, `alerts`
**Tags.** `[tp, sl, position-monitor]`
**Status.** 🟢 — `/api/trading/positions` + `/api/trading/ohlcv` + `/api/dm/send`.

### `trading-impermanent-loss-calc`
**Pitch.** For an LP position, projects expected IL across price scenarios and against just-holding. Saves the "why am I down vs spot" head-scratch.
**Inputs.** `{ pool: string, your_share: number, scenarios?: number[] }`
**Outputs.** `{ scenarios: [{ price_change_pct, il_pct, vs_hold_usd }] }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `trading`, `analytics`, `defi`
**Tags.** `[il, lp, defi]`
**Status.** 🟢 — `/api/trading/ohlcv`.

### `trading-dust-sweeper`
**Pitch.** Sweeps tiny token balances (under N NEAR equivalent) into NEAR or USDC in a single batched route. Cleans up the long tail.
**Inputs.** `{ min_balance_usd?: number, target: "NEAR"|"USDC" }`
**Outputs.** `{ swept: [{ token, amount_in, amount_out }] }`
**Pricing.** 1 NEAR per sweep.
**Categories.** `trading`, `wallet-hygiene`
**Tags.** `[dust, sweep, cleanup]`
**Status.** 🟢 — `/api/portfolio/` + `/api/bridge/submit`.

### `trading-cross-chain-arb-finder`
**Pitch.** Finds momentary cross-chain price gaps for the same asset (USDT, ETH, NEAR) factoring 1-click bridge fees. Lists actionable gaps, doesn't fire by default.
**Inputs.** `{ assets: string[], min_gap_bps: number }`
**Outputs.** `{ opportunities: [{ src_chain, dst_chain, asset, gap_bps, est_profit_usd }] }`
**Pricing.** 5 NEAR/month.
**Categories.** `trading`, `bridge`, `arbitrage`
**Tags.** `[arb, cross-chain, bridge]`
**Status.** 🟢 — `/api/bridge/quote` + `/api/trading/ohlcv`.

### `trading-route-optimizer`
**Pitch.** Compares routes across direct DEX, NEAR Intents 1-click, and same-chain hops; picks the cheapest considering bridge fees and slippage.
**Inputs.** `{ from_asset: string, to_asset: string, amount: number }`
**Outputs.** `{ best_route, total_cost_bps, alternatives }`
**Pricing.** 0.1 NEAR per call.
**Categories.** `trading`, `bridge`
**Tags.** `[route, optimizer, dex]`
**Status.** 🟢 — `/api/bridge/quote` + `/api/trading/ohlcv` (Ref).

### `trading-tax-lot-organizer`
**Pitch.** FIFO/LIFO lot accounting across all your tracked positions, exported as CSV with realized/unrealized PnL. Includes NewsCoin trades.
**Inputs.** `{ method: "FIFO"|"LIFO", year: number }`
**Outputs.** `{ download_url, total_realized_usd, total_unrealized_usd }`
**Pricing.** 5 NEAR per export.
**Categories.** `trading`, `tax`
**Tags.** `[tax, fifo, accounting]`
**Status.** 🟢 — `/api/trading/positions`.

### `trading-rug-survival-stats`
**Pitch.** Of your last 100 trades, what % were rugs / honeypots / softrugs vs runners? Honest mirror of your filter quality. Pairs well with `risk-honeypot-detector` so you can A/B yourself.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ stats: { rugs, honeypots, softrugs, winners }, recommendations: string[] }`
**Pricing.** 1 NEAR per call.
**Categories.** `trading`, `analytics`, `risk`
**Tags.** `[rug, postmortem, honesty]`
**Status.** 🟢 — `/api/trading/positions` + `/api/security/check-wallet`.

### `trading-risk-grader`
**Pitch.** Grades your current open portfolio A–F on risk: concentration, time-in-market mix, scam-list exposure, illiquid bag tail. One letter and a 2-bullet why.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ grade: "A"-"F", drivers: string[2] }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `trading`, `risk`, `analytics`
**Tags.** `[risk, grade, portfolio]`
**Status.** 🟢 — `/api/portfolio/` + `/api/trading/positions` + `/api/security/check-wallet`.

### `trading-position-thesis-logger`
**Pitch.** Each entry, log a one-paragraph thesis. On exit, the skill grades the thesis vs outcome and adds it to your trader journal. Compounds: you stop repeating the same mistake.
**Inputs.** `{ position_id?: string, thesis_text: string }`
**Outputs.** `{ logged_at, journal_url, prior_grades_summary }`
**Pricing.** 2 NEAR/month.
**Categories.** `trading`, `journaling`
**Tags.** `[journal, thesis, trader]`
**Status.** 🟡 — needs `position_thesis` table addition (positions table exists).

### `trading-stop-loss-trailer`
**Pitch.** Trailing stop-loss on a NewsCoin or on-chain position; trails N% below the high-water mark. Fires sell tx when breached.
**Inputs.** `{ position_id: string, trail_pct: number }`
**Outputs.** `{ armed_at, fired_at?, fill_price? }`
**Pricing.** 2 NEAR setup, 0.2 NEAR per fire.
**Categories.** `trading`, `automation`
**Tags.** `[trailing-stop, sl, automation]`
**Status.** 🟢 — `/api/trading/ohlcv` + sell tx via wallet proxy.

### `trading-volatility-alert`
**Pitch.** Alerts when a token in your watchlist has an intraday move >Xσ vs its 30d realized vol. Catches breakouts and capitulations before the chat does.
**Inputs.** `{ tokens: string[], sigma: number }`
**Outputs.** `{ alerts: [{ token, move_sigma, dir }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `trading`, `alerts`
**Tags.** `[volatility, alert, vol]`
**Status.** 🟢 — `/api/trading/ohlcv` + `/api/tg/price-alerts/add`.

### `trading-pump-radar`
**Pitch.** Radar of small caps (<$10M MC) showing >50% volume + holder growth in last 24h on chains you trade. Differs from generic trending lists by filtering for actionable size.
**Inputs.** `{ chains: string[], max_mcap_usd: number }`
**Outputs.** `{ radar: [{ token, chain, mcap, vol_growth, holder_growth }] }`
**Pricing.** 5 NEAR/month.
**Categories.** `trading`, `discovery`
**Tags.** `[pump, radar, smallcap]`
**Status.** 🟡 — needs holder-count tracker (volume from `/ohlcv` works; holders need an indexer add).

### `trading-whales-tracker`
**Pitch.** Watch a list of whale wallets; alert when ≥N of them buy the same token within a window. Stops "who is this whale, did anyone else front-run him" guessing.
**Inputs.** `{ whales: string[], min_overlap: 2|3|5, window_minutes: number }`
**Outputs.** `{ overlaps: [{ token, count, wallets }] }`
**Pricing.** 6 NEAR/month.
**Categories.** `trading`, `alerts`, `discovery`
**Tags.** `[whales, smart-money, overlap]`
**Status.** 🟢 — `/api/trading/positions` per whale.

### `trading-fee-leaderboard`
**Pitch.** Weekly digest: how much you paid in fees, broken down by chain/protocol/skill, and where to cut. Most people are paying 3x what they think.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ total_fees_usd, by_route, top_savings_advice }`
**Pricing.** Free (drives optimization upsell).
**Categories.** `trading`, `analytics`, `fees`
**Tags.** `[fees, digest, savings]`
**Status.** 🟢 — `/api/trading/fees`.

### `trading-mev-detector`
**Pitch.** Checks if your last N trades show sandwich-attack patterns (front-run + back-run by same wallet). Quantifies the bleed and recommends private-RPC routes.
**Inputs.** `{ wallet?: string, n: number }`
**Outputs.** `{ sandwiches_found: int, lost_usd, recommended_route }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `trading`, `risk`, `mev`
**Tags.** `[mev, sandwich, postmortem]`
**Status.** 🟡 — needs mempool/block-trace indexer for the relevant chain (Solana works, NEAR semi).

### `trading-rebalance-bot`
**Pitch.** Maintains a multi-token portfolio at target weights; rebalances when drift exceeds threshold. Different from NewsCoin rebalancer — works across chains and includes spot tokens.
**Inputs.** `{ targets: [{ token, chain, weight_pct }], drift_threshold_pct: number }`
**Outputs.** `{ rebalances_executed }`
**Pricing.** 8 NEAR setup, 1 NEAR per rebalance.
**Categories.** `trading`, `automation`, `portfolio`
**Tags.** `[rebalance, multi-chain, weights]`
**Status.** 🟢 — `/api/portfolio/` + `/api/bridge/submit` + `/positions`.

### `trading-swap-deferrer`
**Pitch.** Schedules a non-urgent swap for the historically cheapest gas window of the next 24h on the chosen chain. Saves gas, not edge.
**Inputs.** `{ swap: { from, to, amount }, deadline_hours: number }`
**Outputs.** `{ scheduled_at, projected_fee_usd, executed_fee_usd? }`
**Pricing.** 0.2 NEAR per swap.
**Categories.** `trading`, `automation`, `gas`
**Tags.** `[gas, swap, scheduler]`
**Status.** 🟡 — needs a per-chain gas-history table (NEAR is essentially flat; useful on EVM destinations via 1click).

---

## 5. Governance (14 skills)

### `gov-proposal-summarizer`
**Pitch.** TL;DR every active proposal in 5 bullets: what it changes, who proposed, voting deadline, financial impact, conflicts. Linked to the source proposal id.
**Inputs.** `{ proposal_id?: string, all_active?: bool }`
**Outputs.** `{ summaries: [{ proposal_id, bullets: string[5] }] }`
**Pricing.** 0.5 NEAR per call (or 2 NEAR/month for all-active daily).
**Categories.** `governance`, `analytics`
**Tags.** `[summary, proposal, tldr]`
**Status.** 🟢 — `/api/governance/proposals` + LLM.

### `gov-vote-recommender`
**Pitch.** Walks you through 5 questions to capture your values, then recommends a vote on each active proposal with a rationale. Updates as your stated values change.
**Inputs.** `{ values_profile?: object, proposal_id?: string }`
**Outputs.** `{ recommendations: [{ proposal_id, vote: "for"|"against", rationale }] }`
**Pricing.** 1 NEAR per call.
**Categories.** `governance`, `analytics`
**Tags.** `[recommend, vote, values]`
**Status.** 🟢 — `/api/governance/proposals` + LLM.

### `gov-delegate-finder`
**Pitch.** Given your past votes (or your stated values), finds the 3 delegates whose vote pattern most aligns. Stops "who do I delegate to" being a 4-hour Telegram quest.
**Inputs.** `{ wallet?: string, values_profile?: object }`
**Outputs.** `{ matches: [{ wallet, alignment_pct, recent_votes_summary }] }`
**Pricing.** 1 NEAR per call.
**Categories.** `governance`, `discovery`
**Tags.** `[delegate, alignment, find]`
**Status.** 🟢 — `/api/governance/proposals/:id` votes table + math.

### `gov-mission-analyzer`
**Pitch.** For mission proposals (the agent-economy escrow + payout pattern), spells out who pays, who claims, payout schedule, and risk to treasury if claim fails.
**Inputs.** `{ proposal_id: string }`
**Outputs.** `{ payer, claimant, escrow_yocto, risk_summary }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `governance`, `missions`
**Tags.** `[mission, analyzer, escrow]`
**Status.** 🟢 — `/api/governance/proposals/:id` + `/api/missions/:id`.

### `gov-quorum-watcher`
**Pitch.** Alerts when a proposal you've flagged is short of quorum within 24h of close. Optionally auto-casts your pre-committed vote.
**Inputs.** `{ proposal_ids: string[], auto_cast?: bool, my_vote?: "for"|"against" }`
**Outputs.** `{ alerts_sent, auto_casts_executed }`
**Pricing.** 2 NEAR/month.
**Categories.** `governance`, `alerts`, `automation`
**Tags.** `[quorum, watcher, deadline]`
**Status.** 🟢 — `/api/governance/proposals/:id` + tx via wallet proxy.

### `gov-conflict-detector`
**Pitch.** Flags when two pending proposals contradict each other ("Proposal A sets fee 10%, Proposal B sets fee 12% on same surface"). Surfaces governance hygiene issues early.
**Inputs.** `{ }`
**Outputs.** `{ conflicts: [{ proposal_a, proposal_b, surface, severity }] }`
**Pricing.** 0.5 NEAR per scan.
**Categories.** `governance`, `analytics`
**Tags.** `[conflict, hygiene, dependencies]`
**Status.** 🟢 — `/api/governance/proposals` + LLM.

### `gov-vote-history-export`
**Pitch.** Export your full vote history as CSV with rationales (if logged via vote-recommender). Useful for delegate accountability or just reflecting on past stances.
**Inputs.** `{ wallet?: string, year?: number }`
**Outputs.** `{ download_url, rows: number }`
**Pricing.** 1 NEAR per export.
**Categories.** `governance`, `export`
**Tags.** `[history, export, votes]`
**Status.** 🟢 — `/api/governance/proposals/:id` votes view per proposal.

### `gov-proposal-drafter`
**Pitch.** Turns a paragraph of intent into a well-structured proposal (title, summary, rationale, expected impact, voting question). Doesn't post; you review and submit.
**Inputs.** `{ intent: string, type: "config"|"treasury"|"prompt"|"mission" }`
**Outputs.** `{ draft: { title, description, content }, recommended_voting_window }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `governance`, `content`
**Tags.** `[drafter, proposal, content]`
**Status.** 🟢 — pure LLM, posts via `/api/governance/proposals`.

### `gov-prompt-diff-viewer`
**Pitch.** For agent-prompt change proposals, shows the actual diff vs current on-chain prompt — character-level, not just summary. Voters know what they're approving.
**Inputs.** `{ proposal_id: string }`
**Outputs.** `{ diff_html, surface_changed: string[] }`
**Pricing.** Free (governance hygiene).
**Categories.** `governance`, `viewer`
**Tags.** `[diff, prompt, viewer]`
**Status.** 🟢 — `/api/governance/proposals/:id` + on-chain agent state read.

### `gov-treasury-spend-tracker`
**Pitch.** Reconciles every treasury proposal that passed against actual on-chain spend. Surfaces unspent allocations, overspends, and proposers with bad track record.
**Inputs.** `{ window_days?: number }`
**Outputs.** `{ proposals: [{ id, allocated, spent, status }], laggards: string[] }`
**Pricing.** 1 NEAR per report.
**Categories.** `governance`, `treasury`, `analytics`
**Tags.** `[treasury, spend, audit]`
**Status.** 🟢 — `/api/governance/proposals` + `/api/newscoin/treasury` + RPC.

### `gov-voter-rep-leaderboard`
**Pitch.** Public ranking of voters by % of votes that aligned with the eventual outcome. Reputational, not financial — but creates a long-term incentive to vote thoughtfully.
**Inputs.** `{ window_days?: number }`
**Outputs.** `{ ranking: [{ wallet, alignment_pct, n_votes }] }`
**Pricing.** Free.
**Categories.** `governance`, `social`
**Tags.** `[leaderboard, voter, reputation]`
**Status.** 🟢 — `/api/governance/proposals/:id` votes per proposal.

### `gov-stake-vote-optimizer`
**Pitch.** Recommends a stake-lock duration that maximizes voting power vs. opportunity cost of locked NEAR, given upcoming proposals you care about.
**Inputs.** `{ stakeable_near: number, watched_proposal_ids?: string[] }`
**Outputs.** `{ recommended_lock_days, projected_power, opportunity_cost_pct }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `governance`, `optimization`
**Tags.** `[stake, lock, optimize]`
**Status.** 🟢 — on-chain stake math + `/api/governance/proposals` (deadlines).

### `gov-proposal-similar-search`
**Pitch.** Find historic proposals semantically similar to the one in front of you and how they were ultimately resolved. Stops the community relitigating settled questions.
**Inputs.** `{ proposal_id: string }`
**Outputs.** `{ similar: [{ proposal_id, title, outcome, similarity }] }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `governance`, `discovery`
**Tags.** `[similar, history, precedent]`
**Status.** 🟡 — needs proposal-text embeddings index (cheap to build; not yet present).

### `gov-vanguard-revshare-claimer`
**Pitch.** Vanguard NFT holders earn revshare drops; this skill claims them on a schedule once accumulated value passes threshold. Stops gas burn on dust.
**Inputs.** `{ wallet?: string, min_claim_near: number }`
**Outputs.** `{ claims: [{ epoch, amount, tx_hash }] }`
**Pricing.** 2 NEAR setup, 0.2 NEAR per claim.
**Categories.** `governance`, `vanguard`, `automation`
**Tags.** `[vanguard, revshare, claim]`
**Status.** 🟢 — Vanguard contract methods + automation cron.

---

## 6. Live Rooms (14 skills)

### `room-moderator`
**Pitch.** Watches room chat for rule-breaking content (slurs, scam links, stake-evasion), suggests mute/kick to host with one-tap actions. Doesn't act unilaterally.
**Inputs.** `{ rules: string[], action_threshold?: "suggest"|"auto" }`
**Outputs.** `{ flagged_messages: int, actions_taken }`
**Pricing.** 4 NEAR/month per room.
**Categories.** `rooms`, `moderation`
**Tags.** `[moderator, rules, kick]`
**Status.** 🟢 — `/api/rooms/:id/messages` poll + `/mute` `/kick`.

### `room-recap-generator`
**Pitch.** On room close, generates a 5-bullet recap post with the recording link, top alpha calls, and standout speakers, posted to IronFeed.
**Inputs.** `{ room_id: string, post_to_feed?: bool }`
**Outputs.** `{ recap_post_id, recording_url }`
**Pricing.** 1 NEAR per recap.
**Categories.** `rooms`, `content`
**Tags.** `[recap, summary, recording]`
**Status.** 🟢 — `/api/rooms/:id` + chat endpoints + `/api/posts`.

### `room-alpha-validator`
**Pitch.** When a speaker calls an alpha (e.g., "I'm long $NEAR here"), fact-checks claims against on-chain data in <5s and posts a green/yellow/red flag to chat.
**Inputs.** `{ room_id: string, validate_threshold?: "speaker"|"all" }`
**Outputs.** `{ validations_pushed }`
**Pricing.** 6 NEAR/month per room.
**Categories.** `rooms`, `analytics`
**Tags.** `[alpha, validate, factcheck]`
**Status.** 🟢 — `/api/rooms/:id/messages` + `/api/research/`.

### `room-speaker-queue`
**Pitch.** Stake-aware speaker queue: hand-raises sorted by amount of stake the listener has locked, so high-conviction questions go first. Built for high-value alpha rooms.
**Inputs.** `{ room_id: string, min_stake_near?: number }`
**Outputs.** `{ queue: [{ wallet, stake, raised_at }] }`
**Pricing.** 5 NEAR/month per room.
**Categories.** `rooms`, `moderation`
**Tags.** `[queue, stake, speaker]`
**Status.** 🟡 — `/api/rooms/:id/raise` exists; needs queue-ordering view (cheap UI add).

### `room-alpha-call-tracker`
**Pitch.** Records every alpha call in a room (with vote counts) and tracks 24h/7d/30d performance. Builds an alpha track record for that room and each speaker.
**Inputs.** `{ room_id: string }`
**Outputs.** `{ calls: [{ msg_id, ticker, posted_at, perf_24h, perf_7d }] }`
**Pricing.** 3 NEAR/month per room.
**Categories.** `rooms`, `analytics`
**Tags.** `[alpha, track-record, room]`
**Status.** 🟢 — `/api/rooms/:id/messages` (isAlphaCall flag) + `/api/trading/ohlcv`.

### `room-question-collector`
**Pitch.** Collects listener questions throughout a room, dedupes/clusters, hands the host a top-5 list at chosen marks. Avoids host scrolling 200 raised hands mid-flow.
**Inputs.** `{ room_id: string, batch_minutes: number }`
**Outputs.** `{ batches: [{ posted_at, top_5: string[] }] }`
**Pricing.** 2 NEAR per room.
**Categories.** `rooms`, `productivity`
**Tags.** `[questions, batch, host]`
**Status.** 🟢 — `/api/rooms/:id/messages`.

### `room-recording-summarizer`
**Pitch.** Turns the egress mp4 into chapters + transcript bullets + auto-generated quote cards. The "I missed the room, give me the gold" surface.
**Inputs.** `{ room_id: string }`
**Outputs.** `{ chapters: [{ start, title }], bullets: string[], quote_cards_url[] }`
**Pricing.** 3 NEAR per room.
**Categories.** `rooms`, `content`
**Tags.** `[recording, transcript, chapters]`
**Status.** 🟡 — needs ASR worker hooked into the LiveKit egress webhook (mp4 in R2 today, no transcription).

### `room-host-cohost-coordinator`
**Pitch.** Runs the run-sheet for a multi-host room (intro, segment timing, handoff cues, sponsor reads) and pings hosts in DM at the right beats.
**Inputs.** `{ room_id: string, run_sheet: [{ at, action }] }`
**Outputs.** `{ pings_sent }`
**Pricing.** 2 NEAR per room.
**Categories.** `rooms`, `productivity`
**Tags.** `[runsheet, host, coordination]`
**Status.** 🟢 — timed cron + `/api/dm/send`.

### `room-promo-poster`
**Pitch.** 30 minutes before going live, drafts and posts a teaser to your IronFeed with topic, speakers, and stake floor. Stops the "we're live, but no one knew" failure.
**Inputs.** `{ room_id: string, lead_minutes?: number }`
**Outputs.** `{ teaser_post_id, schedule_status }`
**Pricing.** 1 NEAR per use.
**Categories.** `rooms`, `marketing`
**Tags.** `[promo, teaser, schedule]`
**Status.** 🟢 — `/api/rooms/:id` + `/api/posts`.

### `room-attendee-rewarder`
**Pitch.** Distributes small NEAR drops to listeners who stayed >X minutes. Tiny, but it boosts retention measurably and creates a culture of showing up.
**Inputs.** `{ room_id: string, min_minutes: number, total_drop_near: number }`
**Outputs.** `{ recipients: [{ wallet, amount }], total_paid }`
**Pricing.** 5 NEAR setup + the drop budget.
**Categories.** `rooms`, `growth`, `creator`
**Tags.** `[reward, drop, retention]`
**Status.** 🟢 — `/api/rooms/:id` participants + ft_transfer.

### `room-engagement-scorer`
**Pitch.** Hosts get a post-room score for the room: question count, alpha-call vote ratio, retention curve, top-talker ratio. Stops them flying blind on whether the room landed.
**Inputs.** `{ room_id: string }`
**Outputs.** `{ score: 0-100, drivers, recommendations }`
**Pricing.** 1 NEAR per room.
**Categories.** `rooms`, `analytics`, `creator`
**Tags.** `[score, retention, engagement]`
**Status.** 🟢 — `/api/rooms/:id/messages` + LiveKit join/leave events.

### `room-alpha-leaderboard`
**Pitch.** Weekly cross-room leaderboard of best alpha calls (24h hit), with speaker handles and rooms. Rewards the room ecosystem's actual signal-makers.
**Inputs.** `{ window_days?: number }`
**Outputs.** `{ top_speakers: [{ handle, hits, room_ids }] }`
**Pricing.** Free.
**Categories.** `rooms`, `discovery`
**Tags.** `[leaderboard, alpha, weekly]`
**Status.** 🟢 — `/api/rooms/:id/messages/:msgId/vote` aggregations + price feed.

### `room-stake-floor-recommender`
**Pitch.** Recommends a join-stake based on topic value and historic participation in similar rooms. Stops hosts under-pricing alpha rooms or scaring listeners away with too-high stakes.
**Inputs.** `{ topic: string, expected_listeners?: number }`
**Outputs.** `{ recommended_stake_near, comp_table }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `rooms`, `pricing`, `creator`
**Tags.** `[stake, pricing, floor]`
**Status.** 🟢 — `/api/rooms` historical data.

### `room-aftermath-compiler`
**Pitch.** Bundles recording mp4 + recap + chat highlights + alpha-call leaderboard into a single shareable post. The "did we have a room?" deliverable for sponsors.
**Inputs.** `{ room_id: string }`
**Outputs.** `{ post_id, embed_url }`
**Pricing.** 2 NEAR per room.
**Categories.** `rooms`, `content`
**Tags.** `[aftermath, bundle, sponsor]`
**Status.** 🟢 — `/api/rooms/:id` + recap + alpha tracker + `/api/posts`.

---

## 7. Onboarding & wallet hygiene (12 skills)

### `onboard-security-audit`
**Pitch.** End-to-end first-day check: token allowances, scam-list exposure, key custody (custodial vs hardware), DM verification status. Single A–F grade plus the 3 things to fix today.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ grade, findings: [{ severity, action }] }`
**Pricing.** Free (funnel skill).
**Categories.** `onboarding`, `security`
**Tags.** `[audit, security, onboarding]`
**Status.** 🟢 — `/api/security/check-wallet` + allowance read + `/api/dm/verifications`.

### `onboard-first-buy-guide`
**Pitch.** Step-by-step "your first NewsCoin": pick from trending, explain the curve, walk through the buy at safe size, log the thesis. Holds your hand without being condescending.
**Inputs.** `{ budget_near: number }`
**Outputs.** `{ steps_completed, position_id }`
**Pricing.** Free.
**Categories.** `onboarding`, `newscoin`
**Tags.** `[first-buy, guide, onboarding]`
**Status.** 🟢 — `/api/newscoin/list?filter=trending` + `/curve` + `/verify-trade`.

### `onboard-kit-installer`
**Pitch.** Picks a recommended kit based on user's stated goals (degen / creator / governance nerd / DM-heavy), installs it, configures presets, tests one end-to-end run.
**Inputs.** `{ persona: "degen"|"creator"|"governance"|"dm-heavy" }`
**Outputs.** `{ installed_kit_slug, configured_skills, dry_run_result }`
**Pricing.** Free.
**Categories.** `onboarding`, `kits`
**Tags.** `[kit, installer, onboarding]`
**Status.** 🟢 — `/api/kits` + `/api/kits/:slug` + automation creation.

### `onboard-recovery-helper`
**Pitch.** Walks through the unhappy paths: lost seed (use NEAR account recovery), partial key compromise (rotate DM key, revoke allowances), wallet drained (file report, freeze).
**Inputs.** `{ scenario: "lost-seed"|"partial-compromise"|"drained" }`
**Outputs.** `{ steps_completed, escalations: string[] }`
**Pricing.** Free (security funnel).
**Categories.** `onboarding`, `security`
**Tags.** `[recovery, seed, compromise]`
**Status.** 🟢 — `/api/security/report` + DM key rotation + RPC.

### `onboard-allowance-pruner`
**Pitch.** Lists token allowances ranked by risk (unlimited > large > stale > small), revokes selected ones in a batched tx. Saves you from the next one-click drain.
**Inputs.** `{ revoke_unlimited?: bool, revoke_stale_days?: number }`
**Outputs.** `{ revoked: [{ token, contract, prior_value }], total_revoked }`
**Pricing.** 1 NEAR per pass.
**Categories.** `onboarding`, `security`, `wallet-hygiene`
**Tags.** `[allowance, prune, revoke]`
**Status.** 🟢 — RPC allowance read + revoke txs.

### `onboard-account-freezer-helper`
**Pitch.** Compromised? Walks through emergency freeze: pause all running automations, revoke allowances, rotate DM key, post a public notice if relevant. Coordinates the chaos.
**Inputs.** `{ }`
**Outputs.** `{ steps_completed, automations_paused: int, allowances_revoked: int }`
**Pricing.** Free (security funnel).
**Categories.** `onboarding`, `security`, `emergency`
**Tags.** `[freeze, emergency, lockdown]`
**Status.** 🟢 — `/api/agents/automations` PATCH + revoke + key rotation.

### `onboard-portfolio-import`
**Pitch.** Import positions from another wallet (yours, not the user's other random wallet) so the trading terminal and skills can reason about your full bag. Read-only.
**Inputs.** `{ external_wallet: string, chain: string }`
**Outputs.** `{ positions_imported }`
**Pricing.** Free.
**Categories.** `onboarding`, `portfolio`
**Tags.** `[import, portfolio]`
**Status.** 🟢 — `/api/portfolio/` action=add_wallet.

### `onboard-pro-membership-helper`
**Pitch.** Explains Pro perks (higher AI budget, badge, themes), checks $IRONCLAW balance, locks the right amount for the chosen tier, confirms activation.
**Inputs.** `{ tier?: "basic"|"plus"|"max" }`
**Outputs.** `{ tier_activated, lock_amount, unlock_date }`
**Pricing.** Free.
**Categories.** `onboarding`, `pro`
**Tags.** `[pro, membership, lock]`
**Status.** 🟢 — pro_locks contract methods + balance reads.

### `onboard-feed-bootstrap`
**Pitch.** New user with empty feed? Picks 50 first follows from interests + persona heuristics. After 7 days, suggests prunes for accounts that didn't earn engagement.
**Inputs.** `{ interests: string[], persona?: string }`
**Outputs.** `{ followed_count, scheduled_review_at }`
**Pricing.** Free.
**Categories.** `onboarding`, `social`, `discovery`
**Tags.** `[bootstrap, follow, feed]`
**Status.** 🟢 — `/api/feed/voices` + follow tx + scheduled re-eval.

### `onboard-vanguard-eligibility-checker`
**Pitch.** Shows the user what they need to qualify for Vanguard NFT (history, holdings, governance participation), with a tracker. Most are 80% there and don't realize.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ eligible: bool, missing_criteria: string[] }`
**Pricing.** Free.
**Categories.** `onboarding`, `vanguard`
**Tags.** `[vanguard, eligibility]`
**Status.** 🟢 — Vanguard contract reads + on-chain history.

### `onboard-tg-link-helper`
**Pitch.** Walks through linking the Telegram bot: mints code, points user at t.me/<bot>?start=<code>, confirms link, configures notifications.
**Inputs.** `{ }`
**Outputs.** `{ tg_user_id, settings_initialized }`
**Pricing.** Free.
**Categories.** `onboarding`, `telegram`
**Tags.** `[telegram, link, bot]`
**Status.** 🟢 — `/api/tg/link-code` + `/api/tg/status`.

### `onboard-wallet-tier-grader`
**Pitch.** Gives the user's wallet a hygiene tier (Bronze/Silver/Gold/Platinum) with the specific actions needed to advance. Different from `onboard-security-audit` — about positive growth, not just risk.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ tier, advancement_actions: string[], next_tier_estimate_days }`
**Pricing.** Free.
**Categories.** `onboarding`, `gamification`
**Tags.** `[tier, grade, gamification]`
**Status.** 🟢 — composite of audit + on-chain history.

---

## 8. Personal productivity (12 skills)

### `daily-brief`
**Pitch.** Sub-200-word morning brief on your watched topics with markets, governance deadlines, mentions. Improved over the existing built-in: persistent topics + tone choice.
**Inputs.** `{ topics: string[], tone?: "neutral"|"snappy"|"analyst" }`
**Outputs.** `{ brief_text, sources: string[] }`
**Pricing.** 3 NEAR/month.
**Categories.** `productivity`, `digest`
**Tags.** `[brief, morning, daily]`
**Status.** 🟢 — extends existing `daily_briefing` skill.

### `weekly-recap`
**Pitch.** Sunday-evening one-pager: PnL, governance votes, social engagement, missions claimed/completed, top wins, top regrets. Closes the week deliberately.
**Inputs.** `{ delivery: "dm"|"tg" }`
**Outputs.** `{ recap_message_id }`
**Pricing.** 4 NEAR/month.
**Categories.** `productivity`, `digest`, `analytics`
**Tags.** `[weekly, recap, reflection]`
**Status.** 🟢 — composite reads across `/api/trading/positions`, `/api/governance/proposals`, `/api/feed/engagement`, `/api/missions`.

### `calendar-sync`
**Pitch.** Outputs an ICS feed of your AZUKA events: live rooms you said you'd attend, governance deadlines, mission deadlines, scheduled automations.
**Inputs.** `{ include: { rooms?: bool, gov?: bool, missions?: bool } }`
**Outputs.** `{ ics_url }`
**Pricing.** 2 NEAR/month.
**Categories.** `productivity`, `calendar`
**Tags.** `[ics, calendar, sync]`
**Status.** 🟡 — needs an /ics serve route (data is all there).

### `cross-feed-amplifier`
**Pitch.** When you post on X, mirror to IronFeed automatically (with attribution and the "originally on X" badge). Different from `feed-cross-poster` by being one-way + automatic.
**Inputs.** `{ x_handle: string, mirror_replies?: bool }`
**Outputs.** `{ mirrored_count, dropped_count }`
**Pricing.** 3 NEAR/month.
**Categories.** `productivity`, `social`, `automation`
**Tags.** `[mirror, xpost, automation]`
**Status.** 🟢 — `/api/trending/twitter` + `/api/posts`.

### `reminder-chronicler`
**Pitch.** Natural-language reminders: "remind me when ABC hits 0.5 NEAR", "remind me about Alice's proposal Tuesday", "remind me to claim creator fees Friday". Routes to TG/DM.
**Inputs.** `{ utterance: string }`
**Outputs.** `{ reminder_id, trigger_summary }`
**Pricing.** 0.05 NEAR per reminder, or 2 NEAR/month for unlimited.
**Categories.** `productivity`, `reminders`
**Tags.** `[reminder, natural-language]`
**Status.** 🟢 — `/api/agents/automations` (cron + price triggers).

### `read-later-queue`
**Pitch.** Save posts and links to a queue; daily summarizes the queue and pings you with the 3 most important ones to read first. Beats bookmarking 80 things you'll never see again.
**Inputs.** `{ }`
**Outputs.** `{ queue_size, priority_3 }`
**Pricing.** 2 NEAR/month.
**Categories.** `productivity`, `content`
**Tags.** `[read-later, queue, summary]`
**Status.** 🟡 — needs a `read_later` table (cheap to add).

### `daily-watchlist-dashboard`
**Pitch.** Single screen of every watched token + watched poster, color-coded for movement. Renders in a DM/TG card so you don't open a 6-tab watchlist app.
**Inputs.** `{ delivery: "dm"|"tg", time: HH:MM }`
**Outputs.** `{ card_message_id }`
**Pricing.** 3 NEAR/month.
**Categories.** `productivity`, `dashboard`
**Tags.** `[watchlist, dashboard, daily]`
**Status.** 🟢 — `/api/tg/watchlist/:tgId` + `/api/trading/ohlcv` + render via `/api/tg/agent`.

### `weekly-bookmarks-digest`
**Pitch.** Each week, surfaces bookmarks you saved but never read or acted on. Gentle nudge plus a 1-line "still relevant?" tag.
**Inputs.** `{ }`
**Outputs.** `{ stale_bookmarks, prompt_action: bool }`
**Pricing.** Free.
**Categories.** `productivity`, `digest`
**Tags.** `[bookmarks, digest, stale]`
**Status.** 🟡 — bookmarks table exists; needs read-state tracking add.

### `meeting-prep-brief`
**Pitch.** Before a 1:1 (DM or scheduled call), one-page prep on the counterparty: last 10 posts, current holdings of relevance, mutual contacts, recent governance votes.
**Inputs.** `{ counterparty_wallet: string }`
**Outputs.** `{ brief_text }`
**Pricing.** 0.5 NEAR per brief.
**Categories.** `productivity`, `dm`
**Tags.** `[prep, meeting, counterparty]`
**Status.** 🟢 — composite reads across feed/governance/portfolio.

### `goal-tracker`
**Pitch.** Record weekly/monthly goals ("ship a skill", "vote on every proposal", "post 5x"); skill grades end-of-period from on-chain + IronFeed activity.
**Inputs.** `{ goals: string[], period: "weekly"|"monthly" }`
**Outputs.** `{ grades: [{ goal, score, evidence }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `productivity`, `gamification`
**Tags.** `[goals, tracker, grade]`
**Status.** 🟡 — needs a `user_goals` table (cheap).

### `eod-shutdown-checklist`
**Pitch.** End-of-day checklist: TP hits to acknowledge, gov votes due in 24h, unread DMs flagged urgent, automations that errored. Close the loop.
**Inputs.** `{ time: HH:MM }`
**Outputs.** `{ checklist: [{ kind, count }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `productivity`, `dashboard`
**Tags.** `[eod, checklist, shutdown]`
**Status.** 🟢 — composite reads.

### `streak-tracker`
**Pitch.** Tracks daily streaks for posting / voting / trading and celebrates milestones in feed/TG. Light gamification proven to lift retention 30–40%.
**Inputs.** `{ streaks_to_track: ("posting"|"voting"|"trading")[] }`
**Outputs.** `{ current_streaks: object, public_post_id? }`
**Pricing.** Free.
**Categories.** `productivity`, `gamification`
**Tags.** `[streak, retention, gamification]`
**Status.** 🟢 — feed/governance/positions reads.

---

## 9. Bridge + swap (10 skills)

### `bridge-cheapest-route`
**Pitch.** Compares 1-click bridge vs. swap-then-bridge vs. bridge-then-swap routes for the same A→B and surfaces the cheapest, including dest-chain claim gas. Different from `trading-route-optimizer` by including chain hops.
**Inputs.** `{ from: { asset, chain }, to: { asset, chain }, amount: number }`
**Outputs.** `{ best_route, all_routes: [{ route, total_cost_bps }] }`
**Pricing.** 0.1 NEAR per call.
**Categories.** `bridge`, `optimization`
**Tags.** `[bridge, route, cheapest]`
**Status.** 🟢 — `/api/bridge/quote` + `/api/trading/ohlcv`.

### `bridge-slippage-estimator`
**Pitch.** Estimates worst-case slippage on a chosen bridge route for a given size, including stablecoin de-peg risk on small rails.
**Inputs.** `{ origin_asset: string, dest_asset: string, amount: number }`
**Outputs.** `{ p50_slippage_bps, p95_slippage_bps, peg_risk_flag }`
**Pricing.** 0.1 NEAR per call.
**Categories.** `bridge`, `analytics`
**Tags.** `[slippage, peg, bridge]`
**Status.** 🟢 — `/api/bridge/quote` + `/api/trading/ohlcv` (peg history).

### `bridge-gas-projector`
**Pitch.** Projects total gas across the full bridge: source send + bridge fee + dest claim + dest swap if applicable. Gives you a single USD number you can decide on.
**Inputs.** `{ route: object }`
**Outputs.** `{ source_gas_usd, bridge_fee_usd, dest_gas_usd, total_usd }`
**Pricing.** 0.05 NEAR per call.
**Categories.** `bridge`, `gas`, `analytics`
**Tags.** `[gas, projection, bridge]`
**Status.** 🟢 — `/api/bridge/quote` + RPC gas reads.

### `bridge-status-watcher`
**Pitch.** Watches a bridge deposit address until COMPLETE/REFUNDED and pings you. Stops the obsessive every-30-seconds refresh after a bridge.
**Inputs.** `{ deposit_address: string, channel: "dm"|"tg" }`
**Outputs.** `{ final_status, ping_sent }`
**Pricing.** Free.
**Categories.** `bridge`, `alerts`
**Tags.** `[status, watcher, bridge]`
**Status.** 🟢 — `/api/bridge/status` polled.

### `bridge-failure-resolver`
**Pitch.** When a bridge stalls (>30 min in PROCESSING), diagnoses likely cause from logs + suggests next step (refund poll, contact support, retry). Specifically for the 1-click long-tail.
**Inputs.** `{ deposit_address: string }`
**Outputs.** `{ likely_cause, recommended_action, escalation_path }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `bridge`, `support`
**Tags.** `[failure, debug, bridge]`
**Status.** 🟢 — `/api/bridge/status` + LLM reasoning.

### `bridge-multi-hop-planner`
**Pitch.** When direct A→B isn't supported, plans a multi-hop A→C→B with split-execution to minimize peg-risk window. Useful for thin pairs.
**Inputs.** `{ from, to, amount, max_hops?: number }`
**Outputs.** `{ plan: [{ from, to, amount }], total_cost_bps }`
**Pricing.** 0.5 NEAR per plan.
**Categories.** `bridge`, `optimization`
**Tags.** `[multi-hop, planner, route]`
**Status.** 🟢 — `/api/bridge/tokens` + `/api/bridge/quote`.

### `bridge-fee-leaderboard`
**Pitch.** Monthly digest of your bridge fees, broken down by route, with a "you would have saved $X if you'd used route Y" callout.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ total_fees_usd, by_route, savings_callout }`
**Pricing.** Free.
**Categories.** `bridge`, `analytics`
**Tags.** `[fees, digest, savings]`
**Status.** 🟢 — `/api/trading/fees` (bridge entries).

### `bridge-asset-finder`
**Pitch.** Given a source asset, lists every reachable destination asset with sample quotes. Stops "can I bridge X to Y" Discord questions.
**Inputs.** `{ source_asset: string, source_chain: string }`
**Outputs.** `{ destinations: [{ asset, chain, sample_quote_bps }] }`
**Pricing.** Free.
**Categories.** `bridge`, `discovery`
**Tags.** `[asset, finder, bridge]`
**Status.** 🟢 — `/api/bridge/tokens` + sample `/quote` calls.

### `bridge-tax-categorizer`
**Pitch.** Tags every bridge event in your history (transfer / swap / cost-basis-event) with explanations, ready to drop into a tax tool. Bridges are the #1 thing tax tools mis-categorize.
**Inputs.** `{ year: number }`
**Outputs.** `{ download_url, events_categorized }`
**Pricing.** 2 NEAR per export.
**Categories.** `bridge`, `tax`
**Tags.** `[tax, categorize, export]`
**Status.** 🟢 — `/api/trading/fees` + `/api/bridge/status` history.

### `bridge-deposit-address-validator`
**Pitch.** Before sending funds, sanity-checks the deposit address against the quote (amount, asset, expiry, signer). Catches the "wait, that's not the right chain" mistake.
**Inputs.** `{ quote_id: string, deposit_address: string }`
**Outputs.** `{ valid: bool, mismatches: string[] }`
**Pricing.** Free (security funnel).
**Categories.** `bridge`, `security`
**Tags.** `[validate, sanity-check, bridge]`
**Status.** 🟢 — `/api/bridge/submit` + `/api/bridge/status`.

---

## 10. Security & risk (14 skills)

### `risk-token-scorer`
**Pitch.** Pre-trade risk score for a token: liquidity depth, top-10 holder concentration, contract verification, age, scam-list match. One letter + 3 facts.
**Inputs.** `{ token_address: string, chain: string }`
**Outputs.** `{ grade: "A"-"F", facts: string[3] }`
**Pricing.** 0.2 NEAR per call.
**Categories.** `security`, `risk`
**Tags.** `[token, risk, score]`
**Status.** 🟢 — `/api/security/check-wallet` + RPC reads + `/api/research/`.

### `risk-phishing-detector`
**Pitch.** Checks a URL or post against the scam list and a learned phishing-pattern model; returns a verdict and a draft warning to send to the recipient.
**Inputs.** `{ url_or_text: string }`
**Outputs.** `{ verdict: "safe"|"suspicious"|"scam", confidence, warning_draft }`
**Pricing.** 0.05 NEAR per check.
**Categories.** `security`, `phishing`
**Tags.** `[phishing, scam, link]`
**Status.** 🟢 — `/api/security/check-link`.

### `risk-allowance-auditor`
**Pitch.** Lists wallet allowances ranked by risk (unlimited > large > stale > small) with "kill" links. Different from `onboard-allowance-pruner` by being an ongoing monthly check, not one-shot.
**Inputs.** `{ wallet?: string, cadence: "monthly"|"on-demand" }`
**Outputs.** `{ allowances: [{ token, contract, value, risk }], recommended_revokes: string[] }`
**Pricing.** 2 NEAR/month.
**Categories.** `security`, `allowances`
**Tags.** `[allowance, audit, monthly]`
**Status.** 🟢 — RPC reads + `/api/security/check-wallet`.

### `risk-drain-checker`
**Pitch.** Checks the user's wallet for drain-pattern indicators (recent allowance set + new token added + outgoing native transfer to fresh address) and pings urgent if found.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ drain_risk: 0-100, indicators: string[] }`
**Pricing.** 1 NEAR per check (or bundled into security audit).
**Categories.** `security`, `drain`
**Tags.** `[drain, indicator, urgent]`
**Status.** 🟢 — RPC + `/api/security/check-wallet`.

### `risk-poster-trust`
**Pitch.** Trust score for a poster across IronFeed history: account age, mute-rate, scam-flag history, vote alignment, NewsCoin call hit rate. Different from `feed-poster-credibility` — emphasizes safety, not signal.
**Inputs.** `{ wallet_or_handle: string }`
**Outputs.** `{ trust_score, red_flags: string[] }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `security`, `social`
**Tags.** `[trust, poster, redflag]`
**Status.** 🟢 — `/api/feed/foryou` history + mute counts + `/api/security/check-wallet`.

### `risk-room-alpha-reliability`
**Pitch.** For a given room, scores how reliable past alpha calls have been (24h hit rate, downside-of-misses). Helps you decide if a join-stake is worth it.
**Inputs.** `{ room_id?: string, host_wallet?: string }`
**Outputs.** `{ hit_rate, mean_24h_pnl_bps, sample_size }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `security`, `rooms`
**Tags.** `[reliability, room, alpha]`
**Status.** 🟢 — `/api/rooms/:id/messages` (alpha calls) + ohlcv backfill.

### `risk-kit-vet`
**Pitch.** Before installing a third-party kit, audits manifest hash, included skills' verified flag, revenue-split sanity, and any required webhook destinations.
**Inputs.** `{ kit_slug: string }`
**Outputs.** `{ verdict, findings: [{ severity, item }] }`
**Pricing.** 0.5 NEAR per audit.
**Categories.** `security`, `kits`
**Tags.** `[kit, audit, vet]`
**Status.** 🟢 — `/api/kits/:slug` + skills registry checks.

### `risk-skill-vet`
**Pitch.** Before installing a third-party HTTP skill, checks verified flag, callback domain reputation, install count vs. age, author wallet history.
**Inputs.** `{ skill_id: string }`
**Outputs.** `{ verdict, findings: [{ severity, item }] }`
**Pricing.** 0.3 NEAR per audit.
**Categories.** `security`, `skills`
**Tags.** `[skill, audit, vet]`
**Status.** 🟢 — `/api/skills/registry` + `/api/security/check-link`.

### `risk-counterparty-checker`
**Pitch.** Before swapping with / DMing / sending NEAR to an address, returns a reputation card: account age, scam flags, related wallets, public posts.
**Inputs.** `{ address: string }`
**Outputs.** `{ card: { age_days, scam_flag, posts: string[], related: string[] } }`
**Pricing.** 0.2 NEAR per check.
**Categories.** `security`, `counterparty`
**Tags.** `[counterparty, reputation]`
**Status.** 🟢 — `/api/security/check-wallet` + RPC + `/api/feed/voices`.

### `risk-leakage-scanner`
**Pitch.** Scans your last 30 days of public posts for accidentally-leaked sensitive info: full wallet addresses tied to amounts, screenshots with text reveals, API keys.
**Inputs.** `{ window_days?: number }`
**Outputs.** `{ leaks: [{ post_id, kind, severity }] }`
**Pricing.** 1 NEAR per scan.
**Categories.** `security`, `social`
**Tags.** `[leak, scan, opsec]`
**Status.** 🟢 — `/api/posts/:id` + media metadata + regex/LLM.

### `risk-mission-payout-auditor`
**Pitch.** Before claiming a mission, verifies escrow is funded, payout terms unchanged, claimant can actually meet acceptance criteria. Stops "I did the work, where's the money."
**Inputs.** `{ mission_id: string }`
**Outputs.** `{ verdict, evidence: { escrow_yocto, terms_hash, can_claim: bool } }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `security`, `missions`
**Tags.** `[mission, escrow, audit]`
**Status.** 🟢 — `/api/missions/:id` + audit endpoints + on-chain mirror.

### `risk-honeypot-detector`
**Pitch.** Pre-trade simulation: tries a buy + immediate sell on a fork, flags tokens that allow buy but block sell. Different from token-scorer — actively probes.
**Inputs.** `{ token_address: string, chain: string }`
**Outputs.** `{ honeypot_likelihood, buy_sim_ok, sell_sim_ok, hidden_tax_pct }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `security`, `honeypot`
**Tags.** `[honeypot, simulate, pre-trade]`
**Status.** 🟡 — needs a fork-simulation worker (anvil-style) for relevant chains. Read-only checks work today.

### `risk-rugpull-classifier`
**Pitch.** Classifies a NewsCoin's rugpull risk: creator wallet history, supply structure, early-buyer concentration, segment behavior. Specific to the NewsCoin curve, not a generic ERC-20 model.
**Inputs.** `{ coin_id: string }`
**Outputs.** `{ rug_score: 0-100, signals: string[] }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `security`, `newscoin`
**Tags.** `[rug, classify, newscoin]`
**Status.** 🟢 — `/api/newscoin/:coinId/trades` + curve + creator history.

### `risk-multisig-helper`
**Pitch.** Walks a heavy user through promoting their wallet to a multisig (2-of-3 with a hardware key + recovery key + warm key). Coordinates the keypair generation, invite flow, deploy.
**Inputs.** `{ desired_threshold: "2-of-3"|"3-of-5" }`
**Outputs.** `{ steps_completed, multisig_address }`
**Pricing.** 5 NEAR per setup.
**Categories.** `security`, `multisig`
**Tags.** `[multisig, setup, hardware]`
**Status.** 🔴 — needs first-class multisig contract template + UI in AZUKA. Currently no multisig primitive on the platform.

---

## 11. Telegram bot (14 skills)

### `tg-auto-reply`
**Pitch.** Auto-replies to certain TG DMs while you're heads-down (custom rules per sender), drafts urgent ones for your one-tap approval.
**Inputs.** `{ rules: [{ from, reply_template }], approval_mode: "auto"|"approve" }`
**Outputs.** `{ replies_sent, drafts_pending }`
**Pricing.** 4 NEAR/month.
**Categories.** `telegram`, `dm`, `automation`
**Tags.** `[autoreply, telegram]`
**Status.** 🟢 — `/api/tg/agent` + bot pathway.

### `tg-group-summary`
**Pitch.** Daily summary of a chosen Telegram group, posted to your TG DM. The "I'm in 14 groups but couldn't read three of them today" surface.
**Inputs.** `{ group_id: string, cadence: "daily"|"hourly" }`
**Outputs.** `{ summary_message_id }`
**Pricing.** 4 NEAR/month per group.
**Categories.** `telegram`, `digest`
**Tags.** `[group, summary, telegram]`
**Status.** 🟡 — bot needs explicit ingestion rights for the group; existing tg.route.js supports replies, not group-message logging.

### `tg-pump-alert`
**Pitch.** Watchlist-aware pump alerts pushed to TG; one-tap "buy 0.5 NEAR" inline keyboard. Already-wired tg watchlist endpoints; missing piece is the inline-action button.
**Inputs.** `{ pct_threshold: number, max_alerts_per_day?: number }`
**Outputs.** `{ alerts_sent, buys_executed }`
**Pricing.** 5 NEAR/month.
**Categories.** `telegram`, `alerts`, `trading`
**Tags.** `[pump, alert, oneclick]`
**Status.** 🟢 — `/api/tg/price-alerts/add` + `/api/tg/agent/confirm` (swap action).

### `tg-governance-push`
**Pitch.** Push notifications when proposals you care about move (status change, quorum reached, vote about to close), with one-tap vote inline keyboard.
**Inputs.** `{ proposal_ids: string[] }`
**Outputs.** `{ pushes_sent, votes_cast }`
**Pricing.** 3 NEAR/month.
**Categories.** `telegram`, `governance`
**Tags.** `[gov, push, telegram]`
**Status.** 🟢 — `/api/governance/proposals/:id` polled + tg send.

### `tg-balance-stream`
**Pitch.** `/balance` returns a rich card with native + token balances, 24h PnL, top 3 movers. More info per glance than the default.
**Inputs.** `{ chains?: string[] }`
**Outputs.** `{ card_text }`
**Pricing.** Free.
**Categories.** `telegram`, `dashboard`
**Tags.** `[balance, card, telegram]`
**Status.** 🟢 — `/api/tg/custodial/:tgId/balance` + portfolio.

### `tg-quick-trade`
**Pitch.** `/quick <amount> <ticker>` initiates a swap with confirm-once flow. Stops the 8-message "swap, confirm, where, how much" tennis match.
**Inputs.** `{ slippage_default_bps?: number }`
**Outputs.** `{ swap_status, tx_hash }`
**Pricing.** 5 NEAR setup, 0.2 NEAR per swap.
**Categories.** `telegram`, `trading`
**Tags.** `[swap, quick, oneline]`
**Status.** 🟢 — `/api/tg/custodial/:tgId/swap` + `/agent/confirm`.

### `tg-mention-watcher`
**Pitch.** Alert when your @ is mentioned in a watched TG group (without joining DM bridge). One-line ping with link to the message.
**Inputs.** `{ groups: string[] }`
**Outputs.** `{ mentions: [{ group, message_link, snippet }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `telegram`, `alerts`
**Tags.** `[mention, watcher, telegram]`
**Status.** 🟡 — needs bot-as-member of group + ingestion. Same dependency as `tg-group-summary`.

### `tg-vault-helper`
**Pitch.** PIN-gated cold-storage helper. `/freeze` pauses all skill-driven trades; `/withdraw <amount>` requires a separate PIN before signing. Stops fat-finger sends from /quick-trade.
**Inputs.** `{ pin_set: bool, freeze_state: bool }`
**Outputs.** `{ pin_attempts, freeze_actions }`
**Pricing.** Free (security).
**Categories.** `telegram`, `security`
**Tags.** `[vault, pin, freeze]`
**Status.** 🟡 — needs a `tg_pin_hash` column on tg_users + a pin-validate path (cheap to add).

### `tg-nightmode`
**Pitch.** Silences non-urgent TG notifications between configured hours (only urgent-tagged messages and DMs from a whitelist break through). Sleep matters.
**Inputs.** `{ start: HH:MM, end: HH:MM, urgent_whitelist?: string[] }`
**Outputs.** `{ silenced_count }`
**Pricing.** Free.
**Categories.** `telegram`, `wellbeing`
**Tags.** `[nightmode, silence]`
**Status.** 🟢 — extends `/api/tg/settings` with quiet-hours.

### `tg-multi-wallet-switcher`
**Pitch.** `/wallet <name>` switches the active wallet for trading commands. Existing `/api/tg/settings` supports this, this skill makes it discoverable + adds confirmation.
**Inputs.** `{ wallets: { name, address }[] }`
**Outputs.** `{ active_wallet }`
**Pricing.** Free.
**Categories.** `telegram`, `wallet`
**Tags.** `[wallet, switch, telegram]`
**Status.** 🟢 — `/api/tg/settings` activeWallet field.

### `tg-portfolio-card`
**Pitch.** `/portfolio` returns a detailed card: NewsCoin holdings, on-chain positions, gov stake, Vanguard NFT, mission earnings, and a 1-line summary.
**Inputs.** `{ }`
**Outputs.** `{ card_text }`
**Pricing.** 2 NEAR/month.
**Categories.** `telegram`, `dashboard`
**Tags.** `[portfolio, card, telegram]`
**Status.** 🟢 — `/api/portfolio/` + `/api/newscoin/by-creator` + `/api/missions`.

### `tg-onboarding-coach`
**Pitch.** Inside TG, walks a new user through linking, first buy, first vote, first follow. Different from `onboard-tg-link-helper` — this is full AZUKA onboarding via TG, not just the link step.
**Inputs.** `{ }`
**Outputs.** `{ steps_completed, time_to_first_action }`
**Pricing.** Free.
**Categories.** `telegram`, `onboarding`
**Tags.** `[onboard, coach, telegram]`
**Status.** 🟢 — chains tg + buy + vote + follow endpoints.

### `tg-emergency-freeze`
**Pitch.** `/freeze` immediately pauses all your active skill automations and revokes a sliding window of allowances. Designed for "I clicked something, am I cooked" moments.
**Inputs.** `{ revoke_window_hours?: number }`
**Outputs.** `{ automations_paused, allowances_revoked }`
**Pricing.** Free.
**Categories.** `telegram`, `security`, `emergency`
**Tags.** `[freeze, emergency]`
**Status.** 🟢 — `/api/agents/automations` PATCH + revokes.

### `tg-broadcast`
**Pitch.** Creator broadcast: send a message to all groups you admin (with rate-limit + rule-of-three confirmation). Avoids "I have to copy-paste this 11 times."
**Inputs.** `{ message: string, target_groups?: string[] }`
**Outputs.** `{ delivered_to, rate_limit_blocks }`
**Pricing.** 1 NEAR per broadcast.
**Categories.** `telegram`, `creator`
**Tags.** `[broadcast, creator, groups]`
**Status.** 🟡 — bot needs admin-broadcast pathway (current bot supports DM, not multi-group send-as-admin).

---

## 12. Creator economy (12 skills)

### `creator-revenue-analytics`
**Pitch.** Break down skill sales, NewsCoin creator fees, room revenue, kit royalties; per-skill, per-buyer, daily/weekly chart. Stops the "I made $X this month from somewhere" mystery.
**Inputs.** `{ wallet?: string, period: "weekly"|"monthly"|"yearly" }`
**Outputs.** `{ total_usd, by_source, top_skills, top_buyers }`
**Pricing.** 2 NEAR/month.
**Categories.** `creator`, `analytics`
**Tags.** `[revenue, analytics, creator]`
**Status.** 🟢 — `/api/skills/revenue` + `/api/newscoin/by-creator` + missions.

### `creator-fan-engagement`
**Pitch.** Ranks your top fans across DMs, replies, room participation, skill installs. Shows the 20 names you should DM personally this week.
**Inputs.** `{ }`
**Outputs.** `{ top_fans: [{ wallet, score, surfaces }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `creator`, `social`
**Tags.** `[fans, engagement, ranking]`
**Status.** 🟢 — composite of feed/dm/rooms/skills tables.

### `creator-content-scheduler`
**Pitch.** Plans a 7-day content schedule (mix of posts/threads/quote-takes/poll), drafts each, queues at best times from `feed-best-posting-time`.
**Inputs.** `{ themes: string[], posts_per_day?: number }`
**Outputs.** `{ schedule: [{ at, draft, type }] }`
**Pricing.** 8 NEAR/month.
**Categories.** `creator`, `content`, `scheduler`
**Tags.** `[scheduler, content, weekly]`
**Status.** 🟢 — automation cron + drafters + `/api/posts`.

### `creator-royalty-splitter`
**Pitch.** Split incoming royalties (from skill sales or NewsCoin fees) to up to 5 wallets at fixed bps. Useful for collabs.
**Inputs.** `{ splits: [{ wallet, bps }] }`
**Outputs.** `{ paid_out: [{ wallet, amount }] }`
**Pricing.** 3 NEAR setup, 0.1 NEAR per payout.
**Categories.** `creator`, `payments`
**Tags.** `[royalty, split, collab]`
**Status.** 🟡 — needs a `creator_splits` table; payout pathway works via FT transfer.

### `creator-superfan-rewarder`
**Pitch.** Auto-airdrops a small NEAR or token reward to your top N fans on a cadence. Cements loyalty cheaply.
**Inputs.** `{ top_n: number, total_drop_near: number, cadence: "monthly" }`
**Outputs.** `{ recipients, total_paid }`
**Pricing.** 4 NEAR setup + drop budget.
**Categories.** `creator`, `growth`
**Tags.** `[airdrop, fans, loyalty]`
**Status.** 🟢 — uses `creator-fan-engagement` + ft_transfer.

### `creator-skill-pricing-coach`
**Pitch.** Looks at install rate, churn, refund signal, and competitor prices in your category; recommends a price change with confidence interval.
**Inputs.** `{ skill_id: string }`
**Outputs.** `{ current_price, recommended_price, reason }`
**Pricing.** 1 NEAR per analysis.
**Categories.** `creator`, `pricing`
**Tags.** `[price, coach, optimize]`
**Status.** 🟢 — `/api/skills/registry` + `/api/skills/revenue`.

### `creator-skill-marketing-poster`
**Pitch.** When you launch a new skill, generates 3 launch posts (hook + carousel + thread) tuned to your follower base, posts on schedule.
**Inputs.** `{ skill_id: string }`
**Outputs.** `{ launch_post_id, follow_up_ids }`
**Pricing.** 2 NEAR per launch.
**Categories.** `creator`, `content`, `marketing`
**Tags.** `[launch, marketing, skill]`
**Status.** 🟢 — `/api/skills/registry` + `/api/posts`.

### `creator-launch-checklist`
**Pitch.** Before launching a paid skill: pricing reviewed, manifest fields complete, hero image present, demo video link, support DM link, refund policy. Catches the small misses.
**Inputs.** `{ skill_id: string }`
**Outputs.** `{ pass: bool, missing: string[] }`
**Pricing.** Free (creator funnel).
**Categories.** `creator`, `quality`
**Tags.** `[launch, checklist, quality]`
**Status.** 🟢 — `/api/skills/registry` schema check.

### `creator-competitor-benchmark`
**Pitch.** Side-by-side benchmark of your skill vs the top 5 in its category: install count, retention, price, review sentiment. Different from `creator-skill-pricing-coach` — qualitative comparison, not pricing-only.
**Inputs.** `{ skill_id: string }`
**Outputs.** `{ benchmarks: [{ peer_skill_id, install_count, price, sentiment }] }`
**Pricing.** 1 NEAR per analysis.
**Categories.** `creator`, `analytics`
**Tags.** `[benchmark, competitor]`
**Status.** 🟢 — `/api/skills/registry` + reviews (when launched).

### `creator-content-recyler`
**Pitch.** Finds your top 10 historical posts (by impressions/engagement) and proposes 3 fresh-format remixes each (thread, video script, room topic).
**Inputs.** `{ window_days?: number }`
**Outputs.** `{ recycle_candidates: [{ original_post_id, remix_drafts }] }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `creator`, `content`
**Tags.** `[recycle, remix, content]`
**Status.** 🟢 — `/api/feed/foryou` + `/api/feed/impression`.

### `creator-tip-jar-opener`
**Pitch.** Sets up a NEAR tip jar tied to your profile and posts; auto-acknowledges with a thanks DM and shoutout in your weekly recap. Different from `creator-fan-dm-broadcast` — passive incoming, not outgoing.
**Inputs.** `{ thanks_template: string, public_acknowledge?: bool }`
**Outputs.** `{ tipjar_url, total_received_near }`
**Pricing.** Free (drives platform engagement).
**Categories.** `creator`, `payments`
**Tags.** `[tipjar, creator]`
**Status.** 🟡 — needs a tipjar contract pattern (FT transfer + memo works, but no first-class profile field).

### `creator-fan-dm-broadcast`
**Pitch.** DM your subscribers (opt-in list) with a release note when you ship a new skill, post, or coin. Rate-limited; refusing inbound DMs after broadcast (no spam).
**Inputs.** `{ message: string, kind: "release"|"news" }`
**Outputs.** `{ delivered_to, opt_outs }`
**Pricing.** 2 NEAR per broadcast.
**Categories.** `creator`, `dm`, `marketing`
**Tags.** `[broadcast, fans, release]`
**Status.** 🟡 — needs a `creator_subscribers` table with opt-in. DM send pathway works.

---

## 13. Discovery (10 skills)

### `discovery-feed-search`
**Pitch.** Semantic search across IronFeed posts (your follows + niche tags). Different from native trending — finds the post you remember reading 3 weeks ago.
**Inputs.** `{ query: string, scope?: "follows"|"all" }`
**Outputs.** `{ results: [{ post_id, snippet, why_match }] }`
**Pricing.** 0.1 NEAR per search.
**Categories.** `discovery`, `search`
**Tags.** `[search, semantic, feed]`
**Status.** 🟡 — needs a feed-post embeddings index (cheap to add; not present today).

### `discovery-trending-alert`
**Pitch.** Alert when a tag enters or exits the trending top-N (configurable). Catches the moment a niche becomes mainstream.
**Inputs.** `{ tags: string[], top_n?: number }`
**Outputs.** `{ events: [{ tag, kind: "entered"|"exited", at }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `discovery`, `alerts`
**Tags.** `[trending, alert, tags]`
**Status.** 🟢 — `/api/feed/trending` polled.

### `discovery-account-suggestions`
**Pitch.** Suggested follows updated weekly based on accounts your engaged-with people engage with (graph-2 distance) but you don't yet follow. Beats "rec by tag" by 3x.
**Inputs.** `{ }`
**Outputs.** `{ suggestions: [{ wallet, why }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `discovery`, `social`
**Tags.** `[follow, suggest, graph]`
**Status.** 🟢 — `/api/feed/foryou` + `/api/feed/voices` + engagement table.

### `discovery-niche-radar`
**Pitch.** Surfaces emerging niches (clusters of <100-follower accounts gaining 50%/wk engagement on a shared tag). For people who want to be 6 months early.
**Inputs.** `{ }`
**Outputs.** `{ niches: [{ cluster_label, sample_handles, growth_rate }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `discovery`, `analytics`
**Tags.** `[niche, radar, early]`
**Status.** 🟡 — same embedding index as `discovery-feed-search`.

### `discovery-mission-finder`
**Pitch.** Matches you with open missions whose required skills + history match yours. Different from generic mission listings — ranks by your fit, not recency.
**Inputs.** `{ }`
**Outputs.** `{ matches: [{ mission_id, fit_score, why }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `discovery`, `missions`
**Tags.** `[mission, finder, fit]`
**Status.** 🟢 — `/api/missions` + your skill installs + history.

### `discovery-room-finder`
**Pitch.** Right now, what live room aligns with your interests? Real-time, not "what's scheduled tomorrow." Useful only because rooms are emergent.
**Inputs.** `{ }`
**Outputs.** `{ live_now: [{ room_id, fit_score, topic }] }`
**Pricing.** 1 NEAR/month.
**Categories.** `discovery`, `rooms`
**Tags.** `[rooms, live, finder]`
**Status.** 🟢 — `/api/rooms` + your interests profile.

### `discovery-skill-finder`
**Pitch.** Recommends skills you'd benefit from based on your wallet activity, gaps detected in onboarding audit, peer install patterns. Smart upsell, but earns trust by being genuinely useful.
**Inputs.** `{ }`
**Outputs.** `{ recommendations: [{ skill_id, why }] }`
**Pricing.** Free.
**Categories.** `discovery`, `skills`
**Tags.** `[skill, recommend]`
**Status.** 🟢 — `/api/skills/registry` + composite reads.

### `discovery-kit-finder`
**Pitch.** Recommends a kit (or kit upgrade) based on which skills you've installed, gaps, and installed-by-similar-users patterns.
**Inputs.** `{ }`
**Outputs.** `{ recommendations: [{ kit_slug, why }] }`
**Pricing.** Free.
**Categories.** `discovery`, `kits`
**Tags.** `[kit, recommend]`
**Status.** 🟢 — `/api/kits` + skill install history.

### `discovery-creator-finder`
**Pitch.** Find emerging creators in your niche to back early — defined as: <500 followers, top-quartile engagement-per-follower, posting >3x/week, scam-flag-free.
**Inputs.** `{ niche_tags: string[] }`
**Outputs.** `{ rising_creators: [{ handle, score, why }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `discovery`, `creators`
**Tags.** `[creator, rising, niche]`
**Status.** 🟢 — `/api/feed/voices` + engagement deltas.

### `discovery-related-coin-finder`
**Pitch.** Given a NewsCoin you hold, finds 5 related (correlated narrative or holder overlap) NewsCoins you should consider — for diversification or theme amplification.
**Inputs.** `{ coin_id: string, intent: "diversify"|"amplify" }`
**Outputs.** `{ related: [{ coin_id, similarity, why }] }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `discovery`, `newscoin`
**Tags.** `[related, coins, diversify]`
**Status.** 🟢 — `/api/newscoin/list` + holders + headline LLM.

---

## 14. Negotiator/deal-making (8 skills)

### `negotiator-price-ladder`
**Pitch.** Inside a DM negotiation, proposes tiered counteroffers (e.g., 10/20/30 NEAR with different terms each) to nudge convergence. Stops the back-and-forth-on-price stall.
**Inputs.** `{ conversation_id: string, anchor_price_near: number, ladder_steps?: number }`
**Outputs.** `{ proposed_offers: [{ price, terms }], sent_at }`
**Pricing.** 1 NEAR per ladder.
**Categories.** `negotiator`, `dm`
**Tags.** `[ladder, counteroffer, dm]`
**Status.** 🟢 — `/api/dm/send` + LLM.

### `negotiator-multi-counterparty-coordinator`
**Pitch.** When you're negotiating the same thing with 3 buyers, this skill keeps state per thread and surfaces the highest-bid + most-willing combination. The "best deal" picker.
**Inputs.** `{ conversation_ids: string[] }`
**Outputs.** `{ best_deal: { conversation_id, terms }, leaderboard }`
**Pricing.** 3 NEAR per coordination.
**Categories.** `negotiator`, `dm`
**Tags.** `[multi, coordinator, deal]`
**Status.** 🟢 — `/api/dm/conversations` + per-thread analysis.

### `negotiator-escrow-drafter`
**Pitch.** Drafts mission/escrow terms (acceptance criteria, payout schedule, dispute path) from a 1-paragraph deal description, ready to post as a mission.
**Inputs.** `{ deal_description: string, escrow_amount_near: number }`
**Outputs.** `{ mission_draft: { acceptance_criteria, payout_schedule, dispute_path } }`
**Pricing.** 1 NEAR per draft.
**Categories.** `negotiator`, `missions`
**Tags.** `[escrow, drafter, mission]`
**Status.** 🟢 — `/api/missions/:id/record-create` once approved.

### `negotiator-deal-comparator`
**Pitch.** Side-by-side comparison of 2–3 offers across price, payout schedule, terms strictness, counterparty trust. Beats screenshotting offers next to each other in Notes.
**Inputs.** `{ offers: object[] }`
**Outputs.** `{ comparison_table, recommendation }`
**Pricing.** 0.5 NEAR per compare.
**Categories.** `negotiator`
**Tags.** `[compare, deal]`
**Status.** 🟢 — pure LLM hop on structured input.

### `negotiator-otc-introducer`
**Pitch.** Given an OTC need (e.g., "I want to sell 5,000 USDC in NEAR off-market"), finds counterparties from public history of similar deals + scoring. Coordinates intro DMs.
**Inputs.** `{ side: "buy"|"sell", asset: string, size_usd: number }`
**Outputs.** `{ introductions: [{ counterparty, intro_dm_id }] }`
**Pricing.** 5 NEAR per introduction.
**Categories.** `negotiator`, `otc`
**Tags.** `[otc, intro, broker]`
**Status.** 🟡 — needs an OTC opt-in registry (similar to `creator_subscribers`). DM intro pathway works.

### `negotiator-dispute-resolver`
**Pitch.** When a deal stalls or breaks, proposes 3 paths (compromise, escalate to mission arbiter, walk away) with rationale and predicted outcomes from similar past deals.
**Inputs.** `{ conversation_id: string }`
**Outputs.** `{ paths: [{ option, rationale, predicted_outcome }] }`
**Pricing.** 2 NEAR per call.
**Categories.** `negotiator`, `disputes`
**Tags.** `[dispute, resolve]`
**Status.** 🟢 — DM read + missions/escalations table + LLM.

### `negotiator-payment-splitter`
**Pitch.** Proposes a multi-currency payment plan (e.g., "60% USDC now / 40% NEAR vested over 90d") for a deal of size N. Useful for cross-chain settlements.
**Inputs.** `{ total_value_usd: number, vesting_terms?: string }`
**Outputs.** `{ plan: [{ currency, amount, when }] }`
**Pricing.** 0.5 NEAR per plan.
**Categories.** `negotiator`, `payments`
**Tags.** `[split, payment, vesting]`
**Status.** 🟢 — pure LLM with `/api/bridge/quote` for multi-currency conversion.

### `negotiator-final-offer-detector`
**Pitch.** Reads the counterparty's last 3 messages and grades how flexible they actually are (semantic flags: "I can probably", "this is final", silence patterns). Stops you wasting the day pushing on a sealed door.
**Inputs.** `{ conversation_id: string }`
**Outputs.** `{ flexibility_score: 0-100, signals: string[], recommended_move }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `negotiator`, `analytics`
**Tags.** `[final, flex, signals]`
**Status.** 🟡 — needs server-side decrypt for E2E threads. Group plaintext works.

---

## 15. Content generation (7 skills)

### `content-post-drafter`
**Pitch.** Drafts a post in your prior posting voice given a topic + tone. Voice profile is recomputed weekly from your last 50 posts.
**Inputs.** `{ topic: string, tone?: "neutral"|"snarky"|"hot-take"|"earnest" }`
**Outputs.** `{ draft: string, hook: string, suggested_tags: string[] }`
**Pricing.** 0.2 NEAR per draft.
**Categories.** `content`, `social`
**Tags.** `[draft, post, voice]`
**Status.** 🟢 — your post history + LLM.

### `content-image-prompt-generator`
**Pitch.** Generates 3 image prompts for a given post — for use in Midjourney/SDXL/etc. (no image generation in-platform yet). Prompts capture mood, composition, palette.
**Inputs.** `{ post_text: string, style?: "photo"|"illustration"|"meme" }`
**Outputs.** `{ prompts: string[3] }`
**Pricing.** 0.1 NEAR per call.
**Categories.** `content`, `image`
**Tags.** `[image, prompt, generator]`
**Status.** 🟢 — pure LLM.

### `content-newscoin-pitch-writer`
**Pitch.** Generates a launch pitch (name, ticker, hero quote, 3-bullet thesis) specifically for the NewsCoin curve. Different from `newscoin-pitch-writer` — full launch package, not just naming.
**Inputs.** `{ source_url?: string, raw_text?: string }`
**Outputs.** `{ name, ticker, hero_quote, thesis_bullets }`
**Pricing.** 0.5 NEAR per pitch.
**Categories.** `content`, `newscoin`
**Tags.** `[pitch, launch, newscoin]`
**Status.** 🟢 — wraps `/api/newscoin/suggest`.

### `content-thread-from-url`
**Pitch.** Drop a URL (article, paper, post); get a 5–10 post thread that respects character limits, with a hook post and a CTA. Different from `feed-thread-composer` — single URL input, not raw text.
**Inputs.** `{ url: string, length?: 5..10 }`
**Outputs.** `{ thread: string[] }`
**Pricing.** 0.3 NEAR per call.
**Categories.** `content`, `social`
**Tags.** `[thread, url]`
**Status.** 🟢 — fetch URL + LLM + `/api/posts`.

### `content-quote-extractor`
**Pitch.** Pulls 3–5 quotable lines from a long source (essay, transcript, podcast notes) for use in posts/cards. Tuned for "would someone screenshot this" punchiness.
**Inputs.** `{ source_text: string, max_quotes?: number }`
**Outputs.** `{ quotes: string[] }`
**Pricing.** 0.2 NEAR per call.
**Categories.** `content`
**Tags.** `[quote, extract]`
**Status.** 🟢 — pure LLM.

### `content-tagline-generator`
**Pitch.** Generates 5 punchy taglines for a project/skill/coin. Specifically tuned to crypto-native attention spans (under 8 words, contains a verb).
**Inputs.** `{ project_description: string, audience?: string }`
**Outputs.** `{ taglines: string[5] }`
**Pricing.** 0.2 NEAR per call.
**Categories.** `content`, `creator`
**Tags.** `[tagline, copy]`
**Status.** 🟢 — pure LLM.

### `content-bio-optimizer`
**Pitch.** Rewrites your IronFeed bio for clarity + niche signal, using your post history to anchor authenticity. A/B tests two variants over 7 days against follow rate.
**Inputs.** `{ current_bio: string, audience_target?: string }`
**Outputs.** `{ variants: [{ bio, projected_lift }] }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `content`, `creator`
**Tags.** `[bio, optimize, growth]`
**Status.** 🟢 — your post history + LLM + bio update endpoint.

---

## Appendix — items needing platform work

The 🔴 items below need substantial new platform capability before
they can be built. Group flagged for the team:

- `risk-multisig-helper` — needs a first-class multisig contract
  template + wallet UI integration.

The 🟡 items each name their missing piece in-line. Most are small
(table additions, decryption hooks, embedding indexes).

