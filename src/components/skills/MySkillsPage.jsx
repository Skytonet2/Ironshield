"use client";
// /skills/mine — skills the connected wallet has installed. Reads the
// on-chain list via useAgent.getInstalledSkillsWithMetadata so the
// category/tags/verified badge shipped in Phase 7A render without an
// N+1 lookup per row.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Package, ExternalLink, Loader2, Wallet, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

function truncAddr(a) {
  if (!a) return "";
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function formatNear(yocto) {
  try {
    const v = BigInt(yocto || 0);
    if (v === 0n) return "Free";
    const whole = v / 1_000_000_000_000_000_000_000_000n;
    const frac  = v % 1_000_000_000_000_000_000_000_000n;
    if (frac === 0n) return `${whole} NEAR`;
    const fracStr = frac.toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
    return `${whole}${fracStr ? "." + fracStr : ""} NEAR`;
  } catch { return "—"; }
}

export default function MySkillsPage() {
  const t = useTheme();
  const { connected, address, showModal } = useWallet?.() || {};
  const agent = useAgent();
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const load = useCallback(async () => {
    if (!address) { setRows([]); return; }
    setLoading(true);
    setError(null);
    try {
      const items = await agentRef.current.getInstalledSkillsWithMetadata(address);
      setRows(Array.isArray(items) ? items : []);
    } catch (err) {
      setError(err?.message || "Failed to load installed skills");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { load(); }, [load]);

  const handleUninstall = useCallback(async (skillId) => {
    if (typeof window !== "undefined" && !window.confirm("Uninstall this skill?")) return;
    setRemovingId(skillId);
    try {
      await agentRef.current.uninstallSkill(skillId);
      await load();
    } catch (err) {
      setError(err?.message || "Failed to uninstall");
    } finally {
      setRemovingId(null);
    }
  }, [load]);

  return (
    <>
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, marginBottom: 24, flexWrap: "wrap",
      }}>
        <div>
          <h1 style={{
            fontSize: "clamp(24px, 2.4vw, 32px)", margin: 0,
            fontWeight: 800, color: t.white, letterSpacing: -0.4,
          }}>My Skills</h1>
          <p style={{ fontSize: 13, color: t.textMuted, marginTop: 6 }}>
            Skills you've installed for your agent. Browse the marketplace to add more.
          </p>
        </div>
        <Link href="/skills" style={{
          padding: "10px 16px",
          background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
          border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
          color: "#fff", textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: 8,
          boxShadow: `0 10px 24px rgba(168,85,247,0.35)`,
        }}>
          <Plus size={14} /> Browse marketplace
        </Link>
      </header>

      {error && (
        <div style={{
          padding: "10px 14px", marginBottom: 16, borderRadius: 10,
          border: `1px solid ${t.border}`,
          background: "rgba(239,68,68,0.12)", color: "#fca5a5", fontSize: 13,
        }}>{error}</div>
      )}

      {!connected && (
        <div style={{
          padding: "44px 24px", borderRadius: 14,
          background: t.bgCard, border: `1px dashed ${t.border}`,
          textAlign: "center",
        }}>
          <span aria-hidden style={{
            width: 52, height: 52, borderRadius: 14,
            background: `${t.accent}22`, color: t.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginBottom: 14,
          }}><Wallet size={22} /></span>
          <div style={{ fontSize: 16, fontWeight: 800, color: t.white, marginBottom: 6 }}>
            Connect a wallet to see your skills
          </div>
          <button type="button" onClick={() => showModal?.()} style={{
            marginTop: 10,
            padding: "11px 18px",
            background: `linear-gradient(135deg, #a855f7, #3b82f6)`,
            border: "none", borderRadius: 10,
            fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer",
          }}>Connect wallet</button>
        </div>
      )}

      {connected && loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: t.textMuted, fontSize: 13 }}>
          <Loader2 size={14} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Loading your skills…
        </div>
      )}

      {connected && !loading && rows.length === 0 && (
        <div style={{
          padding: "44px 24px", borderRadius: 14,
          background: t.bgCard, border: `1px dashed ${t.border}`,
          textAlign: "center",
        }}>
          <span aria-hidden style={{
            width: 52, height: 52, borderRadius: 14,
            background: "rgba(168,85,247,0.22)", color: "#c4b8ff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginBottom: 14,
          }}><Package size={22} /></span>
          <div style={{ fontSize: 16, fontWeight: 800, color: t.white, marginBottom: 6 }}>
            You haven't installed any skills yet
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 18 }}>
            Skills extend what your agent can do — swaps, alerts, posts, trading.
          </div>
          <Link href="/skills" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "11px 18px",
            background: `linear-gradient(135deg, #a855f7, #3b82f6)`,
            border: "none", borderRadius: 10,
            fontSize: 13, fontWeight: 700, color: "#fff", textDecoration: "none",
          }}><Plus size={14} /> Explore marketplace</Link>
        </div>
      )}

      {connected && !loading && rows.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map(({ skill, metadata }) => (
            <div key={skill.id} style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 0.7fr) auto",
              gap: 18, alignItems: "center",
              padding: "16px 18px",
              background: t.bgCard, border: `1px solid ${t.border}`,
              borderRadius: 14,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <span aria-hidden style={{
                  width: 44, height: 44, flexShrink: 0, borderRadius: 10,
                  background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  color: "#fff",
                }}><Package size={20} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: t.white }}>
                      {skill.name}
                    </span>
                    {metadata?.verified && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                        background: "rgba(59,130,246,0.18)", color: "#60a5fa",
                        display: "inline-flex", alignItems: "center", gap: 4,
                      }}><CheckCircle2 size={10} /> Verified</span>
                    )}
                    {metadata?.category && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                        background: t.bgSurface, color: t.textMuted,
                      }}>{metadata.category}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 11.5, color: t.textMuted, marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    maxWidth: 420,
                  }}>
                    {skill.description || "—"}
                  </div>
                  <div style={{
                    fontSize: 11, color: t.textDim, marginTop: 2,
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                  }}>
                    by {truncAddr(skill.author)}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
                  Price
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
                  {formatNear(skill.price_yocto)}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
                  Installs
                </div>
                <div style={{
                  fontSize: 18, fontWeight: 800, color: t.white,
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                }}>
                  {skill.install_count ?? 0}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Link href={`/skills/${skill.id}`} style={{
                  padding: "9px 14px",
                  background: t.bgSurface, border: `1px solid ${t.border}`,
                  borderRadius: 10, fontSize: 12, fontWeight: 700, color: t.text,
                  textDecoration: "none", whiteSpace: "nowrap",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}><ExternalLink size={12} /> View</Link>
                <button
                  type="button"
                  onClick={() => handleUninstall(skill.id)}
                  disabled={removingId === skill.id}
                  aria-label="Uninstall"
                  style={{
                    width: 34, height: 34, borderRadius: 10,
                    background: t.bgSurface, border: `1px solid ${t.border}`,
                    color: t.textMuted,
                    cursor: removingId === skill.id ? "not-allowed" : "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    opacity: removingId === skill.id ? 0.5 : 1,
                  }}
                >
                  {removingId === skill.id
                    ? <Loader2 size={14} style={{ animation: "ma-spin 0.9s linear infinite" }} />
                    : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx global>{`
        @keyframes ma-spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
