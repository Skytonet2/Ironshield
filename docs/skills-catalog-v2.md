# AZUKA Skills Catalog (v2 — 200 more skills)

> Volume 2 of the AZUKA Skills SDK backlog. v1 covered the
> platform's unique primitives (NewsCoin, IronFeed, governance,
> rooms, DMs). v2 covers the broader automation surface area
> a skill can reach today via the agent runtime — DeFi yield,
> NFTs, multi-DAO ops, dev tools, sales workflows, document
> handling, and more. None of these duplicate v1.

**Status legend:**
- 🟢 = obviously buildable today against the live backend
- 🟡 = needs one missing piece (specify in the row)
- 🔴 = needs a substantial new platform capability (specify)

**Notes on scope.** v2 leans more on external APIs and less on
AZUKA-internal data. Anything calling a third-party API not
wired into `.env.example` (Notion, Slack, Etherscan, Snapshot,
Gitcoin Passport, etc.) is marked 🟡 with the missing piece named.
The skill author can BYO key inside the skill's HTTP runner, but
the platform is honest about which integrations are first-class.

---

## 1. DeFi yield & staking (15 skills)

### `validator-picker`
**Pitch.** Recommends a 3-validator NEAR delegation portfolio scored on commission, uptime, slashing history, and decentralization (avoid concentration in a single nodeprovider). Different from v1 governance — focused on yield, not voting.
**Inputs.** `{ stake_near: number, max_commission_pct?: number, prefer_decentralized?: bool }`
**Outputs.** `{ portfolio: [{ validator, weight, est_apy }], rationale: string }`
**Pricing.** 1 NEAR per recommendation.
**Categories.** `defi`, `staking`, `near`
**Tags.** `[validator, near, staking, apy]`
**Status.** 🟢 — uses NEAR validators RPC + public uptime data.

### `lending-rate-arbitrage`
**Pitch.** Sweeps stablecoin supply rates across NEAR-side + Aurora-side lending markets; surfaces the best risk-adjusted venue for a given size. Optionally fires the move via 1-click bridge.
**Inputs.** `{ asset: "USDC"|"USDT"|"DAI", size_usd: number, max_protocol_age_days?: number }`
**Outputs.** `{ best_venue, current_rate, alternatives: [{ venue, rate, tvl }] }`
**Pricing.** 0.3 NEAR per scan, or 4 NEAR/month for daily.
**Categories.** `defi`, `lending`, `arbitrage`
**Tags.** `[lending, rates, arb]`
**Status.** 🟡 — needs a lending-protocol rate aggregator integration (DefiLlama yields API).

