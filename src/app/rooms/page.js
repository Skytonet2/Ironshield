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
  Loader2, Coins, Clock,
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

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", backdropFilter: "blur(4px)",
      display: "grid", placeItems: "center", zIndex: 100, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 520, background: t.bgCard, borderRadius: 16,
        border: `1px solid ${t.border}`, padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Radio size={18} color={t.amber} />
          <h2 style={{ color: t.white, fontSize: 18, margin: 0, fontWeight: 800 }}>Open a Live Room</h2>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: t.textMuted, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <Field t={t} label="Title">
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
            placeholder="What's the alpha?"
            style={inputStyle(t)} />
        </Field>

        <Field t={t} label="Topic / tag (optional)">
          <input value={topic} onChange={e => setTopic(e.target.value)} maxLength={60}
            placeholder="e.g. NEAR DeFi, memecoins, RWAs"
            style={inputStyle(t)} />
        </Field>

        <Field t={t} label="Access">
          <div style={{ display: "grid", gap: 6 }}>
            {ACCESS_OPTIONS.map(o => (
              <label key={o.value} style={{
                display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px",
                borderRadius: 10, cursor: "pointer",
                background: accessType === o.value ? `${t.accent}14` : t.bgSurface,
                border: `1px solid ${accessType === o.value ? t.accent : t.border}`,
              }}>
                <input type="radio" name="access" value={o.value}
                  checked={accessType === o.value}
                  onChange={() => setAccessType(o.value)}
                  style={{ marginTop: 3 }} />
                <div>
                  <div style={{ color: t.text, fontSize: 13, fontWeight: 700 }}>{o.label}</div>
                  <div style={{ color: t.textMuted, fontSize: 11 }}>{o.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </Field>

        <Field t={t} label={`Stake (${IRONCLAW_SYMBOL}) — min ${formatIronclawCompact(minHuman)} ≈ $${MIN_STAKE_USD}`}>
          <div style={{ position: "relative" }}>
            <input value={stakeAmount} onChange={e => setStakeAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={String(minHuman)}
              style={{ ...inputStyle(t), borderColor: stakeAmount && !enoughStake ? "#ef4444" : t.border }} />
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              color: t.textDim, fontSize: 11 }}>
              ≈ ${stakeUsd.toFixed(2)}
            </span>
          </div>
        </Field>

        <Field t={t} label="Duration">
          <div style={{ display: "flex", gap: 6 }}>
            {[30, 60, 90, 120].map(m => (
              <button key={m} onClick={() => setDurationMins(m)} style={{
                flex: 1, padding: "8px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                cursor: "pointer", border: `1px solid ${durationMins === m ? t.accent : t.border}`,
                background: durationMins === m ? `${t.accent}22` : t.bgSurface,
                color: durationMins === m ? t.accent : t.text,
              }}>{m}m</button>
            ))}
          </div>
        </Field>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 14,
          color: t.text, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={voiceEnabled} onChange={e => setVoiceEnabled(e.target.checked)} />
          Enable voice (LiveKit). Disable for text-only rooms.
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, marginBottom: 14,
          color: t.text, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={recordingEnabled} onChange={e => setRecordingEnabled(e.target.checked)} />
          Record this space and publish a replay summary post to my profile when room closes.
        </label>

        {err && (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "#ef444418",
            border: "1px solid #ef444444", color: "#fca5a5", fontSize: 12, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <button onClick={submit} disabled={submitting} style={{
          width: "100%", padding: "12px 16px", borderRadius: 10, fontSize: 14, fontWeight: 800,
          background: t.amber, color: "#000", border: "none",
          cursor: submitting ? "default" : "pointer", opacity: submitting ? .7 : 1,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          {submitting ? <><Loader2 size={14} className="ix-spin" /> Opening room…</> : <>Stake & open room</>}
        </button>
      </div>
    </div>
  );
}

function Field({ t, label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: .4 }}>
        {label}
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
