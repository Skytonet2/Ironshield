"use client";
import { Badge, Section } from "./Primitives";
import { useTheme } from "@/lib/contexts";

export default function RoadmapPage() {
  const t = useTheme();
  const phases = [
    { month: "1-2", name: "Shield Era", status: "live", color: t.green, emoji: "🛡️", teaser: "The foundation is set. AI-powered protection is live.", hint: "IronShield is active. What you see is just the beginning." },
    { month: "3", name: "Iron-3", status: "building", color: t.accent, emoji: "⚗️", teaser: "Something synthetic is brewing.", hint: "Trade things that don't sleep. More details after launch." },
    { month: "4", name: "Iron Pay", status: "planned", color: t.textMuted, emoji: "💳", teaser: "Payments, reimagined.", hint: "Crypto in. Freedom out. That's all we're saying." },
    { month: "5", name: "Iron Voice", status: "planned", color: t.textMuted, emoji: "🎙️", teaser: "What if you could talk to money?", hint: "Your wallet, your language. Stay tuned." },
    { month: "6", name: "Iron Lens", status: "planned", color: t.textMuted, emoji: "🔍", teaser: "The truth about any project.", hint: "Copy-paste. Wait. Know. That's the pitch." },
    { month: "7", name: "Iron Escrow", status: "planned", color: t.textMuted, emoji: "🤝", teaser: "Trust without trust.", hint: "Peer-to-peer. AI-mediated. Immutable. Nothing else to share yet." },
    { month: "8", name: "Iron Index", status: "planned", color: t.textMuted, emoji: "📊", teaser: "Portfolio intelligence, governed by you.", hint: "The algo votes. So do you. Details locked." },
    { month: "9-12", name: "Platform Era", status: "planned", color: t.textMuted, emoji: "🌐", teaser: "Every tool. Every chain. Every developer.", hint: "This is where it all becomes infrastructure." },
  ];
  return (
    <Section style={{ paddingTop: 100 }}>
      <div style={{ textAlign: "center", marginBottom: 52 }}>
        <Badge>12-MONTH PIPELINE</Badge>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: t.white, marginTop: 12 }}>The Roadmap</h1>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 480, margin: "10px auto 0" }}>
          We show you the destination. Not every step of the journey — those details are earned, not announced.
        </p>
      </div>
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: 25, top: 0, bottom: 0, width: 2, background: `linear-gradient(to bottom, ${t.green}, ${t.border}55)` }} />
        {phases.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 24, marginBottom: 20, position: "relative" }}>
            <div style={{
              width: 52, height: 52, borderRadius: "50%", background: `${p.color}18`, border: `2px solid ${p.color}`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1, fontSize: 20,
            }}>{p.emoji}</div>
            <div style={{ flex: 1, background: t.bgCard, border: `1px solid ${p.status === "live" ? t.green : t.border}`, borderRadius: 14, padding: 22, transition: "all 0.3s", boxShadow: p.status === "live" ? `0 0 20px ${t.green}18` : "none" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = p.color; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = p.status === "live" ? t.green : t.border; }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 11, color: t.textDim, fontFamily: "'JetBrains Mono', monospace" }}>M{p.month}</span>
                  <div style={{ fontSize: 17, fontWeight: 700, color: t.white }}>{p.name}</div>
                </div>
                <Badge color={p.status === "live" ? t.green : p.status === "building" ? t.accent : t.textDim}>
                  {p.status === "live" ? "🟢 LIVE" : p.status === "building" ? "🔨 BUILDING" : "PLANNED"}
                </Badge>
              </div>
              <p style={{ fontSize: 14, color: p.status === "live" ? t.text : t.textMuted, fontWeight: p.status === "live" ? 500 : 400, lineHeight: 1.65, marginBottom: 8 }}>{p.teaser}</p>
              <p style={{ fontSize: 12, color: t.textDim, fontStyle: "italic" }}>"{p.hint}"</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