### `autocompounder`
**Pitch.** Auto-claims and re-stakes LP rewards on a schedule, gas-aware (won't fire if claim cost > N% of rewards). Logs APY uplift vs. unclaimed baseline.
**Inputs.** `{ position_id: string, gas_threshold_pct: number }`
**Outputs.** `{ compounds: [{ at, claimed, restaked, gas }], realized_apy_uplift_pct }`
**Pricing.** 5 NEAR setup, 0.2 NEAR per compound.
**Categories.** `defi`, `automation`, `staking`
**Tags.** `[autocompound, lp, automation]`
**Status.** 🟢 — automation cron + claim/stake txs via wallet proxy.

### `liquid-staking-router`
**Pitch.** For a given size, finds the best liquid-staking entry route (direct mint vs. secondary buy) factoring discount-to-NAV and slippage. Stops "I bought stNEAR at a 1.5% premium and didn't notice."
**Inputs.** `{ stake_near: number, lst: "stNEAR"|"linear"|"meta-pool" }`
**Outputs.** `{ best_route, savings_bps_vs_naive }`
**Pricing.** 0.2 NEAR per call.
**Categories.** `defi`, `staking`, `routing`
**Tags.** `[lst, route, near]`
**Status.** 🟢 — Ref + LST mint contract reads.

### `staking-tax-tracker`
**Pitch.** Logs every staking-reward receipt with USD basis at receipt time across all your validators / LST positions / lending markets. The thing your accountant will actually thank you for.
**Inputs.** `{ wallet?: string, year: number }`
**Outputs.** `{ events: [{ at, source, amount, usd_basis }], total_usd }`
**Pricing.** 3 NEAR per export.
**Categories.** `defi`, `tax`, `staking`
**Tags.** `[tax, staking, basis]`
**Status.** 🟢 — RPC reward events + price feed.

### `staking-portfolio-rebalancer`
**Pitch.** Rebalances across LSTs (stNEAR / LiNEAR / meta-pool) and direct stakes to target weights. Different from v1's NewsCoin rebalancer — focuses on yield-bearing assets, not story tokens.
**Inputs.** `{ targets: [{ asset, weight_pct }], drift_threshold_pct: number }`
**Outputs.** `{ trades_executed: int, new_weights }`
**Pricing.** 5 NEAR setup, 0.5 NEAR per rebalance.
**Categories.** `defi`, `staking`, `rebalance`
**Tags.** `[lst, rebalance, weights]`
**Status.** 🟢 — Ref swaps + automation cron.

### `il-hedger`
**Pitch.** For an LP position, recommends an offsetting short (perp or borrow-and-sell) sized to neutralize first-order IL exposure. Optional auto-execute with size cap.
**Inputs.** `{ pool: string, your_share: number, max_hedge_usd?: number }`
**Outputs.** `{ recommended_short, hedge_size_usd, projected_il_reduction_bps }`
**Pricing.** 1 NEAR per recommendation, 5 NEAR setup for auto-execute.
**Categories.** `defi`, `risk`, `lp`
**Tags.** `[il, hedge, lp]`
**Status.** 🟡 — needs a perp-DEX integration (Aurora-side) for auto-execute. Recommendation-only works today.

### `farm-decay-predictor`
**Pitch.** Predicts when a yield farm's emissions decay below your hurdle rate (commit a number); auto-exits when triggered. Specific to ramp-down farms (most yield comes early; many users overstay).
**Inputs.** `{ farm_id: string, hurdle_apy_pct: number }`
**Outputs.** `{ predicted_exit_at, current_apy, projected_apy_at_exit }`
**Pricing.** 4 NEAR setup, 0.2 NEAR per fire.
**Categories.** `defi`, `prediction`, `automation`
**Tags.** `[farm, decay, exit]`
**Status.** 🟢 — emissions schedule + RPC reads.

### `delegate-rewards-claimer`
**Pitch.** Claims staking rewards across multiple validators on one cron. Threshold-gated to skip dust. Different from v1's NewsCoin creator-fee claimer — for native staking, not token economics.
**Inputs.** `{ min_claim_near: number, cadence: "weekly"|"on-threshold" }`
**Outputs.** `{ claims: [{ validator, amount, tx_hash }], total_claimed }`
**Pricing.** 3 NEAR setup, 0.1 NEAR per claim.
**Categories.** `defi`, `staking`, `automation`
**Tags.** `[claim, validators, automation]`
**Status.** 🟢 — validator contract `withdraw_all` + cron.

### `unbonding-period-tracker`
**Pitch.** Single-card view of every unbonding/cooldown timer across your chains and protocols (NEAR validator unstake, Aave cooldown, etc.). Pings you on the day funds become withdrawable so they don't sit idle.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ unbondings: [{ source, amount, available_at }], next_event_at }`
**Pricing.** 2 NEAR/month.
**Categories.** `defi`, `tracker`, `staking`
**Tags.** `[unbond, cooldown, timer]`
**Status.** 🟢 — RPC reads per protocol.

### `bridge-yield-finder`
**Pitch.** For a chosen asset, finds chains where the same asset earns higher yield, factoring 1-click bridge fees + lockup risk. Surfaces actual after-cost APY.
**Inputs.** `{ asset: string, size_usd: number, min_lockup_acceptable_days?: number }`
**Outputs.** `{ destinations: [{ chain, gross_apy, after_bridge_apy, breakeven_days }] }`
**Pricing.** 0.5 NEAR per scan.
**Categories.** `defi`, `bridge`, `yield`
**Tags.** `[yield, bridge, cross-chain]`
**Status.** 🟡 — needs DefiLlama yields API for off-NEAR yields.

### `vesting-cliff-tracker`
**Pitch.** Tracks vesting unlocks (yours + watched tokens) and projects supply-impact on price. Differs from generic unlock calendars by quantifying expected sell pressure from prior cohort behavior.
**Inputs.** `{ tokens: string[] }`
**Outputs.** `{ schedule: [{ token, at, amount, projected_pressure_bps }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `defi`, `tracker`, `analytics`
**Tags.** `[vesting, unlock, supply]`
**Status.** 🟡 — needs a token-unlocks data source (Token Unlocks API or self-curated table).

### `yield-curve-analyzer`
**Pitch.** Visualizes the cross-protocol yield curve for an asset (e.g. USDC: 4% on Aave, 7% on Burrow, 11% on a farm) and flags anomalies (curve inversions, fat-tail rates) that usually mean risk.
**Inputs.** `{ asset: string }`
**Outputs.** `{ curve: [{ venue, apy, tvl, age_days }], anomalies: string[] }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `defi`, `analytics`
**Tags.** `[yield-curve, anomaly]`
**Status.** 🟡 — DefiLlama yields API.

### `stablecoin-yield-allocator`
**Pitch.** Allocates a stablecoin bag across yield venues by risk-adjusted return (target volatility cap + concentration limits). Rebalances quarterly. The "park your stables" service.
**Inputs.** `{ size_usd: number, max_per_venue_pct: number, risk_cap: "conservative"|"balanced"|"hot" }`
**Outputs.** `{ allocation: [{ venue, weight_pct, projected_apy }] }`
**Pricing.** 8 NEAR setup, 1 NEAR per rebalance.
**Categories.** `defi`, `stables`, `automation`
**Tags.** `[stables, allocation, yield]`
**Status.** 🟡 — DefiLlama yields API + automation cron.

### `restaking-mapper`
**Pitch.** Maps your restaked positions across protocols (EigenLayer/Karak/Symbiotic via Aurora) and the AVS/services they secure, with combined slashing exposure. Surfaces "you're stacking 3x slashing risk" before it bites.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ positions: [{ protocol, asset, secured_avs, slash_exposure_usd }], combined_risk_grade }`
**Pricing.** 1 NEAR per scan.
**Categories.** `defi`, `risk`, `restaking`
**Tags.** `[restake, slash, eigenlayer]`
**Status.** 🟡 — needs restaking-protocol contract reads (Aurora EVM).

---

## 2. NFT tooling (14 skills)

### `nft-floor-sweeper`
**Pitch.** Sweeps N items at the floor of a chosen collection within budget, with optional rarity floor (don't grab a 1/1 by accident). Protects against floor manipulation by capping fill velocity.
**Inputs.** `{ collection: string, budget_near: number, count: number, min_rarity_pct?: number }`
**Outputs.** `{ swept: [{ token_id, price, tx_hash }], spent }`
**Pricing.** 5 NEAR setup, 0.3 NEAR per item swept.
**Categories.** `nft`, `automation`, `trading`
**Tags.** `[sweep, floor, nft]`
**Status.** 🟡 — needs Paras/Mintbase API for NEAR NFTs (or OpenSea for EVM via bridge).

### `nft-rarity-scorer`
**Pitch.** Scores an NFT 0–100 on rarity within its collection (trait-rarity composite) and ranks vs. its current ask price. Catches under-priced rares and over-priced commons.
**Inputs.** `{ collection: string, token_id: string }`
**Outputs.** `{ rarity_score, percentile, ask_vs_predicted_bps }`
**Pricing.** 0.1 NEAR per score.
**Categories.** `nft`, `analytics`
**Tags.** `[rarity, score, nft]`
**Status.** 🟡 — needs collection-metadata index (Paras/Mintbase).

### `nft-mint-drop-alert`
**Pitch.** Alerts on mint windows for watched collections via on-chain detection (new collection contract from a creator you watch) — earlier than calendar-based alerts.
**Inputs.** `{ creators: string[], chains?: string[] }`
**Outputs.** `{ alerts: [{ creator, collection, mint_at }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `nft`, `alerts`, `discovery`
**Tags.** `[mint, drop, alert]`
**Status.** 🟢 — RPC + creator address watch.

### `nft-portfolio-valuer`
**Pitch.** Daily MTM your NFT bag using floor + last-sale + recent-comp weighted estimate. Different from generic floor multiplication — handles rare items separately.
**Inputs.** `{ wallet?: string, exclude_collections?: string[] }`
**Outputs.** `{ total_usd, per_collection: [{ collection, count, mtm }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `nft`, `portfolio`, `analytics`
**Tags.** `[mtm, valuation, nft]`
**Status.** 🟡 — Paras/Mintbase + sales-history index.

### `nft-royalty-tracker`
**Pitch.** Tracks creator royalties earned across marketplaces (where enforced), broken down by collection, marketplace, and time window. Helps creators benchmark which marketplaces actually pay.
**Inputs.** `{ creator_wallet?: string, period: "monthly"|"yearly" }`
**Outputs.** `{ royalties_received_usd, by_marketplace, paid_pct }`
**Pricing.** 2 NEAR/month for creators.
**Categories.** `nft`, `creator`, `analytics`
**Tags.** `[royalty, creator, nft]`
**Status.** 🟡 — needs marketplace event ingestion.

### `nft-listing-optimizer`
**Pitch.** Recommends list price + duration based on collection liquidity (depth at floor, average days-to-sale, recent comp velocity). Stops you parking at the floor for 90 days when 2% above sells in 3.
**Inputs.** `{ collection: string, token_id: string }`
**Outputs.** `{ recommended_price, recommended_duration_days, confidence }`
**Pricing.** 0.3 NEAR per recommendation.
**Categories.** `nft`, `pricing`, `creator`
**Tags.** `[listing, price, optimize]`
**Status.** 🟡 — sales index + listing-history data.

### `nft-bid-ladder`
**Pitch.** Places tiered bids on a collection at floor / floor-5% / floor-10% with auto-renewal. Different from sniping — passive accumulation strategy for collections you'll hold.
**Inputs.** `{ collection: string, ladder: { pct: number, count: number }[], total_budget_near: number }`
**Outputs.** `{ bids_placed, fills: [{ token_id, price }] }`
**Pricing.** 4 NEAR setup, 0.2 NEAR per fill.
**Categories.** `nft`, `automation`, `trading`
**Tags.** `[bid, ladder, accumulation]`
**Status.** 🟡 — Paras bid endpoint + cron.

### `nft-trait-arb`
**Pitch.** Finds NFTs whose ask price is below their trait-floor (the floor for items sharing their rare trait). Often a lazy lister or a trait-floor mover from a recent sale.
**Inputs.** `{ collection: string, min_edge_pct: number }`
**Outputs.** `{ opportunities: [{ token_id, ask, trait_floor, edge_pct }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `nft`, `arbitrage`, `discovery`
**Tags.** `[trait-arb, nft]`
**Status.** 🟡 — trait-floor index per collection.

### `nft-airdrop-eligibility`
**Pitch.** Cross-references your NFT holdings against ongoing holder-airdrops you may be eligible for (NEAR + bridged EVM). One-tap claim where supported.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ eligible_for: [{ project, claim_link, est_value_usd }] }`
**Pricing.** Free (funnel skill).
**Categories.** `nft`, `airdrops`, `discovery`
**Tags.** `[airdrop, holder, claim]`
**Status.** 🟡 — needs a curated airdrop registry.

### `nft-loan-finder`
**Pitch.** Finds NFT-collateralized loan offers against pieces in your bag (LTV, APR, duration ranking). Doesn't take the loan — just lays out options when you want liquidity without selling.
**Inputs.** `{ wallet?: string, min_loan_usd?: number }`
**Outputs.** `{ offers: [{ token_id, lender, ltv, apr, duration }] }`
**Pricing.** 0.5 NEAR per scan.
**Categories.** `nft`, `lending`, `discovery`
**Tags.** `[loan, nft, ltv]`
**Status.** 🟡 — NFT-lending protocol integration (Bend/Drops via Aurora).

### `nft-derivative-position-monitor`
**Pitch.** Tracks P2P NFT derivative exposures: rentals, fractional, options. Stops the "I forgot I rented out my NFT" surprise on day 30.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ positions: [{ kind, item, counterparty, expires_at, status }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `nft`, `tracker`, `derivatives`
**Tags.** `[rental, fractional, options]`
**Status.** 🟡 — protocol-specific reads (Sologenic / NFTfi / Floor).

### `nft-wash-trade-detector`
**Pitch.** Flags wash-traded volume on a collection before you buy in (round-trip trades between a small set of wallets, flat-price trades, suspicious gas patterns).
**Inputs.** `{ collection: string }`
**Outputs.** `{ wash_volume_pct, suspicious_wallets: string[], real_volume_estimate_usd }`
**Pricing.** 0.5 NEAR per call.
**Categories.** `nft`, `security`, `analytics`
**Tags.** `[wash-trade, detect, nft]`
**Status.** 🟡 — sales-history data + graph analysis.

### `nft-mint-calendar-digest`
**Pitch.** Daily DM/TG digest of upcoming mints across your watched chains, ranked by team-prior + community signals. Different from `nft-mint-drop-alert` — calendar-based + curated, not real-time on-chain.
**Inputs.** `{ chains: string[], delivery: "dm"|"tg" }`
**Outputs.** `{ digest_message_id, mints_listed: int }`
**Pricing.** 3 NEAR/month.
**Categories.** `nft`, `digest`, `discovery`
**Tags.** `[mint, calendar, digest]`
**Status.** 🟡 — curated mint-calendar source.

### `nft-staking-aggregator`
**Pitch.** Aggregates yields across NFT-staking programs you're eligible for (or could be, if you bought-in). Surfaces the "stake to earn $X token" landscape per chain.
**Inputs.** `{ wallet?: string, max_buy_in_usd?: number }`
**Outputs.** `{ programs: [{ collection, program, apy_in_token, est_apy_usd }] }`
**Pricing.** 0.5 NEAR per scan.
**Categories.** `nft`, `staking`, `analytics`
**Tags.** `[stake, nft, yield]`
**Status.** 🟡 — staking-program registry per chain.

---

## 3. Multi-DAO operations (14 skills)

### `dao-vote-aggregator`
**Pitch.** Single dashboard of pending votes across every DAO you hold tokens in (NEAR + Aurora + Snapshot-based EVM). One screen, every deadline.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ pending: [{ dao, proposal_title, deadline, your_power }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `dao`, `governance`, `aggregator`
**Tags.** `[multi-dao, votes, dashboard]`
**Status.** 🟡 — Snapshot.org GraphQL + Tally.xyz API for EVM DAOs.

### `dao-treasury-monitor`
**Pitch.** Daily delta on every watched DAO treasury (inflow/outflow/composition). Catches "the treasury moved $5M to a new wallet" before it hits the news.
**Inputs.** `{ daos: string[], delivery: "dm"|"tg" }`
**Outputs.** `{ alerts: [{ dao, kind, amount, tx }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `dao`, `treasury`, `monitoring`
**Tags.** `[treasury, dao, monitor]`
**Status.** 🟢 — RPC reads on multisig/treasury contracts.

### `dao-delegate-cross-finder`
**Pitch.** Finds a delegate active across multiple DAOs whose vote pattern aligns with your stated values. Different from v1's AZUKA-only delegate finder — cross-DAO scope.
**Inputs.** `{ daos: string[], values_profile?: object }`
**Outputs.** `{ candidates: [{ delegate, alignment_pct, daos_active_in }] }`
**Pricing.** 1 NEAR per call.
**Categories.** `dao`, `governance`, `discovery`
**Tags.** `[delegate, cross-dao]`
**Status.** 🟡 — Snapshot/Tally vote history.

### `dao-snapshot-tracker`
**Pitch.** Tracks Snapshot proposals you're eligible to vote on (token-gated by holding). One-click vote where Snapshot supports it.
**Inputs.** `{ wallet?: string, daos?: string[] }`
**Outputs.** `{ eligible_proposals: [{ dao, title, deadline }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `dao`, `snapshot`, `tracker`
**Tags.** `[snapshot, gas-less, vote]`
**Status.** 🟡 — Snapshot GraphQL.

### `dao-auto-vote-by-policy`
**Pitch.** Auto-casts your vote per a stated policy on standardized proposal types (e.g. "always for sub-$50k grants under approved budget", "always against new-token issuance"). Reviewed by you weekly.
**Inputs.** `{ policies: [{ when, vote }] }`
**Outputs.** `{ votes_cast: [{ dao, proposal, vote, reason }] }`
**Pricing.** 6 NEAR/month.
**Categories.** `dao`, `automation`, `governance`
**Tags.** `[autovote, policy]`
**Status.** 🟡 — same Snapshot/Tally; vote signing via wallet proxy.

### `dao-grant-tracker`
**Pitch.** Tracks outstanding grant payments across DAOs you've contracted with. The "I delivered the work, where's the wire" service.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ pending: [{ dao, grant_id, amount, expected_at }], overdue: int }`
**Pricing.** 1 NEAR/month.
**Categories.** `dao`, `tracker`, `payments`
**Tags.** `[grant, payment, tracker]`
**Status.** 🟡 — varies per DAO; some have RetroFunding/Charm registries.

### `dao-quorum-aggregator`
**Pitch.** Lists every cross-DAO proposal short of quorum within 24h of close. Different from v1's AZUKA-only quorum-watcher.
**Inputs.** `{ daos: string[] }`
**Outputs.** `{ short_of_quorum: [{ dao, proposal, gap, deadline }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `dao`, `governance`, `alerts`
**Tags.** `[quorum, deadline]`
**Status.** 🟡 — Snapshot/Tally.

### `dao-meeting-aggregator`
**Pitch.** Aggregates working-group calls and forum discussions across DAOs into your calendar. Discord/Telegram/forum events into one ICS.
**Inputs.** `{ daos: string[] }`
**Outputs.** `{ ics_url, events_count }`
**Pricing.** 2 NEAR/month.
**Categories.** `dao`, `calendar`
**Tags.** `[meeting, dao, calendar]`
**Status.** 🟡 — needs forum/Discord scrape integration; ICS serve route.

### `dao-bounty-finder`
**Pitch.** Lists open bounties across DAOs matching your skills. Cross-DAO version of v1's mission-finder.
**Inputs.** `{ skills: string[], min_payout_usd?: number }`
**Outputs.** `{ bounties: [{ dao, title, payout, deadline }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `dao`, `bounty`, `discovery`
**Tags.** `[bounty, work, dao]`
**Status.** 🟡 — Dework/Charmverse/RetroFunding APIs.

### `dao-token-claim-aggregator`
**Pitch.** Claims retro/airdrops/rewards across DAOs on schedule. Threshold-gated to skip dust. Saves the gas-vs-value math.
**Inputs.** `{ wallet?: string, min_claim_usd: number }`
**Outputs.** `{ claims: [{ dao, amount, tx_hash }] }`
**Pricing.** 4 NEAR setup, 0.3 NEAR per claim.
**Categories.** `dao`, `automation`, `payments`
**Tags.** `[claim, airdrop, dao]`
**Status.** 🟡 — claim-contract registry per DAO.

### `dao-onchain-ops-runner`
**Pitch.** Executes batched cross-DAO operations (vote on N proposals + claim on M + delegate K) in minimum-tx form, factoring per-chain gas.
**Inputs.** `{ ops: object[] }`
**Outputs.** `{ tx_hashes: string[], total_gas_paid }`
**Pricing.** 1 NEAR per batch.
**Categories.** `dao`, `automation`, `gas`
**Tags.** `[batch, ops, gas]`
**Status.** 🟡 — multicall contract per chain.

### `dao-vote-conflict-detector`
**Pitch.** Flags when two DAOs you're in voted opposite ways on related questions (e.g. "DAO A funded project X, DAO B funded its competitor Y"). Useful for accountability or just understanding the field.
**Inputs.** `{ daos: string[] }`
**Outputs.** `{ conflicts: [{ dao_a, dao_b, topic, summary }] }`
**Pricing.** 1 NEAR per scan.
**Categories.** `dao`, `analytics`
**Tags.** `[conflict, cross-dao]`
**Status.** 🟡 — Snapshot/Tally + LLM clustering.

### `dao-discussion-summarizer`
**Pitch.** Daily summary of forum threads in DAOs you watch (Discourse/Commonwealth). Beats refreshing 8 forums to see what's brewing pre-proposal.
**Inputs.** `{ daos: string[], delivery: "dm"|"tg" }`
**Outputs.** `{ digest_message_id, threads_covered: int }`
**Pricing.** 4 NEAR/month.
**Categories.** `dao`, `digest`, `discourse`
**Tags.** `[forum, summary, dao]`
**Status.** 🟡 — Discourse/Commonwealth API.

### `dao-voter-power-tracker`
**Pitch.** Tracks your effective voting power per DAO over time (token balance + delegations received + lock multipliers). Stops the "wait, I had more votes last month" surprise.
**Inputs.** `{ wallet?: string, daos: string[] }`
**Outputs.** `{ power_per_dao: [{ dao, current, history }] }`
**Pricing.** 1 NEAR/month.
**Categories.** `dao`, `tracker`
**Tags.** `[voting-power, delegation, history]`
**Status.** 🟡 — Snapshot/Tally + RPC.

---

## 4. Tax, accounting & reporting (15 skills)

### `tax-fifo-calculator`
**Pitch.** Calculates realized gains FIFO across your full wallet history including DeFi positions and bridges. Different from v1's NewsCoin-only tax export — full multi-chain scope.
**Inputs.** `{ wallets: string[], year: number }`
**Outputs.** `{ realized_total, per_asset: [{ asset, gain, loss }], download_url }`
**Pricing.** 8 NEAR per export.
**Categories.** `tax`, `accounting`, `multi-chain`
**Tags.** `[fifo, tax, full]`
**Status.** 🟡 — multi-chain price index + bridge-event mapper.

### `tax-jurisdiction-helper`
**Pitch.** Explains crypto tax rules for the user's stated jurisdiction (US/UK/EU/AU/SG) with citations to actual regs. Updated when guidance changes.
**Inputs.** `{ jurisdiction: string, scenario?: string }`
**Outputs.** `{ summary, citations: string[], advice_disclaimer: string }`
**Pricing.** 1 NEAR per query.
**Categories.** `tax`, `compliance`, `education`
**Tags.** `[jurisdiction, tax, rules]`
**Status.** 🟢 — LLM with curated citation set.

### `tax-staking-income-classifier`
**Pitch.** Classifies staking income vs capital gain per jurisdiction. Critical for jurisdictions where staking is income at receipt vs cap-gain at sale (most are the former).
**Inputs.** `{ jurisdiction: string, year: number }`
**Outputs.** `{ income_total, basis_table, jurisdictional_notes }`
**Pricing.** 3 NEAR per report.
**Categories.** `tax`, `staking`, `compliance`
**Tags.** `[staking, income, classify]`
**Status.** 🟢 — wallet history + LLM classifier.

### `tax-loss-harvester`
**Pitch.** Finds unrealized loss positions ripe for tax-loss-harvest before year-end, with wash-sale advisor (e.g. don't rebuy same token within 30d in US).
**Inputs.** `{ wallet?: string, jurisdiction: string }`
**Outputs.** `{ harvest_candidates: [{ asset, unrealized_loss, harvest_advice }] }`
**Pricing.** 1 NEAR per scan.
**Categories.** `tax`, `optimization`
**Tags.** `[harvest, loss, tax]`
**Status.** 🟢 — `/api/trading/positions` + price feed.

### `tax-airdrop-cost-basis`
**Pitch.** Computes USD basis at receipt for every airdrop you've received, using closest-trade pricing. The thing every tax tool gets wrong by 10–30%.
**Inputs.** `{ wallet?: string, year: number }`
**Outputs.** `{ airdrops: [{ token, received_at, amount, basis_usd }] }`
**Pricing.** 2 NEAR per export.
**Categories.** `tax`, `airdrops`
**Tags.** `[airdrop, basis, tax]`
**Status.** 🟢 — RPC + price feed.

### `tax-form-prefill`
**Pitch.** Pre-fills US Form 8949 / UK SA108 / EU equivalents from on-chain data. Doesn't file — produces the populated PDF.
**Inputs.** `{ jurisdiction: "US"|"UK"|"DE"|"FR", year: number }`
**Outputs.** `{ download_url, page_count }`
**Pricing.** 10 NEAR per filing pack.
**Categories.** `tax`, `compliance`, `export`
**Tags.** `[form, prefill, tax]`
**Status.** 🟡 — needs PDF templates + form-fill library.

### `accounting-multi-wallet-consolidate`
**Pitch.** Consolidates trades across N wallets into one ledger, marking internal transfers (not taxable). Solves the "I have 4 wallets and Koinly thinks every transfer is a sale" problem.
**Inputs.** `{ wallets: string[], year: number }`
**Outputs.** `{ ledger_url, internal_transfers_excluded: int }`
**Pricing.** 5 NEAR per consolidation.
**Categories.** `accounting`, `multi-wallet`
**Tags.** `[consolidate, ledger, multi-wallet]`
**Status.** 🟢 — RPC + transfer-intent detection.

### `accounting-internal-transfer-detector`
**Pitch.** Auto-flags transfers between your own wallets across chains so they're excluded from gains. Differs from `accounting-multi-wallet-consolidate` — runs continuously, exposes a flag table.
**Inputs.** `{ wallets: string[] }`
**Outputs.** `{ flagged_transfers: [{ tx, src, dst, amount }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `accounting`, `multi-wallet`, `automation`
**Tags.** `[internal, transfer, flag]`
**Status.** 🟢 — RPC + cluster heuristic.

### `accounting-defi-position-resolver`
**Pitch.** Turns LP/lending/staking positions into clean balance-sheet rows (asset, lot, basis, current value). Most accounting tools choke here; this skill specializes.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ rows: [{ position, basis, mtm, kind }] }`
**Pricing.** 4 NEAR per export.
**Categories.** `accounting`, `defi`
**Tags.** `[defi, balance-sheet, resolver]`
**Status.** 🟡 — protocol-specific accounting adapters.

### `accounting-cost-basis-mover`
**Pitch.** Transfers cost basis when consolidating wallets (move tokens from A → B without inheriting "fresh basis at transfer time" the way naive tools do).
**Inputs.** `{ from_wallet: string, to_wallet: string, asset: string }`
**Outputs.** `{ basis_transferred, lots_moved: int }`
**Pricing.** 1 NEAR per move.
**Categories.** `accounting`, `multi-wallet`
**Tags.** `[basis, transfer, accounting]`
**Status.** 🟢 — internal-transfer ledger update.

### `accounting-koinly-export`
**Pitch.** Exports a structured CSV ready for Koinly/CoinTracker/CoinTracking import — column-perfect, internal-transfer flagged. Different from v1's NewsCoin-only export — full scope.
**Inputs.** `{ wallets: string[], year: number, target: "koinly"|"cointracker"|"cointracking" }`
**Outputs.** `{ download_url }`
**Pricing.** 4 NEAR per export.
**Categories.** `accounting`, `tax`, `export`
**Tags.** `[koinly, csv, export]`
**Status.** 🟢 — wallet history + CSV writer.

### `accounting-quarterly-report`
**Pitch.** Quarterly P&L summary for your accountant: realized gains, staking income, fees paid, fiat on/off-ramps. The thing they ask for instead of a 4,000-row CSV.
**Inputs.** `{ wallets: string[], quarter: "Q1-2026" }`
**Outputs.** `{ report_pdf_url }`
**Pricing.** 3 NEAR per report.
**Categories.** `accounting`, `reporting`
**Tags.** `[quarterly, p&l, accountant]`
**Status.** 🟢 — wallet history + PDF render.

### `accounting-mtm-summary`
**Pitch.** Period mark-to-market summary with realized + unrealized split. Useful for accrual-style internal reporting (funds, businesses holding crypto).
**Inputs.** `{ wallets: string[], period_start: ISO, period_end: ISO }`
**Outputs.** `{ realized, unrealized, by_asset }`
**Pricing.** 3 NEAR per summary.
**Categories.** `accounting`, `reporting`
**Tags.** `[mtm, accrual, period]`
**Status.** 🟢 — wallet history + price feed.

### `tax-gift-tracker`
**Pitch.** Tracks crypto you've received as a gift or sent as one (most jurisdictions tax these differently from sales). Logs USD basis + sender/recipient for proper handling.
**Inputs.** `{ wallet?: string, year: number }`
**Outputs.** `{ gifts_received, gifts_given, jurisdiction_notes }`
**Pricing.** 2 NEAR per export.
**Categories.** `tax`, `gifts`
**Tags.** `[gift, tax, basis]`
**Status.** 🟢 — RPC + price feed + manual flagging.

### `accounting-fee-budget`
**Pitch.** Sets a monthly fee budget across gas + bridge + DEX fees; alerts when you're 80% through. The "I had no idea I spent $400 on gas this month" prevention.
**Inputs.** `{ monthly_budget_usd: number, alert_threshold_pct?: number }`
**Outputs.** `{ spent_usd, remaining_usd, projection }`
**Pricing.** 1 NEAR/month.
**Categories.** `accounting`, `fees`
**Tags.** `[fee-budget, alert]`
**Status.** 🟢 — `/api/trading/fees` + RPC gas reads.

---

## 5. Research & due diligence (16 skills)

### `token-deep-dive`
**Pitch.** Multi-page report on a token: tokenomics, holder distribution, vesting, audits, team, comps. Saves the 6-hour-due-diligence afternoon.
**Inputs.** `{ token: string, depth?: "quick"|"standard"|"deep" }`
**Outputs.** `{ report_url, key_findings: string[5] }`
**Pricing.** 3 NEAR per quick, 8 NEAR per deep.
**Categories.** `research`, `due-diligence`
**Tags.** `[deep-dive, dd, research]`
**Status.** 🟡 — RPC + GitHub + DefiLlama + LLM synthesis.

### `team-background-check`
**Pitch.** Public-info background on a team (LinkedIn handles, prior projects, doxxed history). No private data — just consolidated public footprint.
**Inputs.** `{ team_handles: string[] }`
**Outputs.** `{ profiles: [{ handle, prior_projects, red_flags? }] }`
**Pricing.** 1 NEAR per name.
**Categories.** `research`, `due-diligence`
**Tags.** `[team, background, dd]`
**Status.** 🟡 — public-data scraper / search API.

### `funding-history-tracker`
**Pitch.** Investment rounds, lead investors, terms (where public) for a project. Updated as new rounds close.
**Inputs.** `{ project: string }`
**Outputs.** `{ rounds: [{ round, amount, lead, terms }] }`
**Pricing.** 0.5 NEAR per query.
**Categories.** `research`, `funding`
**Tags.** `[funding, vc, rounds]`
**Status.** 🟡 — Crunchbase / RootData API.

### `audit-status-checker`
**Pitch.** Checks if a contract has audits, parses severities from public reports, and grades audit-firm rigor. Different from v1's `risk-token-scorer` — focused on audit pedigree, not on-chain metrics.
**Inputs.** `{ contract: string, chain: string }`
**Outputs.** `{ audits: [{ firm, date, critical, high, medium }], audit_grade: "A-F" }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `research`, `security`
**Tags.** `[audit, security, dd]`
**Status.** 🟡 — DeFiSafety / audit-aggregator API.

### `code-similarity-checker`
**Pitch.** Flags if a contract is mostly forked from another (with a diff). Saves the "this is the next OHM" rabbit hole — most aren't.
**Inputs.** `{ contract: string, chain: string }`
**Outputs.** `{ best_match, similarity_pct, diff_summary }`
**Pricing.** 1 NEAR per check.
**Categories.** `research`, `security`
**Tags.** `[fork, similarity, code]`
**Status.** 🟡 — Etherscan source + similarity index.

### `tokenomics-modeler`
**Pitch.** Projects supply over time given emissions schedule + lockups + burns. One chart that tells you whether the inflation kills it.
**Inputs.** `{ token: string, horizon_months: number }`
**Outputs.** `{ chart_url, peak_supply_at, breakeven_emission }`
**Pricing.** 2 NEAR per model.
**Categories.** `research`, `tokenomics`
**Tags.** `[tokenomics, supply, model]`
**Status.** 🟡 — emissions data per token (curated or Token Unlocks).

### `holder-distribution-analyzer`
**Pitch.** Gini coefficient + top-100 concentration over time for a token. Trend matters more than snapshot.
**Inputs.** `{ token: string, lookback_days?: number }`
**Outputs.** `{ gini_now, gini_trend, top100_pct }`
**Pricing.** 0.5 NEAR per analysis.
**Categories.** `research`, `analytics`
**Tags.** `[gini, holders, distribution]`
**Status.** 🟡 — chain explorer holder snapshots.

### `narrative-strength-tracker`
**Pitch.** Tracks how a project's stated narrative holds up vs. market positioning over time. Catches "this is the AI x DePIN play" projects whose narrative shifted four times.
**Inputs.** `{ project: string, lookback_days?: number }`
**Outputs.** `{ stated_narratives: string[], drift_score, evidence: string[] }`
**Pricing.** 1 NEAR per check.
**Categories.** `research`, `narrative`
**Tags.** `[narrative, drift]`
**Status.** 🟡 — historical web/social snapshots.

### `competitive-landscape`
**Pitch.** Peer-comp report for a token in its category (TVL, mcap, fees, growth) with a ranked table. Stops the "is this overvalued?" guess.
**Inputs.** `{ token: string }`
**Outputs.** `{ category, peers: [{ token, mcap, tvl, fees_30d }], rank }`
**Pricing.** 1 NEAR per report.
**Categories.** `research`, `competitive`
**Tags.** `[comps, peers, mcap]`
**Status.** 🟡 — DefiLlama + CoinGecko.

### `whale-onboarding-detector`
**Pitch.** Detects first-time whale buys (>$1M positions) in a token. Specifically the "this address has never held this asset before" filter — different from generic whale-watch.
**Inputs.** `{ tokens: string[], threshold_usd: number }`
**Outputs.** `{ events: [{ token, wallet, amount_usd, at }] }`
**Pricing.** 5 NEAR/month.
**Categories.** `research`, `whales`, `alerts`
**Tags.** `[whale, onboarding, first-buy]`
**Status.** 🟡 — chain indexer with first-time-holder flag.

### `vc-unlock-tracker`
**Pitch.** VC investor unlock schedules and their on-chain movement after unlocks (sold immediately? held? swapped to stables?). Builds a profile of VC behavior per fund.
**Inputs.** `{ fund_or_wallet: string }`
**Outputs.** `{ unlocks: [{ token, at, amount, post_movement }] }`
**Pricing.** 2 NEAR per profile.
**Categories.** `research`, `vc`, `unlocks`
**Tags.** `[vc, unlock, fund]`
**Status.** 🟡 — Token Unlocks + fund-wallet registry.

### `social-volume-tracker`
**Pitch.** Tracks social mentions volume on a token over time across X (via Nitter), IronFeed, Telegram public groups. Shows the conversation curve.
**Inputs.** `{ token: string, lookback_days?: number }`
**Outputs.** `{ daily_mentions: [{ date, count, platform_split }] }`
**Pricing.** 0.5 NEAR per query.
**Categories.** `research`, `social`, `analytics`
**Tags.** `[social, mentions, volume]`
**Status.** 🟡 — Nitter/IronFeed search; TG public-group ingestion.

### `dev-activity-monitor`
**Pitch.** Repo commits, contributors, releases for a project. Flags abandoned-dev signals (no pushes in 60 days, lone-contributor risk).
**Inputs.** `{ github_org_or_repo: string }`
**Outputs.** `{ commits_30d, active_contribs, last_release_at, abandonment_risk }`
**Pricing.** 0.3 NEAR per check.
**Categories.** `research`, `dev`
**Tags.** `[github, dev, activity]`
**Status.** 🟡 — GitHub API (free tier OK).

### `project-roadmap-tracker`
**Pitch.** Tracks stated roadmap milestones vs. delivered. The "promised mainnet Q2, still on testnet in Q4" accountability check.
**Inputs.** `{ project: string }`
**Outputs.** `{ milestones: [{ promised_at, delivered_at?, status }] }`
**Pricing.** 1 NEAR per check.
**Categories.** `research`, `accountability`
**Tags.** `[roadmap, milestone, deliver]`
**Status.** 🟡 — historic roadmap snapshots + LLM matching.

### `governance-activity-monitor`
**Pitch.** Proposal volume + participation rate for a DAO over time. Healthy DAOs grow; declining ones quietly die in the forum.
**Inputs.** `{ dao: string, lookback_days?: number }`
**Outputs.** `{ proposals_per_week, participation_pct, trend }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `research`, `dao`, `analytics`
**Tags.** `[gov, participation, health]`
**Status.** 🟡 — Snapshot/Tally + RPC.

### `runway-estimator`
**Pitch.** Estimates a project's treasury runway from on-chain treasury + monthly spend rate. Critical for funding-cycle DD.
**Inputs.** `{ project_treasury: string }`
**Outputs.** `{ treasury_usd, monthly_burn_usd, runway_months }`
**Pricing.** 0.5 NEAR per estimate.
**Categories.** `research`, `treasury`
**Tags.** `[runway, treasury, burn]`
**Status.** 🟢 — RPC + price feed.

---

## 6. Developer tools (16 skills)

### `rpc-health-monitor`
**Pitch.** Monitors RPC endpoint uptime + p99 response time across chains; alerts on degradation. Stops your skill silently failing because Aurora-RPC is flaky.
**Inputs.** `{ endpoints: [{ chain, url }] }`
**Outputs.** `{ status: [{ url, uptime_pct, p99_ms }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `dev`, `monitoring`
**Tags.** `[rpc, uptime, monitor]`
**Status.** 🟢 — direct HTTP probes.

### `gas-oracle`
**Pitch.** Current gas across N chains with 1h/24h percentile. One-call API for skill authors who need to size txs.
**Inputs.** `{ chains: string[] }`
**Outputs.** `{ rates: [{ chain, gwei_now, p50_24h, p95_24h }] }`
**Pricing.** Free (utility).
**Categories.** `dev`, `gas`, `utility`
**Tags.** `[gas, oracle]`
**Status.** 🟢 — eth_gasPrice / NEAR fee endpoint.

### `gas-price-history`
**Pitch.** Gas history chart for picking off-peak windows on EVM chains. Cheaper than trial-and-error.
**Inputs.** `{ chain: string, lookback_days: number }`
**Outputs.** `{ chart_url, off_peak_windows_utc: string[] }`
**Pricing.** 0.1 NEAR per chart.
**Categories.** `dev`, `gas`, `analytics`
**Tags.** `[gas, history, off-peak]`
**Status.** 🟡 — needs a gas-history archiver (Blocknative API or custom).

### `abi-explorer`
**Pitch.** Explore a contract's ABI with sample calldata for each function. Beats Etherscan's read/write-contract page for skill authors who need to understand a contract fast.
**Inputs.** `{ contract: string, chain: string }`
**Outputs.** `{ functions: [{ name, sig, sample_call }] }`
**Pricing.** 0.1 NEAR per query.
**Categories.** `dev`, `contracts`
**Tags.** `[abi, explore, dev]`
**Status.** 🟡 — Etherscan ABI API.

### `contract-verify-helper`
**Pitch.** Verifies source on Etherscan/NEAR explorer with one call. Different from manual upload — accepts a GitHub URL + commit and figures out flatten/imports.
**Inputs.** `{ contract: string, chain: string, repo_url: string, commit?: string }`
**Outputs.** `{ verified: bool, explorer_url }`
**Pricing.** 1 NEAR per verification.
**Categories.** `dev`, `contracts`
**Tags.** `[verify, etherscan, dev]`
**Status.** 🟡 — Etherscan verification API + repo fetch.

### `tx-replay-debugger`
**Pitch.** Replays a tx on a fork and shows stack trace + revert reason. The "why did my tx fail?" debugger that beats reading raw revert bytes.
**Inputs.** `{ tx_hash: string, chain: string }`
**Outputs.** `{ revert_reason, stack_trace, gas_used }`
**Pricing.** 0.5 NEAR per replay.
**Categories.** `dev`, `debug`
**Tags.** `[debug, replay, revert]`
**Status.** 🟡 — Tenderly API or self-hosted Anvil fork.

### `event-log-decoder`
**Pitch.** Decodes raw event logs into named fields given the contract ABI. Replaces "Topic 0x123… data 0x456…" with "Transfer(from=alice, to=bob, value=100)".
**Inputs.** `{ tx_hash: string, chain: string }`
**Outputs.** `{ events: [{ name, args }] }`
**Pricing.** 0.1 NEAR per decode.
**Categories.** `dev`, `events`
**Tags.** `[events, decode, log]`
**Status.** 🟡 — Etherscan ABI + decoder lib.

### `bytecode-diff`
**Pitch.** Diffs two contracts' bytecode. Useful post-upgrade audit ("what actually changed?") and fork-detection.
**Inputs.** `{ contract_a: string, contract_b: string, chain: string }`
**Outputs.** `{ diff_pct, changed_function_selectors: string[] }`
**Pricing.** 0.3 NEAR per diff.
**Categories.** `dev`, `audit`
**Tags.** `[bytecode, diff]`
**Status.** 🟡 — RPC `eth_getCode` + selector indexer.

### `deploy-cost-estimator`
**Pitch.** Estimates deploy cost for a contract on N chains given current gas. Helps multi-chain devs budget the launch.
**Inputs.** `{ contract_bytes_size: number, chains: string[] }`
**Outputs.** `{ estimates: [{ chain, gas_units, cost_usd }] }`
**Pricing.** 0.1 NEAR per estimate.
**Categories.** `dev`, `gas`
**Tags.** `[deploy, cost, multi-chain]`
**Status.** 🟢 — eth_estimateGas + price feed.

### `contract-storage-explorer`
**Pitch.** Reads storage slots of a verified contract with field-level decoding. Lets you inspect contracts that don't expose getters for everything.
**Inputs.** `{ contract: string, chain: string, slot_or_field: string }`
**Outputs.** `{ value, decoded_as }`
**Pricing.** 0.2 NEAR per read.
**Categories.** `dev`, `contracts`
**Tags.** `[storage, slot, debug]`
**Status.** 🟡 — Etherscan storage layout + RPC `eth_getStorageAt`.

### `wallet-creator`
**Pitch.** Creates a deterministic NEAR sub-account or EVM keystore offline (no internet round-trip for keygen). For devs setting up test accounts in CI.
**Inputs.** `{ kind: "near"|"evm", seed: string }`
**Outputs.** `{ address, encrypted_keystore }`
**Pricing.** Free.
**Categories.** `dev`, `wallet`
**Tags.** `[keygen, wallet, deterministic]`
**Status.** 🟢 — pure crypto in skill runtime.

### `signature-verifier`
**Pitch.** Verifies EIP-191 / NEP-413 / EIP-712 signatures with one API surface. Reusable across many skills that need to verify auth payloads.
**Inputs.** `{ kind: "eip-191"|"nep-413"|"eip-712", message: string, signature: string, address: string }`
**Outputs.** `{ valid: bool, recovered_address?: string }`
**Pricing.** Free.
**Categories.** `dev`, `crypto`, `utility`
**Tags.** `[signature, verify, crypto]`
**Status.** 🟢 — pure crypto.

### `merkle-proof-generator`
**Pitch.** Generates a merkle proof for an airdrop list. Useful when you're building an airdrop contract and need proofs at distribute time.
**Inputs.** `{ leaves: string[], target: string }`
**Outputs.** `{ root, proof: string[] }`
**Pricing.** 0.1 NEAR per proof.
**Categories.** `dev`, `crypto`, `airdrops`
**Tags.** `[merkle, proof, airdrop]`
**Status.** 🟢 — pure crypto.

### `mempool-watcher`
**Pitch.** Watches a mempool for pending txs matching a pattern (function selector, target contract). Useful for MEV or just observing what's coming.
**Inputs.** `{ chain: string, pattern: object }`
**Outputs.** `{ matched_txs: [{ hash, from, to, calldata }] }`
**Pricing.** 6 NEAR/month.
**Categories.** `dev`, `mempool`
**Tags.** `[mempool, watch, mev]`
**Status.** 🟡 — Bloxroute/Blocknative mempool feed (not on NEAR; useful for Aurora EVM).

### `ens-bulk-resolver`
**Pitch.** Bulk-resolves ENS / NEAR named accounts to addresses (and reverse). Handy for any skill that takes user input as "name.eth" and needs the address.
**Inputs.** `{ names: string[] }`
**Outputs.** `{ resolved: [{ name, address }], failed: string[] }`
**Pricing.** 0.05 NEAR per name.
**Categories.** `dev`, `identity`, `utility`
**Tags.** `[ens, near, resolve]`
**Status.** 🟢 — RPC reads.

### `contract-test-runner`
**Pitch.** Runs a hardhat/forge test suite via webhook against a target branch. Skill authors get green/red without leaving their dev workflow.
**Inputs.** `{ repo_url: string, branch: string, framework: "hardhat"|"forge" }`
**Outputs.** `{ passed: int, failed: int, log_url }`
**Pricing.** 1 NEAR per run.
**Categories.** `dev`, `testing`, `ci`
**Tags.** `[test, ci, hardhat]`
**Status.** 🟡 — needs a sandboxed runner (the skills runtime is too short for real CI; this is a scheduled longer-running automation).

---

## 7. Data sync & integrations (14 skills)

### `notion-sync`
**Pitch.** Pushes posts/holdings/missions/governance state into a Notion database. Treats Notion like an external view of your AZUKA activity.
**Inputs.** `{ notion_token: string, database_id: string, source: "posts"|"holdings"|"missions" }`
**Outputs.** `{ synced_count, last_synced_at }`
**Pricing.** 4 NEAR/month.
**Categories.** `integration`, `notion`
**Tags.** `[notion, sync]`
**Status.** 🟡 — needs Notion integration token; standard public API.

### `airtable-sync`
**Pitch.** Same as notion-sync but for Airtable. Different schema model — Airtable's typed columns are friendlier for filter views.
**Inputs.** `{ airtable_token: string, base_id: string, table: string, source: string }`
**Outputs.** `{ synced_count }`
**Pricing.** 4 NEAR/month.
**Categories.** `integration`, `airtable`
**Tags.** `[airtable, sync]`
**Status.** 🟡 — Airtable API.

### `google-sheets-sync`
**Pitch.** Appends rows to a Google Sheet via service-account webhook. The "I want my finance team to see this in Sheets" surface.
**Inputs.** `{ sheet_id: string, sa_email: string, source: string }`
**Outputs.** `{ rows_appended }`
**Pricing.** 3 NEAR/month.
**Categories.** `integration`, `sheets`
**Tags.** `[sheets, sync]`
**Status.** 🟡 — Google Sheets API; needs SA setup helper.

### `slack-notifier`
**Pitch.** Pushes alerts to a Slack channel via incoming webhook. For ops teams running an AZUKA-driven workflow.
**Inputs.** `{ webhook_url: string, events: string[] }`
**Outputs.** `{ sent_count }`
**Pricing.** 2 NEAR/month.
**Categories.** `integration`, `slack`
**Tags.** `[slack, alerts]`
**Status.** 🟢 — incoming webhook (just an HTTP POST).

### `discord-notifier`
**Pitch.** Pushes alerts to a Discord channel via webhook. Same shape as slack-notifier but mapped to Discord embeds.
**Inputs.** `{ webhook_url: string, events: string[] }`
**Outputs.** `{ sent_count }`
**Pricing.** 2 NEAR/month.
**Categories.** `integration`, `discord`
**Tags.** `[discord, alerts]`
**Status.** 🟢 — webhook POST.

### `zapier-bridge`
**Pitch.** Webhook out to Zapier with chosen AZUKA events. Lets non-devs wire 4,000+ Zapier-connected apps to AZUKA triggers.
**Inputs.** `{ zap_url: string, event_filters: string[] }`
**Outputs.** `{ delivered_count }`
**Pricing.** 3 NEAR/month.
**Categories.** `integration`, `zapier`
**Tags.** `[zapier, bridge]`
**Status.** 🟢 — webhook POST.

### `make-bridge`
**Pitch.** Same as zapier-bridge but for Make.com. Slightly different event shape; commonly cheaper per-op for high-volume users.
**Inputs.** `{ scenario_url: string, event_filters: string[] }`
**Outputs.** `{ delivered_count }`
**Pricing.** 3 NEAR/month.
**Categories.** `integration`, `make`
**Tags.** `[make, bridge]`
**Status.** 🟢 — webhook POST.

### `csv-batch-export`
**Pitch.** Schedules CSV exports of any queryable surface (positions, posts, missions, votes). Drops to S3/R2 or emails a signed URL.
**Inputs.** `{ source: string, cadence: "daily"|"weekly", destination: "url"|"email" }`
**Outputs.** `{ last_export_url }`
**Pricing.** 2 NEAR/month.
**Categories.** `integration`, `export`
**Tags.** `[csv, export, schedule]`
**Status.** 🟡 — needs R2 signed-URL helper (R2 is wired; helper is small).

### `webhook-debouncer`
**Pitch.** Debounces noisy webhooks before downstream consumers. e.g. "no more than 1 alert per minute, but always emit the latest state."
**Inputs.** `{ source_event: string, dest_url: string, debounce_ms: number }`
**Outputs.** `{ debounced_count }`
**Pricing.** 1 NEAR/month.
**Categories.** `integration`, `utility`
**Tags.** `[debounce, webhook]`
**Status.** 🟢 — pure middleware in the skill runtime.

### `webhook-router`
**Pitch.** Routes webhooks by predicate to multiple destinations. "If event.kind == 'sniper-fire', send to Slack; else Discord."
**Inputs.** `{ rules: [{ predicate, dest_url }] }`
**Outputs.** `{ routed_count_by_dest }`
**Pricing.** 2 NEAR/month.
**Categories.** `integration`, `routing`
**Tags.** `[router, webhook, predicate]`
**Status.** 🟢 — pure middleware.

### `cron-scheduler-pro`
**Pitch.** Advanced cron with jitter + retry policies + dead-letter queue. The default automation cron is fine for "daily at 9am"; this is for "hourly on weekdays with 30s jitter, exponential retry on failure."
**Inputs.** `{ cron: string, jitter_ms?: number, retry_policy?: object }`
**Outputs.** `{ schedule_id }`
**Pricing.** 3 NEAR/month per scheduled task.
**Categories.** `integration`, `automation`, `scheduler`
**Tags.** `[cron, jitter, retry]`
**Status.** 🟡 — extends `agent_automations` with new fields.

### `data-pipeline-monitor`
**Pitch.** Monitors your sync skills' health + latency (last successful run, lag, error rate). The "is my Notion sync still working" dashboard.
**Inputs.** `{ wallet?: string }`
**Outputs.** `{ pipelines: [{ skill, last_success_at, lag_ms, error_rate }] }`
**Pricing.** Free for skill owners.
**Categories.** `integration`, `monitoring`
**Tags.** `[pipeline, health, observability]`
**Status.** 🟢 — `agent_automation_runs` table reads.

### `obsidian-vault-sync`
**Pitch.** Syncs your AZUKA notes (DM threads, post drafts, mission notes) to a local Obsidian vault as Markdown. For users who run their second-brain locally.
**Inputs.** `{ vault_path_token: string, source: string }`
**Outputs.** `{ files_written, last_sync_at }`
**Pricing.** 3 NEAR/month.
**Categories.** `integration`, `obsidian`
**Tags.** `[obsidian, vault, sync]`
**Status.** 🟡 — needs an Obsidian Sync-compatible HTTP endpoint or local agent.

### `s3-archiver`
**Pitch.** Archives your AZUKA content (posts, DMs you can decrypt, mission audit logs) to your own S3/R2 bucket on a schedule. Personal data sovereignty without leaving the platform.
**Inputs.** `{ s3_bucket: string, s3_creds: object, source: string, cadence: "daily"|"weekly" }`
**Outputs.** `{ archived_size_mb, last_archive_at }`
**Pricing.** 4 NEAR/month.
**Categories.** `integration`, `archive`, `sovereignty`
**Tags.** `[s3, archive, backup]`
**Status.** 🟢 — S3 PUT + cron.

---

## 8. Compliance & risk reporting (12 skills)

### `sanctions-screen`
**Pitch.** Checks an address against OFAC/UN sanctions lists. Required if you're moving money cross-border or running a regulated venue.
**Inputs.** `{ address: string }`
**Outputs.** `{ flagged: bool, source_lists: string[] }`
**Pricing.** 0.1 NEAR per check.
**Categories.** `compliance`, `sanctions`
**Tags.** `[ofac, sanctions, screen]`
**Status.** 🟡 — needs Chainalysis Sanctions API or self-hosted list.

### `aml-flag-explainer`
**Pitch.** Explains why an address received a risk flag from public scoring (Chainalysis/TRM). Decodes "high-risk" into "received funds from Tornado Cash 3 hops back".
**Inputs.** `{ address: string }`
**Outputs.** `{ score, factors: string[], hop_distance_to_known_bad: int }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `compliance`, `aml`
**Tags.** `[aml, risk, explain]`
**Status.** 🟡 — Chainalysis/TRM API (paid).

### `jurisdiction-guide`
**Pitch.** High-level guidance on crypto rules for a stated jurisdiction (covers MiCA, IRS, MAS, FCA). Different from `tax-jurisdiction-helper` — broader regulatory scope, not just tax.
**Inputs.** `{ jurisdiction: string, topic: "trading"|"staking"|"defi"|"nft"|"otc" }`
**Outputs.** `{ rules_summary, regulator_links }`
**Pricing.** 1 NEAR per query.
**Categories.** `compliance`, `regulatory`
**Tags.** `[jurisdiction, regulatory]`
**Status.** 🟢 — LLM with curated citation set.

### `kyc-readiness-bundle`
**Pitch.** Assembles docs + addresses for KYC flow at exchanges. Pre-flight checklist so you don't get stuck mid-flow at Coinbase/Kraken.
**Inputs.** `{ exchange: string }`
**Outputs.** `{ checklist: string[], pre_filled_addresses: string[] }`
**Pricing.** 0.5 NEAR per bundle.
**Categories.** `compliance`, `kyc`
**Tags.** `[kyc, exchange, prep]`
**Status.** 🟢 — curated per-exchange checklists.

### `proof-of-reserves-reader`
**Pitch.** Verifies an exchange's PoR attestation against on-chain. Reads the Merkle root, checks address inclusion, surfaces freshness.
**Inputs.** `{ exchange: string, your_user_id_hash?: string }`
**Outputs.** `{ por_fresh: bool, merkle_root, included: bool? }`
**Pricing.** 1 NEAR per check.
**Categories.** `compliance`, `por`
**Tags.** `[por, merkle, exchange]`
**Status.** 🟡 — exchange-specific PoR endpoint integrations.

### `proof-of-funds-generator`
**Pitch.** Generates a signed proof-of-funds for a counterparty without exposing your full wallet. NEP-413 attestation + selective balance disclosure.
**Inputs.** `{ wallet?: string, min_balance_usd: number }`
**Outputs.** `{ proof_url, expires_at }`
**Pricing.** 2 NEAR per proof.
**Categories.** `compliance`, `pof`
**Tags.** `[pof, proof, otc]`
**Status.** 🟢 — NEP-413 signing + balance read.

### `report-suspicious-activity`
**Pitch.** Assists filing reports against a flagged address (FinCEN SAR-style or platform abuse channels). Doesn't file directly — drafts the report and queues for your review.
**Inputs.** `{ flagged_address: string, evidence: string[] }`
**Outputs.** `{ report_draft_url }`
**Pricing.** 1 NEAR per draft.
**Categories.** `compliance`, `reporting`
**Tags.** `[sar, report, flag]`
**Status.** 🟡 — varies by jurisdiction; usually output is just a doc, not actual filing.

### `chain-of-custody-logger`
**Pitch.** Logs transfer events with attestations for compliance (when did asset X enter wallet Y, who confirmed). Useful for audit trails of escrowed/restricted-token holdings.
**Inputs.** `{ wallet: string, attestation_signers: string[] }`
**Outputs.** `{ log_url, events_logged: int }`
**Pricing.** 4 NEAR/month.
**Categories.** `compliance`, `audit`
**Tags.** `[custody, log, audit]`
**Status.** 🟢 — RPC + signed attestation storage.

### `beneficial-owner-mapper`
**Pitch.** Maps related addresses for a known entity (cluster heuristic + public attribution data). Useful for OTC counterparty verification.
**Inputs.** `{ seed_address: string }`
**Outputs.** `{ cluster: string[], confidence_per_address: object }`
**Pricing.** 2 NEAR per map.
**Categories.** `compliance`, `forensics`
**Tags.** `[cluster, owner, identity]`
**Status.** 🟡 — TRM/Chainalysis or self-hosted heuristic.

### `regulatory-update-digest`
**Pitch.** Weekly digest of crypto regulatory updates by jurisdiction. Different from generic crypto-news — strictly regulatory: SEC actions, MiCA tweaks, FATF guidance.
**Inputs.** `{ jurisdictions: string[], delivery: "dm"|"tg" }`
**Outputs.** `{ digest_message_id }`
**Pricing.** 4 NEAR/month.
**Categories.** `compliance`, `digest`
**Tags.** `[regulatory, digest, news]`
**Status.** 🟡 — curated regulatory news feed.

### `tax-residency-detector`
**Pitch.** Flags potential tax-residency triggers based on your activity patterns (where you sign, where you withdraw to). Useful for digital nomads and frequent travelers risking unintended residency.
**Inputs.** `{ wallet?: string, lookback_days?: number }`
**Outputs.** `{ jurisdiction_signals: [{ jurisdiction, signal_count, advice }] }`
**Pricing.** 2 NEAR per scan.
**Categories.** `compliance`, `tax`, `residency`
**Tags.** `[residency, tax, nomad]`
**Status.** 🟡 — depends on geolocation signals (IP if logged) + LLM advice.

### `travel-rule-helper`
**Pitch.** For transfers above the FATF Travel Rule threshold, drafts the required originator/beneficiary metadata package per destination VASP's format.
**Inputs.** `{ tx: object, destination_vasp: string }`
**Outputs.** `{ travel_rule_payload, format: "ivms101" }`
**Pricing.** 1 NEAR per package.
**Categories.** `compliance`, `travel-rule`
**Tags.** `[travel-rule, fatf, vasp]`
**Status.** 🟡 — VASP directory + IVMS101 schema.

---

## 9. Cross-chain identity & reputation (10 skills)

### `address-cluster-prover`
**Pitch.** Prove your control of N addresses with one signed payload. The "yes, this NEAR account, that EVM address, and that SOL wallet are all me" attestation.
**Inputs.** `{ addresses: [{ chain, address }] }`
**Outputs.** `{ proof_url, signed_messages: object }`
**Pricing.** 0.5 NEAR per proof.
**Categories.** `identity`, `cross-chain`
**Tags.** `[cluster, prove, identity]`
**Status.** 🟢 — multi-chain signing (each chain's auth scheme).

### `ens-near-link`
**Pitch.** Links an ENS name to your NEAR account with reverse lookup. Lets `vitalik.eth` map cleanly to a NEAR named account for cross-chain UX.
**Inputs.** `{ ens_name: string, near_account: string }`
**Outputs.** `{ link_tx_evm, link_tx_near }`
**Pricing.** 1 NEAR per link.
**Categories.** `identity`, `ens`, `near`
**Tags.** `[ens, near, link]`
**Status.** 🟡 — needs an on-chain registry (lightweight contract).

### `cross-chain-resume-builder`
**Pitch.** Builds a portable rep résumé across chains: commits, voting, donations, NFT-holder badges. Output as a shareable JSON-LD profile.
**Inputs.** `{ wallets: [{ chain, address }] }`
**Outputs.** `{ resume_url, schema: "json-ld" }`
**Pricing.** 1 NEAR per build.
**Categories.** `identity`, `reputation`
**Tags.** `[resume, profile, rep]`
**Status.** 🟡 — composite reads + storage for the JSON-LD doc.

### `gitcoin-passport-aggregator`
**Pitch.** Aggregates your Gitcoin Passport stamps with on-chain rep into a single composite score. For DAOs implementing reputation-weighted voting.
**Inputs.** `{ wallet: string }`
**Outputs.** `{ passport_score, on_chain_score, composite }`
**Pricing.** 0.3 NEAR per query.
**Categories.** `identity`, `reputation`
**Tags.** `[passport, gitcoin, rep]`
**Status.** 🟡 — Gitcoin Passport API.

### `social-handle-prover`
**Pitch.** Cryptographically attests you own X/GitHub/Telegram handles. Posts a signed nonce to the handle, indexes the proof on-chain.
**Inputs.** `{ handles: [{ platform, handle }] }`
**Outputs.** `{ proofs: [{ platform, handle, proof_url }] }`
**Pricing.** 0.5 NEAR per handle.
**Categories.** `identity`, `social`
**Tags.** `[handle, social, prove]`
**Status.** 🟡 — Nitter/GitHub API for nonce verification.

### `recovery-circle-coordinator`
**Pitch.** Sets up a social-recovery circle across N friends' wallets. Coordinates the M-of-N approval flow when you trigger recovery.
**Inputs.** `{ trustees: string[], threshold_m: number }`
**Outputs.** `{ circle_id, attestations_collected }`
**Pricing.** 5 NEAR setup, free for activations.
**Categories.** `identity`, `recovery`
**Tags.** `[recovery, social, multisig]`
**Status.** 🔴 — needs first-class social-recovery contract (no native primitive on NEAR; this is a substantial new platform feature).

### `attestation-issuer`
**Pitch.** Issues EAS-style attestations about a counterparty ("Alice paid me on time", "Bob delivered the work"). Builds the trust graph one signed claim at a time.
**Inputs.** `{ subject: string, schema: string, data: object }`
**Outputs.** `{ attestation_uid, tx_hash }`
**Pricing.** 0.3 NEAR per attestation.
**Categories.** `identity`, `attestation`
**Tags.** `[eas, attest, claim]`
**Status.** 🟡 — EAS contract on Aurora EVM (or NEAR-native equivalent).

### `reputation-graph-builder`
**Pitch.** Builds a graph of trust attestations among your contacts; surfaces shortest-trust-path between you and an unknown counterparty.
**Inputs.** `{ wallet?: string, target?: string }`
**Outputs.** `{ graph, shortest_path?: string[] }`
**Pricing.** 1 NEAR per build.
**Categories.** `identity`, `graph`, `rep`
**Tags.** `[graph, trust, rep]`
**Status.** 🟡 — depends on `attestation-issuer` data.

### `multichain-handle-resolver`
**Pitch.** Resolves `name.eth` / `name.near` / `name.sol` to canonical address per chain. Different from v1's address-validator and the dev-tools `ens-bulk-resolver` — this is identity-focused, returns canonical chain bindings.
**Inputs.** `{ name: string, target_chains?: string[] }`
**Outputs.** `{ resolutions: [{ chain, address, confidence }] }`
**Pricing.** 0.05 NEAR per call.
**Categories.** `identity`, `resolver`
**Tags.** `[resolve, multichain, name]`
**Status.** 🟢 — RPC reads.

### `lens-farcaster-mirror`
**Pitch.** Mirrors your IronFeed posts to Lens/Farcaster with attribution. Cross-publishes once, hits three audiences.
**Inputs.** `{ lens_handle?: string, fc_fid?: number }`
**Outputs.** `{ mirrored_count }`
**Pricing.** 4 NEAR/month.
**Categories.** `identity`, `social`, `automation`
**Tags.** `[lens, farcaster, mirror]`
**Status.** 🟡 — Lens/Farcaster client integrations.

---

## 10. AI agent collaboration (14 skills)

### `agent-team-coordinator`
**Pitch.** Coordinates N agents on a multi-step task with role split (researcher / writer / reviewer / publisher). Stops one agent doing everything badly.
**Inputs.** `{ task: string, roles: [{ role, agent_account }] }`
**Outputs.** `{ deliverable, role_outputs: object }`
**Pricing.** 2 NEAR per coordination.
**Categories.** `agents`, `coordination`
**Tags.** `[multi-agent, team, role]`
**Status.** 🟢 — chains existing `agents.sandbox` calls.

### `skill-of-skills`
**Pitch.** Meta-skill that picks + sequences other skills for an open-ended goal (e.g. "do my morning ritual" → daily-brief + weekly-recap + watchlist + pump-radar). Executes the sequence and merges outputs.
**Inputs.** `{ goal: string, constraints?: object }`
**Outputs.** `{ chosen_skills: string[], result }`
**Pricing.** 1 NEAR per invocation.
**Categories.** `agents`, `meta`
**Tags.** `[meta, sequence, goal]`
**Status.** 🟢 — `/api/skills/registry` + planner LLM.

### `agent-debate`
**Pitch.** Two agents debate a question (one pro, one con), return the synthesized answer. Useful when you suspect single-agent answers lean too confident.
**Inputs.** `{ question: string, n_rounds?: number }`
**Outputs.** `{ pro_argument, con_argument, synthesis }`
**Pricing.** 0.5 NEAR per debate.
**Categories.** `agents`, `reasoning`
**Tags.** `[debate, reason, multi-agent]`
**Status.** 🟢 — two `ctx.agent` calls.

### `agent-peer-review`
**Pitch.** A second agent reviews the first agent's output before delivery (fact-check, style, completeness). Catches the obvious misses without your eyes.
**Inputs.** `{ first_agent_output: string, review_criteria?: string[] }`
**Outputs.** `{ approved: bool, edits: string[], rewritten?: string }`
**Pricing.** 0.3 NEAR per review.
**Categories.** `agents`, `quality`
**Tags.** `[review, peer, quality]`
**Status.** 🟢 — second `ctx.agent` call.

### `agent-handoff`
**Pitch.** Hands off state between agents preserving context (compressed memory + active goals). Different from team-coordinator — sequential, not parallel.
**Inputs.** `{ from_agent: string, to_agent: string, state: object }`
**Outputs.** `{ resumed_at }`
**Pricing.** 0.2 NEAR per handoff.
**Categories.** `agents`, `state`
**Tags.** `[handoff, sequential, context]`
**Status.** 🟢 — `agent_connections` switch + state passing.

### `agent-failover`
**Pitch.** Auto-swaps to backup agent on primary error (rate-limit, timeout, refusal). Keeps your skill running when OpenClaw is having a bad day.
**Inputs.** `{ primary: string, backup: string, error_kinds?: string[] }`
**Outputs.** `{ swap_count, primary_uptime_pct }`
**Pricing.** 1 NEAR/month.
**Categories.** `agents`, `reliability`
**Tags.** `[failover, backup, reliability]`
**Status.** 🟢 — wraps `ctx.agent` with retry+swap.

### `agent-budget-manager`
**Pitch.** Distributes an LLM-call budget across agents/skills with priority weights. Stops one runaway skill from burning through your monthly token quota.
**Inputs.** `{ monthly_budget_calls: number, priorities: [{ skill, weight }] }`
**Outputs.** `{ allocations, remaining_budget }`
**Pricing.** 2 NEAR/month.
**Categories.** `agents`, `budget`
**Tags.** `[budget, quota, priority]`
**Status.** 🟡 — needs middleware in skill runtime to enforce.

### `agent-history-summarizer`
**Pitch.** Compacts long agent threads to keep context budget manageable. Critical for skills running long-lived sessions where context blows past the window.
**Inputs.** `{ thread_id: string, target_token_budget: number }`
**Outputs.** `{ summary, original_token_count, compacted_token_count }`
**Pricing.** 0.2 NEAR per compaction.
**Categories.** `agents`, `context`
**Tags.** `[compact, history, context]`
**Status.** 🟢 — `ctx.agent` summarization.

### `agent-shared-memory`
**Pitch.** Read/write shared key-value store across your agents. The "agent A knows what agent B did yesterday" surface.
**Inputs.** `{ key: string, value?: any, op: "get"|"set" }`
**Outputs.** `{ value? }`
**Pricing.** Free for skill authors.
**Categories.** `agents`, `state`
**Tags.** `[shared, memory, kv]`
**Status.** 🟡 — needs an `agent_kv` table; small add.

### `agent-task-marketplace`
**Pitch.** Posts tasks for any agent (yours or others) to claim and execute against a payout. Different from missions — agent-only, smaller scope, automatic claim+settlement.
**Inputs.** `{ task: string, payout_near: number, deadline?: ISO }`
**Outputs.** `{ task_id, claimant?, result? }`
**Pricing.** 0.5 NEAR + payout.
**Categories.** `agents`, `marketplace`
**Tags.** `[task, market, agent]`
**Status.** 🟡 — extends missions table for agent-as-claimant.

### `agent-test-harness`
**Pitch.** Runs a skill against synthetic inputs, scores outputs vs expected. The "is my skill still doing what I built it for after the model upgrade" check.
**Inputs.** `{ skill_id: string, test_cases: object[] }`
**Outputs.** `{ passed, failed, regression: bool }`
**Pricing.** 1 NEAR per test run.
**Categories.** `agents`, `testing`, `quality`
**Tags.** `[test, harness, regression]`
**Status.** 🟢 — `/api/skills/run` with structured cases.

### `agent-skill-recorder`
**Pitch.** Records agent + user interactions to fine-tune a future skill. The "I keep doing the same 6-step thing manually" → "let's make a skill from it" path.
**Inputs.** `{ session_label: string }`
**Outputs.** `{ recording_id, n_interactions }`
**Pricing.** 1 NEAR/month.
**Categories.** `agents`, `skill-creation`
**Tags.** `[record, distill, skill-creator]`
**Status.** 🟡 — needs an `agent_recordings` table; downstream tooling for distillation.

### `agent-cost-attribution`
**Pitch.** Per-skill, per-call cost attribution across your agents (LLM tokens, RPC calls, third-party API spend). The "where is my agent budget actually going" answer.
**Inputs.** `{ wallet?: string, period: "daily"|"monthly" }`
**Outputs.** `{ attribution: [{ skill, calls, cost_usd, share_pct }] }`
**Pricing.** 1 NEAR/month.
**Categories.** `agents`, `cost`, `analytics`
**Tags.** `[cost, attribution, budget]`
**Status.** 🟡 — needs LLM-call accounting hooks in the runtime.

### `agent-output-validator`
**Pitch.** Validates an agent's output against a schema (JSON Schema or Zod). Stops malformed outputs from breaking downstream skills in a chain. Runs synchronously before delivery.
**Inputs.** `{ schema: object, output: any }`
**Outputs.** `{ valid: bool, errors: string[] }`
**Pricing.** Free for skill authors.
**Categories.** `agents`, `validation`, `quality`
**Tags.** `[schema, validate, output]`
**Status.** 🟢 — pure JS validation in skill runtime.

---

## 11. Community management (12 skills)

### `community-onboarding-flow`
**Pitch.** Multi-step onboarding for a project's new members (verify holding → join group → take quiz → get role). Different from v1's AZUKA onboarding — for project owners running their own community.
**Inputs.** `{ project_token: string, steps: object[] }`
**Outputs.** `{ onboarded_count, drop_off_per_step }`
**Pricing.** 8 NEAR/month per project.
**Categories.** `community`, `onboarding`
**Tags.** `[onboard, flow, community]`
**Status.** 🟢 — composite of token-gate + groups + quiz.

### `community-churn-predictor`
**Pitch.** Flags members at risk of leaving (engagement decay pattern) with tailored re-engagement actions. Recovery cheaper than acquisition.
**Inputs.** `{ project_token: string }`
**Outputs.** `{ at_risk: [{ member, last_activity, recommended_action }] }`
**Pricing.** 6 NEAR/month.
**Categories.** `community`, `analytics`
**Tags.** `[churn, retention, predict]`
**Status.** 🟢 — feed/dm/rooms engagement reads.

### `community-mod-queue`
**Pitch.** Moderation queue across feed/rooms/dm-groups for a project (flagged by users, by AI, by rules). Different from `room-moderator` which is single-room — this is project-wide.
**Inputs.** `{ project_id: string, rule_set: string[] }`
**Outputs.** `{ pending: int, actioned_today: int }`
**Pricing.** 6 NEAR/month.
**Categories.** `community`, `moderation`
**Tags.** `[mod, queue, project]`
**Status.** 🟢 — composite of feed + rooms + dm reads.

### `community-faq-bot`
**Pitch.** Auto-answers common questions in a group from a curated FAQ. Ramps from the curated set into "frequent asks" detection over time.
**Inputs.** `{ group_id: string, faq: { q, a }[] }`
**Outputs.** `{ answered_count, ungrounded_q_count }`
**Pricing.** 4 NEAR/month per group.
**Categories.** `community`, `support`
**Tags.** `[faq, bot, support]`
**Status.** 🟢 — DM groups + LLM lookup.

### `community-event-orchestrator`
**Pitch.** Schedules + reminds + recaps a community event (room or external). The full lifecycle, not just the calendar.
**Inputs.** `{ event: { title, when, kind } }`
**Outputs.** `{ schedule_post_id, reminder_pings, recap_post_id }`
**Pricing.** 2 NEAR per event.
**Categories.** `community`, `events`
**Tags.** `[event, lifecycle, orchestrate]`
**Status.** 🟢 — composite of rooms + posts + DMs.

### `community-contribution-tracker`
**Pitch.** Tracks each member's contributions for rewards: posts, replies, room participation, missions completed. Output drives `community-superfan-rewarder`-style payouts.
**Inputs.** `{ project_id: string, period: "weekly"|"monthly" }`
**Outputs.** `{ leaderboard: [{ member, score, breakdown }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `community`, `analytics`, `rewards`
**Tags.** `[contribution, leaderboard]`
**Status.** 🟢 — composite reads.

### `community-segment-builder`
**Pitch.** Segments members by activity/cohort for targeted outreach. The "DM all my Vanguard holders who haven't voted in 30 days" filter.
**Inputs.** `{ project_id: string, predicate: object }`
**Outputs.** `{ segment_size, sample: string[] }`
**Pricing.** 1 NEAR per segment.
**Categories.** `community`, `analytics`
**Tags.** `[segment, cohort, filter]`
**Status.** 🟢 — composite reads.

### `community-survey-runner`
**Pitch.** Runs polls/surveys across DMs and rooms; analyzes results. Beats third-party tools because the audience is your verified AZUKA identity.
**Inputs.** `{ questions: object[], audience: object }`
**Outputs.** `{ responses, summary }`
**Pricing.** 2 NEAR per survey.
**Categories.** `community`, `surveys`
**Tags.** `[survey, poll, analyze]`
**Status.** 🟡 — needs lightweight survey table; results-collection works via DMs.

### `community-rep-graph`
**Pitch.** Builds a reputation graph for moderation decisions ("this user has 50 trust-signals from senior members"). Lets mods escalate based on social proof.
**Inputs.** `{ project_id: string }`
**Outputs.** `{ graph_url, top_trusted: string[] }`
**Pricing.** 4 NEAR/month.
**Categories.** `community`, `moderation`, `rep`
**Tags.** `[rep, graph, mod]`
**Status.** 🟡 — depends on attestation data.

### `community-language-router`
**Pitch.** Routes messages to language-specific subgroups (auto-detect → fork into the right channel). Stops the "everyone-in-one-Telegram-mess" failure mode.
**Inputs.** `{ source_group: string, lang_groups: { lang, group_id }[] }`
**Outputs.** `{ routed_count_per_lang }`
**Pricing.** 3 NEAR/month per group.
**Categories.** `community`, `i18n`, `routing`
**Tags.** `[lang, route, i18n]`
**Status.** 🟡 — needs bot-as-member in source group; LLM for detection.

### `community-handoff-tracker`
**Pitch.** Tracks open user issues being handed between mods (state, assignee, last update). The "support ticket" surface for Discord/Telegram-style communities.
**Inputs.** `{ project_id: string }`
**Outputs.** `{ open_tickets: int, mean_resolution_hours }`
**Pricing.** 4 NEAR/month.
**Categories.** `community`, `support`
**Tags.** `[handoff, ticket, mod]`
**Status.** 🟡 — needs a `community_tickets` table.

### `community-rules-explainer`
**Pitch.** Auto-explains rule violations with cited rule text when a mod kicks/mutes. Stops the "but why did I get kicked?" follow-up DMs.
**Inputs.** `{ rule_set: string[], violation_message_id: string }`
**Outputs.** `{ explanation_dm_id }`
**Pricing.** 2 NEAR/month.
**Categories.** `community`, `moderation`, `support`
**Tags.** `[rules, explain, dm]`
**Status.** 🟢 — LLM + DM send.

---

## 12. Education & certification (10 skills)

### `tutorial-runner`
**Pitch.** Interactive tutorials for AZUKA features that track completion (e.g. "build your first NewsCoin trade"). Hands-on, not video.
**Inputs.** `{ tutorial_slug: string }`
**Outputs.** `{ steps_completed, badge_earned? }`
**Pricing.** Free (funnel skill).
**Categories.** `education`, `tutorial`
**Tags.** `[tutorial, learn, hands-on]`
**Status.** 🟡 — needs a tutorials registry + step-state table.

### `quiz-generator`
**Pitch.** Generates a quiz from a topic + grades attempts. Useful for self-testing or running cohort-based learning.
**Inputs.** `{ topic: string, n_questions: number, difficulty?: "easy"|"medium"|"hard" }`
**Outputs.** `{ quiz_id, score?: number }`
**Pricing.** 0.3 NEAR per quiz.
**Categories.** `education`, `quiz`
**Tags.** `[quiz, learn, test]`
**Status.** 🟢 — pure LLM with grading rubric.

### `learning-path-builder`
**Pitch.** Builds a stepped learning path for a topic (e.g. "MEV from zero to running a searcher in 6 weeks"). Mixes posts, papers, videos, hands-on tasks.
**Inputs.** `{ topic: string, target_weeks: number, current_level?: string }`
**Outputs.** `{ path: [{ week, materials, tasks }] }`
**Pricing.** 2 NEAR per path.
**Categories.** `education`, `path`
**Tags.** `[path, curriculum, learn]`
**Status.** 🟢 — LLM with curated source registry.

### `certification-issuer`
**Pitch.** Issues an on-chain badge after passing a curriculum (NEAR NFT). Resume-line for crypto skills that's verifiable.
**Inputs.** `{ curriculum_id: string, recipient: string }`
**Outputs.** `{ nft_token_id }`
**Pricing.** 3 NEAR per cert.
**Categories.** `education`, `certification`, `nft`
**Tags.** `[cert, badge, nft]`
**Status.** 🟡 — needs a cert NFT contract template.

### `flashcard-builder`
**Pitch.** Turns a topic into spaced-repetition flashcards (Anki-style export or in-app review). Bridge from "I read about it once" to "I actually remember it."
**Inputs.** `{ topic: string, n_cards: number }`
**Outputs.** `{ deck_url, anki_export_url? }`
**Pricing.** 0.5 NEAR per deck.
**Categories.** `education`, `flashcards`
**Tags.** `[flashcards, anki, srs]`
**Status.** 🟢 — LLM + JSON export.

### `concept-explainer`
**Pitch.** Explains a crypto concept at a chosen depth (ELI5 / intermediate / expert) with citations. Beats single-depth explainers — meets you where you are.
**Inputs.** `{ concept: string, depth: "eli5"|"intermediate"|"expert" }`
**Outputs.** `{ explanation, citations: string[] }`
**Pricing.** 0.1 NEAR per query.
**Categories.** `education`, `explainer`
**Tags.** `[explain, depth, learn]`
**Status.** 🟢 — LLM + curated citations.

### `paper-summarizer`
**Pitch.** Summarizes academic papers / whitepapers / yellow papers. Different from `content-thread-from-url` (v1) — paper-specific structure (abstract, claim, evidence, limitations).
**Inputs.** `{ paper_url: string }`
**Outputs.** `{ abstract_tldr, key_claims, methodology, limitations }`
**Pricing.** 0.5 NEAR per paper.
**Categories.** `education`, `research`
**Tags.** `[paper, summarize, academic]`
**Status.** 🟢 — fetch + LLM.

### `study-group-coordinator`
**Pitch.** Schedules + runs a study group around a topic. Manages syllabus, weekly meetings (rooms), homework (mini-quizzes), and progress.
**Inputs.** `{ topic: string, members: string[], weeks: number }`
**Outputs.** `{ syllabus, meetings_scheduled, completion_pct }`
**Pricing.** 5 NEAR/month per group.
**Categories.** `education`, `community`
**Tags.** `[study, group, coordinator]`
**Status.** 🟢 — composite of rooms + DMs + quiz.

### `glossary-extender`
**Pitch.** Auto-extends your personal glossary as new terms appear in feed/papers you read. Stops the "what's a SBT?" lookup tax — you build a portable cheat sheet over time.
**Inputs.** `{ source_streams: string[] }`
**Outputs.** `{ new_terms: [{ term, defn, source }] }`
**Pricing.** 2 NEAR/month.
**Categories.** `education`, `glossary`
**Tags.** `[glossary, terms, learn]`
**Status.** 🟢 — feed reads + LLM definition.

### `prerequisite-mapper`
**Pitch.** Maps prerequisite concepts before tackling a hard topic ("to understand restaking, you should grok staking, slashing, and AVS"). Stops "I read it but it didn't click" frustration.
**Inputs.** `{ target_topic: string, your_known: string[] }`
**Outputs.** `{ prereqs: string[], gap_topics: string[] }`
**Pricing.** 0.3 NEAR per query.
**Categories.** `education`, `path`
**Tags.** `[prereq, map, learn]`
**Status.** 🟢 — LLM with concept graph.

---

## 13. Document & PDF tools (12 skills)

### `pdf-extractor`
**Pitch.** Extracts text + tables from a PDF. Beats raw `pdftotext` because it handles multi-column layouts and table structure.
**Inputs.** `{ pdf_url: string }`
**Outputs.** `{ text, tables: object[] }`
**Pricing.** 0.2 NEAR per PDF.
**Categories.** `documents`, `extraction`
**Tags.** `[pdf, extract]`
**Status.** 🟡 — needs a PDF-extract worker (pdf.js / pdfplumber).

### `pdf-summarizer`
**Pitch.** Multi-page PDF → 1-pager TL;DR with section-by-section abstracts. For everything that lands in your inbox marked "read this 40-pager."
**Inputs.** `{ pdf_url: string, target_words?: number }`
**Outputs.** `{ summary, section_abstracts: string[] }`
**Pricing.** 0.5 NEAR per PDF.
**Categories.** `documents`, `summarize`
**Tags.** `[pdf, summary, longform]`
**Status.** 🟡 — depends on `pdf-extractor`.

### `pdf-redactor`
**Pitch.** Redacts PII from a PDF before sharing (names / addresses / SSN / wallet IDs). Returns a redacted PDF — original stays with you.
**Inputs.** `{ pdf_url: string, redaction_rules: string[] }`
**Outputs.** `{ redacted_pdf_url, redactions_count }`
**Pricing.** 1 NEAR per PDF.
**Categories.** `documents`, `privacy`
**Tags.** `[redact, pii, privacy]`
**Status.** 🟡 — PDF write library + named-entity recognition.

### `contract-clause-finder`
**Pitch.** Finds specific clauses in a legal contract PDF (termination, liability, assignment, IP). Skips the 60-page read when you only care about clause 11(b).
**Inputs.** `{ pdf_url: string, clause_kinds: string[] }`
**Outputs.** `{ clauses: [{ kind, text, page }] }`
**Pricing.** 0.5 NEAR per find.
**Categories.** `documents`, `legal`
**Tags.** `[clause, contract, legal]`
**Status.** 🟡 — depends on `pdf-extractor`.

### `signature-status-tracker`
**Pitch.** Tracks e-signature flows across counterparties (DocuSign / HelloSign / Dropbox Sign). Surfaces "who hasn't signed yet" + auto-nudges them.
**Inputs.** `{ envelope_id: string, provider: "docusign"|"hellosign" }`
**Outputs.** `{ signers: [{ email, status }], pending: int }`
**Pricing.** 2 NEAR/month per active envelope.
**Categories.** `documents`, `signatures`
**Tags.** `[esign, docusign, track]`
**Status.** 🟡 — DocuSign/HelloSign API.

### `whitepaper-extractor`
**Pitch.** Pulls tokenomics + claims from a project whitepaper into structured fields. Different from `paper-summarizer` — purpose-built for crypto whitepapers (token-supply, vesting, mint authority).
**Inputs.** `{ pdf_or_url: string }`
**Outputs.** `{ token: { name, supply, vesting }, claims: string[] }`
**Pricing.** 1 NEAR per whitepaper.
**Categories.** `documents`, `research`
**Tags.** `[whitepaper, extract, tokenomics]`
**Status.** 🟡 — depends on `pdf-extractor`.

### `legal-doc-comparator`
**Pitch.** Diffs two versions of a legal doc with semantic awareness (catches "wholly" → "principally" subtly weakening a clause). Beyond textual diff.
**Inputs.** `{ doc_a_url: string, doc_b_url: string }`
**Outputs.** `{ semantic_changes: [{ section, change_kind }] }`
**Pricing.** 2 NEAR per comparison.
**Categories.** `documents`, `legal`
**Tags.** `[diff, legal, semantic]`
**Status.** 🟡 — depends on `pdf-extractor`.

### `pdf-translator`
**Pitch.** Translates a PDF preserving layout (tables, columns, section structure). The "I need this Spanish whitepaper in English without losing the tokenomics table" surface.
**Inputs.** `{ pdf_url: string, target_lang: string }`
**Outputs.** `{ translated_pdf_url }`
**Pricing.** 2 NEAR per PDF.
**Categories.** `documents`, `i18n`
**Tags.** `[translate, pdf, layout]`
**Status.** 🟡 — depends on `pdf-extractor` + PDF write.

### `pdf-form-filler`
**Pitch.** Fills PDF forms from structured input. Useful for tax forms, KYC, partnership applications.
**Inputs.** `{ pdf_form_url: string, field_values: object }`
**Outputs.** `{ filled_pdf_url }`
**Pricing.** 0.5 NEAR per fill.
**Categories.** `documents`, `forms`
**Tags.** `[form, fill, pdf]`
**Status.** 🟡 — PDF form library.

### `image-pdf-ocr`
**Pitch.** OCRs a scanned PDF to selectable text. Different from `pdf-extractor` (text-PDF) — purpose-built for image-PDFs from scanners.
**Inputs.** `{ pdf_url: string }`
**Outputs.** `{ ocr_text, confidence_pct }`
**Pricing.** 1 NEAR per OCR.
**Categories.** `documents`, `ocr`
**Tags.** `[ocr, scan, pdf]`
**Status.** 🟡 — Tesseract worker or hosted OCR API.

### `pdf-citation-extractor`
**Pitch.** Extracts citations from a paper + verifies links resolve. Catches the "cited paper 404s" / "URL points to a domain-squatter" issues.
**Inputs.** `{ pdf_url: string }`
**Outputs.** `{ citations: [{ ref, url, status }] }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `documents`, `research`
**Tags.** `[citations, verify, paper]`
**Status.** 🟡 — depends on `pdf-extractor`.

### `terms-changes-monitor`
**Pitch.** Monitors a project's terms-of-service / privacy policy for changes. Diffs week-over-week. Catches the "they quietly added a 5% transaction fee" stunt.
**Inputs.** `{ urls: string[], cadence: "daily"|"weekly" }`
**Outputs.** `{ changes: [{ url, diff_summary, at }] }`
**Pricing.** 3 NEAR/month.
**Categories.** `documents`, `monitoring`, `legal`
**Tags.** `[tos, monitor, diff]`
**Status.** 🟢 — fetch + diff + LLM summary.

---

## 14. Sales & outreach automation (14 skills)

### `prospect-list-builder`
**Pitch.** Builds a list of relevant prospects from public AZUKA data (verified posters in a niche, NFT-holder cohorts, recent NewsCoin creators). Different from generic scrapers — cryptonative-only audience.
**Inputs.** `{ filters: object, max_count: number }`
**Outputs.** `{ prospects: [{ wallet, handle, why }] }`
**Pricing.** 1 NEAR per 100 prospects.
**Categories.** `sales`, `prospecting`
**Tags.** `[prospect, list, b2b]`
**Status.** 🟢 — composite of feed/rooms/newscoin reads.

### `cold-outreach-drafter`
**Pitch.** Drafts personalized cold messages from prospect data. Notes the specific posts/holdings driving relevance — beats "Dear Sir/Madam, I noticed you're in crypto."
**Inputs.** `{ prospect_wallet: string, offer: string }`
**Outputs.** `{ draft, personalization_signals: string[] }`
**Pricing.** 0.3 NEAR per draft.
**Categories.** `sales`, `content`
**Tags.** `[cold, outreach, draft]`
**Status.** 🟢 — feed reads + LLM.

### `follow-up-scheduler`
**Pitch.** Auto-follow-up after N days of no reply with progressive escalation (gentle → reminder → "moving on"). Different from v1's `dm-followup-reminder` — outreach-flow specific, not personal.
**Inputs.** `{ prospect_wallet: string, sequence: object[] }`
**Outputs.** `{ followups_sent }`
**Pricing.** 4 NEAR/month.
**Categories.** `sales`, `automation`
**Tags.** `[followup, sequence, sales]`
**Status.** 🟢 — DM send + automation cron.

### `deal-stage-tracker`
**Pitch.** Tracks every active deal's stage in a kanban (intro → discovery → proposal → close). The CRM you'd build for yourself if you had a weekend.
**Inputs.** `{ }`
**Outputs.** `{ deals: [{ counterparty, stage, last_activity, value }] }`
**Pricing.** 5 NEAR/month.
**Categories.** `sales`, `crm`
**Tags.** `[crm, kanban, deal]`
**Status.** 🟡 — needs a `deals` table; UI surface.

### `intro-broker`
**Pitch.** Brokers warm intros via your network's known overlaps (mutual followers / co-attended rooms / shared NFT holders). Beats "do you know anyone at X?" guesswork.
**Inputs.** `{ target_company_or_wallet: string }`
**Outputs.** `{ paths: [{ via, strength, sample_post }] }`
**Pricing.** 2 NEAR per intro request.
**Categories.** `sales`, `network`
**Tags.** `[intro, network, sales]`
**Status.** 🟢 — feed/rooms graph reads.

### `meeting-prep-pack`
**Pitch.** Generates a one-pager prep doc per scheduled call (counterparty's last posts, recent moves, mutual contacts, bargaining levers). Different from v1's `meeting-prep-brief` — sales-flavored, not generic.
**Inputs.** `{ counterparty_wallet: string, meeting_topic: string }`
**Outputs.** `{ prep_pack_url }`
**Pricing.** 1 NEAR per prep.
**Categories.** `sales`, `prep`
**Tags.** `[prep, sales, meeting]`
**Status.** 🟢 — composite reads.

### `proposal-drafter`
**Pitch.** Drafts a service proposal from inputs (scope, terms, fee). Tuned for crypto-native engagements (skill builds, contract audits, governance consulting).
**Inputs.** `{ scope: string, terms: object, fee_near: number }`
**Outputs.** `{ proposal_pdf_url }`
**Pricing.** 1 NEAR per proposal.
**Categories.** `sales`, `documents`
**Tags.** `[proposal, draft, sales]`
**Status.** 🟢 — LLM + PDF render.

### `rfp-responder`
**Pitch.** Responds to RFPs with tailored sections from your past proposals (case studies, team bios, methodology). Saves the cut-and-paste-ten-RFPs evening.
**Inputs.** `{ rfp_url: string, your_template_id: string }`
**Outputs.** `{ response_pdf_url, completion_pct }`
**Pricing.** 5 NEAR per RFP.
**Categories.** `sales`, `documents`
**Tags.** `[rfp, response, draft]`
**Status.** 🟡 — needs `proposal_template` storage.

### `email-sequence-runner`
**Pitch.** Multi-step email sequences with branching ("if reply → stop"; "if click → branch B"). Email outside AZUKA via your existing mailer (Mailgun/SendGrid).
**Inputs.** `{ list_id: string, sequence: object[], mailer_creds: object }`
**Outputs.** `{ delivered, opened, replied }`
**Pricing.** 6 NEAR/month.
**Categories.** `sales`, `email`, `automation`
**Tags.** `[email, sequence, drip]`
**Status.** 🟡 — Mailgun/SendGrid API.

### `lead-scorer`
**Pitch.** Scores inbound leads on fit (do they match ICP) + intent (recent activity signals). Stops the "follow up on every DM" trap.
**Inputs.** `{ icp_profile: object, lead_wallet: string }`
**Outputs.** `{ fit_score, intent_score, total }`
**Pricing.** 0.3 NEAR per scoring.
**Categories.** `sales`, `analytics`
**Tags.** `[lead, score, fit]`
**Status.** 🟢 — composite reads + LLM.

### `conversation-summary-pusher`
**Pitch.** Pushes call summaries to a CRM (HubSpot / Pipedrive / Salesforce). Saves the "I'll write the call notes after" lie.
**Inputs.** `{ call_recording_url: string, crm: "hubspot"|"pipedrive"|"salesforce" }`
**Outputs.** `{ summary, crm_record_url }`
**Pricing.** 2 NEAR per push.
**Categories.** `sales`, `crm`, `integration`
**Tags.** `[crm, summary, push]`
**Status.** 🟡 — CRM API + ASR (depends on transcription worker).

### `competitor-mention-tracker`
**Pitch.** Tracks competitor mentions in target accounts ("prospect_X tweeted about competitor_Y"). Powers "they're shopping" outreach moments.
**Inputs.** `{ targets: string[], competitors: string[] }`
**Outputs.** `{ events: [{ target, competitor, post_id, at }] }`
**Pricing.** 5 NEAR/month.
**Categories.** `sales`, `intel`, `competitive`
**Tags.** `[competitor, mention, intel]`
**Status.** 🟢 — feed/Nitter polled.

### `pricing-quote-generator`
**Pitch.** Generates quotes from a price book + customer profile (volume tier, region, urgency). Less "depends" → more "send the PDF in 4 minutes."
**Inputs.** `{ pricebook_id: string, customer: object }`
**Outputs.** `{ quote_pdf_url, total_usd }`
**Pricing.** 0.5 NEAR per quote.
**Categories.** `sales`, `pricing`
**Tags.** `[quote, pricebook, sales]`
**Status.** 🟡 — needs a `pricebook` table.

### `customer-renewal-tracker`
**Pitch.** Tracks renewal dates + auto-prepares the renewal pitch (usage stats, value delivered, suggested upgrade path). Renewals are the highest-ROI sales motion most teams under-invest in.
**Inputs.** `{ subscription_list: object[] }`
**Outputs.** `{ upcoming: [{ customer, renewal_date, pitch_draft }] }`
**Pricing.** 4 NEAR/month.
**Categories.** `sales`, `renewals`
**Tags.** `[renewal, retention, pitch]`
**Status.** 🟡 — needs a `subscriptions` table.

---

## 15. Personal finance (cross-fiat) (12 skills)

### `budget-reconciler`
**Pitch.** Reconciles fiat bank statement against crypto cash flows so you have one ledger, not two parallel mysteries. Imports CSV from any major bank.
**Inputs.** `{ bank_csv_url: string, wallets: string[], month: string }`
**Outputs.** `{ matched, unmatched, ledger_url }`
**Pricing.** 4 NEAR per month reconciled.
**Categories.** `personal-finance`, `accounting`
**Tags.** `[budget, reconcile, fiat]`
**Status.** 🟢 — CSV parse + on-chain reads + matching heuristic.

### `expense-classifier`
**Pitch.** Auto-classifies transactions by category (rent / food / SaaS / fee / on-chain trade). Different from generic budgeting apps — knows about gas/bridge/staking categories.
**Inputs.** `{ transactions: object[] }`
**Outputs.** `{ classified: [{ tx, category }] }`
**Pricing.** 0.05 NEAR per 100 tx.
**Categories.** `personal-finance`, `classification`
**Tags.** `[classify, expense, category]`
**Status.** 🟢 — LLM + heuristic.

### `savings-goal-tracker`
**Pitch.** Tracks multi-account savings goal progress ("save 5 NEAR/week into stables"). Pings on miss + suggests adjustments.
**Inputs.** `{ goals: [{ label, target, deadline, source_wallet }] }`
**Outputs.** `{ progress: [{ goal, pct, on_track: bool }] }`
**Pricing.** 1 NEAR/month.
**Categories.** `personal-finance`, `goals`
**Tags.** `[savings, goal, tracker]`
**Status.** 🟢 — wallet balance polling.

### `recurring-charge-finder`
**Pitch.** Finds recurring fiat + on-chain charges; surfaces forgotten subs (the "I'm paying for $25/month for a service I haven't opened in 6 months" reveal).
**Inputs.** `{ bank_csv_url?: string, wallets?: string[], lookback_months?: number }`
**Outputs.** `{ recurring: [{ name, amount, cadence, last_use? }] }`
**Pricing.** 2 NEAR per scan.
**Categories.** `personal-finance`, `subscriptions`
**Tags.** `[recurring, sub, find]`
**Status.** 🟢 — periodicity detection + LLM naming.

### `currency-pnl`
**Pitch.** Computes PnL in your home fiat currency from a multi-currency portfolio (NEAR + USDC + ETH + BTC + EUR cash). One number that's actually meaningful to you.
**Inputs.** `{ wallets: string[], home_currency: "USD"|"EUR"|"GBP"|"JPY", period: string }`
**Outputs.** `{ pnl_home, by_asset }`
**Pricing.** 1 NEAR per report.
**Categories.** `personal-finance`, `pnl`
**Tags.** `[pnl, fx, multi-currency]`
**Status.** 🟢 — wallet reads + FX rates.

### `monthly-burn-rate`
**Pitch.** Computes personal burn rate + runway from bank + on-chain spend. Honest number for "how long can I last if income stopped today."
**Inputs.** `{ bank_csv_url?: string, wallets?: string[] }`
**Outputs.** `{ monthly_burn_usd, current_assets_usd, runway_months }`
**Pricing.** 0.5 NEAR per check.
**Categories.** `personal-finance`, `runway`
**Tags.** `[burn, runway, personal]`
**Status.** 🟢 — composite reads.

### `bill-pay-scheduler`
**Pitch.** Schedules recurring bill payments via stable. Useful for crypto-native creators paying contractors monthly.
**Inputs.** `{ bills: [{ payee, amount, asset, day_of_month }] }`
**Outputs.** `{ payments_scheduled, last_paid_at }`
**Pricing.** 2 NEAR setup, 0.05 NEAR per payment.
**Categories.** `personal-finance`, `payments`, `automation`
**Tags.** `[billpay, recurring, automation]`
**Status.** 🟢 — automation cron + ft_transfer.

### `cash-flow-forecaster`
**Pitch.** Forecasts 30/60/90 day cash flow given recurring commitments, scheduled income (vests/grants), and known one-offs.
**Inputs.** `{ wallets: string[], known_inflows: object[], known_outflows: object[] }`
**Outputs.** `{ forecast: [{ date, balance_projection }] }`
**Pricing.** 1 NEAR per forecast.
**Categories.** `personal-finance`, `forecast`
**Tags.** `[cashflow, forecast]`
**Status.** 🟢 — math + balance reads.

### `subscription-killer`
**Pitch.** Identifies low-use subs + drafts cancellation requests (email or in-app). Doesn't auto-cancel — produces the email + login URLs.
**Inputs.** `{ recurring_charges: object[] }`
**Outputs.** `{ kill_drafts: [{ sub, draft, login_url }] }`
**Pricing.** 1 NEAR per scan.
**Categories.** `personal-finance`, `subscriptions`
**Tags.** `[cancel, sub, kill]`
**Status.** 🟢 — LLM drafting.

### `tax-set-aside`
**Pitch.** Auto-set-aside an estimated tax % (your config) into a separate wallet on every realized gain. The "don't spend the IRS's money" forcing function.
**Inputs.** `{ tax_pct: number, set_aside_wallet: string }`
**Outputs.** `{ set_aside_total, transactions_intercepted: int }`
**Pricing.** 4 NEAR setup, 0.05 NEAR per set-aside.
**Categories.** `personal-finance`, `tax`, `automation`
**Tags.** `[tax, set-aside, discipline]`
**Status.** 🟡 — needs trade-event hook to intercept gains pre-spend.

### `personal-net-worth-statement`
**Pitch.** Periodic statement of your assets + liabilities (PCM-style). Includes illiquid positions, vested-but-unclaimed, debts. Saves the year-end "where do I stand?" night.
**Inputs.** `{ wallets: string[], illiquid_overrides?: object, debts?: object[] }`
**Outputs.** `{ statement_pdf_url, net_worth }`
**Pricing.** 2 NEAR per statement.
**Categories.** `personal-finance`, `reporting`
**Tags.** `[networth, statement]`
**Status.** 🟢 — composite reads + PDF.

### `inheritance-doc-bundler`
**Pitch.** Assembles an emergency bundle for a trusted contact: recovery instructions, key locations (encrypted), trustee map, and a clear "what to do" doc. Stored encrypted; released only on dead-man trigger.
**Inputs.** `{ trustees: string[], dead_man_period_days: number }`
**Outputs.** `{ bundle_id, last_check_in_at }`
**Pricing.** 5 NEAR setup, 1 NEAR/month.
**Categories.** `personal-finance`, `legacy`, `security`
**Tags.** `[inheritance, deadman, legacy]`
**Status.** 🔴 — needs an encrypted-storage + dead-man-switch contract template (no native primitive on AZUKA today).

---

## Appendix — items needing platform work

The 🔴 items in v2 needing substantial new platform capability:

- `recovery-circle-coordinator` (cat. 9) — first-class social-recovery contract.
- `inheritance-doc-bundler` (cat. 15) — encrypted storage + dead-man-switch contract.

🟡 items each name their missing piece in-line. The recurring gaps:

- **External API integrations** (Notion, Airtable, Slack, Discord, Etherscan, Snapshot, Tally, Chainalysis, Token Unlocks, Crunchbase, DefiLlama yields, GitHub) — can be wrapped per-skill via author-hosted HTTP runners, but they're only first-class once `.env.example` lists them.
- **PDF / OCR worker** — many doc-tools depend on a shared extraction worker.
- **Multi-chain price + holder index** — research, NFT, tax skills all want this.
- **Small platform tables** — `agent_kv`, `community_tickets`, `deals`, `subscriptions`, `pricebook`, `proposal_template`, `tutorials`, etc.
