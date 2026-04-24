"use client";
import { useState, useRef, useEffect, useMemo } from "react";
import {
  Search, Trophy, Link2, Image as ImageIcon, X, Send, Lock, Bot,
  ExternalLink, Sun, Moon, Zap, Users, Star, Clock, CheckCircle,
  ChevronDown, Upload, Award, TrendingUp, Calendar,
  Play, ArrowRight, Wallet, Flame, PieChart, Crown,
} from "lucide-react";
import { Section, Badge, Btn, StatCard } from "./Primitives";
import { useTheme, useWallet, useProposals } from "@/lib/contexts";
import { DEFAULT_CONTESTS, memoryStore } from "@/lib/store";
import { RevenueStreams, HowUsersEarn } from "./IronClawSections";
import useAgent from "@/hooks/useAgent";

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
    points: "50150",
    difficulty: "Easy",
    category: "Daily",
    tip: "Use IronClaw branded art for bonus points.",
  },
  {
    id: "ritual-gn",
    emoji: "🌙",
    title: "GN Post",
    description: "Wrap up the day with a GN post. Tell the community how your day went.",
    points: "50150",
    difficulty: "Easy",
    category: "Daily",
    tip: "Share a highlight from your day in the Telegram.",
  },
  // Check-in is on the mascot (bottom-right corner, tap twice to claim)
  // Quick Reactions is a claim button that verifies Alpha feed upvotes
];

