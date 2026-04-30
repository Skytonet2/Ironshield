// backend/services/ironguide/steps.js
//
// Deterministic step machine for the AZUKA Guide concierge. Replaces
// the prior LLM-driven free-form interview, which:
//   1. Sometimes ignored "one question at a time" and dumped a wall of
//      text instead.
//   2. Had no structured options — users had to type every answer.
//   3. Didn't ask country up front, which is the highest-signal field
//      for routing to the right Kit (Realtor / Car Sales depend on
//      regional connectors like Jiji that are NG-specific).
//
// Each step returns:
//   { id, text, options: [{value, label}] | null, allow_other: bool }
//
// `options: null` means the step expects a free-text answer (e.g. a
// wallet address or a person's name). `allow_other: true` lets the
// user bypass the chip list and type a custom answer; the frontend
// renders an "Or type yours…" input below the chips, the bot accepts
// any DM as the answer.
//
// `next` is either a constant step id or a function `(answer, answers)
// → nextStepId`. `recommend` is the terminal pseudo-step the service
// detects to switch into LLM-driven kit-picking mode.

const STEPS = {
  // ── 1. Country ───────────────────────────────────────────────────
  // Top of every flow. Drives connector availability + classifier
  // hints. We keep the visible list short (top 7 + Other) so the
  // chip row stays readable; less common countries fall through to
  // free text via "Other".
  country: {
    id: "country",
    text: "First — where are you based?",
    options: [
      { value: "ng",    label: "🇳🇬 Nigeria" },
      { value: "ke",    label: "🇰🇪 Kenya" },
      { value: "gh",    label: "🇬🇭 Ghana" },
      { value: "za",    label: "🇿🇦 South Africa" },
      { value: "us",    label: "🇺🇸 United States" },
      { value: "gb",    label: "🇬🇧 United Kingdom" },
      { value: "eu",    label: "🇪🇺 Europe (other)" },
      { value: "other", label: "Other (I'll type)" },
    ],
    allow_other: true,
    next: () => "category",
  },

  // ── 2. Category ──────────────────────────────────────────────────
  // The branching switch. Each option routes to a different sub-tree
  // of follow-up questions. "Other" lets the user describe in plain
  // language; we then run the classifier on the description.
  category: {
    id: "category",
    text: "What kind of work would you like an agent to help with?",
    options: [
      { value: "sell",             label: "🏷️ Sell something (car, property, service)" },
      { value: "find_work",        label: "💼 Find me work or clients" },
      { value: "watch_wallet",     label: "🛡️ Watch a crypto wallet for me" },
      { value: "background_check", label: "🔎 Run a background check" },
      { value: "other",            label: "Something else (I'll describe it)" },
    ],
    allow_other: true,
    next: (answer) => {
      switch (answer) {
        case "sell":             return "sell_item";
        case "find_work":        return "work_type";
        case "watch_wallet":     return "wallet_address";
        case "background_check": return "bg_subject";
        default:                 return "free_describe";
      }
    },
  },

  // ── 3a. Sell → Item ──────────────────────────────────────────────
  sell_item: {
    id: "sell_item",
    text: "What are you selling?",
    options: [
      { value: "car",      label: "🚗 A car" },
      { value: "property", label: "🏠 Property (rent or sale)" },
      { value: "service",  label: "🛠️ A service (freelance / consulting)" },
      { value: "product",  label: "📦 A product / item" },
      { value: "other",    label: "Something else" },
    ],
    allow_other: true,
    next: () => "sell_price",
  },

  sell_price: {
    id: "sell_price",
    text: "What's your asking price? (just the number is fine — e.g. 5m, $300, ₦15M)",
    options: null,
    allow_other: true,
    next: () => "budget_window",
  },

  // ── 3b. Find work → Type ─────────────────────────────────────────
  work_type: {
    id: "work_type",
    text: "What kind of work?",
    options: [
      { value: "freelance", label: "💻 Freelance gigs (clients to take on)" },
      { value: "job",       label: "📨 Full-time job (companies hiring)" },
      { value: "leads",     label: "📈 Sales leads / prospects" },
      { value: "other",     label: "Something else" },
    ],
    allow_other: true,
    next: () => "skills_or_role",
  },

  skills_or_role: {
    id: "skills_or_role",
    text: "What's your role or main skill? (e.g. 'senior backend engineer', 'logo designer', 'real estate agent')",
    options: null,
    allow_other: true,
    next: () => "budget_window",
  },

  // ── 3c. Watch wallet → Address ───────────────────────────────────
  wallet_address: {
    id: "wallet_address",
    text: "Paste the wallet address you want me to watch (NEAR, EVM, or Solana).",
    options: null,
    allow_other: true,
    next: () => "recommend",
  },

  // ── 3d. Background check → Subject ───────────────────────────────
  bg_subject: {
    id: "bg_subject",
    text: "Who or what should I check? (a name, a handle on X / Telegram, a company)",
    options: null,
    allow_other: true,
    next: () => "recommend",
  },

  // ── 3e. Other → Free describe ────────────────────────────────────
  free_describe: {
    id: "free_describe",
    text: "Tell me in your own words what you want an agent to do.",
    options: null,
    allow_other: true,
    next: () => "budget_window",
  },

  // ── 4. Budget window ─────────────────────────────────────────────
  // Coarse buckets; the kit-picker uses this to filter premium /
  // staked-free Kits. Keep the language plain — "free" not "tier 0".
  budget_window: {
    id: "budget_window",
    text: "How much are you willing to spend on the agent itself per month?",
    options: [
      { value: "free", label: "Free only" },
      { value: "low",  label: "Up to $5 / mo" },
      { value: "mid",  label: "$5 – $25 / mo" },
      { value: "high", label: "$25+ / mo" },
    ],
    allow_other: false,
    next: () => "recommend",
  },

  // Terminal pseudo-step. Service detects this and switches into
  // LLM-driven kit-picking mode using the answers collected so far.
  recommend: {
    id: "recommend",
    terminal: true,
  },
};

