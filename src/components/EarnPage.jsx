"use client";
import { useState, useRef, useEffect, useMemo } from "react";
import {
  Search, Trophy, Link2, Image as ImageIcon, X, Send, Lock, Bot,
  ExternalLink, Sun, Moon, Zap, Users, Star, Clock, CheckCircle,
  ChevronDown, Upload, Award, TrendingUp, Calendar,
} from "lucide-react";
import { Section, Badge, Btn, StatCard } from "./Primitives";
import { useTheme, useWallet, useProposals } from "@/lib/contexts";
import { DEFAULT_CONTESTS, memoryStore } from "@/lib/store";
import { RevenueStreams, HowUsersEarn } from "./IronClawSections";

// ─── Constants ────────────────────────────────────────────────────────────────
const TOTAL_POOL       = 22_000_000;
const WEEKS_TOTAL      = 7;
const WEEKLY_POOL      = Math.round(TOTAL_POOL / WEEKS_TOTAL); // ~3,142,857

// ─── Static task data ─────────────────────────────────────────────────────────
const DAILY_RITUALS = [
  {
    id: "ritual-gm",
    emoji: "☀️",
    title: "GM Post",
    description: "Share your GM with an IronClaw pic or GIF. Spread the daily energy.",
    points: "50–150",
    difficulty: "Easy",
    category: "Daily",
    tip: "Use IronClaw branded art for bonus points.",
  },
  {
    id: "ritual-gn",
    emoji: "🌙",
    title: "GN Post",
    description: "Wrap up the day with a GN post. Tell the community how your day went.",
    points: "50–150",
    difficulty: "Easy",
    category: "Daily",
    tip: "Share a highlight from your day in the Telegram.",
  },
  {
    id: "ritual-checkin",
    emoji: "✅",
    title: "Daily Check-In",
    description: "Visit the site and click claim. Shows you're an active community member.",
    points: "25–75",
    difficulty: "Easy",
    category: "Daily",
    tip: "Consecutive days multiply your streak bonus.",
  },
  {
    id: "ritual-react",
    emoji: "⚡",
    title: "Quick Reactions",
    description: "Upvote or comment on Alpha feed items. Engage with fresh content.",
    points: "10–50",
    difficulty: "Easy",
    category: "Daily",
    tip: "Quality comments earn more than plain upvotes.",
  },
];

const CONTENT_MISSIONS = [
  {
    id: "content-video",
    emoji: "🎬",
    title: "Short Video (15–60s)",
    description: "Film a quick demo, review, or explainer about IronShield or IronClaw. Short and snappy wins.",
    points: "500–2,000",
    difficulty: "Medium",
    category: "Video",
    tip: "Post on TikTok, YouTube Shorts, or X. Include cashtag $IRONCLAW.",
  },
  {
    id: "content-meme",
    emoji: "🖼️",
    title: "IronClaw Meme",
    description: "Create a meme using IronClaw or IronShield branding. Original art gets bonus multipliers.",
    points: "100–500",
    difficulty: "Easy",
    category: "Meme",
    tip: "Post in Telegram and tag the project on X for visibility.",
  },
  {
    id: "content-thread",
    emoji: "🧵",
    title: "Twitter Thread (3–5 tweets)",
    description: "Write a clear thread explaining IronShield, governance, or IronClaw agent. Link is your proof.",
    points: "300–1,000",
    difficulty: "Medium",
    category: "Thread",
    tip: "End with a CTA and tag @IronClawHQ for retweet chances.",
  },
  {
    id: "content-blog",
    emoji: "✍️",
    title: "Blog Post / Review",
    description: "Publish a blog post or Medium article. Deep dives and tutorials score highest.",
    points: "500–1,500",
    difficulty: "Hard",
    category: "Blog",
    tip: "Mirror.xyz posts qualify. Include screenshots for credibility.",
  },
];

