"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSettings } from "@/lib/stores/settingsStore";
import { apiFetch, setWalletState as setApiFetchWalletState } from "@/lib/apiFetch";
import { NETWORK_ID, NODE_URL, STAKING_CONTRACT } from "@/lib/nearConfig";

// Cache a single near-api-js Near instance across the whole app. We build it
// lazily and reuse it for both viewMethod reads (anonymous account) and per-
// user balance lookups. One connection, many accounts.
let _nearInstance = null;
async function getNearInstance() {
  if (_nearInstance) return _nearInstance;
  const { connect, keyStores } = await import("near-api-js");
  _nearInstance = await connect({
    networkId: NETWORK_ID,
    nodeUrl:   NODE_URL,
    keyStore:  new keyStores.InMemoryKeyStore(),
  });
  return _nearInstance;
}

let _nearReadAccount = null;
async function getReadAccount() {
  if (_nearReadAccount) return _nearReadAccount;
  const near = await getNearInstance();
  _nearReadAccount = await near.account("anonymous");
  return _nearReadAccount;
}
export { getReadAccount, getNearInstance };

// Dark palette — kept in sync with tokens.css's CSS variables so
// legacy inline-style components (useTheme) and new CSS-variable
// components (AppShell, FeedRightRail) render on the same visual
// surface. Values nudged toward the premium design: deeper navy
// base, slightly brighter text for contrast on the darker bg,
// subtly purple-tinted glow so mixing gradients is cheap.
export const DARK = {
  bg: "#080b16", bgCard: "#0e1324", bgCardHover: "#141a2e", bgSurface: "#0d1220",
  border: "#1d2540", borderHover: "#2a3458", accent: "#3b82f6",
  accentGlow: "rgba(168,85,247,0.18)", green: "#10b981", greenGlow: "rgba(16,185,129,0.15)",
  red: "#ef4444", redGlow: "rgba(239,68,68,0.15)", amber: "#f59e0b",
  text: "#e5ebf7", textMuted: "#9aa4bd", textDim: "#6c7692", white: "#ffffff",
  navBg: "#080b16", watermarkOpacity: 0.06,
};

export const LIGHT = {
  bg: "#f1f5f9", bgCard: "#ffffff", bgCardHover: "#f8fafc", bgSurface: "#f1f5f9",
  border: "#e2e8f0", borderHover: "#cbd5e1", accent: "#2563eb",
  accentGlow: "rgba(37,99,235,0.1)", green: "#059669", greenGlow: "rgba(5,150,105,0.1)",
  red: "#dc2626", redGlow: "rgba(220,38,38,0.1)", amber: "#d97706",
  text: "#1e293b", textMuted: "#64748b", textDim: "#94a3b8", white: "#0f172a",
  navBg: "#f1f5f9", watermarkOpacity: 0.1,
};

// Accent hex per preset. These are the same values as the --accent CSS
// variable in src/styles/tokens.css — kept in sync manually so that
// legacy inline-style components (which read t.accent) and new CSS-var
// components render the same color when the user switches preset.
export const PRESET_ACCENTS = {
  default:  "#3b82f6",  // blue, preserves the repo's existing look
  midnight: "#6366f1",  // indigo
  steel:    "#94a3b8",  // slate
  carbon:   "#a3a3a3",  // neutral gray
  ember:    "#f97316",  // orange
  ironclaw: "#ef4444",  // red
  // v1.1.10 — Pro-only presets. The picker UI gates selection on
  // is_pro; PRESET_ACCENTS itself stays open so a Pro user keeps
  // their accent applied after a brief stake drop until the cache
  // refresh window expires (graceful degradation, not a privilege
  // escalation — themes are cosmetic, real Pro perks live behind
  // requirePro on protected routes).
  emerald:  "#10b981",  // green
  aurora:   "#a855f7",  // violet w/ cyan glow
  gold:     "#f59e0b",  // amber
};
export const THEME_PRESETS = Object.keys(PRESET_ACCENTS);
export const PRO_THEME_PRESETS = new Set(["emerald", "aurora", "gold"]);

