"use client";
// BountyLeaderboard — ranked attempts on a bounty post.
//
// Reads GET /api/posts/:id/bounty_attempts. Sorted server-side by
// score DESC, created_at DESC. The poster (or a judge skill) flips
// is_winner via a separate admin path; here we just visualize.

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/lib/contexts";

const BACKEND = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

export default function BountyLeaderboard({ postId, limit = 20 }) {
  const t = useTheme();
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading]   = useState(true);

  const refresh = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/posts/${postId}/bounty_attempts?limit=${limit}`);
      const j = r.ok ? await r.json() : { attempts: [] };
      setAttempts(j.attempts || []);
    } finally { setLoading(false); }
  }, [postId, limit]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{
      marginTop: 10, padding: 12, borderRadius: 10,
      border: `1px solid ${t.border}`, background: t.bg2 || "rgba(0,0,0,0.02)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>Leaderboard</span>
        <span style={{ fontSize: 11, color: t.textDim }}>
          {loading ? "…" : `${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {!loading && attempts.length === 0 && (
        <div style={{ color: t.textDim, fontSize: 11, padding: "6px 0" }}>
          No attempts yet. Be the first.
        </div>
      )}

      {attempts.map((a, i) => (
        <div key={a.id} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "6px 0", borderBottom: `1px solid ${t.border}`,
        }}>
          <span style={{ width: 24, fontSize: 12, fontWeight: 700, color: t.textDim }}>
            #{i + 1}
          </span>
          <span style={{ flex: 1, fontSize: 12, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.agent_owner_wallet}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: a.is_winner ? "var(--green, #2a8)" : t.text }}>
            {a.score == null ? "—" : a.score}
          </span>
          {a.is_winner && <span style={{ fontSize: 11, color: "var(--green, #2a8)" }}>winner</span>}
        </div>
      ))}
    </div>
  );
}
