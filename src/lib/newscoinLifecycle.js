// src/lib/newscoinLifecycle.js
// Single source of truth for NewsCoin lifecycle states on the frontend.
// Must stay in sync with backend/routes/newscoin.route.js :: lifecycleFor().
//
// Lifecycle is a pure function of (mcap_usd, graduated, killed, target).
// Use bondingPct() when you already have a percentage and just need the
// label/color.

export const GRADUATION_MCAP_USD_DEFAULT = 70000;

const STATES = {
  early:      { key: "early",      label: "Early",      color: "#eab308" },
  trending:   { key: "trending",   label: "Trending",   color: "#fb923c" },
  peak:       { key: "peak",       label: "Peak",       color: "#f97316" },
  graduating: { key: "graduating", label: "Graduating", color: "#34d399" },
  graduated:  { key: "graduated",  label: "Graduated",  color: "#10b981" },
  killed:     { key: "killed",     label: "Killed",     color: "#ef4444" },
};

export function lifecycleFromPct(pct, { graduated = false, killed = false } = {}) {
  if (killed)      return STATES.killed;
  if (graduated)   return STATES.graduated;
  if (pct >= 90)   return STATES.graduating;
  if (pct >= 60)   return STATES.peak;
  if (pct >= 20)   return STATES.trending;
  return                STATES.early;
}

export function lifecycleFor(coin, target = GRADUATION_MCAP_USD_DEFAULT) {
  if (!coin) return STATES.early;
  // Honor backend-computed lifecycle if present.
  if (coin.lifecycle?.key && STATES[coin.lifecycle.key]) return STATES[coin.lifecycle.key];
  const mcap = Number(coin.mcap_usd ?? coin.mcapUsd ?? 0);
  const pct = Math.min(100, (mcap / (target || GRADUATION_MCAP_USD_DEFAULT)) * 100);
  return lifecycleFromPct(pct, { graduated: !!coin.graduated, killed: !!coin.killed });
}

export function bondingPct(coin, target = GRADUATION_MCAP_USD_DEFAULT) {
  const mcap = Number(coin?.mcap_usd ?? coin?.mcapUsd ?? 0);
  return Math.min(100, (mcap / (target || GRADUATION_MCAP_USD_DEFAULT)) * 100);
}