const accentGlowFor = (hex) => {
  // Convert #RRGGBB → rgba(r,g,b,0.15) for the legacy theme object's
  // accentGlow field. Alpha matches the CSS --accent-glow shadow.
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.15)`;
};

export const ThemeCtx = createContext({
  theme: DARK,
  isDark: true,
  setIsDark: () => {},
  preset: "default",
  setPreset: () => {},
});
export const useThemeInfo = () => useContext(ThemeCtx);
export const useTheme = () => useContext(ThemeCtx).theme;

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true);

  // Theme preset lives in the settings store (single source of truth
  // so the /settings/appearance page and this provider can't drift).
  // Zustand's persist middleware handles localStorage; no manual
  // hydrate step here.
  const preset = useSettings((s) => s.theme);
  const setPresetInStore = useSettings((s) => s.setTheme);

  // Keep <html data-theme="..."> in sync so new CSS-var components retint.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (preset === "default") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = preset;
    }
  }, [preset]);

  const setPreset = useCallback((next) => {
    if (!PRESET_ACCENTS[next]) return;
    setPresetInStore(next);
  }, [setPresetInStore]);

  // Stamp the preset's accent onto the legacy inline-style theme so
  // existing components (which read t.accent) retint without a rewrite.
  // Memoized so equal presets don't invalidate useTheme() consumers on
  // unrelated renders.
  const theme = useMemo(() => {
    const base = isDark ? DARK : LIGHT;
    const accent = PRESET_ACCENTS[preset] || PRESET_ACCENTS.default;
    return { ...base, accent, accentGlow: accentGlowFor(accent) };
  }, [isDark, preset]);

  return (
    <ThemeCtx.Provider value={{ theme, isDark, setIsDark, preset, setPreset }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const WalletCtx = createContext({
  connected: false,
  address: null,
  walletType: null, // near | evm | sol | google
  balance: "0",
  selector: null,
  modal: null,
  signOut: () => {},
  showModal: () => {}
});

export const useWallet = () => useContext(WalletCtx);

export function WalletProvider({ children }) {
  const [mounted, setMounted] = useState(false);
  const [selector, setSelector] = useState(null);
  const [modal, setModal] = useState(null);
  const [address, setAddress] = useState(null);
  const [walletType, setWalletType] = useState(null);
  const [displayName, setDisplayName] = useState(null);
  const [balance, setBalance] = useState("0");
  // initWalletRef below serialises the lazy-init promise so concurrent
  // callers share one in-flight init instead of racing.
  const [chooserOpen, setChooserOpen] = useState(false);
  const googleTokenClient = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  // Mirror selector + walletType into apiFetch's module-level ref so
  // non-hook callers (the apiFetch wrapper itself, libs, tests) can
  // sign requests without prop-drilling the selector. Reset on signOut.
  useEffect(() => {
    setApiFetchWalletState({ selector, walletType });
  }, [selector, walletType]);

  // Referral claim: once a wallet connects, see if the visitor arrived
  // via a /?ref=<code> link (stashed in localStorage by the inline
  // script in layout.js). If so, POST it to claim-referrer so the
  // inviter gets credit, and set a follow-prompt flag so the feed
  // page can nudge them to follow their inviter.
  //
  // Pending-code lifecycle: clear ONLY on a definitive server reply
  // (success, or a permanent rejection like "code not found" /
  // "self_referral" / "already_set"). On transport-level failures
  // (signing dismissed, popup blocked, offline, 5xx) keep the pending
  // value so the next wallet-connect attempt retries. The previous
  // version cleared in `finally`, which meant any one-time hiccup
  // permanently lost the referral.
  //
  // Console logs are intentional here — without them, debugging a
  // failed claim from the browser is impossible because the network
  // tab only shows the symptom, not the decision tree.
  useEffect(() => {
    if (!address || typeof window === "undefined") return;
    let ref;
    try { ref = localStorage.getItem("ironshield:ref-pending"); } catch {}
    if (!ref) return;
    console.log("[referral] claim attempt", { code: ref, wallet: address });
    (async () => {
      let r, j;
      try {
        r = await apiFetch(`/api/rewards/claim-referrer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: ref }),
        });
      } catch (err) {
        // Transport failure (wallet popup dismissed, signing rejected,
        // network drop). Keep pending for the next attempt.
        console.warn("[referral] claim transport-failed (will retry on next connect):", err?.message || err);
        return;
      }
      try { j = await r.json(); } catch { j = {}; }

      if (r.ok && j.claimed && j.referrer) {
        console.log("[referral] claim landed", j.referrer);
        try {
          localStorage.setItem("ironshield:ref-prompt", JSON.stringify(j.referrer));
        } catch {}
        try { localStorage.removeItem("ironshield:ref-pending"); } catch {}
        return;
      }

      // Definitive rejection: 4xx with a known reason, OR 200 with
      // claimed:false (already_set). Permanent — clear pending.
      const permanent =
        r.status === 200 && j.claimed === false ||
        r.status === 400 ||
        r.status === 404;
      if (permanent) {
        console.log("[referral] claim refused (permanent), clearing:", { status: r.status, body: j });
        try { localStorage.removeItem("ironshield:ref-pending"); } catch {}
        return;
      }

      // 401 (signing failed), 403, 5xx, anything else — keep pending.
      console.warn("[referral] claim non-2xx (will retry on next connect):", { status: r.status, body: j });
    })();
  }, [address]);

  // Lazy wallet init: only loads heavy NEAR libs when needed. Returns the
  // freshly-created { selector, modal } pair so callers (e.g. connectNear)
  // can `modal.show()` immediately without waiting for React to re-render
  // with the new state — the previous design read the stale closure
  // `modal` which was still null after the very first init, which is why
  // users had to click the Connect button twice.
  const initWalletRef = useRef(null);
  const initWallet = useCallback(async () => {
    if (initWalletRef.current) return initWalletRef.current;
    initWalletRef.current = (async () => {
      try {
        const [
          { setupWalletSelector },
          { setupModal: _setupModal },
          { setupMeteorWallet },
          { setupHereWallet },
          { setupHotWallet },
          { setupIntearWallet },
        ] = await Promise.all([
          import("@near-wallet-selector/core"),
          import("@near-wallet-selector/modal-ui"),
          import("@near-wallet-selector/meteor-wallet"),
          import("@near-wallet-selector/here-wallet"),
          import("@near-wallet-selector/hot-wallet"),
          import("@near-wallet-selector/intear-wallet"),
          import("@near-wallet-selector/modal-ui/styles.css"),
        ]);

        const _selector = await setupWalletSelector({
          network: NETWORK_ID,
          modules: [
            setupMeteorWallet(),
            setupHereWallet(),
            setupHotWallet(),
            setupIntearWallet(),
          ],
        });

        const _modal = _setupModal(_selector, { contractId: STAKING_CONTRACT });

        const state = _selector.store.getState();
        if (state.accounts.length > 0) {
          setWalletType("near");
          setAddress(state.accounts[0].accountId);
          fetchBalance(state.accounts[0].accountId);
        }

        setSelector(_selector);
        setModal(_modal);

        _selector.store.observable.subscribe((state) => {
          if (state.accounts.length > 0) {
            setWalletType("near");
            setAddress(state.accounts[0].accountId);
            fetchBalance(state.accounts[0].accountId);
          } else {
            setWalletType(null);
            setAddress(null);
            setBalance("0");
          }
        });

        return { selector: _selector, modal: _modal };
      } catch (err) {
        console.warn("Wallet selector init failed:", err);
        initWalletRef.current = null; // allow a retry
        throw err;
      }
    })();
    return initWalletRef.current;
  }, []);

  // Auto-init if user was previously connected: but DEFER it to browser
  // idle time so it never blocks first paint or initial bundle parse.
  useEffect(() => {
    if (!mounted) return;
    let stored;
    try { stored = localStorage.getItem("near-wallet-selector:selectedWalletId"); } catch {}
    if (!stored) return;

    const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500));
    const handle = ric(() => initWallet(), { timeout: 4000 });
    return () => {
      const cancel = window.cancelIdleCallback || clearTimeout;
      try { cancel(handle); } catch {}
    };
  }, [mounted, initWallet]);

  const fetchBalance = async (accountId) => {
    if (!accountId) { setBalance("0"); return; }
    try {
      // near-api-js v6: Account.getState() returns
      //   { balance: { total, usedOnStorage, locked, available }, storageUsage, codeHash }
      // with every balance field as a bigint. Divide available by 10^24 for NEAR.
      const near = await getNearInstance();
      const userAccount = await near.account(accountId);
      const { balance: b } = await userAccount.getState();
      const YOCTO = 1_000_000_000_000_000_000_000_000n; // 10^24
      const whole   = b.available / YOCTO;              // integer NEAR
      const remMicro = (b.available % YOCTO) / 1_000_000_000_000_000_000_000n; // 0-999 (3 dp)
      const formatted = `${whole}.${String(remMicro).padStart(3, "0").slice(0, 2)}`;
      setBalance(formatted);
    } catch (e) {
      console.warn("Balance fetch error:", e?.message || e);
      setBalance("0");
    }
  };

  const signOut = async () => {
    if (walletType === "near" && selector) {
      const wallet = await selector.wallet();
      await wallet.signOut();
    }
    if (walletType === "sol" && typeof window !== "undefined" && window.solana?.isConnected) {
      try { await window.solana.disconnect(); } catch {}
    }
    if (walletType === "google" && typeof window !== "undefined" && window.google?.accounts?.oauth2) {
      try {
        const token = localStorage.getItem("google_access_token");
        if (token) window.google.accounts.oauth2.revoke(token, () => {});
      } catch {}
    }
    try { localStorage.removeItem("google_access_token"); } catch {}
    setDisplayName(null);
    setWalletType(null);
    setAddress(null);
    setBalance("0");
  };

  const connectNear = async () => {
    // Use the return value of initWallet rather than the React `modal`
    // state so the selector opens on the FIRST click even when this is
    // the user's very first interaction with the wallet — React hasn't
    // committed the setModal call by the time we reach the show() line
    // otherwise.
    const { modal: liveModal } = await initWallet();
    setChooserOpen(false);
    liveModal?.show();
  };

  const connectEvm = async () => {
    if (typeof window === "undefined" || !window.ethereum) throw new Error("No EVM wallet found");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const evm = accounts?.[0];
    if (!evm) throw new Error("No EVM account selected");
    setWalletType("evm");
    setDisplayName(null);
    setAddress(evm);
    setChooserOpen(false);
    setBalance("0");
  };

  const connectSol = async () => {
    if (typeof window === "undefined" || !window.solana) throw new Error("No Solana wallet found");
    const resp = await window.solana.connect();
    const sol = resp?.publicKey?.toString?.();
    if (!sol) throw new Error("No Solana account selected");
    setWalletType("sol");
    setDisplayName(null);
    setAddress(sol);
    setChooserOpen(false);
    setBalance("0");
  };

  const ensureGoogleSdk = async () => {
    if (typeof window === "undefined") throw new Error("Google Sign-In only runs in browser");
    if (window.google?.accounts?.oauth2) return;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-google-identity="1"]');
      if (existing) { existing.addEventListener("load", resolve, { once: true }); return; }
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.dataset.googleIdentity = "1";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  };

  const connectGoogle = async () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set");
    await ensureGoogleSdk();
    await new Promise((resolve, reject) => {
      if (!googleTokenClient.current) {
        googleTokenClient.current = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: "openid email profile",
          callback: async (tokenResp) => {
            try {
              if (!tokenResp?.access_token) throw new Error("No Google token");
              localStorage.setItem("google_access_token", tokenResp.access_token);
              const me = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                headers: { Authorization: `Bearer ${tokenResp.access_token}` },
              }).then(r => r.json());
              setWalletType("google");
              setAddress(me.email || me.sub || "google-user");
              setDisplayName(me.name || me.given_name || me.email || null);
              setChooserOpen(false);
              resolve();
            } catch (e) { reject(e); }
          },
          error_callback: () => reject(new Error("Google sign-in failed")),
        });
      }
      googleTokenClient.current.requestAccessToken({ prompt: "consent" });
    });
  };

  const showModal = async () => {
    setChooserOpen(true);
  };

  return (
    <WalletCtx.Provider value={{
      connected: !!address,
      address,
      walletType,
      displayName,
      balance,
      selector,
      modal,
      signOut,
      showModal,
      connectNear,
      connectEvm,
      connectSol,
      connectGoogle,
    }}>
      {chooserOpen && (
        <WalletChooser
          onClose={() => setChooserOpen(false)}
          onNear={() => connectNear().catch((e) => alert(e.message))}
          onEvm={() => connectEvm().catch((e) => alert(e.message))}
          onSol={() => connectSol().catch((e) => alert(e.message))}
          onGoogle={() => connectGoogle().catch((e) => alert(e.message))}
        />
      )}
      {children}
    </WalletCtx.Provider>
  );
}

