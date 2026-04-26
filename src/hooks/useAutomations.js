"use client";
// useAutomations — list / create / update / delete / fire automation
// rules attached to one agent. Keyed by agent_account; the owner is
// taken from the connected wallet at call time.

import { useCallback, useEffect, useState } from "react";
import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";
import { useWallet } from "@/lib/contexts";

export default function useAutomations({ agentAccount } = {}) {
  const { address } = useWallet();
  const [rules, setRules]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  const reload = useCallback(async () => {
    if (!agentAccount || !API) { setRules([]); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/agents/automations/${encodeURIComponent(agentAccount)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRules(Array.isArray(j?.automations) ? j.automations : []);
    } catch (e) {
      setError(e?.message || "Failed to load automations");
      setRules([]);
    } finally { setLoading(false); }
  }, [agentAccount]);

  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async ({ name, description, trigger, action, enabled }) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await apiFetch(`/api/agents/automations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_account: agentAccount, name, description, trigger, action, enabled }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `Create failed (HTTP ${r.status})`);
    await reload();
    return j.automation;
  }, [address, agentAccount, reload]);

  const update = useCallback(async (id, patch) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await apiFetch(`/api/agents/automations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `Update failed (HTTP ${r.status})`);
    await reload();
    return j.automation;
  }, [address, reload]);

  const remove = useCallback(async (id) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await apiFetch(`/api/agents/automations/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error || `Delete failed (HTTP ${r.status})`);
    }
    await reload();
    return true;
  }, [address, reload]);

  const fire = useCallback(async (id) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await apiFetch(`/api/agents/automations/${id}/fire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `Fire failed (HTTP ${r.status})`);
    await reload();
    return j;
  }, [address, reload]);

  return { rules, loading, error, reload, create, update, remove, fire };
}
