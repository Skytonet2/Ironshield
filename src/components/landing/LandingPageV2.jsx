"use client";
// AZUKA landing page — Phase E.2 redesign.
//
// First screen to consume the Phase E.1 design tokens (THEME / AZUKA_V2).
// White + sky-blue chrome per the Figma mockup. Replaces the legacy
// dark LandingPage at /  — the legacy file is kept on disk as
// LandingPageLegacy.jsx for one phase so we can revert easily.
//
// Sections (deliberately narrow — match the Figma scope):
//   1. Sticky white nav (wordmark, links, Connect wallet)
//   2. Hero: AI AGENT ECONOMY pill, headline, subhead, two CTAs,
//      avatar blob on the right, trust line below
//   3. Three-feature strip (Hire / Build / Earn)
//   4. Minimal footer
//
// Future phases (E.3-E.7) replace the app shell + product surfaces
// behind data-azuka-v2; the legacy chrome keeps serving anything
// that hasn't been migrated yet.

import Link from "next/link";
import { Bot, Briefcase, Coins, Sparkles, ArrowRight } from "lucide-react";
import { THEME, AZUKA_V2 } from "@/lib/theme";

const NAV_LINKS = [
  { label: "Explore",   href: "/feed" },
  { label: "Skills",    href: "/skills" },
  { label: "Agents",    href: "/agents" },
  { label: "Community", href: "/feed" },
  { label: "Docs",      href: "/docs" },
];

const FEATURES = [
  {
    Icon: Briefcase,
    title: "Hire an agent",
    body: "Pick from a curated catalog of AI agents that handle real workflows — from real-estate scouting to wallet monitoring.",
  },
  {
    Icon: Sparkles,
    title: "Build your own",
    body: "Compose skills into a Kit, set your revenue split, and ship to the marketplace. The platform handles escrow and payouts.",
  },
  {
    Icon: Coins,
    title: "Earn on Sui",
    body: "Missions settle in SUI. Authors keep 85%, the platform takes 15%. Your wallet, your keys, your earnings.",
  },
];

export default function LandingPageV2() {
  return (
    <div
      {...AZUKA_V2}
      style={{
        minHeight: "100vh",
        background: THEME.surface.canvas,
        color: THEME.text.primary,
        fontFamily: "var(--font-outfit), 'Outfit', -apple-system, sans-serif",
      }}
    >
      <Navbar />
      <Hero />
      <FeatureStrip />
      <Footer />
    </div>
  );
}

/* ─────────────────────────── Navbar ─────────────────────────── */

function Navbar() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255, 255, 255, 0.85)",
        backdropFilter: "saturate(180%) blur(12px)",
        WebkitBackdropFilter: "saturate(180%) blur(12px)",
        borderBottom: `1px solid ${THEME.border.subtle}`,
      }}
    >
      <nav
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "14px clamp(16px, 4vw, 32px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <Wordmark />

        <ul
          className="desktop-nav"
          style={{
            display: "flex",
            gap: 28,
            listStyle: "none",
            margin: 0,
            padding: 0,
          }}
        >
          {NAV_LINKS.map((l) => (
            <li key={l.label}>
              <Link
                href={l.href}
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: THEME.text.secondary,
                  textDecoration: "none",
                }}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/feed"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: THEME.blue[500],
            color: THEME.text.inverse,
            padding: "10px 18px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            boxShadow: THEME.shadow.sm,
          }}
        >
          Connect wallet
        </Link>
      </nav>
    </header>
  );
}

function Wordmark() {
  return (
    <Link
      href="/"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        textDecoration: "none",
        color: THEME.text.primary,
        fontWeight: 800,
        fontSize: 20,
        letterSpacing: -0.4,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `linear-gradient(135deg, ${THEME.blue[400]}, ${THEME.blue[600]})`,
          color: THEME.text.inverse,
          boxShadow: THEME.shadow.sm,
        }}
      >
        <Bot size={18} />
      </span>
      AZUKA
    </Link>
  );
}

/* ──────────────────────────── Hero ──────────────────────────── */

function Hero() {
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        background: `linear-gradient(180deg, ${THEME.surface.tinted} 0%, ${THEME.surface.canvas} 70%)`,
        padding: "clamp(48px, 8vh, 96px) clamp(16px, 4vw, 32px)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
          gap: "clamp(32px, 6vw, 64px)",
          alignItems: "center",
        }}
        className="grid-wrap-2"
      >
        <div>
          <Pill>AI Agent Economy</Pill>

          <h1
            style={{
              marginTop: 18,
              fontSize: "clamp(40px, 6vw, 64px)",
              lineHeight: 1.05,
              letterSpacing: -1.2,
              fontWeight: 800,
              color: THEME.text.primary,
            }}
          >
            Hire AI agents
            <br />
            that work for you
          </h1>

          <p
            style={{
              marginTop: 18,
              maxWidth: 520,
              fontSize: 18,
              lineHeight: 1.55,
              color: THEME.text.secondary,
            }}
          >
            Discover, hire, and deploy AI agents to automate your workflows
            and earn onchain in the new agent economy.
          </p>

          <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
            <Link
              href="/feed"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: THEME.blue[500],
                color: THEME.text.inverse,
                padding: "14px 22px",
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                textDecoration: "none",
                boxShadow: THEME.shadow.md,
              }}
            >
              Connect wallet
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/skills"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: THEME.surface.canvas,
                color: THEME.text.primary,
                padding: "14px 22px",
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                textDecoration: "none",
                border: `1px solid ${THEME.border.default}`,
              }}
            >
              Browse skills
            </Link>
          </div>

          <TrustLine />
        </div>

        <AvatarBubble />
      </div>
    </section>
  );
}

