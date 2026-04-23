"use client";
// Owner-only dashboard for managing your personal agent: sub-wallet status,
// backup-key export, and orchestrator delegation. Public profile-by-handle
// lives at /agents/[handle] (not yet built — Next.js static export needs a
// different routing approach for user-generated paths).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot, Copy, Check, Key, Shield, Radio, ChevronLeft, ExternalLink, Clock,
  RefreshCw, AlertTriangle, Trophy, Star, Download, EyeOff, Eye,
  Wallet, Fingerprint, Lock, LockKeyhole, Gift, ChevronDown, ChevronUp,
  ArrowRight, Eye as EyeIcon, ShieldCheck, MessageCircle, BookOpen, HelpCircle,
  Zap, TrendingUp, ListChecks, ChevronRight, MoreHorizontal, Plus, Pause,
  Activity, BarChart2, Target, Crown, Settings, FileText, Gauge, XCircle,
  CheckCircle2, Pencil,
} from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";
import { STAKING_CONTRACT } from "@/hooks/useNear";

// ── Helpers ─────────────────────────────────────────────────────────────────
function truncKey(k) {
  if (!k) return "";
  return k.length <= 24 ? k : `${k.slice(0, 14)}…${k.slice(-6)}`;
}

function truncAddr(addr) {
  if (!addr) return "";
  return addr.length <= 24 ? addr : `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

function fmt(n) { return n?.toLocaleString?.() ?? ""; }

function keyPermissionLabel(perm) {
  if (perm === "FullAccess") return { kind: "full", label: "Full Access" };
  if (perm?.FunctionCall) {
    const fc = perm.FunctionCall;
    return {
      kind: "fc",
      label: `FC · ${fc.receiver_id}${(fc.method_names || []).length ? ` · ${fc.method_names.join(",")}` : ""}`,
      allowanceYocto: fc.allowance,
    };
  }
  return { kind: "unknown", label: JSON.stringify(perm).slice(0, 40) };
}

function yoctoToNearShort(yocto) {
  if (!yocto) return "0";
  try {
    const y    = BigInt(yocto);
    const WHOLE = 1_000_000_000_000_000_000_000_000n;
    const hunds = (y * 100n) / WHOLE; // 2-decimal fixed
    const whole = hunds / 100n;
    const frac  = hunds % 100n;
    return `${whole}.${String(frac).padStart(2, "0")}`;
  } catch { return "0"; }
}

// ── Copy-to-clipboard button ────────────────────────────────────────────────
function CopyBtn({ text, t, size = 13 }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        try { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
      }}
      style={{
        background: "transparent", border: "none", cursor: "pointer",
        color: copied ? t.green : t.textDim, padding: 4, display: "inline-flex",
      }}
      title="Copy"
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

// ── Export-key modal ────────────────────────────────────────────────────────
function ExportKeyModal({ t, stored, onClose }) {
  const [reveal, setReveal] = useState(false);
  if (!stored) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
      zIndex: 1000, backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20,
        padding: 28, width: 520, maxWidth: "92vw",
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: t.white, marginBottom: 6 }}>
          Back up your agent key
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.55, marginBottom: 14 }}>
          This private key controls <strong>{stored.subAccount}</strong>. If you lose it and haven't delegated
          to the orchestrator, the sub-wallet is stranded. Anyone with this key can act as your agent.
        </div>
        <div style={{
          background: `${t.red}0e`, border: `1px solid ${t.red}44`, borderRadius: 8,
          padding: "10px 12px", marginBottom: 14, fontSize: 12, color: t.red,
          display: "flex", gap: 8, alignItems: "flex-start",
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Never paste this key into a form, chat, or email. Save it in a password manager.</span>
        </div>

        <div style={{ fontSize: 11, color: t.textDim, marginBottom: 6 }}>PUBLIC KEY</div>
        <div style={{
          background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
          padding: "10px 12px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
          color: t.text, wordBreak: "break-all", marginBottom: 12,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ flex: 1 }}>{stored.publicKey}</span>
          <CopyBtn text={stored.publicKey} t={t} />
        </div>

        <div style={{ fontSize: 11, color: t.textDim, marginBottom: 6 }}>PRIVATE KEY</div>
        <div style={{
          background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
          padding: "10px 12px", fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
          color: reveal ? t.text : t.textDim, wordBreak: "break-all", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ flex: 1, filter: reveal ? "none" : "blur(6px)" }}>{stored.privateKey}</span>
          <button onClick={() => setReveal((v) => !v)} style={{
            background: "transparent", border: "none", cursor: "pointer", color: t.textDim,
            display: "inline-flex", padding: 4,
          }} title={reveal ? "Hide" : "Reveal"}>
            {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <CopyBtn text={stored.privateKey} t={t} />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Btn
            onClick={() => {
              const blob = new Blob([JSON.stringify(stored, null, 2)], { type: "application/json" });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement("a");
              a.href     = url;
              a.download = `ironshield-agent-key-${stored.subAccount}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{ flex: 1, justifyContent: "center" }}
          >
            <Download size={13} /> Download JSON
          </Btn>
          <Btn primary onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>
            Close
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Disconnected hub (onboarding surface) ───────────────────────────────────
function DisconnectedHub({ t, openWallet }) {
  // Accent + a secondary violet so we can get the "your agent" highlight
  // regardless of which theme preset is active. Values are tuned against the
  // dark palette; in light mode they still read as premium-tech purple.
  const violet = "#a855f7";

  const featurePills = [
    { icon: Fingerprint, label: "On-chain Identity", hint: "Unique & verifiable", color: violet },
    { icon: Wallet,      label: "Sub-wallets",       hint: "Isolated & secure",  color: t.green },
    { icon: ShieldCheck, label: "Delegation",        hint: "You stay in control", color: t.accent },
    { icon: Star,        label: "Rewards",           hint: "Earn $IRONCLAW",      color: t.amber },
  ];

  const unlocks = [
    { icon: Bot,         title: "Agent Dashboard", desc: "View your agent, stats, and performance in real time." },
    { icon: TrendingUp,  title: "Earnings & Points", desc: "Track points, rewards, and leaderboard rankings." },
    { icon: ShieldCheck, title: "Missions & Tasks", desc: "Complete missions, earn points, and boost your rank." },
    { icon: Trophy,      title: "Leaderboard",      desc: "Compete with the community and climb the ranks." },
  ];

  const faqs = [
    {
      q: "Why do I need to connect my NEAR wallet?",
      a: "Your agent profile, points, and sub-wallet all live on-chain under your NEAR account. Connecting simply lets the dashboard read them and lets you sign actions. We never take custody of your keys.",
    },
    {
      q: "What data does IronShield access?",
      a: "Only public on-chain data from ironshield.near — your agent profile, your points, your leaderboard position, and the access keys on your sub-wallet. No off-chain identifiers, no tracking.",
    },
    {
      q: "Is my wallet secure?",
      a: "Your main wallet is never exposed. The agent sub-wallet is a separate NEAR account funded with 0.1 NEAR — so the maximum at risk, ever, is that 0.1 NEAR. You can revoke delegated keys any time.",
    },
    {
      q: "What happens after I connect?",
      a: "You'll pick a handle, register your agent, and (optionally) link a scoped sub-wallet so your agent can act autonomously within safe limits. All of it takes under a minute.",
    },
  ];

  return (
    <>
      <Section style={{ paddingTop: 100 }}>
        <Link href="/earn" style={{
          color: t.textMuted, fontSize: 12, textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 20,
        }}>
          <ChevronLeft size={13} /> Earn
        </Link>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <div style={{
          position: "relative", overflow: "hidden", borderRadius: 20,
          background: `radial-gradient(ellipse at 100% 50%, ${violet}33 0%, transparent 60%), linear-gradient(135deg, ${t.bgCard} 0%, ${t.bgSurface} 100%)`,
          border: `1px solid ${t.border}`, marginBottom: 20,
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 0.9fr)",
            gap: 24, padding: "40px 44px", alignItems: "center",
          }}
          className="agent-hub-hero-grid"
          >
            {/* Left: text + CTA */}
            <div style={{ minWidth: 0 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: `${violet}1f`, border: `1px solid ${violet}55`,
                borderRadius: 999, padding: "5px 12px",
                fontSize: 10.5, fontWeight: 700, color: violet, letterSpacing: 0.7, textTransform: "uppercase",
              }}>
                <Bot size={11} /> Your Agent Hub
              </span>

              <h1 style={{
                fontSize: "clamp(28px, 4vw, 42px)", lineHeight: 1.1,
                fontWeight: 800, color: t.white, margin: "18px 0 12px",
                letterSpacing: -0.5,
              }}>
                Connect to view{" "}
                <span style={{
                  background: `linear-gradient(90deg, ${violet}, ${t.accent})`,
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}>
                  your agent
                </span>
              </h1>

              <p style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.65, maxWidth: 480, marginBottom: 8 }}>
                The dashboard loads your on-chain profile, sub-wallet, and{" "}
                <span style={{ color: t.white, textDecoration: "underline", textDecorationColor: `${violet}88`, textDecorationThickness: 2, textUnderlineOffset: 3 }}>
                  delegation state
                </span>{" "}
                from ironshield.near.
              </p>
              <p style={{ fontSize: 13, color: t.textDim, marginBottom: 22 }}>
                Sign in with a NEAR wallet to continue.
              </p>

              <button onClick={openWallet} style={{
                background: `linear-gradient(135deg, ${violet}, ${t.accent})`,
                border: "none", borderRadius: 12, padding: "14px 24px",
                fontSize: 14, fontWeight: 700, color: "#fff", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 10,
                boxShadow: `0 10px 30px ${violet}44, 0 0 0 1px ${violet}55 inset`,
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
              >
                <Wallet size={15} /> Connect NEAR Wallet <ArrowRight size={15} />
              </button>

              <div style={{ fontSize: 12, color: t.textDim, marginTop: 14 }}>
                Secure. Non-custodial. You stay in control.
              </div>
            </div>

            {/* Right: mascot. Lightweight WebP + no CSS filters to keep the
                Telegram in-app WebView from OOM-killing the page. */}
            <div style={{ position: "relative", minHeight: 260, display: "flex", justifyContent: "center", alignItems: "center" }}>
              <div style={{
                position: "absolute", inset: 0,
                background: `radial-gradient(circle at center, ${violet}2a 0%, transparent 60%)`,
              }} />
              <img
                src="/mascot.webp"
                alt="IronClaw agent mascot"
                width={260} height={390}
                decoding="async"
                style={{ position: "relative", maxWidth: "100%", height: "auto" }}
              />
            </div>
          </div>

          {/* Feature pills bar — absolutely inside the hero card, spans bottom */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 10, padding: "0 44px 28px",
          }}>
            {featurePills.map(({ icon: Icon, label, hint, color }) => (
              <div key={label} style={{
                background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 12,
                padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  background: `${color}22`, borderRadius: 8, width: 32, height: 32,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <Icon size={15} color={color} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.white }}>{label}</div>
                  <div style={{ fontSize: 10.5, color: t.textMuted }}>{hint}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── "When you connect, you'll unlock" ───────────────────────── */}
        <div style={{ marginBottom: 20, marginTop: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: t.white, marginBottom: 16 }}>
            When you connect, you&rsquo;ll{" "}
            <span style={{
              background: `linear-gradient(90deg, ${violet}, ${t.accent})`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}>
              unlock
            </span>
          </h2>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}>
            {unlocks.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
                padding: "20px 20px 18px", position: "relative", overflow: "hidden",
              }}>
                <div style={{
                  background: `${violet}1a`, borderRadius: 10, width: 38, height: 38,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 12,
                }}>
                  <Icon size={18} color={violet} />
                </div>
                {/* Tiny skeleton preview — replicates the mini-chart vibe from the mock
                    without pulling in a chart lib for a locked state. */}
                <div style={{
                  background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
                  height: 54, marginBottom: 12, display: "flex", gap: 6, padding: 8, alignItems: "flex-end",
                }}>
                  {[35, 55, 40, 70, 45, 80, 60, 75, 50, 85].map((h, i) => (
                    <div key={i} style={{
                      flex: 1, height: `${h}%`,
                      background: `linear-gradient(to top, ${violet}44, ${t.accent}66)`,
                      borderRadius: 2, opacity: 0.6,
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5, marginBottom: 12 }}>{desc}</div>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 6,
                  padding: "3px 8px", fontSize: 11, color: t.textMuted,
                }}>
                  <LockKeyhole size={11} /> Locked
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Privacy banner ──────────────────────────────────────────── */}
        <div style={{
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
          padding: "18px 22px", marginBottom: 24,
          display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center",
        }}>
          <div style={{
            background: `${violet}1a`, borderRadius: 12, width: 48, height: 48,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Lock size={22} color={violet} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>Your privacy is protected</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
              We never access your funds. We only read public data from the blockchain to power your experience.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {["Non-custodial", "Read-only", "You're in control"].map((pill) => (
              <div key={pill} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 12, color: t.textMuted,
              }}>
                <Check size={13} color={t.green} />
                {pill}
              </div>
            ))}
          </div>
        </div>

        {/* ── FAQ + Help grid ─────────────────────────────────────────── */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}>
          {/* FAQ */}
          <div style={{
            background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
            padding: "22px 22px",
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.white, marginBottom: 16 }}>
              Frequently asked questions
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {faqs.map((f, i) => (
                <FaqItem key={i} t={t} q={f.q} a={f.a} />
              ))}
            </div>
          </div>

          {/* Help card */}
          <div style={{
            background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
            padding: "22px 22px",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                background: `${violet}1a`, borderRadius: 10, width: 38, height: 38,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <HelpCircle size={18} color={violet} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: t.white }}>Need help?</div>
            </div>
            <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6 }}>
              Join our community or reach out to our support team.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: "auto" }}>
              <a href="https://t.me/IronClawHQ" target="_blank" rel="noopener noreferrer" style={{
                flex: 1, minWidth: 120, textAlign: "center",
                background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
                padding: "10px 12px", fontSize: 13, fontWeight: 600, color: t.text,
                textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <MessageCircle size={14} /> Join Telegram
              </a>
              <a href="/docs" style={{
                flex: 1, minWidth: 120, textAlign: "center",
                background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
                padding: "10px 12px", fontSize: 13, fontWeight: 600, color: t.text,
                textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <BookOpen size={14} /> View Docs
              </a>
            </div>
          </div>
        </div>
      </Section>
      <style jsx>{`
        @media (max-width: 780px) {
          .agent-hub-hero-grid {
            grid-template-columns: 1fr !important;
            padding: 28px 24px !important;
          }
        }
      `}</style>
    </>
  );
}

// ── FAQ accordion item ──────────────────────────────────────────────────────
function FaqItem({ t, q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${t.border}` }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", background: "transparent", border: "none", cursor: "pointer",
          padding: "14px 0", display: "flex", alignItems: "center", justifyContent: "space-between",
          color: t.white, fontSize: 13, fontWeight: 600, textAlign: "left",
        }}
      >
        {q}
        {open ? <ChevronUp size={14} color={t.textMuted} /> : <ChevronDown size={14} color={t.textMuted} />}
      </button>
      {open && (
        <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.65, padding: "0 0 16px" }}>
          {a}
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function AgentDashboardPage({ openWallet }) {
  const t = useTheme();
  const wallet = useWallet();
  const agent  = useAgent();

  // Mock mode — visit /agents/me?mock=1 to preview the fully-connected dashboard
  // without a wallet. Pure UI substitution; no network or storage writes happen.
  // Safe to ship because it only activates via an explicit query string.
  const isMock = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mock") === "1";

  let connected = wallet.connected;
  let address   = wallet.address;
  let profile         = agent.profile;
  let profileLoading  = agent.profileLoading;
  const { fetchProfile,
    getSubAccountId, loadStoredAgentKey,
    getOrchestratorInfo, delegateToOrchestrator, revokeDelegatedKey,
    listSubWalletKeys,
    getAgentStats, getAgentActivity, getProStatus,
  } = agent;

  const [subKeys, setSubKeys]       = useState([]);
  const [subBalance, setSubBalance] = useState(null);
  const [orchestrator, setOrchestrator] = useState(null); // { orchestratorId, keys }
  const [orchKeyChoice, setOrchKeyChoice] = useState(null);
  const [loadingKeys, setLoadingKeys]   = useState(false);
  const [delegateBusy, setDelegateBusy] = useState(false);
  const [delegateMsg, setDelegateMsg]   = useState("");
  const [showExport, setShowExport]     = useState(false);
  const [stats, setStats]               = useState(null);
  const [activity, setActivity]         = useState([]);
  const [isPro, setIsPro]               = useState(false);
  const [activeTab, setActiveTab]       = useState("overview");

  // Mock overrides — applied *after* hook calls so React's order-of-hooks rule
  // stays stable. We substitute the values used for rendering but leave the
  // real hooks in place (their no-op effects are harmless when the mock
  // address doesn't resolve on-chain).
  let mockStored   = null;
  let mockSubKeys  = null;
  let mockBalance  = null;
  let mockOrchestrator = null;
  let mockOrchKey  = null;
  if (isMock) {
    connected      = true;
    address        = "alice.near";
    profile        = {
      owner:         "alice.near",
      handle:        "ironclaw_hunter",
      bio:           "Hunting airdrops, auditing governance, shipping alpha at 3am.",
      agent_account: "agent.alice.near",
      points:        "12480",
      reputation:    47,
      created_at:    String(BigInt(Date.now() - 12 * 86_400_000) * 1_000_000n),
    };
    profileLoading = false;
    mockStored = {
      owner:      "alice.near",
      subAccount: "agent.alice.near",
      publicKey:  "ed25519:6Zs8g7xP3vQm8JtZJZrrLW1hQmb3BrbC3DeM5Nw7r3QQ",
      privateKey: "ed25519:3bKFQ7AaxxxxxxxxxxMOCKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      createdAt:  new Date().toISOString(),
      note:       "Mock key — not real.",
    };
    mockSubKeys = [
      {
        public_key: mockStored.publicKey,
        access_key: { nonce: 1, permission: "FullAccess" },
      },
      {
        public_key: "ed25519:9LpOrC2fFtz6kYXgT4vVpLdP4yNw2m8BDemv1qQ8Rr5p",
        access_key: {
          nonce: 2,
          permission: { FunctionCall: {
            allowance: "250000000000000000000000",
            receiver_id: STAKING_CONTRACT,
            method_names: [],
          } },
        },
      },
    ];
    mockBalance = "92000000000000000000000"; // 0.092 NEAR
    mockOrchestrator = {
      orchestratorId: "orchestrator.ironshield.near",
      keys: [{
        public_key: "ed25519:9LpOrC2fFtz6kYXgT4vVpLdP4yNw2m8BDemv1qQ8Rr5p",
        access_key: { permission: "FullAccess" },
      }],
    };
    mockOrchKey = "ed25519:9LpOrC2fFtz6kYXgT4vVpLdP4yNw2m8BDemv1qQ8Rr5p";
  }

  const subAccountId = isMock ? "agent.alice.near" : getSubAccountId(address);
  const realStored   = useMemo(() => loadStoredAgentKey(address), [loadStoredAgentKey, address]);
  const stored       = isMock ? mockStored : realStored;
  const linked       = Boolean(profile?.agent_account);

  // Mock data for stats + activity (plausible numbers so the dashboard shows
  // every populated state). These only apply when ?mock=1 is in the URL.
  const mockStats = isMock ? {
    points_this_week:     1248,
    points_last_week:     1054,
    weekly_snapshots:     [890, 1120, 970, 1340, 1510, 1054, 1248],
    week_index_last_seen: 0,
    submissions_approved: 27,
    submissions_rejected: 2,
    missions_completed:   28,
    last_active:          String(BigInt(Date.now() - 2 * 60_000) * 1_000_000n),
    activity_log: [
      { kind: "points_awarded",      amount: 250, description: "Completed Airdrop Quest",         timestamp: String(BigInt(Date.now() -  2 * 60_000) * 1_000_000n) },
      { kind: "points_awarded",      amount: 400, description: "Audited DAO Proposal",             timestamp: String(BigInt(Date.now() - 18 * 60_000) * 1_000_000n) },
      { kind: "points_awarded",      amount: 750, description: "Found High-Value Airdrop",         timestamp: String(BigInt(Date.now() -  1 * 3_600_000) * 1_000_000n) },
      { kind: "points_awarded",      amount: 120, description: "Shared Alpha on IronFeed",         timestamp: String(BigInt(Date.now() -  3 * 3_600_000) * 1_000_000n) },
      { kind: "delegated",           amount: 0,   description: "Delegated to orchestrator",        timestamp: String(BigInt(Date.now() -  5 * 3_600_000) * 1_000_000n) },
      { kind: "mission_completed",   amount: 180, description: "Completed Community Task",         timestamp: String(BigInt(Date.now() -  8 * 3_600_000) * 1_000_000n) },
    ],
  } : null;

  // When mock mode is on, seed the local-state slots with mock values once.
  useEffect(() => {
    if (!isMock) return;
    setSubKeys(mockSubKeys);
    setSubBalance(mockBalance);
    setOrchestrator(mockOrchestrator);
    setOrchKeyChoice(mockOrchKey);
    setStats(mockStats);
    setActivity(mockStats.activity_log.slice().reverse()); // newest first to match view
    setIsPro(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMock]);

  // ── Real stats + activity + Pro ───────────────────────────────────────
  const fetchStatsBundle = useCallback(async () => {
    if (isMock || !connected || !address || !profile) return;
    try {
      const [s, a, p] = await Promise.all([
        getAgentStats(address),
        getAgentActivity(address, 10),
        getProStatus(address),
      ]);
      setStats(s || null);
      setActivity(Array.isArray(a) ? a : []);
      setIsPro(Boolean(p));
    } catch (err) {
      console.warn("fetchStatsBundle:", err?.message || err);
    }
  }, [isMock, connected, address, profile, getAgentStats, getAgentActivity, getProStatus]);

  useEffect(() => { fetchStatsBundle(); }, [fetchStatsBundle]);

  // ── Sub-wallet state (keys + balance) ──────────────────────────────────
  const refreshSubWalletState = useCallback(async () => {
    if (isMock) return; // mock mode seeds state directly; skip the real RPC
    if (!linked || !subAccountId) return;
    setLoadingKeys(true);
    try {
      const keys = await listSubWalletKeys(address);
      setSubKeys(keys || []);

      // balance lookup via RPC
      try {
        const { connect, keyStores } = await import("near-api-js");
        const near = await connect({
          networkId: "mainnet",
          nodeUrl:   "https://rpc.fastnear.com",
          keyStore:  new keyStores.InMemoryKeyStore(),
        });
        const account = await near.account(subAccountId);
        const state   = await account.getState();
        setSubBalance(state?.balance?.available ?? null);
      } catch {
        setSubBalance(null);
      }
    } catch (err) {
      console.warn("sub-wallet state refresh:", err?.message || err);
    } finally {
      setLoadingKeys(false);
    }
  }, [linked, subAccountId, listSubWalletKeys, address]);

  useEffect(() => { refreshSubWalletState(); }, [refreshSubWalletState]);

  // ── Orchestrator info ──────────────────────────────────────────────────
  useEffect(() => {
    if (isMock) return; // mock mode seeds this via the effect above
    (async () => {
      try {
        const info = await getOrchestratorInfo();
        setOrchestrator(info);
        // Pick the first FullAccess key by default — stable choice for the
        // "Delegate" button without asking the user to pick a key.
        const faKey = info?.keys?.find?.((k) => k.access_key?.permission === "FullAccess");
        setOrchKeyChoice(faKey?.public_key || info?.keys?.[0]?.public_key || null);
      } catch (err) {
        console.warn("getOrchestratorInfo:", err?.message || err);
      }
    })();
  }, [getOrchestratorInfo, isMock]);

  // Is the orchestrator already delegated on our sub-wallet?
  const orchestratorDelegated = useMemo(() => {
    if (!orchKeyChoice || !subKeys?.length) return false;
    return subKeys.some((k) => k.public_key === orchKeyChoice);
  }, [orchKeyChoice, subKeys]);

  const handleDelegate = async () => {
    if (!orchKeyChoice) return;
    setDelegateBusy(true);
    setDelegateMsg("");
    try {
      await delegateToOrchestrator(orchKeyChoice);
      setDelegateMsg("Orchestrator delegated. Your agent can now act 24/7.");
      await refreshSubWalletState();
    } catch (err) {
      setDelegateMsg(err?.message || String(err));
    } finally {
      setDelegateBusy(false);
    }
  };

  const handleRevoke = async (publicKey) => {
    if (!publicKey) return;
    setDelegateBusy(true);
    setDelegateMsg("");
    try {
      await revokeDelegatedKey(publicKey);
      setDelegateMsg("Delegation revoked.");
      await refreshSubWalletState();
    } catch (err) {
      setDelegateMsg(err?.message || String(err));
    } finally {
      setDelegateBusy(false);
    }
  };

  // ── Renderers ──────────────────────────────────────────────────────────

  if (!connected) {
    return <DisconnectedHub t={t} openWallet={openWallet} />;
  }

  if (profileLoading && !profile) {
    return (
      <Section style={{ paddingTop: 100 }}>
        <div style={{ color: t.textMuted, fontSize: 13 }}>Loading your agent profile…</div>
      </Section>
    );
  }

  if (!profile) {
    return (
      <Section style={{ paddingTop: 100 }}>
        <Link href="/earn" style={{ color: t.textMuted, fontSize: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 16 }}>
          <ChevronLeft size={13} /> Earn
        </Link>
        <div style={{
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16,
          padding: 40, textAlign: "center",
        }}>
          <Bot size={36} color={t.accent} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 18, fontWeight: 700, color: t.white, marginBottom: 6 }}>
            You don't have an agent yet
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 20 }}>
            Create one from the Earn page — you'll pick a handle and your agent joins the platform.
          </div>
          <Link href="/earn"><Btn primary as="span"><Bot size={14} /> Go to Earn</Btn></Link>
        </div>
      </Section>
    );
  }

  const pts = profile?.points ? Number(BigInt(profile.points)) : 0;
  const joined = profile?.created_at ? new Date(Number(BigInt(profile.created_at) / 1_000_000n)).toLocaleDateString() : "";
  const violet = "#a855f7";

  // ── Derived metrics (all from real chain data when not mocked) ─────────
  const ptsThisWeek = stats ? Number(BigInt(stats.points_this_week ?? 0)) : 0;
  const ptsLastWeek = stats ? Number(BigInt(stats.points_last_week ?? 0)) : 0;
  const weeklyDelta = ptsLastWeek > 0
    ? ((ptsThisWeek - ptsLastWeek) / ptsLastWeek) * 100
    : null;
  const approved  = stats?.submissions_approved ?? 0;
  const rejected  = stats?.submissions_rejected ?? 0;
  const judged    = approved + rejected;
  const successRt = judged > 0 ? (approved / judged) * 100 : null;
  const missions  = stats?.missions_completed ?? 0;
  const snapshots = stats?.weekly_snapshots?.length ? stats.weekly_snapshots.map((v) => Number(BigInt(v))) : [];
  const lastActiveMs = stats?.last_active ? Number(BigInt(stats.last_active) / 1_000_000n) : null;
  const isActive  = lastActiveMs ? (Date.now() - lastActiveMs) < 7 * 86_400_000 : false;
  const lastActiveLabel = lastActiveMs ? fmtRelative(Date.now() - lastActiveMs) : "—";

  // Level/XP: thresholds are simple power-of-5 steps. XP bar fills toward next.
  const { level, xp, xpForNext, xpInLevel, xpLevelSpan } = levelFromPoints(pts);

  const active = activeTab === "overview"; // others stub to "coming soon"

  return (
    <>
    <Section style={{ paddingTop: 100 }}>
      {/* ── Breadcrumb + actions ─────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMuted }}>
          <Link href="/earn" style={{ color: t.textMuted, textDecoration: "none" }}>Earn</Link>
          <ChevronRight size={11} color={t.textDim} />
          <span style={{ color: t.textMuted }}>My Agents</span>
          <ChevronRight size={11} color={t.textDim} />
          <span style={{ color: t.white, fontWeight: 600 }}>@{profile.handle}</span>
        </div>
        <div style={{ display: "inline-flex", gap: 8 }}>
          <button style={btnGhost(t)}>
            <Settings size={12} /> Actions <ChevronDown size={11} />
          </button>
          <button style={{ ...btnGhost(t), padding: "8px 10px" }} aria-label="More">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* ── Hero: avatar + text + mascot + tabs ──────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${violet}1e, ${t.bgCard} 55%)`,
        border: `1px solid ${t.border}`, borderRadius: 18,
        padding: 28, marginBottom: 20, position: "relative", overflow: "hidden",
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(180px, 220px) minmax(0, 1fr) minmax(180px, 260px)",
          gap: 24, alignItems: "center",
        }}
        className="dash-hero-grid">
          {/* Left: avatar tile */}
          <div style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 16,
            padding: 16, display: "flex", justifyContent: "center", alignItems: "center",
            position: "relative", minHeight: 200,
          }}>
            <div style={{ position: "absolute", inset: 0,
              background: `radial-gradient(circle at center, ${violet}2a 0%, transparent 65%)`,
            }} />
            <img src="/mascot.webp" alt="agent avatar" width={160} height={240}
              decoding="async"
              style={{ position: "relative", maxWidth: "100%", height: "auto" }} />
          </div>

          {/* Middle: text + stats line */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
              <span style={{ background: `${violet}22`, color: violet, padding: "3px 8px", borderRadius: 999, fontWeight: 700 }}>
                Your Agent
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: t.white, letterSpacing: -0.4 }}>@{profile.handle}</span>
              <span style={{
                background: isActive ? `${t.green}1c` : `${t.textDim}22`,
                color: isActive ? t.green : t.textMuted,
                border: `1px solid ${isActive ? t.green + "55" : t.border}`,
                padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
              }}>
                {isActive ? "Active" : "Idle"}
              </span>
              {isPro && (
                <span style={{
                  background: `linear-gradient(90deg, ${violet}, ${t.accent})`,
                  color: "#fff", padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                  <Crown size={10} /> PRO
                </span>
              )}
            </div>
            {profile.bio && (
              <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.55, maxWidth: 540, marginBottom: 12 }}>
                {profile.bio}
              </div>
            )}
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10 }}>
              <StatLine t={t} icon={Star}   color={t.green}  value={fmt(pts)} label="pts" />
              <StatLine t={t} icon={Trophy} color={t.accent} value={profile.reputation ?? 0} label="reputation" />
              {joined && <StatLine t={t} icon={Clock} color={t.textDim} value={`Joined ${joined}`} />}
            </div>
            <div style={{ fontSize: 10.5, color: t.textDim, fontFamily: "'JetBrains Mono', monospace", display: "inline-flex", alignItems: "center", gap: 6 }}>
              Owner: {truncAddr(address)} <CopyBtn text={address} t={t} size={10} />
            </div>
          </div>

          {/* Right: mascot illustration (duplicate, decorative). Hidden on
              narrow screens via CSS; still lazy + WebP to avoid decode cost. */}
          <div style={{ position: "relative", minHeight: 220, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <div style={{ position: "absolute", inset: 0,
              background: `radial-gradient(circle at center, ${violet}38 0%, transparent 60%)`,
            }} />
            <img src="/mascot.webp" alt="" aria-hidden="true" width={200} height={300}
              decoding="async" loading="lazy"
              style={{ position: "relative", maxWidth: "100%", height: "auto" }} />
          </div>
        </div>

        {/* Tab bar */}
        <div style={{
          marginTop: 24, display: "flex", gap: 4,
          borderBottom: `1px solid ${t.border}`, flexWrap: "wrap",
        }}>
          {[
            { key: "overview",    label: "Overview",    icon: BarChart2 },
            { key: "activity",    label: "Activity",    icon: Activity },
            { key: "permissions", label: "Permissions", icon: Shield },
            { key: "settings",    label: "Settings",    icon: Settings },
            { key: "logs",        label: "Logs",        icon: FileText },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{
              padding: "9px 16px", borderRadius: "8px 8px 0 0", fontSize: 12,
              fontWeight: 700, cursor: "pointer", border: "none",
              borderBottom: activeTab === key ? `2px solid ${violet}` : "2px solid transparent",
              background: activeTab === key ? `${violet}14` : "transparent",
              color: activeTab === key ? t.white : t.textMuted,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs other than Overview are placeholders until their own slices ship */}
      {!active && (
        <div style={{
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
          padding: "40px 24px", textAlign: "center", color: t.textDim, fontSize: 13,
        }}>
          The <strong style={{ color: t.white }}>{activeTab}</strong> tab is coming in a follow-up slice.
        </div>
      )}

      {active && (
        <>
          {/* ── 4 stat tiles ─────────────────────────────────────────── */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14, marginBottom: 20,
          }}>
            <StatCardLg t={t} label="Total Points" value={fmt(pts)} unit="pts"
              icon={Star} accent={t.green}
              delta={weeklyDelta}
              spark={snapshots}
              hint={level ? `Level ${level}` : null} />
            <StatCardLg t={t} label="Points This Week" value={fmt(ptsThisWeek)} unit="pts"
              icon={TrendingUp} accent={violet}
              delta={weeklyDelta}
              spark={snapshots}
              hint={snapshots.length ? `${snapshots.length}w history` : "building history"} />
            <StatCardLg t={t} label="Missions Completed" value={fmt(missions)} unit=""
              icon={Target} accent={t.accent}
              hint={missions > 0 ? `${approved} approved · ${rejected} rejected` : "no missions yet"} />
            <StatCardLg t={t} label="Success Rate" value={successRt != null ? `${successRt.toFixed(1)}%` : "—"} unit=""
              icon={Gauge} accent={t.amber}
              hint={judged > 0 ? `${judged} judged submissions` : "no submissions judged yet"} />
          </div>

          {/* ── 2-col body ───────────────────────────────────────────── */}
          <div className="dash-body-grid" style={{
            display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)",
            gap: 18, alignItems: "flex-start",
          }}>
            {/* LEFT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Sub-wallet */}
              <PanelShell t={t}>
                <PanelHeader t={t} icon={Key} title="Agent Sub-wallet" accent={violet}
                  rightSlot={
                    <>
                      <Badge color={linked ? t.green : t.amber}>{linked ? "Linked" : "Not linked"}</Badge>
                      <button onClick={refreshSubWalletState} style={btnGhost(t)}>
                        <RefreshCw size={11} /> Refresh
                      </button>
                    </>
                  } />

                {!linked ? (
                  <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.55 }}>
                    You don't have a sub-wallet yet. Link one from the Earn page — it creates
                    <code style={{ color: t.white, fontFamily: "'JetBrains Mono', monospace", margin: "0 4px" }}>{subAccountId}</code>
                    and funds it with 0.1 NEAR so your agent can sign on-chain calls.
                  </div>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 14 }}>
                      <MiniKV t={t} label="Sub-account" value={<span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{profile.agent_account}</span>} copy={profile.agent_account} />
                      <MiniKV t={t} label="Balance" value={subBalance != null ? `${yoctoToNearShort(subBalance)} NEAR` : "—"} mono />
                      <MiniKV t={t} label="Access Keys" value={loadingKeys ? "…" : subKeys.length} mono />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                      {subKeys.map((k) => {
                        const perm   = keyPermissionLabel(k.access_key?.permission);
                        const isMine = stored?.publicKey === k.public_key;
                        const isOrch = orchKeyChoice === k.public_key;
                        return (
                          <div key={k.public_key} style={{
                            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
                            padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                          }}>
                            <Key size={12} color={perm.kind === "full" ? t.amber : violet} />
                            <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: t.text }}>
                              {truncKey(k.public_key)}
                            </span>
                            <Badge color={perm.kind === "full" ? t.amber : violet}>{perm.label}</Badge>
                            {isMine && <Badge color={t.green}>You (browser)</Badge>}
                            {isOrch && !isMine && <Badge color={t.accent}>Orchestrator</Badge>}
                            {isOrch && !isMine && (
                              <button onClick={() => handleRevoke(k.public_key)} disabled={delegateBusy} style={{
                                marginLeft: "auto", background: "transparent", border: `1px solid ${t.red}44`,
                                borderRadius: 6, padding: "3px 10px", fontSize: 10.5, color: t.red, cursor: "pointer", fontWeight: 700,
                              }}>
                                Revoke
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button disabled title="Add Access Key — wire in a future slice" style={{ ...btnGhost(t), opacity: 0.6, cursor: "not-allowed" }}>
                        <Plus size={12} /> Add Access Key
                      </button>
                      <button onClick={() => setShowExport(true)} disabled={!stored} style={{
                        ...btnGhost(t),
                        opacity: stored ? 1 : 0.55,
                        cursor: stored ? "pointer" : "not-allowed",
                      }}>
                        <Shield size={12} /> Export backup key
                      </button>
                      {!stored && (
                        <div style={{ fontSize: 11, color: t.amber, alignSelf: "center" }}>
                          No key stored in this browser — you linked from another device.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </PanelShell>

              {/* Performance */}
              <PanelShell t={t}>
                <PanelHeader t={t} icon={BarChart2} title="Agent Performance" accent={violet}
                  rightSlot={
                    <span style={{ fontSize: 11, color: t.textDim, padding: "4px 10px", border: `1px solid ${t.border}`, borderRadius: 6 }}>
                      7W weekly
                    </span>
                  } />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
                  <PerfMetric t={t} label="Points This Week" value={fmt(ptsThisWeek)} delta={weeklyDelta} accent={t.green} />
                  <PerfMetric t={t} label="Missions Completed" value={fmt(missions)} delta={null} accent={t.accent} />
                  <PerfMetric t={t} label="Submissions Judged" value={fmt(judged)} delta={null} accent={violet} />
                </div>
                <WeeklyPointsChart t={t} snapshots={snapshots} current={ptsThisWeek} accent={violet} />
                <div style={{ fontSize: 11, color: t.textDim, marginTop: 10, textAlign: "center" }}>
                  Up to 7 most recent weekly snapshots · live from ironshield.near
                </div>
              </PanelShell>

              {/* Missions */}
              <PanelShell t={t}>
                <PanelHeader t={t} icon={Target} title="Missions Progress" accent={violet}
                  rightSlot={<Link href="/earn" style={{ fontSize: 11, color: violet, textDecoration: "none", fontWeight: 700 }}>Browse all →</Link>}
                />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                  <MiniKV t={t} label="Completed" value={fmt(missions)} mono />
                  <MiniKV t={t} label="Approved" value={fmt(approved)} mono />
                  <MiniKV t={t} label="Rejected" value={fmt(rejected)} mono />
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 12, lineHeight: 1.55 }}>
                  Per-mission progress bars arrive with the mission-assignment slice —
                  the orchestrator needs to bind individual missions to an agent before
                  we can render X/Y completion here.
                </div>
              </PanelShell>
            </div>

            {/* RIGHT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

              {/* Orchestrator */}
              <PanelShell t={t}>
                <PanelHeader t={t} icon={Radio} title="Orchestrator Delegation" accent={violet}
                  rightSlot={
                    <Badge color={orchestratorDelegated ? t.green : t.textDim}>
                      {orchestratorDelegated ? "Active" : "Not delegated"}
                    </Badge>
                  } />
                <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6, marginBottom: 14 }}>
                  Delegation lets the IronShield orchestrator sign agent calls from your sub-wallet
                  when your browser is offline. It can only call{" "}
                  <code style={{ color: t.white }}>{STAKING_CONTRACT}</code>, capped at 0.25 NEAR in gas.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
                  <MiniKV t={t} label="Orchestrator Account" value={orchestrator?.orchestratorId ?? "—"} mono />
                  <MiniKV t={t} label="Target Key" value={orchKeyChoice ? truncKey(orchKeyChoice) : "—"} mono />
                </div>
                {delegateMsg && (
                  <div style={{
                    background: (delegateMsg.startsWith("Orchestrator delegated") || delegateMsg.startsWith("Delegation revoked"))
                      ? `${t.green}14` : `${t.red}14`,
                    border: `1px solid ${(delegateMsg.startsWith("Orchestrator delegated") || delegateMsg.startsWith("Delegation revoked")) ? t.green + "44" : t.red + "44"}`,
                    borderRadius: 8, padding: "10px 12px", marginBottom: 12,
                    fontSize: 12, color: (delegateMsg.startsWith("Orchestrator delegated") || delegateMsg.startsWith("Delegation revoked")) ? t.green : t.red,
                    wordBreak: "break-word",
                  }}>
                    {delegateMsg}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {orchestratorDelegated ? (
                    <button onClick={() => handleRevoke(orchKeyChoice)} disabled={delegateBusy} style={{
                      ...btnPrimary(violet, t.accent), background: "transparent", color: t.red, border: `1px solid ${t.red}55`,
                      boxShadow: "none",
                    }}>
                      Revoke delegation
                    </button>
                  ) : (
                    <button onClick={handleDelegate}
                      disabled={delegateBusy || !linked || !orchKeyChoice || !stored}
                      style={btnPrimary(violet, t.accent)}>
                      <Radio size={13} /> {delegateBusy ? "Signing…" : "Delegate to orchestrator"}
                    </button>
                  )}
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: t.textMuted, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {orchestratorDelegated ? (
                    <><CheckCircle2 size={12} color={t.green} /> <strong style={{ color: t.green }}>Delegation is secure</strong> — FC-scoped, allowance limited.</>
                  ) : (
                    <><AlertTriangle size={12} color={t.amber} /> <strong style={{ color: t.amber }}>Not delegated</strong> — agent only acts when browser is online.</>
                  )}
                </div>
              </PanelShell>

              {/* Recent Activity */}
              <PanelShell t={t}>
                <PanelHeader t={t} icon={Activity} title="Recent Activity" accent={violet}
                  rightSlot={<button onClick={fetchStatsBundle} style={{ fontSize: 11, color: violet, textDecoration: "none", fontWeight: 700, background: "transparent", border: "none", cursor: "pointer" }}>Refresh</button>}
                />
                {activity.length === 0 ? (
                  <div style={{ fontSize: 12, color: t.textDim, textAlign: "center", padding: "18px 0" }}>
                    No activity yet. Points, submissions, and delegations will land here.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activity.slice(0, 6).map((a, i) => (
                      <ActivityRow key={i} t={t} entry={a} violet={violet} />
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 12, fontSize: 10.5, color: t.textDim, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <ShieldCheck size={11} color={t.green} />
                  All activity is recorded on-chain.
                </div>
              </PanelShell>

              {/* Agent Status */}
              <PanelShell t={t}>
                <PanelHeader t={t} icon={Zap} title="Agent Status" accent={violet} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <StatusRow t={t} icon={Activity} label="Status" value={isActive ? "Live" : "Idle"}
                    valueColor={isActive ? t.green : t.textMuted} />
                  <StatusRow t={t} icon={Clock} label="Last Active" value={lastActiveLabel} valueColor={t.white} />
                  <StatusRow t={t} icon={Radio} label="Orchestrator" value={orchestratorDelegated ? "Delegated" : "Not delegated"}
                    valueColor={orchestratorDelegated ? t.green : t.textMuted} />
                  <StatusRow t={t} icon={TrendingUp} label="Level" value={`Level ${level}`} valueColor={t.white}
                    footer={
                      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 5, background: t.bgSurface, borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(100, (xpInLevel / xpLevelSpan) * 100)}%`,
                            background: `linear-gradient(90deg, ${violet}, ${t.accent})`, borderRadius: 99,
                          }} />
                        </div>
                        <span style={{ fontSize: 10, color: t.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                          {fmt(xp)} / {fmt(xpForNext)}
                        </span>
                      </div>
                    } />
                </div>

                <div style={{ marginTop: 16, borderTop: `1px solid ${t.border}`, paddingTop: 14 }}>
                  <div style={{ fontSize: 10.5, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
                    Security checklist
                  </div>
                  <SecurityCheck t={t} ok={linked} label="Sub-wallet linked" />
                  <SecurityCheck t={t} ok={orchestratorDelegated} label="Orchestrator delegated for 24/7 action" />
                  <SecurityCheck t={t} ok={Boolean(stored)} label="Backup key present in this browser" />
                </div>

                <div style={{ marginTop: 16 }}>
                  <button disabled title="Pause Agent — wires when orchestrator control plane ships" style={{
                    width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`,
                    borderRadius: 10, padding: "10px 12px", fontSize: 12, fontWeight: 700,
                    color: t.textMuted, cursor: "not-allowed", opacity: 0.7,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    <Pause size={13} /> Pause Agent <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>(soon)</span>
                  </button>
                </div>
              </PanelShell>
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        @media (max-width: 1000px) {
          .dash-hero-grid { grid-template-columns: 1fr 1fr !important; }
          .dash-hero-grid > :nth-child(3) { display: none; }
          .dash-body-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 680px) {
          .dash-hero-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </Section>

    {showExport && stored && (
      <ExportKeyModal t={t} stored={stored} onClose={() => setShowExport(false)} />
    )}
    </>
  );
}

// ─── Helpers + small components used by the new layout ─────────────────────

function levelFromPoints(points) {
  // Simple thresholds: L1 0+, L2 1k+, L3 5k+, L4 25k+, L5 100k+, L6 500k+, L7+ every ×5 after.
  const thresholds = [0, 1_000, 5_000, 25_000, 100_000, 500_000, 2_500_000, 12_500_000];
  let level = 1;
  for (let i = 1; i < thresholds.length; i++) {
    if (points >= thresholds[i]) level = i + 1;
  }
  const curLo   = thresholds[level - 1] ?? 0;
  const nextHi  = thresholds[level] ?? curLo * 5;
  return {
    level,
    xp:          points,
    xpForNext:   nextHi,
    xpInLevel:   points - curLo,
    xpLevelSpan: Math.max(1, nextHi - curLo),
  };
}

function fmtRelative(diffMs) {
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function btnGhost(t) {
  return {
    background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
    padding: "7px 12px", fontSize: 11.5, color: t.text, cursor: "pointer",
    fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6,
  };
}
function btnPrimary(violet, accent) {
  return {
    background: `linear-gradient(135deg, ${violet}, ${accent})`, border: "none", borderRadius: 10,
    padding: "10px 16px", fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 6,
    boxShadow: `0 10px 24px ${violet}44`,
  };
}

function StatLine({ t, icon: Icon, color, value, label }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMuted }}>
      <Icon size={13} color={color} />
      <span style={{ color: t.white, fontWeight: 700, fontFamily: label === "pts" ? "'JetBrains Mono', monospace" : "inherit" }}>{value}</span>
      {label && <span>{label}</span>}
    </div>
  );
}

function PanelShell({ t, children }) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: "18px 20px",
    }}>
      {children}
    </div>
  );
}

function PanelHeader({ t, icon: Icon, title, accent, rightSlot }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
      <div style={{
        background: `${accent}1a`, borderRadius: 8, width: 26, height: 26,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={13} color={accent} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 800, color: t.white, letterSpacing: 0.6, textTransform: "uppercase" }}>
        {title}
      </div>
      <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
        {rightSlot}
      </div>
    </div>
  );
}

function MiniKV({ t, label, value, mono, copy }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{
        fontSize: 13, color: t.white, marginTop: 2,
        fontFamily: mono ? "'JetBrains Mono', monospace" : "inherit",
        display: "inline-flex", alignItems: "center", gap: 6, wordBreak: "break-all",
      }}>
        {value}
        {copy && <CopyBtn text={copy} t={t} size={11} />}
      </div>
    </div>
  );
}

