"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";

export const DARK = {
  bg: "#080b12", bgCard: "#0d1117", bgCardHover: "#111827", bgSurface: "#161b22",
  border: "#1e293b", borderHover: "#334155", accent: "#3b82f6",
  accentGlow: "rgba(59,130,246,0.15)", green: "#10b981", greenGlow: "rgba(16,185,129,0.15)",
  red: "#ef4444", redGlow: "rgba(239,68,68,0.15)", amber: "#f59e0b",
  text: "#e2e8f0", textMuted: "#94a3b8", textDim: "#64748b", white: "#ffffff",
  navBg: "rgba(8,11,18,0.92)", watermarkOpacity: 0.06,
};

export const LIGHT = {
  bg: "#f1f5f9", bgCard: "#ffffff", bgCardHover: "#f8fafc", bgSurface: "#f1f5f9",
  border: "#e2e8f0", borderHover: "#cbd5e1", accent: "#2563eb",
  accentGlow: "rgba(37,99,235,0.1)", green: "#059669", greenGlow: "rgba(5,150,105,0.1)",
  red: "#dc2626", redGlow: "rgba(220,38,38,0.1)", amber: "#d97706",
  text: "#1e293b", textMuted: "#64748b", textDim: "#94a3b8", white: "#0f172a",
  navBg: "rgba(241,245,249,0.92)", watermarkOpacity: 0.1,
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
      ] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/modal-ui/styles.css"),
      ]);

      const _selector = await setupWalletSelector({
        network: "mainnet",
        modules: [setupMeteorWallet()],
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

  // Auto-init if user was previously connected (check localStorage)
  useEffect(() => {
    if (!mounted) return;
    try {
      const stored = localStorage.getItem("near-wallet-selector:selectedWalletId");
      if (stored) initWallet();
    } catch {}
  }, [mounted, initWallet]);

  const fetchBalance = async (accountId) => {
    try {
      const { connect, keyStores } = await import("near-api-js");
      const nearConnection = await connect({
        networkId: "mainnet",
        keyStore: new keyStores.BrowserLocalStorageKeyStore(),
        nodeUrl: "https://rpc.mainnet.near.org",
      });
      const account = await nearConnection.account(accountId);
      try {
        const state = await account.state();
        const totalBn = BigInt(state.amount);
        const lockedBn = BigInt(state.locked || "0");
        const storageCost = BigInt(state.storage_usage || 0) * BigInt("10000000000000000000");
        const available = totalBn - lockedBn - storageCost;
        setBalance((Number(available > 0n ? available : 0n) / 1e24).toFixed(2));
      } catch {
        const accountBalance = await account.getAccountBalance();
        setBalance((parseFloat(accountBalance.available) / 1e24).toFixed(2));
      }
    } catch (e) {
      console.error("Balance fetch error:", e);
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
