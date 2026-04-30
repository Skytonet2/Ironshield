"use client";
import { useState, useEffect, useCallback } from "react";
import { Settings, X, Plus, Edit3, Trash2, Save, CheckCircle, Shield, Award, UserPlus, Loader, ToggleLeft, ToggleRight, UserMinus } from "lucide-react";
import { Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import { apiFetch } from "@/lib/apiFetch";
import { memoryStore } from "@/lib/store";
import useGovernance from "@/hooks/useGovernance";

export default function AdminPanel({ onClose }) {
  const t = useTheme();
  const { connected, address, showModal } = useWallet();

  // Auth state has three values: null = checking, true = admin,
  // false = denied/disconnected. Backend allowlist is the source of truth;
  // there is no client-side override.
  const [authed, setAuthed]     = useState(null);
  const [authError, setAuthError] = useState(null);
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
    if (authed === true && adminTab === "governance") refreshGov();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, adminTab]);

  // Resolve admin status against the backend allowlist. Server is the
  // source of truth — no client-side bypass possible.
  //
  // Auth is split into two phases so wallets that pop a window for
  // signMessage (MyNearWallet, etc.) work:
  //   1. On wallet change → set authed=null and stop. We do NOT auto-
  //      fire the signed POST, because browsers block the wallet popup
  //      when it isn't initiated by a user gesture.
  //   2. The "Verify admin access" button fires the check inside the
  //      click handler. The click counts as a user gesture so the
  //      popup is allowed.
  //
  // For Day 5.6 token-cached sessions (Meteor / HERE / HOT / Intear
  // already signed once this session), the verify call is silent —
  // no popup needed because apiFetch reuses the bearer token.
  useEffect(() => {
    if (!connected || !address) {
      setAuthed(false);
      setAuthError(null);
      return;
    }
    setAuthed(null);
    setAuthError(null);
  }, [connected, address]);

  const verifyAdmin = useCallback(async () => {
    setAuthError(null);
    setAuthed(null);
    try {
      const r = await apiFetch("/api/admin/check", { method: "POST" });
      if (r.ok) {
        setAuthed(true);
      } else if (r.status === 401 || r.status === 403) {
        setAuthed(false);
      } else {
        setAuthed(false);
        setAuthError(`Server error (HTTP ${r.status})`);
      }
    } catch (err) {
      setAuthed(false);
      const msg = String(err?.message || err || "");
      if (/popup|blocked/i.test(msg)) {
        setAuthError("Popup blocked — allow popups for this site, or switch to Meteor/HERE wallet, then try again.");
      } else {
        setAuthError(msg || "Auth check failed");
      }
    }
  }, []);

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

  // ── Auth gate ──────────────────────────────────────────────────
  // Three states: checking (null), authorized (true), denied (false).
  // No client-side bypass — the backend allowlist is authoritative.
  if (authed !== true) return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, backdropFilter: "blur(8px)" }}>
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 40, width: 380, textAlign: "center" }}>
        <Settings size={32} color={t.accent} style={{ marginBottom: 16 }} />
        <div style={{ fontSize: 20, fontWeight: 700, color: t.white, marginBottom: 6 }}>Admin Access</div>
        {!connected ? (
          <>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 20 }}>Connect a wallet on the admin allowlist to continue.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
              <Btn primary onClick={showModal} style={{ flex: 1, justifyContent: "center" }}>Connect</Btn>
            </div>
          </>
        ) : authed === null ? (
          <>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Connected as</div>
            <div style={{ fontSize: 12, color: t.text, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all" }}>{address}</div>
            <div style={{ fontSize: 12, color: t.textDim, marginBottom: 16, lineHeight: 1.45 }}>
              Click below to sign a one-time admin proof. Your wallet may pop a window — make sure popups are allowed for this site.
            </div>
            {authError && <div style={{ fontSize: 11, color: "var(--red)", marginBottom: 12 }}>{authError}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
              <Btn primary onClick={verifyAdmin} style={{ flex: 1, justifyContent: "center" }}>Verify access</Btn>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: t.red, marginBottom: 6 }}>Not authorized</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 18, fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all" }}>{address}</div>
            {authError && <div style={{ fontSize: 11, color: t.textDim, marginBottom: 14 }}>{authError}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Close</Btn>
              <Btn primary onClick={verifyAdmin} style={{ flex: 1, justifyContent: "center" }}>Try again</Btn>
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
            { key: "stats",      label: "Stats" },
            { key: "contests",   label: "Contests" },
            { key: "scores",     label: "Score Users" },
            { key: "governance", label: "Governance" },
            { key: "skills",     label: "Skills" },
          ].map(tab => (
            <button key={tab.key} onClick={() => setAdminTab(tab.key)} style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
              background: adminTab === tab.key ? t.accent : t.bgSurface,
              color: adminTab === tab.key ? "#fff" : t.textMuted,
            }}>{tab.label}</button>
          ))}
        </div>

        <div style={{ overflowY: "auto", padding: 28, flex: 1 }}>

          {/* ── Stats tab ── live counts from /api/admin/stats. */}
          {adminTab === "stats" && <StatsTab t={t} />}

          {/* ── Skills tab ── Tier 5 slice 3 moderation queue. */}
          {adminTab === "skills" && <SkillsTab t={t} />}

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

