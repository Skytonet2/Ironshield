"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import useNear, { STAKING_CONTRACT } from "./useNear";
import { useWallet, getReadAccount } from "@/lib/contexts";

const LEADERBOARD_TTL_MS = 30_000;

// ── Sub-wallet constants ─────────────────────────────────────────────────────
// Fixed prefix so each owner has at most one platform agent sub-wallet. Keeping
// the name predictable lets other surfaces (future profile pages, agent-to-agent
// DMs) resolve the agent identity from the owner alone, without a view call.
const AGENT_SUBACCOUNT_PREFIX = "agent";

// Initial NEAR transferred to the new sub-account. Covers ~1 year of storage
// for a few access keys plus a buffer for future state the agent may accrete.
const SUBWALLET_INITIAL_NEAR = "100000000000000000000000"; // 0.1 NEAR in yocto

// Gas allowance for any FC-scoped keys we ADD to the sub-wallet later — e.g.
// when delegating to the orchestrator. The sub-wallet's own key (created on
// link) is a full-access key because FC keys cannot sign AddKey / DeleteKey
// / DeleteAccount; without full-access the sub-account would be unmanageable
// (no rotation, no delegation, no recovery). Risk is bounded because the sub-
// account only holds the 0.1 NEAR initial transfer + accrued rewards.
const DELEGATED_FC_KEY_ALLOWANCE = "250000000000000000000000"; // 0.25 NEAR in yocto

// localStorage key. Private key lives here until the orchestrator delegation
// flow ships; we key by owner so the same browser can hold keys for multiple
// connected accounts without collision.
const lsKey = (owner) => `ironshield_agent_key:${owner}`;

/**
 * On-chain agent profile + points hook. Wraps ironshield.near's agent
 * methods and caches the caller's own profile + the global leaderboard
 * in component state so EarnPage can render without flicker on re-renders.
 *
 * Points are platform units; future $IRONCLAW conversion rate is set by
 * governance and replayed from the emitted `points_awarded` events.
 */
