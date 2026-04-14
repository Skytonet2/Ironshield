"use client";
import { useState, useEffect, useCallback } from "react";
import { Settings, X, Plus, Edit3, Trash2, Save, CheckCircle, Shield, Award, UserPlus, Loader, ToggleLeft, ToggleRight, UserMinus } from "lucide-react";
import { Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import { memoryStore } from "@/lib/store";
import useGovernance from "@/hooks/useGovernance";

// Admin wallet: only this address can access the panel
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

  // ── Governance state ──────────────────────────────────────────
  const gov = useGovernance();
  const [pretokenMode, setPretokenMode]       = useState(false);
  const [pendingApps, setPendingApps]         = useState([]);
  const [contributors, setContributors]       = useState([]);
  const [nftContracts, setNftContracts]       = useState([]);
  const [tokenIdMax, setTokenIdMax]           = useState(1000);
  const [govLoading, setGovLoading]           = useState(false);
  const [govBusy, setGovBusy]                 = useState(null); // tracks which row is processing
  const [govMsg, setGovMsg]                   = useState("");
  const [govErr, setGovErr]                   = useState("");
  const [newNftContract, setNewNftContract]   = useState("");
  const [newTokenIdMax, setNewTokenIdMax]     = useState("");

  const refreshGov = useCallback(async () => {
    setGovLoading(true);
    try {
      const [mode, apps, list, nfts, max] = await Promise.all([
        gov.getPretokenMode(),
        gov.getPendingApplications(),
        gov.getContributors(),
        gov.getVanguardNftContracts(),
        gov.getVanguardTokenIdMax(),
      ]);
      setPretokenMode(!!mode);
      setPendingApps(Array.isArray(apps) ? apps : []);
      setContributors(Array.isArray(list) ? list : []);
      setNftContracts(Array.isArray(nfts) ? nfts : []);
      setTokenIdMax(Number(max) || 1000);
    } catch (err) {
      console.warn("refreshGov:", err?.message || err);
    } finally {
      setGovLoading(false);
    }
  }, [gov]);

  useEffect(() => {
    if (authed && adminTab === "governance") refreshGov();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, adminTab]);

  const govOk  = (m) => { setGovMsg(m); setTimeout(() => setGovMsg(""), 3500); };
  const govBad = (m) => { setGovErr(m); setTimeout(() => setGovErr(""), 4500); };

  const withBusy = async (key, fn) => {
    setGovBusy(key);
    try { await fn(); } finally { setGovBusy(null); }
  };

  const handleToggleMode = () => withBusy("mode", async () => {
    try {
      await gov.setPretokenMode(!pretokenMode);
      govOk(`Pre-token mode ${!pretokenMode ? "enabled" : "disabled"}.`);
      await refreshGov();
    } catch (err) { govBad(err.message || "Failed to toggle mode"); }
  });

  const handleApprove = (accountId) => withBusy("app:" + accountId, async () => {
    try {
      await gov.approveContributor(accountId);
      govOk(`Approved ${accountId}.`);
      await refreshGov();
    } catch (err) { govBad(err.message || "Approve failed"); }
  });

  const handleReject = (accountId) => withBusy("app:" + accountId, async () => {
    try {
      await gov.rejectContributor(accountId);
      govOk(`Rejected ${accountId}.`);
      await refreshGov();
    } catch (err) { govBad(err.message || "Reject failed"); }
  });

  const handleRevoke = (accountId) => withBusy("contrib:" + accountId, async () => {
    try {
      await gov.revokeContributor(accountId);
      govOk(`Revoked ${accountId}.`);
      await refreshGov();
    } catch (err) { govBad(err.message || "Revoke failed"); }
  });

  const handleAddNft = () => withBusy("addnft", async () => {
    if (!newNftContract.trim()) return;
    try {
      await gov.addVanguardNftContract(newNftContract.trim());
      govOk(`Whitelisted ${newNftContract.trim()}.`);
      setNewNftContract("");
      await refreshGov();
    } catch (err) { govBad(err.message || "Add failed"); }
  });

  const handleSetMax = () => withBusy("setmax", async () => {
    const n = parseInt(newTokenIdMax, 10);
    if (Number.isNaN(n) || n <= 0) return govBad("Must be a positive integer");
    try {
      await gov.setVanguardTokenIdMax(n);
      govOk(`Vanguard token-id max set to ${n}.`);
      setNewTokenIdMax("");
      await refreshGov();
    } catch (err) { govBad(err.message || "Update failed"); }
  });

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
          {[
            { key: "contests",   label: "Contests" },
            { key: "scores",     label: "Score Users" },
            { key: "governance", label: "Governance" },
          ].map(tab => (
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

          {/* ── Governance tab ── */}
          {adminTab === "governance" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.white, display: "flex", alignItems: "center", gap: 8 }}>
                  <Shield size={16} color={t.accent} /> Governance Control
                </div>
                <Btn onClick={refreshGov} disabled={govLoading} style={{ fontSize: 12 }}>
                  {govLoading ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> : "Refresh"}
                </Btn>
              </div>

              {govMsg && (
                <div style={{ background: `${t.green}18`, border: `1px solid ${t.green}44`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, color: t.green, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} /> {govMsg}
                </div>
              )}
              {govErr && (
                <div style={{ background: `${t.red}18`, border: `1px solid ${t.red}44`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, color: t.red, fontSize: 13 }}>
                  {govErr}
                </div>
              )}

              {/* Mode toggle */}
              <div style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 22, marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ maxWidth: 440 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 4 }}>Pre-token Mode</div>
                    <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.6 }}>
                      On: voting weight comes from contributor (1×) and vanguard (2×) status.
                      Off: voting weight comes from staked $IRONCLAW across all pools.
                    </div>
                  </div>
                  <Btn primary onClick={handleToggleMode} disabled={govBusy === "mode"}
                    style={{ background: pretokenMode ? "#9b5de5" : t.bgCard, color: pretokenMode ? "#fff" : t.textMuted, border: `1px solid ${pretokenMode ? "#9b5de5" : t.border}` }}>
                    {govBusy === "mode"
                      ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
                      : pretokenMode ? <><ToggleRight size={14} /> PRE-TOKEN ON</> : <><ToggleLeft size={14} /> PRE-TOKEN OFF</>}
                  </Btn>
                </div>
              </div>

              {/* Pending applications */}
              <div style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 22, marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <UserPlus size={14} color="#9b5de5" /> Pending Contributor Applications ({pendingApps.length})
                </div>
                {pendingApps.length === 0 ? (
                  <div style={{ fontSize: 12, color: t.textMuted, padding: "8px 0" }}>No pending applications.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {pendingApps.map(app => {
                      const busy = govBusy === "app:" + app.account_id;
                      return (
                        <div key={app.account_id} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ flex: 1, minWidth: 240 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{app.account_id}</div>
                              <div style={{ fontSize: 11, color: t.textDim, marginTop: 3 }}>Telegram: {app.telegram || ""}</div>
                              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 8, lineHeight: 1.6 }}>{app.reason}</div>
                            </div>
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              <button onClick={() => handleApprove(app.account_id)} disabled={busy}
                                style={{ background: `${t.green}18`, border: `1px solid ${t.green}55`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: t.green, display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                                {busy ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> : <><CheckCircle size={12} /> Approve</>}
                              </button>
                              <button onClick={() => handleReject(app.account_id)} disabled={busy}
                                style={{ background: `${t.red}18`, border: `1px solid ${t.red}44`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: t.red, display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                                <X size={12} /> Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Approved contributors */}
              <div style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 22, marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <CheckCircle size={14} color={t.green} /> Approved Contributors ({contributors.length})
                </div>
                {contributors.length === 0 ? (
                  <div style={{ fontSize: 12, color: t.textMuted, padding: "8px 0" }}>No contributors yet.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {contributors.map(([acc, info]) => {
                      const busy = govBusy === "contrib:" + acc;
                      return (
                        <div key={acc} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontSize: 13, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{acc}</div>
                            <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>Telegram: {info?.telegram || ""}</div>
                          </div>
                          <button onClick={() => handleRevoke(acc)} disabled={busy}
                            style={{ background: `${t.red}18`, border: `1px solid ${t.red}44`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: t.red, display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                            {busy ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> : <><UserMinus size={12} /> Revoke</>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Vanguard NFT management */}
              <div style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 22 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                  <Award size={14} color="#ffb300" /> Vanguard NFT Rules
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 6 }}>Token ID Max (top-N rule: currently {tokenIdMax})</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={newTokenIdMax} onChange={e => setNewTokenIdMax(e.target.value)} placeholder={String(tokenIdMax)} type="number"
                      style={{ flex: 1, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none" }} />
                    <Btn primary onClick={handleSetMax} disabled={govBusy === "setmax"} style={{ fontSize: 12 }}>
                      {govBusy === "setmax" ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> : <><Save size={12} /> Update</>}
                    </Btn>
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 6 }}>Whitelisted NFT Contracts ({nftContracts.length})</div>
                  {nftContracts.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                      {nftContracts.map(c => (
                        <div key={c} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, color: t.text, fontFamily: "'JetBrains Mono', monospace" }}>{c}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={newNftContract} onChange={e => setNewNftContract(e.target.value)} placeholder="contract.nfts.tg"
                      style={{ flex: 1, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none", fontFamily: "'JetBrains Mono', monospace" }} />
                    <Btn primary onClick={handleAddNft} disabled={govBusy === "addnft"} style={{ fontSize: 12 }}>
                      {govBusy === "addnft" ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> : <><Plus size={12} /> Whitelist</>}
                    </Btn>
                  </div>
                </div>
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
                          <td style={{ padding: "12px 18px", color: t.textDim, fontSize: 12 }}>{s.ts || ""}</td>
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