// ── StatsTab ─────────────────────────────────────────────────────────
// Renders live aggregate counts from /api/admin/stats. Polls once on
// mount; the manual Refresh button re-fires. Numbers stay null while
// loading so the operator can tell "still fetching" from "actually
// zero". Each section is a small grid; missing sections (older deploys
// without that table) render as "—".
function StatsTab({ t }) {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await apiFetch("/api/admin/stats", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e?.message || "Failed to load stats");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString());

  const tile = (label, value, sub) => (
    <div key={label} style={{
      padding: 14, borderRadius: 12, border: `1px solid ${t.border}`, background: t.bgSurface,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
        color: t.textDim, textTransform: "uppercase", marginBottom: 6,
      }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: t.white,
        fontFamily: "var(--font-jetbrains-mono), monospace", lineHeight: 1.1 }}>{fmt(value)}</div>
      {sub && <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>
          Platform stats {data?.ts && <span style={{ fontSize: 11, color: t.textDim, marginLeft: 8 }}>· {new Date(data.ts).toLocaleString()}</span>}
        </div>
        <button onClick={load} disabled={loading} style={{
          padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
          border: `1px solid ${t.border}`, background: t.bgSurface,
          color: loading ? t.textDim : t.text, cursor: loading ? "wait" : "pointer",
        }}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {err && (
        <div style={{
          padding: 10, borderRadius: 8, marginBottom: 12,
          background: "rgba(239,68,68,0.08)", border: `1px solid var(--red)`,
          color: "var(--red)", fontSize: 12,
        }}>{err}</div>
      )}

      <Section t={t} title="Users">
        {tile("Total accounts",   data?.users?.total,     "All-time signups")}
        {tile("Onboarded",        data?.users?.onboarded, "Completed setup modal")}
        {tile("Active (7 days)",  data?.users?.active7d,  "Connected in the last week")}
        {tile("New (24h)",        data?.users?.new24h,    "Signups in the last day")}
      </Section>

      <Section t={t} title="Feed">
        {tile("Posts",     data?.feed?.posts)}
        {tile("Comments",  data?.feed?.comments)}
        {tile("DMs",       data?.feed?.dms)}
        {tile("Follows",   data?.feed?.follows)}
      </Section>

      <Section t={t} title="NewsCoin & Skills">
        {tile("NewsCoins",       data?.newscoin?.total)}
        {tile("NewsCoin trades", data?.newscoin?.trades)}
        {tile("Skill sales",     data?.skills?.sales)}
        {tile("Automations",     data?.agents?.automations)}
      </Section>
    </div>
  );
}

function Section({ t, title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: t.textMuted,
        textTransform: "uppercase", marginBottom: 8,
      }}>{title}</div>
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
      }}>
        {children}
      </div>
    </div>
  );
}

// ── SkillsTab ────────────────────────────────────────────────────────
// Tier 5 slice 3 — admin moderation queue for skill_runtime_manifests.
// Lists rows filtered by lifecycle_status, with three actions per row:
//   - Lifecycle dropdown   → POST /skills/:id/lifecycle  (any state)
//   - Pin                  → POST /skills/:id/pin        (runtime status='active')
//   - Slash                → POST /skills/:id/slash      (lifecycle_status='slashed')
// All routes are admin-gated by requireAdmin in the backend.
const LIFECYCLES = ["internal", "curated", "public", "deprecated", "slashed"];

