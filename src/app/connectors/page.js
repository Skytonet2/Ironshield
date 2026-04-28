"use client";
// /connectors — list available Web2 connectors + the wallet's
// active connections. Mirrors the look of /marketplace/kits but is
// auth-gated for the "my connections" panel.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plug, CheckCircle2, AlertCircle, Loader2, Trash2, ArrowRight } from "lucide-react";
import { API_BASE } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";
import { CONNECTOR_META } from "@/components/connectors/connectorMeta";
import ConnectDialog from "@/components/connectors/ConnectDialog";

export default function ConnectorsPage() {
  const [registry, setRegistry] = useState([]);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // connector name being connected

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [regRes, mineRes] = await Promise.all([
        fetch(`${API_BASE}/api/connectors`),
        apiFetch("/api/connectors/me").catch(() => null),
      ]);
      const reg = await regRes.json();
      if (!regRes.ok) throw new Error(reg.error || "Could not load connectors");
      setRegistry(Array.isArray(reg.connectors) ? reg.connectors : []);
      if (mineRes && mineRes.ok) {
        const j = await mineRes.json();
        setMine(Array.isArray(j.connections) ? j.connections : []);
      } else {
        setMine([]); // not signed in or 401 — show empty "my" panel
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connectedSet = useMemo(
    () => new Set(mine.map((m) => m.connector_name)),
    [mine]
  );

  async function disconnect(name) {
    if (!window.confirm(`Disconnect ${CONNECTOR_META[name]?.label || name}? Stored credentials will be deleted.`)) return;
    try {
      const r = await apiFetch(`/api/connectors/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `disconnect failed (${r.status})`);
      }
      await refresh();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <header style={heroStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "var(--accent)", textTransform: "uppercase" }}>
              Connectors
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 6px", color: "var(--text-1)" }}>
              Wire your Web2 accounts
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
              Each connector lets your Kits act on your behalf — search, post, DM, send mail.
              Credentials are encrypted at rest and only used by missions you start.
              {" "}<Link href="/marketplace/kits" style={linkStyle}>Browse Kits →</Link>
            </p>
          </div>
        </header>

        {loading && (
          <div style={emptyStyle}>
            <Loader2 size={18} style={{ animation: "spin 0.9s linear infinite" }} />
            <span>Loading connectors…</span>
          </div>
        )}
        {error && <div style={errorStyle}>{error}</div>}

        {!loading && !error && (
          <div style={gridStyle}>
            {registry.map((c) => (
              <ConnectorCard
                key={c.name}
                conn={c}
                connected={connectedSet.has(c.name)}
                connection={mine.find((m) => m.connector_name === c.name)}
                onConnect={() => setActive(c.name)}
                onDisconnect={() => disconnect(c.name)}
              />
            ))}
          </div>
        )}
      </div>

      {active && (
        <ConnectDialog
          connectorName={active}
          onClose={() => setActive(null)}
          onConnected={refresh}
        />
      )}

      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function ConnectorCard({ conn, connected, connection, onConnect, onDisconnect }) {
  const meta = CONNECTOR_META[conn.name] || { label: conn.name, blurb: "", color: "#6B7280", flow: "form", fields: [] };
  const expires = connection?.expires_at ? new Date(connection.expires_at) : null;
  const expiringSoon = expires && expires.getTime() - Date.now() < 7 * 24 * 3600 * 1000;

  let cta;
  if (meta.flow === "platform") {
    cta = <span style={pillStyle}>Platform-managed</span>;
  } else if (meta.flow === "none") {
    cta = <span style={pillStyle}>No account needed</span>;
  } else if (meta.flow === "oauth-soon") {
    cta = <span style={{ ...pillStyle, color: "var(--text-3)" }}>OAuth flow — coming soon</span>;
  } else if (connected) {
    cta = (
      <button onClick={onDisconnect} style={disconnectBtnStyle}>
        <Trash2 size={12} /> Disconnect
      </button>
    );
  } else {
    cta = (
      <button onClick={onConnect} style={connectBtnStyle}>
        <ArrowRight size={12} /> Connect
      </button>
    );
  }

  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={{ ...cardIconStyle, background: `linear-gradient(135deg, ${meta.color}33, ${meta.color}11)`, color: meta.color }}>
          <Plug size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 6 }}>
            {meta.label || conn.name}
            {connected && <CheckCircle2 size={13} style={{ color: "var(--green, #10B981)" }} />}
            {expiringSoon && <AlertCircle size={13} style={{ color: "var(--amber, #f59e0b)" }} title={`Expires ${expires?.toLocaleString()}`} />}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(conn.capabilities || []).map((cap) => (
              <span key={cap} style={capPillStyle}>{cap}</span>
            ))}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5, margin: "10px 0 12px", minHeight: 56, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {meta.blurb || "—"}
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
        {cta}
      </div>
    </article>
  );
}

const pageStyle = { minHeight: "100vh", background: "var(--bg-app)" };
const containerStyle = { maxWidth: 1180, margin: "0 auto", padding: "32px 20px 64px" };
const heroStyle = { display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" };
const gridStyle = {
  display: "grid", gap: 14,
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
};
const cardStyle = {
  background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
  padding: 16, display: "flex", flexDirection: "column",
};
const cardHeaderStyle = { display: "flex", alignItems: "center", gap: 12 };
const cardIconStyle = {
  width: 40, height: 40, borderRadius: 10,
  border: "1px solid var(--accent-border)",
  display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
};
const capPillStyle = {
  fontSize: 9.5, padding: "2px 6px", borderRadius: 99,
  background: "var(--bg-surface)", border: "1px solid var(--border)",
  color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700,
};
const pillStyle = {
  fontSize: 11, padding: "6px 10px", borderRadius: 8,
  background: "var(--bg-surface)", border: "1px solid var(--border)",
  color: "var(--text-2)",
};
const connectBtnStyle = {
  background: "linear-gradient(135deg, #a855f7, #60a5fa)", color: "#fff",
  border: "1px solid var(--accent-border)", padding: "7px 12px", borderRadius: 8,
  fontSize: 12, fontWeight: 700, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};
const disconnectBtnStyle = {
  background: "transparent", color: "var(--text-2)",
  border: "1px solid var(--border)", padding: "7px 12px", borderRadius: 8,
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};
const emptyStyle = {
  padding: 40, display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "center", gap: 10, color: "var(--text-2)", fontSize: 13,
  background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
  textAlign: "center",
};
const errorStyle = {
  padding: 14, marginBottom: 14, borderRadius: 10,
  background: "rgba(255,77,77,0.08)", border: "1px solid rgba(255,77,77,0.3)",
  color: "var(--red)", fontSize: 12,
};
const linkStyle = { color: "var(--accent)", textDecoration: "none", fontWeight: 700 };
