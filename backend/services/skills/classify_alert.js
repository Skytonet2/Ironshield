// backend/services/skills/classify_alert.js
//
// Phase 10 — Wallet Watch Kit, Reporter role.
//
// Pure formatting: takes the structured output of `detect_drain` plus
// a few mission-context fields and produces a one-line headline + a
// short summary suitable for a TG message. Composes nothing fancy —
// the goal is a deterministic, testable string that the Outreach role
// (`alert_owner`) can ship as-is.

function fmtNear(yocto) {
  if (yocto == null) return null;
  try {
    const n = Number(BigInt(yocto)) / 1e24;
    if (!Number.isFinite(n)) return null;
    return `${n.toFixed(4)} NEAR`;
  } catch {
    return null;
  }
}

function reasonLabel(reason) {
  switch (reason?.code) {
    case "threshold_exceeded": return `outflow exceeded threshold (${fmtNear(reason.outflow_yocto) || reason.outflow_yocto})`;
    case "balance_drop_pct":   return `balance dropped ${reason.drop_pct}%`;
    case "new_destination":    return `funds sent to unfamiliar destination${(reason.destinations || []).length > 1 ? "s" : ""}: ${(reason.destinations || []).slice(0, 3).join(", ")}`;
    default:                   return reason?.code || "unspecified";
  }
}

module.exports = {
  id: "classify_alert",
  manifest: {
    title:   "Drain alert formatter",
    summary: "Formats a detect_drain verdict into a human-readable headline and summary for the owner alert.",
    params: [
      { key: "address",              type: "string", hint: "Watched NEAR account" },
      { key: "balance_yocto",        type: "string", hint: "Current balance in yoctoNEAR" },
      { key: "prev_balance_yocto",   type: "string", hint: "Previous balance in yoctoNEAR" },
      { key: "is_drain",             type: "boolean", hint: "Verifier verdict" },
      { key: "severity",             type: "string",  hint: "low | medium | high" },
      { key: "reasons",              type: "object-list", default: [], hint: "Reasons array from detect_drain" },
      { key: "polled_at",            type: "string", default: null, hint: "ISO timestamp from watch_balance" },
    ],
  },
  async execute({ params = {} }) {
    const address  = String(params.address || "").trim();
    const balance  = fmtNear(params.balance_yocto);
    const prev     = fmtNear(params.prev_balance_yocto);
    const reasons  = Array.isArray(params.reasons) ? params.reasons : [];
    const severity = String(params.severity || "low");
    const polledAt = params.polled_at ? String(params.polled_at) : new Date().toISOString();

    if (!params.is_drain) {
      return {
        headline: `No drain detected on ${address || "watched account"}`,
        summary:  `Balance ${balance || "unknown"} (was ${prev || "unknown"}). No heuristic tripped.`,
        severity,
        polled_at: polledAt,
      };
    }

    const headline = `Possible drain on ${address || "watched account"} — severity ${severity}`;
    const reasonLines = reasons.map((r) => `• ${reasonLabel(r)}`);
    const summaryLines = [
      `Balance now ${balance || "unknown"} (was ${prev || "unknown"}).`,
      reasonLines.length ? "Triggers:" : "No detailed reasons recorded.",
      ...reasonLines,
      `Observed at ${polledAt}.`,
    ];

    return {
      headline,
      summary: summaryLines.join("\n"),
      severity,
      polled_at: polledAt,
    };
  },
};
