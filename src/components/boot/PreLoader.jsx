"use client";
// Pre-React loader — visible on first paint, unmounted by React once
// AppShell signals it's ready by inserting a [data-app-shell="ready"]
// node into the DOM.
//
// v2 (post-Day-17 polish): glowing shield + determinate progress bar
// with four stage pills that tick through (Secure Connection → Syncing
// Data → Loading Modules → Activating Agents). The percentage is
// **cosmetic** — the real "ready" signal is the AppShell marker. Bar
// animates 0→95 over ~3.2s; on ready, snaps to 100, fades out.
//
// Architectural pin from v1 (kept): the unmount goes through React's
// own `setVisible(false)` rather than parentNode.removeChild, so
// wallet extensions injecting into <body> don't leave React's fiber
// tracking a removed subtree.

import { useEffect, useState } from "react";

const STAGE_LABELS = [
  { name: "Secure",     sub: "Connection", icon: "shield" },
  { name: "Syncing",    sub: "Data",       icon: "data"   },
  { name: "Loading",    sub: "Modules",    icon: "bolt"   },
  { name: "Activating", sub: "Agents",     icon: "users"  },
];

// Stage threshold per pill — when fake percentage crosses this, the
// pill flips to "done" with a check badge. 25% intervals match the
// four pills exactly.
const STAGE_THRESHOLDS = [25, 50, 75, 95];

// Cosmetic progress curve: ease-out so the early ticks feel snappy
// and the tail relaxes near 95% (where we'd otherwise be lying about
// imminent completion). On the actual ready signal we leap to 100.
const FAKE_DURATION_MS = 3200;
const FAKE_TARGET_PCT  = 95;

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

export default function PreLoader() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading]   = useState(false);
  const [pct, setPct]         = useState(0);
  const [ready, setReady]     = useState(false);

  // Cosmetic progress animation — runs from mount until ready. On
  // ready, we override the rAF curve and snap to 100.
  useEffect(() => {
    let alive = true;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      if (!alive) return;
      if (ready) return;
      const t = Math.min(1, (now - start) / FAKE_DURATION_MS);
      const next = easeOutCubic(t) * FAKE_TARGET_PCT;
      setPct(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; if (raf) cancelAnimationFrame(raf); };
  }, [ready]);

  // Watch for AppShell's "I'm mounted" signal. Same contract as v1.
  useEffect(() => {
    let alive = true;

    function checkReady() {
      if (!alive) return false;
      if (document.querySelector('[data-app-shell="ready"]')) {
        setReady(true);
        setPct(100);
        // Brief 100% display, then fade. Total ~520ms feels punchy
        // without dragging.
        setTimeout(() => { if (alive) setFading(true); }, 240);
        setTimeout(() => { if (alive) setVisible(false); }, 520);
        return true;
      }
      return false;
    }

    if (checkReady()) return () => { alive = false; };

    const obs = new MutationObserver(() => {
      if (checkReady()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Safety: same 15s timeout as v1 — if the app silently fails to
    // mount, get out of the way so the user sees the broken state.
    const safety = setTimeout(() => {
      if (alive && !document.querySelector('[data-app-shell="ready"]')) {
        setFading(true);
        setTimeout(() => { if (alive) setVisible(false); }, 260);
      }
    }, 15_000);

    return () => { alive = false; obs.disconnect(); clearTimeout(safety); };
  }, []);

  if (!visible) return null;

  const pctRounded = Math.round(pct);

  return (
    <div
      id="ic-pre-loader"
      aria-hidden="true"
      style={{ opacity: fading ? 0 : 1, transition: "opacity .25s ease" }}
    >
      <div className="ic-wrap">
        {/* Shield crest with bot mascot inside. Outlined SVG gives the
            glowing purple stroke; the mascot raster sits behind it. */}
        <div className="ic-shield">
          <svg className="ic-shield-svg" viewBox="0 0 200 220" fill="none" aria-hidden="true">
            <defs>
              <filter id="ic-shield-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <path
              d="M100 12 L188 44 L188 110 C188 158 152 196 100 210 C48 196 12 158 12 110 L12 44 Z"
              stroke="#a855f7"
              strokeWidth="3"
              strokeLinejoin="round"
              filter="url(#ic-shield-glow)"
            />
          </svg>
          <img
            src="/mascot.webp"
            alt=""
            className="ic-mascot"
            decoding="async"
            width={120}
            height={120}
          />
        </div>

        <div className="ic-brand">AZUKA</div>
        <div className="ic-tag">AGENT ZONE · UNIVERSAL KOMMERCE · AUTOMATION</div>

        <div className="ic-init">INITIALIZING…</div>

        {/* Determinate progress bar with percentage label. */}
        <div className="ic-progress">
          <div className="ic-bar">
            <div
              className="ic-bar-fill"
              style={{ width: `${pctRounded}%` }}
            />
          </div>
          <div className="ic-pct">{pctRounded}%</div>
        </div>

        {/* Four stage pills — tick green when their threshold is
            crossed. The active pill (the next one not yet done) gets
            a subtle pulse so the eye knows progress is live. */}
        <div className="ic-stages">
          {STAGE_LABELS.map((s, i) => {
            const done = pct >= STAGE_THRESHOLDS[i];
            const active = !done && (i === 0 || pct >= STAGE_THRESHOLDS[i - 1]);
            return (
              <div
                key={s.name}
                className={`ic-stage ${done ? "ic-stage-done" : ""} ${active ? "ic-stage-active" : ""}`}
              >
                <div className="ic-stage-icon">
                  <StageIcon kind={s.icon} />
                  {done && (
                    <span className="ic-stage-check" aria-hidden="true">
                      <svg viewBox="0 0 14 14" width="9" height="9">
                        <path d="M3 7.5 L6 10.5 L11 4.5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </div>
                <div className="ic-stage-text">
                  <div className="ic-stage-name">{s.name}</div>
                  <div className="ic-stage-sub">{s.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="ic-tagline">SECURE. TRANSPARENT. COMMUNITY-FIRST.</div>

        {/* Reload affordance — hidden until safety timeout shows it. */}
        <a href="./" className="ic-reload" id="ic-reload-btn">Reload page</a>
      </div>
    </div>
  );
}

function StageIcon({ kind }) {
  const p = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (kind) {
    case "shield":
      return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
    case "data":
      return <svg {...p}>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5" />
        <path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" />
      </svg>;
    case "bolt":
      return <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
    case "users":
      return <svg {...p}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>;
    default:
      return null;
  }
}