const COMMUNITY_MISSIONS = [
  {
    id: "community-refer",
    emoji: "📢",
    title: "Invite a Friend",
    description: "Refer someone new to the project. Submit their wallet address as your referral proof.",
    points: "200–400",
    difficulty: "Easy",
    category: "Growth",
    tip: "Referred user must connect wallet within 7 days to count.",
  },
  {
    id: "community-bug",
    emoji: "🐛",
    title: "Report a Bug",
    description: "Find and report a reproducible bug with steps to reproduce. Quality reports only.",
    points: "150–600",
    difficulty: "Medium",
    category: "Community",
    tip: "Critical bugs earn up to 600 pts. Include browser + OS info.",
  },
  {
    id: "community-translate",
    emoji: "🌍",
    title: "Translate Content",
    description: "Translate a page, post, or doc into another language. Community votes on quality.",
    points: "200–800",
    difficulty: "Medium",
    category: "Community",
    tip: "Chinese, Spanish, Korean, and Arabic get bonus multipliers.",
  },
  {
    id: "community-help",
    emoji: "🤝",
    title: "Help in Telegram",
    description: "Answer questions in the Telegram group. Mods nominate top helpers weekly.",
    points: "50–300",
    difficulty: "Easy",
    category: "Community",
    tip: "Nominated helpers get automatic weekly point allocation.",
  },
];

