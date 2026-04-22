"use client";
// seeder — dev-only feed-event generator.
//
// When the WS backend isn't running (or isn't producing events yet),
// this pushes realistic-looking FeedEvents straight into useFeed so
// the AIO page can be designed against live-looking data. Gated on
// NODE_ENV === 'development' so production bundles dead-code-eliminate
// the schedule logic.
//
// start()/stop() are idempotent. Call start() once from the route that
// wants seeded data.

import { nanoid } from "nanoid";
import { useFeed } from "@/lib/stores/feedStore";

const IS_DEV = process.env.NODE_ENV === "development";

// Realistic-looking sample pools. Small so the feed varies but stays
// recognizable across reloads.
const SOL_TOKENS = [
  { ticker: "BONK", name: "Bonk",  mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { ticker: "WIF",  name: "dogwifhat", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { ticker: "POPCAT", name: "Popcat", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
];
const NEAR_TOKENS = [
  { ticker: "BLACKDRAGON", name: "BLACKDRAGON", address: "blackdragon.tkn.near" },
  { ticker: "NEKO", name: "Neko", address: "ftv2.nekotoken.near" },
];
const KOLS = ["@cobie", "@ansem", "@zachxbt", "@gainzy", "@icebergy_", "@0xMert_"];
const NEWS_HEADLINES = [
  "ETF inflows hit fresh weekly high as BTC reclaims 70k",
  "Ref Finance ships v2 router with 24bps default slippage",
  "NEAR validator count passes 200 in Q2",
  "Jupiter quarterly report: $88B cumulative swap volume",
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randFloat(lo, hi, dp = 4) { return Number((Math.random() * (hi - lo) + lo).toFixed(dp)); }

function caEvent() {
  const chain = pick(["sol", "near"]);
  const tok = chain === "sol" ? pick(SOL_TOKENS) : pick(NEAR_TOKENS);
  return {
    type: "ca",
    chain,
    source: "detector",
    data: {
      ticker: tok.ticker,
      address: tok.mint || tok.address,
      riskScore: Math.floor(Math.random() * 100),
      firstSeen: new Date().toISOString(),
    },
  };
}

function xEvent() {
  return {
    type: "x",
    source: pick(KOLS),
    data: {
      handle: pick(KOLS),
      text: pick([
        "another day another rotation",
        "if you're not paying attention to the new Ref pools you're early",
        "market structure says up but vibes say down",
        "sold the bottom, bought the top, classic",
      ]),
    },
  };
}

function newsEvent() {
  return { type: "news", source: "rss", data: { headline: pick(NEWS_HEADLINES) } };
}

function dexEvent() {
  const tok = pick([...SOL_TOKENS, ...NEAR_TOKENS]);
  return {
    type: "dex",
    chain: tok.mint ? "sol" : "near",
    source: "dexscreener",
    data: {
      ticker: tok.ticker,
      priceUsd: randFloat(0.0001, 3, 6),
      change5m: randFloat(-8, 12, 2),
      volume5m: Math.floor(Math.random() * 50_000),
    },
  };
}

function ironclawEvent() {
  return {
    type: "ironclaw",
    priority: "high",
    source: "ironclaw-scanner",
    data: {
      severity: pick(["low", "medium", "high"]),
      summary: pick([
        "Suspicious mint authority still live on new SPL token",
        "Honeypot pattern detected in freshly deployed BEP-20",
        "Unverified contract calling external approve",
      ]),
    },
  };
}

// Each generator runs on its own jittered interval so the feed looks
// organic rather than metronomic. The bounds match the spec's Section 10.
const SCHEDULE = [
  { gen: caEvent,       minMs:  8_000, maxMs: 25_000 },
  { gen: xEvent,        minMs:  5_000, maxMs: 15_000 },
  { gen: newsEvent,     minMs: 60_000, maxMs: 120_000 },
  { gen: dexEvent,      minMs: 20_000, maxMs: 45_000 },
  { gen: ironclawEvent, minMs: 40_000, maxMs: 90_000 },
];

let timers = [];
let running = false;

function scheduleOne(entry) {
  const { gen, minMs, maxMs } = entry;
  const delay = Math.random() * (maxMs - minMs) + minMs;
  const id = setTimeout(() => {
    if (!running) return;
    const ev = { ...gen(), id: nanoid(10), ts: Date.now() };
    useFeed.getState().push(ev);
    scheduleOne(entry);
  }, delay);
  timers.push(id);
}

export function start() {
  if (!IS_DEV) return;
  if (running) return;
  running = true;
  // Seed one of each immediately so a fresh tab isn't an empty wall
  // for 15–60s. Subsequent emissions follow the randomized schedule.
  for (const entry of SCHEDULE) {
    useFeed.getState().push({ ...entry.gen(), id: nanoid(10), ts: Date.now() });
    scheduleOne(entry);
  }
}

export function stop() {
  running = false;
  for (const id of timers) clearTimeout(id);
  timers = [];
}
