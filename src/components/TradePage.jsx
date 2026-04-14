"use client";
import { useState } from "react";
import { Coins, BarChart3, Activity, Flame } from "lucide-react";
import { Section, Badge, BlurBox, StatCard, MiniBar, Btn } from "./Primitives";
import { useTheme } from "@/lib/contexts";

export default function TradePage() {
  const t = useTheme();
  const [side, setSide] = useState("buy");
  const priceData = [0.031, 0.033, 0.028, 0.035, 0.040, 0.038, 0.042, 0.039, 0.044, 0.041, 0.046, 0.042, 0.048, 0.045];

  return (
    <Section style={{ paddingTop: 100 }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <Badge color={t.amber}>⚠ TOKEN NOT YET LIVE</Badge>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: t.white, marginTop: 12 }}>Buy & Sell $IRONCLAW</h1>
        <p style={{ fontSize: 14, color: t.textMuted, marginTop: 6 }}>Token launch pending. Trading will be live on Rhea Finance upon launch.</p>
      </div>

      <div className="grid-wrap-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        {[
          { icon: Coins, label: "Token Price", value: "$0.042" },
          { icon: BarChart3, label: "Market Cap", value: "$4.2M" },
          { icon: Activity, label: "24h Volume", value: "$180K" },
          { icon: Flame, label: "Circulating Supply", value: "100M" },
        ].map((s, i) => <StatCard key={i} {...s} color={t.accent} blur />)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 20 }}>
        <BlurBox label="Chart Not Live Yet" style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, minHeight: 300 }}>
          <div style={{ background: t.bgCard, borderRadius: 14, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: t.white, marginBottom: 16 }}>$IRONCLAW / USDC · 14d</div>
            <MiniBar data={priceData.map(v => v * 1000)} height={180} color={t.green} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: t.textDim }}>
              <span>Mar 20</span><span>Apr 3</span>
            </div>
          </div>
        </BlurBox>

        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 28 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
            {["buy", "sell"].map(s => (
              <button key={s} onClick={() => setSide(s)} style={{
                flex: 1, padding: "10px 0", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.2s", textTransform: "uppercase",
                background: side === s ? (s === "buy" ? t.green : t.red) : t.bgSurface,
                color: side === s ? "#fff" : t.textMuted, border: `1px solid ${side === s ? (s === "buy" ? t.green : t.red) : t.border}`,
              }}>{s}</button>
            ))}
          </div>
          <BlurBox label="Not Live Yet" style={{ marginBottom: 0 }}>
            <div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>{side === "buy" ? "You Pay (NEAR)" : "You Sell ($IRONCLAW)"}</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input type="number" placeholder="0.00" style={{
                  flex: 1, background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
                  padding: "12px 14px", color: t.white, fontSize: 16, fontFamily: "'JetBrains Mono', monospace", outline: "none",
                }} />
                <div style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "12px 12px", fontSize: 13, fontWeight: 700, color: t.accent }}>{side === "buy" ? "NEAR" : "$IRONCLAW"}</div>
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>{side === "buy" ? "You Receive ($IRONCLAW)" : "You Receive (NEAR)"}</div>
              <div style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 16, fontFamily: "'JetBrains Mono', monospace", color: t.textDim, marginBottom: 16 }}>0.00</div>
              <div style={{ background: t.bgSurface, borderRadius: 8, padding: 12, fontSize: 12, color: t.textMuted, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Price</span><span></span></div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>Slippage</span><span>0.5%</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Gas (est.)</span><span>~0.001 NEAR</span></div>
              </div>
              <Btn primary style={{ width: "100%", justifyContent: "center", background: `linear-gradient(135deg, ${side === "buy" ? t.green : t.red}, ${side === "buy" ? "#059669" : "#dc2626"})` }}>
                {side === "buy" ? "Buy $IRONCLAW" : "Sell $IRONCLAW"}
              </Btn>
            </div>
          </BlurBox>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: t.white, marginBottom: 14 }}>Trade History</div>
        <BlurBox label="Not Live Yet" style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14 }}>
          <div style={{ padding: 24 }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${t.border}` }}>
                <span style={{ color: i % 2 === 0 ? t.green : t.red, fontWeight: 600 }}>{i % 2 === 0 ? "BUY" : "SELL"}</span>
                <span style={{ color: t.text }}>5,000 $IRONCLAW</span>
                <span style={{ color: t.textMuted }}>@ $0.04{i}</span>
                <span style={{ color: t.textDim }}>2h ago</span>
              </div>
            ))}
          </div>
        </BlurBox>
      </div>
    </Section>
  );
}
