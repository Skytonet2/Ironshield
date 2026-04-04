"use client";
import { useState } from "react";
import { Coins, TrendingUp, Users, Flame, Target, Lock, CheckCircle, Unlock } from "lucide-react";
import { Section, Badge, StatCard, MiniBar, WalletGate, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";

export default function StakingPage({ openWallet }) {
  const t = useTheme(); const { connected } = useWallet();
  const [selectedTier, setSelectedTier] = useState(2);
  const [amount, setAmount] = useState("");
  const [activeTab, setActiveTab] = useState("stake"); // stake | unstake
  const tiers = [
    { name: "Flex", lock: "No lock", mult: "1.0x", gov: "1x", color: t.textMuted, apy: "12%", emoji: "⚡", minStake: "1,000" },
    { name: "Silver", lock: "30 days", mult: "1.25x", gov: "1.5x", color: "#94a3b8", apy: "15%", emoji: "🥈", minStake: "5,000" },
    { name: "Gold", lock: "90 days", mult: "1.5x", gov: "2x", color: t.amber, apy: "18%", emoji: "🥇", minStake: "10,000" },
    { name: "Diamond", lock: "180 days", mult: "2.0x", gov: "3x", color: t.accent, apy: "24%", emoji: "💎", minStake: "25,000" },
  ];
  const sel = tiers[selectedTier];
  return (
    <Section style={{ paddingTop: 100 }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color={t.green}>LIVE</Badge>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: t.white, marginTop: 12 }}>Stake $IRONCLAW</h1>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8 }}>Earn real yield from protocol fees — not inflation.</p>
      </div>

      <div className="grid-wrap-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 40 }}>
        <StatCard icon={Coins} label="Total Staked" value="—" positive={false} color={t.textMuted} />
        <StatCard icon={TrendingUp} label="Current APY" value="TBA" positive={false} color={t.textMuted} />
        <StatCard icon={Users} label="Active Stakers" value="—" positive={false} color={t.textMuted} />
        <StatCard icon={Flame} label="Burned This Week" value="—" color={t.textMuted} />
      </div>

      <div className="grid-wrap-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 36 }}>
        {tiers.map((tier, i) => (
          <div key={i} onClick={() => setSelectedTier(i)} style={{
            background: selectedTier === i ? `${tier.color}12` : t.bgCard,
            border: `2px solid ${selectedTier === i ? tier.color : t.border}`,
            borderRadius: 14, padding: 22, cursor: "pointer", transition: "all 0.25s",
            boxShadow: selectedTier === i ? `0 0 24px ${tier.color}22` : "none",
          }}>
            <div style={{ fontSize: 13, color: tier.color, fontWeight: 700, marginBottom: 4 }}>{tier.emoji} {tier.name}</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: t.white, fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>{tier.apy}</div>
            <div style={{ fontSize: 12, color: t.textDim, marginBottom: 3 }}>Lock: {tier.lock}</div>
            <div style={{ fontSize: 12, color: t.textDim, marginBottom: 3 }}>Multiplier: {tier.mult}</div>
            <div style={{ fontSize: 12, color: t.textDim }}>Min: {tier.minStake} $IRONCLAW</div>
          </div>
        ))}
      </div>

      <div className="grid-wrap-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 40 }}>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <Btn primary={activeTab === "stake"} onClick={() => setActiveTab("stake")} style={{ flex: 1 }}>Stake</Btn>
            <Btn primary={activeTab === "unstake"} onClick={() => setActiveTab("unstake")} style={{ flex: 1, background: activeTab === "unstake" ? t.accent : t.bgSurface }}>Unstake</Btn>
          </div>

          <div style={{ marginBottom: 24, opacity: 0.5, pointerEvents: "none" }}>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8 }}>Amount ($IRONCLAW)</div>
            <div style={{ position: "relative" }}>
              <input type="text" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} disabled style={{ width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 12, padding: "16px 20px", fontSize: 24, fontWeight: 600, color: t.white, outline: "none" }} />
              <div style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", fontSize: 13, fontWeight: 700, color: t.accent }}>$IRONCLAW</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 32, opacity: 0.5, pointerEvents: "none" }}>
            {["25%", "50%", "75%", "MAX"].map(pct => (
              <button key={pct} onClick={() => setAmount(pct)} disabled style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 0", color: t.textMuted, fontSize: 12, fontWeight: 600, cursor: "not-allowed" }}>{pct}</button>
            ))}
          </div>

          <div style={{ background: t.bgSurface, borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Selected Tier</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: tiers[selectedTier].color }}>{tiers[selectedTier].name}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Lock Period</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: t.white }}>{tiers[selectedTier].lock}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Est. APY</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: t.green }}>{tiers[selectedTier].apy}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Vote Multiplier</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: t.white }}>{tiers[selectedTier].gov}</span>
            </div>
          </div>

          <Btn disabled primary style={{ width: "100%", padding: 16, fontSize: 16, cursor: "not-allowed", opacity: 0.5 }}>
            <Lock size={18} /> Coming Soon
          </Btn>
        </div>

        <WalletGate openWallet={openWallet}>
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.white, marginBottom: 24 }}>Your Position</div>
            <div style={{ pointerEvents: "none", userSelect: "none" }}>
              <div style={{ background: t.bgSurface, borderRadius: 12, padding: 24, marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8 }}>Staked Balance</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: t.white }}>—</div>
                <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>$IRONCLAW</div>
              </div>

              <div className="grid-wrap-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                <div style={{ background: t.bgSurface, borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Pending Rewards</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>—</div>
                </div>
                <div style={{ background: t.bgSurface, borderRadius: 12, padding: 20 }}>
                  <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Total Earned</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>—</div>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>Earnings This Month</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 60, background: t.bgSurface, borderRadius: 8, border: `1px dashed ${t.border}` }}>
                  <div style={{ fontSize: 13, color: t.textDim }}>Available after token launch</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, opacity: 0.5 }}>
                <Btn disabled primary style={{ flex: 1, background: t.green, cursor: "not-allowed" }}><CheckCircle size={16} /> Claim</Btn>
                <Btn disabled style={{ flex: 1, cursor: "not-allowed" }}>Unstake</Btn>
              </div>
            </div>
          </div>
        </WalletGate>
      </div>

      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16, padding: 32, marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: t.white, marginBottom: 6 }}>How Staking Works</div>
        <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 28, lineHeight: 1.6 }}>
          Protocol fees from IronShield subscriptions and ecosystem activity are pooled and distributed proportionally to stakers based on their tier multiplier. No inflation — real revenue sharing.
        </p>
        <div className="grid-wrap-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 32 }}>
          {[
            { step: "01", title: "Choose a Tier", desc: "Pick Flex, Silver, Gold, or Diamond based on your lock period comfort.", icon: Target },
            { step: "02", title: "Stake Tokens", desc: "Lock your $IRONCLAW via NEAR smart contract. Funds stay non-custodial.", icon: Lock },
            { step: "03", title: "Earn Rewards", desc: "Protocol fees hit the pool daily. Rewards accrue every block.", icon: TrendingUp },
            { step: "04", title: "Claim or Compound", desc: "Claim to wallet anytime, or compound back into your staked position.", icon: Coins },
          ].map((s, i) => (
            <div key={i} style={{ background: t.bgSurface, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: t.accent, letterSpacing: 1, marginBottom: 10 }}>STEP {s.step}</div>
              <s.icon size={18} color={t.accent} style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: t.white, marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 16, fontWeight: 600, color: t.white, marginBottom: 16 }}>Tier Comparison</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                {["Tier", "Min. Stake", "Lock Period", "Base APY", "Fee Multiplier", "Voting Power", "Early Exit"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: t.textMuted, fontWeight: 600, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { name: "⚡ Flex", min: "1,000", lock: "None", apy: "12%", mult: "1.0x", gov: "1x vote", exit: "Free", color: t.textMuted },
                { name: "🥈 Silver", min: "5,000", lock: "30 days", apy: "15%", mult: "1.25x", gov: "1.5x vote", exit: "2% penalty", color: "#94a3b8" },
                { name: "🥇 Gold", min: "10,000", lock: "90 days", apy: "18%", mult: "1.5x", gov: "2x vote", exit: "5% penalty", color: t.amber },
                { name: "💎 Diamond", min: "25,000", lock: "180 days", apy: "24%", mult: "2.0x", gov: "3x vote", exit: "10% penalty", color: t.accent },
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${t.border}88`, background: selectedTier === i ? `${row.color}08` : "transparent" }}>
                  <td style={{ padding: "12px 14px", fontWeight: 700, color: row.color }}>{row.name}</td>
                  <td style={{ padding: "12px 14px", color: t.text, fontFamily: "'JetBrains Mono', monospace" }}>{row.min}</td>
                  <td style={{ padding: "12px 14px", color: t.text }}>{row.lock}</td>
                  <td style={{ padding: "12px 14px", color: t.green, fontWeight: 700 }}>{row.apy}</td>
                  <td style={{ padding: "12px 14px", color: t.accent }}>{row.mult}</td>
                  <td style={{ padding: "12px 14px", color: t.text }}>{row.gov}</td>
                  <td style={{ padding: "12px 14px", color: row.exit === "Free" ? t.green : t.amber }}>{row.exit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 28, background: t.bgSurface, borderRadius: 12, padding: 20, borderLeft: `3px solid ${t.green}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 10 }}>📊 Example Calculation: Gold Tier</div>
          <div className="grid-wrap-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {[
              { label: "You stake", value: "10,000 $IRONCLAW" },
              { label: "Lock period", value: "90 days" },
              { label: "Base APY", value: "18%" },
              { label: "Annual reward", value: "1,800 $IRONCLAW" },
              { label: "Daily reward", value: "≈ 4.93 $IRONCLAW/day" },
              { label: "After 90 days", value: "≈ 444 $IRONCLAW earned" },
            ].map((item, i) => (
              <div key={i} style={{ background: t.bgCard, borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, color: t.textDim, marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: t.textDim, marginTop: 12 }}>
            * APY is variable and depends on protocol revenue. Rewards are distributed from real ecosystem fees, not token emission.
          </div>
        </div>
      </div>
    </Section>
  );
}
