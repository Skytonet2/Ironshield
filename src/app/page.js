"use client";
import { useState, useEffect, useCallback } from "react";
import { Shield, Sun, Moon, LogOut, Wallet, MessageCircle } from "lucide-react";
import { useThemeInfo, useWallet } from "@/lib/contexts";
import { Btn } from "@/components/Primitives";

import HomePage from "@/components/HomePage";
import DashboardPage from "@/components/DashboardPage";
import StakingPage from "@/components/StakingPage";
import TradePage from "@/components/TradePage";
import EarnPage from "@/components/EarnPage";
import RoadmapPage from "@/components/RoadmapPage";
import EcosystemPage from "@/components/EcosystemPage";
import AdminPanel from "@/components/AdminPanel";
import GovernancePage from "@/components/GovernancePage";
import LaunchPage from "@/components/LaunchPage";
import DocsPage from "@/components/DocsPage";
import MascotSystem from "@/components/MascotSystem";

const MASCOT_IMG = "/mascot.png";

const pages = ["Home", "Dashboard", "Staking", "Trade", "Earn", "Governance", "Launch", "Roadmap", "Ecosystem", "Docs"];

/* ── Hash-based routing (IPFS-compatible) ──────────────────────── */
function getPageFromHash() {
  if (typeof window === "undefined") return "Home";
  const raw = window.location.hash.replace("#/", "").replace("#", "").toLowerCase();
  const match = pages.find(p => p.toLowerCase() === raw);
  return match || "Home";
}

function navigate(page) {
  window.location.hash = "#/" + page;
}

// Read hash once at module load (client-only) to avoid flash
const initialPage = typeof window !== "undefined" ? getPageFromHash() : "Home";

