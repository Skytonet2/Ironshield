"use client";
import { useState } from "react";
import { CheckCircle, ExternalLink, Globe, Plus, X, Mail } from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme } from "@/lib/contexts";

export default function EcosystemPage() {
  const t = useTheme();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ project: "", website: "", type: "", email: "", message: "" });
  const [sent, setSent] = useState(false);
  const sendRequest = () => {
    setSent(true); setShowForm(false);
    setTimeout(() => setSent(false), 4000);
  };
  return (
    <Section style={{ paddingTop: 100 }}>
      <div style={{ textAlign: "center", marginBottom: 52 }}>
        <Badge>ECOSYSTEM</Badge>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: t.white, marginTop: 12 }}>Built on NEAR. Open to All.</h1>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10 }}>Strategic allies powering the IronShield network.</p>
      </div>

      {sent && (
        <div style={{ background: `${t.green}18`, border: `1px solid ${t.green}44`, borderRadius: 12, padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle size={16} color={t.green} />
          <span style={{ color: t.green, fontWeight: 600 }}>Partnership request submitted! We'll be in touch.</span>
        </div>
      )}

      {/* NEAR — confirmed partner */}
      <div className="flex-col-responsive" style={{ background: t.bgCard, border: `2px solid ${t.green}44`, borderRadius: 20, padding: 32, marginBottom: 24, display: "flex", alignItems: "center", gap: 28, boxShadow: `0 0 40px ${t.green}12` }}>
        <div style={{ width: 80, height: 80, background: `${t.green}18`, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, flexShrink: 0 }}>🟢</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: t.white }}>NEAR Protocol</div>
            <Badge color={t.green}>OFFICIAL PARTNER</Badge>
          </div>
          <p style={{ fontSize: 15, color: t.textMuted, lineHeight: 1.65, maxWidth: 560 }}>
            IronShield is built natively on NEAR Protocol — the blockchain of choice for scalable, low-cost, developer-friendly Web3 infrastructure. Sub-second finality, Rust contracts, and a thriving ecosystem.
          </p>
          <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
            {[
              { text: "near.org", url: "https://near.org" }, 
              { text: "Wallet Selector", url: "https://github.com/near/wallet-selector" }, 
              { text: "Aurora EVM", url: "https://aurora.dev" }, 
              { text: "Rhea Finance", url: "https://app.rhea.finance/" }
            ].map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: t.textMuted, textDecoration: "none" }}>
                <Globe size={12} color={t.green} />{item.text}
              </a>
            ))}
          </div>
        </div>
        <a href="https://near.org" target="_blank" rel="noopener noreferrer" style={{ background: t.green, color: "#fff", border: "none", borderRadius: 10, padding: "12px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <ExternalLink size={13} /> Visit NEAR
        </a>
      </div>

      {/* Partnership slots */}
      <div className="grid-wrap-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {[
          { slot: "DeFi Partner", desc: "Deep integration with a leading DeFi protocol on NEAR. Discussions underway.", status: "In Talks", icon: "📈" },
          { slot: "Security Audit Partner", desc: "Formal security audit from a top-tier Web3 audit firm. Partnership being finalized.", status: "Coming Soon", icon: "🔒" },
        ].map((p, i) => (
          <div key={i} style={{ background: t.bgCard, border: `1px dashed ${t.border}`, borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 160 }}>
            <div>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{p.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.white, marginBottom: 6 }}>{p.slot}</div>
              <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6 }}>{p.desc}</div>
            </div>
            <Badge color={t.amber} style={{ marginTop: 12, alignSelf: "flex-start" }}>{p.status}</Badge>
          </div>
        ))}
      </div>

      {/* Request partnership */}
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 18, overflow: "hidden" }}>
        <div style={{ padding: "24px 28px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.white }}>Request a Partnership</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}>Building something aligned with IronShield? Let's talk.</div>
          </div>
          <Btn primary onClick={() => setShowForm(!showForm)} style={{ fontSize: 13 }}>
            {showForm ? <X size={14} /> : <Plus size={14} />}{showForm ? "Close" : "Apply"}
          </Btn>
        </div>
        {showForm && (
          <div style={{ padding: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              { key: "project", label: "Project Name *", placeholder: "e.g. MyNearDApp" },
              { key: "website", label: "Website *", placeholder: "https://..." },
              { key: "type", label: "Partnership Type *", placeholder: "e.g. Integration, Marketing, Audit" },
              { key: "email", label: "Contact Email *", placeholder: "contact@project.xyz" },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>{f.label}</div>
                <input value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} style={{
                  width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
                  padding: "10px 12px", color: t.text, fontSize: 13, outline: "none"
                }} />
              </div>
            ))}
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Tell us about the partnership</div>
              <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={4} placeholder="Describe the synergy, how it benefits both ecosystems..." style={{
                width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
                padding: "10px 12px", color: t.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit"
              }} />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <Btn primary onClick={sendRequest} style={{ fontSize: 13 }}><Mail size={14} /> Send Request</Btn>
            </div>
          </div>
        )}
        {!showForm && (
          <div style={{ padding: "20px 28px", display: "flex", flexWrap: "wrap", gap: 32 }}>
            {["Integration", "Co-Marketing", "Treasury Swap", "Security Audit", "Community Guild"].map((type, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: t.textMuted }}>
                <CheckCircle size={13} color={t.green} />{type}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