// WalletChooser — the ONLY connect modal in the app. Previously there
// was a second, nicer ConnectAccountModal that sat in SkillsShell and
// delegated picks back to this component, which meant a "Connect" click
// bounced through two dialogs before the NEAR selector opened. This
// consolidated version matches that nicer design (app-icon tiles,
// Recommended badge, privacy footer) so every caller of showModal()
// gets the same first-class flow.
//
// Each row calls its connect function directly — no nested modal.
function WalletChooser({ onClose, onNear, onEvm, onSol, onGoogle }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const opts = [
    {
      key: "near",
      label: "NEAR Wallet",
      hint: "Meteor • HERE • HOT • Intear",
      recommended: true,
      onClick: onNear,
      tile: { bg: "#0f0f17", border: "rgba(255,255,255,0.12)", glyph: "N", color: "#fff" },
    },
    {
      key: "google",
      label: "Google Sign-In",
      hint: "Use your Google account",
      onClick: onGoogle,
      tile: { bg: "#fff", border: "rgba(0,0,0,0.06)", glyph: "G", color: "#4285F4" },
    },
    {
      key: "evm",
      label: "EVM Wallet",
      hint: "MetaMask • injected wallet",
      onClick: onEvm,
      tile: { bg: "#ffe7c6", border: "rgba(0,0,0,0.06)", glyph: "🦊", color: "#000" },
    },
    {
      key: "sol",
      label: "Solana Wallet",
      hint: "Phantom • injected wallet",
      onClick: onSol,
      tile: { bg: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)", border: "rgba(255,255,255,0.18)", glyph: "S", color: "#fff" },
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(4, 6, 14, 0.72)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
        animation: "wc-fade 140ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%", maxWidth: 520,
          background: "linear-gradient(180deg, #0f1424 0%, #0b1020 100%)",
          border: "1px solid #1d2540",
          borderRadius: 20,
          padding: "28px 28px 24px",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(168,85,247,0.12)",
          animation: "wc-pop 160ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          maxHeight: "calc(100vh - 48px)", overflowY: "auto",
        }}
      >
        <button
          type="button" aria-label="Close" onClick={onClose}
          style={{
            position: "absolute", top: 16, right: 16,
            width: 34, height: 34, borderRadius: "50%",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid #1d2540", color: "#9aa4bd",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: 15,
          }}
        >✕</button>

        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 22 }}>
          <span aria-hidden style={{
            width: 52, height: 52, flexShrink: 0, borderRadius: 14,
            background: "linear-gradient(135deg, rgba(168,85,247,0.4), rgba(59,130,246,0.25))",
            border: "1px solid rgba(168,85,247,0.35)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#c4b8ff", fontSize: 20,
            boxShadow: "0 6px 24px rgba(168,85,247,0.35)",
          }}>🔒</span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{
              fontSize: 22, fontWeight: 800, color: "#fff", margin: 0,
              letterSpacing: -0.4,
            }}>Connect account</h2>
            <p style={{ fontSize: 13, color: "#9aa4bd", margin: "4px 0 0" }}>
              Choose how you want to sign in to{" "}
              <span style={{
                background: "linear-gradient(90deg, #60a5fa, #a855f7)",
                WebkitBackgroundClip: "text", backgroundClip: "text",
                WebkitTextFillColor: "transparent", color: "transparent",
                fontWeight: 700,
              }}>AZUKA</span>.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {opts.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={opt.onClick}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "14px 16px", width: "100%",
                background: "rgba(255,255,255,0.025)",
                border: `1px solid ${opt.recommended ? "rgba(168,85,247,0.5)" : "#1d2540"}`,
                borderRadius: 14,
                cursor: "pointer", textAlign: "left",
                transition: "background 120ms ease, border-color 120ms ease, transform 120ms ease",
                boxShadow: opt.recommended ? "0 0 0 1px rgba(168,85,247,0.22) inset" : "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.borderColor = "rgba(168,85,247,0.55)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.025)";
                e.currentTarget.style.borderColor = opt.recommended ? "rgba(168,85,247,0.5)" : "#1d2540";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <span aria-hidden style={{
                width: 42, height: 42, borderRadius: 10,
                background: opt.tile.bg,
                border: `1px solid ${opt.tile.border}`,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: opt.key === "evm" ? 22 : 20,
                color: opt.tile.color, letterSpacing: -1, flexShrink: 0,
              }}>{opt.tile.glyph}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 15, fontWeight: 800, color: "#fff",
                }}>
                  {opt.label}
                  {opt.recommended && (
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
                      background: "rgba(168,85,247,0.22)", color: "#c4b8ff",
                    }}>Recommended</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#9aa4bd", marginTop: 2 }}>
                  {opt.hint}
                </div>
              </div>
              <span style={{ color: "#6c7692", fontSize: 14, flexShrink: 0 }}>›</span>
            </button>
          ))}
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          margin: "18px 0 16px",
        }}>
          <span style={{ flex: 1, height: 1, background: "#1d2540" }} />
          <span style={{ fontSize: 11.5, color: "#6c7692", fontStyle: "italic" }}>
            More options coming soon
          </span>
          <span style={{ flex: 1, height: 1, background: "#1d2540" }} />
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px", background: "rgba(255,255,255,0.03)",
          border: "1px solid #1d2540", borderRadius: 12,
        }}>
          <span aria-hidden style={{
            width: 32, height: 32, flexShrink: 0, borderRadius: 10,
            background: "rgba(168,85,247,0.18)", color: "#c4b8ff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 14,
          }}>🛡️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>
              Your privacy matters
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa4bd", marginTop: 2 }}>
              We never store your private keys or access your funds.
            </div>
          </div>
          <button
            type="button" onClick={onClose}
            style={{
              padding: "9px 18px",
              background: "transparent",
              border: "1px solid #1d2540", borderRadius: 10,
              fontSize: 12.5, fontWeight: 700, color: "#e5ebf7",
              cursor: "pointer",
            }}
          >Cancel</button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes wc-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wc-pop {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Proposals cache ──────────────────────────────────────────
// Single source of truth for get_proposals. AgentPage, EarnPage,
// and GovernancePage all read from this shared cache instead of
// each calling the RPC independently on every mount.
const PROPOSALS_CONTRACT_ID = STAKING_CONTRACT;
const PROPOSALS_TTL_MS      = 30_000; // re-fetch after 30s of staleness

export const ProposalsCtx = createContext({
  proposals: [],
  loading: true,
  lastFetched: 0,
  refresh: async () => {},
});

export const useProposals = () => useContext(ProposalsCtx);

export function ProposalsProvider({ children }) {
  const [proposals, setProposals]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [lastFetched, setLastFetched] = useState(0);
  const inflightRef = useRef(null);

  const refresh = useCallback(async ({ force = false } = {}) => {
    // Dedup concurrent callers onto the same in-flight request
    if (inflightRef.current) return inflightRef.current;
    if (!force && lastFetched && Date.now() - lastFetched < PROPOSALS_TTL_MS) {
      return proposals;
    }
    setLoading(true);
    const p = (async () => {
      try {
        const account = await getReadAccount();
        const result = await account.viewFunction({
          contractId: PROPOSALS_CONTRACT_ID,
          methodName: "get_proposals",
          args: {},
        });
        const list = Array.isArray(result) ? result : [];
        setProposals(list);
        setLastFetched(Date.now());
        return list;
      } catch (err) {
        const msg = err?.message || "";
        if (
          !msg.includes("MethodNotFound") &&
          !msg.includes("method is not found") &&
          !msg.includes("does not exist") &&
          !msg.includes("CodeDoesNotExist")
        ) {
          console.warn("ProposalsProvider fetch failed:", msg);
        }
        return proposals;
      } finally {
        setLoading(false);
        inflightRef.current = null;
      }
    })();
    inflightRef.current = p;
    return p;
  }, [lastFetched, proposals]);

  // Fire the first fetch once on mount, deferred to idle so it never
  // competes with the initial paint. Subsequent mounts of consumer
  // pages will hit the cache.
  useEffect(() => {
    const ric = typeof window !== "undefined" && window.requestIdleCallback
      ? window.requestIdleCallback
      : (cb) => setTimeout(cb, 400);
    const handle = ric(() => refresh(), { timeout: 2500 });
    return () => {
      const cancel = (typeof window !== "undefined" && window.cancelIdleCallback) || clearTimeout;
      try { cancel(handle); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({ proposals, loading, lastFetched, refresh }),
    [proposals, loading, lastFetched, refresh]
  );

  return <ProposalsCtx.Provider value={value}>{children}</ProposalsCtx.Provider>;
}
