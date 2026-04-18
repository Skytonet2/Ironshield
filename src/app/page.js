"use client";
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  Shield, Sun, Moon, LogOut, Wallet, Home as HomeIcon, Hash, Bell,
  Mail, Bookmark, Users, User, MoreHorizontal, Feather, Rocket, Coins,
  Vote, Sparkles, Network, BookOpen, Bot, Zap, MessageSquare, Menu, X, Mic,
  Download, BellRing, Share2,
} from "lucide-react";
import { useThemeInfo, useWallet } from "@/lib/contexts";
import { Btn } from "@/components/Primitives";
import { usePWA } from "@/lib/usePWA";
import { CallProvider, useCall } from "@/lib/callContext";

import HomePage       from "@/components/HomePage";
import AdminPanel     from "@/components/AdminPanel";
import MascotSystem   from "@/components/MascotSystem";
import DMToast        from "@/components/DMToast";
import DMCallPanel    from "@/components/DMCallPanel";
import TelegramOnboardingModal from "@/components/TelegramOnboardingModal";

const StakingPage    = lazy(() => import("@/components/StakingPage"));
const AlphaFeedPage  = lazy(() => import("@/components/AlphaFeedPage"));
const IronFeedPage   = lazy(() => import("@/components/IronFeedPage"));
const EarnPage       = lazy(() => import("@/components/EarnPage"));
const EcosystemPage  = lazy(() => import("@/components/EcosystemPage"));
const GovernancePage = lazy(() => import("@/components/GovernancePage"));
const LaunchPage     = lazy(() => import("@/components/LaunchPage"));
const DocsPage       = lazy(() => import("@/components/DocsPage"));
const AgentPage      = lazy(() => import("@/components/AgentPage"));
const NewsCoinPage   = lazy(() => import("@/components/NewsCoinPage"));

const MASCOT_IMG = "/mascot.png";

/* Primary nav = what lives in the X-style left rail.
 * mobileTop=true → shown in the bottom bar on phones. Others are desktop-only. */
const PRIMARY = [
  { key: "Home",        label: "Home",       Icon: HomeIcon,  mobileTop: true },
  { key: "Feed",        label: "IronFeed",   Icon: Feather,   mobileTop: true },
  { key: "NewsCoin",    label: "NewsCoin",   Icon: Coins,     mobileTop: true },
  { key: "Alpha",       label: "Alpha",      Icon: Sparkles,  mobileTop: true },
  { key: "Rooms",       label: "Rooms",      Icon: Mic,       mobileTop: true, external: "/rooms/" },
  { key: "Staking",     label: "Staking",    Icon: Coins },
  { key: "Earn",        label: "Earn",       Icon: Rocket,    mobileTop: true },
  { key: "Governance",  label: "Governance", Icon: Vote,      mobileTop: true },
  { key: "Launch",      label: "Launch",     Icon: Zap },
  { key: "Agent",       label: "Agent",      Icon: Bot },
  { key: "Ecosystem",   label: "Ecosystem",  Icon: Network },
  { key: "Docs",        label: "Docs",       Icon: BookOpen },
];
const PAGE_KEYS = PRIMARY.map(p => p.key);

/* ── Hash-based routing ──────────────────────── */
function getPageFromHash() {
  if (typeof window === "undefined") return "Home";
  const raw = window.location.hash.replace("#/", "").replace("#", "").toLowerCase();
  const key = raw.split("?")[0];
  const match = PAGE_KEYS.find(p => p.toLowerCase() === key);
  return match || "Home";
}
function navigate(page) { window.location.hash = "#/" + page; }

const initialPage = typeof window !== "undefined" ? getPageFromHash() : "Home";

export default function App() {
  return (
    <CallProvider>
      <AppInner />
    </CallProvider>
  );
}

