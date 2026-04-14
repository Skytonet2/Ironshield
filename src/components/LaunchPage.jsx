"use client";
import { useState, useEffect, useRef } from "react";
import { Rocket, Clock, Shield, Coins, Users, Lock, CheckCircle, AlertTriangle, Flame, TrendingUp, Wallet } from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import { LaunchScope } from "./IronClawSections";

const LAUNCH_DATE = new Date("2026-05-01T14:00:00Z");

const TOKEN_NAME = "$IRONCLAW";
const TOTAL_SUPPLY = "1,000,000,000";
const LAUNCH_PRICE = "TBA";

const TIERS = [
  { name: "Community", allocation: "35%", amount: "350,000,000", desc: "Staking rewards, missions, airdrops", color: "#e8581a", icon: Users },
  { name: "Treasury", allocation: "20%", amount: "200,000,000", desc: "12-month cliff, 48-month vest, multisig", color: "#2eb87a", icon: Shield },
  { name: "Team & Advisors", allocation: "15%", amount: "150,000,000", desc: "12-month cliff, 36-month vest", color: "#d4a843", icon: Lock },
  { name: "Public Sale", allocation: "12%", amount: "120,000,000", desc: "15% at TGE, 12-month linear vest", color: "#8b6fc4", icon: Rocket },
  { name: "Liquidity", allocation: "10%", amount: "100,000,000", desc: "20% at TGE for DEX pools", color: "#5a9fd4", icon: TrendingUp },
  { name: "Seed / Private", allocation: "8%", amount: "80,000,000", desc: "6-month cliff, 24-month vest", color: "#3a4a5c", icon: Coins },
];

function useCountdown(target) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { d, h, m, s, live: diff === 0 };
}

