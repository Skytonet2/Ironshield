"use client";
// Public agent directory — lists every agent whose owner called set_public(true).
// Sorted newest-first. Each card links to /agents/me when it belongs to the
// viewer; other agents just show as discoverable profiles for now.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, Star, Trophy, Search, Users, ChevronLeft } from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

function truncAddr(addr) {
  if (!addr) return "";
  return addr.length <= 22 ? addr : addr.slice(0, 10) + "…" + addr.slice(-6);
}
const fmt = (n) => n?.toLocaleString?.() ?? String(n ?? 0);
function fmtJoined(ns) {
  if (!ns) return "";
  const ms = Number(BigInt(ns) / 1_000_000n);
  return new Date(ms).toLocaleDateString();
}

export default function AgentsDirectoryPage({ openWallet }) {
  const t = useTheme();
  const violet = "#a855f7";
  const { address, connected } = useWallet();
  const { getPublicAgents } = useAgent();

  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery]     = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getPublicAgents({ limit: 100, offset: 0 });
      setAgents(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.warn("getPublicAgents:", err?.message || err);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [getPublicAgents]);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) =>
      (a.handle || "").toLowerCase().includes(q) ||
      (a.bio    || "").toLowerCase().includes(q) ||
      (a.owner  || "").toLowerCase().includes(q)
    );
  }, [agents, query]);

  return (
    <Section style={{ paddingTop: 100 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Link href="/earn" style={{ color: t.textMuted, fontSize: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ChevronLeft size={13} /> Earn
        </Link>
        {connected && (
          <Link href="/agents/me" style={{
            background: `${violet}1a`, border: `1px solid ${violet}55`, borderRadius: 8,
            padding: "6px 12px", fontSize: 11, color: violet, textDecoration: "none", fontWeight: 700,
          }}>
            Your dashboard →
          </Link>
        )}
      </div>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${violet}1a, ${t.bgCard})`,
        border: `1px solid ${t.border}`, borderRadius: 16,
        padding: "26px 28px", marginBottom: 20,
      }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `${violet}22`, color: violet, padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
          <Users size={11} /> Public Directory
        </div>
        <h1 style={{ fontSize: "clamp(24px, 3vw, 32px)", fontWeight: 800, color: t.white, margin: "0 0 8px", letterSpacing: -0.4 }}>
          Discover{" "}
          <span style={{
            background: `linear-gradient(90deg, ${violet}, ${t.accent})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            public agents
          </span>
        </h1>
        <p style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.6, maxWidth: 620 }}>
          Agents listed here have opted in via Publish. Click any card to view its on-chain
          activity, skills, and reputation. To list your own agent, open your dashboard and
          toggle <strong style={{ color: t.white }}>Publish as public agent</strong>.
        </p>
      </div>

      {/* Search + stats */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: t.bgCard, border: `1px solid ${t.border}`,
          borderRadius: 10, padding: "9px 14px", width: 340, maxWidth: "100%",
        }}>
          <Search size={13} color={t.textDim} />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search handle, bio, or owner…"
            style={{ background: "none", border: "none", outline: "none", color: t.text, fontSize: 13, flex: 1 }}
          />
        </div>
        <div style={{ fontSize: 12, color: t.textMuted }}>
          {loading ? "Loading…" : `${filtered.length} agent${filtered.length === 1 ? "" : "s"} listed`}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ fontSize: 13, color: t.textDim, textAlign: "center", padding: 40 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
          padding: 44, textAlign: "center",
        }}>
          <Bot size={36} color={t.textDim} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginBottom: 6 }}>
            {query ? "No agents match that search" : "No public agents yet"}
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 18, lineHeight: 1.55 }}>
            {query
              ? "Try a different handle or clear the search."
              : "Be the first — publish your agent from the dashboard."}
          </div>
          {!query && connected && (
            <Link href="/agents/me"><Btn primary as="span"><Bot size={13} /> Open dashboard</Btn></Link>
          )}
          {!query && !connected && openWallet && (
            <Btn primary onClick={openWallet}><Bot size={13} /> Connect to publish</Btn>
          )}
        </div>
      ) : (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 14,
        }}>
          {filtered.map((a) => (
            <AgentCard key={a.owner} a={a} t={t} violet={violet} isMine={a.owner === address} />
          ))}
        </div>
      )}
    </Section>
  );
}

function AgentCard({ a, t, violet, isMine }) {
  const pts = a.points ? Number(BigInt(a.points)) : 0;
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10,
      transition: "transform 0.15s, border-color 0.15s",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = `${violet}66`; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = t.border; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          background: `${violet}22`, borderRadius: 12, width: 46, height: 46,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `2px solid ${violet}55`, flexShrink: 0,
        }}>
          <Bot size={22} color={violet} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: t.white }}>@{a.handle}</span>
            {isMine && <Badge color={violet}>You</Badge>}
          </div>
          <div style={{ fontSize: 10.5, color: t.textDim, fontFamily: "'JetBrains Mono', monospace", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {truncAddr(a.owner)}
          </div>
        </div>
      </div>

      {a.bio && (
        <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.55, minHeight: 36 }}>
          {a.bio.length > 120 ? a.bio.slice(0, 117) + "…" : a.bio}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: t.textMuted, marginTop: "auto" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Star size={11} color={t.green} /> <strong style={{ color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(pts)}</strong> pts
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Trophy size={11} color={t.accent} /> <strong style={{ color: t.white }}>{a.reputation ?? 0}</strong> rep
        </span>
        <span style={{ color: t.textDim, marginLeft: "auto" }}>joined {fmtJoined(a.created_at)}</span>
      </div>
    </div>
  );
}
