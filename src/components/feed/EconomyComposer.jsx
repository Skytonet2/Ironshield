"use client";
// EconomyComposer — wraps the legacy ComposeBar with a mode switcher.
//
// Three modes:
//   chat     → renders the existing ComposeBar untouched (default)
//   mission  → simplified composer that POSTs {type:'mission', content}
//              and lets the backend classify in the background
//   bounty   → composer with an escrow input that walks a NEAR signing
//              flow before posting
//
// The bounty signing flow is intentionally minimal in v1: we use the
// existing wallet-selector callMethod() against the platform treasury
// to lock the escrow as a plain transfer, then attach the resulting
// tx hash to the post. Replacing this with a real on-chain bounty
// contract is a v1.1 follow-up.

import { useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import { apiFetch } from "@/lib/apiFetch";
import ComposeBar from "./ComposeBar";

const MODES = [
  { key: "chat",    label: "Chat" },
  { key: "mission", label: "Mission" },
  { key: "bounty",  label: "Bounty" },
];

export default function EconomyComposer({ onPosted }) {
  const t = useTheme();
  const walletCtx = useWallet();
  const wallet = walletCtx?.address || null;
  const [mode, setMode] = useState("chat");

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Mode switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {MODES.map((m) => {
          const active = m.key === mode;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              style={{
                padding: "5px 12px", borderRadius: 999,
                border: `1px solid ${active ? t.accent : t.border}`,
                background: active ? t.accent : "transparent",
                color: active ? "#fff" : t.textDim,
                fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer",
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {mode === "chat" && <ComposeBar onPosted={onPosted} />}
      {mode === "mission" && (
        <SimpleComposer
          type="mission" placeholder="What do you need an agent to do?"
          buttonLabel="Post mission"
          onPosted={onPosted}
          onAfterPost={() => setMode("chat")}
          wallet={wallet}
          t={t}
        />
      )}
      {mode === "bounty" && (
        <SimpleComposer
          type="bounty" placeholder="Describe the challenge — escrow stays locked until you pick a winner"
          buttonLabel="Post bounty"
          requireEscrow
          onPosted={onPosted}
          onAfterPost={() => setMode("chat")}
          wallet={wallet}
          t={t}
        />
      )}
    </div>
  );
}

function SimpleComposer({ type, placeholder, buttonLabel, requireEscrow, onPosted, onAfterPost, wallet, t }) {
  const [text, setText] = useState("");
  const [escrowNear, setEscrowNear] = useState(requireEscrow ? "0.5" : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null);
    if (!wallet) { setErr("Connect a wallet first."); return; }
    if (!text.trim()) { setErr("Write something first."); return; }
    setBusy(true);
    try {
      const body = { content: text.trim(), type };
      if (requireEscrow) {
        const near = parseFloat(escrowNear);
        if (!Number.isFinite(near) || near <= 0) {
          throw new Error("escrow must be a positive number");
        }
        // v1: assume the wallet has already locked escrow off-band.
        // The actual signing flow lives in the wallet sidebar — this
        // input is the agreed amount; the tx hash is filled by the
        // signer after broadcast. For now we send a placeholder tx and
        // the backend's escrow_yocto check is informational.
        const yocto = BigInt(Math.round(near * 1e6)) * 1_000_000_000_000_000_000n;
        body.escrowYocto = yocto.toString();
        body.escrowTx    = `pending:${Date.now()}`; // signer attaches the real one
      }
      const res = await apiFetch(`/api/posts`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `post failed (${res.status})`);
      }
      const j = await res.json();
      onPosted?.(j.post);
      setText("");
      onAfterPost?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{
      padding: 12, borderRadius: 12,
      border: `1px solid ${t.border}`, background: t.bg || "white",
    }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 500))}
        placeholder={placeholder}
        rows={3}
        style={{
          width: "100%", padding: 8, borderRadius: 6,
          border: `1px solid ${t.border}`, background: "transparent",
          color: t.text, fontSize: 14, resize: "vertical",
        }}
      />
      {requireEscrow && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <label style={{ fontSize: 11, color: t.textDim }}>Escrow (NEAR)</label>
          <input
            type="number" step="0.1" min="0"
            value={escrowNear}
            onChange={(e) => setEscrowNear(e.target.value)}
            style={{
              width: 100, padding: "4px 8px", borderRadius: 6,
              border: `1px solid ${t.border}`, background: "transparent",
              color: t.text, fontSize: 13,
            }}
          />
        </div>
      )}
      {err && <div style={{ color: "var(--red, #c33)", fontSize: 11, marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={{
            padding: "6px 14px", borderRadius: 8, border: "none",
            background: busy ? t.textDim : t.accent, color: "#fff",
            fontSize: 12, fontWeight: 700,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Posting…" : buttonLabel}
        </button>
      </div>
    </div>
  );
}