function StatCardLg({ t, label, value, unit, icon: Icon, accent, delta, spark, hint }) {
  const deltaSign = delta == null ? null : delta >= 0 ? "up" : "down";
  const deltaColor = deltaSign === "up" ? t.green : deltaSign === "down" ? t.red : t.textMuted;
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, minHeight: 128,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontSize: 10.5, color: t.textMuted, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase" }}>
          {label}
        </div>
        <div style={{
          background: `${accent}1a`, borderRadius: 8, width: 28, height: 28,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Icon size={13} color={accent} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: t.white, letterSpacing: -0.3 }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: t.textDim, fontWeight: 600 }}>{unit}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {delta != null && (
          <span style={{ fontSize: 11.5, color: deltaColor, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
            {deltaSign === "up" ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint && <span style={{ fontSize: 11, color: t.textDim }}>{hint}</span>}
      </div>
      {spark && spark.length >= 2 && (
        <div style={{ marginTop: 4 }}>
          <Sparkline data={spark} color={accent} width={180} height={28} />
        </div>
      )}
    </div>
  );
}

function Sparkline({ data, color, width = 200, height = 32 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = Math.max(1, max - min);
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${height - ((v - min) / span) * height}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", width: "100%" }}>
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`${pts} ${width},${height} 0,${height}`} fill={`url(#spark-${color.replace('#', '')})`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PerfMetric({ t, label, value, delta, accent }) {
  const deltaSign = delta == null ? null : delta >= 0 ? "up" : "down";
  const deltaColor = deltaSign === "up" ? t.green : deltaSign === "down" ? t.red : t.textMuted;
  return (
    <div>
      <div style={{ fontSize: 10.5, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
        {delta != null && (
          <span style={{ fontSize: 11, color: deltaColor, fontWeight: 700 }}>
            {deltaSign === "up" ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function WeeklyPointsChart({ t, snapshots, current, accent }) {
  const data = snapshots.length ? [...snapshots, current || 0] : [];
  if (!data.length) {
    return (
      <div style={{
        background: t.bgSurface, border: `1px dashed ${t.border}`, borderRadius: 10,
        padding: "40px 18px", textAlign: "center", fontSize: 12, color: t.textDim,
      }}>
        No weekly data yet — complete your first submission to start the chart.
      </div>
    );
  }
  return (
    <div style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "14px 16px" }}>
      <Sparkline data={data} color={accent} height={110} width={600} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: t.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
        {data.map((_, i) => <span key={i}>W{i + 1}</span>)}
      </div>
    </div>
  );
}

function ActivityRow({ t, entry, violet }) {
  const kindMeta = {
    points_awarded:       { label: "Points Awarded",       icon: Star,      color: "#22c55e" },
    submission_approved:  { label: "Submission Approved",  icon: CheckCircle2, color: "#22c55e" },
    submission_rejected:  { label: "Submission Rejected",  icon: XCircle,   color: "#ef4444" },
    mission_completed:    { label: "Mission Completed",    icon: Target,    color: "#a855f7" },
    delegated:            { label: "Delegated",            icon: Radio,     color: "#3b82f6" },
  }[entry.kind] || { label: entry.kind, icon: Activity, color: violet };
  const Icon = kindMeta.icon;
  const ts = entry.timestamp ? Number(BigInt(entry.timestamp) / 1_000_000n) : 0;
  const rel = ts ? fmtRelative(Date.now() - ts) : "";
  const amt = entry.amount != null && entry.amount !== "0" && entry.amount !== 0 ? Number(BigInt(entry.amount)) : 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 10px", background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
    }}>
      <div style={{ background: `${kindMeta.color}1a`, borderRadius: 8, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={12} color={kindMeta.color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: t.white, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.description || kindMeta.label}
        </div>
        <div style={{ fontSize: 10.5, color: t.textDim }}>{kindMeta.label}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {amt > 0 && (
          <div style={{ fontSize: 12, color: t.green, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
            +{fmt(amt)} pts
          </div>
        )}
        <div style={{ fontSize: 10.5, color: t.textDim }}>{rel}</div>
      </div>
    </div>
  );
}

function StatusRow({ t, icon: Icon, label, value, valueColor, footer }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: t.textMuted }}>
          <Icon size={12} color={t.textDim} /> {label}
        </span>
        <span style={{ fontSize: 12.5, color: valueColor || t.white, fontWeight: 700 }}>{value}</span>
      </div>
      {footer}
    </div>
  );
}

function SecurityCheck({ t, ok, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: t.textMuted, padding: "6px 0" }}>
      {ok
        ? <CheckCircle2 size={14} color={t.green} />
        : <XCircle size={14} color={t.textDim} />}
      <span style={{ color: ok ? t.white : t.textMuted }}>{label}</span>
    </div>
  );
}