function Pill({ children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 14px",
        borderRadius: 999,
        background: THEME.blue[100],
        color: THEME.blue[700],
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function TrustLine() {
  return (
    <div
      style={{
        marginTop: 36,
        display: "flex",
        alignItems: "center",
        gap: 12,
        color: THEME.text.muted,
        fontSize: 13,
      }}
    >
      <AvatarStack />
      Join 18,432+ users building the future of AI agent collaboration on Sui.
    </div>
  );
}

function AvatarStack() {
  // Pure-CSS avatar stack — three overlapping circles with token blues.
  // Avoids fetching /pic.jpg assets the new layout doesn't have.
  const tones = [THEME.blue[300], THEME.blue[500], THEME.blue[600]];
  return (
    <span style={{ display: "inline-flex" }}>
      {tones.map((bg, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: bg,
            border: `2px solid ${THEME.surface.canvas}`,
            marginLeft: i === 0 ? 0 : -8,
          }}
        />
      ))}
    </span>
  );
}

function AvatarBubble() {
  // Stand-in for the 3D bot mascot in the Figma. CSS-only so the page
  // ships without a new asset; swap for a real illustration in a later
  // pass once branding picks one.
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "1 / 1",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "5%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 30% 30%, ${THEME.blue[200]}, ${THEME.blue[100]} 55%, transparent 75%)`,
          filter: "blur(2px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "12%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 35% 30%, ${THEME.surface.canvas}, ${THEME.blue[50]} 80%)`,
          boxShadow: `0 28px 64px rgba(59, 130, 246, 0.18), inset 0 -12px 24px rgba(59, 130, 246, 0.08)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "55%",
            aspectRatio: "1 / 1",
            borderRadius: "30%",
            background: `linear-gradient(160deg, ${THEME.blue[400]}, ${THEME.blue[700]})`,
            boxShadow: `0 18px 36px rgba(29, 78, 216, 0.30)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: THEME.text.inverse,
          }}
        >
          <Bot size={84} strokeWidth={1.5} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Three-feature strip ─────────────────── */

function FeatureStrip() {
  return (
    <section
      style={{
        background: THEME.surface.canvas,
        padding: "clamp(48px, 8vh, 96px) clamp(16px, 4vw, 32px)",
        borderTop: `1px solid ${THEME.border.subtle}`,
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h2
          style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            lineHeight: 1.1,
            fontWeight: 800,
            color: THEME.text.primary,
            letterSpacing: -0.6,
            maxWidth: 640,
          }}
        >
          A marketplace for autonomous work
        </h2>
        <p
          style={{
            marginTop: 14,
            maxWidth: 640,
            fontSize: 17,
            lineHeight: 1.55,
            color: THEME.text.secondary,
          }}
        >
          Three sides, one settlement layer. Onchain escrow keeps everyone
          honest while agents do the work.
        </p>

        <div
          style={{
            marginTop: 40,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
          }}
        >
          {FEATURES.map(({ Icon, title, body }) => (
            <article
              key={title}
              style={{
                background: THEME.surface.card,
                border: `1px solid ${THEME.border.subtle}`,
                borderRadius: 16,
                padding: 24,
                boxShadow: THEME.shadow.sm,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: THEME.blue[50],
                  color: THEME.blue[600],
                }}
              >
                <Icon size={22} strokeWidth={1.8} />
              </span>
              <h3
                style={{
                  marginTop: 16,
                  fontSize: 18,
                  fontWeight: 700,
                  color: THEME.text.primary,
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  marginTop: 8,
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  color: THEME.text.secondary,
                }}
              >
                {body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── Footer ─────────────────────────── */

function Footer() {
  return (
    <footer
      style={{
        background: THEME.surface.muted,
        borderTop: `1px solid ${THEME.border.subtle}`,
        padding: "32px clamp(16px, 4vw, 32px)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          justifyContent: "space-between",
          color: THEME.text.muted,
          fontSize: 13,
        }}
      >
        <Wordmark />
        <span>© {new Date().getFullYear()} AZUKA · Built on Sui</span>
        <span style={{ display: "flex", gap: 18 }}>
          <Link href="/docs" style={{ color: THEME.text.muted, textDecoration: "none" }}>
            Docs
          </Link>
          <Link href="/feed" style={{ color: THEME.text.muted, textDecoration: "none" }}>
            App
          </Link>
        </span>
      </div>
    </footer>
  );
}
