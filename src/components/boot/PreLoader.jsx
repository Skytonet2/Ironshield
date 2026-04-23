"use client";
// Pre-React loader — visible on first paint, unmounted by React once
// AppShell signals it's ready.
//
// Why this component exists: the loader used to be inline JSX in
// layout.js, removed by an inline `<script>` via
// `parentNode.removeChild`. React still tracked that subtree in its
// fiber, so the next reconciliation anywhere near body threw
// `NotFoundError: Failed to execute 'insertBefore' on 'Node'` — the
// DOM parent React remembered had disappeared out from under it.
// Browser wallet extensions (MetaMask, Backpack, TronLink, Infinex,
// etc.) injecting content scripts into <body> made this more likely
// to trip, but the root cause was us fighting React's ownership of
// the tree. Now the unmount goes through `setVisible(false)` and
// React owns the removal end-to-end.

import { useEffect, useState } from "react";

export default function PreLoader() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading]   = useState(false);

  useEffect(() => {
    let alive = true;

    function checkReady() {
      if (!alive) return false;
      if (document.querySelector('[data-app-shell="ready"]')) {
        setFading(true);
        setTimeout(() => { if (alive) setVisible(false); }, 260);
        return true;
      }
      return false;
    }

    // Upfront check — the AppShell marker might already be in the DOM
    // on the first tick after hydration (static export case).
    if (checkReady()) return () => { alive = false; };

    const obs = new MutationObserver(() => {
      if (checkReady()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Safety timeout: if nothing ever signals ready (e.g. the app
    // silently failed to mount) unmount the loader anyway so the blank
    // body is at least transparent to the 12s recovery in layout.js.
    const safety = setTimeout(() => {
      if (alive && !document.querySelector('[data-app-shell="ready"]')) {
        setFading(true);
        setTimeout(() => { if (alive) setVisible(false); }, 260);
      }
    }, 15_000);

    return () => { alive = false; obs.disconnect(); clearTimeout(safety); };
  }, []);

  if (!visible) return null;

  return (
    <div
      id="ic-pre-loader"
      aria-hidden="true"
      style={{ opacity: fading ? 0 : 1, transition: "opacity .25s ease" }}
    >
      <div className="ic-wrap">
        <div className="ic-crest">
          <div className="ic-ring ic-ring-outer" />
          <div className="ic-ring" />
          <div className="ic-shield">
            <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none">
              <path
                d="M32 4 L54 10 C55.5 10.4 56.5 11.8 56.5 13.4 L56.5 32 C56.5 44.3 48 54.3 32 60 C16 54.3 7.5 44.3 7.5 32 L7.5 13.4 C7.5 11.8 8.5 10.4 10 10 Z"
                fill="#0b0e1c"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <g transform="translate(32, 34)" fill="rgba(255,255,255,0.95)">
                <rect x="-6" y="-8" width="12" height="12" rx="2.4" />
                <rect x="-4.5" y="-6" width="9" height="2.5" rx="0.8" fill="#1a1d2e" />
                <circle cx="-2.5" cy="1.2" r="1.4" fill="#1a1d2e" />
                <circle cx="2.5"  cy="1.2" r="1.4" fill="#1a1d2e" />
              </g>
            </svg>
          </div>
        </div>
        <div className="ic-brand">Iron<span>Shield</span></div>
        <div className="ic-tag">Connect · Create · Automate · Govern</div>
        <div className="ic-bar" />
        <div className="ic-status">Loading IronShield…</div>
        <a href="./" className="ic-reload" id="ic-reload-btn">Reload page</a>
        <div className="ic-hint">If this hangs, click reload.</div>
      </div>
    </div>
  );
}