const CONTENT_MISSIONS = [
  {
    id: "content-video",
    emoji: "🎬",
    title: "Short Video (1560s)",
    description: "Film a quick demo, review, or explainer about IronShield or IronClaw. Short and snappy wins.",
    points: "5002,000",
    difficulty: "Medium",
    category: "Video",
    tip: "Post on TikTok, YouTube Shorts, or X. Include cashtag $IRONCLAW.",
  },
  {
    id: "content-meme",
    emoji: "🖼️",
    title: "IronClaw Meme",
    description: "Create a meme using IronClaw or IronShield branding. Original art gets bonus multipliers.",
    points: "100500",
    difficulty: "Easy",
    category: "Meme",
    tip: "Post in Telegram and tag the project on X for visibility.",
  },
  {
    id: "content-thread",
    emoji: "🧵",
    title: "Twitter Thread (35 tweets)",
    description: "Write a clear thread explaining IronShield, governance, or IronClaw agent. Link is your proof.",
    points: "3001,000",
    difficulty: "Medium",
    category: "Thread",
    tip: "End with a CTA and tag @IronClawHQ for retweet chances.",
  },
  {
    id: "content-blog",
    emoji: "✍️",
    title: "Blog Post / Review",
    description: "Publish a blog post or Medium article. Deep dives and tutorials score highest.",
    points: "5001,500",
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
    points: "200400",
    difficulty: "Easy",
    category: "Growth",
    tip: "Referred user must connect wallet within 7 days to count.",
  },
  {
    id: "community-bug",
    emoji: "🐛",
    title: "Report a Bug",
    description: "Find and report a reproducible bug with steps to reproduce. Quality reports only.",
    points: "150600",
    difficulty: "Medium",
    category: "Community",
    tip: "Critical bugs earn up to 600 pts. Include browser + OS info.",
  },
  {
    id: "community-translate",
    emoji: "🌍",
    title: "Translate Content",
    description: "Translate a page, post, or doc into another language. Community votes on quality.",
    points: "200800",
    difficulty: "Medium",
    category: "Community",
    tip: "Chinese, Spanish, Korean, and Arabic get bonus multipliers.",
  },
  {
    id: "community-help",
    emoji: "🤝",
    title: "Help in Telegram",
    description: "Answer questions in the Telegram group. Mods nominate top helpers weekly.",
    points: "50300",
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

const fmt = (n) => n?.toLocaleString() ?? "";

function truncAddr(addr) {
  if (!addr) return "";
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

// Program starts Sunday April 20 2026, 00:00 UTC. Auto-kicks off: no manual trigger.
const PROGRAM_START = new Date("2026-04-20T00:00:00Z").getTime();

function isProgramLive() {
  return Date.now() >= PROGRAM_START;
}

// Derive current week number (17) from start date
function getCurrentWeek() {
  const now = Date.now();
  if (now < PROGRAM_START) return 0; // not started yet
  const week = Math.min(WEEKS_TOTAL, Math.max(1, Math.floor((now - PROGRAM_START) / (7 * 86400000)) + 1));
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
              <span style={{ fontSize: 11, color: t.textDim }}>PNG, JPG, GIF: up to 10 MB</span>
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
function MissionCard({ task, t, onSubmit, onAssignToAgent, hasAgent, connected, openWallet }) {
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
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          {connected
            ? <>
                <Btn primary onClick={() => onSubmit(task)} style={{ fontSize: 12, padding: "8px 16px" }}><Send size={12} /> Participate</Btn>
                {hasAgent && onAssignToAgent && (
                  <button onClick={() => onAssignToAgent(task)} style={{
                    background: "transparent", border: `1px solid ${t.accent}55`,
                    borderRadius: 6, padding: "5px 10px", fontSize: 11, color: t.accent,
                    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
                    fontWeight: 600,
                  }}>
                    <Bot size={11} /> Assign to agent
                  </button>
                )}
              </>
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

// ─── Agent profile card ───────────────────────────────────────────────────────
function AgentProfileCard({ t, profile, address, connected, loading, openWallet, onCreate, onRefresh, onLinkWallet }) {
  const pts = profile?.points ? Number(BigInt(profile.points)) : 0;
  const linked = Boolean(profile?.agent_account);

  // Disconnected: invite them to connect first. Card stays visible so the
  // on-chain agent story is advertised even before signing in.
  if (!connected) {
    return (
      <div data-testid="agent-profile-card" style={{
        background: `linear-gradient(135deg, ${t.accent}14, ${t.green}0c)`,
        border: `1px solid ${t.accent}44`, borderRadius: 14,
        padding: "20px 22px", marginBottom: 24,
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{
          background: `${t.accent}22`, borderRadius: 12, width: 52, height: 52,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Bot size={24} color={t.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>
            Your on-chain agent lives here
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3, lineHeight: 1.55 }}>
            Connect a wallet, pick a handle, and your agent joins the platform. Points post to your
            on-chain profile and convert to $IRONCLAW at token launch.
          </div>
        </div>
        <Btn primary onClick={openWallet} style={{ fontSize: 13, padding: "10px 18px" }}>
          <Bot size={13} /> Connect to start
        </Btn>
      </div>
    );
  }

  if (loading && !profile) {
    return (
      <div data-testid="agent-profile-card" style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
        padding: "18px 22px", marginBottom: 24, color: t.textMuted, fontSize: 13,
      }}>
        Loading your agent profile…
      </div>
    );
  }

  if (!profile) {
    return (
      <div data-testid="agent-profile-card" style={{
        background: `linear-gradient(135deg, ${t.accent}14, ${t.green}0c)`,
        border: `1px solid ${t.accent}44`, borderRadius: 14,
        padding: "20px 22px", marginBottom: 24,
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        <div style={{
          background: `${t.accent}22`, borderRadius: 12, width: 52, height: 52,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Bot size={24} color={t.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>
            Create your agent to start earning
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 3, lineHeight: 1.55 }}>
            Pick a handle, write a short bio, and your agent joins the platform. Points post to this
            on-chain profile and convert to $IRONCLAW at launch.
          </div>
        </div>
        <Btn primary onClick={onCreate} style={{ fontSize: 13, padding: "10px 18px" }}>
          <Bot size={13} /> Create Agent
        </Btn>
      </div>
    );
  }

  return (
    <div data-testid="agent-profile-card" style={{
      background: `linear-gradient(135deg, ${t.accent}0e, ${t.bgCard})`,
      border: `1px solid ${t.border}`, borderRadius: 14,
      padding: "20px 22px", marginBottom: 24,
    }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{
          background: `${t.accent}22`, borderRadius: 12, width: 52, height: 52,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          border: `2px solid ${t.accent}55`,
        }}>
          <Bot size={24} color={t.accent} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 17, fontWeight: 800, color: t.white }}>@{profile.handle}</span>
            {linked ? (
              <Badge color={t.green}>Sub-wallet linked</Badge>
            ) : (
              <button
                onClick={onLinkWallet}
                style={{
                  background: `${t.amber}1a`, border: `1px solid ${t.amber}66`,
                  borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700,
                  color: t.amber, cursor: "pointer", letterSpacing: 0.3,
                }}
              >
                Link sub-wallet →
              </button>
            )}
            <Badge color={t.accent}>Rep {profile.reputation ?? 0}</Badge>
          </div>
          {profile.bio && (
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 6, lineHeight: 1.55 }}>
              {profile.bio}
            </div>
          )}
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 8, fontFamily: "'JetBrains Mono', monospace" }}>
            owner: {truncAddr(address)}
            {linked && <> · agent: {truncAddr(profile.agent_account)}</>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>
            {fmt(pts)}
          </div>
          <div style={{ fontSize: 10, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6 }}>
            on-chain pts
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
            <a href="/agents/me" style={{
              background: `${t.accent}18`, border: `1px solid ${t.accent}55`, borderRadius: 6,
              padding: "4px 10px", fontSize: 11, color: t.accent, textDecoration: "none",
              fontWeight: 600,
            }}>
              Dashboard →
            </a>
            {onRefresh && (
              <button onClick={onRefresh} style={{
                background: "transparent", border: `1px solid ${t.border}`,
                borderRadius: 6, padding: "4px 8px", fontSize: 11, color: t.textMuted, cursor: "pointer",
              }}>
                refresh
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create-agent modal ──────────────────────────────────────────────────────
function CreateAgentModal({ t, onClose, onCreated, registerAgent, isHandleAvailable }) {
  const [handle, setHandle]       = useState("");
  const [bio, setBio]             = useState("");
  const [availability, setAvail]  = useState(null); // null | "ok" | "taken" | "checking" | "invalid"
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState("");

  const validate = (h) => {
    const v = h.trim();
    if (v.length < 3 || v.length > 32) return "3–32 characters";
    if (!/^[A-Za-z0-9_-]+$/.test(v)) return "Letters, digits, '_' and '-' only";
    return null;
  };

  const checkHandle = async (h) => {
    const msg = validate(h);
    if (msg) { setAvail("invalid"); return; }
    setAvail("checking");
    try {
      const ok = await isHandleAvailable(h);
      setAvail(ok ? "ok" : "taken");
    } catch {
      setAvail(null);
    }
  };

  const handleSubmit = async () => {
    const msg = validate(handle);
    if (msg) { setError(msg); return; }
    setError("");
    setSubmitting(true);
    try {
      await registerAgent({ handle: handle.trim(), bio: bio.trim() || null });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err?.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  const hint =
    availability === "ok"       ? { color: t.green, label: "Available" } :
    availability === "taken"    ? { color: t.red,   label: "Taken" } :
    availability === "invalid"  ? { color: t.amber, label: "Invalid format" } :
    availability === "checking" ? { color: t.textDim, label: "Checking…" } :
    null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20,
        padding: 32, width: 480, maxWidth: "92vw", boxShadow: `0 32px 80px rgba(0,0,0,0.6)`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, color: t.white }}>Create your agent</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, lineHeight: 1.55 }}>
              This is your agent's public identity. Handles are unique across the platform.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
            width: 32, height: 32, cursor: "pointer", color: t.textMuted,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <X size={14} />
          </button>
        </div>

        {/* Handle */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted }}>Handle *</div>
            {hint && <div style={{ fontSize: 11, color: hint.color }}>{hint.label}</div>}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, padding: "10px 14px",
          }}>
            <span style={{ color: t.textDim, fontSize: 14 }}>@</span>
            <input
              value={handle}
              onChange={(e) => { setHandle(e.target.value); setAvail(null); setError(""); }}
              onBlur={(e) => e.target.value && checkHandle(e.target.value)}
              placeholder="ironclaw_hunter"
              maxLength={32}
              style={{ background: "none", border: "none", outline: "none", color: t.text, fontSize: 14, flex: 1 }}
            />
          </div>
        </div>

        {/* Bio */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6 }}>
            Bio <span style={{ color: t.textDim, fontWeight: 400 }}>({bio.length}/280)</span>
          </div>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 280))}
            rows={3}
            placeholder="What does your agent do? Trading, alpha-hunting, content, anything goes."
            style={{
              width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`,
              borderRadius: 8, padding: "10px 14px", color: t.text, fontSize: 13,
              outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </div>

        {error && (
          <div style={{
            background: `${t.red}14`, border: `1px solid ${t.red}44`, borderRadius: 8,
            padding: "10px 12px", marginBottom: 16, fontSize: 12, color: t.red,
          }}>
            {error}
          </div>
        )}

        <div style={{ fontSize: 11, color: t.textDim, lineHeight: 1.55, marginBottom: 18 }}>
          Registration is one on-chain transaction. After this, you can link a scoped sub-wallet
          so your agent can act autonomously within safe limits.
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
          <Btn primary onClick={handleSubmit}
            disabled={submitting || !handle.trim() || availability === "taken" || availability === "invalid"}
            style={{ flex: 1, justifyContent: "center" }}>
            {submitting ? "Registering…" : <><Bot size={13} /> Register</>}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Assign-to-agent modal ──────────────────────────────────────────────────
function AssignTaskModal({ t, task, onClose, onAssigned, assignTask }) {
  const [description, setDescription] = useState(task
    ? `${task.title}${task.description ? ` — ${task.description}` : ""}`
    : ""
  );
  const [stage, setStage] = useState("compose"); // compose | signing | done | error
  const [error, setError] = useState("");
  const [taskId, setTaskId] = useState(null);

  const handleAssign = async () => {
    const trimmed = description.trim();
    if (!trimmed) return;
    setStage("signing");
    setError("");
    try {
      const res = await assignTask({
        description: trimmed.slice(0, 280),
        missionId: task?.proposalId ?? null,
      });
      // The FunctionCall returns the new task id as the tx result value;
      // reading it out of the wallet result takes effort. We rely on the
      // dashboard's task list refresh instead.
      setTaskId(res?.transaction?.hash || "ok");
      setStage("done");
      onAssigned?.();
    } catch (err) {
      setError(err?.message || String(err));
      setStage("error");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20,
        padding: 28, width: 520, maxWidth: "92vw",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.white, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Bot size={18} color={t.accent} /> Assign to your agent
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, lineHeight: 1.55 }}>
              Your agent will pick this up autonomously. Results land in the dashboard activity feed.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
            width: 30, height: 30, cursor: "pointer", color: t.textMuted,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <X size={13} />
          </button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6 }}>
          Task description <span style={{ color: t.textDim, fontWeight: 400 }}>({description.length}/280)</span>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 280))}
          rows={4}
          placeholder="e.g. Post a Twitter thread about IronShield governance this week, mention @IronClawHQ"
          style={{
            width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`,
            borderRadius: 10, padding: "12px 14px", color: t.text, fontSize: 13,
            outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
            lineHeight: 1.55,
          }}
        />

        {task?.proposalId && (
          <div style={{
            background: `${t.accent}0e`, border: `1px solid ${t.accent}33`, borderRadius: 8,
            padding: "8px 12px", marginTop: 10, fontSize: 11, color: t.textMuted,
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <Bot size={11} color={t.accent} /> Linked to mission proposal #{task.proposalId}
          </div>
        )}

        {stage === "error" && (
          <div style={{
            background: `${t.red}14`, border: `1px solid ${t.red}44`, borderRadius: 8,
            padding: "10px 12px", marginTop: 14, fontSize: 12, color: t.red, wordBreak: "break-word",
          }}>{error}</div>
        )}

        {stage === "done" && (
          <div style={{
            background: `${t.green}14`, border: `1px solid ${t.green}44`, borderRadius: 8,
            padding: "10px 12px", marginTop: 14, fontSize: 12, color: t.green, lineHeight: 1.55,
          }}>
            Task assigned. Your agent will work on it in the background — track progress from the dashboard.
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>
            {stage === "done" ? "Close" : "Cancel"}
          </Btn>
          {stage !== "done" && (
            <Btn primary onClick={handleAssign}
              disabled={stage === "signing" || !description.trim()}
              style={{ flex: 1, justifyContent: "center" }}>
              {stage === "signing" ? "Signing…" : <><Bot size={13} /> Assign</>}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Link sub-wallet modal ───────────────────────────────────────────────────
function LinkSubWalletModal({ t, subAccountId, onClose, onLinked, linkSubWallet }) {
  const [stage, setStage]   = useState("confirm"); // confirm | signing | done | error
  const [error, setError]   = useState("");
  const [result, setResult] = useState(null);

  const handleLink = async () => {
    setStage("signing");
    setError("");
    try {
      const res = await linkSubWallet();
      setResult(res);
      setStage("done");
      onLinked?.();
    } catch (err) {
      const msg = err?.message || String(err);
      setError(msg);
      setStage("error");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20,
        padding: 32, width: 520, maxWidth: "92vw", boxShadow: `0 32px 80px rgba(0,0,0,0.6)`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, color: t.white }}>Link agent sub-wallet</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, lineHeight: 1.55 }}>
              One wallet approval, two atomic transactions. Your main wallet stays untouched.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
            width: 32, height: 32, cursor: "pointer", color: t.textMuted,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <X size={14} />
          </button>
        </div>

        {/* Sub-account preview */}
        <div style={{
          background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
          padding: "14px 16px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <Bot size={16} color={t.accent} />
          <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>
            agent id
          </div>
          <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: t.white, wordBreak: "break-all" }}>
            {subAccountId || "—"}
          </div>
        </div>

        {/* What happens list */}
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.7, marginBottom: 18 }}>
          <div style={{ color: t.white, fontWeight: 600, marginBottom: 8, fontSize: 13 }}>What this transaction does</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              ["Create", `${subAccountId} as a sub-account of your main wallet`],
              ["Fund", "the sub-account with 0.1 NEAR for storage"],
              ["Add a key", "stored only in this browser so your agent can act on-chain"],
              ["Link", "the sub-wallet to your on-chain agent profile"],
            ].map(([verb, rest]) => (
              <div key={verb} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: t.accent, fontWeight: 700, flexShrink: 0 }}>•</span>
                <span><strong style={{ color: t.white }}>{verb}</strong> {rest}.</span>
              </div>
            ))}
          </div>
        </div>

        {/* Safety note */}
        <div style={{
          background: `${t.green}0e`, border: `1px solid ${t.green}44`, borderRadius: 10,
          padding: "10px 14px", marginBottom: 18, fontSize: 12, color: t.textMuted, lineHeight: 1.6,
        }}>
          <strong style={{ color: t.green }}>Your main wallet stays untouchable.</strong> Only the 0.1 NEAR
          in the sub-account is ever at risk — the agent can't transfer from your main wallet or sign anything
          on its behalf. You can export the backup key from the agent dashboard once linked.
        </div>

        {stage === "error" && (
          <div style={{
            background: `${t.red}14`, border: `1px solid ${t.red}44`, borderRadius: 8,
            padding: "10px 12px", marginBottom: 16, fontSize: 12, color: t.red, wordBreak: "break-word",
          }}>
            {error}
          </div>
        )}

        {stage === "done" && (
          <div style={{
            background: `${t.green}14`, border: `1px solid ${t.green}44`, borderRadius: 8,
            padding: "10px 12px", marginBottom: 16, fontSize: 12, color: t.green, lineHeight: 1.55,
          }}>
            Linked. <strong>{result?.subAccountId}</strong> is live and tied to your agent profile.
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>
            {stage === "done" ? "Close" : "Cancel"}
          </Btn>
          {stage !== "done" && (
            <Btn primary onClick={handleLink}
              disabled={stage === "signing"}
              style={{ flex: 1, justifyContent: "center" }}>
              {stage === "signing" ? "Signing…" : <><Bot size={13} /> Link &amp; Sign</>}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── EarnPage hero (title + CTAs) ────────────────────────────────────────────
// The agent profile card and decorative mascot previously embedded here have
// moved: agent-profile UI lives at /agents/me (My Agent in the sidebar) and
// /agent (IronClaw). Telegram + X in-app WebViews were OOMing on the hero's
// extra image + nested card subtree, so Earn now stays focused on missions.
function EarnHero({ t, onScrollToMissions }) {
  const violet = "#a855f7";
  return (
    <div style={{
      position: "relative", overflow: "hidden", borderRadius: 20,
      background: `radial-gradient(ellipse at 65% 50%, ${violet}24 0%, transparent 60%), linear-gradient(135deg, ${t.bgCard} 0%, ${t.bgSurface} 100%)`,
      border: `1px solid ${t.border}`, marginBottom: 24,
      padding: "36px 36px 32px",
    }}>
      <Badge color={t.green}>EARN &amp; COMPETE</Badge>
      <h1 style={{
        fontSize: "clamp(26px, 3.2vw, 36px)", lineHeight: 1.12,
        fontWeight: 800, color: t.white, marginTop: 12, marginBottom: 10,
        letterSpacing: -0.4,
      }}>
        Earn Points. Shape{" "}
        <span style={{
          background: `linear-gradient(90deg, ${violet}, ${t.accent})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}>
          IronClaw.
        </span>
      </h1>
      <p style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.65, marginBottom: 20, maxWidth: 680 }}>
        Complete missions, create content, help the community. IronClaw judges your work and allocates
        points from the <strong style={{ color: t.green }}>22,000,000 pt</strong> pool over 7 weeks.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={onScrollToMissions}
          style={{
            background: `linear-gradient(135deg, ${violet}, ${t.accent})`,
            border: "none", borderRadius: 10, padding: "12px 20px",
            fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 8,
            boxShadow: `0 8px 22px ${violet}44`,
          }}
        >
          Explore Missions <ArrowRight size={14} />
        </button>
        <a
          href="/agents/me"
          style={{
            background: `${violet}18`, border: `1px solid ${violet}66`, borderRadius: 10,
            padding: "12px 18px", fontSize: 13, fontWeight: 700, color: violet,
            textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8,
          }}
        >
          <Bot size={13} /> My Agent
        </a>
        <a
          href="/docs"
          style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
            padding: "12px 18px", fontSize: 13, fontWeight: 600, color: t.text,
            textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8,
          }}
        >
          <Play size={13} /> How It Works
        </a>
      </div>
    </div>
  );
}

function agentCardShell(t, violet) {
  return {
    background: t.bgCard,
    border: `1px solid ${violet}44`,
    borderRadius: 14,
    padding: "16px 18px",
    boxShadow: `0 0 0 1px ${violet}1a, 0 20px 40px rgba(0,0,0,0.35)`,
  };
}

// ─── Right rail (streak / breakdown / contributors / boost) ────────────────
function EarnRightRail({ t, connected, userPoints, userRank, leaderboard, address, weekCountdown }) {
  const violet = "#a855f7";

  // Fake-but-plausible streak pattern: active for the last N weekdays based on
  // a per-address seed so the UI is stable across renders. Swapped for real
  // on-chain claim data when the activity indexer ships.
  const streak = useMemo(() => {
    const days = ["M","T","W","T","F","S","S"];
    if (!connected) return days.map((d) => ({ d, active: false }));
    // Deterministic pseudo-randomness from address so everyone sees a
    // consistent streak for themselves without needing persistence.
    const seed = [...(address || "anon")].reduce((a, c) => a + c.charCodeAt(0), 0);
    return days.map((d, i) => ({ d, active: (seed + i) % 3 !== 0 }));
  }, [address, connected]);
  const activeDays = streak.filter((s) => s.active).length;

  // Points breakdown — proportional allocation from the user's current total
  // across the task categories, until the indexer starts attributing awards.
  const breakdown = useMemo(() => {
    const total = connected ? userPoints : 0;
    if (!total) {
      return [
        { label: "Content Creation",  value: 0 },
        { label: "News Reporting",    value: 0 },
        { label: "Community",         value: 0 },
        { label: "Other Activities",  value: 0 },
      ];
    }
    return [
      { label: "Content Creation",  value: Math.round(total * 0.4) },
      { label: "News Reporting",    value: Math.round(total * 0.27) },
      { label: "Community",         value: Math.round(total * 0.2) },
      { label: "Other Activities",  value: Math.max(0, total - Math.round(total * 0.4) - Math.round(total * 0.27) - Math.round(total * 0.2)) },
    ];
  }, [connected, userPoints]);

  const topContributors = useMemo(() => leaderboard.slice(0, 5), [leaderboard]);
  const you = leaderboard.find((r) => r.addr === address);

  return (
    <>
      {/* YOUR STREAK */}
      <div style={railCard(t)}>
        <div style={railHeader(t)}>
          <Flame size={13} color={t.amber} />
          <span>Your Streak</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: t.white }}>{activeDays}</span>
          <span style={{ fontSize: 12, color: t.textMuted }}>days active</span>
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
          {streak.map(({ d, active }, i) => (
            <div key={i} style={{
              flex: 1, textAlign: "center",
            }}>
              <div style={{
                width: "100%", aspectRatio: "1 / 1",
                background: active ? `${t.green}28` : t.bgSurface,
                border: `1px solid ${active ? t.green + "88" : t.border}`,
                borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                color: active ? t.green : t.textDim,
              }}>
                {active ? <Check size={12} /> : <span style={{ fontSize: 10 }}>·</span>}
              </div>
              <div style={{ fontSize: 9, color: t.textDim, marginTop: 4, fontWeight: 700 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* POINTS BREAKDOWN */}
      <div style={railCard(t)}>
        <div style={railHeader(t)}>
          <PieChart size={13} color={t.accent} />
          <span>Points Breakdown</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {breakdown.map((row) => (
            <div key={row.label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
              fontSize: 12, color: t.textMuted,
            }}>
              <span>{row.label}</span>
              <span style={{ color: t.white, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {fmt(row.value)}
              </span>
            </div>
          ))}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
            fontSize: 13, color: t.white, fontWeight: 800,
            borderTop: `1px solid ${t.border}`, paddingTop: 10, marginTop: 4,
          }}>
            <span>Total</span>
            <span style={{ color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>
              {fmt(connected ? userPoints : 0)}
            </span>
          </div>
        </div>
      </div>

      {/* TOP CONTRIBUTORS */}
      <div style={railCard(t)}>
        <div style={{ ...railHeader(t), justifyContent: "space-between" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Trophy size={13} color={t.green} />
            Top Contributors
          </span>
          <span style={{ fontSize: 10, color: t.accent, cursor: "pointer" }}>View all</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {topContributors.length === 0 ? (
            <div style={{ fontSize: 12, color: t.textDim, textAlign: "center", padding: "20px 0" }}>
              No entries yet — be the first.
            </div>
          ) : topContributors.map((row) => (
            <div key={row.addr} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "6px 8px", borderRadius: 8,
              background: row.addr === address ? `${violet}14` : "transparent",
              border: row.addr === address ? `1px solid ${violet}44` : "1px solid transparent",
            }}>
              <span style={{ fontSize: 11, color: t.textDim, width: 14, fontWeight: 700 }}>
                {row.rank}
              </span>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                background: `${t.accent}18`, color: t.accent,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>
                {(row.handle || row.addr)?.[0]?.toUpperCase() || "?"}
              </div>
              <span style={{ fontSize: 11, color: t.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.handle ? `@${row.handle}` : truncAddr(row.addr)}
              </span>
              <span style={{ fontSize: 11, color: t.green, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {fmt(row.total)}
              </span>
            </div>
          ))}
          {connected && you && !topContributors.some((r) => r.addr === address) && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "6px 8px", borderRadius: 8,
              background: `${violet}14`, border: `1px solid ${violet}44`, marginTop: 4,
            }}>
              <span style={{ fontSize: 11, color: violet, width: 14, fontWeight: 700 }}>{you.rank}</span>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                background: `${violet}22`, color: violet,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, flexShrink: 0,
              }}>
                {(you.handle || you.addr)?.[0]?.toUpperCase() || "?"}
              </div>
              <span style={{ fontSize: 11, color: violet, flex: 1, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                You
              </span>
              <span style={{ fontSize: 11, color: violet, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {fmt(you.total)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* BOOST CARD */}
      <div style={{
        ...railCard(t),
        background: `linear-gradient(135deg, ${violet}22, ${t.accent}14)`,
        border: `1px solid ${violet}55`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Crown size={14} color={violet} />
          <span style={{ fontSize: 13, fontWeight: 800, color: t.white }}>Boost Your Earnings</span>
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.55, marginBottom: 12 }}>
          Stake $IRONCLAW to unlock 2× points on missions and exclusive tasks.
        </div>
        <a href="/staking" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
          width: "100%",
          background: `linear-gradient(135deg, ${violet}, ${t.accent})`,
          border: "none", borderRadius: 10, padding: "10px 14px",
          fontSize: 12, fontWeight: 700, color: "#fff", textDecoration: "none",
        }}>
          Stake now <ArrowRight size={12} />
        </a>
      </div>
    </>
  );
}

function railCard(t) {
  return {
    background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
    padding: "16px 18px",
  };
}
function railHeader(t) {
  return {
    fontSize: 11, fontWeight: 800, color: t.textMuted,
    letterSpacing: 0.6, textTransform: "uppercase",
    display: "flex", alignItems: "center", gap: 6, marginBottom: 12,
  };
}

// ─── Stat tile (new design) ──────────────────────────────────────────────────
function EarnStatTile({ t, icon: Icon, label, value, unit, footer, accent, blurValue, valueMono }) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: "18px 20px", position: "relative", overflow: "hidden",
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontSize: 10.5, color: t.textMuted, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase" }}>
          {label}
        </div>
        {Icon && (
          <div style={{
            background: `${accent}1a`, borderRadius: 8, width: 28, height: 28,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon size={13} color={accent} />
          </div>
        )}
      </div>
      <div style={{
        display: "flex", alignItems: "baseline", gap: 6,
        filter: blurValue ? "blur(6px)" : "none",
      }}>
        <span style={{
          fontSize: 24, fontWeight: 800, color: t.white,
          fontFamily: valueMono ? "'JetBrains Mono', monospace" : "inherit",
          letterSpacing: -0.3,
        }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 12, color: t.textDim, fontWeight: 600 }}>{unit}</span>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: t.textMuted, minHeight: 16 }}>
        {footer}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EarnPage({ openWallet }) {
  const t                                        = useTheme();
  const { connected, address }                   = useWallet();
  const { proposals, loading: proposalsLoading } = useProposals();
  // Agent profile + handle registration now live at /agents/me and /agent
  // — Earn only needs `agentProfile` to decide whether to expose "Assign
  // to agent" on each mission card, plus the on-chain leaderboard view and
  // the assignTask call that the assign modal uses.
  const {
    profile: agentProfile,
    leaderboard: chainLeaderboard,
    fetchLeaderboard,
    assignTask,
  } = useAgent();

  const [activeTab, setActiveTab]     = useState(isProgramLive() ? "missions" : "daily");
  const [submitting, setSubmitting]   = useState(null); // task object
  const [searchQ, setSearchQ]         = useState("");
  const [submitted, setSubmitted]     = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [weekProgress, setWeekProgress] = useState({ pct: 0, countdown: "…" });
  const [currentWeek, setCurrentWeek]   = useState(() => getCurrentWeek());
  const [assigningTask, setAssigningTask]     = useState(null); // task object or null

  // Track narrow viewport so we can SKIP the heavy right-rail subtree + agent
  // mascot + sparkline SVGs instead of just CSS-hiding them. The in-app WebView
  // in Telegram + X was running out of memory on the full DOM tree; React still
  // instantiates components even when `display: none`. SSR renders the desktop
  // layout (no mismatch); client flips on mount via the effect below.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => setIsNarrow(window.innerWidth < 780);
    check();
    window.addEventListener("resize", check, { passive: true });
    return () => window.removeEventListener("resize", check);
  }, []);

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
      points: c.points || c.reward || "200600",
      category: c.type || "Content",
    }));
    return [...agentTasks, ...baseConverted];
  }, [agentTasks]);

  // Pull the on-chain leaderboard once on mount, but DEFER to browser idle so
  // the near-api-js import doesn't compete with first paint. On mobile WebView
  // the eager fetch-on-mount was contributing to the renderer OOM; ProposalsProvider
  // already uses this pattern.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 600));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const handle = ric(() => {
      fetchLeaderboard({ limit: 50 }).catch(() => {});
    }, { timeout: 3000 });
    return () => { try { cancel(handle); } catch {} };
  }, [fetchLeaderboard]);

  // Merge on-chain rows first, top-up with memoryStore demo rows so the UI
  // doesn't feel empty before the first wave of users register. Each row gets
  // the rank/badge shape the existing podium + table already render.
  useEffect(() => {
    const chainRows = (chainLeaderboard || []).map((p) => ({
      addr:   p.owner,
      handle: p.handle,
      total:  Number(BigInt(p.points || 0)),
      weekly: 0, // per-week points are off-chain for now; Slice 2 adds a weekly bucket
      onChain: true,
    }));
    const haveOnChain = new Set(chainRows.map((r) => r.addr));
    const demoRows = (memoryStore.scores || [])
      .filter((s) => !haveOnChain.has(s.wallet))
      .map((s) => ({
        addr:   s.wallet,
        handle: null,
        total:  s.points,
        weekly: Math.round(s.points * 0.3 + Math.random() * 200),
        onChain: false,
      }));

    const merged = [...chainRows, ...demoRows]
      .sort((a, b) => b.total - a.total)
      .map((row, i) => ({
        ...row,
        rank:  i + 1,
        badge: i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null,
      }));
    setLeaderboard(merged);
  }, [chainLeaderboard]);

  useEffect(() => {
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
  // Prefer the authoritative on-chain profile balance; fall back to the demo
  // leaderboard entry only when the user hasn't registered an agent yet.
  const userPoints   = agentProfile?.points != null
    ? Number(BigInt(agentProfile.points))
    : (userRankData?.total ?? 0);
  const userRank     = userRankData?.rank ?? null;

  const live = isProgramLive();

  const TABS = [
    ...(live ? [{ key: "missions", label: "Missions", icon: <Star size={13} /> }] : []),
    { key: "daily",       label: "Daily Rituals",      icon: <Sun size={13} /> },
    ...(live ? [{ key: "leaderboard", label: "Leaderboard", icon: <Trophy size={13} /> }] : []),
    ...(live ? [{ key: "submissions", label: `My Submissions (${submitted.length})`, icon: <CheckCircle size={13} /> }] : []),
  ];

  return (
    <>
    <Section style={{ paddingTop: 100 }}>

      {/* ── Hero (missions-focused; agent UI has moved to /agents/me) ─────── */}
      <EarnHero
        t={t}
        onScrollToMissions={() => {
          setActiveTab(live ? "missions" : "daily");
          if (typeof window !== "undefined") {
            setTimeout(() => document.querySelector('[data-earn-tabs]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
          }
        }}
      />


      {/* ── Pre-launch countdown banner ─────────────────────────────────────── */}
      {!live && (() => {
        const msLeft = PROGRAM_START - Date.now();
        const d = Math.floor(msLeft / 86400000);
        const h = Math.floor((msLeft % 86400000) / 3600000);
        return (
          <div style={{
            background: `linear-gradient(135deg, ${t.accent}18, ${t.amber}18)`,
            border: `1px solid ${t.amber}44`, borderRadius: 14,
            padding: "20px 24px", marginBottom: 28, textAlign: "center",
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.amber, marginBottom: 6 }}>
              Points Season Starts Sunday, April 20
            </div>
            <div style={{ fontSize: 14, color: t.textMuted }}>
              Launches in <strong style={{ color: t.white }}>{d}d {h}h</strong>: Daily rituals are live now. Missions + leaderboard activate at launch.
            </div>
          </div>
        );
      })()}

      {/* ── Stats bar ────────────────────────────────────────────────────────── */}
      {(() => {
        const total      = leaderboard.length || 1;
        const percentile = userRank ? Math.max(0.1, (userRank / total) * 100) : null;
        const pctLabel   = percentile != null ? `Top ${percentile < 1 ? percentile.toFixed(1) : Math.ceil(percentile)}%` : "—";
        return (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 14, marginBottom: 24,
          }}>
            <EarnStatTile t={t} label="Total Points Pool" value="22,000,000" unit="pts"
              icon={Award} accent={t.accent} footer={`${WEEKS_TOTAL} week campaign`} />
            <EarnStatTile t={t} label="Your Points" value={connected ? fmt(userPoints) : "—"} unit="pts"
              icon={Star} accent={t.green} blurValue={!connected}
              footer={connected ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: t.green, fontWeight: 700 }}>live from on-chain</span>
                </span>
              ) : "Connect to track"} />
            <EarnStatTile t={t} label="Your Rank" value={connected && userRank ? `#${userRank}` : "—"} unit=""
              icon={Trophy} accent={t.amber} blurValue={!connected}
              footer={connected && userRank ? pctLabel : "Connect to rank"} />
            <EarnStatTile t={t} label="Next Distribution" value={weekProgress.countdown || "…"} unit=""
              icon={Clock} accent={t.accent}
              footer="Sat 9 PM UTC" valueMono />
          </div>
        );
      })()}

      {/* ── Week progress bar ─────────────────────────────────────────────────── */}
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
        padding: "18px 22px", marginBottom: 28,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Calendar size={15} color={t.accent} />
            <span style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
              {live ? `Week ${currentWeek} of ${WEEKS_TOTAL}` : "Pre-Season"}
            </span>
            <Badge color={live ? t.accent : t.amber}>{live ? "Active" : "Starts Apr 20"}</Badge>
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

      {/* ── Main 2-col grid: tabs + content on left, insights rail on right ── */}
      <div className="earn-body-grid" style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 300px",
        gap: 24, alignItems: "flex-start",
      }}>
        <div style={{ minWidth: 0 }}>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div data-earn-tabs style={{
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
                <MissionCard key={task.id} task={task} t={t} onSubmit={handleOpenSubmit} onAssignToAgent={setAssigningTask} hasAgent={Boolean(agentProfile)} connected={connected} openWallet={openWallet} />
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
                <MissionCard key={task.id} task={task} t={t} onSubmit={handleOpenSubmit} onAssignToAgent={setAssigningTask} hasAgent={Boolean(agentProfile)} connected={connected} openWallet={openWallet} />
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
                {/* Cap to 6 cards on narrow viewports so in-app WebViews don't
                    OOM trying to render all 15+ live agent tasks at once. A
                    "Show more" link reveals the rest only when the user asks. */}
                {filteredMissions.slice(0, isNarrow ? 6 : filteredMissions.length).map(task => (
                  <MissionCard key={task.id} task={task} t={t} onSubmit={handleOpenSubmit} onAssignToAgent={setAssigningTask} hasAgent={Boolean(agentProfile)} connected={connected} openWallet={openWallet} />
                ))}
                {isNarrow && filteredMissions.length > 6 && (
                  <div style={{ textAlign: "center", padding: "10px 0" }}>
                    <span style={{ fontSize: 12, color: t.textMuted }}>
                      {filteredMissions.length - 6} more tasks hidden — open on desktop for full view.
                    </span>
                  </div>
                )}
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
                ["2", "Submit proof: a link, screenshot, or text", t.green],
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
                      {row.handle ? `@${row.handle}` : truncAddr(row.addr)}
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
                            {(row.handle || row.addr)?.[0]?.toUpperCase() || "?"}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                            <span style={{ fontSize: 13, color: t.text }}>
                              {row.handle ? `@${row.handle}` : truncAddr(row.addr)}
                            </span>
                            {row.handle && (
                              <span style={{ fontSize: 10, color: t.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
                                {truncAddr(row.addr)}
                              </span>
                            )}
                          </div>
                          {row.onChain && (
                            <span title="On-chain agent" style={{ fontSize: 10, color: t.green, marginLeft: 2 }}>●</span>
                          )}
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

        </div>
        {/* Right rail — skipped entirely on narrow viewports to keep the
            in-app WebView OOM-safe. Earlier this was just CSS-hidden but React
            still instantiated ~200 nodes + 60 SVGs underneath. */}
        {!isNarrow && (
          <div className="earn-right-rail" style={{ minWidth: 0, position: "sticky", top: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <EarnRightRail
              t={t}
              connected={connected}
              userPoints={userPoints}
              userRank={userRank}
              leaderboard={leaderboard}
              address={address}
              weekCountdown={weekProgress.countdown}
            />
          </div>
        )}
      </div>

      <style jsx>{`
        @media (max-width: 980px) {
          .earn-body-grid {
            grid-template-columns: 1fr !important;
          }
          .earn-right-rail {
            position: static !important;
          }
        }
      `}</style>

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

    {/* ── Assign-task modal ────────────────────────────────────────────────── */}
    {assigningTask && (
      <AssignTaskModal
        t={t}
        task={assigningTask}
        onClose={() => setAssigningTask(null)}
        assignTask={assignTask}
      />
    )}

    {/* ── Revenue streams ──────────────────────────────────────────────────── */}
    <RevenueStreams />

    {/* ── How users earn ───────────────────────────────────────────────────── */}
    <HowUsersEarn />
    </>
  );
}
