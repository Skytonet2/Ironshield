"use client";
import "@near-wallet-selector/modal-ui/styles.css";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import * as nearAPI from "near-api-js";
import { createContext, useContext, useState, useEffect } from "react";

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
  const [selector, setSelector] = useState(null);
  const [modal, setModal] = useState(null);
  const [address, setAddress] = useState(null);
  const [balance, setBalance] = useState("0");

  useEffect(() => {
    const init = async () => {
      const _selector = await setupWalletSelector({
        network: "mainnet",
        modules: [setupMeteorWallet()],
      });

      const _modal = setupModal(_selector, {
        contractId: "guest-book.near",
      });

      const state = _selector.store.getState();
      const accounts = state.accounts;

      if (accounts.length > 0) {
        setAddress(accounts[0].accountId);
        fetchBalance(accounts[0].accountId);
      }

      setSelector(_selector);
      setModal(_modal);

      const subscription = _selector.store.observable.subscribe((state) => {
        if (state.accounts.length > 0) {
          setAddress(state.accounts[0].accountId);
          fetchBalance(state.accounts[0].accountId);
        } else {
          setAddress(null);
          setBalance("0");
        }
      });
      return () => subscription.unsubscribe();
    };
    init();
  }, []);

  const fetchBalance = async (accountId) => {
    try {
      const { connect, keyStores } = nearAPI;
      const connectionConfig = {
        networkId: "mainnet",
        keyStore: new keyStores.BrowserLocalStorageKeyStore(),
        nodeUrl: "https://rpc.mainnet.near.org",
        walletUrl: "https://wallet.mainnet.near.org",
        helperUrl: "https://helper.mainnet.near.org",
        explorerUrl: "https://explorer.mainnet.near.org",
      };
      const nearConnection = await connect(connectionConfig);
      const account = await nearConnection.account(accountId);
      const accountBalance = await account.getAccountBalance();
      setBalance((accountBalance.available / 1e24).toFixed(2));
    } catch (e) {
      console.error(e);
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

  const showModal = () => {
    if (modal) modal.show();
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
