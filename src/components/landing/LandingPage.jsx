"use client";
// AZUKA landing page — marketing shell, not the app shell.
//
// Sections:
//   1. Scroll-aware navbar (transparent → glass on scroll)
//   2. Hero: word-by-word headline, mascot, floating feature chips
//   3. Trust row — ecosystem logos (Arbitrum / Ethereum / Solana / Base
//      / Avalanche / NEAR)
//   4. Product showcase: split layout with the Web3 social platform
//      pitch + a mini dashboard preview (feed + profile + markets).
//   5. Stats row with count-up on scroll
//   6. "Ready to join the future?" CTA band with mascot portrait
//   7. Email subscribe + socials
//   8. Footer with Product / Ecosystem / Resources / Legal
//
// The previous / route mounted HomePage (an authenticated dashboard)
// inside AppShell. That made the root URL feel like the product, not
// a pitch. This file is what /  now serves — a premium public entry
// that Launch App → /feed.
//
// Everything animates with framer-motion via LazyMotion + domAnimation
// (same footprint as the rest of the app). No GSAP, no WebGL, no
// custom particle engine — we stay light and still read as premium.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight, Bot, Users, Star, Shield, Rocket, Coins, Briefcase,
  ArrowLeftRight, Activity, Network, Sparkles, Menu, X as XIcon,
  CheckCircle2, ArrowRight, MessageCircle, Send,
  GitBranch, Globe, TrendingUp, ChevronDown,
} from "lucide-react";
import {
  LazyMotion, domAnimation, m, AnimatePresence, useInView,
} from "@/lib/motion";
import { BrandMark as SharedBrandMark, BrandPrimary } from "@/components/brand/Brand";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Ecosystem", href: "#ecosystem" },
  { label: "Resources", href: "#resources" },
  { label: "Token", href: "#token" },
  { label: "Roadmap", href: "#roadmap" },
];

const HERO_WORDS = [
  "Connect.", "Create.", "Automate.", "Govern.",
];
// Last line gets the gradient accent.
const HERO_TAIL = "All in One Place.";

const HERO_CHIPS = [
  { label: "AI Agents",       sub: "Automate anything", Icon: Bot,       color: "#60a5fa" },
  { label: "Governance",      sub: "Community first",   Icon: Users,     color: "#a855f7" },
  { label: "Rewards",         sub: "Earn and level up", Icon: Star,      color: "#10b981" },
  { label: "Secure by Design", sub: "On-chain verified", Icon: Shield,   color: "#f59e0b" },
];

const ECOSYSTEM = [
  { name: "Arbitrum",  },
  { name: "Ethereum",  },
  { name: "Solana",    },
  { name: "BASE",      },
  { name: "Avalanche", },
  { name: "NEAR",      },
];

const FEATURES = [
  { label: "Social Feed",     Icon: MessageCircle, hint: "Real-time updates, alpha, and community conversations." },
  { label: "AI Automations",  Icon: Sparkles,      hint: "Create powerful workflows and on-chain automations." },
  { label: "Earn Rewards",    Icon: Star,          hint: "Complete missions, earn XP, and unlock exclusive rewards." },
  { label: "Govern Together", Icon: Shield,        hint: "Vote on proposals and shape the future of AZUKA." },
];

const STATS = [
  { value: 250_000,     suffix: "+", label: "Active Users", Icon: Users },
  { value: 1_000_000,   suffix: "+", label: "Transactions", Icon: MessageCircle },
  { value: 150_000,     suffix: "+", label: "Automations Created", Icon: Sparkles },
  { value: 120_000_000, prefix: "$", suffix: "M+", scale: 1_000_000, label: "Assets Secured", Icon: Shield },
];

const FOOTER_COLUMNS = [
  { title: "Product",   links: [["Features","#features"],["Roadmap","#roadmap"],["Token","#token"],["Security","#security"]] },
  { title: "Ecosystem", links: [["Partners","#partners"],["Integrations","#integrations"],["Community","https://t.me/IronClawHQ"],["Brand Kit","#brand"]] },
  { title: "Resources", links: [["Docs","/docs"],["Blog","#blog"],["Help Center","#help"],["Developers","#dev"]] },
  { title: "Legal",     links: [["Privacy Policy","#privacy"],["Terms of Service","#terms"],["Cookie Policy","#cookies"]] },
];

export default function LandingPage() {
  return (
    <LazyMotion features={domAnimation}>
      <div data-app-shell="ready" style={{
        background: "radial-gradient(ellipse at top, rgba(168,85,247,0.14), transparent 55%), radial-gradient(ellipse at 30% 120%, rgba(59,130,246,0.12), transparent 60%), #050816",
        color: "#e5ebf7",
        minHeight: "100vh",
        overflowX: "hidden",
      }}>
        <Navbar />
        <Hero />
        <TrustRow />
        <ProductShowcase />
        <FeatureGrid />
        <StatsAndCTA />
        <Testimonials />
        <EcosystemGrid />
        <EmailSubscribe />
        <Footer />

        <style jsx global>{`
          @keyframes ix-breathe { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
          @keyframes ix-shine   { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
          @keyframes ix-glow-pulse { 0%,100% { filter: drop-shadow(0 0 18px rgba(168,85,247,0.35)) drop-shadow(0 0 60px rgba(59,130,246,0.18)); } 50% { filter: drop-shadow(0 0 28px rgba(168,85,247,0.5)) drop-shadow(0 0 80px rgba(59,130,246,0.28)); } }
          @keyframes ix-ring-pulse { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(1.4); opacity: 0; } }
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { animation: none !important; transition: none !important; }
          }

          /* Landing responsive grid — consolidated here because
             Turbopack doesn't allow component-scoped styled-jsx tags
             nested inside other styled-jsx tags. Using className hooks
             instead of inline component styles keeps the layout
             portable and the component markup readable. */
          .ix-desk-only { display: inline-flex; }
          .ix-mobile-only { display: none; }
          @media (max-width: 899px) {
            .ix-desk-only { display: none !important; }
            .ix-mobile-only { display: flex; }
          }

          .ix-hero-grid { display: grid; gap: 28px; }
          @media (min-width: 960px) {
            .ix-hero-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; }
          }
          @media (max-width: 959px) {
            .ix-hero-chips { display: none; }
          }

          .ix-show-grid { display: grid; gap: 32px; }
          @media (min-width: 960px) {
            .ix-show-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); align-items: center; }
          }

          .ix-prev-grid { display: grid; gap: 10px; grid-template-columns: 170px minmax(0, 1fr) 200px; }
          @media (max-width: 759px) {
            .ix-prev-grid { grid-template-columns: 1fr !important; }
            .ix-prev-hide-mobile { display: none !important; }
          }

          .ix-stats-grid { display: grid; gap: 26px; }
          @media (min-width: 960px) {
            .ix-stats-grid { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); align-items: center; }
          }
          @media (max-width: 599px) {
            .ix-cta-mascot { display: none; }
          }

          .ix-footer-grid { display: grid; gap: 28px; }
          @media (min-width: 760px) {
            .ix-footer-grid { grid-template-columns: 1.4fr repeat(4, 1fr); }
          }

          .ix-feat-grid, .ix-eco-grid {
            display: grid; gap: 18px;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          }
          @media (min-width: 960px) {
            .ix-feat-grid, .ix-eco-grid { grid-template-columns: repeat(4, 1fr); }
          }
          .ix-test-grid {
            display: grid; gap: 18px;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          }
          @media (min-width: 960px) {
            .ix-test-grid { grid-template-columns: repeat(3, 1fr); }
          }
        `}</style>
      </div>
    </LazyMotion>
  );
}