export default function useAgent() {
  const { viewMethod, callMethod } = useNear();
  const { address, selector } = useWallet();

  const [profile, setProfile]         = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const lastLeaderboardFetch = useRef(0);
  const inflightLeaderboard  = useRef(null);

  // ── Views ────────────────────────────────────────────────────────────────

  const fetchProfile = useCallback(async () => {
    if (!address) { setProfile(null); return null; }
    setProfileLoading(true);
    try {
      const p = await viewMethod(STAKING_CONTRACT, "get_agent", { owner: address });
      setProfile(p || null);
      return p;
    } finally {
      setProfileLoading(false);
    }
  }, [viewMethod, address]);

  const fetchLeaderboard = useCallback(async ({ limit = 50, force = false } = {}) => {
    if (!force && Date.now() - lastLeaderboardFetch.current < LEADERBOARD_TTL_MS) {
      return leaderboard;
    }
    if (inflightLeaderboard.current) return inflightLeaderboard.current;

    setLeaderboardLoading(true);
    const p = (async () => {
      try {
        const rows = await viewMethod(STAKING_CONTRACT, "get_leaderboard", { limit });
        const list = Array.isArray(rows) ? rows : [];
        setLeaderboard(list);
        lastLeaderboardFetch.current = Date.now();
        return list;
      } finally {
        setLeaderboardLoading(false);
        inflightLeaderboard.current = null;
      }
    })();
    inflightLeaderboard.current = p;
    return p;
  }, [viewMethod, leaderboard]);

  const getAgentByHandle = useCallback(async (handle) => {
    return viewMethod(STAKING_CONTRACT, "get_agent_by_handle", { handle });
  }, [viewMethod]);

  const isHandleAvailable = useCallback(async (handle) => {
    const result = await viewMethod(STAKING_CONTRACT, "is_handle_available", { handle });
    // Contract not deployed yet: viewMethod returns null. Treat null as "don't
    // know, but let the UI continue" — register_agent will reject a collision.
    return result === null ? true : Boolean(result);
  }, [viewMethod]);

  const getPoints = useCallback(async (owner) => {
    const raw = await viewMethod(STAKING_CONTRACT, "get_points", { owner: owner || address });
    return raw ? BigInt(raw) : 0n;
  }, [viewMethod, address]);

  // Per-agent rolling stats: weekly points snapshots, submission counters,
  // missions completed, last-active, activity log. Returns null if the agent
  // has never had a stats-worthy action (brand-new profile).
  const getAgentStats = useCallback(async (owner) => {
    return viewMethod(STAKING_CONTRACT, "get_agent_stats", { owner: owner || address });
  }, [viewMethod, address]);

  const getAgentActivity = useCallback(async (owner, limit = 10) => {
    const rows = await viewMethod(STAKING_CONTRACT, "get_agent_activity", {
      owner: owner || address,
      limit,
    });
    return Array.isArray(rows) ? rows : [];
  }, [viewMethod, address]);

  // Orchestrator-only mutations. Exposed from the hook so the orchestrator UI
  // (or a test harness) can drive them; normal users won't have the auth.
  const recordSubmission = useCallback(async (owner, approved, description) => {
    return callMethod(STAKING_CONTRACT, "record_submission", {
      owner, approved, description,
    }, "0");
  }, [callMethod]);

  const recordMissionComplete = useCallback(async (owner, missionName, rewardPoints) => {
    return callMethod(STAKING_CONTRACT, "record_mission_complete", {
      owner,
      mission_name: missionName,
      reward_points: String(rewardPoints ?? 0),
    }, "0");
  }, [callMethod]);

  // Pro-tier derivation from real staking balance. Pro = user has any stake
  // in a pool with reward_multiplier >= 150 (i.e. the "committed" tiers).
  // Returns null while loading, false when not Pro, true when Pro.
  const getProStatus = useCallback(async (owner = address) => {
    if (!owner) return false;
    try {
      const poolsCount = await viewMethod(STAKING_CONTRACT, "get_pools_count", {});
      const count = Number(poolsCount || 0);
      for (let i = 0; i < count; i++) {
        const info = await viewMethod(STAKING_CONTRACT, "get_user_info", { account_id: owner, pool_id: i });
        if (info?.amount && BigInt(info.amount) > 0n) {
          const pool = await viewMethod(STAKING_CONTRACT, "get_pool", { pool_id: i });
          if ((pool?.reward_multiplier ?? 0) >= 150) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }, [viewMethod, address]);

  // ── Calls ────────────────────────────────────────────────────────────────

  const registerAgent = useCallback(async ({ handle, bio }) => {
    const res = await callMethod(STAKING_CONTRACT, "register_agent", {
      handle,
      bio: bio || null,
    }, "0");
    await fetchProfile();
    return res;
  }, [callMethod, fetchProfile]);

  const updateBio = useCallback(async (bio) => {
    const res = await callMethod(STAKING_CONTRACT, "update_agent_bio", { bio }, "0");
    await fetchProfile();
    return res;
  }, [callMethod, fetchProfile]);

  const setAgentAccount = useCallback(async (agentAccount) => {
    const res = await callMethod(STAKING_CONTRACT, "set_agent_account", {
      agent_account: agentAccount,
    }, "0");
    await fetchProfile();
    return res;
  }, [callMethod, fetchProfile]);

  // ── Sub-wallet creation ────────────────────────────────────────────────────
  // Build a single wallet-approval batch of two transactions:
  //   1. CreateAccount + Transfer(0.1 NEAR) + AddKey(scoped FC key) on agent.<owner>
  //   2. FunctionCall set_agent_account on ironshield.near
  // Private key is generated in-browser and stored in localStorage under the
  // owner's address. The FC key is scoped to STAKING_CONTRACT with a 0.25 NEAR
  // gas allowance — cannot transfer, cannot call other contracts, cannot drain.
  const getSubAccountId = useCallback((owner = address) => {
    if (!owner) return null;
    return `${AGENT_SUBACCOUNT_PREFIX}.${owner}`;
  }, [address]);

  const loadStoredAgentKey = useCallback((owner = address) => {
    if (!owner || typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(lsKey(owner));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [address]);

  const subAccountExists = useCallback(async (subAccountId) => {
    try {
      const account = await getReadAccount();
      await account.connection.provider.query({
        request_type: "view_account",
        finality: "optimistic",
        account_id: subAccountId,
      });
      return true;
    } catch (err) {
      const msg = err?.message || "";
      if (msg.includes("does not exist") || msg.includes("UNKNOWN_ACCOUNT")) return false;
      // Network or unknown error — treat as "can't confirm". Caller decides.
      throw err;
    }
  }, []);

  const linkSubWallet = useCallback(async () => {
    if (!address) throw new Error("Connect a wallet first");
    if (!selector) throw new Error("Wallet selector not initialized");

    const subAccountId = getSubAccountId(address);
    if (!subAccountId) throw new Error("Could not derive sub-account id");

    // Guard: if somebody (most likely the owner themself) has already created
    // agent.<owner> for an unrelated purpose, don't clobber it. The FC-key
    // AddKey would succeed anyway but the UX confusion isn't worth it.
    const exists = await subAccountExists(subAccountId);
    if (exists) {
      throw new Error(
        `${subAccountId} already exists. If this is a previous attempt, call set_agent_account directly with it; otherwise pick a new owner account.`
      );
    }

    // Generate the keypair client-side. near-api-js ships its own
    // cryptographically strong KeyPair.fromRandom.
    const { KeyPair } = await import("near-api-js");
    const keyPair  = KeyPair.fromRandom("ed25519");
    const publicKey  = keyPair.getPublicKey().toString();
    const privateKey = keyPair.toString(); // "ed25519:<bs58>"

    // Two transactions, one approval in the wallet modal.
    const transactions = [
      {
        signerId:   address,
        receiverId: subAccountId,
        actions: [
          { type: "CreateAccount" },
          {
            type: "Transfer",
            params: { deposit: SUBWALLET_INITIAL_NEAR },
          },
          {
            type: "AddKey",
            params: {
              publicKey,
              accessKey: {
                nonce: 0,
                permission: "FullAccess",
              },
            },
          },
        ],
      },
      {
        signerId:   address,
        receiverId: STAKING_CONTRACT,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "set_agent_account",
              args:       { agent_account: subAccountId },
              gas:        "30000000000000",
              deposit:    "0",
            },
          },
        ],
      },
    ];

    const wallet = await selector.wallet();
    const result = await wallet.signAndSendTransactions({ transactions });

    // Persist the private key only after the wallet actually returns success.
    // If the user rejects the modal we don't leave an orphan key on disk.
    try {
      window.localStorage.setItem(lsKey(address), JSON.stringify({
        owner:      address,
        subAccount: subAccountId,
        publicKey,
        privateKey,
        createdAt:  new Date().toISOString(),
        note:       "Scoped agent key. Calls ironshield.near only. 0.25 NEAR gas allowance.",
      }));
    } catch {
      // If localStorage is full or unavailable we still linked on-chain —
      // surface a warning in the returned object rather than rolling back.
      console.warn("Agent linked on-chain, but local key storage failed.");
    }

    await fetchProfile();
    return { subAccountId, publicKey, result };
  }, [address, selector, getSubAccountId, subAccountExists, fetchProfile]);

  // ── Orchestrator delegation ────────────────────────────────────────────────
  // Fetch the orchestrator account id from the contract + its public keys via
  // RPC. The dashboard picks one full-access key from the returned list (stable
  // across restarts) and delegates to it. Returns null if the orchestrator
  // account has no access keys or doesn't exist — UI surfaces a "not yet
  // configured" state in that case.
  const getOrchestratorInfo = useCallback(async () => {
    const orchestratorId = await viewMethod(STAKING_CONTRACT, "get_orchestrator", {});
    if (!orchestratorId) return null;

    try {
      const account = await getReadAccount();
      const res = await account.connection.provider.query({
        request_type: "view_access_key_list",
        finality:     "optimistic",
        account_id:   orchestratorId,
      });
      // Each entry: { public_key: "ed25519:...", access_key: { nonce, permission: "FullAccess" | { FunctionCall: {...} } } }
      const keys = Array.isArray(res?.keys) ? res.keys : [];
      return { orchestratorId, keys };
    } catch (err) {
      console.warn("getOrchestratorInfo access-key fetch failed:", err?.message || err);
      return { orchestratorId, keys: [] };
    }
  }, [viewMethod]);

  // Delegate: the sub-wallet (not the owner) signs an AddKey tx that attaches
  // the orchestrator's public key as an FC-scoped key on the sub-account. Uses
  // the private key we stored on link; requires the owner to have linked first.
  const delegateToOrchestrator = useCallback(async (orchestratorPublicKey) => {
    if (!address) throw new Error("Connect a wallet first");
    if (!orchestratorPublicKey) throw new Error("No orchestrator public key supplied");

    const stored = loadStoredAgentKey(address);
    if (!stored?.privateKey || !stored?.subAccount) {
      throw new Error("No stored agent key for this owner. Link the sub-wallet first.");
    }

    const { KeyPair, keyStores, connect } = await import("near-api-js");
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair  = KeyPair.fromString(stored.privateKey);
    await keyStore.setKey("mainnet", stored.subAccount, keyPair);

    const near = await connect({
      networkId: "mainnet",
      nodeUrl:   "https://rpc.fastnear.com",
      keyStore,
    });
    const subAccount = await near.account(stored.subAccount);

    // In near-api-js v6, account.addKey(publicKey, contractId, methodNames, amount)
    // issues a FunctionCall-scoped AddKey. Using the higher-level helper avoids
    // hand-building the action payload.
    const result = await subAccount.addKey(
      orchestratorPublicKey,
      STAKING_CONTRACT,
      [], // all methods on ironshield.near
      BigInt(DELEGATED_FC_KEY_ALLOWANCE),
    );

    return { orchestratorPublicKey, result };
  }, [address, loadStoredAgentKey]);

  // Inverse: remove a previously-delegated key from the sub-wallet. Lets the
  // owner revoke the orchestrator without wiping the whole sub-wallet.
  const revokeDelegatedKey = useCallback(async (publicKey) => {
    if (!address) throw new Error("Connect a wallet first");
    const stored = loadStoredAgentKey(address);
    if (!stored?.privateKey || !stored?.subAccount) {
      throw new Error("No stored agent key for this owner.");
    }

    const { KeyPair, keyStores, connect } = await import("near-api-js");
    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey("mainnet", stored.subAccount, KeyPair.fromString(stored.privateKey));

    const near = await connect({
      networkId: "mainnet",
      nodeUrl:   "https://rpc.fastnear.com",
      keyStore,
    });
    const subAccount = await near.account(stored.subAccount);
    return subAccount.deleteKey(publicKey);
  }, [address, loadStoredAgentKey]);

  // List the sub-wallet's current access keys so the dashboard can show which
  // keys are attached (and whether the orchestrator is already delegated).
  const listSubWalletKeys = useCallback(async (owner = address) => {
    const subAccountId = getSubAccountId(owner);
    if (!subAccountId) return null;
    try {
      const account = await getReadAccount();
      const res = await account.connection.provider.query({
        request_type: "view_access_key_list",
        finality:     "optimistic",
        account_id:   subAccountId,
      });
      return Array.isArray(res?.keys) ? res.keys : [];
    } catch (err) {
      const msg = err?.message || "";
      if (msg.includes("does not exist") || msg.includes("UNKNOWN_ACCOUNT")) return [];
      throw err;
    }
  }, [address, getSubAccountId]);

  // Auto-load on address change so EarnPage doesn't need to orchestrate.
  useEffect(() => {
    if (!address) { setProfile(null); return; }
    fetchProfile().catch((err) => console.warn("useAgent fetchProfile:", err?.message || err));
  }, [address, fetchProfile]);

  return {
    // profile
    profile,
    profileLoading,
    hasAgent: Boolean(profile),
    fetchProfile,
    registerAgent,
    updateBio,
    setAgentAccount,
    // sub-wallet
    linkSubWallet,
    getSubAccountId,
    loadStoredAgentKey,
    // orchestrator delegation
    getOrchestratorInfo,
    delegateToOrchestrator,
    revokeDelegatedKey,
    listSubWalletKeys,
    // lookups
    getAgentByHandle,
    isHandleAvailable,
    getPoints,
    getAgentStats,
    getAgentActivity,
    getProStatus,
    // orchestrator-only mutations
    recordSubmission,
    recordMissionComplete,
    // leaderboard
    leaderboard,
    leaderboardLoading,
    fetchLeaderboard,
  };
}
