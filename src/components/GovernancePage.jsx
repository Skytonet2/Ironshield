"use client";
import { useState, useEffect, useCallback } from "react";
import { Shield, Zap, FileText, ToggleLeft, Clock, ChevronDown, ChevronUp, Loader, Plus, X } from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import useNear, { STAKING_CONTRACT } from "@/hooks/useNear";

// ── Helpers ─────────────────────────────────────────────────────
const shortAddr = (addr) => {
  if (!addr) return "";
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
};

const timeLeft = (endTs) => {
  const now   = Date.now();
  const end   = endTs / 1_000_000; // nanoseconds → ms
  const diff  = end - now;
  if (diff <= 0) return "Ended";
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  if (days > 0)  return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
};

const votePct = (forVotes, againstVotes) => {
  const total = BigInt(forVotes || "0") + BigInt(againstVotes || "0");
  if (total === 0n) return { for: 0, against: 0 };
  return {
    for:     Number((BigInt(forVotes || "0") * 100n) / total),
    against: Number((BigInt(againstVotes || "0") * 100n) / total),
  };
};

const TYPE_CONFIG = {
  Mission:       { color: "#ff6b00", icon: Shield,   label: "MISSION" },
  PromptUpdate:  { color: "#9b5de5", icon: FileText, label: "PROMPT UPDATE" },
  RuleChange:    { color: "#00c2ff", icon: ToggleLeft,label: "RULE CHANGE" },
};

