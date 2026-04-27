"use client";
// SearchOverlay — `/`-triggered global search. Four result sections:
//
//   Users      (people on IronShield — match username OR wallet)
//   Tokens     (GeckoTerminal, scoped to active chain)
//   Settings   (fuzzy match over tab keys + labels)
//   Actions    (Quick Scan, Bridge, Create — route shortcuts)
//
// Keyboard: Arrow keys move selection, Enter activates, Escape closes.
// Input auto-focuses on mount. Debounce 220ms to avoid hammering the
// token search on every keystroke.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search as SearchIcon, Zap, ArrowLeftRight, Plus, Settings as SettingsIcon, CornerDownLeft, User as UserIcon, X as XIcon } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import { useSettings } from "@/lib/stores/settingsStore";
import { searchTokens } from "@/lib/api/geckoTerminal";
import { API_BASE as API } from "@/lib/apiBase";

const SETTINGS_INDEX = [
  { key: "appearance",   label: "Appearance",   href: "/settings#appearance" },
  { key: "security",     label: "Security",     href: "/settings#security" },
  { key: "wallets",      label: "Wallets",      href: "/settings#wallets" },
  { key: "trackers",     label: "Trackers",     href: "/settings#trackers" },
  { key: "notifications",label: "Notifications",href: "/settings#notifications" },
  { key: "keybinds",     label: "Keybinds",     href: "/settings#keybinds" },
  { key: "earnings",     label: "Earnings",     href: "/settings#earnings" },
];

const ACTIONS = [
  { key: "create",  label: "Create — launch a token",         action: "create", Icon: Plus },
  { key: "bridge",  label: "Bridge — NEAR Intents",           action: "bridge", Icon: ArrowLeftRight },
  { key: "scan",    label: "Scan — IronClaw security check",  action: "scan",   Icon: Zap },
  { key: "settings",label: "Open Settings",                   href: "/settings", Icon: SettingsIcon },
];

const DEBOUNCE_MS = 220;

