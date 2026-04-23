import { ThemeProvider, WalletProvider, ProposalsProvider } from "@/lib/contexts";
import PrivyWrapper from "@/components/auth/PrivyWrapper";
import PreLoader from "@/components/boot/PreLoader";
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
  title: "IronShield | NEAR Protocol",
  description: "AI Security. On-Chain. Unstoppable.",
  icons: {
    icon: "/icon.svg",
    // Apple touch icon now uses the branded app-icon (rounded-square
    // container + shield) rather than the raw mascot photo — the OS
    // renders these with its own mask, so a solid-bg crest works best.
    apple: "/brand/app-icon.svg",
    shortcut: "/icon.svg",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "IronShield",
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
        <link rel="apple-touch-icon" href="/brand/app-icon.svg" />
        <style dangerouslySetInnerHTML={{ __html: `
          /* Pre-React loader — pure CSS, no JS required for animation.
             Designed to feel premium rather than "a spinner with a
             progress bar": a pulsing shield crest, two concentric
             rotating rings, and a subtle star-field bg. Dismissed by
             the inline script below once the AppShell mounts. */
          #ic-pre-loader {
            position: fixed; inset: 0;
            background:
              radial-gradient(ellipse 90% 70% at 50% 40%, rgba(168,85,247,0.10), transparent 70%),
              radial-gradient(ellipse 60% 45% at 50% 100%, rgba(59,130,246,0.10), transparent 75%),
              #050816;
            display: flex; align-items: center; justify-content: center;
            font-family: 'Outfit', -apple-system, sans-serif;
            z-index: 99999;
            overflow: hidden;
          }
          /* Twinkling star-field via two layered radial-gradient tiles
             with offset animations. Cheaper than SVG and doesn't touch
             the main thread. */
          #ic-pre-loader::before, #ic-pre-loader::after {
            content: "";
            position: absolute; inset: -10%;
            background-image:
              radial-gradient(rgba(255,255,255,0.42) 1px, transparent 1.4px),
              radial-gradient(rgba(168,85,247,0.35) 1px, transparent 1.6px);
            background-size: 120px 120px, 180px 180px;
            background-position: 0 0, 60px 60px;
            opacity: 0.5;
            animation: ic-stars 30s linear infinite;
            pointer-events: none;
          }
          #ic-pre-loader::after {
            animation-duration: 50s;
            animation-direction: reverse;
            opacity: 0.3;
            filter: blur(0.4px);
          }
          #ic-pre-loader .ic-wrap {
            position: relative;
            width: 100%; max-width: 480px; padding: 24px;
            text-align: center; z-index: 1;
          }
          #ic-pre-loader .ic-crest {
            position: relative;
            width: 120px; height: 120px;
            margin: 0 auto 30px;
            animation: ic-float 3.6s ease-in-out infinite;
          }
          /* Two rings that counter-rotate around the crest */
          #ic-pre-loader .ic-ring {
            position: absolute; inset: -10px;
            border-radius: 50%;
            border: 1px solid rgba(168,85,247,0.35);
            animation: ic-ring-spin 10s linear infinite;
          }
          #ic-pre-loader .ic-ring::before {
            content: ""; position: absolute; top: -4px; left: 50%;
            width: 7px; height: 7px; border-radius: 50%;
            background: #a855f7;
            box-shadow: 0 0 14px #a855f7;
            transform: translateX(-50%);
          }
          #ic-pre-loader .ic-ring.ic-ring-outer {
            inset: -28px;
            border: 1px dashed rgba(59,130,246,0.35);
            animation-duration: 16s;
            animation-direction: reverse;
          }
          #ic-pre-loader .ic-ring.ic-ring-outer::before {
            background: #60a5fa;
            box-shadow: 0 0 14px #60a5fa;
            width: 5px; height: 5px; top: -3px;
          }
          /* Shield logo — uses the existing gradient palette. The glow
             pulses with the same 3.6s cadence as the float. */
          #ic-pre-loader .ic-shield {
            position: absolute; inset: 0;
            border-radius: 50%;
            background: linear-gradient(135deg, #a855f7, #3b82f6);
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 12px 44px rgba(168,85,247,0.5), inset 0 1px 0 rgba(255,255,255,0.2);
            animation: ic-pulse 3.6s ease-in-out infinite;
          }
          #ic-pre-loader .ic-shield svg { width: 54px; height: 54px; color: #fff; }
          #ic-pre-loader .ic-brand {
            font-size: 26px; font-weight: 800; color: #fff;
            letter-spacing: -0.7px; margin-bottom: 6px;
          }
          #ic-pre-loader .ic-brand span {
            background: linear-gradient(90deg, #60a5fa, #a855f7);
            -webkit-background-clip: text; background-clip: text;
            -webkit-text-fill-color: transparent; color: transparent;
          }
          #ic-pre-loader .ic-tag {
            font-size: 13px; color: rgba(230,236,247,0.55);
            letter-spacing: 0.2px; margin-bottom: 20px;
          }
          /* Progress bar — sits below the tag. Short indeterminate
             sweep instead of a filling-percentage bar, which conveys
             activity without implying we know how long loading will
             take. */
          #ic-pre-loader .ic-bar {
            position: relative;
            height: 3px; border-radius: 999px;
            background: rgba(255,255,255,0.06);
            overflow: hidden;
            max-width: 220px; margin: 0 auto;
          }
          #ic-pre-loader .ic-bar::before {
            content: ""; position: absolute; top: 0; height: 100%;
            width: 40%; border-radius: 999px;
            background: linear-gradient(90deg, transparent, #a855f7 45%, #60a5fa 55%, transparent);
            animation: ic-sweep 1.4s ease-in-out infinite;
          }
          #ic-pre-loader .ic-status {
            color: rgba(230,236,247,0.55); font-size: 12px;
            margin-top: 14px; letter-spacing: 0.3px;
          }
          #ic-pre-loader .ic-reload {
            display: inline-block;
            margin-top: 22px;
            padding: 11px 22px;
            border-radius: 10px;
            border: none;
            background: linear-gradient(135deg, #6d28d9, #3b82f6);
            color: #fff; font-size: 13px; font-weight: 700;
            cursor: pointer; font-family: inherit;
            text-decoration: none;
            box-shadow: 0 10px 28px rgba(109,40,217,0.45), inset 0 1px 0 rgba(255,255,255,0.18);
            transition: transform .15s ease, box-shadow .15s ease;
          }
          #ic-pre-loader .ic-reload:hover {
            transform: translateY(-1px);
            box-shadow: 0 14px 32px rgba(109,40,217,0.6);
          }
          #ic-pre-loader .ic-hint { color: rgba(230,236,247,0.35); font-size: 11px; margin-top: 12px; }

          @keyframes ic-stars   { to { background-position: 120px 120px, 240px 240px; } }
          @keyframes ic-float   { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
          @keyframes ic-pulse   {
            0%, 100% { box-shadow: 0 12px 44px rgba(168,85,247,0.5), inset 0 1px 0 rgba(255,255,255,0.2); }
            50%      { box-shadow: 0 16px 60px rgba(168,85,247,0.75), 0 0 44px rgba(59,130,246,0.35), inset 0 1px 0 rgba(255,255,255,0.25); }
          }
          @keyframes ic-ring-spin { to { transform: rotate(360deg); } }
          @keyframes ic-sweep {
            0%   { left: -40%; }
            100% { left: 100%; }
          }
          @media (prefers-reduced-motion: reduce) {
            #ic-pre-loader .ic-crest,
            #ic-pre-loader .ic-shield,
            #ic-pre-loader .ic-ring,
            #ic-pre-loader::before,
            #ic-pre-loader::after,
            #ic-pre-loader .ic-bar::before { animation: none !important; }
          }
        ` }} />
      </head>
      <body style={{ background: "#080b12", margin: 0 }}>
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
              </ProposalsProvider>
            </WalletProvider>
          </ThemeProvider>
        </PrivyWrapper>
      </body>
    </html>
  );
}
