"use client";
// useAgentChannels — list / create / patch / delete channel rows for
// one agent. Channel relays don't run yet; this hook captures the
// credentials so users can register their bot tokens / webhooks
// ahead of the relay-runtime work landing.

import { useCallback, useEffect, useState } from "react";
import { API_BASE as API } from "@/lib/apiBase";
import { useWallet } from "@/lib/contexts";

export default function useAgentChannels({ agentAccount } = {}) {
  const { address } = useWallet();
  const [channels, setChannels] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const reload = useCallback(async () => {
    if (!agentAccount || !API) { setChannels([]); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API}/api/agents/channels/${encodeURIComponent(agentAccount)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setChannels(Array.isArray(j?.channels) ? j.channels : []);
    } catch (e) {
      setError(e?.message || "Failed to load channels");
      setChannels([]);
    } finally { setLoading(false); }
  }, [agentAccount]);

  useEffect(() => { reload(); }, [reload]);

  const create = useCallback(async ({ channel, label, config }) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await fetch(`${API}/api/agents/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-wallet": address },
      body: JSON.stringify({ agent_account: agentAccount, channel, label, config }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `Create failed (HTTP ${r.status})`);
    await reload();
    return j.channel;
  }, [address, agentAccount, reload]);

  const update = useCallback(async (id, patch) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await fetch(`${API}/api/agents/channels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-wallet": address },
      body: JSON.stringify(patch || {}),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error || `Update failed (HTTP ${r.status})`);
    await reload();
    return j.channel;
  }, [address, reload]);

  const remove = useCallback(async (id) => {
    if (!API)     throw new Error("Backend not reachable");
    if (!address) throw new Error("Connect a wallet first");
    const r = await fetch(`${API}/api/agents/channels/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-wallet": address },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error || `Delete failed (HTTP ${r.status})`);
    }
    await reload();
    return true;
  }, [address, reload]);

  return { channels, loading, error, reload, create, update, remove };
}
