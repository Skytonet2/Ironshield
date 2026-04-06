"use client";
import { useState, useRef, useEffect } from "react";
import { Search, Trophy, Link2, Image as ImageIcon, X, Send, Lock, Wallet } from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import { getAllContests, getScores } from "@/lib/store";

export default function EarnPage({ openWallet }) {
  const t = useTheme(); const { connected, address } = useWallet();
  const [activeTab, setActiveTab] = useState("missions");
  const [submitting, setSubmitting] = useState(null);
  const [subLink, setSubLink] = useState(""); const [subNote, setSubNote] = useState(""); const [subImg, setSubImg] = useState(null);
  const [submitted, setSubmitted] = useState([]);
  const [searchQ, setSearchQ] = useState("");
  const [contests, setContests] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  const getLocal = (key, def) => {
    try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; }
  };
  const setLocal = (key, val) => localStorage.setItem(key, JSON.stringify(val));

  useEffect(() => {
    setContests(getAllContests());
    setSubmitted(getLocal('ironshield_submissions', []));
    const scores = getScores();
    const sorted = scores.sort((a,b) => b.points - a.points).map((s, i) => ({
      rank: i + 1, addr: s.wallet, pts: s.points, badge: i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : ""
    }));
    setLeaderboard(sorted);
  }, []);

  const fileRef = useRef();
  const handleImg = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setSubImg(ev.target.result);
    reader.readAsDataURL(file);
  };
  const doSubmit = () => {
    if (!subLink.trim()) return;
    const task = contests.find(c => c.id === submitting);
    const newSub = { taskId: submitting, taskTitle: task?.title, link: subLink, note: subNote, img: subImg, wallet: address, ts: new Date().toLocaleString() };
    const updated = [...submitted, newSub];
    setSubmitted(updated); setLocal('ironshield_submissions', updated);
    setSubmitting(null); setSubLink(""); setSubNote(""); setSubImg(null);
  };

  const filtered = contests.filter(c => c.title.toLowerCase().includes(searchQ.toLowerCase()));
  const userRankData = leaderboard.find(l => l.addr === address);

  return (
    <Section style={{ paddingTop: 100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32, flexWrap: "wrap", gap: 16 }}>
        <div>
          <Badge color={t.green}>CONTESTS & MISSIONS</Badge>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: t.white, marginTop: 10 }}>Earn $IRONCLAW</h1>
          <p style={{ fontSize: 14, color: t.textMuted, marginTop: 4 }}>Complete missions. Submit proof. Get ranked. Win rewards.</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: t.textMuted }}>Your Rank</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: t.amber }}>{connected && userRankData ? `${userRankData.badge} #${userRankData.rank}` : "—"}</div>
          </div>
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: "12px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: t.textMuted }}>Points</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>{connected && userRankData ? userRankData.pts.toLocaleString() : "—"}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 28, borderBottom: `1px solid ${t.border}`, paddingBottom: 12 }}>
        {[{ key: "missions", label: "Missions" }, { key: "submissions", label: `My Submissions (${submitted.length})` }, { key: "leaderboard", label: "Leaderboard" }].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
            background: activeTab === tab.key ? t.accent : "transparent",
            color: activeTab === tab.key ? "#fff" : t.textMuted, transition: "all 0.2s"
          }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === "missions" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 14px" }}>
              <Search size={14} color={t.textDim} />
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search missions..." style={{ background: "none", border: "none", outline: "none", color: t.text, fontSize: 13, flex: 1 }} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map(task => (
              <div key={task.id} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.25s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = t.borderHover}
                onMouseLeave={e => e.currentTarget.style.borderColor = t.border}
              >
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
                  <div style={{ background: t.bgSurface, borderRadius: 10, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{task.emoji || "🎯"}</div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: t.white }}>{task.title}</div>
                    <div style={{ fontSize: 13, color: t.textMuted, marginTop: 3, maxWidth: 460 }}>{task.description}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                      <Badge color={t.accent}>{task.type}</Badge>
                      <Badge color={task.difficulty === "Hard" ? t.red : task.difficulty === "Medium" ? t.amber : t.green}>{task.difficulty}</Badge>
                      <span style={{ fontSize: 11, color: t.textDim }}>⏱ Due: {task.deadline}</span>
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 20, marginTop: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>{task.reward}</div>
                  <div style={{ fontSize: 11, color: t.textDim, marginBottom: 10 }}>Reward</div>
                  {connected
                    ? <Btn primary onClick={() => setSubmitting(task.id)} style={{ fontSize: 12, padding: "8px 16px" }}><Send size={12} /> Participate</Btn>
                    : <Btn onClick={openWallet} style={{ fontSize: 12, padding: "8px 16px" }}><Wallet size={12} /> Connect</Btn>
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "submissions" && (
        <div>
          {!connected ? (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <Lock size={36} color={t.textDim} style={{ marginBottom: 12 }} />
              <div style={{ color: t.textMuted, marginBottom: 16 }}>Connect your wallet to view submissions</div>
              <Btn primary onClick={openWallet}><Wallet size={14} /> Connect Wallet</Btn>
            </div>
          ) : submitted.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: t.textMuted }}>
              <Trophy size={36} color={t.textDim} style={{ marginBottom: 12 }} />
              <div>No submissions yet. Complete a mission to get started!</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {submitted.map((sub, i) => (
                <div key={i} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: t.white }}>{sub.taskTitle}</div>
                      <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>{sub.ts}</div>
                    </div>
                    <Badge color={t.amber}>Pending Review</Badge>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Link2 size={13} color={t.accent} />
                    <a href={sub.link} target="_blank" rel="noopener noreferrer" style={{ color: t.accent, fontSize: 13, textDecoration: "none", wordBreak: "break-all" }}>{sub.link}</a>
                  </div>
                  {sub.note && <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 10 }}>{sub.note}</div>}
                  {sub.img && <img src={sub.img} alt="proof" style={{ maxWidth: "100%", borderRadius: 10, border: `1px solid ${t.border}` }} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "leaderboard" && (
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${t.border}` }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: t.white }}>Community Leaderboard</div>
            <div style={{ fontSize: 13, color: t.textMuted }}>Updated every 24 hours by admin scoring</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: t.bgSurface }}>
                  {["Rank", "Wallet", "Points", ""].map(h => (
                    <th key={h} style={{ padding: "12px 20px", textAlign: "left", fontSize: 12, color: t.textMuted, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${t.border}44` }}>
                    <td style={{ padding: "14px 20px", color: t.white, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{row.badge || `#${row.rank}`}</td>
                    <td style={{ padding: "14px 20px", color: t.text }}>{row.addr}</td>
                    <td style={{ padding: "14px 20px", color: t.green, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{row.pts.toLocaleString()} pts</td>
                    <td style={{ padding: "14px 20px" }}>
                      {connected && address === row.addr && <Badge color={t.accent}>YOU</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {submitting && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(6px)" }}>
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 36, width: 500, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: t.white }}>Submit Proof</div>
                <div style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}>{contests.find(c => c.id === submitting)?.title}</div>
              </div>
              <button onClick={() => setSubmitting(null)} style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: t.textMuted, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={14} /></button>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8 }}>Link to your work *</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 14px" }}>
                <Link2 size={14} color={t.textDim} />
                <input value={subLink} onChange={e => setSubLink(e.target.value)} placeholder="https://twitter.com/..." style={{ background: "none", border: "none", outline: "none", color: t.text, fontSize: 14, flex: 1 }} />
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8 }}>Additional notes (optional)</div>
              <textarea value={subNote} onChange={e => setSubNote(e.target.value)} rows={3} placeholder="Describe your submission..." style={{ width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: 12, color: t.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8 }}>Image proof (optional)</div>
              <input type="file" accept="image/*" ref={fileRef} onChange={handleImg} style={{ display: "none" }} />
              {subImg ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <img src={subImg} alt="proof preview" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 10, border: `1px solid ${t.border}` }} />
                  <button onClick={() => setSubImg(null)} style={{ position: "absolute", top: 6, right: 6, background: t.red, border: "none", borderRadius: 6, width: 24, height: 24, cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={12} /></button>
                </div>
              ) : (
                <button onClick={() => fileRef.current?.click()} style={{
                  width: "100%", padding: 24, background: t.bgSurface, border: `2px dashed ${t.border}`,
                  borderRadius: 10, cursor: "pointer", color: t.textMuted, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 8
                }}>
                  <ImageIcon size={22} color={t.textDim} />
                  <span style={{ fontSize: 13 }}>Click to upload screenshot or proof</span>
                  <span style={{ fontSize: 11, color: t.textDim }}>PNG, JPG, GIF up to 10MB</span>
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <Btn onClick={() => setSubmitting(null)} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
              <Btn primary onClick={doSubmit} disabled={!subLink.trim()} style={{ flex: 1, justifyContent: "center" }}><Send size={14} /> Submit Proof</Btn>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
