import { ThemeProvider, WalletProvider, ProposalsProvider } from "@/lib/contexts";
import PrivyWrapper from "@/components/auth/PrivyWrapper";
import PreLoader from "@/components/boot/PreLoader";
import BgToggle from "@/components/BgToggle";
import { Outfit, JetBrains_Mono } from "next/font/google";
// tokens.css ships CSS variables for the 6 theme presets. It's imported
// before globals.css so per-element overrides in globals take precedence —
// theme tokens are a base layer, not a reset.
import "../styles/tokens.css";
import "./globals.css";

// Self-host the fonts at build time. Eliminates the render-blocking
// stylesheet round-trip to fonts.googleapis.com / fonts.gstatic.com.
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  variable: "--font-outfit",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata = {
  title: "AZUKA | Agent Zone for Universal Kommerce & Automation",
  description: "Agent Zone for Universal Kommerce & Automation. On-Chain. Unstoppable.",
  icons: {
    // Mascot raster is the brand mark. The 346KB PNG gives browsers
    // and OS launchers enough pixels for crisp rendering at every
    // tile size; smaller surfaces pick mascot-sm.png via the
    // manifest's 256×256 entry.
    icon:     "/mascot.png",
    apple:    "/mascot.png",
    shortcut: "/mascot.png",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AZUKA",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${outfit.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Preload lightweight mascot WebP (31KB, 520×780). Was previously
            preloading the 346KB PNG which decoded to ~4MB and OOM'd Telegram
            in-app WebView. */}
        <link rel="preload" as="image" href="/mascot.webp" type="image/webp" />
        <meta name="theme-color" content="#0b0e1c" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/mascot.png" />
        <style dangerouslySetInnerHTML={{ __html: `
          /* Pre-React loader v2 — glowing shield + determinate
             progress + four stage pills. Markup lives in PreLoader.jsx.
             Reload button is hidden by default and surfaced only if
             the safety timeout fires. */
          #ic-pre-loader {
            position: fixed; inset: 0;
            background:
              radial-gradient(ellipse 70% 50% at 50% 35%, rgba(168,85,247,0.10), transparent 70%),
              radial-gradient(ellipse 60% 40% at 50% 100%, rgba(59,130,246,0.06), transparent 75%),
              #050816;
            display: flex; align-items: center; justify-content: center;
            font-family: 'Outfit', -apple-system, sans-serif;
            z-index: 99999;
            overflow: hidden;
          }
          /* Subtle starfield — preserved from v1, dimmed since the new
             design has its own visual weight from the shield + stages. */
          #ic-pre-loader::before, #ic-pre-loader::after {
            content: "";
            position: absolute; inset: -10%;
            background-image:
              radial-gradient(rgba(255,255,255,0.30) 1px, transparent 1.4px),
              radial-gradient(rgba(168,85,247,0.22) 1px, transparent 1.6px);
            background-size: 140px 140px, 200px 200px;
            background-position: 0 0, 70px 70px;
            opacity: 0.4;
            animation: ic-stars 40s linear infinite;
            pointer-events: none;
          }
          #ic-pre-loader::after {
            animation-duration: 60s;
            animation-direction: reverse;
            opacity: 0.25;
            filter: blur(0.4px);
          }
          #ic-pre-loader .ic-wrap {
            position: relative;
            width: 100%; max-width: 540px; padding: 24px;
            text-align: center; z-index: 1;
          }

          /* Shield container. The SVG outline carries its own glow via
             the inline filter; this wrapper holds the mascot raster
             behind the stroke. */
          #ic-pre-loader .ic-shield {
            position: relative;
            width: 168px; height: 184px;
            margin: 0 auto 26px;
            animation: ic-float 4s ease-in-out infinite;
          }
          #ic-pre-loader .ic-shield-svg {
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            filter: drop-shadow(0 0 16px rgba(168,85,247,0.55));
          }
          #ic-pre-loader .ic-mascot {
            position: absolute;
            left: 50%; top: 56%;
            transform: translate(-50%, -50%);
            width: 96px; height: 96px;
            object-fit: contain;
            z-index: 1;
            opacity: 0.95;
          }

          /* Brand wordmark + tagline */
          #ic-pre-loader .ic-brand {
            font-size: 30px; font-weight: 800; color: #fff;
            letter-spacing: -0.8px; margin-bottom: 8px;
          }
          #ic-pre-loader .ic-tag {
            font-size: 11px; font-weight: 600;
            color: rgba(168,85,247,0.85);
            letter-spacing: 3.2px;
            margin-bottom: 28px;
          }

          /* INITIALIZING label */
          #ic-pre-loader .ic-init {
            font-size: 11px; font-weight: 600;
            color: rgba(168,85,247,0.7);
            letter-spacing: 3px;
            margin-bottom: 12px;
          }

          /* Progress bar + pct row */
          #ic-pre-loader .ic-progress {
            display: flex; align-items: center; gap: 14px;
            max-width: 480px; margin: 0 auto 28px;
          }
          #ic-pre-loader .ic-bar {
            flex: 1;
            position: relative;
            height: 6px; border-radius: 999px;
            background: rgba(255,255,255,0.06);
            overflow: hidden;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04);
          }
          #ic-pre-loader .ic-bar-fill {
            position: absolute; top: 0; left: 0; height: 100%;
            border-radius: 999px;
            background: linear-gradient(90deg, #6366f1 0%, #a855f7 60%, #c084fc 100%);
            box-shadow: 0 0 14px rgba(168,85,247,0.6);
            transition: width 0.18s linear;
          }
          #ic-pre-loader .ic-pct {
            font-size: 12px; font-weight: 700;
            color: rgba(230,236,247,0.85);
            font-variant-numeric: tabular-nums;
            letter-spacing: 1px;
            min-width: 36px; text-align: right;
          }

          /* Stage pills */
          #ic-pre-loader .ic-stages {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 36px;
            max-width: 600px; margin-left: auto; margin-right: auto;
          }
          #ic-pre-loader .ic-stage {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(168,85,247,0.04);
            border: 1px solid rgba(168,85,247,0.10);
            text-align: left;
            transition: background .25s ease, border-color .25s ease, opacity .25s ease;
            opacity: 0.5;
          }
          #ic-pre-loader .ic-stage-active {
            opacity: 1;
            border-color: rgba(168,85,247,0.45);
            background: rgba(168,85,247,0.08);
            box-shadow: 0 0 14px rgba(168,85,247,0.18);
            animation: ic-stage-pulse 1.6s ease-in-out infinite;
          }
          #ic-pre-loader .ic-stage-done {
            opacity: 1;
            border-color: rgba(168,85,247,0.35);
            background: rgba(168,85,247,0.06);
          }
          #ic-pre-loader .ic-stage-icon {
            position: relative;
            width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%;
            background: rgba(168,85,247,0.10);
            border: 1px solid rgba(168,85,247,0.30);
            color: #c084fc;
            flex-shrink: 0;
          }
          #ic-pre-loader .ic-stage-done .ic-stage-icon {
            background: rgba(168,85,247,0.18);
            border-color: rgba(168,85,247,0.55);
            color: #ddd6fe;
          }
          #ic-pre-loader .ic-stage-check {
            position: absolute; right: -3px; bottom: -3px;
            width: 14px; height: 14px;
            border-radius: 50%;
            background: linear-gradient(135deg, #a855f7, #6366f1);
            border: 2px solid #050816;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 0 8px rgba(168,85,247,0.6);
          }
          #ic-pre-loader .ic-stage-text { min-width: 0; }
          #ic-pre-loader .ic-stage-name {
            font-size: 12px; font-weight: 700; color: #fff;
            letter-spacing: -0.1px; line-height: 1.1;
          }
          #ic-pre-loader .ic-stage-sub {
            font-size: 10px; color: rgba(230,236,247,0.55);
            margin-top: 1px; letter-spacing: 0.2px;
          }

          /* Footer tagline */
          #ic-pre-loader .ic-tagline {
            font-size: 10px; font-weight: 600;
            color: rgba(168,85,247,0.65);
            letter-spacing: 3.5px;
          }

          /* Reload button — fades in after 8s so a fast load never
             shows it and a stuck load gets an out before the 12s
             auto-recovery in layout.js fires. Pure CSS reveal so we
             don't have to coordinate with React state. */
          #ic-pre-loader .ic-reload {
            display: inline-block;
            margin-top: 18px;
            padding: 9px 18px;
            border-radius: 10px;
            border: none;
            background: linear-gradient(135deg, #6d28d9, #3b82f6);
            color: #fff; font-size: 12px; font-weight: 700;
            cursor: pointer; font-family: inherit;
            text-decoration: none;
            box-shadow: 0 10px 28px rgba(109,40,217,0.4);
            opacity: 0;
            pointer-events: none;
            animation: ic-reload-reveal 1ms linear 8s forwards;
          }
          @keyframes ic-reload-reveal {
            to { opacity: 1; pointer-events: auto; }
          }

          /* Mobile: stack stage pills 2x2 instead of 1x4 */
          @media (max-width: 540px) {
            #ic-pre-loader .ic-stages {
              grid-template-columns: repeat(2, 1fr);
            }
            #ic-pre-loader .ic-shield { width: 132px; height: 144px; margin-bottom: 22px; }
            #ic-pre-loader .ic-mascot { width: 76px; height: 76px; }
            #ic-pre-loader .ic-brand  { font-size: 26px; }
          }

          @keyframes ic-stars { to { background-position: 140px 140px, 270px 270px; } }
          @keyframes ic-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
          @keyframes ic-stage-pulse {
            0%, 100% { box-shadow: 0 0 12px rgba(168,85,247,0.18); }
            50%      { box-shadow: 0 0 22px rgba(168,85,247,0.32); }
          }

          @media (prefers-reduced-motion: reduce) {
            #ic-pre-loader .ic-shield,
            #ic-pre-loader .ic-stage-active,
            #ic-pre-loader::before,
            #ic-pre-loader::after { animation: none !important; }
            #ic-pre-loader .ic-bar-fill { transition: none !important; }
          }
        ` }} />
      </head>
      {/* margin: 0 stays inline so first-paint doesn't flash a default
          margin if the CSS var stylesheet loads a beat late. The
          background hex moved into globals.css behind --page-bg so the
          BgToggle component can flip it without fighting an inline rule. */}
      <body style={{ margin: 0 }}>
        {/* Pre-React loader: visible on first paint, unmounted by
            React when AppShell signals ready. See PreLoader for why
            we can't use raw `removeChild` here — it fights React for
            ownership of the subtree and crashes hydration with
            `NotFoundError: insertBefore`. */}
        <PreLoader />
        {/* Tiny inline script: query-strip, reload-button wiring, and
            the 12-second recovery that fires when React failed to
            mount at all. This script must NOT mutate the #ic-pre-loader
            subtree — React owns it now (see PreLoader). Doing so
            would recreate the hydration crash this file was written
            to avoid. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            // Strip stale ?_r= cache-busters that may have been added by old loader versions
            // (the near.page web4 gateway 404s on query strings)
            try {
              if (location.search && /[?&]_r=/.test(location.search)) {
                history.replaceState(null, '', location.pathname + location.hash);
              }
            } catch(e) {}

            // Capture ?ref=<code> on first hit so the referrer gets
            // credit when the visitor later connects a wallet. Store
            // in localStorage under \`ironshield:ref-pending\`. On
            // wallet connect, src/lib/contexts.js claims it via
            // POST /api/rewards/claim-referrer and clears the flag.
            try {
              var q = new URLSearchParams(location.search);
              var ref = (q.get('ref') || '').trim().toLowerCase();
              if (/^[a-z0-9_]{4,20}$/.test(ref)) {
                localStorage.setItem('ironshield:ref-pending', ref);
                // Strip the query param so share links don't follow
                // the user around the app. Use replaceState to avoid
                // a history entry.
                q.delete('ref');
                var search = q.toString();
                history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash);
              }
            } catch(e) {}

            // ─── Stale-chunk auto-recovery ─────────────────────────
            // Symptom we're guarding against: user clicks a nav link,
            // page goes blank until they manually refresh. Root cause
            // in a Next.js static export behind a CDN is almost always
            // that the browser has old JS chunks cached from before a
            // deploy, so the new route's dynamic import fails and
            // React silently blanks the page. The Next client already
            // catches some ChunkLoadErrors but the v3→v4 SW transition
            // left a long tail of users with stale responses in HTTP
            // cache. One hard reload to the same URL refills the cache
            // with the current manifest and the page renders.
            //
            // Guarded by sessionStorage so a genuinely broken build
            // never infinite-loops the user.
            try {
              var recoverOnce = function(reason) {
                if (sessionStorage.getItem('ic-chunk-reloaded') === '1') return;
                sessionStorage.setItem('ic-chunk-reloaded', '1');
                console.warn('[ic] stale chunk — reloading ('+ reason +')');
                location.reload();
              };
              var isChunkErr = function(msg) {
                return /Loading chunk |ChunkLoadError|Loading CSS chunk |error loading dynamically imported module|Failed to fetch dynamically imported module/i.test(String(msg || ''));
              };
              window.addEventListener('error', function(e) {
                if (isChunkErr(e && (e.message || e.error && e.error.message))) {
                  recoverOnce('window.error');
                }
              });
              window.addEventListener('unhandledrejection', function(e) {
                var r = e && e.reason;
                if (isChunkErr(r && (r.message || r))) recoverOnce('unhandledrejection');
              });
              // Clear the guard after a successful render — if the
              // app rehydrates cleanly, we trust the next nav.
              window.addEventListener('load', function() {
                setTimeout(function() {
                  if (document.querySelector('[data-app-shell="ready"]')) {
                    sessionStorage.removeItem('ic-chunk-reloaded');
                  }
                }, 2000);
              });
            } catch(e) {}

            // Make the Reload button a clean reload (strip query string).
            // The button lives inside React's PreLoader; bind lazily via
            // delegation so we don't race its mount.
            document.addEventListener('click', function(ev){
              var t = ev.target;
              if (!t || t.id !== 'ic-reload-btn') return;
              ev.preventDefault();
              try { t.textContent = 'Reloading…'; } catch(e) {}
              location.replace(location.origin + location.pathname + location.hash);
            });

            // Auto-recover: if nothing rendered after 12s, assume a stale
            // chunk kept React from mounting — nuke caches + SW and
            // hard-reload once with ?fresh=1 as a loop guard.
            var alreadyFreshed = /[?&]fresh=1/.test(location.search);
            setTimeout(function(){
              if (document.querySelector('[data-app-shell="ready"]')) return;
              if (alreadyFreshed) return;
              try {
                var live = document.getElementById('ic-pre-loader');
                var statusEl = live && live.querySelector('.ic-status');
                if (statusEl) statusEl.textContent = 'Recovering…';
              } catch(e) {}
              var clearSW = (navigator.serviceWorker && navigator.serviceWorker.getRegistrations)
                ? navigator.serviceWorker.getRegistrations().then(function(regs){
                    return Promise.all(regs.map(function(r){ return r.unregister(); }));
                  }).catch(function(){})
                : Promise.resolve();
              var clearCaches = (window.caches && caches.keys)
                ? caches.keys().then(function(keys){
                    return Promise.all(keys.map(function(k){ return caches.delete(k); }));
                  }).catch(function(){})
                : Promise.resolve();
              Promise.all([clearSW, clearCaches]).then(function(){
                var sep = location.search ? '&' : '?';
                location.replace(location.origin + location.pathname + location.search + sep + 'fresh=1' + location.hash);
              });
            }, 12000);
          })();
        ` }} />
        {/* Privy outermost so its hooks are available to ThemeProvider's
         * settings store AND to the NEAR wallet selector. The wrapper
         * no-ops when NEXT_PUBLIC_PRIVY_APP_ID is unset, so the app
         * still boots in dev without credentials. */}
        <PrivyWrapper>
          <ThemeProvider>
            <WalletProvider>
              <ProposalsProvider>
                {children}
                {/* BgToggle: floating dark/light page-background swap.
                    Outside the providers' children flow so it lives on
                    every route without each shell needing to mount it. */}
                <BgToggle />
              </ProposalsProvider>
            </WalletProvider>
          </ThemeProvider>
        </PrivyWrapper>
      </body>
    </html>
  );
}