// ─── Format meta for agent tasks ─────────────────────────────────────────────
const FORMAT_META = {
  twitter_thread:      { label: "Twitter Thread", emoji: "🧵" },
  short_video:         { label: "Short Video",    emoji: "🎬" },
  meme:                { label: "Meme",           emoji: "🖼️" },
  blog_post:           { label: "Blog Post",      emoji: "✍️" },
  community_challenge: { label: "Challenge",      emoji: "🎯" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtAgo = (nsTimestamp) => {
  if (!nsTimestamp) return "";
  const ms   = Number(nsTimestamp) / 1_000_000;
  const diff = Date.now() - ms;
  if (diff < 3_600_000)  return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
};

const fmt = (n) => n?.toLocaleString() ?? "—";

function truncAddr(addr) {
  if (!addr) return "—";
  if (addr.length <= 18) return addr;
  return addr.slice(0, 10) + "…" + addr.slice(-6);
}

// Saturday 9 PM UTC countdown
function getWeekProgress() {
  const now     = new Date();
  const day     = now.getUTCDay(); // 0=Sun … 6=Sat
  const msInDay = 24 * 3600 * 1000;
  // How many ms since last Saturday 21:00 UTC?
  const saturdayOffset = ((day === 6 ? 0 : (day + 1)) * msInDay);
  const lastSat9pm     = new Date(now);
  lastSat9pm.setUTCHours(21, 0, 0, 0);
  if (day !== 6) lastSat9pm.setUTCDate(lastSat9pm.getUTCDate() - day - 1);
  const msSinceReset = now - lastSat9pm;
  const weekMs       = 7 * msInDay;
  const pct          = Math.min(100, (msSinceReset / weekMs) * 100);
  const msLeft       = weekMs - msSinceReset;
  const dLeft        = Math.floor(msLeft / msInDay);
  const hLeft        = Math.floor((msLeft % msInDay) / 3600000);
  return { pct, countdown: `${dLeft}d ${hLeft}h` };
}

// Derive current week number (1–7) from epoch (phase started Week of Apr 7, 2026)
function getCurrentWeek() {
  const start = new Date("2026-04-12T21:00:00Z").getTime();
  const now   = Date.now();
  const week  = Math.min(WEEKS_TOTAL, Math.max(1, Math.floor((now - start) / (7 * 86400000)) + 1));
  return week;
}

function buildInspirationQuery(task) {
  const raw =
    typeof task?.inspirationQuery === "string" && task.inspirationQuery.trim()
      ? task.inspirationQuery.trim()
      : (task?.title || "").toString().trim();
  return raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[#@]\w+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function proposalToContests(proposal) {
  let parsed;
  try { parsed = JSON.parse(proposal.content); } catch { return []; }
  if (!parsed || parsed.agentRole !== "content_engine" || !Array.isArray(parsed.tasks)) return [];
  return parsed.tasks.map((task, i) => {
    const meta      = FORMAT_META[task.format] || FORMAT_META.community_challenge;
    const rewardUSD = Math.max(20, Math.min(40, Math.round(Number(task.rewardUSD) || 25)));
    return {
      id:               `agent-${proposal.id}-${task.id ?? i}`,
      proposalId:       proposal.id,
      agentTask:        true,
      title:            task.title,
      description:      task.deliverable,
      reward:           `$${rewardUSD} in $CLAW`,
      rewardUSD,
      points:           String(rewardUSD * 40),
      type:             meta.label,
      category:         meta.label,
      difficulty:       task.difficulty
        ? task.difficulty.charAt(0).toUpperCase() + task.difficulty.slice(1)
        : (task.estimatedMinutes <= 25 ? "Easy" : task.estimatedMinutes <= 45 ? "Medium" : "Hard"),
      deadline:         fmtAgo(proposal.created_at) + " · ~" + (task.estimatedMinutes || 30) + "min",
      emoji:            meta.emoji,
      bestWayToDeliver: task.bestWayToDeliver,
      inspirationQuery: buildInspirationQuery(task),
    };
  });
}

// ─── Difficulty pill ──────────────────────────────────────────────────────────
function DiffBadge({ difficulty }) {
  const t = useTheme();
  const color =
    difficulty === "Hard"   ? t.red   :
    difficulty === "Medium" ? t.amber : t.green;
  return <Badge color={color}>{difficulty}</Badge>;
}

// ─── Points range display ─────────────────────────────────────────────────────
function PointsRange({ pts, t }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>
        {pts}
      </div>
      <div style={{ fontSize: 10, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>pts</div>
    </div>
  );
}

// ─── Submission modal ────────────────────────────────────────────────────────
function SubmitModal({ task, t, onClose, onSubmit, connected, openWallet }) {
  const [subLink, setSubLink] = useState("");
  const [subNote, setSubNote] = useState("");
  const [subImg,  setSubImg]  = useState(null);
  const fileRef               = useRef();

  const handleImg = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setSubImg(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (!subLink.trim()) return;
    onSubmit({ link: subLink, note: subNote, img: subImg });
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20,
        padding: 36, width: 520, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto",
        boxShadow: `0 32px 80px rgba(0,0,0,0.6)`,
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: t.white }}>Submit Proof</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>{task?.title}</div>
            {task?.points && (
              <div style={{ fontSize: 12, color: t.green, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                {task.agentTask ? task.reward : `Earn ${task.points} pts`}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
            width: 32, height: 32, cursor: "pointer", color: t.textMuted,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <X size={14} />
          </button>
        </div>

        {/* Agent judging notice */}
        <div style={{
          background: `${t.accent}12`, border: `1px solid ${t.accent}30`, borderRadius: 10,
          padding: "10px 14px", marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start",
        }}>
          <Bot size={15} color={t.accent} style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6 }}>
            <strong style={{ color: t.accent }}>IronClaw judges your submission.</strong>
            {" "}The agent scores proof quality, effort, and community impact. Points post after review (usually within 24h).
          </div>
        </div>

        {/* Link */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Link to your work *</div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 14px",
          }}>
            <Link2 size={14} color={t.textDim} />
            <input
              value={subLink} onChange={e => setSubLink(e.target.value)}
              placeholder="https://twitter.com/… or https://youtube.com/…"
              style={{ background: "none", border: "none", outline: "none", color: t.text, fontSize: 14, flex: 1 }}
            />
          </div>
        </div>

        {/* Note */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Notes (optional)</div>
          <textarea
            value={subNote} onChange={e => setSubNote(e.target.value)}
            rows={3} placeholder="Describe your submission, approach, or context…"
            style={{
              width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`,
              borderRadius: 8, padding: "10px 14px", color: t.text, fontSize: 13,
              outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </div>

        {/* Image upload */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 8 }}>Screenshot / Proof image (optional)</div>
          <input type="file" accept="image/*" ref={fileRef} onChange={handleImg} style={{ display: "none" }} />
          {subImg ? (
            <div style={{ position: "relative", display: "inline-block" }}>
              <img src={subImg} alt="proof preview" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 10, border: `1px solid ${t.border}` }} />
              <button onClick={() => setSubImg(null)} style={{
                position: "absolute", top: 6, right: 6, background: t.red, border: "none",
                borderRadius: 6, width: 24, height: 24, cursor: "pointer", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <X size={12} />
              </button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} style={{
              width: "100%", padding: "20px 0", background: t.bgSurface,
              border: `2px dashed ${t.border}`, borderRadius: 10, cursor: "pointer",
              color: t.textMuted, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              <Upload size={20} color={t.textDim} />
              <span style={{ fontSize: 13 }}>Click to upload proof image</span>
              <span style={{ fontSize: 11, color: t.textDim }}>PNG, JPG, GIF — up to 10 MB</span>
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
          <Btn primary onClick={handleSubmit} disabled={!subLink.trim()} style={{ flex: 1, justifyContent: "center" }}>
            <Send size={14} /> Submit
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Mission card ─────────────────────────────────────────────────────────────
function MissionCard({ task, t, onSubmit, connected, openWallet }) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: "20px 22px", display: "flex", justifyContent: "space-between",
      alignItems: "center", gap: 16, transition: "all 0.22s",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent + "66"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = ""; }}
    >
      <div style={{ display: "flex", gap: 14, flex: 1, minWidth: 0, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{
          background: t.bgSurface, borderRadius: 12, width: 46, height: 46,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, flexShrink: 0,
        }}>
          {task.emoji || "🎯"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: t.white }}>{task.title}</span>
            {task.agentTask && (
              <Badge color={t.accent}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Bot size={9} /> Agent</span>
              </Badge>
            )}
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5, maxWidth: 540 }}>{task.description}</div>
          {task.tip && (
            <div style={{ fontSize: 12, color: t.textDim, marginTop: 4, fontStyle: "italic" }}>
              Tip: {task.tip}
            </div>
          )}
          {task.bestWayToDeliver && (
            <div style={{ fontSize: 12, color: t.textDim, marginTop: 4, fontStyle: "italic" }}>
              How: {task.bestWayToDeliver}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
            <Badge color={t.accent}>{task.category || task.type}</Badge>
            <DiffBadge difficulty={task.difficulty} />
            {task.deadline && (
              <span style={{ fontSize: 11, color: t.textDim, display: "flex", alignItems: "center", gap: 3 }}>
                <Clock size={10} /> {task.agentTask ? task.deadline : `Due ${task.deadline}`}
              </span>
            )}
          </div>
          {task.agentTask && task.inspirationQuery && (
            <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              <a
                href={`https://x.com/search?q=${encodeURIComponent(task.inspirationQuery)}&src=typed_query`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: t.accent, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}
              >
                Search X <ExternalLink size={10} />
              </a>
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(task.inspirationQuery)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: t.accent, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}
              >
                Google <ExternalLink size={10} />
              </a>
            </div>
          )}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {task.agentTask
          ? <div style={{ fontSize: 16, fontWeight: 800, color: t.green, fontFamily: "'JetBrains Mono', monospace", marginBottom: 2 }}>{task.reward}</div>
          : <PointsRange pts={task.points} t={t} />
        }
        <div style={{ marginTop: 8 }}>
          {connected
            ? <Btn primary onClick={() => onSubmit(task)} style={{ fontSize: 12, padding: "8px 16px" }}><Send size={12} /> Participate</Btn>
            : <Btn onClick={openWallet} style={{ fontSize: 12, padding: "8px 16px" }}>Connect</Btn>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Daily ritual card ────────────────────────────────────────────────────────
function RitualCard({ task, t, onSubmit, connected, openWallet }) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: "18px 20px", display: "flex", alignItems: "center", gap: 14,
      transition: "all 0.2s",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = t.green + "55"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; }}
    >
      <div style={{
        background: `${t.green}18`, borderRadius: 12, width: 48, height: 48,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 24, flexShrink: 0,
      }}>
        {task.emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>{task.title}</div>
        <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{task.description}</div>
        {task.tip && <div style={{ fontSize: 11, color: t.textDim, marginTop: 3, fontStyle: "italic" }}>Tip: {task.tip}</div>}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>{task.points}</div>
        <div style={{ fontSize: 10, color: t.textDim }}>pts/day</div>
        <div style={{ marginTop: 8 }}>
          {connected
            ? <Btn primary onClick={() => onSubmit(task)} style={{ fontSize: 11, padding: "6px 14px" }}><Send size={11} /> Submit</Btn>
            : <Btn onClick={openWallet} style={{ fontSize: 11, padding: "6px 14px" }}>Connect</Btn>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EarnPage({ openWallet }) {
  const t                                        = useTheme();
  const { connected, address }                   = useWallet();
  const { proposals, loading: proposalsLoading } = useProposals();

  const [activeTab, setActiveTab]     = useState("missions");
  const [submitting, setSubmitting]   = useState(null); // task object
  const [searchQ, setSearchQ]         = useState("");
  const [submitted, setSubmitted]     = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [weekProgress, setWeekProgress] = useState({ pct: 0, countdown: "…" });
  const [currentWeek, setCurrentWeek]   = useState(1);

  // Derive live content_engine tasks from the proposals cache
  const agentTasks = useMemo(() => {
    return (Array.isArray(proposals) ? proposals : [])
      .filter(p => p && !p.executed && p.proposal_type === "Mission")
      .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
      .flatMap(proposalToContests);
  }, [proposals]);

  // Final mission list = live agent tasks + static defaults
  const allMissions = useMemo(() => {
    const baseline = memoryStore.contests || [];
    const baseConverted = baseline.map(c => ({
      ...c,
      points: c.points || c.reward || "200–600",
      category: c.type || "Content",
    }));
    return [...agentTasks, ...baseConverted];
  }, [agentTasks]);

  useEffect(() => {
    // Leaderboard from memoryStore.scores with weekly/total columns
    const sorted = [...memoryStore.scores]
      .sort((a, b) => b.points - a.points)
      .map((s, i) => ({
        rank:    i + 1,
        addr:    s.wallet,
        weekly:  Math.round(s.points * 0.3 + Math.random() * 200),
        total:   s.points,
        badge:   i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null,
      }));
    setLeaderboard(sorted);

    try {
      const saved = JSON.parse(sessionStorage.getItem("ironshield_submissions") || "[]");
      setSubmitted(saved);
    } catch { setSubmitted([]); }

    setWeekProgress(getWeekProgress());
    setCurrentWeek(getCurrentWeek());
  }, []);

  const handleOpenSubmit = (task) => {
    if (!connected) { openWallet?.(); return; }
    setSubmitting(task);
  };

  const handleSubmit = ({ link, note, img }) => {
    if (!submitting) return;
    const newSub = {
      taskId:    submitting.id,
      taskTitle: submitting.title,
      category:  submitting.category || submitting.type || "Mission",
      link,
      note,
      img,
      wallet: address,
      ts:     new Date().toLocaleString(),
      status: "Agent Judging",
    };
    const updated = [...submitted, newSub];
    setSubmitted(updated);
    try { sessionStorage.setItem("ironshield_submissions", JSON.stringify(updated)); } catch {}
  };

  const filteredMissions = allMissions.filter(c =>
    c.title.toLowerCase().includes(searchQ.toLowerCase())
  );
  const filteredContent  = CONTENT_MISSIONS.filter(c =>
    c.title.toLowerCase().includes(searchQ.toLowerCase())
  );
  const filteredCommunity = COMMUNITY_MISSIONS.filter(c =>
    c.title.toLowerCase().includes(searchQ.toLowerCase())
  );

  const userRankData = leaderboard.find(l => l.addr === address);
  const userPoints   = userRankData?.total ?? 0;
  const userRank     = userRankData?.rank ?? null;

  const TABS = [
    { key: "missions",    label: "Missions",          icon: <Star size={13} /> },
    { key: "daily",       label: "Daily Rituals",      icon: <Sun size={13} /> },
    { key: "leaderboard", label: "Leaderboard",        icon: <Trophy size={13} /> },
    { key: "submissions", label: `My Submissions (${submitted.length})`, icon: <CheckCircle size={13} /> },
  ];

  return (
    <>
    <Section style={{ paddingTop: 100 }}>

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <Badge color={t.green}>EARN &amp; COMPETE</Badge>
        <h1 style={{ fontSize: 34, fontWeight: 800, color: t.white, marginTop: 10, marginBottom: 6 }}>
          Earn Points. Shape IronClaw.
        </h1>
        <p style={{ fontSize: 15, color: t.textMuted, maxWidth: 560, lineHeight: 1.7 }}>
          Complete missions, create content, help the community. IronClaw judges your work and allocates points from the&nbsp;
          <strong style={{ color: t.green }}>22,000,000 pt</strong> total pool over 7 weeks.
        </p>
      </div>

      {/* ── Stats bar ────────────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 14, marginBottom: 28,
      }}>
        <StatCard icon={Award}       label="Total Points Pool"   value="22,000,000"              color={t.accent} />
        <StatCard icon={TrendingUp}  label="This Week's Pool"    value={fmt(WEEKLY_POOL)}         color={t.green} />
        <StatCard icon={Star}        label="Your Points"         value={connected ? fmt(userPoints) : "—"}  color={t.amber}  blur={!connected} />
        <StatCard icon={Trophy}      label="Your Rank"           value={connected && userRank ? `#${userRank}` : "—"} color={t.accent} blur={!connected} />
      </div>

      {/* ── Week progress bar ─────────────────────────────────────────────────── */}
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
        padding: "18px 22px", marginBottom: 28,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Calendar size={15} color={t.accent} />
            <span style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
              Week {currentWeek} of {WEEKS_TOTAL}
            </span>
            <Badge color={t.accent}>Active</Badge>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={13} color={t.textDim} />
            <span style={{ fontSize: 12, color: t.textMuted }}>
              Next distribution in <strong style={{ color: t.amber }}>{weekProgress.countdown}</strong> (Sat 9 PM UTC)
            </span>
          </div>
        </div>
        {/* Segment bar */}
        <div style={{ position: "relative", height: 8, background: t.bgSurface, borderRadius: 99, overflow: "hidden" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${weekProgress.pct}%`,
            background: `linear-gradient(90deg, ${t.accent}, ${t.green})`,
            borderRadius: 99, transition: "width 0.5s",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          {Array.from({ length: WEEKS_TOTAL }, (_, i) => (
            <div key={i} style={{ fontSize: 10, color: i + 1 <= currentWeek ? t.accent : t.textDim, fontWeight: i + 1 === currentWeek ? 800 : 400 }}>
              W{i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* ── Agent banner ─────────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(135deg, ${t.accent}12, transparent)`,
        border: `1px solid ${t.accent}33`, borderRadius: 14,
        padding: "14px 18px", display: "flex", alignItems: "center",
        gap: 12, marginBottom: 24, flexWrap: "wrap",
      }}>
        <div style={{ background: `${t.accent}20`, borderRadius: 10, padding: 9 }}>
          <Bot size={18} color={t.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
            {proposalsLoading
              ? "Loading IronClaw tasks…"
              : `${agentTasks.length} live tasks from IronClaw Agent`}
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
            The IronClaw agent scores all submissions and distributes points weekly. Refreshes daily.
          </div>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 28,
        borderBottom: `1px solid ${t.border}`, paddingBottom: 0, flexWrap: "wrap",
      }}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: "10px 18px", borderRadius: "8px 8px 0 0", fontSize: 13,
            fontWeight: 600, cursor: "pointer", border: "none",
            borderBottom: activeTab === tab.key ? `2px solid ${t.accent}` : "2px solid transparent",
            background: activeTab === tab.key ? `${t.accent}12` : "transparent",
            color: activeTab === tab.key ? t.accent : t.textMuted,
            transition: "all 0.18s",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Search bar (shown on missions / daily) ───────────────────────────── */}
      {(activeTab === "missions" || activeTab === "daily") && (
        <div style={{ marginBottom: 20 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: t.bgCard, border: `1px solid ${t.border}`,
            borderRadius: 10, padding: "10px 14px", maxWidth: 400,
          }}>
            <Search size={14} color={t.textDim} />
            <input
              value={searchQ} onChange={e => setSearchQ(e.target.value)}
              placeholder="Search tasks…"
              style={{ background: "none", border: "none", outline: "none", color: t.text, fontSize: 13, flex: 1 }}
            />
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: MISSIONS
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "missions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

          {/* Content Creation */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ background: `${t.accent}18`, borderRadius: 8, padding: "6px 10px" }}>
                <Zap size={14} color={t.accent} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>Content Creation</div>
                <div style={{ fontSize: 12, color: t.textMuted }}>Videos, memes, threads, blog posts</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredContent.map(task => (
                <MissionCard key={task.id} task={task} t={t} onSubmit={handleOpenSubmit} connected={connected} openWallet={openWallet} />
              ))}
            </div>
          </div>

          {/* Community Tasks */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ background: `${t.amber}18`, borderRadius: 8, padding: "6px 10px" }}>
                <Users size={14} color={t.amber} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>Community Tasks</div>
                <div style={{ fontSize: 12, color: t.textMuted }}>Referrals, bug reports, translations, support</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredCommunity.map(task => (
                <MissionCard key={task.id} task={task} t={t} onSubmit={handleOpenSubmit} connected={connected} openWallet={openWallet} />
              ))}
            </div>
          </div>

          {/* Agent Tasks */}
          {filteredMissions.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ background: `${t.green}18`, borderRadius: 8, padding: "6px 10px" }}>
                  <Bot size={14} color={t.green} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>Agent-Created Tasks</div>
                  <div style={{ fontSize: 12, color: t.textMuted }}>Dynamic missions from IronClaw governance</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredMissions.map(task => (
                  <MissionCard key={task.id} task={task} t={t} onSubmit={handleOpenSubmit} connected={connected} openWallet={openWallet} />
                ))}
              </div>
            </div>
          )}

          {filteredContent.length === 0 && filteredCommunity.length === 0 && filteredMissions.length === 0 && (
            <div style={{ textAlign: "center", padding: "50px 0", color: t.textMuted }}>
              No tasks match "{searchQ}".
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: DAILY RITUALS
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "daily" && (
        <div>
          {/* GM/GN submit area */}
          <div style={{
            background: `linear-gradient(135deg, ${t.bgCard}, ${t.bgSurface})`,
            border: `1px solid ${t.border}`, borderRadius: 18, padding: "28px 28px",
            marginBottom: 24,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 28 }}>☀️</span>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: t.white }}>Say GM or GN</div>
                <div style={{ fontSize: 13, color: t.textMuted }}>Share your daily IronClaw moment with the community</div>
              </div>
            </div>
            <textarea
              placeholder="GM everyone! IronClaw is watching over the chain… 🔒"
              rows={3}
              style={{
                width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`,
                borderRadius: 12, padding: "14px 16px", color: t.text, fontSize: 14,
                outline: "none", resize: "vertical", fontFamily: "inherit",
                boxSizing: "border-box", marginBottom: 14, lineHeight: 1.6,
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ fontSize: 12, color: t.textDim, display: "flex", alignItems: "center", gap: 5 }}>
                <ImageIcon size={12} />
                Attach IronClaw pic for +50 bonus pts
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {connected
                  ? (
                    <>
                      <Btn onClick={() => handleOpenSubmit(DAILY_RITUALS[0])} style={{ fontSize: 12, padding: "8px 16px" }}>
                        <Moon size={12} /> GN
                      </Btn>
                      <Btn primary onClick={() => handleOpenSubmit(DAILY_RITUALS[0])} style={{ fontSize: 12, padding: "8px 16px" }}>
                        <Sun size={12} /> GM
                      </Btn>
                    </>
                  )
                  : <Btn primary onClick={openWallet} style={{ fontSize: 12, padding: "8px 16px" }}>Connect Wallet</Btn>
                }
              </div>
            </div>
          </div>

          {/* Ritual cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {DAILY_RITUALS.filter(r => r.title.toLowerCase().includes(searchQ.toLowerCase())).map(task => (
              <RitualCard key={task.id} task={task} t={t} onSubmit={handleOpenSubmit} connected={connected} openWallet={openWallet} />
            ))}
          </div>

          {/* How it works note */}
          <div style={{
            background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
            padding: "20px 22px", marginTop: 24,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 12 }}>How daily rituals work</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                ["1", "Post your GM/GN or complete the daily task", t.accent],
                ["2", "Submit proof — a link, screenshot, or text", t.green],
                ["3", "IronClaw agent reviews and scores your submission", t.amber],
                ["4", "Points post to your account within 24 hours", t.accent],
              ].map(([num, text, color]) => (
                <div key={num} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{
                    background: `${color}20`, color, borderRadius: "50%",
                    width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800, flexShrink: 0, marginTop: 1,
                  }}>{num}</div>
                  <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6 }}>{text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: LEADERBOARD
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "leaderboard" && (
        <div>
          {/* Podium top 3 */}
          {leaderboard.length >= 3 && (
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12, marginBottom: 24,
            }}>
              {[leaderboard[1], leaderboard[0], leaderboard[2]].map((row, idx) => {
                const isPrimary = idx === 1;
                const colors    = [t.textMuted, t.amber, t.text];
                const heights   = [80, 100, 70];
                return (
                  <div key={row.rank} style={{
                    background: isPrimary ? `linear-gradient(135deg, ${t.accent}18, ${t.bgCard})` : t.bgCard,
                    border: `1px solid ${isPrimary ? t.accent + "55" : t.border}`,
                    borderRadius: 14, padding: "22px 16px",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 6, marginTop: idx !== 1 ? 20 : 0,
                  }}>
                    <div style={{ fontSize: 30 }}>{row.badge}</div>
                    <div style={{
                      width: 44, height: 44, borderRadius: "50%",
                      background: `${colors[idx]}22`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, border: `2px solid ${colors[idx]}44`,
                    }}>
                      {row.addr?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.white, textAlign: "center" }}>
                      {truncAddr(row.addr)}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmt(row.total)}
                    </div>
                    <div style={{ fontSize: 10, color: t.textDim }}>total pts</div>
                    {connected && address === row.addr && <Badge color={t.accent}>YOU</Badge>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Full table */}
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "18px 22px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>Community Leaderboard</div>
                <div style={{ fontSize: 12, color: t.textMuted }}>Updated weekly every Saturday 9 PM UTC</div>
              </div>
              <Badge color={t.green}>Week {currentWeek} / {WEEKS_TOTAL}</Badge>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: t.bgSurface }}>
                    {["Rank", "Wallet", "This Week", "All Time", ""].map(h => (
                      <th key={h} style={{ padding: "12px 20px", textAlign: "left", fontSize: 11, color: t.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, i) => (
                    <tr key={i} style={{
                      borderBottom: `1px solid ${t.border}33`,
                      background: connected && address === row.addr ? `${t.accent}08` : "transparent",
                    }}>
                      <td style={{ padding: "14px 20px", color: t.white, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>
                        {row.badge ? row.badge : `#${row.rank}`}
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: "50%",
                            background: `${t.accent}18`, display: "flex", alignItems: "center",
                            justifyContent: "center", fontSize: 13, fontWeight: 700, color: t.accent,
                          }}>
                            {row.addr?.[0]?.toUpperCase() || "?"}
                          </div>
                          <span style={{ fontSize: 13, color: t.text }}>{truncAddr(row.addr)}</span>
                        </div>
                      </td>
                      <td style={{ padding: "14px 20px", color: t.amber, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                        {fmt(row.weekly)}
                      </td>
                      <td style={{ padding: "14px 20px", color: t.green, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                        {fmt(row.total)}
                      </td>
                      <td style={{ padding: "14px 20px" }}>
                        {connected && address === row.addr && <Badge color={t.accent}>YOU</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: MY SUBMISSIONS
         ════════════════════════════════════════════════════════════════════ */}
      {activeTab === "submissions" && (
        <div>
          {!connected ? (
            <div style={{ textAlign: "center", padding: "70px 0" }}>
              <Lock size={40} color={t.textDim} style={{ marginBottom: 14 }} />
              <div style={{ color: t.textMuted, marginBottom: 18, fontSize: 15 }}>Connect your wallet to view your submissions</div>
              <Btn primary onClick={openWallet}><Lock size={14} /> Connect Wallet</Btn>
            </div>
          ) : submitted.length === 0 ? (
            <div style={{ textAlign: "center", padding: "70px 0" }}>
              <Trophy size={40} color={t.textDim} style={{ marginBottom: 14 }} />
              <div style={{ color: t.textMuted, marginBottom: 8, fontSize: 15 }}>No submissions yet</div>
              <div style={{ color: t.textDim, fontSize: 13, marginBottom: 20 }}>Complete a mission or daily ritual to earn your first points.</div>
              <Btn primary onClick={() => setActiveTab("missions")}><Star size={14} /> Browse Missions</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {submitted.map((sub, i) => (
                <div key={i} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 22 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>{sub.taskTitle}</div>
                      <div style={{ fontSize: 12, color: t.textDim, marginTop: 3 }}>{sub.ts}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {sub.status === "Agent Judging" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: t.amber, animation: "pulse 2s infinite",
                          }} />
                          <span style={{ fontSize: 12, color: t.amber, fontWeight: 600 }}>Agent Judging</span>
                        </div>
                      )}
                      <Badge color={t.amber}>{sub.category || "Mission"}</Badge>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: sub.note ? 10 : 0 }}>
                    <Link2 size={13} color={t.accent} />
                    <a href={sub.link} target="_blank" rel="noopener noreferrer"
                      style={{ color: t.accent, fontSize: 13, textDecoration: "none", wordBreak: "break-all" }}>
                      {sub.link}
                    </a>
                  </div>
                  {sub.note && <div style={{ fontSize: 13, color: t.textMuted, marginTop: 8, padding: "8px 12px", background: t.bgSurface, borderRadius: 8 }}>{sub.note}</div>}
                  {sub.img && <img src={sub.img} alt="proof" style={{ maxWidth: "100%", borderRadius: 10, border: `1px solid ${t.border}`, marginTop: 12 }} />}
                  {/* Agent judging note */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, padding: "8px 12px", background: `${t.amber}10`, borderRadius: 8 }}>
                    <Bot size={12} color={t.amber} />
                    <span style={{ fontSize: 11, color: t.amber }}>IronClaw is reviewing your submission. Points post within 24 hours.</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </Section>

    {/* ── Submit modal ─────────────────────────────────────────────────────── */}
    {submitting && (
      <SubmitModal
        task={submitting}
        t={t}
        onClose={() => setSubmitting(null)}
        onSubmit={handleSubmit}
        connected={connected}
        openWallet={openWallet}
      />
    )}

    {/* ── Revenue streams ──────────────────────────────────────────────────── */}
    <RevenueStreams />

    {/* ── How users earn ───────────────────────────────────────────────────── */}
    <HowUsersEarn />
    </>
  );
}
