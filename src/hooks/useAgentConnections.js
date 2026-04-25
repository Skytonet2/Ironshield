"use client";
// useAgentConnections — backend-side companion to useAgent. Manages
// the per-agent framework connections (OpenClaw / IronClaw / self-
// hosted) that the wizard captures and the dashboard reads. Lives off
// the on-chain identity: connections are keyed by (owner,
// agent_account, framework), and on-chain register_agent /
// register_sub_agent stays the source of truth for who owns what.

import { useCallback, useEffect, useState } from "react";
import { API_BASE as API } from "@/lib/apiBase";
import { useWallet } from "@/lib/contexts";

const FRAMEWORK_FALLBACK = [
  { key: "openclaw",    display: "OpenClaw",    docs_url: "https://openclaw.ai/docs" },
  { key: "ironclaw",    display: "IronClaw",    docs_url: "https://docs.near.ai/agents/quickstart" },
  { key: "self_hosted", display: "Self-hosted", docs_url: "https://hermes-agent.nousresearch.com/" },
];

export default function useAgentConnections({ agentAccount } = {}) {
  const { address } = useWallet();
  const [frameworks, setFrameworks] = useState(FRAMEWORK_FALLBACK);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  // Fetch the framework list once. The backend's source of truth wins
  // when reachable; the fallback above keeps the wizard usable when
  // the backend is unavailable (e.g. local dev with no API up).
  useEffect(() => {
    if (!API) return;
    (async () => {
      try {
        const r = await fetch(`${API}/api/agents/frameworks`);
        if (!r.ok) return;
        const j = await r.json();
        if (Array.isArray(j?.frameworks) && j.frameworks.length) setFrameworks(j.frameworks);
      } catch { /* leave fallback */ }
    })();
  }, []);

  const reload = useCallback(async () => {
    if (!address && !agentAccount) { setConnections([]); return; }
    if (!API) { setConnections([]); return; }
    setLoading(true);
    setError(null);
    try {
      const url = agentAccount
        ? `${API}/api/agents/connections/${encodeURIComponent(agentAccount)}`
        : `${API}/api/agents/connections?owner=${encodeURIComponent(address)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setConnections(Array.isArray(j?.connections) ? j.connections : []);
    } catch (e) {
      setError(e?.message || "Failed to load connections");
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [address, agentAccount]);

  useEffect(() => { reload(); }, [reload]);

  /** Test credentials without persisting (wizard's "Test connection"). */
  const validate = useCallback(async ({ framework, external_id, endpoint, auth }) => {
    if (!API) throw new Error("Backend not reachable");
    const r = await fetch(`${API}/api/agents/validate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ framework, external_id, endpoint, auth }),
    });
    return r.json();
  }, []);

  const connect = useCallback(async ({
    agent_account, framework, external_id, endpoint, auth, meta,
  }) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await fetch(`${API}/api/agents/connect`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-wallet": address },
      body:    JSON.stringify({
        owner: address, agent_account, framework, external_id, endpoint, auth, meta,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `Connect failed (HTTP ${r.status})`);
    await reload();
    return j;
  }, [address, reload]);

  const disconnect = useCallback(async ({ agent_account, framework }) => {
    if (!API) throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await fetch(`${API}/api/agents/connect`, {
      method:  "DELETE",
      headers: { "Content-Type": "application/json", "x-wallet": address },
      body:    JSON.stringify({ owner: address, agent_account, framework }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error || `Disconnect failed (HTTP ${r.status})`);
    }
    await reload();
    return true;
  }, [address, reload]);

  const sandbox = useCallback(async ({
    agent_account, framework, message, systemPrompt, meta,
  }) => {
    if (!API) throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await fetch(`${API}/api/agents/sandbox`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-wallet": address },
      body:    JSON.stringify({
        owner: address, agent_account, framework, message, systemPrompt, meta,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `Sandbox failed (HTTP ${r.status})`);
    return j;
  }, [address]);

  return {
    frameworks,
    connections,
    loading,
    error,
    reload,
    validate,
    connect,
    disconnect,
    sandbox,
  };
}
