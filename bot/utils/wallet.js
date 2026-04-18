// bot/utils/wallet.js — wallet address parsing & detection

// NEAR named accounts: lowercase letters/digits/hyphens/underscores,
// at least 2 chars, followed by .near or .tg etc. Also hex .near implicit
// accounts are 64 hex chars.
const NEAR_NAMED = /\b([a-z0-9][a-z0-9\-_]{1,63}\.(?:near|testnet|tg|dev\-\d+))\b/i;
const NEAR_IMPLICIT = /\b([a-f0-9]{64})\b/i;
const EVM = /\b(0x[a-fA-F0-9]{40})\b/;
const SOL = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/; // base58, rough

function detectWallet(text = "") {
  if (!text) return null;
  const m1 = text.match(NEAR_NAMED);
  if (m1) return m1[1].toLowerCase();
  const m2 = text.match(EVM);
  if (m2) return m2[1].toLowerCase();
  const m3 = text.match(NEAR_IMPLICIT);
  if (m3) return m3[1].toLowerCase();
  // Only accept pure Solana-style base58 if the whole trimmed text is just that (avoid false positives)
  const trimmed = text.trim();
  if (SOL.test(trimmed) && trimmed === trimmed.match(SOL)[0]) return trimmed;
  return null;
}

function shortWallet(w = "") {
  if (!w) return "";
  return w.length > 16 ? `${w.slice(0, 8)}…${w.slice(-4)}` : w;
}

module.exports = { detectWallet, shortWallet };
