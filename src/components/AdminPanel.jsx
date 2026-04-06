"use client";
import { useState, useEffect } from "react";
import { Settings, X, Plus, Edit3, Trash2, Save, CheckCircle } from "lucide-react";
import { Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import { memoryStore } from "@/lib/store";

// Admin wallet — only this address can access the panel
const ADMIN_WALLET = "ironshield.near";

export default function AdminPanel({ onClose }) {
  const t = useTheme();
  const { connected, address } = useWallet();

  const [authed, setAuthed]     = useState(false);
  const [pw, setPw]             = useState("");
  const [pwErr, setPwErr]       = useState(false);
  const [adminTab, setAdminTab] = useState("contests");

  const [contests, setContests] = useState([...memoryStore.contests]);
  const [scores, setScores]     = useState([...memoryStore.scores]);
  const [editing, setEditing]   = useState(null);
  const [scoreMsg, setScoreMsg] = useState("");

  const [newContest, setNewContest] = useState({
    title: "", description: "", type: "Content",
    difficulty: "Medium", reward: "", deadline: "", emoji: "🎯",
  });
  const [scoreEntry, setScoreEntry] = useState({ wallet: "", points: "" });

  // Sync memoryStore changes back to the store
  useEffect(() => { memoryStore.contests = contests; }, [contests]);
  useEffect(() => { memoryStore.scores   = scores;   }, [scores]);

  const tryLogin = () => {
    // Allow wallet-based auth (preferred) or fallback password
    if (address === ADMIN_WALLET || pw === process.env.NEXT_PUBLIC_ADMIN_PW || pw === "ironshield_admin") {
      setAuthed(true);
      setPwErr(false);
    } else {
      setPwErr(true);
      setTimeout(() => setPwErr(false), 2000);
    }
  };

  const addContest = () => {
    if (!newContest.title || !newContest.reward) return;
    const entry = { ...newContest, id: Date.now() };
    setContests(prev => [...prev, entry]);
    setNewContest({ title: "", description: "", type: "Content", difficulty: "Medium", reward: "", deadline: "", emoji: "🎯" });
  };

  const saveEdit = () => {
    setContests(prev => prev.map(c => c.id === editing.id ? editing : c));
    setEditing(null);
  };

  const deleteContest = (id) => setContests(prev => prev.filter(c => c.id !== id));

  const submitScore = () => {
    if (!scoreEntry.wallet || !scoreEntry.points) return;
    const points = parseInt(scoreEntry.points);
    setScores(prev => {
      const idx = prev.findIndex(s => s.wallet === scoreEntry.wallet);
      const updated = [...prev];
      if (idx >= 0) {
        updated[idx] = { ...updated[idx], points, ts: new Date().toLocaleDateString() };
      } else {
        updated.push({ wallet: scoreEntry.wallet, points, ts: new Date().toLocaleDateString() });
      }
      return updated;
    });
    setScoreMsg(`Score updated for ${scoreEntry.wallet}`);
    setScoreEntry({ wallet: "", points: "" });
    setTimeout(() => setScoreMsg(""), 3000);
  };

  const deleteScore = (idx) => setScores(prev => prev.filter((_, i) => i !== idx));

  // ── Login screen ────────────────────────────────────────────────
  if (!authed) return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, backdropFilter: "blur(8px)" }}>
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 40, width: 380, textAlign: "center" }}>
        <Settings size={32} color={t.accent} style={{ marginBottom: 16 }} />
        <div style={{ fontSize: 20, fontWeight: 700, color: t.white, marginBottom: 6 }}>Admin Access</div>
        {connected && address === ADMIN_WALLET ? (
          <>
            <div style={{ fontSize: 13, color: t.green, marginBottom: 20 }}>Wallet recognized as admin</div>
            <Btn primary onClick={() => setAuthed(true)} style={{ width: "100%", justifyContent: "center" }}>Enter Admin Panel</Btn>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 24 }}>Enter admin password to continue</div>
            <input
              type="password" value={pw}
              onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && tryLogin()}
              placeholder="Password"
              style={{ width: "100%", background: t.bgSurface, border: `1px solid ${pwErr ? t.red : t.border}`, borderRadius: 10, padding: "12px 16px", color: t.white, fontSize: 14, outline: "none", marginBottom: 12, textAlign: "center" }}
            />
            {pwErr && <div style={{ color: t.red, fontSize: 12, marginBottom: 10 }}>Incorrect password</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
              <Btn primary onClick={tryLogin} style={{ flex: 1, justifyContent: "center" }}>Enter</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // ── Admin panel ─────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, backdropFilter: "blur(8px)" }}>
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, width: "min(900px, 95vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Settings size={20} color={t.accent} />
            <div style={{ fontSize: 18, fontWeight: 700, color: t.white }}>Admin Panel</div>
            <Badge color={t.red}>PRIVATE</Badge>
          </div>
          <button onClick={onClose} style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: t.textMuted }}>
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 6, padding: "14px 28px", borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
          {[{ key: "contests", label: "Contests" }, { key: "scores", label: "Score Users" }].map(tab => (
            <button key={tab.key} onClick={() => setAdminTab(tab.key)} style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
              background: adminTab === tab.key ? t.accent : t.bgSurface,
              color: adminTab === tab.key ? "#fff" : t.textMuted,
            }}>{tab.label}</button>
          ))}
        </div>

        <div style={{ overflowY: "auto", padding: 28, flex: 1 }}>

          {/* ── Contests tab ── */}
          {adminTab === "contests" && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginBottom: 18 }}>Active Contests ({contests.length})</div>

              {/* Add contest form */}
              <div style={{ background: t.bgSurface, borderRadius: 14, padding: 22, marginBottom: 22, border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 14 }}>+ Add New Contest</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  {[
                    { key: "title", label: "Title", placeholder: "Mission title" },
                    { key: "reward", label: "Reward", placeholder: "500 $IRONCLAW" },
                    { key: "deadline", label: "Deadline", placeholder: "Apr 10" },
                    { key: "emoji", label: "Emoji", placeholder: "🎯" },
                  ].map(f => (
                    <div key={f.key}>
                      <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>{f.label}</div>
                      <input value={newContest[f.key]} onChange={e => setNewContest({ ...newContest, [f.key]: e.target.value })} placeholder={f.placeholder}
                        style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none" }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>Description</div>
                  <textarea value={newContest.description} onChange={e => setNewContest({ ...newContest, description: e.target.value })} rows={2} placeholder="What do participants need to do?"
                    style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  {[
                    { key: "type", options: ["Content", "Design", "Video", "Community", "Growth", "Dev"] },
                    { key: "difficulty", options: ["Easy", "Medium", "Hard"] },
                  ].map(f => (
                    <div key={f.key}>
                      <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>{f.key.charAt(0).toUpperCase() + f.key.slice(1)}</div>
                      <select value={newContest[f.key]} onChange={e => setNewContest({ ...newContest, [f.key]: e.target.value })}
                        style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none" }}>
                        {f.options.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <Btn primary onClick={addContest} style={{ fontSize: 13 }}><Plus size={14} /> Add Contest</Btn>
              </div>

              {/* Contest list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {contests.map(c => (
                  <div key={c.id} style={{ background: t.bgSurface, borderRadius: 12, padding: 18, border: `1px solid ${t.border}` }}>
                    {editing?.id === c.id ? (
                      <div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                          {["title", "reward", "deadline", "emoji"].map(f => (
                            <div key={f}>
                              <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 4 }}>{f}</div>
                              <input value={editing[f]} onChange={e => setEditing({ ...editing, [f]: e.target.value })}
                                style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 6, padding: "8px 10px", color: t.text, fontSize: 13, outline: "none" }} />
                            </div>
                          ))}
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <textarea value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2}
                            style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 6, padding: "8px 10px", color: t.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Btn primary onClick={saveEdit} style={{ fontSize: 12, padding: "8px 14px" }}><Save size={12} /> Save</Btn>
                          <Btn onClick={() => setEditing(null)} style={{ fontSize: 12, padding: "8px 14px" }}>Cancel</Btn>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: t.white }}>{c.emoji} {c.title}</div>
                          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}>{c.description}</div>
                          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                            <Badge color={t.accent}>{c.type}</Badge>
                            <Badge color={c.difficulty === "Hard" ? t.red : c.difficulty === "Medium" ? t.amber : t.green}>{c.difficulty}</Badge>
                            <span style={{ fontSize: 11, color: t.textDim }}>Reward: {c.reward} · Due: {c.deadline}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 16 }}>
                          <button onClick={() => setEditing({ ...c })} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: t.textMuted, display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                            <Edit3 size={12} /> Edit
                          </button>
                          <button onClick={() => deleteContest(c.id)} style={{ background: `${t.red}18`, border: `1px solid ${t.red}44`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: t.red, display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Scores tab ── */}
          {adminTab === "scores" && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginBottom: 18 }}>Score Users</div>

              {scoreMsg && (
                <div style={{ background: `${t.green}18`, border: `1px solid ${t.green}44`, borderRadius: 10, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} color={t.green} />
                  <span style={{ color: t.green, fontSize: 13 }}>{scoreMsg}</span>
                </div>
              )}

              <div style={{ background: t.bgSurface, borderRadius: 14, padding: 22, marginBottom: 24, border: `1px solid ${t.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 14 }}>Set User Score</div>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 12, alignItems: "flex-end" }}>
                  <div>
                    <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 6 }}>Wallet Address (e.g. alpha.near)</div>
                    <input value={scoreEntry.wallet} onChange={e => setScoreEntry({ ...scoreEntry, wallet: e.target.value })} placeholder="wallet.near"
                      style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 12px", color: t.text, fontSize: 13, outline: "none" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 6 }}>Points</div>
                    <input type="number" value={scoreEntry.points} onChange={e => setScoreEntry({ ...scoreEntry, points: e.target.value })} placeholder="500"
                      style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 12px", color: t.text, fontSize: 13, outline: "none" }} />
                  </div>
                  <Btn primary onClick={submitScore} style={{ fontSize: 13, whiteSpace: "nowrap" }}><Save size={13} /> Set Score</Btn>
                </div>
              </div>

              {scores.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: t.textMuted, fontSize: 14 }}>No scores recorded yet.</div>
              ) : (
                <div style={{ background: t.bgSurface, borderRadius: 14, overflow: "hidden", border: `1px solid ${t.border}` }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${t.border}` }}>
                        {["Wallet", "Points", "Last Updated", ""].map(h => (
                          <th key={h} style={{ padding: "12px 18px", textAlign: "left", fontSize: 12, color: t.textMuted, fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...scores].sort((a, b) => b.points - a.points).map((s, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.border}44` }}>
                          <td style={{ padding: "12px 18px", color: t.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{s.wallet}</td>
                          <td style={{ padding: "12px 18px", color: t.green, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{s.points}</td>
                          <td style={{ padding: "12px 18px", color: t.textDim, fontSize: 12 }}>{s.ts || "—"}</td>
                          <td style={{ padding: "12px 18px" }}>
                            <button onClick={() => deleteScore(i)} style={{ background: `${t.red}18`, border: `1px solid ${t.red}33`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", color: t.red, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                              <Trash2 size={10} /> Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
