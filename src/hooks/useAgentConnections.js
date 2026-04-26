"use client";
// useAgentConnections — backend-side companion to useAgent. Manages
// the per-agent framework connections (OpenClaw / IronClaw / self-
// hosted) that the wizard captures and the dashboard reads. Lives off
// the on-chain identity: connections are keyed by (owner,
// agent_account, framework), and on-chain register_agent /
// register_sub_agent stays the source of truth for who owns what.

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";
import { useWallet } from "@/lib/contexts";
import useNear, { STAKING_CONTRACT } from "@/hooks/useNear";

// Frameworks are loaded from the backend's /api/agents/frameworks
// route — no hardcoded fallback. Wizard renders an empty state if
// the backend is unreachable, which is the honest signal.

export default function useAgentConnections({ agentAccount } = {}) {
  const { address } = useWallet();
  // useNear's viewMethod is a fresh closure on every wallet-context
  // render; pin it via ref so reload's identity stays stable across
  // renders. Listing it as a dep would trigger an infinite update
  // loop (effect → setState → re-render → new viewMethod → effect …).
  const { viewMethod } = useNear();
  const viewMethodRef = useRef(viewMethod);
  viewMethodRef.current = viewMethod;
  const [frameworks, setFrameworks] = useState([]);
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
    setLoading(true);
    setError(null);
    try {
      // Pull both sources in parallel: chain holds the canonical public
      // binding (Phase 8); backend holds the auth blob + last-poll
      // status. Merge by (agent_account, framework) so the dashboard
      // shows a single row per binding even when one side hasn't
      // caught up yet.
      const apiUrl = agentAccount
        ? `${API}/api/agents/connections/${encodeURIComponent(agentAccount)}`
        : `${API}/api/agents/connections?owner=${encodeURIComponent(address)}`;
      const apiPromise = API
        ? fetch(apiUrl).then(r => r.ok ? r.json() : { connections: [] }).catch(() => ({ connections: [] }))
        : Promise.resolve({ connections: [] });
      const chainPromise = (async () => {
        const view = viewMethodRef.current;
        if (!view) return [];
        if (agentAccount) {
          const rows = await view(STAKING_CONTRACT, "get_agent_connections", { agent_account: agentAccount }).catch(() => null);
          return Array.isArray(rows) ? rows.map(c => ({ agent_account: agentAccount, ...c })) : [];
        }
        if (address) {
          const rows = await view(STAKING_CONTRACT, "list_agent_connections_for_owner", { owner: address }).catch(() => null);
          return Array.isArray(rows) ? rows.map(([acct, c]) => ({ agent_account: acct, ...c })) : [];
        }
        return [];
      })();

      const [apiRes, chainRows] = await Promise.all([apiPromise, chainPromise]);
      const apiRows = Array.isArray(apiRes?.connections) ? apiRes.connections : [];

      // Merge: chain row first (so public binding is canonical), then
      // overlay backend's status / has_auth where the same key exists.
      const byKey = new Map();
      for (const c of chainRows) {
        byKey.set(`${c.agent_account}:${c.framework}`, {
          agent_account: c.agent_account,
          framework:     c.framework,
          external_id:   c.external_id || null,
          endpoint:      c.endpoint    || null,
          status:        "on_chain",
          source:        "chain",
          last_seen_ns:  c.last_seen   || 0,
          meta:          c.meta        || "",
          has_auth:      false,
        });
      }
      for (const r of apiRows) {
        const k = `${r.agent_account}:${r.framework}`;
        const existing = byKey.get(k);
        byKey.set(k, {
          ...(existing || {}),
          ...r,
          source: existing ? "both" : "backend",
        });
      }
      setConnections(Array.from(byKey.values()));
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
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await apiFetch(`/api/agents/validate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ framework, external_id, endpoint, auth }),
    });
    return r.json();
  }, [address]);

  const connect = useCallback(async ({
    agent_account, framework, external_id, endpoint, auth, meta,
  }) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await apiFetch(`/api/agents/connect`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
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
    const r = await apiFetch(`/api/agents/connect`, {
      method:  "DELETE",
      headers: { "Content-Type": "application/json" },
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
    const r = await apiFetch(`/api/agents/sandbox`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
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