export default function SearchOverlay({ open, onClose, onAction }) {
  const t = useTheme();
  const activeChain = useSettings((s) => s.activeChain);
  const [q, setQ] = useState("");
  const [tokens, setTokens] = useState([]);
  const [users, setUsers]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);

  // Build flat result list in one place so keyboard nav has a single
  // index to track. Order: Users → Actions → Settings → Tokens. Users
  // first because that's the most common reason people open this
  // overlay; empty query still shows Actions so the operator still has
  // common commands.
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filterText = (s) => !term || s.toLowerCase().includes(term);

    const userHits = users.map((u) => ({
      kind: "user",
      key:  `user:${u.wallet_address}`,
      // Show display name when present, fall back to username, fall
      // back to the wallet itself. The subtitle in the row carries
      // the canonical wallet so the operator always knows which
      // account they're picking even when display names collide.
      label: u.display_name || u.username || u.wallet_address,
      href:  `/profile?address=${encodeURIComponent(u.wallet_address)}`,
      u,
    }));
    const actionHits = ACTIONS.filter((a) => filterText(a.label) || filterText(a.key));
    const settingsHits = term ? SETTINGS_INDEX.filter((s) => filterText(s.label) || filterText(s.key)) : [];
    const tokenHits = tokens.map((tk) => ({
      kind: "token",
      key:  `token:${tk.poolAddress}`,
      label: `${tk.baseSymbol}/${tk.quoteSymbol} — ${tk.name}`,
      href:  null,
      tk,
    }));

    return [
      ...userHits,
      ...actionHits.map((a) => ({ kind: "action",   ...a })),
      ...settingsHits.map((s) => ({ kind: "setting", ...s })),
      ...tokenHits,
    ];
  }, [q, users, tokens]);

  // Clamp selection when the result list shrinks.
  useEffect(() => {
    if (selected >= results.length) setSelected(Math.max(0, results.length - 1));
  }, [results.length, selected]);

  // Focus + reset on open.
  useEffect(() => {
    if (!open) return;
    setSelected(0);
    const id = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(id);
  }, [open]);

  // Debounced token search — only fires with 2+ chars to keep the
  // GeckoTerminal free tier from exploding.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) { setTokens([]); return; }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchTokens({ chain: activeChain, query: q, signal: ctl.signal });
        setTokens(rows.slice(0, 8));
      } catch { setTokens([]); }
      finally { setLoading(false); }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q, open, activeChain]);

  // Debounced user search. Hits the same /api/social/search endpoint
  // the @mention picker uses, which prefix/substring matches both
  // username AND wallet_address (case-insensitive). 2-char floor so
  // a single keystroke doesn't fan out to the DB on every press.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) { setUsers([]); return; }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/social/search?q=${encodeURIComponent(q.trim())}&limit=6`, {
          signal: ctl.signal,
        });
        if (!r.ok) { setUsers([]); return; }
        const j = await r.json();
        setUsers(Array.isArray(j?.users) ? j.users : []);
      } catch { setUsers([]); }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q, open]);

  // Keyboard nav. Escape close handled by the shell too; local handler
  // short-circuits when we're open so it wins over the global.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose?.(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        activate(results[selected]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, selected]);

  function activate(item) {
    if (!item) return;
    if (item.action && onAction) { onAction(item.action); onClose?.(); return; }
    if (item.href) {
      window.location.assign(item.href);
      onClose?.();
      return;
    }
    if (item.kind === "token" && item.tk) {
      // Route to /trading — the token selector there will pick it up
      // naturally when the user searches. For now just navigate.
      window.location.assign("/trading");
      onClose?.();
    }
  }

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.62)",
        backdropFilter: "blur(8px)",
        zIndex: 230,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          margin: "0 20px",
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(0,0,0,0.5), var(--accent-glow)",
          overflow: "hidden",
        }}
      >
        {/* Input */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid ${t.border}`,
        }}>
          <SearchIcon size={16} style={{ color: t.textDim }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${activeChain.toUpperCase()} tokens, settings, actions…`}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: t.text,
              fontSize: 14,
              fontFamily: "inherit",
            }}
          />
          {loading && <span style={{ fontSize: 11, color: t.textDim }}>…</span>}
          <span style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--bg-input)",
            color: t.textDim,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}>Esc</span>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: 6 }}>
          {results.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: t.textDim, textAlign: "center" }}>
              {q.trim() ? "No matches." : "Type to search. Enter to open."}
            </div>
          )}
          {results.map((r, i) => {
            const active = i === selected;
            const Icon = r.Icon || iconFor(r.kind);
            // For users: subtitle carries the canonical wallet (or a
            // @username when display_name was the primary label) so
            // collisions on display name aren't ambiguous.
            const userSubtitle = r.kind === "user"
              ? (r.u.username && r.label !== r.u.username
                  ? `@${r.u.username} · ${r.u.wallet_address}`
                  : r.u.wallet_address)
              : "";
            const subtitle =
              r.kind === "user"    ? userSubtitle
              : r.kind === "token"   ? `${r.tk.baseSymbol} on ${activeChain.toUpperCase()} · $${Number(r.tk.priceUsd || 0).toFixed(4)}`
              : r.kind === "action" ? "Action"
              : r.kind === "setting" ? "Settings"
              : "";
            return (
              <button
                key={r.key}
                type="button"
                onMouseEnter={() => setSelected(i)}
                onClick={() => activate(r)}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: t.text,
                  fontSize: 13,
                  fontFamily: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {Icon && <Icon size={14} style={{ color: active ? t.accent : t.textMuted, flexShrink: 0 }} />}
                <span style={{
                  flex: 1, minWidth: 0, whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis",
                  color: active ? t.white : t.text,
                  fontWeight: active ? 600 : 500,
                }}>
                  {r.label}
                </span>
                <span style={{ fontSize: 10, color: t.textDim, letterSpacing: 0.5, textTransform: "uppercase" }}>
                  {subtitle}
                </span>
                {active && <CornerDownLeft size={12} style={{ color: t.accent }} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function iconFor(kind) {
  if (kind === "user")    return UserIcon;
  if (kind === "setting") return SettingsIcon;
  if (kind === "token")   return SearchIcon;
  return null;
}
