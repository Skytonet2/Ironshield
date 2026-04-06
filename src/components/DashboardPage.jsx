"use client";
import { Shield, Users, Activity, Coins } from "lucide-react";
import { Section, Badge, StatCard, MiniBar } from "./Primitives";
import { useTheme } from "@/lib/contexts";

export default function DashboardPage() {
  const t = useTheme();
  const threatData = [18, 24, 31, 19, 27, 44, 38, 52, 47, 61, 55, 70, 65, 82];
  return (
    <Section style={{ paddingTop: 100 }}>
      <div style={{ marginBottom: 40 }}>
        <Badge color={t.green}>LIVE DASHBOARD</Badge>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: t.white, marginTop: 10 }}>Ecosystem Overview</h1>
        <p style={{ fontSize: 14, color: t.textMuted, marginTop: 4 }}>Real-time metrics from the IronShield network</p>
      </div>
      <div className="grid-wrap-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        <StatCard icon={Shield} label="Threats Blocked (14d)" value="12,847" change="+342" positive color={t.accent} />
        <StatCard icon={Users} label="Protected Communities" value="2,847" change="+89" positive color={t.green} />
        <StatCard icon={Activity} label="Daily Active Users" value="1,203" change="+12%" positive color={t.amber} />
        <StatCard icon={Coins} label="Token Price" value="$0.042" change="+5.2%" positive color={t.accent} blur />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: t.white, marginBottom: 4 }}>Threats Blocked (14d)</div>
          <Badge color={t.green}>96.8% Accuracy</Badge>
          <div style={{ marginTop: 16 }}><MiniBar data={threatData} height={130} color={t.accent} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: t.textDim }}>
            <span>Mar 20</span><span>Apr 3</span>
          </div>
        </div>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 24 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: t.white, marginBottom: 20 }}>Recent Alerts</div>
          {[
            { type: "Phishing", group: "NEAR Builders", time: "2m", severity: "high" },
            { type: "Rug Contract", group: "DeFi Alpha", time: "14m", severity: "critical" },
            { type: "Impersonation", group: "Rhea Finance", time: "1h", severity: "medium" },
            { type: "Phishing Link", group: "NEAR Dev", time: "3h", severity: "high" },
          ].map((a, i, arr) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < arr.length - 1 ? `1px solid ${t.border}` : "none" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.white }}>{a.type}</div>
                <div style={{ fontSize: 11, color: t.textDim }}>{a.group}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Badge color={a.severity === "critical" ? t.red : a.severity === "high" ? t.amber : t.accent}>{a.severity}</Badge>
                <div style={{ fontSize: 11, color: t.textDim, marginTop: 3 }}>{a.time} ago</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
