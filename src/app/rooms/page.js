"use client";
// Live Alpha Rooms — /rooms
//
// Public, shareable grid of currently-live rooms. Visitors can browse without
// connecting a wallet; opening a room or creating one prompts wallet connect.
// Static-export friendly (no dynamic segments — room interior lives at
// /rooms/[id] which uses query-string fallback when needed).

import { useEffect, useMemo, useState } from "react";
import {
  Mic, MicOff, Radio, Lock, Users, ShieldAlert, Plus, ArrowLeft, X,
  Loader2, Coins, Clock, Mail, ShieldCheck, Rocket, AudioLines,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import {
  callOpenRoom, IRONCLAW_SYMBOL, IRONCLAW_PRICE_USD, formatIronclawCompact,
} from "@/lib/ironclaw";
import AppShell from "@/components/shell/AppShell";
import { API_BASE as API } from "@/lib/apiBase";
const MIN_STAKE_USD = 50;

const ACCESS_OPTIONS = [
  { value: "open",         label: "Open",         hint: "Anyone can listen, anyone can speak." },
  { value: "token_gated",  label: "Token-gated",  hint: "Holders auto-promoted to speakers." },
  { value: "invite_only",  label: "Invite-only",  hint: "Only allowlisted wallets can join." },
];

const ACCESS_BADGE = {
  open:        { color: "#22c55e", icon: Radio, label: "Open" },
  token_gated: { color: "#f5b301", icon: Coins, label: "Token-gated" },
  invite_only: { color: "#a855f7", icon: Lock,  label: "Invite-only" },
};

function botColor(score) {
  if (score >= 70) return "#ef4444";
  if (score >= 40) return "#f59e0b";
  return "#22c55e";
}

function shortWallet(w = "") {
  return w.length > 18 ? `${w.slice(0, 8)}…${w.slice(-6)}` : w;
}

function timeLeft(endsAt) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "ending";
  const m = Math.floor(ms / 60_000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

export default function RoomsPage() {
  const t = useTheme();
  const { connected, address: wallet, selector, showModal: openWallet } = useWallet();

  const [rooms, setRooms]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [filter, setFilter]     = useState("all");
  const [openModal, setOpenModal] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const url = filter === "all"
        ? `${API}/api/rooms`
        : `${API}/api/rooms?access=${filter}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`rooms ${r.status}`);
      const j = await r.json();
      setRooms(j.rooms || []);
    } catch (e) {
      setError(e?.message || "Couldn't load rooms");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);
  useEffect(() => {
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [filter]); // eslint-disable-line

  return (
    <AppShell>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 18px 60px" }}>
        {/* Top action — kept local so the rooms page owns the "Open
            Room" CTA without stuffing it into AppShell. The legacy
            standalone top-bar is gone; AppShell now carries logo /
            nav / wallet chip. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => connected ? setOpenModal(true) : openWallet()}
            style={{ ...primaryBtn(t), display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Plus size={14} /> Open Room
          </button>
        </div>
        {/* Hero */}
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ color: t.white, fontSize: 26, fontWeight: 800, margin: "0 0 4px",
            display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Radio size={22} color={t.amber} /> Live Alpha Rooms
          </h1>
          <p style={{ color: t.textMuted, fontSize: 14, margin: 0 }}>
            Hosted voice + chat. Hosts stake {IRONCLAW_SYMBOL} (min ${MIN_STAKE_USD}) — refunded if no rules are broken.
          </p>
        </div>

        {/* Filter chips */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { v: "all",         l: "All" },
            { v: "open",        l: "Open" },
            { v: "token_gated", l: "Token-gated" },
            { v: "invite_only", l: "Invite-only" },
          ].map(c => (
            <button key={c.v} onClick={() => setFilter(c.v)} style={{
              padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
              cursor: "pointer", border: `1px solid ${filter === c.v ? t.accent : t.border}`,
              background: filter === c.v ? `${t.accent}22` : t.bgSurface,
              color: filter === c.v ? t.accent : t.textMuted,
            }}>{c.l}</button>
          ))}
        </div>

        {/* Body */}
        {loading && (
          <div style={{ display: "grid", placeItems: "center", padding: 60, color: t.textMuted }}>
            <Loader2 size={20} className="ix-spin" />
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 24, borderRadius: 12, background: t.bgCard,
            border: `1px solid ${t.border}`, color: t.textMuted, textAlign: "center" }}>
            {error}
          </div>
        )}
        {!loading && !error && rooms.length === 0 && (
          <div style={{ padding: 40, borderRadius: 12, background: t.bgCard,
            border: `1px solid ${t.border}`, color: t.textMuted, textAlign: "center", fontSize: 14 }}>
            No live rooms yet. Be the first — click <strong style={{ color: t.text }}>Open Room</strong> above.
          </div>
        )}
        <div style={{
          display: "grid", gap: 14,
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        }}>
          {rooms.map(r => <RoomCard key={r.id} t={t} room={r} />)}
        </div>
      </div>

      {openModal && (
        <OpenRoomModal
          t={t}
          wallet={wallet}
          selector={selector}
          openWallet={openWallet}
          onClose={() => setOpenModal(false)}
          onCreated={() => { setOpenModal(false); load(); }}
        />
      )}

      <style>{`.ix-spin { animation: ixSpin 1s linear infinite; } @keyframes ixSpin { to { transform: rotate(360deg); } }`}</style>
    </AppShell>
  );
}

function RoomCard({ t, room }) {
  const access = ACCESS_BADGE[room.accessType] || ACCESS_BADGE.open;
  const AccessIcon = access.icon;
  const bot = room.counts.botThreat;
  const pulseColor = "#ef4444";

  return (
    <a href={`/rooms/view/?id=${room.id}`} style={{
      display: "block", padding: 14, borderRadius: 14, background: t.bgCard,
      border: `1px solid ${t.border}`, textDecoration: "none", color: t.text,
      transition: "transform .12s, border-color .12s",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; }}>
      {/* Top row: live + access + bot */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800,
          color: pulseColor, padding: "2px 6px", borderRadius: 6,
          background: `${pulseColor}18`, border: `1px solid ${pulseColor}44`,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", background: pulseColor,
            boxShadow: `0 0 6px ${pulseColor}`, animation: "ixPulse 1.2s ease-in-out infinite",
          }} /> LIVE
        </span>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700,
          color: access.color, padding: "2px 6px", borderRadius: 6,
          background: `${access.color}18`, border: `1px solid ${access.color}44`,
        }}>
          <AccessIcon size={10} /> {access.label}
        </span>
        <div style={{ flex: 1 }} />
        {room.voiceEnabled
          ? <Mic size={13} color={t.textMuted} />
          : <MicOff size={13} color={t.textDim} />}
        <span title={`Bot threat ${bot}/100`} style={{
          display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700,
          color: botColor(bot),
        }}>
          <ShieldAlert size={11} /> {bot}
        </span>
      </div>

      {/* Title + topic */}
      <div style={{ color: t.white, fontSize: 15, fontWeight: 700, lineHeight: 1.3, marginBottom: 4,
        overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
        {room.title}
      </div>
      {room.topic && (
        <div style={{ color: t.textMuted, fontSize: 12, marginBottom: 10,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>
          {room.topic}
        </div>
      )}

      {/* Host */}
      {room.host && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {room.host.pfpUrl ? (
            <img src={room.host.pfpUrl} alt="" style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: 24, height: 24, borderRadius: "50%",
              background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
              display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 11 }}>
              {(room.host.displayName || room.host.username || "?")[0]?.toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: t.text, fontWeight: 600,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {room.host.displayName || room.host.username || shortWallet(room.host.wallet)}
            </div>
            <div style={{ fontSize: 10, color: t.textDim }}>host</div>
          </div>
        </div>
      )}

      {/* Footer: counts + stake + time */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 6, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: t.textMuted }}>
          <Users size={11} /> {room.counts.total}
          <span style={{ color: t.textDim }}>· {room.counts.speakers} 🎙</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: t.amber, fontWeight: 700 }}>
          <Coins size={11} /> ${Math.round(room.stake.amountUsd)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: t.textDim }}>
          <Clock size={11} /> {timeLeft(room.endsAt)}
        </span>
      </div>

      <style>{`@keyframes ixPulse { 0%,100% { opacity: 1 } 50% { opacity: .4 } }`}</style>
    </a>
  );
}

function OpenRoomModal({ t, wallet, selector, openWallet, onClose, onCreated }) {
  const [title, setTitle]               = useState("");
  const [topic, setTopic]               = useState("");
  const [accessType, setAccessType]     = useState("open");
  const [stakeAmount, setStakeAmount]   = useState(""); // human $IRONCLAW
  const [durationMins, setDurationMins] = useState(60);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [err, setErr]                   = useState("");

  // Min-stake derivation: $50 / $IRONCLAW price.
  const minHuman = useMemo(() => Math.ceil(MIN_STAKE_USD / IRONCLAW_PRICE_USD), []);
  const stakeUsd = useMemo(() => Number(stakeAmount || 0) * IRONCLAW_PRICE_USD, [stakeAmount]);
  const enoughStake = stakeUsd >= MIN_STAKE_USD;

  const submit = async () => {
    setErr("");
    if (!wallet) { openWallet(); return; }
    if (!title.trim()) { setErr("Title is required"); return; }
    if (!enoughStake) { setErr(`Stake must be ≥ $${MIN_STAKE_USD}`); return; }

    setSubmitting(true);
    try {
      const tx = await callOpenRoom({
        selector, accountId: wallet,
        title: title.trim(),
        topic: topic.trim(),
        stakeAmount: Number(stakeAmount),
        durationMins: Number(durationMins),
        accessType,
      });
      const r = await fetch(`${API}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({
          title: title.trim(),
          topic: topic.trim(),
          accessType,
          stakeAmountHuman: Number(stakeAmount),
          stakeAmountUsd: stakeUsd,
          stakeTokenContract: "ironclaw.near",
          stakeTokenSymbol: "IRONCLAW",
          stakeTokenDecimals: 18,
          durationMins: Number(durationMins),
          voiceEnabled,
          recordingEnabled,
          stakeTxHash: tx?.txHash || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `create ${r.status}`);
      }
      const j = await r.json();
      onCreated?.(j.room);
      // Hop into the new room.
      if (typeof window !== "undefined") window.location.href = `/rooms/view/?id=${j.room.id}`;
    } catch (e) {
      setErr(e?.message || "Failed to open room");
    } finally {
      setSubmitting(false);
    }
  };

  const accessIcon = { open: Users, token_gated: Lock, invite_only: Mail };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", backdropFilter: "blur(8px)",
      display: "grid", placeItems: "center", zIndex: 100, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto",
        background: `linear-gradient(180deg, ${t.bgCard}, rgba(8,11,18,0.98))`,
        borderRadius: 18,
        border: `1px solid rgba(168,85,247,0.32)`,
        padding: 24,
        boxShadow: "0 0 0 1px rgba(168,85,247,0.18) inset, 0 30px 80px rgba(0,0,0,0.55)",
      }}>
        {/* Header — circular accent icon + title + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <span style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: "rgba(168,85,247,0.16)",
            border: "1px solid rgba(168,85,247,0.36)",
            color: "#c4b8ff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 24px rgba(168,85,247,0.25)",
          }}>
            <Radio size={22} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ color: t.white, fontSize: 20, margin: 0, fontWeight: 800, letterSpacing: -0.3 }}>
              Open a Live Room
            </h2>
            <div style={{ color: t.textMuted, fontSize: 13, marginTop: 3 }}>
              Start a real-time voice conversation with the community.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 32, height: 32, borderRadius: 10,
            background: t.bgSurface, border: `1px solid ${t.border}`,
            color: t.textMuted, cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <X size={16} />
          </button>
        </div>

        <Field t={t} label="Title" count={title.length} max={80}>
          <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))}
            placeholder="What's the alpha?"
            style={inputStyle(t)} />
        </Field>

        <Field t={t} label="Topic / tag (optional)" count={topic.length} max={60}>
          <input value={topic} onChange={e => setTopic(e.target.value.slice(0, 60))}
            placeholder="e.g. NEAR DeFi, memecoins, RWAs"
            style={inputStyle(t)} />
        </Field>

        <Field t={t} label="Access">
          <div style={{ display: "grid", gap: 8 }}>
            {ACCESS_OPTIONS.map(o => {
              const active = accessType === o.value;
              const Icon = accessIcon[o.value] || Users;
              return (
                <label key={o.value} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                  borderRadius: 12, cursor: "pointer",
                  background: active ? "rgba(168,85,247,0.10)" : t.bgSurface,
                  border: `1.5px solid ${active ? "rgba(168,85,247,0.55)" : t.border}`,
                  boxShadow: active ? "0 0 0 1px rgba(168,85,247,0.18) inset" : "none",
                  transition: "border-color 120ms ease, background 120ms ease",
                }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${active ? "#a855f7" : t.border}`,
                    background: active ? "transparent" : t.bg,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {active && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#a855f7" }} />}
                  </span>
                  <input type="radio" name="access" value={o.value}
                    checked={active} onChange={() => setAccessType(o.value)}
                    style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: t.white, fontSize: 14, fontWeight: 700 }}>{o.label}</div>
                    <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>{o.hint}</div>
                  </div>
                  <span style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: active ? "rgba(168,85,247,0.16)" : t.bg,
                    color: active ? "#c4b8ff" : t.textMuted,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon size={16} />
                  </span>
                </label>
              );
            })}
          </div>
        </Field>

        <Field t={t} label={`Stake (${IRONCLAW_SYMBOL}) — min ${formatIronclawCompact(minHuman)} ≈ $${MIN_STAKE_USD}`}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "4px 6px 4px 14px", borderRadius: 12,
            background: t.bgSurface,
            border: `1px solid ${stakeAmount && !enoughStake ? "#ef4444" : t.border}`,
          }}>
            <input value={stakeAmount} onChange={e => setStakeAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={String(minHuman)}
              style={{
                flex: 1, padding: "10px 0",
                background: "transparent", border: "none", color: t.white,
                fontSize: 14, outline: "none",
                fontFamily: "var(--font-jetbrains-mono), monospace",
              }} />
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 10px", borderRadius: 8,
              background: t.bg, border: `1px solid ${t.border}`,
              fontSize: 12, fontWeight: 800, color: "#c4b8ff",
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%",
                background: "linear-gradient(135deg, #a855f7, #60a5fa)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 10, fontWeight: 800,
              }}>$</span>
              {IRONCLAW_SYMBOL}
            </span>
            <span style={{ color: t.textDim, fontSize: 12, fontWeight: 600, paddingRight: 10 }}>
              ≈ ${stakeUsd.toFixed(2)}
            </span>
          </div>
        </Field>

        <Field t={t} label="Duration">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {[30, 60, 90, 120].map(m => {
              const active = durationMins === m;
              return (
                <button key={m} onClick={() => setDurationMins(m)} style={{
                  padding: "10px 10px", borderRadius: 10,
                  fontSize: 13, fontWeight: 700, cursor: "pointer",
                  border: `1.5px solid ${active ? "rgba(168,85,247,0.55)" : t.border}`,
                  background: active ? "rgba(168,85,247,0.12)" : t.bgSurface,
                  color: active ? "#fff" : t.textMuted,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                  transition: "all 120ms ease",
                }}>
                  <Clock size={12} /> {m}m
                </button>
              );
            })}
          </div>
        </Field>

        <label style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
          borderRadius: 10, marginBottom: 8,
          background: t.bgSurface, border: `1px solid ${t.border}`,
          color: t.text, fontSize: 13, cursor: "pointer",
        }}>
          <input type="checkbox" checked={voiceEnabled} onChange={e => setVoiceEnabled(e.target.checked)}
            style={{ accentColor: "#a855f7", width: 16, height: 16 }} />
          <span style={{ flex: 1 }}>Enable voice (LiveKit). Disable for text-only rooms.</span>
          <AudioLines size={16} color={voiceEnabled ? "#a855f7" : t.textDim} />
        </label>

        <label style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
          borderRadius: 10, marginBottom: 14,
          background: t.bgSurface, border: `1px solid ${t.border}`,
          color: t.text, fontSize: 13, cursor: "pointer",
        }}>
          <input type="checkbox" checked={recordingEnabled} onChange={e => setRecordingEnabled(e.target.checked)}
            style={{ accentColor: "#a855f7", width: 16, height: 16 }} />
          <span style={{ flex: 1 }}>Record this room and publish a replay summary post to my profile when room closes.</span>
          <Radio size={16} color={recordingEnabled ? "#a855f7" : t.textDim} />
        </label>

        {/* Trust footer — three pillars */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
          padding: "12px 14px", borderRadius: 12,
          background: "rgba(168,85,247,0.06)",
          border: "1px solid rgba(168,85,247,0.20)",
          marginBottom: 14,
        }}>
          <TrustCell Icon={ShieldCheck}  title="Secure & On-chain" body="All rooms are secured through smart contracts." t={t} />
          <TrustCell Icon={Users}        title="Community First"   body="High signal conversations. Zero spam."  t={t} />
          <TrustCell Icon={Radio}        title="Built on NEAR"     body="Fast, secure and non-custodial."         t={t} />
        </div>

        {err && (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "#ef444418",
            border: "1px solid #ef444444", color: "#fca5a5", fontSize: 12, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <button onClick={submit} disabled={submitting} style={{
          width: "100%", padding: "14px 18px", borderRadius: 12, fontSize: 15, fontWeight: 800,
          background: submitting ? t.bgSurface : "linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f59e0b 100%)",
          color: "#fff", border: "none", letterSpacing: 0.2,
          cursor: submitting ? "default" : "pointer", opacity: submitting ? .7 : 1,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
          boxShadow: submitting ? "none" : "0 14px 36px rgba(168,85,247,0.36)",
        }}>
          {submitting
            ? <><Loader2 size={16} className="ix-spin" /> Opening room…</>
            : <>Stake &amp; open room <Rocket size={16} /></>}
        </button>

        <div style={{ textAlign: "center", marginTop: 12, fontSize: 11.5, color: t.textDim }}>
          By continuing, you agree to the IronShield <a href="/docs" style={{ color: "#a855f7" }}>Terms of Service</a>.
        </div>
      </div>
    </div>
  );
}

function TrustCell({ Icon, title, body, t }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Icon size={13} color="#c4b8ff" />
        <span style={{ fontSize: 11.5, fontWeight: 800, color: t.white }}>{title}</span>
      </div>
      <div style={{ fontSize: 10.5, color: t.textMuted, lineHeight: 1.4 }}>{body}</div>
    </div>
  );
}

function Field({ t, label, count, max, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 8,
      }}>
        <span style={{ color: t.textDim, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: .8 }}>
          {label}
        </span>
        {typeof count === "number" && typeof max === "number" && (
          <span style={{
            fontSize: 11, color: t.textDim,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}>{count}/{max}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function inputStyle(t) {
  return {
    width: "100%", padding: "10px 12px", borderRadius: 10,
    background: t.bgSurface, border: `1px solid ${t.border}`,
    color: t.text, fontSize: 13, outline: "none",
  };
}

function primaryBtn(t) {
  return {
    padding: "8px 14px", background: t.accent, color: "#fff",
    border: "none", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 700,
  };
}
