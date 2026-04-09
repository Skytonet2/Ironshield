"use client";
import { useState, useCallback } from "react";
import useNear, { STAKING_CONTRACT } from "./useNear";

export default function useGovernance() {
  const { viewMethod, callMethod } = useNear();
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading]     = useState(false);

  const refreshProposals = useCallback(async () => {
    setLoading(true);
    try {
      const all = await viewMethod(STAKING_CONTRACT, "get_proposals", {});
      setProposals(all || []);
    } catch (err) {
      console.error("useGovernance fetchProposals:", err);
    } finally {
      setLoading(false);
    }
  }, [viewMethod]);

  const createProposal = useCallback(async (type, title, content, description = "") => {
    return callMethod(STAKING_CONTRACT, "create_proposal", {
      proposal_type: type,
      title,
      description,
      content,
    }, "0");
  }, [callMethod]);

  const vote = useCallback(async (proposalId, voteFor) => {
    return callMethod(STAKING_CONTRACT, "vote", {
      proposal_id: proposalId,
      vote:        voteFor ? "for" : "against",
    }, "0");
  }, [callMethod]);

  const executeProposal = useCallback(async (proposalId) => {
    return callMethod(STAKING_CONTRACT, "execute_proposal", {
      proposal_id: proposalId,
    }, "0");
  }, [callMethod]);

  // ── Pre-token governance ──────────────────────────────────────
  const getPretokenMode = useCallback(async () => {
    return viewMethod(STAKING_CONTRACT, "get_pretoken_mode", {});
  }, [viewMethod]);

  const setPretokenMode = useCallback(async (enabled) => {
    return callMethod(STAKING_CONTRACT, "set_pretoken_mode", { enabled }, "0");
  }, [callMethod]);

  const getPendingApplications = useCallback(async () => {
    return viewMethod(STAKING_CONTRACT, "get_pending_applications", {});
  }, [viewMethod]);

  const getContributors = useCallback(async () => {
    return viewMethod(STAKING_CONTRACT, "get_contributors", {});
  }, [viewMethod]);

  const requestContributor = useCallback(async (telegram, reason) => {
    return callMethod(STAKING_CONTRACT, "request_contributor", { telegram, reason }, "0");
  }, [callMethod]);

  const approveContributor = useCallback(async (accountId) => {
    return callMethod(STAKING_CONTRACT, "approve_contributor", { account_id: accountId }, "0");
  }, [callMethod]);

  const rejectContributor = useCallback(async (accountId) => {
    return callMethod(STAKING_CONTRACT, "reject_contributor", { account_id: accountId }, "0");
  }, [callMethod]);

  const revokeContributor = useCallback(async (accountId) => {
    return callMethod(STAKING_CONTRACT, "revoke_contributor", { account_id: accountId }, "0");
  }, [callMethod]);

  // ── Vanguard ──────────────────────────────────────────────────
  const getVanguardNftContracts = useCallback(async () => {
    return viewMethod(STAKING_CONTRACT, "get_vanguard_nft_contracts", {});
  }, [viewMethod]);

  const getVanguardTokenIdMax = useCallback(async () => {
    return viewMethod(STAKING_CONTRACT, "get_vanguard_token_id_max", {});
  }, [viewMethod]);

  const addVanguardNftContract = useCallback(async (contractId) => {
    return callMethod(STAKING_CONTRACT, "add_vanguard_nft_contract", { contract_id: contractId }, "0");
  }, [callMethod]);

  const setVanguardTokenIdMax = useCallback(async (max) => {
    return callMethod(STAKING_CONTRACT, "set_vanguard_token_id_max", { max }, "0");
  }, [callMethod]);

  const registerVanguard = useCallback(async (nftContract, tokenId) => {
    return callMethod(STAKING_CONTRACT, "register_vanguard", {
      nft_contract: nftContract,
      token_id:     tokenId,
    }, "0");
  }, [callMethod]);

  const revokeVanguard = useCallback(async (accountId) => {
    return callMethod(STAKING_CONTRACT, "revoke_vanguard", { account_id: accountId }, "0");
  }, [callMethod]);

  return {
    proposals, loading,
    refreshProposals, createProposal, vote, executeProposal,
    // pretoken
    getPretokenMode, setPretokenMode,
    getPendingApplications, getContributors,
    requestContributor, approveContributor, rejectContributor, revokeContributor,
    // vanguard
    getVanguardNftContracts, getVanguardTokenIdMax,
    addVanguardNftContract, setVanguardTokenIdMax,
    registerVanguard, revokeVanguard,
  };
}
