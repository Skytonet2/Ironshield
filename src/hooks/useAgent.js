"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import useNear, { STAKING_CONTRACT } from "./useNear";
import { useWallet, getReadAccount } from "@/lib/contexts";
import { NETWORK_ID, NODE_URL } from "@/lib/nearConfig";

const LEADERBOARD_TTL_MS = 30_000;

// ── Phase 7 Sub-PR B: capability bitmask (mirrors contract/src/agents.rs) ──
// Bit positions MUST stay in lockstep with PERM_* on the contract side —
// changing either without the other silently miscomputes the mask.
export const PERM = {
  READ_DATA:   1 << 0,
  SIGN_TX:     1 << 1,
  INTERACT:    1 << 2,
  SEND_MSG:    1 << 3,
  TRANSFER:    1 << 4,
};
export const PERM_ALL = PERM.READ_DATA | PERM.SIGN_TX | PERM.INTERACT | PERM.SEND_MSG | PERM.TRANSFER;
export const PERM_DEFAULT = PERM.READ_DATA;

// ── Sub-wallet constants ─────────────────────────────────────────────────────
// Primary platform agent sub-wallet. `agent.<owner>` is the single agent the
// owner registered pre-Phase-7C and remains the default when someone clicks
// "link sub-wallet" without specifying an index.
const AGENT_SUBACCOUNT_PREFIX = "agent";

// Phase 7C multi-agent: secondary sub-wallets are named `agent<N>.<owner>`
// with N = 2, 3, ... Index 1 is reserved for the primary (no suffix) so
// the frontend can compute the next free slot without a view call.
const subAgentSubAccountId = (owner, index) => {
  if (!owner || !index) return null;
  if (index === 1) return `${AGENT_SUBACCOUNT_PREFIX}.${owner}`;
  return `${AGENT_SUBACCOUNT_PREFIX}${index}.${owner}`;
};

