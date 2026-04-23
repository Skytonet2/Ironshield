// src/lib/messageParser.js
// Parses DM bodies for on-chain primitives and trade intents so the UI
// can render them as rich inline cards instead of raw text. This is the
// "execution layer" glue: a link to an explorer isn't a link, it's a
// transaction card; a contract address isn't a hex blob, it's a token
// chip; a phrase like "buy if BTC breaks 110k" isn't just words, it's
// a pre-filled automation.
//
// Detection is deliberately conservative — false positives look worse
// than missed matches, because a mis-rendered card erases trust that
// the system understands what the user is saying.

// Structured message chips we send as embedded JSON tokens. Format:
//   [[IX:<type>:<base64url(json)>]]
// The DM layer stores these inside the encrypted payload so the card
// content is E2E encrypted like any other message body.
export const IX_PREFIX = "[[IX:";
export const IX_SUFFIX = "]]";

export const CHIP_TYPES = {
  TOKEN_SEND:    "token_send",
  PORTFOLIO:     "portfolio",
  CHART:         "chart",
  AUTOMATION:    "automation",
  CONTRACT:      "contract",
  PROPOSAL:      "proposal",
  REMINDER:      "reminder",
  WALLET_SHARE:  "wallet_share",
};

export function encodeChip(type, data) {
  const json = JSON.stringify(data);
  const b64 = typeof window !== "undefined"
    ? btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json).toString("base64");
  const safe = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${IX_PREFIX}${type}:${safe}${IX_SUFFIX}`;
}

export function decodeChip(token) {
  if (!token || !token.startsWith(IX_PREFIX) || !token.endsWith(IX_SUFFIX)) return null;
  const inner = token.slice(IX_PREFIX.length, -IX_SUFFIX.length);
  const i = inner.indexOf(":");
  if (i < 0) return null;
  const type = inner.slice(0, i);
  const b64 = inner.slice(i + 1).replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    const json = typeof window !== "undefined"
      ? decodeURIComponent(escape(atob(b64 + pad)))
      : Buffer.from(b64 + pad, "base64").toString("utf8");
    return { type, data: JSON.parse(json) };
  } catch { return null; }
}

// Split a message body into a sequence of segments: plain text, chip
// tokens (produced by encodeChip), and detected inline entities
// (addresses, tx hashes, URLs). The caller renders each segment; all
// segments in order reconstruct the original message.
//
// Order of operations:
//   1. Pull out chip tokens first so their base64 payload doesn't
//      match inline entity regexes by accident.
//   2. Walk the remaining runs and flag URLs, tx hashes, NEAR/EVM/SOL
//      addresses, and @mentions.
export function splitBody(body) {
  if (!body) return [];
  const segs = [];
  let i = 0;
  while (i < body.length) {
    const chipStart = body.indexOf(IX_PREFIX, i);
    if (chipStart < 0) {
      pushText(segs, body.slice(i));
      break;
    }
    if (chipStart > i) pushText(segs, body.slice(i, chipStart));
    const chipEnd = body.indexOf(IX_SUFFIX, chipStart);
    if (chipEnd < 0) {
      pushText(segs, body.slice(chipStart));
      break;
    }
    const token = body.slice(chipStart, chipEnd + IX_SUFFIX.length);
    const chip = decodeChip(token);
    if (chip) segs.push({ kind: "chip", ...chip });
    else pushText(segs, token); // malformed — render raw
    i = chipEnd + IX_SUFFIX.length;
  }
  return segs;
}

function pushText(segs, text) {
  if (!text) return;
  const entities = detectEntities(text);
  if (!entities.length) { segs.push({ kind: "text", text }); return; }
  let cursor = 0;
  for (const e of entities) {
    if (e.start > cursor) segs.push({ kind: "text", text: text.slice(cursor, e.start) });
    segs.push({ kind: "entity", entity: e });
    cursor = e.end;
  }
  if (cursor < text.length) segs.push({ kind: "text", text: text.slice(cursor) });
}

// Entity detectors. Each returns { start, end, type, raw, meta? } spans.
//
// Precedence: URL > tx_hash > evm_addr > sol_addr > near_account > mention.
// We scan each, then sort + dedupe overlapping spans preferring the
// higher-precedence type. This avoids "0x…" matching inside a URL path.
const URL_RE        = /(https?:\/\/[^\s<>()]+)/g;
const TX_HASH_RE    = /\b([A-HJ-NP-Za-km-z1-9]{43,88})\b/g; // base58 (NEAR + Solana tx)
const EVM_ADDR_RE   = /(\b0x[a-fA-F0-9]{40}\b)/g;
const NEAR_ACCT_RE  = /\b([a-z0-9_-]+\.(?:near|tg|testnet))\b/gi;
const MENTION_RE    = /(^|\s)(@[a-z0-9_]{2,24})\b/gi;

function detectEntities(text) {
  const found = [];
  for (const m of text.matchAll(URL_RE)) {
    found.push({ start: m.index, end: m.index + m[0].length, type: "url", raw: m[0], prec: 5 });
  }
  for (const m of text.matchAll(EVM_ADDR_RE)) {
    found.push({ start: m.index, end: m.index + m[0].length, type: "evm_addr", raw: m[0], prec: 4 });
  }
  for (const m of text.matchAll(NEAR_ACCT_RE)) {
    found.push({ start: m.index, end: m.index + m[0].length, type: "near_account", raw: m[0], prec: 3 });
  }
  // TX hash detection is noisy (matches NEAR accounts, base58 blobs).
  // Only keep base58 runs that look like NEAR/SOL tx hashes: 43–88
  // alnum chars, NOT containing a dot (so we don't eat `user.near`).
  for (const m of text.matchAll(TX_HASH_RE)) {
    const raw = m[0];
    if (raw.includes(".")) continue;
    if (raw.length < 43) continue;
    // Reject if looks like a word (has vowel patterns + spaces around)
    found.push({ start: m.index, end: m.index + raw.length, type: "tx_hash", raw, prec: 4 });
  }
  for (const m of text.matchAll(MENTION_RE)) {
    const offset = m[1].length; // leading whitespace
    found.push({
      start: m.index + offset, end: m.index + offset + m[2].length,
      type: "mention", raw: m[2], prec: 2,
    });
  }

  // Resolve overlaps: sort by start, then by prec desc, then drop any
  // entity that overlaps a higher-prec one.
  found.sort((a, b) => a.start - b.start || b.prec - a.prec);
  const kept = [];
  for (const e of found) {
    const last = kept[kept.length - 1];
    if (last && e.start < last.end) continue;
    kept.push(e);
  }
  return kept;
}

// Natural-language automation intent. Fires on phrasings like:
//   "buy if BTC breaks 110k"       · side-IF-symbol-op-value
//   "buy BTC if it breaks 110k"    · side-symbol-IF-it-op-value
//   "sell ETH when drops below 2500"
//   "short SOL when hits 300"
// Returns a structured plan the UI can show as a suggestion chip and
// pass through to /automations as a prefill.
//
// Two regex variants cover the four common English orderings. Running
// them in sequence (not as a single alternation) keeps each regex easy
// to reason about and lets us fall back from the stricter pattern.
const SIDE   = String.raw`(?<side>buy|sell|short|long)`;
const SYMBOL = String.raw`(?<symbol>[A-Za-z]{2,8})`;
const OP     = String.raw`(?<op>breaks(?:\s+above)?|hits|crosses|above|drops?\s+below|falls?\s+below|below|goes\s+above|goes\s+below)`;
const VALUE  = String.raw`\$?(?<value>\d[\d,.]*)(?<suffix>[kKmMbB]?)`;
const TRADE_INTENT_RES = [
  // Pattern A: "buy if BTC breaks 110k"
  new RegExp(String.raw`\b${SIDE}\s+(?:if|when)\s+${SYMBOL}\s+(?:it\s+)?${OP}\s+${VALUE}\b`, "i"),
  // Pattern B: "buy BTC if it breaks 110k" / "sell SOL when hits 300"
  new RegExp(String.raw`\b${SIDE}\s+${SYMBOL}\s+(?:if|when)\s+(?:it\s+)?${OP}\s+${VALUE}\b`, "i"),
];

export function detectAutomationIntent(text) {
  if (!text) return null;
  for (const re of TRADE_INTENT_RES) {
    const m = re.exec(text);
    if (!m || !m.groups) continue;
    const { side, symbol, op, value, suffix } = m.groups;
    let numeric = parseFloat(String(value).replace(/,/g, ""));
    if (!Number.isFinite(numeric)) continue;
    const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9 }[suffix] || 1;
    numeric *= mult;
    const opNorm = /break|hit|cross|above|goes\s+above/i.test(op) ? "above" : "below";
    return {
      side: side.toLowerCase(),
      symbol: symbol.toUpperCase(),
      op: opNorm,
      threshold: numeric,
      phrase: m[0],
      range: [m.index, m.index + m[0].length],
      summary: `${side.toUpperCase()} ${symbol.toUpperCase()} when price ${opNorm === "above" ? "breaks above" : "drops below"} $${formatNumber(numeric)}`,
    };
  }
  return null;
}

function formatNumber(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString("en-US");
}

// Pick a chain label for an address by shape. The wallet icon colors
// pick this up when rendering the chip.
export function classifyAddress(raw) {
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return "evm";
  if (/\.(near|tg|testnet)$/i.test(raw)) return "near";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) return "solana";
  return "unknown";
}
