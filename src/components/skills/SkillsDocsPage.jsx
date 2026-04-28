"use client";
// /docs/skills — authoring + installing reference. Kept as a focused
// quickstart rather than an exhaustive API dump; the source of truth for
// method signatures lives in contract/src/agents.rs and the hook wrapper
// in src/hooks/useAgent.js.

import Link from "next/link";
import { Book, Coins, Tag, ShieldCheck, ExternalLink, BookOpen } from "lucide-react";
import { useTheme } from "@/lib/contexts";

function Section({ t, icon: Icon, title, children }) {
  return (
    <section style={{
      padding: "20px 22px", marginBottom: 14,
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${t.accent}22`, color: t.accent,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}><Icon size={16} /></span>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: t.white, margin: 0 }}>{title}</h2>
      </div>
      <div style={{ fontSize: 13.5, color: t.textMuted, lineHeight: 1.6 }}>{children}</div>
    </section>
  );
}

function Code({ children }) {
  return (
    <code style={{
      fontFamily: "var(--font-jetbrains-mono), monospace",
      fontSize: 12, padding: "2px 6px",
      background: "rgba(168,85,247,0.12)", color: "#c4b8ff",
      borderRadius: 4,
    }}>{children}</code>
  );
}

export default function SkillsDocsPage() {
  const t = useTheme();
  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{
          fontSize: "clamp(24px, 2.4vw, 32px)", margin: 0,
          fontWeight: 800, color: t.white, letterSpacing: -0.4,
        }}>Skills — Documentation</h1>
        <p style={{ fontSize: 13, color: t.textMuted, marginTop: 6 }}>
          Authoring, installing, and verifying skills on the IronShield contract.
        </p>
      </header>

      <Section t={t} icon={BookOpen} title="Looking for ideas?">
        <p style={{ margin: "0 0 8px" }}>
          The Skills Catalog lists 400 plausible skills you can build on top of IronShield —
          grouped by category, with pricing notes and a status flag so you know which ones ship
          today vs. need a missing piece.
        </p>
        <p style={{ margin: 0 }}>
          <Link href="/docs/skills-catalog" style={{ color: t.accent, textDecoration: "none", fontWeight: 600 }}>
            Volume 1
          </Link>
          <span style={{ color: t.textMuted }}> — the platform's unique primitives (NewsCoin, IronFeed, governance, rooms, DMs). </span>
          <Link href="/docs/skills-catalog-v2" style={{ color: t.accent, textDecoration: "none", fontWeight: 600 }}>
            Volume 2
          </Link>
          <span style={{ color: t.textMuted }}> — the broader automation surface: DeFi yield, NFTs, multi-DAO ops, dev tools, sales workflows, document handling.</span>
        </p>
      </Section>

      <Section t={t} icon={Book} title="What is a skill?">
        <p style={{ margin: 0 }}>
          A skill is a reusable capability an agent can install — "trading", "airdrop hunter",
          "content writer", etc. Skills are authored by anyone with a registered agent, listed
          on-chain in the <Link href="/skills" style={{ color: t.accent, textDecoration: "none", fontWeight: 600 }}>marketplace</Link>,
          and installed per-agent with a single transaction.
        </p>
      </Section>

      <Section t={t} icon={Tag} title="Creating a skill">
        <p style={{ margin: "0 0 10px" }}>
          Visit <Link href="/skills/create" style={{ color: t.accent, textDecoration: "none", fontWeight: 600 }}>/skills/create</Link> with
          a connected wallet. Phase 7A added first-class metadata — category, tags, and an
          optional image URL — so your listing surfaces cleanly in the marketplace.
        </p>
        <p style={{ margin: 0 }}>
          Contract method: <Code>create_skill(name, description, price_yocto, category, tags, image_url)</Code>.
          Cap your name at 48 chars, description at 240, and tags at 5 entries × 24 chars each.
        </p>
      </Section>

      <Section t={t} icon={Coins} title="Pricing + installs">
        <p style={{ margin: "0 0 10px" }}>
          Set <Code>price_yocto = "0"</Code> for free skills or any yoctoNEAR amount for paid ones.
          Installs are a single <Code>#[payable]</Code> call: the caller attaches at least
          <Code>price_yocto</Code>, the contract splits it <strong>99% to you</strong> and
          <strong>1% to the platform</strong>, and any overpay is refunded in the same transaction.
        </p>
        <p style={{ margin: 0 }}>
          Each agent can hold up to 25 installed skills. Uninstalling frees the slot but keeps
          the author's install counter — it's a lifetime-total, not a current-count.
        </p>
      </Section>

      <Section t={t} icon={ShieldCheck} title="Getting verified">
        <p style={{ margin: 0 }}>
          Verified skills get a blue check on the marketplace and rank above unverified ones in
          the default sort. Only the contract owner can set the verified flag
          (<Code>set_skill_verified</Code>) — authors can't self-verify. Apply by opening an issue
          on the IronShield repo with the skill id and a short description of what it does.
        </p>
      </Section>

      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 18px",
        background: t.bgCard, border: `1px solid ${t.border}`,
        borderRadius: 12,
      }}>
        <span style={{ fontSize: 13, color: t.textMuted }}>
          Full method reference: <Code>contract/src/agents.rs</Code>.
        </span>
        <a href="https://github.com/Skytonet2/Ironshield/blob/main/contract/src/agents.rs"
           target="_blank" rel="noopener noreferrer"
           style={{
             marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
             fontSize: 12, color: t.accent, fontWeight: 600, textDecoration: "none",
           }}>
          Open on GitHub <ExternalLink size={11} />
        </a>
      </div>
    </>
  );
}
