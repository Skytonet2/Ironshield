// backend/services/ironguide/classifier.js
//
// Pure deterministic classifier — no LLM. Takes a transcript of user
// answers (free text) and pulls structured signal out of it:
//   - vertical : industry / domain (commerce, marketing, support, …)
//   - geo      : continent or country bucket
//   - budget   : tier (free, low, mid, high)
//   - language : ISO-639-1 code best-effort
//
// Kept dependency-free so it lives well in tests and inside the bot
// process. The IronClaw side wraps this — the LLM asks the questions,
// the classifier reads the user's answers.

const VERTICAL_KEYWORDS = {
  commerce: [
    "shopify", "woocommerce", "store", "shop", "ecommerce", "e-commerce",
    "sell", "selling", "product", "merch", "boutique", "retail",
  ],
  marketing: [
    "marketing", "ads", "campaign", "growth", "seo", "brand", "social media",
    "tiktok", "instagram", "facebook", "twitter", "x.com", "newsletter",
  ],
  support: [
    "support", "customer service", "help desk", "tickets", "faq", "complaints",
    "live chat", "whatsapp support", "zendesk",
  ],
  sales: [
    "sales", "lead", "pipeline", "outreach", "cold email", "prospecting",
    "crm", "deal", "follow-up", "follow up",
  ],
  research: [
    "research", "analyst", "report", "due diligence", "competitor", "market study",
    "investigate", "data collection",
  ],
  trading: [
    "trading", "trade", "crypto", "defi", "swap", "yield", "stake",
    "portfolio", "tokens", "altcoin", "memecoin",
  ],
  content: [
    "blog", "writer", "writing", "content", "article", "video", "podcast",
    "newsletter writer", "ghostwrite",
  ],
  ops: [
    "operations", "logistics", "shipping", "inventory", "scheduling", "calendar",
    "back office", "admin",
  ],
};

const GEO_KEYWORDS = {
  africa: ["nigeria", "kenya", "ghana", "south africa", "africa", "lagos", "accra", "naira", "cedi"],
  europe: ["europe", "germany", "france", "uk", "england", "spain", "italy", "poland", "eur", "gbp"],
  north_america: ["usa", "u.s.", "united states", "canada", "mexico", "america", "us-based"],
  south_america: ["brazil", "argentina", "colombia", "chile", "peru", "latam", "latin america"],
  asia: ["india", "indonesia", "vietnam", "thailand", "philippines", "japan", "korea", "china", "asia"],
  middle_east: ["dubai", "uae", "saudi", "egypt", "turkey", "iran", "middle east"],
  oceania: ["australia", "new zealand", "sydney", "melbourne"],
};

const BUDGET_KEYWORDS = {
  free:  ["free", "no budget", "0 ", "$0", "broke", "can't pay", "cannot pay"],
  low:   ["small", "cheap", "tight", "$5", "$10", "$20", "$50", "low budget"],
  mid:   ["$100", "$200", "$500", "moderate", "few hundred"],
  high:  ["$1000", "$5000", "enterprise", "well-funded", "venture", "no limit"],
};

const LANGUAGE_KEYWORDS = {
  en: ["english"],
  es: ["spanish", "español", "espanol"],
  fr: ["french", "français", "francais"],
  pt: ["portuguese", "português", "portugues"],
  de: ["german", "deutsch"],
  zh: ["chinese", "mandarin", "中文"],
  ar: ["arabic", "العربية"],
  hi: ["hindi", "हिन्दी"],
  ru: ["russian", "русский"],
  ja: ["japanese", "日本語"],
  ko: ["korean", "한국어"],
};

function topMatch(text, dict) {
  const lc = (text || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [key, words] of Object.entries(dict)) {
    let score = 0;
    for (const w of words) {
      if (lc.includes(w)) score += w.length; // longer match wins ties
    }
    if (score > bestScore) {
      best = key;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Classify a free-text transcript (concatenated user turns, ignore the
 * agent's questions) into structured signal. Returns an object with
 * nullable fields — callers treat null as "not yet known."
 */
function classify(transcript) {
  const text = String(transcript || "").trim();
  if (!text) {
    return { vertical: null, geo: null, budget: null, language: null };
  }
  return {
    vertical: topMatch(text, VERTICAL_KEYWORDS),
    geo:      topMatch(text, GEO_KEYWORDS),
    budget:   topMatch(text, BUDGET_KEYWORDS),
    language: topMatch(text, LANGUAGE_KEYWORDS),
  };
}

/**
 * Score a Kit row against a classification. Higher is better. Used to
 * pick the best Kit out of the catalog. Returns 0 if there's no overlap
 * at all — the caller treats 0-score as "no fit, log a kit_request."
 *
 * Scoring: exact vertical = +5, geo or budget tag overlap = +1 each.
 * Kit's `vertical` is a single string. Geo/budget come from
 * default_pricing_json hints (tags array) — best-effort, optional.
 */
function scoreKit(kit, classified) {
  if (!kit || !classified) return 0;
  let score = 0;
  if (kit.vertical && classified.vertical && kit.vertical.toLowerCase() === classified.vertical) {
    score += 5;
  }
  const tags = []
    .concat(Array.isArray(kit.tags) ? kit.tags : [])
    .concat(kit.default_pricing_json?.tags || [])
    .map((t) => String(t).toLowerCase());
  if (classified.geo && tags.includes(classified.geo)) score += 1;
  if (classified.budget && tags.includes(classified.budget)) score += 1;
  if (classified.language && tags.includes(classified.language)) score += 1;
  return score;
}

/**
 * Pick the best Kit from a list. Returns { kit, score } or null when
 * nothing scores above zero.
 */
function pickKit(kits, classified) {
  if (!Array.isArray(kits) || kits.length === 0) return null;
  let winner = null;
  let winnerScore = 0;
  for (const k of kits) {
    const s = scoreKit(k, classified);
    if (s > winnerScore) {
      winner = k;
      winnerScore = s;
    }
  }
  return winner ? { kit: winner, score: winnerScore } : null;
}

module.exports = { classify, scoreKit, pickKit };
