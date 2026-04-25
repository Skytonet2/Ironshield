"use client";
// useAutomationRuns — fetch the recent run history for one automation
// rule. Backed by GET /api/agents/automations/:id/runs (returns up to
// 25 most-recent rows). Caller controls reload cadence via the
// returned `reload` callback — no auto-poll because rules tick at
// >=30s and the dashboard is tab-bound, not real-time.

import { useCallback, useEffect, useState } from "react";
import { API_BASE as API } from "@/lib/apiBase";

export default function useAutomationRuns(automationId) {
  const [runs, setRuns]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const reload = useCallback(async () => {
    if (!automationId || !API) { setRuns([]); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/api/agents/automations/${automationId}/runs`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRuns(Array.isArray(j?.runs) ? j.runs : []);
    } catch (e) {
      setError(e?.message || "Failed to load runs");
      setRuns([]);
    } finally { setLoading(false); }
  }, [automationId]);

  useEffect(() => { reload(); }, [reload]);

  return { runs, loading, error, reload };
}
