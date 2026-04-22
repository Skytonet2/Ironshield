"use client";
import { useState, useEffect, useCallback } from "react";
import { Shield, Zap, FileText, ToggleLeft, Clock, ChevronDown, ChevronUp, Loader, Plus, X, Award, UserPlus, CheckCircle } from "lucide-react";
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

  // Pre-token governance state
  const [pretokenMode, setPretokenMode]         = useState(false);
  const [myPower, setMyPower]                   = useState(null); // null=unknown, 0/1/2 in pretoken mode, staked in post-token
  const [isContributor, setIsContributor]       = useState(false);
  const [isVanguard, setIsVanguard]             = useState(false);
  const [showContribForm, setShowContribForm]   = useState(false);
  const [showVanguardForm, setShowVanguardForm] = useState(false);
  const [contribForm, setContribForm]           = useState({ telegram: "", reason: "" });
  const [vanguardForm, setVanguardForm]         = useState({ nftContract: "nearlegion.nfts.tg", tokenId: "" });
  const [vanguardNftContracts, setVanguardNftContracts] = useState([]);
  const [vanguardTokenIdMax, setVanguardTokenIdMax]     = useState(1000);
  const [hasPendingApp, setHasPendingApp]       = useState(false);

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

  // ── Fetch governance mode + caller's eligibility ─────────────
  const fetchMode = useCallback(async () => {
    try {
      const [mode, max, nftContracts] = await Promise.all([
        viewMethod(STAKING_CONTRACT, "get_pretoken_mode", {}),
        viewMethod(STAKING_CONTRACT, "get_vanguard_token_id_max", {}),
        viewMethod(STAKING_CONTRACT, "get_vanguard_nft_contracts", {}),
      ]);
      if (mode !== null) setPretokenMode(!!mode);
      if (max  !== null) setVanguardTokenIdMax(Number(max) || 1000);
      if (Array.isArray(nftContracts) && nftContracts.length) {
        setVanguardNftContracts(nftContracts);
        setVanguardForm(f => f.nftContract ? f : { ...f, nftContract: nftContracts[0] });
      }
    } catch (err) {
      console.warn("fetchMode:", err?.message || err);
    }
  }, [viewMethod]);

  const fetchEligibility = useCallback(async () => {
    if (!address) {
      setMyPower(null); setIsContributor(false); setIsVanguard(false); setHasPendingApp(false);
      return;
    }
    try {
      if (pretokenMode) {
        const [contrib, vg, pending] = await Promise.all([
          viewMethod(STAKING_CONTRACT, "is_contributor",  { account_id: address }),
          viewMethod(STAKING_CONTRACT, "is_vanguard",     { account_id: address }),
          viewMethod(STAKING_CONTRACT, "get_pending_applications", {}),
        ]);
        setIsContributor(!!contrib);
        setIsVanguard(!!vg);
        setHasPendingApp(Array.isArray(pending) && pending.some(a => a.account_id === address));
        setMyPower(vg ? 2 : (contrib ? 1 : 0));
      } else {
        const power = await viewMethod(STAKING_CONTRACT, "get_voting_power", { account_id: address });
        setMyPower(power?.toString ? power.toString() : (power ?? "0"));
        setIsContributor(false); setIsVanguard(false); setHasPendingApp(false);
      }
    } catch (err) {
      console.warn("fetchEligibility:", err?.message || err);
    }
  }, [address, pretokenMode, viewMethod]);

  // Fetch user's votes for active proposals. Contract stores "for"/"against" strings.
  const fetchUserVotes = useCallback(async () => {
    if (!address || proposals.length === 0) return;
    const votes = {};
    for (const p of proposals) {
      const v = await viewMethod(STAKING_CONTRACT, "get_vote", {
        proposal_id: p.id,
        account_id:  address,
      });
      if (v === "for" || v === "against") votes[p.id] = (v === "for");
    }
    setUserVotes(votes);
  }, [address, proposals, viewMethod]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);
  useEffect(() => { fetchMode(); }, [fetchMode]);
  useEffect(() => { fetchEligibility(); }, [fetchEligibility]);
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
        description:   newProposal.title, // contract requires a description; reuse title
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
        vote:        voteFor ? "for" : "against",
      }, "0");
      showOk(`Vote cast: ${voteFor ? "FOR" : "AGAINST"}`);
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

  // ── Contributor application ─────────────────────────────────
  const handleContribApply = async () => {
    if (!connected) return openWallet();
    if (!contribForm.telegram.trim() || !contribForm.reason.trim()) return showErr("Telegram and reason are required");
    if (contribForm.telegram.length > 64) return showErr("Telegram handle too long (max 64)");
    if (contribForm.reason.length > 500)  return showErr("Reason too long (max 500)");
    setTxLoading(true);
    try {
      await callMethod(STAKING_CONTRACT, "request_contributor", {
        telegram: contribForm.telegram,
        reason:   contribForm.reason,
      }, "0");
      showOk("Application submitted. An admin will review it shortly.");
      setShowContribForm(false);
      setContribForm({ telegram: "", reason: "" });
      await fetchEligibility();
    } catch (err) {
      showErr(err.message || "Application failed");
    } finally {
      setTxLoading(false);
    }
  };

  // ── Vanguard NFT claim ──────────────────────────────────────
  const handleVanguardClaim = async () => {
    if (!connected) return openWallet();
    if (!vanguardForm.nftContract.trim() || !vanguardForm.tokenId.trim()) return showErr("NFT contract and token ID are required");
    const idNum = parseInt(vanguardForm.tokenId, 10);
    if (Number.isNaN(idNum) || idNum < 1 || idNum > vanguardTokenIdMax) {
      return showErr(`Token ID must be between 1 and ${vanguardTokenIdMax}`);
    }
    setTxLoading(true);
    try {
      await callMethod(STAKING_CONTRACT, "register_vanguard", {
        nft_contract: vanguardForm.nftContract,
        token_id:     vanguardForm.tokenId,
      }, "0");
      showOk("Vanguard claim submitted. Ownership will be verified on-chain.");
      setShowVanguardForm(false);
      setVanguardForm({ nftContract: vanguardNftContracts[0] || "nearlegion.nfts.tg", tokenId: "" });
      // Callback is async: give it a moment then refresh
      setTimeout(() => fetchEligibility(), 4000);
    } catch (err) {
      showErr(err.message || "Vanguard claim failed");
    } finally {
      setTxLoading(false);
    }
  };

  const canPropose = pretokenMode ? (isContributor || isVanguard) : true; // post-token: contract will reject if no stake
  const canVote    = pretokenMode ? (isContributor || isVanguard) : true;

  const isExpired = (p) => Date.now() > p.expires_at / 1_000_000;

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
      <div
        className="card-lift"
        style={{
          background: isHistory
            ? "var(--bg-card)"
            : `linear-gradient(180deg, ${cfg.color}08, transparent 60%), var(--bg-card)`,
          border: `1px solid ${isHistory ? t.border : cfg.color + "44"}`,
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: 12,
          boxShadow: isHistory ? "none" : `inset 0 1px 0 rgba(255,255,255,0.03), 0 20px 40px ${cfg.color}12`,
        }}
      >
        {/* Top gradient edge — full width, fades out so it feels like
            the card is lit from above by the proposal's theme colour. */}
        <div style={{ height: 2, background: `linear-gradient(90deg, ${cfg.color}, ${cfg.color}00 80%)` }} />

        <div style={{ padding: "18px 22px" }}>
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
                <Badge color={p.passed ? t.green : t.red}>{p.passed ? "PASSED" : "FAILED"}</Badge>
              ) : (
                <>
                  {exp ? <Badge color={t.amber}>ENDED</Badge> : (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: t.textMuted }}>
                      <Clock size={11} /> {timeLeft(p.expires_at)}
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

          {/* Action buttons — gradient fills for primary intents so
              the vote CTA reads as definitive, not optional. */}
          {!isHistory && !exp && !hasVoted && connected && (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => handleVote(p.id, true)}
                disabled={txLoading}
                style={{
                  flex: 1, padding: "10px 14px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #10b981, #059669)",
                  color: "#fff", fontSize: 13, fontWeight: 700,
                  cursor: txLoading ? "wait" : "pointer", opacity: txLoading ? 0.7 : 1,
                  boxShadow: "0 10px 24px rgba(16,185,129,0.28)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                {txLoading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : "Vote FOR"}
              </button>
              <button
                type="button"
                onClick={() => handleVote(p.id, false)}
                disabled={txLoading}
                style={{
                  flex: 1, padding: "10px 14px", borderRadius: 10,
                  border: "1px solid rgba(239,68,68,0.45)",
                  background: "rgba(239,68,68,0.12)",
                  color: "#fca5a5", fontSize: 13, fontWeight: 700,
                  cursor: txLoading ? "wait" : "pointer", opacity: txLoading ? 0.7 : 1,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                {txLoading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : "Vote AGAINST"}
              </button>
            </div>
          )}

          {!isHistory && !exp && !connected && (
            <button
              type="button"
              onClick={openWallet}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, #3b82f6, #a855f7)",
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 10px 24px rgba(168,85,247,0.3)",
              }}
            >
              Connect wallet to vote
            </button>
          )}

          {!isHistory && exp && !p.executed && (
            <button
              type="button"
              onClick={() => handleExecute(p.id)}
              disabled={txLoading}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10, border: "none",
                background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}bb)`,
                color: "#fff", fontSize: 13, fontWeight: 700,
                cursor: txLoading ? "wait" : "pointer", opacity: txLoading ? 0.7 : 1,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                boxShadow: `0 10px 24px ${cfg.color}30`,
              }}
            >
              {txLoading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : "Execute Proposal"}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      maxWidth: 920, margin: "0 auto",
      padding: "24px 20px 48px",
    }}>
      {/* Autonomous mode status bar — glass card with a gradient edge
          glow. The pulsing dot keeps a subtle heartbeat so the panel
          reads as "live", not static. */}
      <div style={{
        background: "linear-gradient(135deg, rgba(168,85,247,0.12), rgba(59,130,246,0.08) 60%, transparent)",
        border: "1px solid rgba(168,85,247,0.35)",
        borderRadius: 14, padding: "16px 24px", marginBottom: 18,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 50px rgba(168,85,247,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 14px rgba(168,85,247,0.9)", animation: "pulse 2s infinite" }} />
          <div>
            <div style={{ fontSize: 11, color: "#c084fc", fontWeight: 700, letterSpacing: "0.16em" }}>IRONCLAW AUTONOMOUS MODE · LIVE</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3, lineHeight: 1.5 }}>{activeMission}</div>
          </div>
        </div>
        <Badge color={pretokenMode ? "#a855f7" : "#3b82f6"}>
          {pretokenMode ? "Pre-token: Contributors + Vanguards" : "Governed by $IRONCLAW holders"}
        </Badge>
      </div>

      {/* Pre-token eligibility banner */}
      {pretokenMode && (
        <div style={{
          background: t.bgCard,
          border: "1px solid rgba(155,93,229,0.35)",
          borderRadius: 14, padding: "18px 24px", marginBottom: 40,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
            <div style={{ maxWidth: 620 }}>
              <div style={{ fontSize: 11, color: "#9b5de5", fontWeight: 700, letterSpacing: "0.16em", marginBottom: 6 }}>PRE-TOKEN GOVERNANCE</div>
              <div style={{ fontSize: 14, color: t.white, fontWeight: 600, marginBottom: 4 }}>
                $IRONCLAW hasn't launched yet: voting runs on trusted identity.
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6 }}>
                Verified <strong>Vanguards</strong> (NEAR Legion NFT #1{vanguardTokenIdMax}) get 2× voting power. Approved <strong>Contributors</strong> get 1×. Both can create proposals and vote.
              </div>
            </div>
            {connected && (
              <div style={{ textAlign: "right", minWidth: 200 }}>
                <div style={{ fontSize: 10, color: t.textDim, letterSpacing: "0.12em", marginBottom: 6 }}>YOUR STATUS</div>
                {isVanguard ? (
                  <Badge color="#ffb300"><Award size={11} /> VANGUARD · 2× POWER</Badge>
                ) : isContributor ? (
                  <Badge color="#9b5de5"><CheckCircle size={11} /> CONTRIBUTOR · 1× POWER</Badge>
                ) : hasPendingApp ? (
                  <Badge color={t.amber}>APPLICATION PENDING</Badge>
                ) : (
                  <Badge color={t.textDim}>NOT REGISTERED</Badge>
                )}
              </div>
            )}
          </div>

          {/* Action buttons for unverified wallets */}
          {connected && !isVanguard && !isContributor && (
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <Btn onClick={() => { setShowVanguardForm(v => !v); setShowContribForm(false); }}
                style={{ background: "rgba(255,179,0,0.15)", color: "#ffb300", border: "1px solid rgba(255,179,0,0.35)" }}>
                <Award size={14} /> {showVanguardForm ? "Cancel" : "Claim Vanguard NFT"}
              </Btn>
              {!hasPendingApp && (
                <Btn onClick={() => { setShowContribForm(v => !v); setShowVanguardForm(false); }}
                  style={{ background: "rgba(155,93,229,0.15)", color: "#9b5de5", border: "1px solid rgba(155,93,229,0.35)" }}>
                  <UserPlus size={14} /> {showContribForm ? "Cancel" : "Apply as Contributor"}
                </Btn>
              )}
            </div>
          )}
          {!connected && (
            <div style={{ marginTop: 18 }}>
              <Btn primary onClick={openWallet}>Connect wallet to check status</Btn>
            </div>
          )}

          {/* Vanguard claim form */}
          {showVanguardForm && (
            <div style={{ marginTop: 18, background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 4 }}>Claim Vanguard Status</div>
              <div style={{ fontSize: 11, color: t.textDim, marginBottom: 14, lineHeight: 1.6 }}>
                Prove ownership of an NFT in the whitelisted contracts below. Only token IDs 1{vanguardTokenIdMax} qualify. Ownership is verified on-chain against the NFT contract.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>NFT Contract</div>
                  {vanguardNftContracts.length > 1 ? (
                    <select value={vanguardForm.nftContract} onChange={e => setVanguardForm(f => ({ ...f, nftContract: e.target.value }))}
                      style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none" }}>
                      {vanguardNftContracts.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <input value={vanguardForm.nftContract} onChange={e => setVanguardForm(f => ({ ...f, nftContract: e.target.value }))}
                      style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none", fontFamily: "'JetBrains Mono', monospace" }} />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>Token ID (1{vanguardTokenIdMax})</div>
                  <input value={vanguardForm.tokenId} onChange={e => setVanguardForm(f => ({ ...f, tokenId: e.target.value }))} placeholder="e.g. 42"
                    style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none" }} />
                </div>
              </div>
              <Btn primary onClick={handleVanguardClaim} disabled={txLoading} style={{ background: "#ffb300", color: "#1a1a1a" }}>
                {txLoading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <><Award size={14} /> Verify Ownership</>}
              </Btn>
            </div>
          )}

          {/* Contributor application form */}
          {showContribForm && (
            <div style={{ marginTop: 18, background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 4 }}>Apply to become a Contributor</div>
              <div style={{ fontSize: 11, color: t.textDim, marginBottom: 14, lineHeight: 1.6 }}>
                Admins review applications. Approved contributors get 1× voting power and can create governance proposals.
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>Telegram Handle (max 64 chars)</div>
                <input value={contribForm.telegram} onChange={e => setContribForm(f => ({ ...f, telegram: e.target.value }))} placeholder="@yourhandle"
                  style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none" }} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 5 }}>
                  Why should you be approved? ({contribForm.reason.length}/500)
                </div>
                <textarea value={contribForm.reason} onChange={e => setContribForm(f => ({ ...f, reason: e.target.value.slice(0, 500) }))} rows={4} placeholder="Share your background, contributions, and how you plan to help shape IronClaw."
                  style={{ width: "100%", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 8, padding: "9px 12px", color: t.text, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
              </div>
              <Btn primary onClick={handleContribApply} disabled={txLoading} style={{ background: "#9b5de5" }}>
                {txLoading ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : <><UserPlus size={14} /> Submit Application</>}
              </Btn>
            </div>
          )}
        </div>
      )}

      {/* Header — tighter, left-aligned. Premium pages don't need
          centered hero copy; the feed layout is the centerline. */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#c084fc", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          <Shield size={12} /> Governance
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 800, color: t.white, margin: "6px 0 4px", letterSpacing: -0.4 }}>
          IronClaw Governance
        </h1>
        <p style={{ fontSize: 14, color: t.textMuted, margin: 0, lineHeight: 1.5, maxWidth: 620 }}>
          Staked $IRONCLAW holders control IronClaw's missions, AI prompts, and capabilities. Vote to shape the autonomous agent.
        </p>
      </div>

      {/* How it works — glass cards with a gradient left accent. */}
      <div className="ix-gov-how" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 28 }}>
        {[
          { icon: Shield,    color: "#f97316", title: "Missions",       desc: "Vote on what threats IronClaw monitors and which communities it prioritizes." },
          { icon: FileText,  color: "#a855f7", title: "Prompt Updates", desc: "Upgrade IronClaw's AI brain. New system prompts take effect immediately after passing." },
          { icon: ToggleLeft,color: "#3b82f6", title: "Rule Changes",   desc: "Enable or disable specific IronClaw capabilities. Community decides autonomy levels." },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <div
              key={i}
              className="card-lift"
              style={{
                background: `linear-gradient(180deg, ${item.color}0d, transparent 70%), var(--bg-card)`,
                border: `1px solid ${item.color}2a`,
                borderRadius: 14, padding: 18,
                position: "relative",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
              }}
            >
              <span style={{
                position: "absolute", left: 0, top: 14, bottom: 14,
                width: 3, borderRadius: 2,
                background: `linear-gradient(180deg, ${item.color}, transparent)`,
              }} />
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: `${item.color}1c`, color: item.color,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                marginBottom: 10,
              }}>
                <Icon size={16} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.55 }}>{item.desc}</div>
            </div>
          );
        })}
      </div>

      {/* Messages */}
      {error && <div style={{ background: `${t.red}18`, border: `1px solid ${t.red}44`, borderRadius: 10, padding: "12px 20px", marginBottom: 20, color: t.red, fontSize: 13 }}>{error}</div>}
      {success && <div style={{ background: `${t.green}18`, border: `1px solid ${t.green}44`, borderRadius: 10, padding: "12px 20px", marginBottom: 20, color: t.green, fontSize: 13 }}>{success}</div>}

      {/* Create proposal */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.white }}>Active Proposals ({proposals.length})</div>
        <Btn primary onClick={() => {
            if (!connected) return openWallet();
            if (pretokenMode && !canPropose) return showErr("Pre-token mode: only approved contributors or verified vanguards may propose. Apply above.");
            setShowCreate(!showCreate);
          }}
          style={{ fontSize: 13, opacity: pretokenMode && connected && !canPropose ? 0.5 : 1 }}>
          {showCreate ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Create Proposal</>}
        </Btn>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{ background: t.bgCard, border: "1px solid rgba(155,93,229,0.3)", borderRadius: 14, padding: 28, marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginBottom: 20 }}>New Proposal</div>
          <div style={{ fontSize: 11, color: t.textDim, marginBottom: 16 }}>
            {pretokenMode
              ? "Pre-token mode: approved contributors or verified vanguards can propose."
              : "Requires staked $IRONCLAW in at least one pool to propose."}
          </div>

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
              {newProposal.type === "Mission"      && "Describe the new IronClaw mission: what should it monitor?"}
              {newProposal.type === "PromptUpdate" && "Write the new AI system prompt for IronClaw. This replaces the current one."}
              {newProposal.type === "RuleChange"   && "Describe the rule change: which capability to enable or disable."}
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
    </div>
  );
}