// Phase 7C: cap mirrors the contract constant MAX_SUB_AGENTS_PER_OWNER.
// Change together with contract/src/agents.rs — the contract rejects the
// N+1'th registration, so a UI drift just means a wasted wallet prompt.
export const MAX_SUB_AGENTS_PER_OWNER = 10;

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

  // ── Phase 5: tasks ──────────────────────────────────────────────────────
  const assignTask = useCallback(async ({ description, missionId = null }) => {
    return callMethod(STAKING_CONTRACT, "assign_task", {
      description,
      mission_id: missionId,
    }, "0");
  }, [callMethod]);

  const cancelTask = useCallback(async (taskId) => {
    return callMethod(STAKING_CONTRACT, "cancel_task", { task_id: Number(taskId) }, "0");
  }, [callMethod]);

  const completeTask = useCallback(async (owner, taskId, success, result) => {
    return callMethod(STAKING_CONTRACT, "complete_task", {
      owner, task_id: Number(taskId), success, result: result || "",
    }, "0");
  }, [callMethod]);

  const getAgentTasks = useCallback(async (owner = address) => {
    if (!owner) return [];
    const rows = await viewMethod(STAKING_CONTRACT, "get_agent_tasks", { owner });
    return Array.isArray(rows) ? rows : [];
  }, [viewMethod, address]);

  // ── Phase 5: IronClaw subscription + public toggle ──────────────────────
  const setSubscription = useCallback(async (enable) => {
    return callMethod(STAKING_CONTRACT, "set_subscription", { enable: Boolean(enable) }, "0");
  }, [callMethod]);

  const setPublicFlag = useCallback(async (isPublic) => {
    return callMethod(STAKING_CONTRACT, "set_public", { public: Boolean(isPublic) }, "0");
  }, [callMethod]);

  const getAgentFlags = useCallback(async (owner = address) => {
    if (!owner) return { public: false, subscribed_to_ironclaw: false };
    const flags = await viewMethod(STAKING_CONTRACT, "get_agent_flags", { owner });
    return flags || { public: false, subscribed_to_ironclaw: false };
  }, [viewMethod, address]);

  const getPublicAgents = useCallback(async ({ limit = 50, offset = 0 } = {}) => {
    const rows = await viewMethod(STAKING_CONTRACT, "get_public_agents", { limit, offset });
    return Array.isArray(rows) ? rows : [];
  }, [viewMethod]);

  // ── Phase 5 + Phase 7 (Sub-PR A): skills marketplace ────────────────────
  // Phase 7 widens `create_skill` with category/tags/image_url and makes
  // `install_skill` payable. The old signature still accepts a bare
  // {name, description, priceYocto} — the new metadata params are
  // optional so existing callers don't break.
  const createSkill = useCallback(async ({
    name, description, priceYocto = "0",
    category = "", tags = [], imageUrl = "",
  }) => {
    return callMethod(STAKING_CONTRACT, "create_skill", {
      name, description,
      price_yocto: String(priceYocto),
      category,
      tags:      Array.isArray(tags) ? tags : [],
      image_url: imageUrl,
    }, "0");
  }, [callMethod]);

  // Phase 7 + Day 15: install_skill is payable. Attach deposit >=
  // price_yocto. The contract splits 85/15 (author/platform — was 99/1
  // through Phase 9) and refunds any overpay back to the caller.
  const installSkill = useCallback(async (skillId, priceYocto = "0") => {
    return callMethod(
      STAKING_CONTRACT,
      "install_skill",
      { skill_id: Number(skillId) },
      String(priceYocto ?? "0"),
    );
  }, [callMethod]);

  const uninstallSkill = useCallback(async (skillId) => {
    return callMethod(STAKING_CONTRACT, "uninstall_skill", { skill_id: Number(skillId) }, "0");
  }, [callMethod]);

  // Phase 7: authors can update their own skill's metadata (category /
  // tags / image). Verified stays sticky — only the contract owner can
  // flip it via set_skill_verified.
  const updateSkillMetadata = useCallback(async ({ skillId, category = "", tags = [], imageUrl = "" }) => {
    return callMethod(STAKING_CONTRACT, "update_skill_metadata", {
      skill_id:  Number(skillId),
      category,
      tags:      Array.isArray(tags) ? tags : [],
      image_url: imageUrl,
    }, "0");
  }, [callMethod]);

  // Phase 7 owner-only: toggle a skill's verified flag. Exposed for
  // completeness; the admin UI will gate it on address === owner_id.
  const setSkillVerified = useCallback(async (skillId, verified) => {
    return callMethod(STAKING_CONTRACT, "set_skill_verified", {
      skill_id: Number(skillId),
      verified: Boolean(verified),
    }, "0");
  }, [callMethod]);

  const listSkills = useCallback(async ({ limit = 50, offset = 0 } = {}) => {
    const rows = await viewMethod(STAKING_CONTRACT, "list_skills", { limit, offset });
    return Array.isArray(rows) ? rows : [];
  }, [viewMethod]);

  // Phase 7: joined fetch that returns [skill, metadata|null] tuples.
  // Prefer this over list_skills for anything that renders category /
  // tags / verified — it avoids the N+1 per-skill metadata lookup.
  const listSkillsWithMetadata = useCallback(async ({ limit = 50, offset = 0 } = {}) => {
    const rows = await viewMethod(STAKING_CONTRACT, "list_skills_with_metadata", { limit, offset });
    if (!Array.isArray(rows)) return [];
    return rows.map(([skill, metadata]) => ({ skill, metadata: metadata || null }));
  }, [viewMethod]);

  const getInstalledSkills = useCallback(async (owner = address) => {
    if (!owner) return [];
    const rows = await viewMethod(STAKING_CONTRACT, "get_installed_skills", { owner });
    return Array.isArray(rows) ? rows : [];
  }, [viewMethod, address]);

  const getInstalledSkillsWithMetadata = useCallback(async (owner = address) => {
    if (!owner) return [];
    const rows = await viewMethod(STAKING_CONTRACT, "get_installed_skills_with_metadata", { owner });
    if (!Array.isArray(rows)) return [];
    return rows.map(([skill, metadata]) => ({ skill, metadata: metadata || null }));
  }, [viewMethod, address]);

  const getSkill = useCallback(async (skillId) => {
    return viewMethod(STAKING_CONTRACT, "get_skill", { skill_id: Number(skillId) });
  }, [viewMethod]);

  const getSkillMetadata = useCallback(async (skillId) => {
    return viewMethod(STAKING_CONTRACT, "get_skill_metadata", { skill_id: Number(skillId) });
  }, [viewMethod]);

  // ── Phase 6: link existing IronClaw agent ───────────────────────────────
  const linkToIronclaw = useCallback(async (source) => {
    return callMethod(STAKING_CONTRACT, "link_to_ironclaw", { source }, "0");
  }, [callMethod]);

  const unlinkFromIronclaw = useCallback(async () => {
    return callMethod(STAKING_CONTRACT, "unlink_from_ironclaw", {}, "0");
  }, [callMethod]);

  const getIronclawSource = useCallback(async (owner = address) => {
    if (!owner) return null;
    return viewMethod(STAKING_CONTRACT, "get_ironclaw_source", { owner });
  }, [viewMethod, address]);

  // ── Phase 7 Sub-PR B: agent permissions + daily spend limit ─────────────
  // The mask is a u8 bitmask. Consumer code can import PERM from this file
  // rather than guessing the bit positions — keeps the constant list in
  // sync with the contract's PERM_* declarations in agents.rs.
  const setAgentPermissions = useCallback(async (mask) => {
    return callMethod(STAKING_CONTRACT, "set_agent_permissions", {
      mask: Number(mask) & 0xff,
    }, "0");
  }, [callMethod]);

  const setAgentDailyLimit = useCallback(async (yocto) => {
    return callMethod(STAKING_CONTRACT, "set_agent_daily_limit", {
      daily_limit_yocto: String(yocto ?? "0"),
    }, "0");
  }, [callMethod]);

  const getAgentPermissions = useCallback(async (owner = address) => {
    if (!owner) return null;
    return viewMethod(STAKING_CONTRACT, "get_agent_permissions", { owner });
  }, [viewMethod, address]);

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
    const naj = await import("near-api-js");
    const { KeyPair, transactions: tx, utils: { PublicKey } } = naj;
    const keyPair   = KeyPair.fromRandom("ed25519");
    const publicKey = keyPair.getPublicKey().toString();
    const privateKey = keyPair.toString(); // "ed25519:<bs58>"

    // Two transactions, one approval in the wallet modal. Actions are NAJ
    // Action instances — wallet-selector v10 adapters call najActionToInternal
    // on what we pass in, so plain {type,params} objects fail with
    // "Unsupported NAJ action". We use transactions.* action creators.
    const transactions = [
      {
        signerId:   address,
        receiverId: subAccountId,
        actions: [
          tx.createAccount(),
          tx.transfer(BigInt(SUBWALLET_INITIAL_NEAR)),
          tx.addKey(PublicKey.from(publicKey), tx.fullAccessKey()),
        ],
      },
      {
        signerId:   address,
        receiverId: STAKING_CONTRACT,
        actions: [
          tx.functionCall(
            "set_agent_account",
            { agent_account: subAccountId },
            30_000_000_000_000n,
            0n,
          ),
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

  // ── Phase 8: external-framework connections ─────────────────────────────
  // Auth tokens never go on-chain — those stay in the backend connection
  // store. This map only holds the public binding so the framework an
  // agent runs on is auditable. The wizard's launch flow calls both the
  // on-chain set_agent_connection AND the backend's /api/agents/connect
  // (which carries the auth blob, encrypted at rest).

  const setAgentConnection = useCallback(async ({
    agent_account, framework, external_id = "", endpoint = "", meta = null,
  }) => {
    return callMethod(STAKING_CONTRACT, "set_agent_connection", {
      agent_account, framework,
      external_id,
      endpoint,
      meta,
    }, "0");
  }, [callMethod]);

  const removeAgentConnection = useCallback(async ({ agent_account, framework }) => {
    return callMethod(STAKING_CONTRACT, "remove_agent_connection", {
      agent_account, framework,
    }, "0");
  }, [callMethod]);

  const getAgentConnections = useCallback(async (agent_account) => {
    if (!agent_account) return [];
    const rows = await viewMethod(STAKING_CONTRACT, "get_agent_connections", { agent_account });
    return Array.isArray(rows) ? rows : [];
  }, [viewMethod]);

  const listAgentConnectionsForOwner = useCallback(async (owner = address) => {
    if (!owner) return [];
    const rows = await viewMethod(STAKING_CONTRACT, "list_agent_connections_for_owner", { owner });
    // Each entry is [agent_account, AgentConnection].
    return Array.isArray(rows) ? rows.map(([acct, conn]) => ({ agent_account: acct, ...conn })) : [];
  }, [viewMethod, address]);

  // ── Phase 7 Sub-PR C: multi-agent per wallet ─────────────────────────────
  // Secondary agents live on separate NEAR sub-accounts named agent<N>.<owner>
  // with N = 2, 3, ... Each one carries its own handle + bio + points ledger
  // on-chain. The primary (original) agent keeps its own map — views split
  // cleanly: `getAgent(owner)` for primary, `listSubAgents(owner)` for extras.

  const listSubAgents = useCallback(async (owner = address) => {
    if (!owner) return [];
    const rows = await viewMethod(STAKING_CONTRACT, "list_sub_agents", { owner });
    return Array.isArray(rows) ? rows : [];
  }, [viewMethod, address]);

  const getSubAgent = useCallback(async (owner, agentAccount) => {
    if (!owner || !agentAccount) return null;
    return viewMethod(STAKING_CONTRACT, "get_sub_agent", {
      owner,
      agent_account: agentAccount,
    });
  }, [viewMethod]);

  const updateSubAgentBio = useCallback(async (agentAccount, bio) => {
    return callMethod(STAKING_CONTRACT, "update_sub_agent_bio", {
      agent_account: agentAccount,
      bio: bio || "",
    }, "0");
  }, [callMethod]);

  const removeSubAgent = useCallback(async (agentAccount) => {
    return callMethod(STAKING_CONTRACT, "remove_sub_agent", {
      agent_account: agentAccount,
    }, "0");
  }, [callMethod]);

  // Create a new sub-agent end-to-end in a single wallet approval batch:
  //   1. CreateAccount agent<N>.<owner> + transfer 0.1 NEAR + AddKey
  //      (full-access, generated client-side, stored in localStorage
  //      keyed by the sub-account id)
  //   2. FunctionCall register_sub_agent on ironshield.near
  //
  // `index` defaults to the next free slot = existing_sub_agents.length + 2
  // (skipping 1 because `agent.<owner>` is the primary's slot). Callers
  // that want to force a specific index can pass it explicitly.
  const createSubAgent = useCallback(async ({ handle, bio = "", index } = {}) => {
    if (!address) throw new Error("Connect a wallet first");
    if (!selector) throw new Error("Wallet selector not initialized");
    if (!handle || handle.length < 3) throw new Error("Handle required (min 3 chars)");

    let idx = Number(index);
    if (!Number.isFinite(idx) || idx < 2) {
      const existing = await listSubAgents(address);
      idx = existing.length + 2;
    }
    if (idx > MAX_SUB_AGENTS_PER_OWNER + 1) {
      throw new Error(`Sub-agent limit reached (${MAX_SUB_AGENTS_PER_OWNER}).`);
    }
    const subAccountId = subAgentSubAccountId(address, idx);
    if (!subAccountId) throw new Error("Could not derive sub-account id");

    const exists = await subAccountExists(subAccountId).catch(() => false);
    if (exists) {
      throw new Error(
        `${subAccountId} already exists. Either remove the prior sub-agent or pick a different index.`
      );
    }

    const naj = await import("near-api-js");
    const { KeyPair, transactions: tx, utils: { PublicKey } } = naj;
    const keyPair   = KeyPair.fromRandom("ed25519");
    const publicKey = keyPair.getPublicKey().toString();
    const privateKey = keyPair.toString();

    const transactions = [
      {
        signerId:   address,
        receiverId: subAccountId,
        actions: [
          tx.createAccount(),
          tx.transfer(BigInt(SUBWALLET_INITIAL_NEAR)),
          tx.addKey(PublicKey.from(publicKey), tx.fullAccessKey()),
        ],
      },
      {
        signerId:   address,
        receiverId: STAKING_CONTRACT,
        actions: [
          tx.functionCall(
            "register_sub_agent",
            { agent_account: subAccountId, handle, bio: bio || null },
            30_000_000_000_000n,
            0n,
          ),
        ],
      },
    ];

    const wallet = await selector.wallet();
    const result = await wallet.signAndSendTransactions({ transactions });

    try {
      window.localStorage.setItem(lsKey(subAccountId), JSON.stringify({
        owner:      address,
        subAccount: subAccountId,
        publicKey,
        privateKey,
        createdAt:  new Date().toISOString(),
        note:       "Phase 7C sub-agent key. 0.1 NEAR initial balance; full-access key lives in browser only.",
      }));
    } catch {
      console.warn("Sub-agent linked on-chain, but local key storage failed.");
    }

    return { subAccountId, publicKey, index: idx, result };
  }, [address, selector, listSubAgents, subAccountExists]);

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
    await keyStore.setKey(NETWORK_ID, stored.subAccount, keyPair);

    const near = await connect({
      networkId: NETWORK_ID,
      nodeUrl:   NODE_URL,
      keyStore,
    });
    const subAccount = await near.account(stored.subAccount);

    // In near-api-js v6, account.addKey(publicKey, contractId, methodNames, amount)
    // issues a FunctionCall-scoped AddKey. Using the higher-level helper avoids
    // hand-building the action payload.
    const result = await subAccount.addKey(
      orchestratorPublicKey,
      STAKING_CONTRACT,
      [], // all methods on the staking contract
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
    await keyStore.setKey(NETWORK_ID, stored.subAccount, KeyPair.fromString(stored.privateKey));

    const near = await connect({
      networkId: NETWORK_ID,
      nodeUrl:   NODE_URL,
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
    // Phase 5: tasks
    assignTask, cancelTask, completeTask, getAgentTasks,
    // Phase 5: IronClaw subscription + public directory
    setSubscription, setPublicFlag, getAgentFlags, getPublicAgents,
    // Phase 5 + Phase 7: skills marketplace
    createSkill, installSkill, uninstallSkill,
    listSkills, getInstalledSkills, getSkill,
    // Phase 7 additions
    updateSkillMetadata, setSkillVerified,
    listSkillsWithMetadata, getInstalledSkillsWithMetadata,
    getSkillMetadata,
    // Phase 6: link to existing IronClaw agent
    linkToIronclaw, unlinkFromIronclaw, getIronclawSource,
    // Phase 7 Sub-PR B: agent capability mask + daily spend limit
    setAgentPermissions, setAgentDailyLimit, getAgentPermissions,
    // Phase 7 Sub-PR C: multi-agent per wallet
    listSubAgents, getSubAgent, createSubAgent, updateSubAgentBio, removeSubAgent,
    // Phase 8: external-framework connections
    setAgentConnection, removeAgentConnection, getAgentConnections, listAgentConnectionsForOwner,
    // leaderboard
    leaderboard,
    leaderboardLoading,
    fetchLeaderboard,
  };
}
