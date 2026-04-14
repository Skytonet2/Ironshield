"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from "react";

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

export const DARK = {
  bg: "#080b12", bgCard: "#0d1117", bgCardHover: "#111827", bgSurface: "#161b22",
  border: "#1e293b", borderHover: "#334155", accent: "#3b82f6",
  accentGlow: "rgba(59,130,246,0.15)", green: "#10b981", greenGlow: "rgba(16,185,129,0.15)",
  red: "#ef4444", redGlow: "rgba(239,68,68,0.15)", amber: "#f59e0b",
  text: "#e2e8f0", textMuted: "#94a3b8", textDim: "#64748b", white: "#ffffff",
  navBg: "#080b12", watermarkOpacity: 0.06,
};

export const LIGHT = {
  bg: "#f1f5f9", bgCard: "#ffffff", bgCardHover: "#f8fafc", bgSurface: "#f1f5f9",
  border: "#e2e8f0", borderHover: "#cbd5e1", accent: "#2563eb",
  accentGlow: "rgba(37,99,235,0.1)", green: "#059669", greenGlow: "rgba(5,150,105,0.1)",
  red: "#dc2626", redGlow: "rgba(220,38,38,0.1)", amber: "#d97706",
  text: "#1e293b", textMuted: "#64748b", textDim: "#94a3b8", white: "#0f172a",
  navBg: "#f1f5f9", watermarkOpacity: 0.1,
};

export const ThemeCtx = createContext({ theme: DARK, isDark: true, setIsDark: () => {} });
export const useThemeInfo = () => useContext(ThemeCtx);
export const useTheme = () => useContext(ThemeCtx).theme;

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true);
  const theme = isDark ? DARK : LIGHT;
  return <ThemeCtx.Provider value={{ theme, isDark, setIsDark }}>{children}</ThemeCtx.Provider>;
}

export const WalletCtx = createContext({
  connected: false,
  address: null,
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
  const [balance, setBalance] = useState("0");
  const [initStarted, setInitStarted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Lazy wallet init — only loads heavy NEAR libs when needed
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
        setAddress(state.accounts[0].accountId);
        fetchBalance(state.accounts[0].accountId);
      }

      setSelector(_selector);
      setModal(_modal);

      _selector.store.observable.subscribe((state) => {
        if (state.accounts.length > 0) {
          setAddress(state.accounts[0].accountId);
          fetchBalance(state.accounts[0].accountId);
        } else {
          setAddress(null);
          setBalance("0");
        }
      });
    } catch (err) {
      console.warn("Wallet selector init failed:", err);
      setInitStarted(false);
    }
  }, [initStarted, selector]);

  // Auto-init if user was previously connected — but DEFER it to browser
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
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
    setAddress(null);
    setBalance("0");
  };

  const showModal = async () => {
    if (!selector) await initWallet();
    // Small delay to let modal initialize after lazy load
    await new Promise(r => setTimeout(r, 100));
    if (modal) modal.show();
    else {
      // Retry — modal may have been set during initWallet
      const checkModal = () => {
        const m = document.querySelector(".near-wallet-selector-modal");
        if (!m) setTimeout(checkModal, 100);
      };
      checkModal();
    }
  };

  return (
    <WalletCtx.Provider value={{
      connected: !!address,
      address,
      balance,
      selector,
      modal,
      signOut,
      showModal
    }}>
      {children}
    </WalletCtx.Provider>
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