export default function App() {
  const { theme: t, isDark, setIsDark } = useThemeInfo();
  const { connected, address, balance, showModal, signOut } = useWallet();

  const [mounted, setMounted] = useState(false);
  const [page, setPageState] = useState(initialPage);
  const [showAdmin, setShowAdmin] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [showSurprise, setShowSurprise] = useState(false);

  const setPage = useCallback((p) => {
    setPageState(p);
    navigate(p);
    window.scrollTo(0, 0);
  }, []);

  // Hydration guard + hash listener
  useEffect(() => {
    setMounted(true);
    setPageState(getPageFromHash());
    const onHash = () => setPageState(getPageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openWallet = () => showModal();

  // Prevent blank flash during SSR hydration
  if (!mounted) {
    return (
      <div style={{ background: "#080b12", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <Shield size={40} color="#3b82f6" style={{ marginBottom: 12 }} />
          <div style={{ color: "#94a3b8", fontSize: 14 }}>Loading IronShield...</div>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (page) {
      case "Home":       return <HomePage setPage={setPage} openWallet={openWallet} />;
      case "Dashboard":  return <DashboardPage openWallet={openWallet} />;
      case "Staking":    return <StakingPage openWallet={openWallet} />;
      case "Trade":      return <TradePage openWallet={openWallet} />;
      case "Earn":       return <EarnPage openWallet={openWallet} />;
      case "Governance": return <GovernancePage openWallet={openWallet} />;
      case "Launch":     return <LaunchPage setPage={setPage} openWallet={openWallet} />;
      case "Roadmap":    return <RoadmapPage />;
      case "Ecosystem":  return <EcosystemPage />;
      case "Docs":       return <DocsPage />;
      default:           return <HomePage setPage={setPage} openWallet={openWallet} />;
    }
  };

  return (
    <div style={{
      background: t.bg,
      backgroundImage: `radial-gradient(${isDark ? "rgba(59,130,246,0.09)" : "rgba(37,99,235,0.12)"} 1px, transparent 1px)`,
      backgroundSize: "24px 24px", minHeight: "100vh", color: t.text,
      fontFamily: "'Outfit', -apple-system, sans-serif", position: "relative", overflowX: "hidden"
    }}>

      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "90vw", maxWidth: 500, height: 500, opacity: t.watermarkOpacity, backgroundImage: `url(${MASCOT_IMG})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center", pointerEvents: "none", zIndex: 0 }} />

      <MascotSystem onSecretFound={() => setShowSurprise(true)} />

      {showSurprise && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowSurprise(false)}>
          <div style={{ background: t.bgCard, border: `2px solid ${t.accent}`, borderRadius: 24, padding: 40, textAlign: "center", maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: t.white, marginBottom: 12 }}>You found the secret!</h2>
            <p style={{ fontSize: 16, color: t.textMuted, marginBottom: 24, lineHeight: 1.6 }}>You just got a Whitelist Allocation for the $IRON token presale!</p>
            <Btn primary onClick={() => setShowSurprise(false)} style={{ padding: "12px 32px" }}>Claim Allocation</Btn>
          </div>
        </div>
      )}

      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: t.navBg, backdropFilter: "blur(20px)", borderBottom: `1px solid ${t.border}` }}>
        <div style={{ maxWidth: 1600, margin: "0 auto", padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setPage("Home")}>
            <Shield size={24} color={t.accent} />
            <span style={{ fontSize: 18, fontWeight: 800, color: t.white, letterSpacing: "-0.5px" }}>Iron<span style={{ color: t.accent }}>Shield</span></span>
          </div>

          {/* Desktop Nav */}
          <div className="desktop-nav" style={{ display: "flex", gap: 4 }}>
            {pages.map(p => (
              <button key={p} onClick={() => setPage(p)} className="nav-link" style={{
                background: page === p ? `${p === "Governance" ? "#ff6b00" : p === "Launch" ? "#9b5de5" : t.accent}18` : "transparent",
                border: page === p ? `1px solid ${p === "Governance" ? "#ff6b00" : p === "Launch" ? "#9b5de5" : t.accent}44` : "1px solid transparent",
                color: page === p ? (p === "Governance" ? "#ff6b00" : p === "Launch" ? "#9b5de5" : t.accent) : t.textMuted,
                padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>{p}</button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => setIsDark(!isDark)} style={{ width: 40, height: 40, borderRadius: 10, border: `1px solid ${t.border}`, background: t.bgSurface, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isDark ? <Sun size={17} color={t.amber} /> : <Moon size={17} color={t.accent} />}
            </button>
            {connected ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.bgSurface, border: `1px solid ${t.green}44`, borderRadius: 10, padding: "8px 14px" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.green }} />
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.white, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.1 }}>{address.length > 14 ? address.substring(0,6)+"..."+address.substring(address.length-4) : address}</span>
                  <span style={{ fontSize: 10, color: t.textDim, fontFamily: "'JetBrains Mono', monospace" }}>{balance} NEAR</span>
                </div>
                <button onClick={signOut} style={{ background: "none", border: "none", cursor: "pointer", color: t.textDim, display: "flex", marginLeft: 4 }}><LogOut size={13} /></button>
              </div>
            ) : (
              <Btn primary onClick={openWallet} style={{ padding: "8px 18px", fontSize: 13 }}><Wallet size={13} /> Connect</Btn>
            )}

            {/* Mobile Menu Toggle */}
            <button className="mobile-only" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} style={{ background: "none", border: "none", color: t.white, fontSize: 24, cursor: "pointer", display: "none" }}>
              ☰
            </button>
          </div>
        </div>

        {/* Mobile Nav Drawer */}
        {mobileMenuOpen && (
          <div className="mobile-only" style={{ background: t.bgCard, borderBottom: `1px solid ${t.border}`, padding: "10px 24px", display: "none" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pages.map(p => (
                <button key={p} onClick={() => { setPage(p); setMobileMenuOpen(false); }} style={{
                  background: page === p ? `${t.accent}18` : "transparent",
                  border: "none", color: page === p ? t.accent : t.textMuted,
                  padding: "12px", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer", textAlign: "left"
                }}>{p}</button>
              ))}
            </div>
          </div>
        )}
      </nav>

      <div style={{ position: "relative", zIndex: 1, minHeight: "80vh" }}>
        {renderPage()}
      </div>

      <div style={{ borderTop: `1px solid ${t.border}`, padding: "36px 24px", position: "relative", zIndex: 1, marginTop: 40 }}>
        <div style={{ maxWidth: 1600, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={18} color={t.accent} />
            <span style={{ fontSize: 13, color: t.textMuted }}>IronShield — by <span style={{ color: t.white }}>IronClaw</span> on NEAR Protocol</span>
          </div>
          <div style={{ display: "flex", gap: 20, fontSize: 13, color: t.textDim, flexWrap: "wrap", alignItems: "center" }}>
            <span onClick={() => setPage("Docs")} style={{ color: t.textDim, textDecoration: "none", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textDim}>Docs</span>
            <a href="https://t.me/IronClawHQ" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textDim}>Telegram</a>
            <a href="https://x.com/_IronClaw" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textDim}>X (Twitter)</a>
            <a href="https://t.me/IronShieldCore_bot" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textDim}>IronShield Bot</a>
            <span style={{ cursor: "pointer", color: t.textDim }}
              onClick={() => setShowAdmin(true)}
              onMouseEnter={e => e.currentTarget.style.color = t.accent}
              onMouseLeave={e => e.currentTarget.style.color = t.textDim}
            >Dashboard Settings</span>
          </div>
        </div>
      </div>

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      {/* Floating Telegram Bot Launcher */}
      <a
        href="https://t.me/IronShieldCore_bot"
        target="_blank"
        rel="noopener noreferrer"
        title="Launch IronShield Bot"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 99,
          width: 56, height: 56, borderRadius: "50%",
          background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 4px 20px ${t.accent}55`,
          cursor: "pointer", textDecoration: "none",
          transition: "transform 0.2s, box-shadow 0.2s",
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.1)"; e.currentTarget.style.boxShadow = `0 6px 28px ${t.accent}88`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = `0 4px 20px ${t.accent}55`; }}
      >
        <MessageCircle size={26} color="#fff" fill="#fff" />
      </a>
    </div>
  );
}