// ── Governance Page ─────────────────────────────────────────────
export default function GovernancePage({ openWallet }) {
  const t = useTheme();
  const { connected, address } = useWallet();
  const { viewMethod, callMethod } = useNear();

  const [proposals, setProposals]       = useState([]);
  const [executed, setExecuted]         = useState([]);
  const [activeMission, setActiveMission] = useState("Monitoring phishing links and scam wallets across all protected Telegram communities.");
  const [loading, setLoading]           = useState(true);
  const [txLoading, setTxLoading]       = useState(false);
  const [error, setError]               = useState("");
  const [success, setSuccess]           = useState("");
  const [expanded, setExpanded]         = useState({});
  const [showCreate, setShowCreate]     = useState(false);
  const [userVotes, setUserVotes]       = useState({});

  const [newProposal, setNewProposal] = useState({
    type: "Mission",
    title: "",
    content: "",
  });

  // ── Fetch proposals ──────────────────────────────────────────
  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const all = await viewMethod(STAKING_CONTRACT, "get_proposals", {});
      if (all) {
        const active = all.filter(p => !p.executed);
        const done   = all.filter(p => p.executed);
        setProposals(active);
        setExecuted(done);

        // Find last executed mission
        const lastMission = [...done].reverse().find(p => p.proposal_type === "Mission" && p.passed);
        if (lastMission) setActiveMission(lastMission.content);
      }
    } catch (err) {
      console.error("fetchProposals error:", err);
    } finally {
      setLoading(false);
    }
  }, [viewMethod]);

  // Fetch user's votes for active proposals
  const fetchUserVotes = useCallback(async () => {
    if (!address || proposals.length === 0) return;
    const votes = {};
    for (const p of proposals) {
      const vote = await viewMethod(STAKING_CONTRACT, "get_user_vote", {
        proposal_id: p.id,
        account_id:  address,
      });
      if (vote !== null) votes[p.id] = vote; // true=for, false=against
    }
    setUserVotes(votes);
  }, [address, proposals, viewMethod]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);
  useEffect(() => { fetchUserVotes(); }, [fetchUserVotes]);

  const showErr = (msg) => { setError(msg);   setTimeout(() => setError(""),   4000); };
  const showOk  = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(""), 4000); };

  // ── Create proposal ─────────────────────────────────────────
  const handleCreate = async () => {
    if (!connected) return openWallet();
    if (!newProposal.title.trim() || !newProposal.content.trim()) return showErr("Title and content are required");
    setTxLoading(true);
    try {
      await callMethod(STAKING_CONTRACT, "create_proposal", {
        proposal_type: newProposal.type,
        title:         newProposal.title,
        content:       newProposal.content,
      }, "0");
      showOk("Proposal created! Voting window is now open for 72 hours.");
      setShowCreate(false);
      setNewProposal({ type: "Mission", title: "", content: "" });
      await fetchProposals();
    } catch (err) {
      showErr(err.message || "Failed to create proposal");
    } finally {
      setTxLoading(false);
    }
  };

  // ── Vote ────────────────────────────────────────────────────
  const handleVote = async (proposalId, voteFor) => {
    if (!connected) return openWallet();
    setTxLoading(true);
    try {
      await callMethod(STAKING_CONTRACT, "vote", {
        proposal_id: proposalId,
        vote_for:    voteFor,
      }, "0");
      showOk(`Vote cast: ${voteFor ? "FOR ✓" : "AGAINST ✗"}`);
      setUserVotes(prev => ({ ...prev, [proposalId]: voteFor }));
      await fetchProposals();
    } catch (err) {
      showErr(err.message || "Vote failed");
    } finally {
      setTxLoading(false);
    }
  };

  // ── Execute proposal ────────────────────────────────────────
  const handleExecute = async (proposalId) => {
    setTxLoading(true);
    try {
      await callMethod(STAKING_CONTRACT, "execute_proposal", { proposal_id: proposalId }, "0");
      showOk("Proposal executed. IronClaw has been updated.");
      await fetchProposals();
    } catch (err) {
      showErr(err.message || "Execution failed");
    } finally {
      setTxLoading(false);
    }
  };

  const isExpired = (p) => Date.now() > p.end_timestamp / 1_000_000;

  // ── Proposal card ───────────────────────────────────────────
  const ProposalCard = ({ p, isHistory = false }) => {
    const cfg  = TYPE_CONFIG[p.proposal_type] || TYPE_CONFIG.Mission;
    const Icon = cfg.icon;
    const pct  = votePct(p.votes_for, p.votes_against);
    const exp  = isExpired(p);
    const myVote = userVotes[p.id];
    const isOpen = expanded[p.id];
    const hasVoted = myVote !== undefined;

    return (
      <div style={{ background: t.bgCard, border: `1px solid ${isHistory ? t.border : cfg.color + "33"}`, borderRadius: 14, overflow: "hidden", marginBottom: 12 }}>
        {/* Color bar */}
        <div style={{ height: 3, background: `linear-gradient(90deg, ${cfg.color}, transparent)` }} />

        <div style={{ padding: "20px 24px" }}>
          {/* Top row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ background: `${cfg.color}18`, borderRadius: 8, padding: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={16} color={cfg.color} />
              </div>
              <div>
                <span style={{ fontSize: 9, color: cfg.color, letterSpacing: "0.14em", fontWeight: 600 }}>{cfg.label}</span>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginTop: 2 }}>{p.title}</div>
                <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>by {shortAddr(p.proposer)}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              {isHistory ? (
                <Badge color={p.passed ? t.green : t.red}>{p.passed ? "✓ PASSED" : "✗ FAILED"}</Badge>
              ) : (
                <>
                  {exp ? <Badge color={t.amber}>ENDED</Badge> : (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: t.textMuted }}>
                      <Clock size={11} /> {timeLeft(p.end_timestamp)}
                    </div>
                  )}
                  {hasVoted && <Badge color={myVote ? t.green : t.red}>{myVote ? "YOU VOTED FOR" : "YOU VOTED AGAINST"}</Badge>}
                </>
              )}
              <button onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer", color: t.textMuted, display: "flex", alignItems: "center" }}>
                {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          {/* Content preview */}
          {isOpen && (
            <div style={{ background: t.bgSurface, borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13, color: t.textMuted, lineHeight: 1.7 }}>
              {p.content}
            </div>
          )}

          {/* Vote bars */}
          <div style={{ marginBottom: isHistory ? 0 : 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.textMuted, marginBottom: 6 }}>
              <span>FOR {pct.for}%</span>
              <span>AGAINST {pct.against}%</span>
            </div>
            <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: t.bgSurface, gap: 1 }}>
              <div style={{ flex: pct.for, background: t.green, borderRadius: 3, transition: "flex 0.5s ease" }} />
              <div style={{ flex: pct.against, background: t.red, borderRadius: 3, transition: "flex 0.5s ease" }} />
            </div>
          </div>

          {/* Action buttons */}
          {!isHistory && !exp && !hasVoted && connected && (
            <div style={{ display: "flex", gap: 10 }}>
              <Btn primary onClick={() => handleVote(p.id, true)} disabled={txLoading}
                style={{ flex: 1, justifyContent: "center", background: t.green }}>
                {txLoading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : "✓ Vote FOR"}
              </Btn>
              <Btn onClick={() => handleVote(p.id, false)} disabled={txLoading}
                style={{ flex: 1, justifyContent: "center", background: `${t.red}22`, color: t.red, border: `1px solid ${t.red}44` }}>
                {txLoading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : "✗ Vote AGAINST"}
              </Btn>
            </div>
          )}

          {!isHistory && !exp && !connected && (
            <Btn primary onClick={openWallet} style={{ width: "100%", justifyContent: "center" }}>Connect wallet to vote</Btn>
          )}

          {!isHistory && exp && !p.executed && (
            <Btn primary onClick={() => handleExecute(p.id)} disabled={txLoading}
              style={{ width: "100%", justifyContent: "center", background: cfg.color }}>
              {txLoading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : "⚡ Execute Proposal"}
            </Btn>
          )}
        </div>
      </div>
    );
  };

  return (
    <Section style={{ paddingTop: 100 }}>
      {/* Autonomous mode status bar */}
      <div style={{
        background: "linear-gradient(135deg, rgba(255,107,0,0.08), rgba(155,93,229,0.08))",
        border: "1px solid rgba(255,107,0,0.25)",
        borderRadius: 14, padding: "16px 24px", marginBottom: 40,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff6b00", boxShadow: "0 0 12px #ff6b00", animation: "pulse 2s infinite" }} />
          <div>
            <div style={{ fontSize: 11, color: "#ff6b00", fontWeight: 700, letterSpacing: "0.16em" }}>IRONCLAW AUTONOMOUS MODE: ACTIVE</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3 }}>Current mission: {activeMission}</div>
          </div>
        </div>
        <Badge color="#ff6b00">Governed by token holders</Badge>
      </div>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color="#9b5de5">GOVERNANCE</Badge>
        <h1 style={{ fontSize: 36, fontWeight: 700, color: t.white, marginTop: 12 }}>IronClaw Governance</h1>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8, maxWidth: 520, margin: "8px auto 0" }}>
          Staked $IRONCLAW holders control IronClaw's missions, AI prompts, and capabilities. Vote to shape the autonomous agent.
        </p>
      </div>

      {/* How it works */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 48 }}>
        {[
          { icon: Shield,    color: "#ff6b00", title: "Missions",      desc: "Vote on what threats IronClaw monitors and which communities it prioritizes." },
          { icon: FileText, color: "#9b5de5", title: "Prompt Updates", desc: "Upgrade IronClaw's AI brain. New system prompts take effect immediately after passing." },
          { icon: ToggleLeft,color: "#00c2ff",title: "Rule Changes",   desc: "Enable or disable specific IronClaw capabilities. Community decides autonomy levels." },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <div key={i} style={{ background: t.bgCard, border: `1px solid ${item.color}22`, borderLeft: `3px solid ${item.color}`, borderRadius: 12, padding: 20 }}>
              <Icon size={20} color={item.color} style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          );
        })}
      </div>

      {/* Messages */}
      {error && <div style={{ background: `${t.red}18`, border: `1px solid ${t.red}44`, borderRadius: 10, padding: "12px 20px", marginBottom: 20, color: t.red, fontSize: 13 }}>⚠ {error}</div>}
      {success && <div style={{ background: `${t.green}18`, border: `1px solid ${t.green}44`, borderRadius: 10, padding: "12px 20px", marginBottom: 20, color: t.green, fontSize: 13 }}>✓ {success}</div>}

      {/* Create proposal */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.white }}>Active Proposals ({proposals.length})</div>
        <Btn primary onClick={() => connected ? setShowCreate(!showCreate) : openWallet()}
          style={{ fontSize: 13 }}>
          {showCreate ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Create Proposal</>}
        </Btn>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{ background: t.bgCard, border: "1px solid rgba(155,93,229,0.3)", borderRadius: 14, padding: 28, marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginBottom: 20 }}>New Proposal</div>
          <div style={{ fontSize: 11, color: t.textDim, marginBottom: 16 }}>⚠ Requires minimum 1,000 staked $IRONCLAW to propose</div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8 }}>Proposal Type</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["Mission", "PromptUpdate", "RuleChange"].map(type => {
                const cfg  = TYPE_CONFIG[type];
                const Icon = cfg.icon;
                return (
                  <button key={type} onClick={() => setNewProposal(p => ({ ...p, type }))}
                    style={{
                      flex: 1, padding: "12px 8px", borderRadius: 10, cursor: "pointer",
                      border: `2px solid ${newProposal.type === type ? cfg.color : t.border}`,
                      background: newProposal.type === type ? `${cfg.color}15` : t.bgSurface,
                      color: newProposal.type === type ? cfg.color : t.textMuted,
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    }}>
                    <Icon size={16} />
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em" }}>{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>Title</div>
            <input value={newProposal.title} onChange={e => setNewProposal(p => ({ ...p, title: e.target.value }))} placeholder="Short, clear proposal title"
              style={{ width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 14px", color: t.text, fontSize: 14, outline: "none" }} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 6 }}>
              {newProposal.type === "Mission"      && "Describe the new IronClaw mission — what should it monitor?"}
              {newProposal.type === "PromptUpdate" && "Write the new AI system prompt for IronClaw. This replaces the current one."}
              {newProposal.type === "RuleChange"   && "Describe the rule change — which capability to enable or disable."}
            </div>
            <textarea
              value={newProposal.content}
              onChange={e => setNewProposal(p => ({ ...p, content: e.target.value }))}
              rows={5}
              placeholder={
                newProposal.type === "Mission"      ? "IronClaw should monitor all Telegram groups for... and prioritize..." :
                newProposal.type === "PromptUpdate" ? "You are IronClaw, an autonomous Web3 security agent. Your mission is to..." :
                "Enable/Disable: [capability name]. Reason: ..."
              }
              style={{ width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 14px", color: t.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.7 }}
            />
          </div>

          <Btn primary onClick={handleCreate} disabled={txLoading} style={{ justifyContent: "center", padding: "12px 32px", fontSize: 14 }}>
            {txLoading ? <><Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> Submitting...</> : "Submit Proposal"}
          </Btn>
        </div>
      )}

      {/* Active proposals */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: t.textMuted }}>
          <Loader size={28} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} color={t.accent} />
          <div>Loading proposals...</div>
        </div>
      ) : proposals.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, color: t.textMuted }}>
          <Shield size={36} color={t.textDim} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: t.white, marginBottom: 8 }}>No active proposals</div>
          <div style={{ fontSize: 13 }}>Be the first to propose a mission or prompt update for IronClaw.</div>
        </div>
      ) : (
        proposals.map(p => <ProposalCard key={p.id} p={p} />)
      )}

      {/* Vote history */}
      {executed.length > 0 && (
        <div style={{ marginTop: 48 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.white, marginBottom: 20 }}>Vote History</div>
          {executed.map(p => <ProposalCard key={p.id} p={p} isHistory />)}
        </div>
      )}

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </Section>
  );
}