/* ─────────────────────────── NAVBAR ─────────────────────────── */

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header style={{
      position: "fixed", top: 0, left: 0, right: 0,
      zIndex: 50,
      transition: "background 220ms ease, backdrop-filter 220ms ease, border-color 220ms ease, box-shadow 220ms ease",
      borderBottom: scrolled ? "1px solid rgba(255,255,255,0.06)" : "1px solid transparent",
      background: scrolled
        ? "linear-gradient(180deg, rgba(8,11,22,0.8), rgba(8,11,22,0.65))"
        : "transparent",
      backdropFilter: scrolled ? "blur(16px)" : "none",
      WebkitBackdropFilter: scrolled ? "blur(16px)" : "none",
      boxShadow: scrolled ? "0 10px 30px rgba(0,0,0,0.35)" : "none",
    }}>
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        padding: "0 clamp(16px, 4vw, 32px)",
        height: scrolled ? 60 : 70,
        display: "flex", alignItems: "center", gap: 14,
        transition: "height 220ms ease",
      }}>
        <a href="/" style={{
          display: "flex", alignItems: "center", gap: 10,
          textDecoration: "none", color: "#fff",
        }}>
          <BrandMark size={28} />
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>AZUKA</span>
        </a>

        <nav style={{ display: "flex", gap: 6, marginLeft: 20 }} className="ix-desk-only">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "8px 12px", borderRadius: 8,
              color: "rgba(230,236,247,0.7)", fontSize: 13, fontWeight: 500,
              textDecoration: "none",
              transition: "color 120ms ease, background 120ms ease",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(230,236,247,0.7)"; e.currentTarget.style.background = "transparent"; }}
            >
              {l.label}
              <ChevronDown size={12} style={{ opacity: 0.6 }} />
            </a>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <a href="/feed" className="ix-desk-only" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          padding: "9px 16px", borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(255,255,255,0.04)",
          color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none",
        }}>Sign In</a>

        <LaunchCta href="/feed" />

        <button
          type="button"
          className="ix-mobile-only"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          style={{
            width: 38, height: 38, borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "#fff", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {mobileOpen ? <XIcon size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="ix-mobile-only" style={{
          background: "rgba(8,11,22,0.96)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "10px 16px 14px",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setMobileOpen(false)} style={{
              padding: "10px 12px", borderRadius: 8,
              color: "rgba(230,236,247,0.82)", fontSize: 14,
              textDecoration: "none",
            }}>{l.label}</a>
          ))}
        </div>
      )}

    </header>
  );
}

function LaunchCta({ href }) {
  const ref = useRef(null);
  // Magnetic-ish: translate toward the cursor within a small radius.
  const onMove = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
  };
  const onLeave = () => { if (ref.current) ref.current.style.transform = "translate(0,0)"; };
  return (
    <a
      ref={ref}
      href={href}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "10px 16px", borderRadius: 10,
        border: "none",
        background: "linear-gradient(135deg, #6d28d9, #3b82f6)",
        color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none",
        boxShadow: "0 10px 28px rgba(109,40,217,0.45), inset 0 1px 0 rgba(255,255,255,0.18)",
        transition: "transform 140ms var(--ease-out)",
        position: "relative",
      }}
    >
      Launch App
      <ArrowUpRight size={14} />
    </a>
  );
}

// Landing-page-local BrandMark shim. Delegates to the shared
// src/components/brand system so the nav-sized crest uses the real
// shield geometry + glow instead of the old gradient-square+lucide
// placeholder. Kept here (rather than replacing every call site)
// because the landing page uses it in three places and the call
// signature stays stable.
function BrandMark({ size = 28 }) {
  return <SharedBrandMark size={size} />;
}

/* ───────────────────────────── HERO ───────────────────────────── */

function Hero() {
  return (
    <section style={{
      position: "relative",
      paddingTop: "clamp(110px, 14vh, 150px)",
      paddingBottom: "clamp(40px, 7vh, 80px)",
    }}>
      <BackgroundMesh />
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        padding: "0 clamp(16px, 4vw, 32px)",
        display: "grid", gap: 28,
      }}
      className="ix-hero-grid">
        <div>
          <Eyebrow>The Web3 Social Operating System</Eyebrow>

          <h1 style={{
            margin: "14px 0 14px",
            fontSize: "clamp(42px, 6.8vw, 72px)",
            lineHeight: 1.02,
            fontWeight: 800,
            color: "#fff",
            letterSpacing: -1.2,
          }}>
            {HERO_WORDS.map((w, i) => (
              <m.span
                key={w}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                style={{ display: "block" }}
              >
                {w}
              </m.span>
            ))}
            <m.span
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + HERO_WORDS.length * 0.12, duration: 0.55 }}
              style={{
                display: "block",
                background: "linear-gradient(90deg, #60a5fa, #a855f7, #60a5fa)",
                backgroundSize: "200% 100%",
                WebkitBackgroundClip: "text", backgroundClip: "text",
                WebkitTextFillColor: "transparent", color: "transparent",
                animation: "ix-shine 7s linear infinite",
              }}
            >
              {HERO_TAIL}
            </m.span>
          </h1>

          <m.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.5 }}
            style={{
              fontSize: 16, lineHeight: 1.6, color: "rgba(230,236,247,0.7)",
              margin: "0 0 22px", maxWidth: 520,
            }}
          >
            AZUKA is the all-in-one platform for Web3 builders, traders, and communities.
            Social, earn, automate, and scale with AI agents and on-chain tools.
          </m.p>

          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.82, duration: 0.5 }}
            style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
          >
            <HeroCta primary href="/feed">Launch App <ArrowUpRight size={14} /></HeroCta>
            <HeroCta href="#features">Explore Features</HeroCta>
          </m.div>

          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.0, duration: 0.5 }}
            style={{
              marginTop: 22, display: "inline-flex", alignItems: "center", gap: 8,
              fontSize: 13, color: "rgba(230,236,247,0.6)",
            }}
          >
            <Shield size={14} color="#a855f7" />
            Built for the future. Secured by community.
          </m.div>
        </div>

        <HeroMascot />
      </div>
    </section>
  );
}

