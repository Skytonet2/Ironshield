"use client";
// useImpression — tracks when a feed card crosses the "read"
// threshold (50%+ visible for ≥1s) and fires one POST to
// /api/feed/impression per (user, post, session). Matches spec §8D:
// impressions = "the card was scrolled into view and lingered for at
// least a second", not just "the card existed on the page".
//
// Dedup happens in two places: in-memory Set per tab (no double-fires
// within the session) + the server's unique (user_id, post_id,
// session_date) index in feed_post_impressions. Author views short-
// circuit client-side before we hit the network — cheaper and honest.

import { useEffect, useRef } from "react";

const SEEN = new Set(); // session-scoped: postIds already reported

const DEFAULT_OPTS = {
  thresholdRatio: 0.5,     // % of card in viewport
  dwellMs: 1000,           // how long it must stay there
};

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

async function reportImpression({ postId, viewerWallet }) {
  if (SEEN.has(postId)) return;
  SEEN.add(postId);
  try {
    // /api/feed/impression is a public route (Day 2.1): wallet identity
    // travels in the body, no signature required.
    await fetch(`${BACKEND_BASE}/api/feed/impression`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId, viewerWallet: viewerWallet || null }),
    });
  } catch {
    // Network blips are OK — we re-seen the same post on refresh and
    // the server-side unique index handles re-tries without inflating
    // the counter. Removing from SEEN lets the next successful tick
    // reattempt once.
    SEEN.delete(postId);
  }
}

/**
 * @param {object} opts
 * @param {number|string} opts.postId       — feed_posts.id
 * @param {boolean} opts.isOwn              — true = don't count (author's own view)
 * @param {string}  opts.viewerWallet       — optional, for logged-out fallback
 * @returns {React.RefObject}  attach via <div ref={ref}> on the card root
 */
export default function useImpression({ postId, isOwn = false, viewerWallet = null }) {
  const nodeRef = useRef(null);

  useEffect(() => {
    if (!nodeRef.current || postId == null || isOwn) return;
    if (SEEN.has(postId)) return;

    let dwellTimer;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= DEFAULT_OPTS.thresholdRatio) {
          // Start (or restart) the dwell timer. Re-entering cancels
          // the prior run so a brief flicker doesn't count as a seen.
          clearTimeout(dwellTimer);
          dwellTimer = setTimeout(() => {
            reportImpression({ postId, viewerWallet });
            io.disconnect();
          }, DEFAULT_OPTS.dwellMs);
        } else {
          clearTimeout(dwellTimer);
        }
      },
      { threshold: [0, DEFAULT_OPTS.thresholdRatio, 1] }
    );

    io.observe(nodeRef.current);
    return () => {
      clearTimeout(dwellTimer);
      io.disconnect();
    };
  }, [postId, isOwn, viewerWallet]);

  return nodeRef;
}
