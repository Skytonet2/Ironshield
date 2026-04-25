"use client";
// useSkillRegistry — list of executable built-in skills the orchestrator
// can run. Used by the automation modal to populate the "call_skill"
// action picker. The registry is the live response from
// /api/skills/registry — no hardcoded fallback. If the backend isn't
// reachable, the picker shows nothing and the user gets a clear empty
// state rather than a stale stub.

import { useEffect, useState } from "react";
import { API_BASE as API } from "@/lib/apiBase";

export default function useSkillRegistry() {
  const [skills, setSkills] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!API) { setLoaded(true); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/api/skills/registry`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (alive) setSkills(Array.isArray(j?.skills) ? j.skills : []);
      } catch (e) {
        if (alive) setError(e?.message || "Failed to load skill registry");
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { skills, loaded, error };
}
