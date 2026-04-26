"use client";
// src/lib/nearConfig.js
// Single source of truth for NEAR network + contract identity. Day 4.2
// converts every hardcoded `mainnet` / `ironshield.near` reference to
// import from here so we can run the same frontend bundle against
// either network by flipping NEXT_PUBLIC_NETWORK_ID at build time.
//
// Defaults preserve mainnet behaviour so an unconfigured build doesn't
// silently shift networks.

export const NETWORK_ID =
  process.env.NEXT_PUBLIC_NETWORK_ID === "testnet" ? "testnet" : "mainnet";

export const STAKING_CONTRACT =
  process.env.NEXT_PUBLIC_STAKING_CONTRACT ||
  (NETWORK_ID === "testnet" ? "ironshield-test.testnet" : "ironshield.near");

export const IRONCLAW_TOKEN =
  process.env.NEXT_PUBLIC_TOKEN_CONTRACT ||
  (NETWORK_ID === "testnet" ? "ironshield-test.testnet" : "claw.ironshield.near");

// fastnear has both networks; the mainnet endpoint differs from testnet.
// near.org's free endpoints are fine fallbacks.
export const NODE_URL =
  process.env.NEXT_PUBLIC_NEAR_RPC_URL ||
  (NETWORK_ID === "testnet"
    ? "https://rpc.testnet.near.org"
    : "https://rpc.fastnear.com");

// Orchestrator default — used by the agent-dashboard delegation flow
// when a user hasn't configured a specific orchestrator. Falls back to
// the staking contract owner sub-account convention.
export const ORCHESTRATOR_DEFAULT =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_ID ||
  `orchestrator.${STAKING_CONTRACT}`;

// NEP-413 sign-message recipient. Stays mainnet-style regardless of
// NETWORK_ID — it's an auth-domain marker, not a contract id, and the
// backend (which verifies the sig) keeps the same string fixed too.
// Documented in docs/auth-contract.md §2.2.
export const AUTH_RECIPIENT = "ironshield.near";