function HeroCta({ primary, href, children }) {
  const common = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "12px 18px", borderRadius: 12,
    fontSize: 14, fontWeight: 700, textDecoration: "none",
    transition: "transform 140ms var(--ease-out), box-shadow 220ms ease",
  };
  if (primary) {
    return (
      <a href={href} style={{
        ...common,
        background: "linear-gradient(135deg, #6d28d9, #3b82f6)",
        color: "#fff", border: "none",
        boxShadow: "0 12px 30px rgba(109,40,217,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
      }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 16px 36px rgba(109,40,217,0.6), inset 0 1px 0 rgba(255,255,255,0.2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 12px 30px rgba(109,40,217,0.5), inset 0 1px 0 rgba(255,255,255,0.2)"; }}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} style={{
      ...common,
      background: "rgba(255,255,255,0.03)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.1)",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
    >
      {children}
    </a>
  );
}

function Eyebrow({ children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 12px", borderRadius: 999,
      background: "linear-gradient(180deg, rgba(168,85,247,0.14), rgba(59,130,246,0.06))",
      border: "1px solid rgba(168,85,247,0.3)",
      color: "#c084fc", fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
    }}>
      <Sparkles size={12} />
      {children}
    </span>
  );
}

function HeroMascot() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const onMove = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    setTilt({
      x: ((e.clientX - cx) / r.width) * 6,
      y: ((e.clientY - cy) / r.height) * -6,
    });
  };
  const onLeave = () => setTilt({ x: 0, y: 0 });

  return (
    <div
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        position: "relative",
        minHeight: 400,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {/* Soft radial glow behind the mascot */}
      <div aria-hidden style={{
        position: "absolute", inset: "8% 12%",
        background: "radial-gradient(circle, rgba(168,85,247,0.35) 0%, rgba(59,130,246,0.18) 40%, transparent 70%)",
        filter: "blur(40px)",
        zIndex: 0,
      }} />
      {/* Concentric rings */}
      <div aria-hidden style={{
        position: "absolute", inset: "10% 18%", borderRadius: "50%",
        border: "1px solid rgba(168,85,247,0.25)",
        zIndex: 0,
      }} />
      <div aria-hidden style={{
        position: "absolute", inset: "4% 10%", borderRadius: "50%",
        border: "1px dashed rgba(59,130,246,0.25)",
        zIndex: 0,
        animation: "ix-ring-pulse 4.5s ease-out infinite",
      }} />

      {/* Mascot — breathing + mouse-tilt via transform */}
      <div style={{
        position: "relative",
        width: "min(420px, 86%)",
        zIndex: 1,
        transform: `perspective(1000px) rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
        transition: "transform 180ms var(--ease-out)",
        animation: "ix-glow-pulse 4.5s ease-in-out infinite",
      }}>
        <div style={{ animation: "ix-breathe 5s ease-in-out infinite" }}>
          <img
            src="/mascot.webp"
            alt="AZUKA mascot"
            width={520} height={780}
            style={{ width: "100%", height: "auto", display: "block" }}
            loading="eager"
            decoding="async"
          />
        </div>
      </div>

      {/* Floating feature chips — absolutely positioned on desktop,
          stacked below on mobile. */}
      <div className="ix-hero-chips" style={{
        position: "absolute", inset: 0,
        pointerEvents: "none",
      }}>
        {HERO_CHIPS.map((c, i) => (
          <FloatingChip key={c.label} chip={c} slot={i} />
        ))}
      </div>

    </div>
  );
}

function FloatingChip({ chip, slot }) {
  // Approximate the reference layout: 4 chips stacked on the right
  // side of the mascot, staggered in on load.
  const top = ["8%", "30%", "52%", "74%"][slot];
  const { Icon } = chip;
  return (
    <m.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.9 + slot * 0.1, duration: 0.45 }}
      style={{
        position: "absolute",
        top, right: "0",
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px 10px 10px",
        borderRadius: 14,
        background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
        border: "1px solid rgba(255,255,255,0.1)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 16px 36px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        pointerEvents: "auto",
        minWidth: 180,
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 10,
        background: `${chip.color}22`, color: chip.color,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: `1px solid ${chip.color}44`,
      }}>
        <Icon size={16} />
      </span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{chip.label}</div>
        <div style={{ fontSize: 11, color: "rgba(230,236,247,0.55)" }}>{chip.sub}</div>
      </div>
    </m.div>
  );
}

function BackgroundMesh() {
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
      {/* subtle grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "44px 44px",
        maskImage: "radial-gradient(ellipse at center, #000 40%, transparent 80%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, #000 40%, transparent 80%)",
      }} />
      {/* ambient blobs */}
      <div style={{
        position: "absolute", top: "-10%", left: "-10%",
        width: "60vw", height: "60vw", maxWidth: 820, maxHeight: 820,
        background: "radial-gradient(circle, rgba(168,85,247,0.18) 0%, transparent 60%)",
        filter: "blur(80px)",
      }} />
      <div style={{
        position: "absolute", bottom: "-20%", right: "-10%",
        width: "60vw", height: "60vw", maxWidth: 820, maxHeight: 820,
        background: "radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 60%)",
        filter: "blur(80px)",
      }} />
    </div>
  );
}

/* ─────────────────────── TRUST ROW (ECOSYSTEM) ─────────────────────── */

function TrustRow() {
  return (
    <section style={{
      padding: "28px clamp(16px, 4vw, 32px) 44px",
      borderTop: "1px solid rgba(255,255,255,0.05)",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{
        fontSize: 11, letterSpacing: 2.4, fontWeight: 700,
        color: "rgba(230,236,247,0.45)", textAlign: "center",
        marginBottom: 18, textTransform: "uppercase",
      }}>
        Trusted by builders &amp; communities
      </div>
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center",
        gap: "clamp(26px, 6vw, 64px)",
        maxWidth: 1100, margin: "0 auto",
      }}>
        {ECOSYSTEM.map((x) => (
          <span key={x.name}
            style={{
              fontSize: 17, fontWeight: 700, letterSpacing: 0.2,
              color: "rgba(230,236,247,0.4)",
              transition: "color 160ms ease, transform 160ms ease",
              cursor: "default",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(230,236,247,0.4)"; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            {x.name}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────── PRODUCT SHOWCASE ──────────────────── */

function ProductShowcase() {
  return (
    <section id="features" style={{
      padding: "clamp(50px, 8vh, 96px) clamp(16px, 4vw, 32px)",
    }}>
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        display: "grid", gap: 32,
      }} className="ix-show-grid">
        <div>
          <Eyebrow>The Ultimate</Eyebrow>
          <h2 style={{
            margin: "12px 0 14px",
            fontSize: "clamp(30px, 4vw, 46px)",
            fontWeight: 800, lineHeight: 1.08, color: "#fff", letterSpacing: -0.6,
          }}>
            Web3 Social Platform
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 22 }}>
            {FEATURES.map((f, i) => (
              <FeatureRow key={f.label} feature={f} index={i} />
            ))}
          </div>

          <a href="#roadmap" style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            marginTop: 24,
            padding: "10px 14px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)",
            color: "#fff", fontSize: 13, fontWeight: 700, textDecoration: "none",
          }}>
            Explore All Features <ArrowUpRight size={13} />
          </a>
        </div>

        {/* Mini product preview — shell + feed + right card */}
        <ProductPreview />
      </div>
    </section>
  );
}

function FeatureRow({ feature, index }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const { Icon } = feature;
  return (
    <m.div
      ref={ref}
      initial={{ opacity: 0, y: 10 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ delay: 0.05 * index, duration: 0.45 }}
      style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: 12, borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(255,255,255,0.02)",
        transition: "border-color 160ms ease, background 160ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(168,85,247,0.35)"; e.currentTarget.style.background = "rgba(168,85,247,0.05)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 10,
        background: "rgba(168,85,247,0.12)", color: "#c084fc",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: "1px solid rgba(168,85,247,0.3)",
      }}>
        <Icon size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{feature.label}</div>
        <div style={{ fontSize: 12, color: "rgba(230,236,247,0.55)", marginTop: 3, lineHeight: 1.5 }}>
          {feature.hint}
        </div>
      </div>
    </m.div>
  );
}

function ProductPreview() {
  // A compact "dashboard screenshot" illustration built with DOM
  // primitives. Gradient glass frame, three-column layout mimicking
  // the real shell so the page's promise reads at a glance.
  return (
    <m.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "relative",
        borderRadius: 18,
        border: "1px solid rgba(168,85,247,0.35)",
        background: "linear-gradient(180deg, rgba(168,85,247,0.06), rgba(59,130,246,0.04) 60%, transparent), #0a0f1f",
        padding: 14,
        overflow: "hidden",
        boxShadow: "0 30px 80px rgba(168,85,247,0.2), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: "170px minmax(0, 1fr) 200px",
      }} className="ix-prev-grid">
        {/* Sidebar */}
        <div className="ix-prev-hide-mobile" style={{
          padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.05)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px" }}>
            <BrandMark size={18} />
            <span style={{ fontSize: 12, fontWeight: 800 }}>AZUKA</span>
          </div>
          {[
            ["Feed", true], ["NewsCoin"], ["Automations"], ["Rewards"],
            ["Portfolio"], ["Governance"], ["Staking"], ["Bridge"], ["Agent"],
            ["Analytics"], ["Docs"],
          ].map(([label, active]) => (
            <div key={label} style={{
              fontSize: 11, fontWeight: active ? 700 : 500,
              padding: "5px 8px", borderRadius: 6,
              color: active ? "#fff" : "rgba(230,236,247,0.55)",
              background: active ? "rgba(168,85,247,0.12)" : "transparent",
              borderLeft: active ? "2px solid #a855f7" : "2px solid transparent",
            }}>
              {label}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{
            padding: 8, borderRadius: 8,
            background: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(59,130,246,0.12))",
            border: "1px solid rgba(168,85,247,0.3)",
            fontSize: 10, color: "#fff",
          }}>
            <div style={{ fontWeight: 800, marginBottom: 2 }}>AZUKA Pro</div>
            <div style={{ color: "rgba(230,236,247,0.65)" }}>Unlock advanced analytics and exclusive features.</div>
            <div style={{
              marginTop: 6, display: "inline-block",
              padding: "3px 8px", borderRadius: 6,
              background: "linear-gradient(135deg, #a855f7, #3b82f6)",
              color: "#fff", fontSize: 10, fontWeight: 700,
            }}>Upgrade</div>
          </div>
        </div>

        {/* Feed column */}
        <div style={{
          padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.05)",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {/* Composer */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", borderRadius: 10,
            border: "1px solid rgba(168,85,247,0.2)",
            background: "rgba(168,85,247,0.04)",
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: "50%",
              background: "linear-gradient(135deg, #a855f7, #3b82f6)",
            }} />
            <span style={{ fontSize: 12, color: "rgba(230,236,247,0.5)" }}>What's on your mind?</span>
          </div>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: "rgba(230,236,247,0.55)" }}>
            <span style={{ color: "#fff", fontWeight: 700, borderBottom: "2px solid #a855f7", paddingBottom: 4 }}>For You</span>
            <span>Following</span>
            <span>Alpha</span>
            <span>News</span>
            <span>Alerts</span>
          </div>
          {/* Cards — cycled by LiveFeed so the preview animates
              continuously. Same visual density as the static version,
              just with rotation + a periodic "new posts" ticker. */}
          <LiveFeed />
        </div>

        {/* Right rail */}
        <div className="ix-prev-hide-mobile" style={{
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {/* Account */}
          <div style={{
            padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: "linear-gradient(135deg, #a855f7, #3b82f6)",
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Shield Holder</div>
                <div style={{ fontSize: 10, color: "rgba(230,236,247,0.5)" }}>@shieldholder</div>
                <div style={{
                  display: "inline-block", marginTop: 3,
                  padding: "1px 6px", borderRadius: 4,
                  background: "rgba(168,85,247,0.18)", color: "#c084fc",
                  fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                }}>IRONSHIELD PRO</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {[["1.2K","Followers"],["342","Following"],["2.4K","Points"]].map(([v, l]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{v}</div>
                  <div style={{ fontSize: 9, color: "rgba(230,236,247,0.5)" }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Market overview */}
          <div style={{
            padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Market Overview</div>
            {[
              ["BTC", "$68,354.21", "+2.41%", "#f7931a"],
              ["ETH", "$3,412.06",  "+1.32%", "#627eea"],
              ["SOL", "$152.96",    "+3.76%", "#8b5cf6"],
              ["IRON", "$1.28",     "+6.21%", "#3b82f6"],
            ].map((row) => (
              <div key={row[0]} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 0", fontSize: 11,
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: row[3] }} />
                <span style={{ fontWeight: 700, width: 36 }}>{row[0]}</span>
                <span style={{ flex: 1, color: "rgba(230,236,247,0.7)", fontFamily: "var(--font-jetbrains-mono), monospace" }}>{row[1]}</span>
                <span style={{ color: "#10b981", fontWeight: 700 }}>{row[2]}</span>
              </div>
            ))}
          </div>

          {/* Trending */}
          <div style={{
            padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Trending</div>
            {[
              ["IronClaw", "12.4K"],
              ["Automations", "8.7K"],
              ["Web3", "7.2K"],
              ["AI Agents", "5.6K"],
            ].map((row, i) => (
              <div key={row[0]} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 0", fontSize: 11,
              }}>
                <span style={{ color: "rgba(230,236,247,0.4)", width: 10, textAlign: "right" }}>{i + 1}</span>
                <span style={{ color: "rgba(230,236,247,0.45)" }}>#</span>
                <span style={{ flex: 1, color: "#fff" }}>{row[0]}</span>
                <span style={{ color: "rgba(230,236,247,0.55)", fontFamily: "var(--font-jetbrains-mono), monospace" }}>{row[1]}</span>
              </div>
            ))}
            <div style={{ textAlign: "center", marginTop: 6, fontSize: 11, color: "#a855f7" }}>View all</div>
          </div>
        </div>
      </div>
    </m.div>
  );
}

function PreviewPost({ name, handle, age, body, likes, replies, reposts, tips, verified, media }) {
  return (
    <div style={{
      padding: 10, borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.05)",
      background: "rgba(255,255,255,0.02)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 26, height: 26, borderRadius: "50%",
          background: "linear-gradient(135deg, #3b82f6, #a855f7)",
        }} />
        <span style={{ fontSize: 12, fontWeight: 700 }}>{name}</span>
        {verified && <CheckCircle2 size={11} color="#a855f7" />}
        <span style={{ fontSize: 11, color: "rgba(230,236,247,0.4)" }}>{handle} · {age}</span>
      </div>
      <div style={{ fontSize: 12, color: "rgba(230,236,247,0.85)", lineHeight: 1.55, marginLeft: 34 }}>
        {body}
      </div>
      {media && (
        <div style={{
          marginTop: 8, marginLeft: 34,
          height: 90, borderRadius: 8,
          background: "linear-gradient(135deg, #1f2937 0%, #111827 50%, #0f172a 100%)",
          border: "1px solid rgba(255,255,255,0.05)",
          position: "relative", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontSize: 16, fontWeight: 900, letterSpacing: 0.6,
            color: "rgba(255,255,255,0.75)",
            textShadow: "0 2px 10px rgba(168,85,247,0.4)",
          }}>IRONCLAW</span>
          <span style={{
            position: "absolute", bottom: 6, left: 8,
            fontSize: 8, letterSpacing: 2, color: "rgba(168,85,247,0.8)",
          }}>AUTOMATED GOVERNANCE</span>
        </div>
      )}
      <div style={{
        display: "flex", gap: 14, marginTop: 8, marginLeft: 34,
        fontSize: 11, color: "rgba(230,236,247,0.55)",
      }}>
        <span>💬 {replies}</span>
        <span>🔁 {reposts}</span>
        <span style={{ color: "#ef4444" }}>♥ {likes}</span>
        <span style={{ color: "#3b82f6", fontFamily: "var(--font-jetbrains-mono), monospace" }}>💎 IRON {tips}</span>
      </div>
    </div>
  );
}

/* ─────────── LIVE FEED (animated preview) ───────────
 * Rotates from a pool of posts every few seconds so the dashboard
 * preview doesn't read as a static mock. Also:
 *   · the top card's like counter ticks upward on its own
 *   · a "N new posts" pill slides in periodically; clicking or the
 *     next rotation dismisses it
 * Effects respect prefers-reduced-motion by virtue of the framer
 * variants — the shell CSS already disables their transition. */

const LIVE_POOL = [
  { name: "MEEK",       handle: "@meekblaze",    age: "3h",  body: "GM Shields 🛡",
    likes: 42, replies: 12, reposts: 8,  tips: 12.4 },
  { name: "Miracles",   handle: "@32b790ba7bae", age: "1d",
    body: (<>A post a day keeps your feed away from slops.<br />Stay sharp, stay consistent, stay visible.</>),
    likes: 81, replies: 24, reposts: 16, tips: 21.7, media: true },
  { name: "Shield Claw", handle: "@shieldclaw",  age: "18h", verified: true,
    body: (<>imminent <span role="img" aria-label="shield">🛡️</span> <span role="img" aria-label="magic">✨</span></>),
    likes: 52, replies: 15, reposts: 11, tips: 17.3 },
  { name: "punk9059",   handle: "@punk9059",     age: "2m",  verified: true,
    body: "NEAR is quietly becoming the AI-chain nobody books. The automations flipped me.",
    likes: 18, replies: 4, reposts: 2, tips: 3.1 },
  { name: "Young001",   handle: "@unknown",      age: "5h",
    body: "Spent 20min setting up an AI Trend Monitor — already fired 3 signals before coffee.",
    likes: 26, replies: 6, reposts: 3, tips: 4.2 },
  { name: "icebergy_",  handle: "@icebergy_",    age: "17m",
    body: "bought 2 NEAR on that dip. small. but the thesis keeps compounding.",
    likes: 34, replies: 9, reposts: 5, tips: 8.8 },
];

function LiveFeed() {
  const [offset, setOffset] = useState(0);
  const [newPill, setNewPill] = useState(0); // 0 = hidden, >0 = "N new"
  const [topLikes, setTopLikes] = useState(LIVE_POOL[0].likes);

  // Rotate the visible window of 3 every 6.5s.
  useEffect(() => {
    const id = setInterval(() => {
      setOffset((o) => (o + 1) % LIVE_POOL.length);
      setTopLikes(LIVE_POOL[(offset + 1) % LIVE_POOL.length].likes);
    }, 6500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every ~15s surface a "new posts" pill. Auto-dismiss after 4s
  // or when the next rotation arrives.
  useEffect(() => {
    const fire = () => setNewPill(Math.floor(Math.random() * 4) + 1);
    const id = setInterval(fire, 15_000);
    const t = setTimeout(fire, 3_000); // first appearance soon after mount
    return () => { clearInterval(id); clearTimeout(t); };
  }, []);
  useEffect(() => {
    if (!newPill) return;
    const id = setTimeout(() => setNewPill(0), 4200);
    return () => clearTimeout(id);
  }, [newPill]);

  // Tiny tick on the top card's likes counter so it feels alive
  // without being noisy.
  useEffect(() => {
    const id = setInterval(() => {
      if (Math.random() < 0.45) setTopLikes((v) => v + 1);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => {
    const n = LIVE_POOL.length;
    return [0, 1, 2].map((i) => LIVE_POOL[(offset + i) % n]);
  }, [offset]);

  return (
    <div style={{ position: "relative" }}>
      {/* New-posts ticker */}
      <AnimatePresence>
        {newPill > 0 && (
          <m.button
            type="button"
            key="ticker"
            initial={{ opacity: 0, y: -6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{    opacity: 0, y: -6, scale: 0.95 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={() => setNewPill(0)}
            style={{
              position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)",
              zIndex: 2,
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 999,
              background: "linear-gradient(135deg, #6d28d9, #3b82f6)",
              color: "#fff", border: "none", cursor: "pointer",
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              boxShadow: "0 12px 28px rgba(109,40,217,0.45)",
            }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "#fff",
              boxShadow: "0 0 8px #fff",
              animation: "ix-live-blink 1.4s ease-in-out infinite",
            }} />
            {newPill} new post{newPill > 1 ? "s" : ""}
          </m.button>
        )}
      </AnimatePresence>

      <style jsx global>{`
        @keyframes ix-live-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>

      <AnimatePresence mode="popLayout" initial={false}>
        {visible.map((p, i) => (
          <m.div
            key={`${offset}-${i}-${p.handle}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{    opacity: 0, y: -6 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            style={{ position: "relative", marginBottom: 10 }}
          >
            <PreviewPost
              {...p}
              // Live tick only on the top card; others keep their
              // pool-defined numbers so the rotation reads clean.
              likes={i === 0 ? topLikes : p.likes}
            />
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ─────────── STATS + CTA ─────────── */

function StatsAndCTA() {
  return (
    <section style={{ padding: "clamp(32px, 6vh, 60px) clamp(16px, 4vw, 32px)" }}>
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        padding: "26px 24px",
        borderRadius: 18,
        border: "1px solid rgba(168,85,247,0.3)",
        background: "linear-gradient(180deg, rgba(168,85,247,0.08), rgba(59,130,246,0.04) 60%, transparent), rgba(10,15,31,0.8)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 30px 80px rgba(168,85,247,0.12)",
        display: "grid", gap: 26,
      }} className="ix-stats-grid">
        <div style={{
          display: "grid", gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        }}>
          {STATS.map((s, i) => <StatTile key={s.label} stat={s} index={i} />)}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{
              margin: "0 0 6px",
              fontSize: "clamp(22px, 3vw, 30px)",
              fontWeight: 800, color: "#fff", letterSpacing: -0.4, lineHeight: 1.1,
            }}>
              Ready to join the future?
            </h3>
            <p style={{ fontSize: 14, color: "rgba(230,236,247,0.65)", margin: "0 0 14px", lineHeight: 1.5 }}>
              Become a Shield today and start building, earning, and automating on Web3.
            </p>
            <HeroCta primary href="/feed">Launch App <ArrowUpRight size={14} /></HeroCta>
          </div>
          <div className="ix-cta-mascot" style={{
            width: 140, height: 140, flexShrink: 0, position: "relative",
          }}>
            <div aria-hidden style={{
              position: "absolute", inset: -10, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(168,85,247,0.4), transparent 65%)",
              filter: "blur(20px)",
            }} />
            <img src="/mascot.webp" alt="" width={140} height={210} decoding="async" loading="lazy" style={{
              width: "100%", height: "100%", objectFit: "contain",
              animation: "ix-breathe 5s ease-in-out infinite",
              position: "relative", zIndex: 1,
            }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatTile({ stat, index }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const duration = 1400;
    const start = performance.now();
    const target = stat.value;
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, stat.value]);

  const { Icon } = stat;
  const display = (() => {
    const scaled = stat.scale ? val / stat.scale : val;
    if (stat.value >= 1_000_000 && !stat.scale) {
      return `${(scaled / 1_000_000).toFixed(scaled < 10_000_000 ? 1 : 0)}M`;
    }
    if (stat.value >= 1000 && !stat.scale) {
      return `${Math.round(scaled / 1000)}K`;
    }
    return `${Math.round(scaled)}`;
  })();

  return (
    <m.div
      ref={ref}
      initial={{ opacity: 0, y: 14 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: 0.05 * index }}
      style={{
        padding: 16, borderRadius: 14,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.05)",
        textAlign: "center",
      }}
    >
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 36, height: 36, borderRadius: 10,
        background: "rgba(168,85,247,0.12)", color: "#c084fc",
        border: "1px solid rgba(168,85,247,0.3)",
        marginBottom: 8,
      }}>
        <Icon size={16} />
      </span>
      <div style={{
        fontSize: "clamp(26px, 3.5vw, 34px)", fontWeight: 800,
        color: "#fff", letterSpacing: -0.4,
        fontFamily: "var(--font-jetbrains-mono), monospace",
      }}>
        {stat.prefix || ""}{display}{stat.suffix}
      </div>
      <div style={{ fontSize: 11, color: "rgba(230,236,247,0.6)", marginTop: 4, letterSpacing: 0.4 }}>
        {stat.label}
      </div>
    </m.div>
  );
}

/* ─────────── EMAIL SUBSCRIBE ─────────── */

function EmailSubscribe() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | ok | err
  const onSubmit = (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setState("err"); return; }
    setState("ok"); setEmail("");
    setTimeout(() => setState("idle"), 3000);
  };

  return (
    <section style={{ padding: "clamp(24px, 5vh, 48px) clamp(16px, 4vw, 32px)" }}>
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        padding: "20px 24px",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.015)",
        display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 3 }}>
            Stay updated with AZUKA
          </div>
          <div style={{ fontSize: 13, color: "rgba(230,236,247,0.6)" }}>
            Get the latest updates, product drops, and alpha straight to your inbox.
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, minWidth: 320, flex: 1 }}>
          <div style={{
            flex: 1,
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 12px", borderRadius: 10,
            border: `1px solid ${state === "err" ? "#ef4444" : "rgba(255,255,255,0.08)"}`,
            background: "rgba(255,255,255,0.02)",
            transition: "border-color 160ms ease, box-shadow 160ms ease",
          }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "#a855f7"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(168,85,247,0.18)"; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <Send size={13} color="#a855f7" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "#fff", fontSize: 14, fontFamily: "inherit",
              }}
            />
          </div>
          <button type="submit" style={{
            padding: "10px 18px", borderRadius: 10, border: "none",
            background: state === "ok"
              ? "linear-gradient(135deg, #10b981, #059669)"
              : "linear-gradient(135deg, #6d28d9, #3b82f6)",
            color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 10px 24px rgba(109,40,217,0.45)",
            transition: "transform 140ms ease",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            {state === "ok" ? "Subscribed ✓" : "Subscribe"}
          </button>
        </form>

        <div style={{ display: "flex", gap: 8 }}>
          <SocialBtn href="https://x.com/ironclaw" Icon={XTwitter} />
          <SocialBtn href="https://t.me/IronClawHQ" Icon={Send} />
          <SocialBtn href="#discord" Icon={MessageCircle} />
          <SocialBtn href="https://github.com/nearai/ironclaw" Icon={GitBranch} />
        </div>
      </div>
    </section>
  );
}

// lucide-react in our repo doesn't ship a Twitter/X glyph; draw the
// 𝕏 mark ourselves so the socials row matches the rest of the stroke
// weight without pulling in an extra icon pack.
function XTwitter(props) {
  return (
    <svg viewBox="0 0 24 24" width={props.size || 14} height={props.size || 14} fill="currentColor" {...props}>
      <path d="M18.244 2H21l-6.52 7.45L22 22h-6.77l-5.3-6.59L3.8 22H1.04l7-7.98L1 2h6.91l4.79 6.02L18.244 2Zm-2.37 18h1.88L8.23 4H6.24l9.634 16Z" />
    </svg>
  );
}

function SocialBtn({ href, Icon }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{
      width: 38, height: 38, borderRadius: "50%",
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.03)",
      color: "rgba(230,236,247,0.7)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      textDecoration: "none",
      transition: "color 160ms, border-color 160ms, transform 160ms",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(168,85,247,0.5)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(230,236,247,0.7)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <Icon size={15} />
    </a>
  );
}

/* ─────────── FOOTER ─────────── */

function Footer() {
  return (
    <footer style={{
      padding: "30px clamp(16px, 4vw, 32px) 40px",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      marginTop: 24,
    }}>
      <div style={{
        maxWidth: 1280, margin: "0 auto",
        display: "grid", gap: 28,
      }} className="ix-footer-grid">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <BrandMark size={28} />
            <span style={{ fontSize: 16, fontWeight: 800 }}>AZUKA</span>
          </div>
          <p style={{ fontSize: 13, color: "rgba(230,236,247,0.55)", lineHeight: 1.6, margin: 0, maxWidth: 320 }}>
            The Web3 Social Operating System. Connect. Create. Automate. Govern. All in One Place.
          </p>
        </div>
        {FOOTER_COLUMNS.map((c) => (
          <div key={c.title}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "rgba(230,236,247,0.55)", textTransform: "uppercase", marginBottom: 10 }}>
              {c.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {c.links.map(([label, href]) => (
                <a key={label} href={href} style={{
                  fontSize: 13, color: "rgba(230,236,247,0.7)", textDecoration: "none",
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(230,236,247,0.7)"; }}
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 28, paddingTop: 18,
        borderTop: "1px solid rgba(255,255,255,0.05)",
        maxWidth: 1280, margin: "28px auto 0",
        fontSize: 12, color: "rgba(230,236,247,0.45)",
        display: "flex", flexWrap: "wrap", gap: 10,
      }}>
        <span>© {new Date().getFullYear()} AZUKA.</span>
        <span>All rights reserved.</span>
      </div>
    </footer>
  );
}

/* ─────────── FEATURE GRID ─────────── */

const FEATURE_CARDS = [
  { Icon: Bot,    color: "#60a5fa", title: "AI Agents",
    desc: "Deploy personal agents that monitor the chain, automate trades, and summarize alpha — 24/7." },
  { Icon: Users,  color: "#a855f7", title: "Governance",
    desc: "Vote on proposals, shape protocol direction, and earn rewards for active participation." },
  { Icon: Star,   color: "#10b981", title: "Rewards",
    desc: "Complete missions, climb the leaderboard, and unlock exclusive on-chain drops." },
  { Icon: Shield, color: "#f59e0b", title: "Secure by Design",
    desc: "Non-custodial by default. Every action is verifiable on-chain — your keys, your rules." },
];

function FeatureGrid() {
  return (
    <section style={{ padding: "clamp(40px, 7vh, 80px) clamp(16px, 4vw, 32px)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <Eyebrow>What&apos;s Inside</Eyebrow>
          <h2 style={{
            margin: "14px auto 10px", maxWidth: 720,
            fontSize: "clamp(30px, 4vw, 46px)", fontWeight: 800,
            lineHeight: 1.08, color: "#fff", letterSpacing: -0.6,
          }}>
            Everything you need, powered by{" "}
            <span style={{
              background: "linear-gradient(90deg, #60a5fa, #a855f7)",
              WebkitBackgroundClip: "text", backgroundClip: "text",
              WebkitTextFillColor: "transparent", color: "transparent",
            }}>Web3</span>
          </h2>
          <p style={{
            fontSize: 15, color: "rgba(230,236,247,0.6)",
            margin: "0 auto", maxWidth: 560, lineHeight: 1.55,
          }}>
            Four pillars that make AZUKA the most complete platform for Web3 social,
            automation, and governance.
          </p>
        </div>
        <div className="ix-feat-grid">
          {FEATURE_CARDS.map((c, i) => <FeatureCard key={c.title} card={c} index={i} />)}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ card, index }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const { Icon } = card;
  return (
    <m.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: 0.06 * index, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "relative",
        padding: 22, borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
        overflow: "hidden",
        transition: "transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.borderColor = `${card.color}55`;
        e.currentTarget.style.boxShadow = `0 20px 48px ${card.color}22`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div aria-hidden style={{
        position: "absolute", top: -40, right: -40,
        width: 140, height: 140, borderRadius: "50%",
        background: `radial-gradient(circle, ${card.color}30, transparent 65%)`,
        filter: "blur(24px)",
      }} />
      <span style={{
        position: "relative",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 44, height: 44, borderRadius: 12,
        background: `${card.color}1a`, color: card.color,
        border: `1px solid ${card.color}44`,
        marginBottom: 14,
      }}>
        <Icon size={20} />
      </span>
      <div style={{
        position: "relative", fontSize: 17, fontWeight: 800,
        color: "#fff", marginBottom: 6, letterSpacing: -0.2,
      }}>
        {card.title}
      </div>
      <div style={{
        position: "relative", fontSize: 13,
        color: "rgba(230,236,247,0.6)", lineHeight: 1.6,
      }}>
        {card.desc}
      </div>
    </m.div>
  );
}

/* ─────────── TESTIMONIALS ─────────── */

const TESTIMONIALS = [
  { name: "0xBuilder", handle: "@0xbuilder", role: "Smart contract engineer",
    quote: "AZUKA is the first platform where I can ship, vote, and earn from one dashboard. The agent automations alone pay for themselves.",
    rating: 5 },
  { name: "DeFiQueen", handle: "@defiqueen", role: "DeFi strategist",
    quote: "The community-run AI feels like actual governance, not theater. My portfolio automations caught two reversals before I even woke up.",
    rating: 5 },
  { name: "ChainLegend", handle: "@chainlegend", role: "L2 researcher",
    quote: "Finally — a Web3 social app that isn't just a Twitter clone. The agent + governance combo is the right primitive for the next cycle.",
    rating: 5 },
];

function Testimonials() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive((a) => (a + 1) % TESTIMONIALS.length), 7000);
    return () => clearInterval(id);
  }, []);
  return (
    <section style={{ padding: "clamp(40px, 7vh, 80px) clamp(16px, 4vw, 32px)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <Eyebrow>Loved by Builders</Eyebrow>
          <h2 style={{
            margin: "14px auto 10px", maxWidth: 680,
            fontSize: "clamp(30px, 4vw, 46px)", fontWeight: 800,
            lineHeight: 1.08, color: "#fff", letterSpacing: -0.6,
          }}>
            Trusted by the Web3 community
          </h2>
        </div>
        <div className="ix-test-grid">
          {TESTIMONIALS.map((t, i) => (
            <TestimonialCard key={t.handle} t={t} active={active === i} index={i} />
          ))}
        </div>
        <div style={{
          display: "flex", justifyContent: "center", gap: 8, marginTop: 24,
        }}>
          {TESTIMONIALS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show testimonial ${i + 1}`}
              style={{
                width: active === i ? 24 : 8, height: 8, borderRadius: 999,
                border: "none", cursor: "pointer", padding: 0,
                background: active === i
                  ? "linear-gradient(90deg, #a855f7, #3b82f6)"
                  : "rgba(255,255,255,0.12)",
                transition: "width 240ms ease, background 240ms ease",
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({ t, active, index }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  return (
    <m.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: 0.08 * index, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "relative",
        padding: 22, borderRadius: 16,
        border: `1px solid ${active ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.06)"}`,
        background: active
          ? "linear-gradient(180deg, rgba(168,85,247,0.08), rgba(59,130,246,0.04))"
          : "rgba(255,255,255,0.02)",
        boxShadow: active ? "0 20px 48px rgba(168,85,247,0.2)" : "none",
        transform: active ? "translateY(-2px)" : "translateY(0)",
        transition: "border-color 260ms ease, background 260ms ease, box-shadow 260ms ease, transform 260ms ease",
      }}
    >
      <div style={{ display: "flex", gap: 2, marginBottom: 12 }}>
        {Array.from({ length: t.rating }).map((_, i) => (
          <Star key={i} size={14} color="#f59e0b" fill="#f59e0b" />
        ))}
      </div>
      <p style={{
        fontSize: 14.5, lineHeight: 1.6,
        color: "rgba(230,236,247,0.86)", margin: "0 0 18px",
      }}>
        &ldquo;{t.quote}&rdquo;
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: "50%",
          background: "linear-gradient(135deg, #a855f7, #3b82f6)",
          flexShrink: 0,
        }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{t.name}</div>
          <div style={{ fontSize: 11, color: "rgba(230,236,247,0.55)" }}>
            {t.handle} · {t.role}
          </div>
        </div>
      </div>
    </m.div>
  );
}

/* ─────────── ECOSYSTEM GRID ─────────── */

const ECOSYSTEM_TILES = [
  { Icon: ArrowLeftRight, color: "#60a5fa", title: "Bridge", href: "/bridge",
    stat: "6 chains",
    desc: "Move assets across Ethereum, Solana, Base, Arbitrum, Avalanche, and NEAR." },
  { Icon: Coins, color: "#a855f7", title: "Staking", href: "/staking",
    stat: "12% APY",
    desc: "Stake $IRONCLAW, secure the network, and earn a share of protocol revenue." },
  { Icon: Activity, color: "#10b981", title: "Analytics", href: "/portfolio",
    stat: "Real-time",
    desc: "Live dashboards, portfolio performance, and market sentiment in one view." },
  { Icon: Briefcase, color: "#f59e0b", title: "Marketplace", href: "/automations",
    stat: "120+ templates",
    desc: "Discover AI agent templates, automations, and community workflows." },
];

function EcosystemGrid() {
  return (
    <section id="ecosystem" style={{ padding: "clamp(40px, 7vh, 80px) clamp(16px, 4vw, 32px)" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <Eyebrow>One Platform</Eyebrow>
          <h2 style={{
            margin: "14px auto 10px", maxWidth: 720,
            fontSize: "clamp(30px, 4vw, 46px)", fontWeight: 800,
            lineHeight: 1.08, color: "#fff", letterSpacing: -0.6,
          }}>
            Powering the future of{" "}
            <span style={{
              background: "linear-gradient(90deg, #60a5fa, #a855f7)",
              WebkitBackgroundClip: "text", backgroundClip: "text",
              WebkitTextFillColor: "transparent", color: "transparent",
            }}>Web3</span>
          </h2>
          <p style={{
            fontSize: 15, color: "rgba(230,236,247,0.6)",
            margin: "0 auto", maxWidth: 560, lineHeight: 1.55,
          }}>
            Bridge, stake, analyze, and automate — every surface you need, natively integrated.
          </p>
        </div>
        <div className="ix-eco-grid">
          {ECOSYSTEM_TILES.map((t, i) => <EcosystemTile key={t.title} tile={t} index={i} />)}
        </div>
      </div>
    </section>
  );
}

function EcosystemTile({ tile, index }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const { Icon } = tile;
  return (
    <m.a
      ref={ref}
      href={tile.href}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: 0.06 * index, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "relative",
        display: "flex", flexDirection: "column", gap: 10,
        padding: 20, borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
        textDecoration: "none", color: "inherit",
        overflow: "hidden", minHeight: 200,
        transition: "transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.borderColor = `${tile.color}55`;
        e.currentTarget.style.boxShadow = `0 20px 48px ${tile.color}22`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div aria-hidden style={{
        position: "absolute", bottom: -40, left: -40,
        width: 140, height: 140, borderRadius: "50%",
        background: `radial-gradient(circle, ${tile.color}30, transparent 65%)`,
        filter: "blur(24px)",
      }} />
      <div style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 40, height: 40, borderRadius: 10,
          background: `${tile.color}1a`, color: tile.color,
          border: `1px solid ${tile.color}44`,
        }}>
          <Icon size={18} />
        </span>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
          padding: "3px 8px", borderRadius: 999,
          background: `${tile.color}14`, color: tile.color,
          border: `1px solid ${tile.color}33`,
          textTransform: "uppercase",
        }}>{tile.stat}</span>
      </div>
      <div style={{
        position: "relative", fontSize: 17, fontWeight: 800,
        color: "#fff", letterSpacing: -0.2,
      }}>
        {tile.title}
      </div>
      <div style={{
        position: "relative", fontSize: 13,
        color: "rgba(230,236,247,0.6)", lineHeight: 1.55, flex: 1,
      }}>
        {tile.desc}
      </div>
      <div style={{
        position: "relative",
        display: "inline-flex", alignItems: "center", gap: 4,
        marginTop: 4, fontSize: 12, fontWeight: 700, color: tile.color,
      }}>
        Explore <ArrowUpRight size={12} />
      </div>
    </m.a>
  );
}