export default function LaunchPage({ openWallet }) {
  const t = useTheme();
  const { connected, address } = useWallet();
  const countdown = useCountdown(LAUNCH_DATE);
  const [amount, setAmount] = useState("");
  const [registered, setRegistered] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && address) {
      const reg = localStorage.getItem("ironshield_launch_registered");
      if (reg) {
        try {
          const parsed = JSON.parse(reg);
          if (parsed.includes(address)) setRegistered(true);
        } catch {}
      }
    }
  }, [address]);

  const handleRegister = () => {
    if (!address) return;
    const existing = JSON.parse(localStorage.getItem("ironshield_launch_registered") || "[]");
    if (!existing.includes(address)) {
      existing.push(address);
      localStorage.setItem("ironshield_launch_registered", JSON.stringify(existing));
    }
    setRegistered(true);
    setShowConfirm(true);
    setTimeout(() => setShowConfirm(false), 4000);
  };

  const CountdownUnit = ({ value, label }) => (
    <div style={{ textAlign: "center" }}>
      <div style={{
        background: t.bgCard, border: `1px solid ${t.accent}44`, borderRadius: 14,
        padding: "16px 20px", minWidth: 80, boxShadow: `0 0 30px ${t.accent}15`,
      }}>
        <div style={{ fontSize: 36, fontWeight: 800, color: t.white, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
          {String(value).padStart(2, "0")}
        </div>
      </div>
      <div style={{ fontSize: 11, color: t.textDim, marginTop: 8, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>{label}</div>
    </div>
  );

  return (
    <>
    <Section style={{ paddingTop: 100 }}>
      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 56, position: "relative" }}>
        <div style={{
          position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)",
          width: 400, height: 400, background: `radial-gradient(circle, ${t.accent}12 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />
        <Badge color={t.amber}>TOKEN GENERATION EVENT</Badge>
        <h1 style={{ fontSize: 44, fontWeight: 800, color: t.white, marginTop: 16, lineHeight: 1.1, letterSpacing: "-1px" }}>
          {TOKEN_NAME} Token Launch
        </h1>
        <p style={{ fontSize: 16, color: t.textMuted, marginTop: 12, maxWidth: 560, margin: "12px auto 0", lineHeight: 1.7 }}>
          The utility token powering the IronClaw AI security ecosystem on NEAR Protocol. Stake, govern, and earn from real protocol revenue.
        </p>

        {/* Countdown */}
        <div style={{ marginTop: 40, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 16, fontWeight: 600 }}>
            <Clock size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            {countdown.live ? "LAUNCH IS LIVE" : "COUNTDOWN TO LAUNCH"}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            <CountdownUnit value={countdown.d} label="Days" />
            <div style={{ fontSize: 28, fontWeight: 800, color: t.accent, alignSelf: "flex-start", marginTop: 16 }}>:</div>
            <CountdownUnit value={countdown.h} label="Hours" />
            <div style={{ fontSize: 28, fontWeight: 800, color: t.accent, alignSelf: "flex-start", marginTop: 16 }}>:</div>
            <CountdownUnit value={countdown.m} label="Minutes" />
            <div style={{ fontSize: 28, fontWeight: 800, color: t.accent, alignSelf: "flex-start", marginTop: 16 }}>:</div>
            <CountdownUnit value={countdown.s} label="Seconds" />
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid-wrap-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 40 }}>
        {[
          { icon: Coins, label: "Total Supply", value: TOTAL_SUPPLY, color: t.accent },
          { icon: Rocket, label: "Launch Price", value: LAUNCH_PRICE, color: t.green },
          { icon: Lock, label: "Supply Type", value: "Fixed / No Mint", color: t.amber },
          { icon: Flame, label: "Deflationary", value: "Burn on Early Unstake", color: "#e8581a" },
        ].map((s, i) => (
          <div key={i} style={{
            background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: "22px 24px",
            transition: "all 0.3s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = s.color; e.currentTarget.style.boxShadow = `0 0 24px ${s.color}22`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ background: `${s.color}18`, borderRadius: 10, padding: 9, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <s.icon size={18} color={s.color} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Registration + Allocation Info */}
      <div className="grid-wrap-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 40 }}>
        {/* Left: Whitelist Registration */}
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Rocket size={20} color={t.accent} />
            <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>Join the Launch</div>
          </div>
          <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 28, lineHeight: 1.6 }}>
            Register your wallet for the public sale whitelist. Early registrants get priority allocation.
          </p>

          {showConfirm && (
            <div style={{ background: `${t.green}18`, border: `1px solid ${t.green}44`, borderRadius: 12, padding: "14px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
              <CheckCircle size={16} color={t.green} />
              <span style={{ color: t.green, fontSize: 13, fontWeight: 600 }}>You are registered for the {TOKEN_NAME} launch!</span>
            </div>
          )}

          {!connected ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <Lock size={32} color={t.textDim} style={{ marginBottom: 12 }} />
              <div style={{ color: t.textMuted, fontSize: 14, marginBottom: 16 }}>Connect your NEAR wallet to register</div>
              <Btn primary onClick={openWallet}><Wallet size={14} /> Connect Wallet</Btn>
            </div>
          ) : registered ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: `${t.green}18`, border: `2px solid ${t.green}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <CheckCircle size={28} color={t.green} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: t.white, marginBottom: 6 }}>You're Registered!</div>
              <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 4 }}>Wallet: <span style={{ fontFamily: "'JetBrains Mono', monospace", color: t.accent }}>{address}</span></div>
              <div style={{ fontSize: 12, color: t.textDim, marginTop: 12 }}>We'll notify you when the sale goes live.</div>
            </div>
          ) : (
            <div>
              <div style={{ background: t.bgSurface, borderRadius: 12, padding: 18, marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Your Wallet</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{address}</div>
              </div>

              <div style={{ background: `${t.amber}12`, border: `1px solid ${t.amber}33`, borderRadius: 10, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <AlertTriangle size={16} color={t.amber} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12, color: t.amber, lineHeight: 1.6 }}>
                  Registration is free. No tokens will be deducted. Sale details will be announced before TGE.
                </div>
              </div>

              <Btn primary onClick={handleRegister} style={{ width: "100%", padding: 16, fontSize: 15, justifyContent: "center" }}>
                <Rocket size={16} /> Register for Whitelist
              </Btn>
            </div>
          )}

          <div style={{ marginTop: 24, borderTop: `1px solid ${t.border}`, paddingTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.white, marginBottom: 12 }}>Launch Timeline</div>
            {[
              { step: "Whitelist Registration", status: "live", date: "Now" },
              { step: "KYC / Eligibility Check", status: "upcoming", date: "Before TGE" },
              { step: "Public Sale Opens", status: "upcoming", date: "TGE Day" },
              { step: "Token Distribution", status: "upcoming", date: "At TGE" },
              { step: "DEX Listing (Rhea Finance)", status: "upcoming", date: "Post-TGE" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: item.status === "live" ? t.green : t.textDim,
                  boxShadow: item.status === "live" ? `0 0 8px ${t.green}` : "none",
                }} />
                <div style={{ flex: 1, fontSize: 13, color: item.status === "live" ? t.white : t.textMuted }}>{item.step}</div>
                <div style={{ fontSize: 11, color: item.status === "live" ? t.green : t.textDim, fontWeight: 600 }}>{item.date}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Token Allocation Breakdown */}
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: t.white, marginBottom: 6 }}>Token Allocation</div>
          <p style={{ fontSize: 13, color: t.textMuted, marginBottom: 24 }}>Fixed supply. No minting. Declining emission over 5 years.</p>

          {/* Visual bar chart */}
          <div style={{ marginBottom: 28 }}>
            {TIERS.map((tier, i) => {
              const pct = parseInt(tier.allocation);
              return (
                <div key={i} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: tier.color }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: t.white }}>{tier.name}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: tier.color, fontFamily: "'JetBrains Mono', monospace" }}>{tier.allocation}</span>
                  </div>
                  <div style={{ height: 8, background: t.bgSurface, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      background: `linear-gradient(90deg, ${tier.color}, ${tier.color}88)`,
                      width: `${(pct / 35) * 100}%`, transition: "width 0.8s ease",
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>{tier.desc}</div>
                </div>
              );
            })}
          </div>

          <div style={{ background: t.bgSurface, borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.white, marginBottom: 12 }}>Key Facts</div>
            {[
              { label: "Total Supply", value: TOTAL_SUPPLY },
              { label: "Token Standard", value: "NEP-141 (NEAR)" },
              { label: "Emission Window", value: "5 years, declining" },
              { label: "Burn Mechanism", value: "Early unstake penalty" },
              { label: "Revenue Model", value: "Real yield from fees" },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 4 ? `1px solid ${t.border}66` : "none" }}>
                <span style={{ fontSize: 12, color: t.textMuted }}>{item.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32, marginBottom: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Badge color={t.accent}>HOW THE LAUNCH WORKS</Badge>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: t.white, marginTop: 12 }}>Fair Launch on NEAR</h2>
        </div>
        <div className="grid-wrap-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {[
            {
              step: "01", title: "Register Your Wallet",
              desc: "Connect your NEAR wallet and join the whitelist. No cost to register. Priority is first-come-first-served.",
              icon: Wallet, color: t.accent,
            },
            {
              step: "02", title: "Participate in Sale",
              desc: "When the sale opens, send NEAR to the launch contract. Tokens are allocated proportionally to your contribution.",
              icon: Coins, color: t.green,
            },
            {
              step: "03", title: "Receive & Stake",
              desc: "Tokens are distributed at TGE. Immediately stake to start earning real yield from IronShield protocol fees.",
              icon: TrendingUp, color: t.amber,
            },
          ].map((s, i) => (
            <div key={i} style={{ background: t.bgSurface, borderRadius: 14, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: s.color, letterSpacing: 1, marginBottom: 14 }}>STEP {s.step}</div>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: `${s.color}18`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <s.icon size={22} color={s.color} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: t.white, marginBottom: 8 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.65 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* What is IronClaw */}
      <div style={{ background: t.bgCard, border: `1px solid ${t.accent}33`, borderRadius: 20, padding: 32, marginBottom: 40, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: 200, height: 200, background: `radial-gradient(circle, ${t.accent}08, transparent)`, pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Shield size={22} color={t.accent} />
          <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>What is IronClaw?</div>
        </div>
        <p style={{ fontSize: 15, color: t.textMuted, lineHeight: 1.75, marginBottom: 20, maxWidth: 700 }}>
          IronClaw is a secure, open-source AI agent runtime built on NEAR Protocol. It provides a self-hostable, privacy-first AI assistant with WASM-sandboxed tooling, multi-LLM support, and on-chain credential management. IronShield is the ecosystem's security layer — protecting communities from scams, phishing, and rug pulls.
        </p>
        <p style={{ fontSize: 15, color: t.textMuted, lineHeight: 1.75, marginBottom: 24, maxWidth: 700 }}>
          The {TOKEN_NAME} token aligns incentives across the ecosystem: stakers earn real yield from protocol fees, governors shape AI behavior and treasury decisions, and the deflationary burn mechanism ensures long-term value accrual.
        </p>
        <div className="grid-wrap-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {[
            { label: "WASM Sandboxed", desc: "Secure tool execution", color: t.accent },
            { label: "Multi-LLM", desc: "Anthropic, OpenAI, Gemini & more", color: t.green },
            { label: "On-Chain Native", desc: "Built for NEAR Protocol", color: t.amber },
          ].map((feat, i) => (
            <div key={i} style={{ background: t.bgSurface, borderRadius: 10, padding: 16, borderLeft: `3px solid ${feat.color}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: feat.color, marginBottom: 4 }}>{feat.label}</div>
              <div style={{ fontSize: 12, color: t.textMuted }}>{feat.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 12, color: t.textDim, lineHeight: 1.7, maxWidth: 640, margin: "0 auto" }}>
          <strong style={{ color: t.textMuted }}>Disclaimer:</strong> Token launch details including price, date, and allocation may change.
          This is not financial advice. Participation is at your own risk. Always do your own research.
          IronShield operates on NEAR Protocol — transactions are final and irreversible.
        </div>
      </div>
    </Section>

    {/* ─── Launch scope — what ships on day one ─── */}
    <LaunchScope />
    </>
  );
}
