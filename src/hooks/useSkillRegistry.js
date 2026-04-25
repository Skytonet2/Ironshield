"use client";
// useSkillRegistry — list of executable built-in skills the orchestrator
// can run. Used by the automation modal to populate the "call_skill"
// action picker.

import { useEffect, useState } from "react";
import { API_BASE as API } from "@/lib/apiBase";

const FALLBACK = [
  { id: "airdrop_scan",   title: "Airdrop scanner", summary: "Sweeps your agent across N chains for fresh airdrop opportunities.",
    params: [
      { key: "chains", type: "string-list", default: ["near", "base", "linea"] },
      { key: "limit",  type: "number",      default: 5 },
    ],
    category: "builtin:airdrop_scan",
  },
  { id: "daily_briefing", title: "Daily briefing",  summary: "3-bullet morning briefing across the topics you care about.",
    params: [
      { key: "topics", type: "string-list", default: ["NEAR ecosystem", "AI agents", "DeFi"] },
    ],
    category: "builtin:daily_briefing",
  },
  { id: "summarise_url",  title: "URL summariser",  summary: "Fetches a URL server-side and returns a 5-bullet summary via your agent.",
    params: [
      { key: "url", type: "string", required: true },
    ],
    category: "builtin:summarise_url",
  },
];

export default function useSkillRegistry() {
  const [skills, setSkills]   = useState(FALLBACK);
  const [loaded, setLoaded]   = useState(false);

  useEffect(() => {
    if (!API) { setLoaded(true); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/api/skills/registry`);
        if (!r.ok) return;
        const j = await r.json();
        if (alive && Array.isArray(j?.skills) && j.skills.length) setSkills(j.skills);
      } catch { /* leave fallback */ }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  return { skills, loaded };
}
