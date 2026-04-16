import { ThemeProvider, WalletProvider, ProposalsProvider } from "@/lib/contexts";
import { Outfit, JetBrains_Mono } from "next/font/google";
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
  icons: { icon: "/icon.svg", apple: "/mascot.png" },
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
        <link rel="preload" as="image" href="/mascot.webp" type="image/webp" />
        <meta name="theme-color" content="#3b82f6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/mascot.png" />
        <style dangerouslySetInnerHTML={{ __html: `
          /* Simple pre-React loader: pure CSS, no JS required */
          #ic-pre-loader {
            position: fixed; inset: 0;
            background: #080b12;
            background-image: radial-gradient(rgba(59,130,246,0.09) 1px, transparent 1px);
            background-size: 24px 24px;
            display: flex; align-items: center; justify-content: center;
            font-family: 'Outfit', -apple-system, sans-serif;
            z-index: 99999;
          }
          #ic-pre-loader .ic-wrap { width: 100%; max-width: 460px; padding: 24px; text-align: center; }
          #ic-pre-loader .ic-brand { font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.5px; margin-bottom: 28px; }
          #ic-pre-loader .ic-brand span { color: #3b82f6; }
          #ic-pre-loader .ic-track { position: relative; height: 64px; margin-bottom: 18px; }
          #ic-pre-loader .ic-rail {
            position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%);
            height: 8px; border-radius: 999px;
            background: rgba(59,130,246,0.12);
            border: 1px solid rgba(59,130,246,0.25);
            overflow: hidden;
          }
          #ic-pre-loader .ic-fill {
            height: 100%;
            background: linear-gradient(90deg, #2563eb, #3b82f6, #0ea5e9);
            box-shadow: 0 0 12px rgba(59,130,246,0.55);
            animation: ic-fill 4.5s ease-out forwards;
          }
          #ic-pre-loader .ic-mascot {
            position: absolute; top: 50%;
            width: 64px; height: 64px;
            transform: translate(-50%, -50%);
            filter: drop-shadow(0 4px 14px rgba(59,130,246,0.55));
            animation: ic-slide 4.5s ease-out forwards, ic-bob 1.2s ease-in-out infinite;
          }
          #ic-pre-loader .ic-mascot img { width: 100%; height: 100%; object-fit: contain; -webkit-user-drag: none; user-select: none; }
          #ic-pre-loader .ic-status { color: #94a3b8; font-size: 14px; }
          #ic-pre-loader .ic-reload {
            display: inline-block;
            margin-top: 22px;
            padding: 11px 24px;
            border-radius: 12px;
            border: 1px solid rgba(59,130,246,0.55);
            background: linear-gradient(135deg, #2563eb, #0ea5e9);
            color: #fff;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            font-family: inherit;
            box-shadow: 0 4px 18px rgba(59,130,246,0.4);
            text-decoration: none;
            transition: transform .15s, box-shadow .15s;
          }
          #ic-pre-loader .ic-reload:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 24px rgba(59,130,246,0.6);
          }
          #ic-pre-loader .ic-hint { color: #64748b; font-size: 11px; margin-top: 12px; }
          @keyframes ic-fill  { 0% { width: 4%; } 100% { width: 92%; } }
          @keyframes ic-slide { 0% { left: 4%; }  100% { left: 92%; } }
          @keyframes ic-bob   { 0%,100% { transform: translate(-50%, -55%) rotate(-3deg); } 50% { transform: translate(-50%, -45%) rotate(3deg); } }
        ` }} />
      </head>
      <body style={{ background: "#080b12", margin: 0 }}>
        {/* Pre-React loader: visible immediately on first paint, removed when React mounts */}
        <div id="ic-pre-loader" aria-hidden="true">
          <div className="ic-wrap">
            <div className="ic-brand">Iron<span>Shield</span></div>
            <div className="ic-track">
              <div className="ic-rail"><div className="ic-fill" /></div>
              <div className="ic-mascot"><img src="/mascot.webp" alt="" /></div>
            </div>
            <div className="ic-status">Loading IronShield…</div>
            <a href="./" className="ic-reload" id="ic-reload-btn">Reload page</a>
            <div className="ic-hint">If this hangs, click reload.</div>
          </div>
        </div>
        {/* Tiny inline script: hides the loader once React renders <nav>.
            That's it. No timers, no auto-reload, no chunk detection. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            // Strip stale ?_r= cache-busters that may have been added by old loader versions
            // (the near.page web4 gateway 404s on query strings)
            try {
              if (location.search && /[?&]_r=/.test(location.search)) {
                history.replaceState(null, '', location.pathname + location.hash);
              }
            } catch(e) {}

            // Make the Reload button a clean reload (strip query string)
            var btn = document.getElementById('ic-reload-btn');
            if (btn) {
              btn.addEventListener('click', function(ev){
                ev.preventDefault();
                btn.textContent = 'Reloading…';
                location.replace(location.origin + location.pathname + location.hash);
              });
            }

            // When React renders the real app (it has <nav>), remove the loader.
            var el = document.getElementById('ic-pre-loader');
            if (!el) return;
            var done = false;
            function hide(){
              if (done || !el) return;
              done = true;
              el.style.transition = 'opacity .25s ease';
              el.style.opacity = '0';
              setTimeout(function(){ if (el && el.parentNode) el.parentNode.removeChild(el); }, 260);
            }
            var obs = new MutationObserver(function(){
              if (document.querySelector('nav')) { obs.disconnect(); hide(); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
          })();
        ` }} />
        <ThemeProvider>
          <WalletProvider>
            <ProposalsProvider>
              {children}
            </ProposalsProvider>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
