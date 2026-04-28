// backend/services/skills/detect_drain.js
//
// Phase 10 — Wallet Watch Kit, Verifier role.
//
// Pure heuristic classifier. Given the output of `watch_balance` plus
// optional context (recent destinations, known destinations the owner
// has interacted with before, configurable threshold), decides whether
// the observed delta looks like a drain. No LLM, no I/O.
//
// Heuristics:
//   • absolute outflow ≥ alert_threshold_yocto   → reason "threshold_exceeded"
//   • outflow / prev_balance ≥ 20 % (and prev > 1 NEAR floor)
//                                                → reason "balance_drop_pct"
//   • recent_destinations contains an account
//     not in known_destinations                  → reason "new_destination"
//
// `is_drain` is true if any reason fires. Severity is low / medium /
// high based on how many reasons stacked.

const ONE_NEAR_YOCTO     = 1_000_000_000_000_000_000_000_000n; // 1e24
const FLOOR_FOR_PCT_RULE = ONE_NEAR_YOCTO; // skip pct rule below 1 NEAR — noisy at small balances
const PCT_THRESHOLD      = 20n;            // 20 percent

function bigOrZero(value) {
  if (value == null) return 0n;
  try { return BigInt(value); } catch { return 0n; }
}

function classifySeverity(reasons) {
  if (reasons.length >= 2) return "high";
  if (reasons.length === 1) return "medium";
  return "low";
}

module.exports = {
  id: "detect_drain",
  manifest: {
    title:   "Drain heuristic",
    summary: "Classifies whether a balance reading looks like a wallet drain based on absolute, relative, and destination heuristics.",
    params: [
      { key: "balance_yocto",          type: "string", hint: "Current balance in yoctoNEAR" },
      { key: "prev_balance_yocto",     type: "string", hint: "Previous balance in yoctoNEAR" },
      { key: "alert_threshold_yocto",  type: "string", default: "1000000000000000000000000", hint: "Absolute outflow that always trips the alarm (default 1 NEAR)" },
      { key: "recent_destinations",    type: "string-list", default: [], hint: "Destination accounts the watched address sent to since the last poll" },
      { key: "known_destinations",     type: "string-list", default: [], hint: "Destinations the owner has interacted with before — drain heuristic ignores these" },
    ],
  },
  async execute({ params = {} }) {
    const cur  = bigOrZero(params.balance_yocto);
    const prev = bigOrZero(params.prev_balance_yocto);
    const thr  = bigOrZero(params.alert_threshold_yocto || "1000000000000000000000000");

    const outflow = prev > cur ? prev - cur : 0n;
    const reasons = [];

    if (outflow >= thr && thr > 0n) {
      reasons.push({
        code: "threshold_exceeded",
        outflow_yocto: outflow.toString(),
        threshold_yocto: thr.toString(),
      });
    }

    if (prev >= FLOOR_FOR_PCT_RULE && outflow > 0n) {
      const pct = (outflow * 100n) / prev;
      if (pct >= PCT_THRESHOLD) {
        reasons.push({
          code: "balance_drop_pct",
          drop_pct: Number(pct),
        });
      }
    }

    const recent = Array.isArray(params.recent_destinations) ? params.recent_destinations : [];
    const known  = new Set((Array.isArray(params.known_destinations) ? params.known_destinations : []).map(String));
    const novel  = recent.map(String).filter((d) => d && !known.has(d));
    if (novel.length > 0) {
      reasons.push({ code: "new_destination", destinations: novel });
    }

    const is_drain = reasons.length > 0;
    return {
      is_drain,
      severity: classifySeverity(reasons),
      outflow_yocto: outflow.toString(),
      reasons,
    };
  },
};