function SkillsTab({ t }) {
  const [filter, setFilter] = useState(["internal", "curated"]);
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState("");
  const [busyKey, setBusyKey] = useState(null); // `${skill_id}:${version}` while a write is in flight
  const [msg, setMsg]       = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr(""); setMsg("");
    try {
      const lifecycle = filter.join(",");
      const r = await apiFetch(`/api/admin/skills?lifecycle=${encodeURIComponent(lifecycle)}&limit=100`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      setRows(j.rows || []);
    } catch (e) {
      setErr(e.message || String(e));
      setRows([]);
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (row, action, body) => {
    const key = `${row.skill_id}:${row.version}`;
    setBusyKey(key); setErr(""); setMsg("");
    try {
      const r = await apiFetch(`/api/admin/skills/${row.skill_id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ version: row.version, ...body }),
        headers: { "Content-Type": "application/json" },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMsg(`${action} ok: skill ${row.skill_id} v${row.version}`);
      load();
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setBusyKey(null); }
  }, [load]);

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginBottom: 14 }}>
        Skill moderation
      </div>
      <div style={{ color: t.textMuted, fontSize: 12, marginBottom: 14 }}>
        Lifecycle moves are catalog-only. Slash is off-chain — when contract gains <code>slash_skill</code> the route will fire that too.
      </div>

      {/* Lifecycle filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {LIFECYCLES.map(l => {
          const active = filter.includes(l);
          return (
            <button key={l} onClick={() => {
              setFilter(active ? filter.filter(x => x !== l) : [...filter, l]);
            }} style={{
              padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 600,
              background: active ? t.accent : t.bgSurface,
              color: active ? "#fff" : t.textMuted,
            }}>{l}</button>
          );
        })}
      </div>

      {msg && <div style={{ background: `${t.green}18`, color: t.green, padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{msg}</div>}
      {err && <div style={{ background: `${t.red}18`, color: t.red, padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{err}</div>}

      {loading && <div style={{ color: t.textMuted, padding: 12 }}>Loading…</div>}
      {!loading && rows.length === 0 && (
        <div style={{ color: t.textMuted, padding: 24, textAlign: "center", border: `1px dashed ${t.border}`, borderRadius: 10 }}>
          No skills match the current lifecycle filter.
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div style={{ background: t.bgSurface, borderRadius: 12, overflow: "auto", border: `1px solid ${t.border}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${t.border}`, color: t.textMuted, textAlign: "left" }}>
                {["Skill", "Version", "Lifecycle", "Hash", "Actions"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", fontSize: 11, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const key = `${r.skill_id}:${r.version}`;
                const busy = busyKey === key;
                return (
                  <tr key={r.id} style={{ borderTop: `1px solid ${t.border}44` }}>
                    <td style={{ padding: "10px 14px", color: t.text }}>
                      <div style={{ fontWeight: 600 }}>{r.name || `#${r.skill_id}`}</div>
                      <div style={{ fontSize: 11, color: t.textMuted }}>id {r.skill_id} · {r.category}</div>
                    </td>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace", color: t.text }}>{r.version}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <select
                        value={r.lifecycle_status}
                        disabled={busy}
                        onChange={(e) => act(r, "lifecycle", { lifecycle_status: e.target.value })}
                        style={{ padding: "4px 8px", borderRadius: 6, background: t.bgCard, color: t.text, border: `1px solid ${t.border}`, fontSize: 12 }}
                      >
                        {LIFECYCLES.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, color: t.textMuted }}>
                      {r.manifest_hash?.slice(0, 10)}…
                    </td>
                    <td style={{ padding: "10px 14px", display: "flex", gap: 6 }}>
                      <button onClick={() => act(r, "pin", {})} disabled={busy} style={{
                        padding: "4px 10px", borderRadius: 6, border: `1px solid ${t.accent}55`,
                        background: `${t.accent}22`, color: t.accent, fontSize: 11, fontWeight: 600,
                        cursor: busy ? "wait" : "pointer",
                      }}>Pin</button>
                      <button onClick={() => act(r, "slash", {})} disabled={busy} style={{
                        padding: "4px 10px", borderRadius: 6, border: `1px solid ${t.red}55`,
                        background: `${t.red}22`, color: t.red, fontSize: 11, fontWeight: 600,
                        cursor: busy ? "wait" : "pointer",
                      }}>Slash</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
