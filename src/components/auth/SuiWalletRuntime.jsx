"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createNetworkConfig,
  SuiClientProvider,
  WalletProvider as SuiDappWalletProvider,
} from "@mysten/dapp-kit";
import { getFullnodeUrl } from "@mysten/sui/client";

const { networkConfig } = createNetworkConfig({
  devnet: { url: getFullnodeUrl("devnet") },
  testnet: { url: getFullnodeUrl("testnet") },
  mainnet: { url: getFullnodeUrl("mainnet") },
});

function selectedSuiNetwork() {
  const requested = String(process.env.NEXT_PUBLIC_SUI_NETWORK || "testnet").toLowerCase();
  return Object.prototype.hasOwnProperty.call(networkConfig, requested) ? requested : "testnet";
}

export default function SuiWalletRuntime({ children }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={selectedSuiNetwork()}>
        <SuiDappWalletProvider
          autoConnect
          preferredWallets={["Sui Wallet", "Suiet", "Slush"]}
          storageKey="azuka:sui-wallet"
        >
          {children}
        </SuiDappWalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
