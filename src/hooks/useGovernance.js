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

  const createProposal = useCallback(async (type, title, content) => {
    return callMethod(STAKING_CONTRACT, "create_proposal", {
      proposal_type: type,
      title,
      content,
    }, "0");
  }, [callMethod]);

  const vote = useCallback(async (proposalId, voteFor) => {
    return callMethod(STAKING_CONTRACT, "vote", {
      proposal_id: proposalId,
      vote_for: voteFor,
    }, "0");
  }, [callMethod]);

  const executeProposal = useCallback(async (proposalId) => {
    return callMethod(STAKING_CONTRACT, "execute_proposal", {
      proposal_id: proposalId,
    }, "0");
  }, [callMethod]);

  return { proposals, loading, refreshProposals, createProposal, vote, executeProposal };
}