const INITIAL_STEP = "country";

/** Get a step definition by id. Throws on unknown ids — preferable to
 *  silently routing to a default, since a missing branch is a bug we
 *  want to surface in tests. */
function getStep(id) {
  const step = STEPS[id];
  if (!step) throw new Error(`Unknown ironguide step: ${id}`);
  return step;
}

/** Given the current step id and the user's answer (a string — either
 *  one of the option `value`s or a free-text "other"), resolve the
 *  next step id. Pure function — exported for unit tests. */
function resolveNext(currentStepId, answer, answers = {}) {
  const step = getStep(currentStepId);
  if (step.terminal) return null;
  if (typeof step.next !== "function") {
    throw new Error(`Step ${currentStepId} has no next() resolver`);
  }
  return step.next(answer, answers);
}

/** Public-facing question shape. Strips internal fields (the next()
 *  resolver, terminal flag). The frontend / bot only need text, id,
 *  options, allow_other. */
function publicQuestion(stepId) {
  const step = getStep(stepId);
  if (step.terminal) return null;
  return {
    id:           step.id,
    text:         step.text,
    options:      step.options,
    allow_other:  Boolean(step.allow_other),
  };
}

/** Validate a user's answer against a step's option list. Returns
 *  the canonical (value, label) pair — value is what we store in
 *  answers_json, label is what we render in the chat transcript.
 *  Free-text answers ("Other") return value === answer (the raw
 *  string) and label === answer. */
function canonicalize(stepId, raw) {
  const step = getStep(stepId);
  if (step.terminal) throw new Error(`Step ${stepId} is terminal — no answer expected`);
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  if (step.options) {
    const match = step.options.find((o) => o.value === trimmed);
    if (match) return { value: match.value, label: match.label };
    if (!step.allow_other) {
      // Strict step (e.g. budget tiers) — reject unknown values so the
      // step machine can't silently drift into arbitrary buckets.
      return null;
    }
  }
  // Free-text answer (or option-with-allow-other fallthrough).
  // Cap at 240 chars — same cap missions inputs use, keeps the LLM
  // recommendation prompt bounded.
  const v = trimmed.slice(0, 240);
  return { value: v, label: v };
}

module.exports = {
  STEPS,
  INITIAL_STEP,
  getStep,
  resolveNext,
  publicQuestion,
  canonicalize,
};
