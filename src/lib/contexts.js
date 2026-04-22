"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSettings } from "@/lib/stores/settingsStore";

// Cache a single near-api-js Near instance across the whole app. We build it
// lazily and reuse it for both viewMethod reads (anonymous account) and per-
// user balance lookups. One connection, many accounts.
let _nearInstance = null;
async function getNearInstance() {
  if (_nearInstance) return _nearInstance;
  const { connect, keyStores } = await import("near-api-js");
  _nearInstance = await connect({
    networkId: "mainnet",
    nodeUrl:   "https://rpc.fastnear.com",
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
};
export const THEME_PRESETS = Object.keys(PRESET_ACCENTS);

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
  const [initStarted, setInitStarted] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const googleTokenClient = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  // Lazy wallet init: only loads heavy NEAR libs when needed
  const initWallet = useCallback(async () => {
    if (initStarted || selector) return;
    setInitStarted(true);
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
        network: "mainnet",
        modules: [
          setupMeteorWallet(),
          setupHereWallet(),
          setupHotWallet(),
          setupIntearWallet(),
        ],
      });

      const _modal = _setupModal(_selector, { contractId: "ironshield.near" });

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
    } catch (err) {
      console.warn("Wallet selector init failed:", err);
      setInitStarted(false);
    }
  }, [initStarted, selector]);

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
    if (!selector) await initWallet();
    await new Promise(r => setTimeout(r, 100));
    setChooserOpen(false);
    if (modal) modal.show();
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

function WalletChooser({ onClose, onNear, onEvm, onSol, onGoogle }) {
  const opts = [
    { label: "NEAR Wallet", hint: "Meteor / HERE / HOT / Intear", onClick: onNear },
    { label: "Google Sign-In", hint: "Use your Google account", onClick: onGoogle },
    { label: "EVM Wallet", hint: "MetaMask / injected wallet", onClick: onEvm },
    { label: "Solana Wallet", hint: "Phantom / injected wallet", onClick: onSol },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.58)", backdropFilter: "blur(4px)", zIndex: 9999, display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(92vw, 420px)", borderRadius: 16, border: "1px solid #1e293b", background: "#0d1117", padding: 16 }}>
        <div style={{ color: "#fff", fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Connect account</div>
        <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 12 }}>Choose how you want to sign in.</div>
        <div style={{ display: "grid", gap: 8 }}>
          {opts.map((o) => (
            <button key={o.label} onClick={o.onClick} style={{ textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "1px solid #1e293b", background: "#161b22", color: "#e2e8f0", cursor: "pointer" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{o.label}</div>
              <div style={{ color: "#94a3b8", fontSize: 11 }}>{o.hint}</div>
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{ marginTop: 12, width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid #1e293b", background: "transparent", color: "#94a3b8", cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Proposals cache ──────────────────────────────────────────
// Single source of truth for get_proposals. AgentPage, EarnPage,
// and GovernancePage all read from this shared cache instead of
// each calling the RPC independently on every mount.
const PROPOSALS_CONTRACT_ID = "ironshield.near";
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
