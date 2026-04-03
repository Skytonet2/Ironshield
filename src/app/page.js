"use client";
import { useState } from "react";
import { Shield, Sun, Moon, LogOut, Wallet } from "lucide-react";
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

const MASCOT_IMG = "/mascot.png";

const pages = ["Home", "Dashboard", "Staking", "Trade", "Earn", "Roadmap", "Ecosystem"];

export default function App() {
  const { theme: t, isDark, setIsDark } = useThemeInfo();
  const { connected, address, balance, showModal, signOut } = useWallet();

  const [page, setPage] = useState("Home");
  const [showAdmin, setShowAdmin] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const openWallet = () => showModal();

  const renderPage = () => {
    switch (page) {
      case "Home": return <HomePage setPage={setPage} openWallet={openWallet} />;
      case "Dashboard": return <DashboardPage openWallet={openWallet} />;
      case "Staking": return <StakingPage openWallet={openWallet} />;
      case "Trade": return <TradePage openWallet={openWallet} />;
      case "Earn": return <EarnPage openWallet={openWallet} />;
      case "Roadmap": return <RoadmapPage />;
      case "Ecosystem": return <EcosystemPage />;
      default: return <HomePage setPage={setPage} openWallet={openWallet} />;
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

      <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 90, width: 90, height: 90, animation: "floatBounce 3s ease-in-out infinite", cursor: "pointer" }}
        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.2)"}
        onMouseLeave={e => e.currentTarget.style.transform = ""}>
        <img src={MASCOT_IMG} alt="IronClaw" style={{ width: "100%", height: "100%", objectFit: "contain", animation: "swordSwing 2.5s ease-in-out infinite", filter: "drop-shadow(0 4px 16px rgba(59,130,246,0.4))" }} />
      </div>

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
                background: page === p ? `${t.accent}18` : "transparent",
                border: page === p ? `1px solid ${t.accent}44` : "1px solid transparent",
                color: page === p ? t.accent : t.textMuted,
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
            <a href="https://docs.google.com/document/d/1xRiNukfCBmgmGatib_3xSMtI_GmTjWzN/edit?usp=sharing&ouid=102071430463828769085&rtpof=true&sd=true" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textDim}>Docs</a>
            <a href="https://t.me/IronClawHQ" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textDim}>Telegram</a>
            <a href="https://x.com/_IronClaw" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textDim}>X (Twitter)</a>
            <a href="https://t.me/clawfadabot" target="_blank" rel="noopener noreferrer" style={{ color: t.textDim, textDecoration: "none", cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textDim}>Admin Bot</a>
            <span style={{ cursor: "pointer", color: t.textDim }}
              onClick={() => setShowAdmin(true)}
              onMouseEnter={e => e.currentTarget.style.color = t.accent}
              onMouseLeave={e => e.currentTarget.style.color = t.textDim}
            >Dashboard Settings</span>
          </div>
        </div>
      </div>

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );
}