function AppInner() {
  const { theme: t, isDark, setIsDark } = useThemeInfo();
  const { connected, address, balance, showModal, signOut } = useWallet();
  const { call, minimize, restore, endCall } = useCall();

  const [mounted, setMounted] = useState(false);
  const [page, setPageState] = useState(initialPage);
  const [showAdmin, setShowAdmin] = useState(false);
  const [walletMenu, setWalletMenu] = useState(false);
  const [showSurprise, setShowSurprise] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(true);

  const pwa = usePWA(address);

  const setPage = useCallback((p) => {
    const entry = PRIMARY.find(x => x.key === p);
    if (entry?.external) {
      // If the user is in the middle of a call, open the external route in a
      // new tab so this tab (and the LiveKit connection) stay alive.
      if (call?.open) {
        window.open(entry.external, "_blank", "noopener");
      } else {
        window.location.href = entry.external;
      }
      return;
    }
    setPageState(p);
    navigate(p);
    window.scrollTo(0, 0);
    setWalletMenu(false);
    // If a call is open and the user navigates, collapse it to the floating
    // pill rather than keeping the full-screen modal over the new page.
    if (call?.open && !call.minimized) minimize();
  }, [call, minimize]);

  useEffect(() => {
    setMounted(true);
    setPageState(getPageFromHash());
    const onHash = () => setPageState(getPageFromHash());
    const onNav = (e) => { if (e?.detail) setPage(e.detail); };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("ironshield:navigate", onNav);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("ironshield:navigate", onNav);
    };
  }, []);

  const openWallet = () => showModal();

  if (!mounted) return null;

  const fallback = (
    <div style={{ padding: "120px 24px", textAlign: "center", color: t.textMuted, fontSize: 13 }}>Loading…</div>
  );

  const isHome = page === "Home";

  const renderPage = () => {
    switch (page) {
      case "Home":       return <HomePage setPage={setPage} openWallet={openWallet} />;
      case "Feed":       return <Suspense fallback={fallback}><IronFeedPage openWallet={openWallet} setPage={setPage} /></Suspense>;
      case "NewsCoin":   return <Suspense fallback={fallback}><NewsCoinPage openWallet={openWallet} /></Suspense>;
      case "Alpha":      return <Suspense fallback={fallback}><AlphaFeedPage openWallet={openWallet} /></Suspense>;
      case "Staking":    return <Suspense fallback={fallback}><StakingPage openWallet={openWallet} /></Suspense>;
      case "Earn":       return <Suspense fallback={fallback}><EarnPage openWallet={openWallet} /></Suspense>;
      case "Governance": return <Suspense fallback={fallback}><GovernancePage openWallet={openWallet} /></Suspense>;
      case "Agent":      return <Suspense fallback={fallback}><AgentPage openWallet={openWallet} /></Suspense>;
      case "Launch":     return <Suspense fallback={fallback}><LaunchPage setPage={setPage} openWallet={openWallet} /></Suspense>;
      case "Ecosystem":  return <Suspense fallback={fallback}><EcosystemPage /></Suspense>;
      case "Docs":       return <Suspense fallback={fallback}><DocsPage /></Suspense>;
      default:           return <HomePage setPage={setPage} openWallet={openWallet} />;
    }
  };

  const short = address && address.length > 14 ? `${address.slice(0,6)}…${address.slice(-4)}` : address;

  return (
    <div style={{
      background: t.bg, minHeight: "100vh", color: t.text,
      fontFamily: "'Outfit', -apple-system, sans-serif",
    }}>
      <style>{`
        .ix-shell { display: grid; grid-template-columns: 275px 1fr; min-height: 100vh; }
        .ix-sidebar { position: sticky; top: 0; height: 100vh; padding: 12px 12px 16px; display: flex; flex-direction: column; border-right: 1px solid ${t.border}; background: ${t.bg}; }
        .ix-nav-btn { display: flex; align-items: center; gap: 16px; padding: 10px 14px; border-radius: 999px; border: none; background: transparent; color: ${t.text}; font-size: 17px; font-weight: 500; cursor: pointer; text-align: left; width: 100%; transition: background .15s; }
        .ix-nav-btn:hover { background: ${t.bgSurface}; }
        .ix-nav-btn.active { font-weight: 800; }
        .ix-post-cta { margin: 14px 4px 0; padding: 13px 0; border-radius: 999px; border: none; background: ${t.accent}; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
        .ix-wallet-row { margin-top: auto; position: relative; }
        @media (max-width: 960px) {
          .ix-shell { grid-template-columns: 72px 1fr; }
          .ix-sidebar { padding: 10px 8px; }
          .ix-nav-label, .ix-wallet-text, .ix-post-cta-label, .ix-brand-text { display: none; }
          .ix-post-cta { width: 48px; height: 48px; border-radius: 50%; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
        }
        .ix-mobile-bar { display: none; }
        .ix-mobile-menu-btn { display: none; }
        @media (max-width: 640px) {
          .ix-mobile-menu-btn {
            display: inline-flex; position: fixed; top: 10px; right: 10px;
            z-index: 200; width: 40px; height: 40px; border-radius: 50%;
            border: 1px solid ${t.border}; background: ${t.bgCard};
            align-items: center; justify-content: center; cursor: pointer;
            box-shadow: 0 4px 14px rgba(0,0,0,.35);
          }
          .ix-mobile-drawer-backdrop {
            position: fixed; inset: 0; background: rgba(0,0,0,.6);
            backdrop-filter: blur(3px); z-index: 300;
          }
          .ix-mobile-drawer {
            position: fixed; top: 0; right: 0; bottom: 0; width: min(86vw, 320px);
            background: ${t.bg}; border-left: 1px solid ${t.border};
            display: flex; flex-direction: column; z-index: 301;
            overflow-y: auto; -webkit-overflow-scrolling: touch;
            animation: ixSlideIn .2s ease-out;
          }
          @keyframes ixSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        }
        @media (max-width: 640px) {
          .ix-shell { grid-template-columns: 1fr; }
          .ix-sidebar { display: none; }
          .ix-mobile-bar {
            display: flex; position: fixed; bottom: 0; left: 0; right: 0;
            height: 60px; background: ${t.bg}; border-top: 1px solid ${t.border};
            z-index: 100; align-items: stretch; justify-content: space-around;
          }
          .ix-mobile-bar button {
            flex: 1 1 0; display: flex; flex-direction: column; align-items: center;
            justify-content: center; gap: 3px; background: none; border: none;
            cursor: pointer; color: ${t.text}; font-size: 10px; font-weight: 600;
            padding: 4px 2px;
          }
          .ix-main-wrap { padding-bottom: 72px; }
        }
      `}</style>

      {showSurprise && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowSurprise(false)}>
          <div style={{ background: t.bgCard, border: `2px solid ${t.accent}`, borderRadius: 24, padding: 40, textAlign: "center", maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: t.white, marginBottom: 12 }}>You found the secret!</h2>
            <p style={{ fontSize: 16, color: t.textMuted, marginBottom: 24, lineHeight: 1.6 }}>You just got a Whitelist Allocation for the $IRON token presale!</p>
            <Btn primary onClick={() => setShowSurprise(false)} style={{ padding: "12px 32px" }}>Claim Allocation</Btn>
          </div>
        </div>
      )}

      <div className="ix-shell">
        {/* Left rail (X-style) */}
        <aside className="ix-sidebar">
          <div className="ix-brand" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", cursor: "pointer" }} onClick={() => setPage("Home")}>
            <Shield size={26} color={t.accent} />
            <span className="ix-brand-text" style={{ fontSize: 18, fontWeight: 800, color: t.white, letterSpacing: "-0.5px" }}>
              Iron<span style={{ color: t.accent }}>Shield</span>
            </span>
          </div>

          <nav style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
            {PRIMARY.map(({ key, label, Icon, mobileTop }) => (
              <button key={key} onClick={() => setPage(key)} className={`ix-nav-btn ${page === key ? "active" : ""} ${mobileTop ? "" : "mobile-hide"}`}>
                <Icon size={24} color={page === key ? t.accent : t.text} strokeWidth={page === key ? 2.5 : 2} />
                <span className="ix-nav-label" style={{ color: page === key ? t.white : t.text }}>{label}</span>
              </button>
            ))}
          </nav>

          <button className="ix-post-cta" onClick={() => setPage("Feed")}>
            <span className="ix-post-cta-label">Post</span>
            <Feather size={20} className="ix-post-cta-icon" style={{ display: "none" }} />
          </button>

          {/* Wallet / profile row at bottom */}
          <div className="ix-wallet-row">
            {connected ? (
              <button onClick={() => setWalletMenu(v => !v)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: 10,
                width: "100%", border: "none", background: "transparent", borderRadius: 999,
                cursor: "pointer",
              }}
                onMouseEnter={e => e.currentTarget.style.background = t.bgSurface}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800 }}>
                  {address?.[0]?.toUpperCase() || "I"}
                </div>
                <div className="ix-wallet-text" style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: t.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{short}</div>
                  <div style={{ fontSize: 12, color: t.textDim }}>{balance} NEAR</div>
                </div>
                <MoreHorizontal size={16} color={t.textDim} className="ix-wallet-text" />
              </button>
            ) : (
              <button onClick={openWallet} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                width: "100%", border: `1px solid ${t.border}`, background: t.bgSurface, borderRadius: 999,
                cursor: "pointer", color: t.white, fontWeight: 700,
              }}>
                <Wallet size={18} color={t.accent} /> <span className="ix-wallet-text">Connect Wallet</span>
              </button>
            )}

            {walletMenu && connected && (
              <div style={{
                position: "absolute", bottom: 64, left: 0, right: 0,
                background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
                padding: 6, boxShadow: "0 12px 40px rgba(0,0,0,.5)", zIndex: 20,
              }} onMouseLeave={() => setWalletMenu(false)}>
                <MenuItem t={t} onClick={() => {
                  setPageState("Feed");
                  window.location.hash = `#/Feed?profile=${encodeURIComponent(address)}`;
                  window.scrollTo(0, 0);
                  setWalletMenu(false);
                }}>
                  <User size={16} /> View profile
                </MenuItem>
                <MenuItem t={t} onClick={() => { setIsDark(!isDark); }}>
                  {isDark ? <Sun size={16} /> : <Moon size={16} />} Toggle theme
                </MenuItem>
                <MenuItem t={t} onClick={() => setShowAdmin(true)}>
                  <Hash size={16} /> Dashboard settings
                </MenuItem>
                <MenuItem t={t} onClick={async () => {
                  if (pwa.pushEnabled) { await pwa.disablePush(); }
                  else {
                    const res = await pwa.enablePush();
                    if (res && res.ok === false && res.message) alert(res.message);
                  }
                  setWalletMenu(false);
                }} color={pwa.pushEnabled ? t.green : t.text}>
                  <BellRing size={16} /> {pwa.pushEnabled ? "Notifications on" : "Enable notifications"}
                </MenuItem>
                {pwa.canInstall && (
                  <MenuItem t={t} onClick={async () => { await pwa.promptInstall(); setWalletMenu(false); }}>
                    <Download size={16} /> Install app
                  </MenuItem>
                )}
                <MenuItem t={t} onClick={signOut} color={t.red}>
                  <LogOut size={16} /> Disconnect
                </MenuItem>
              </div>
            )}
          </div>
        </aside>

        {/* Main column */}
        <main className="ix-main-wrap" style={{ minHeight: "100vh", position: "relative" }}>
          {isHome && <MascotSystem onSecretFound={() => setShowSurprise(true)} />}
          {renderPage()}

          {isHome && (
            <div style={{ borderTop: `1px solid ${t.border}`, padding: "36px 24px", marginTop: 40 }}>
              <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Shield size={18} color={t.accent} />
                  <span style={{ fontSize: 13, color: t.textMuted }}>IronShield: by <span style={{ color: t.white }}>IronClaw</span> on NEAR Protocol</span>
                </div>
                <div style={{ display: "flex", gap: 20, fontSize: 13, color: t.textDim, flexWrap: "wrap" }}>
                  <a href="https://t.me/IronClawHQ" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none" }}>Telegram</a>
                  <a href="https://x.com/_IronClaw" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none" }}>X</a>
                  <span onClick={() => setShowAdmin(true)} style={{ cursor: "pointer" }}>Admin</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* PWA Install banner */}
      {showInstallBanner && !pwa.isInstalled && (pwa.canInstall || pwa.isIOS) && (
        <div style={{
          position: "fixed", bottom: 68, left: 8, right: 8, zIndex: 150,
          background: `linear-gradient(135deg, ${t.bgCard}, ${t.bgSurface})`,
          border: `1px solid ${t.accent}44`,
          borderRadius: 16, padding: "14px 16px",
          display: "flex", alignItems: "center", gap: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,.6)",
        }}>
          <img src="/mascot.png" alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: t.white, fontSize: 14, fontWeight: 700 }}>Install IronShield</div>
            <div style={{ color: t.textMuted, fontSize: 11 }}>
              {pwa.isIOS
                ? <>Tap <Share2 size={11} style={{ verticalAlign: "middle" }} /> then "Add to Home Screen"</>
                : "Add to your home screen for the full experience"}
            </div>
          </div>
          {pwa.canInstall && (
            <button onClick={async () => { await pwa.promptInstall(); setShowInstallBanner(false); }}
              style={{ padding: "8px 16px", background: t.accent, color: "#fff", border: "none",
                borderRadius: 999, cursor: "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
              Install
            </button>
          )}
          <button onClick={() => setShowInstallBanner(false)}
            style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer", padding: 4 }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Mobile bottom tab bar: Profile | Agent | Home | Notifications | Messages */}
      <nav className="ix-mobile-bar">
        <button onClick={() => {
          if (!connected) return openWallet();
          setPageState("Feed");
          window.location.hash = `#/Feed?profile=${encodeURIComponent(address)}`;
        }}>
          <User size={22} color={t.text} />
          <span>Profile</span>
        </button>
        <button onClick={() => setPage("Agent")}>
          <Bot size={22} color={page === "Agent" ? t.accent : t.text} />
          <span style={{ color: page === "Agent" ? t.accent : t.text }}>Agent</span>
        </button>
        <button onClick={() => setPage("Home")}>
          <HomeIcon size={22} color={page === "Home" ? t.accent : t.text} />
          <span style={{ color: page === "Home" ? t.accent : t.text }}>Home</span>
        </button>
        <button onClick={() => {
          if (!connected) return openWallet();
          setPageState("Feed");
          window.location.hash = `#/Feed?notifs=1`;
        }}>
          <Bell size={22} color={t.text} />
          <span>Alerts</span>
        </button>
        <button onClick={() => {
          if (!connected) return openWallet();
          setPageState("Feed");
          window.location.hash = `#/Feed?dms=1`;
        }}>
          <MessageSquare size={22} color={t.text} />
          <span>Messages</span>
        </button>
      </nav>

      {/* Mobile top-right menu button + drawer: exposes ALL nav items including desktop-only ones */}
      <button className="ix-mobile-menu-btn" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}>
        <Menu size={20} color={t.text} />
      </button>

      {mobileNavOpen && (
        <div className="ix-mobile-drawer-backdrop" onClick={() => setMobileNavOpen(false)}>
          <aside className="ix-mobile-drawer" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${t.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Shield size={20} color={t.accent} />
                <span style={{ fontSize: 16, fontWeight: 800, color: t.white }}>Iron<span style={{ color: t.accent }}>Shield</span></span>
              </div>
              <button onClick={() => setMobileNavOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted }}>
                <X size={18} />
              </button>
            </div>
            <nav style={{ display: "flex", flexDirection: "column", padding: 8, gap: 2 }}>
              {PRIMARY.map(({ key, label, Icon }) => (
                <button key={key} onClick={() => { setPage(key); setMobileNavOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "12px 14px",
                    border: "none", background: page === key ? t.bgSurface : "transparent",
                    color: page === key ? t.white : t.text, cursor: "pointer",
                    borderRadius: 10, fontSize: 15, fontWeight: page === key ? 700 : 500, textAlign: "left",
                  }}>
                  <Icon size={20} color={page === key ? t.accent : t.text} />
                  {label}
                </button>
              ))}
            </nav>
            <div style={{ marginTop: "auto", padding: 12, borderTop: `1px solid ${t.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={async () => {
                if (!connected) { openWallet(); setMobileNavOpen(false); return; }
                if (pwa.pushEnabled) { await pwa.disablePush(); }
                else {
                  const res = await pwa.enablePush();
                  if (res && res.ok === false && res.message) alert(res.message);
                }
              }}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", border: `1px solid ${pwa.pushEnabled ? t.green : t.border}`, background: pwa.pushEnabled ? `${t.green}14` : "transparent", color: pwa.pushEnabled ? t.green : t.text, borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
                <BellRing size={16} /> {pwa.pushEnabled ? "Notifications on" : "Enable notifications"}
              </button>
              {pwa.canInstall && (
                <button onClick={async () => { await pwa.promptInstall(); setMobileNavOpen(false); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", border: `1px solid ${t.accent}`, background: `${t.accent}18`, color: t.accent, borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 }}>
                  <Download size={16} /> Install app
                </button>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setIsDark(!isDark); }}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 12px", border: `1px solid ${t.border}`, background: "transparent", color: t.text, borderRadius: 10, cursor: "pointer", fontSize: 13 }}>
                  {isDark ? <Sun size={14} /> : <Moon size={14} />} Theme
                </button>
                {connected && (
                  <button onClick={() => { signOut(); setMobileNavOpen(false); }}
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 12px", border: `1px solid ${t.border}`, background: "transparent", color: t.red, borderRadius: 10, cursor: "pointer", fontSize: 13 }}>
                    <LogOut size={14} /> Disconnect
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      <DMToast onOpenDM={(peer, convId) => {
        setPage("Feed");
        try { window.dispatchEvent(new CustomEvent("ix-open-dm", { detail: { peer, convId } })); } catch (_) {}
      }} />

      {/* First-visit nudge to link the Telegram bot. */}
      <TelegramOnboardingModal />

      {/* Persistent call surface. Stays mounted across SPA page switches and
          across the minimize→restore toggle so the LiveKit room + mic tracks
          are never torn down while the user is in a call. */}
      {call.open && call.kind === "dm" && (
        <DMCallPanel
          open
          minimized={call.minimized}
          t={t}
          wallet={address}
          conversationId={call.conversationId}
          peer={call.peer}
          onMinimize={minimize}
          onResume={restore}
          onEnd={endCall}
        />
      )}
    </div>
  );
}

function MenuItem({ children, onClick, t, color }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px",
      border: "none", background: "transparent", color: color || t.text, cursor: "pointer",
      fontSize: 14, borderRadius: 8, textAlign: "left",
    }}
      onMouseEnter={e => e.currentTarget.style.background = t.bgSurface}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      {children}
    </button>
  );
}
