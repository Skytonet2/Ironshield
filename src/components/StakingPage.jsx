"use client";
import { useState, useEffect, useCallback } from "react";
import { Coins, TrendingUp, Users, Flame, Target, Lock, CheckCircle, Loader } from "lucide-react";
import { Section, Badge, StatCard, WalletGate, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import useNear, { IRONCLAW_TOKEN, STAKING_CONTRACT } from "@/hooks/useNear";
import { TokenomicsDeep } from "./IronClawSections";

// ── Amount helpers ──────────────────────────────────────────────
const toYocto = (amount) => {
  if (!amount || isNaN(parseFloat(amount))) return "0";
  return BigInt(Math.floor(parseFloat(amount) * 1e24)).toString();
};
const fromYocto = (yocto) => {
  if (!yocto || yocto === "0") return "0.0000";
  return (parseFloat(yocto) / 1e24).toFixed(4);
};
const fmt = (num, dec = 2) => {
  if (!num) return "—";
  return parseFloat(num).toLocaleString(undefined, { maximumFractionDigits: dec });
};

export default function StakingPage({ openWallet }) {
  const t = useTheme();
  const { connected, address } = useWallet();
  const { viewMethod, callMethod } = useNear();

  const [selectedTier, setSelectedTier] = useState(2);
  const [amount, setAmount] = useState("");
  const [activeTab, setActiveTab] = useState("stake");

  // Contract data
  const [poolData, setPoolData] = useState(null);
  const [userData, setUserData] = useState(null);
  const [pendingReward, setPendingReward] = useState("0");

  // UI state
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const tiers = [
    { name: "Flex",    lock: "No lock",   mult: "1.0x", gov: "1x",  color: t.textMuted, apy: "12%", emoji: "⚡", minStake: "1,000",  poolId: 0 },
    { name: "Silver",  lock: "30 days",   mult: "1.25x",gov: "1.5x",color: "#94a3b8",  apy: "15%", emoji: "🥈", minStake: "5,000",  poolId: 1 },
    { name: "Gold",    lock: "90 days",   mult: "1.5x", gov: "2x",  color: t.amber,    apy: "18%", emoji: "🥇", minStake: "10,000", poolId: 2 },
    { name: "Diamond", lock: "180 days",  mult: "2.0x", gov: "3x",  color: t.accent,   apy: "24%", emoji: "💎", minStake: "25,000", poolId: 3 },
  ];
  const sel = tiers[selectedTier];

  // ── Fetch contract data ─────────────────────────────────────────
  const fetchPoolData = useCallback(async () => {
    const pool = await viewMethod(STAKING_CONTRACT, "get_pool", { pool_id: selectedTier });
    if (pool) setPoolData(pool);
  }, [selectedTier, viewMethod]);

  const fetchUserData = useCallback(async () => {
    if (!address) return;
    const user = await viewMethod(STAKING_CONTRACT, "get_user", {
      pool_id: selectedTier,
      account_id: address,
    });
    if (user) setUserData(user);

    const reward = await viewMethod(STAKING_CONTRACT, "pending_reward", {
      pool_id: selectedTier,
      account_id: address,
    });
    if (reward !== null) setPendingReward(reward);
  }, [address, selectedTier, viewMethod]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchPoolData(), fetchUserData()]).finally(() => setLoading(false));
  }, [fetchPoolData, fetchUserData]);

  // Refresh pending reward every 30s
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(fetchUserData, 30000);
    return () => clearInterval(interval);
  }, [connected, fetchUserData]);

  const showError = (msg) => { setError(msg); setTimeout(() => setError(""), 4000); };
  const showSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(""), 4000); };

  const validateAmount = () => {
    if (!amount || parseFloat(amount) <= 0) { showError("Enter a valid amount"); return false; }
    return true;
  };

  // ── Stake ───────────────────────────────────────────────────────
  const handleStake = async () => {
    if (!connected) return openWallet();
    if (!validateAmount()) return;
    setTxLoading(true);
    setError("");
    try {
      // Staking goes through ft_transfer_call on the TOKEN contract
      await callMethod(
        IRONCLAW_TOKEN,
        "ft_transfer_call",
        {
          receiver_id: STAKING_CONTRACT,
          amount: toYocto(amount),
          msg: selectedTier.toString(),
        },
        "1" // exactly 1 yoctoNEAR required for NEP-141
      );
      showSuccess(`Staked ${amount} $IRONCLAW successfully!`);
      setAmount("");
      await fetchUserData();
      await fetchPoolData();
    } catch (err) {
      showError(err.message || "Staking failed. Please try again.");
    } finally {
      setTxLoading(false);
    }
  };

  // ── Unstake ─────────────────────────────────────────────────────
  const handleUnstake = async () => {
    if (!connected) return openWallet();
    if (!validateAmount()) return;
    setTxLoading(true);
    setError("");
    try {
      await callMethod(
        STAKING_CONTRACT,
        "unstake",
        { pool_id: selectedTier, amount: toYocto(amount) },
        "0"
      );
      showSuccess(`Unstaked ${amount} $IRONCLAW successfully!`);
      setAmount("");
      await fetchUserData();
      await fetchPoolData();
    } catch (err) {
      showError(err.message || "Unstaking failed. Please try again.");
    } finally {
      setTxLoading(false);
    }
  };

  // ── Claim ───────────────────────────────────────────────────────
  const handleClaim = async () => {
    if (!connected) return openWallet();
    if (parseFloat(pendingReward) === 0) return showError("No rewards to claim");
    setTxLoading(true);
    setError("");
    try {
      await callMethod(
        STAKING_CONTRACT,
        "claim",
        { pool_id: selectedTier },
        "0"
      );
      showSuccess("Rewards claimed successfully!");
      setPendingReward("0");
      await fetchUserData();
    } catch (err) {
      showError(err.message || "Claim failed. Please try again.");
    } finally {
      setTxLoading(false);
    }
  };

  // Percent shortcuts
  const stakedAmount = userData?.amount ? parseFloat(fromYocto(userData.amount)) : 0;
  const handlePct = (pct) => {
    if (!stakedAmount) return;
    const val = pct === "MAX" ? stakedAmount : stakedAmount * (parseInt(pct) / 100);
    setAmount(val.toFixed(4));
  };

  const totalStaked = poolData?.total_staked ? fmt(fromYocto(poolData.total_staked)) : "—";
  const userStaked  = userData?.amount       ? fmt(fromYocto(userData.amount), 4)    : "—";
  const pendingNEAR = fromYocto(pendingReward);
  const hasPending  = parseFloat(pendingNEAR) > 0;

  return (
    <>
    <Section style={{ paddingTop: 100 }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color={t.green}>LIVE</Badge>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: t.white, marginTop: 12 }}>Stake $IRONCLAW</h1>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8 }}>Earn real yield from protocol fees — not inflation.</p>
      </div>

      {/* Status messages */}
      {error && (
        <div style={{ background: `${t.red}18`, border: `1px solid ${t.red}44`, borderRadius: 10, padding: "12px 20px", marginBottom: 20, color: t.red, fontSize: 13 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: `${t.green}18`, border: `1px solid ${t.green}44`, borderRadius: 10, padding: "12px 20px", marginBottom: 20, color: t.green, fontSize: 13 }}>
          {success}
        </div>
      )}

      {/* Stats row */}
      <div className="grid-wrap-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 40 }}>
        <StatCard icon={Coins}     label="Total Staked"     value={loading ? "..." : totalStaked}  positive={false} color={t.textMuted} />
        <StatCard icon={TrendingUp} label="Current APY"     value={sel.apy}                        positive={true}  color={t.green} />
        <StatCard icon={Users}      label="Active Stakers"  value="—"                              positive={false} color={t.textMuted} />
        <StatCard icon={Flame}      label="Burned This Week" value="—"                             color={t.textMuted} />
      </div>

      {/* Tier selector */}
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
        {/* Stake/Unstake panel */}
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <Btn primary={activeTab === "stake"} onClick={() => setActiveTab("stake")} style={{ flex: 1 }}>Stake</Btn>
            <Btn primary={activeTab === "unstake"} onClick={() => setActiveTab("unstake")} style={{ flex: 1, background: activeTab === "unstake" ? t.accent : t.bgSurface }}>Unstake</Btn>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8 }}>Amount ($IRONCLAW)</div>
            <div style={{ position: "relative" }}>
              <input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                style={{ width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 12, padding: "16px 20px", fontSize: 24, fontWeight: 600, color: t.white, outline: "none" }}
              />
              <div style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", fontSize: 13, fontWeight: 700, color: t.accent }}>$IRONCLAW</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 32 }}>
            {["25%", "50%", "75%", "MAX"].map(pct => (
              <button key={pct} onClick={() => handlePct(pct)} style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "8px 0", color: t.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{pct}</button>
            ))}
          </div>

          <div style={{ background: t.bgSurface, borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Selected Tier</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: sel.color }}>{sel.name}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Lock Period</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: t.white }}>{sel.lock}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Est. APY</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: t.green }}>{sel.apy}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Vote Multiplier</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: t.white }}>{sel.gov}</span>
            </div>
          </div>

          {activeTab === "stake" ? (
            <Btn
              primary
              onClick={handleStake}
              disabled={txLoading}
              style={{ width: "100%", padding: 16, fontSize: 16, justifyContent: "center" }}
            >
              {txLoading ? <><Loader size={18} style={{ animation: "spin 1s linear infinite" }} /> Staking...</> : <><Lock size={18} /> Stake $IRONCLAW</>}
            </Btn>
          ) : (
            <Btn
              onClick={handleUnstake}
              disabled={txLoading}
              style={{ width: "100%", padding: 16, fontSize: 16, justifyContent: "center", background: t.accent, color: "#fff" }}
            >
              {txLoading ? <><Loader size={18} style={{ animation: "spin 1s linear infinite" }} /> Unstaking...</> : "Unstake $IRONCLAW"}
            </Btn>
          )}
        </div>

        {/* Position panel */}
        <WalletGate openWallet={openWallet}>
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.white, marginBottom: 24 }}>Your Position</div>

            <div style={{ background: t.bgSurface, borderRadius: 12, padding: 24, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8 }}>Staked Balance</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: t.white }}>{loading ? "..." : userStaked}</div>
              <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>$IRONCLAW</div>
            </div>

            <div className="grid-wrap-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
              <div style={{ background: t.bgSurface, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Pending Rewards</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: hasPending ? t.green : t.white }}>
                  {loading ? "..." : `${pendingNEAR} NEAR`}
                </div>
              </div>
              <div style={{ background: t.bgSurface, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Pool Total</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>{loading ? "..." : totalStaked}</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <Btn
                primary
                onClick={handleClaim}
                disabled={txLoading || !hasPending}
                style={{ flex: 1, background: t.green, justifyContent: "center", opacity: hasPending ? 1 : 0.5 }}
              >
                {txLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle size={16} />}
                Claim
              </Btn>
              <Btn
                disabled={txLoading}
                onClick={() => setActiveTab("unstake")}
                style={{ flex: 1, justifyContent: "center" }}
              >
                Unstake
              </Btn>
            </div>
          </div>
        </WalletGate>
      </div>

      {/* How staking works — preserved exactly */}
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16, padding: 32, marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: t.white, marginBottom: 6 }}>How Staking Works</div>
        <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 28, lineHeight: 1.6 }}>
          Protocol fees from IronShield subscriptions and ecosystem activity are pooled and distributed proportionally to stakers based on their tier multiplier. No inflation — real revenue sharing.
        </p>
        <div className="grid-wrap-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 32 }}>
          {[
            { step: "01", title: "Choose a Tier", desc: "Pick Flex, Silver, Gold, or Diamond based on your lock period comfort.", icon: Target },
            { step: "02", title: "Stake Tokens",  desc: "Lock your $IRONCLAW via NEAR smart contract. Funds stay non-custodial.", icon: Lock },
            { step: "03", title: "Earn Rewards",  desc: "Protocol fees hit the pool daily. Rewards accrue every block.", icon: TrendingUp },
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
                { name: "Flex",    min: "1,000",  lock: "None",     apy: "12%", mult: "1.0x", gov: "1x vote",   exit: "Free",        color: t.textMuted },
                { name: "Silver", min: "5,000",  lock: "30 days",  apy: "15%", mult: "1.25x",gov: "1.5x vote", exit: "2% penalty",  color: "#94a3b8" },
                { name: "Gold",   min: "10,000", lock: "90 days",  apy: "18%", mult: "1.5x", gov: "2x vote",   exit: "5% penalty",  color: t.amber },
                { name: "Diamond",min: "25,000", lock: "180 days", apy: "24%", mult: "2.0x", gov: "3x vote",   exit: "10% penalty", color: t.accent },
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
          <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 10 }}>Example Calculation: Gold Tier</div>
          <div className="grid-wrap-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {[
              { label: "You stake",      value: "10,000 $IRONCLAW" },
              { label: "Lock period",    value: "90 days" },
              { label: "Base APY",       value: "18%" },
              { label: "Annual reward",  value: "1,800 $IRONCLAW" },
              { label: "Daily reward",   value: "4.93 $IRONCLAW/day" },
              { label: "After 90 days",  value: "444 $IRONCLAW earned" },
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

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </Section>

    {/* ─── Tokenomics deep dive — fee model, staking tiers, governance params, burns ─── */}
    <TokenomicsDeep />
    </>
  );
}
