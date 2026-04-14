"use client";
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  Shield, Sun, Moon, LogOut, Wallet, Home as HomeIcon, Hash, Bell,
  Mail, Bookmark, Users, User, MoreHorizontal, Feather, Rocket, Coins,
  Vote, Sparkles, Network, BookOpen, Bot, Zap,
} from "lucide-react";
import { useThemeInfo, useWallet } from "@/lib/contexts";
import { Btn } from "@/components/Primitives";

import HomePage       from "@/components/HomePage";
import AdminPanel     from "@/components/AdminPanel";
import MascotSystem   from "@/components/MascotSystem";

const StakingPage    = lazy(() => import("@/components/StakingPage"));
const AlphaFeedPage  = lazy(() => import("@/components/AlphaFeedPage"));
const IronFeedPage   = lazy(() => import("@/components/IronFeedPage"));
const EarnPage       = lazy(() => import("@/components/EarnPage"));
const EcosystemPage  = lazy(() => import("@/components/EcosystemPage"));
const GovernancePage = lazy(() => import("@/components/GovernancePage"));
const LaunchPage     = lazy(() => import("@/components/LaunchPage"));
const DocsPage       = lazy(() => import("@/components/DocsPage"));
const AgentPage      = lazy(() => import("@/components/AgentPage"));

const MASCOT_IMG = "/mascot.png";

/* Primary nav = what lives in the X-style left rail.
 * mobileTop=true → shown in the bottom bar on phones. Others are desktop-only. */
const PRIMARY = [
  { key: "Home",        label: "Home",       Icon: HomeIcon,  mobileTop: true },
  { key: "Feed",        label: "IronFeed",   Icon: Feather,   mobileTop: true },
  { key: "Alpha",       label: "Alpha",      Icon: Sparkles,  mobileTop: true },
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
  const match = PAGE_KEYS.find(p => p.toLowerCase() === raw);
  return match || "Home";
}
function navigate(page) { window.location.hash = "#/" + page; }

const initialPage = typeof window !== "undefined" ? getPageFromHash() : "Home";

export default function App() {
  const { theme: t, isDark, setIsDark } = useThemeInfo();
  const { connected, address, balance, showModal, signOut } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [page, setPageState] = useState(initialPage);
  const [showAdmin, setShowAdmin] = useState(false);
  const [walletMenu, setWalletMenu] = useState(false);
  const [showSurprise, setShowSurprise] = useState(false);

  const setPage = useCallback((p) => {
    setPageState(p);
    navigate(p);
    window.scrollTo(0, 0);
    setWalletMenu(false);
  }, []);

  useEffect(() => {
    setMounted(true);
    setPageState(getPageFromHash());
    const onHash = () => setPageState(getPageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
        @media (max-width: 640px) {
          .ix-shell { grid-template-columns: 1fr; }
          .ix-sidebar {
            position: fixed; bottom: 0; top: auto; left: 0; right: 0; width: 100%;
            height: 60px; flex-direction: row; justify-content: space-around;
            align-items: stretch; border-right: none; border-top: 1px solid ${t.border};
            padding: 0; z-index: 100; background: ${t.bg};
          }
          .ix-sidebar nav {
            flex-direction: row; flex: 1; justify-content: space-around;
            align-items: center; margin: 0; gap: 0;
          }
          .ix-sidebar .ix-brand, .ix-sidebar .ix-post-cta, .ix-sidebar .ix-wallet-row { display: none; }
          .ix-sidebar .ix-nav-btn {
            flex: 1 1 0; min-width: 0; padding: 8px 4px; border-radius: 0;
            justify-content: center; align-items: center; flex-direction: column;
            gap: 2px; font-size: 10px;
          }
          .ix-sidebar .ix-nav-btn .ix-nav-label {
            display: block; font-size: 10px; font-weight: 600; white-space: nowrap;
          }
          .ix-nav-btn.mobile-hide { display: none !important; }
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
                <MenuItem t={t} onClick={() => { setPage("Feed"); window.location.hash = `#/Feed?profile=${address}`; }}>
                  <User size={16} /> View profile
                </MenuItem>
                <MenuItem t={t} onClick={() => { setIsDark(!isDark); }}>
                  {isDark ? <Sun size={16} /> : <Moon size={16} />} Toggle theme
                </MenuItem>
                <MenuItem t={t} onClick={() => setShowAdmin(true)}>
                  <Hash size={16} /> Dashboard settings
                </MenuItem>
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

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
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
