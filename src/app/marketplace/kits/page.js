"use client";
// /marketplace/kits — browses the agent_kits catalog.
//
// Reads the off-chain mirror via GET /api/kits and joins deployment counts
// from GET /api/kit-deployments/counts so cards can sort by popularity.
// All filtering/sorting is client-side: catalog is small enough that a
// single request is cheaper than per-keystroke server fetches.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, ArrowRight, Filter, Loader2, Package, ChevronDown, Search } from "lucide-react";
import { API_BASE } from "@/lib/apiBase";

const STATUS_LABEL = {
  active:     { label: "Live",     dot: "var(--green)" },
  beta:       { label: "Beta",     dot: "var(--amber)" },
  deprecated: { label: "Retired",  dot: "var(--text-3)" },
};

const SORT_OPTIONS = [
  { key: "popular",  label: "Most deployed" },
  { key: "newest",   label: "Newest" },
  { key: "vertical", label: "Vertical (A→Z)" },
];

export default function KitsCatalogPage() {
  const [kits, setKits]         = useState([]);
  const [counts, setCounts]     = useState({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const [vertical, setVertical] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort]         = useState("popular");
  const [query, setQuery]       = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [kitsRes, countsRes] = await Promise.all([
          fetch(`${API_BASE}/api/kits`),
          fetch(`${API_BASE}/api/kit-deployments/counts`),
        ]);
        const kitsJson   = await kitsRes.json();
        const countsJson = await countsRes.json();
        if (!kitsRes.ok)   throw new Error(kitsJson.error   || "Could not load kits");
        if (!countsRes.ok) throw new Error(countsJson.error || "Could not load counts");
        if (cancelled) return;
        setKits(Array.isArray(kitsJson.kits) ? kitsJson.kits : []);
        setCounts(countsJson.counts || {});
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const verticals = useMemo(() => {
    const set = new Set();
    for (const k of kits) if (k.vertical) set.add(k.vertical);
    return Array.from(set).sort();
  }, [kits]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = kits.filter((k) => {
      if (vertical && k.vertical !== vertical) return false;
      if (statusFilter && k.status !== statusFilter) return false;
      if (q) {
        const hay = `${k.title || ""} ${k.description || ""} ${k.vertical || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort === "popular") {
      rows = rows.slice().sort((a, b) => (counts[b.slug] || 0) - (counts[a.slug] || 0));
    } else if (sort === "newest") {
      rows = rows.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    } else if (sort === "vertical") {
      rows = rows.slice().sort((a, b) => (a.vertical || "").localeCompare(b.vertical || ""));
    }
    return rows;
  }, [kits, counts, vertical, statusFilter, sort, query]);

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <header style={heroStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "var(--accent)", textTransform: "uppercase" }}>
              Agent Kits
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 6px", color: "var(--text-1)" }}>
              Pick a Kit, deploy in one click
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55, margin: 0 }}>
              Each Kit bundles skills, presets, and an authorization profile —
              ready to wire to your wallet. Not sure which? <Link href="/onboard" style={linkStyle}>Ask IronGuide →</Link>
            </p>
          </div>
        </header>

        <div style={filterBarStyle}>
          <div style={searchWrapStyle}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Kits…"
              style={searchInputStyle}
            />
          </div>

          <Select label="Vertical" value={vertical} onChange={setVertical} options={[{ key: "", label: "All verticals" }, ...verticals.map((v) => ({ key: v, label: v }))]} />
          <Select label="Status"   value={statusFilter} onChange={setStatusFilter} options={[
            { key: "",            label: "All statuses" },
            { key: "active",      label: "Live" },
            { key: "beta",        label: "Beta" },
            { key: "deprecated",  label: "Retired" },
          ]} />
          <Select label="Sort"     value={sort} onChange={setSort} options={SORT_OPTIONS} />
        </div>

        {loading && (
          <div style={emptyStyle}>
            <Loader2 size={18} style={{ animation: "kc-spin 0.9s linear infinite" }} />
            <span>Loading Kits…</span>
          </div>
        )}
        {error && <div style={errorStyle}>{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div style={emptyStyle}>
            <Package size={20} style={{ color: "var(--text-3)" }} />
            <div>No Kits match these filters yet. <Link href="/onboard" style={linkStyle}>Tell IronGuide what you need →</Link></div>
          </div>
        )}

        <div style={gridStyle}>
          {filtered.map((kit) => (
            <KitCard key={kit.slug} kit={kit} deployments={counts[kit.slug] || 0} />
          ))}
        </div>
      </div>

      <style jsx global>{`
        @keyframes kc-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function KitCard({ kit, deployments }) {
  const status = STATUS_LABEL[kit.status] || { label: kit.status, dot: "var(--text-3)" };
  return (
    <article className="card-lift" style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={cardIconStyle}>
          {kit.hero_image_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={kit.hero_image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }} />
            : <Sparkles size={18} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {kit.title || kit.slug}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: status.dot, display: "inline-block" }} />
            {status.label}
            {kit.vertical && <span style={{ color: "var(--text-3)" }}>·</span>}
            {kit.vertical && <span>{kit.vertical}</span>}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5, margin: "10px 0 12px", minHeight: 56, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {kit.description || "—"}
      </p>

      <div style={cardStatsStyle}>
        <Stat k="Deployed" v={deployments.toString()} />
        <Stat k="Skills"   v={Array.isArray(kit.bundled_skill_ids) ? kit.bundled_skill_ids.length.toString() : "0"} />
        <Stat k="Connectors" v={Array.isArray(kit.required_connectors) ? kit.required_connectors.length.toString() : "0"} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Link
          href={`/agents/deploy?slug=${encodeURIComponent(kit.slug)}`}
          style={cardCtaStyle}
        >
          <ArrowRight size={13} />
          <span>Deploy</span>
        </Link>
      </div>
    </article>
  );
}

function Stat({ k, v }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>{k}</div>
      <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 700 }}>{v}</div>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-2)", flexShrink: 0 }}>
      <Filter size={12} style={{ color: "var(--text-3)" }} />
      <span style={{ display: "none" }}>{label}</span>
      <div style={{ position: "relative" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-1)",
            fontSize: 12,
            padding: "7px 26px 7px 10px",
            appearance: "none",
            outline: "none",
            cursor: "pointer",
          }}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key} style={{ background: "var(--bg-surface)", color: "var(--text-1)" }}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={12} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-3)" }} />
      </div>
    </label>
  );
}

const pageStyle = { minHeight: "100vh", background: "var(--bg-app)" };
const containerStyle = { maxWidth: 1180, margin: "0 auto", padding: "32px 20px 64px" };
const heroStyle = { display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22, flexWrap: "wrap" };
const filterBarStyle = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
  padding: 14,
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  marginBottom: 18,
};
const searchWrapStyle = { position: "relative", flex: 1, minWidth: 220 };
const searchInputStyle = {
  width: "100%",
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px 8px 32px",
  color: "var(--text-1)",
  fontSize: 12.5,
  outline: "none",
};
const gridStyle = {
  display: "grid",
  gap: 14,
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
};
const cardStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  display: "flex",
  flexDirection: "column",
};
const cardHeaderStyle = { display: "flex", alignItems: "center", gap: 12 };
const cardIconStyle = {
  width: 40, height: 40, borderRadius: 10,
  background: "linear-gradient(135deg, rgba(168, 85, 247, 0.18), rgba(96, 165, 250, 0.18))",
  border: "1px solid var(--accent-border)",
  display: "flex", alignItems: "center", justifyContent: "center",
  color: "var(--accent)",
  flexShrink: 0,
  overflow: "hidden",
};
const cardStatsStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 8,
  padding: "10px 0",
  borderTop: "1px dashed var(--border)",
  borderBottom: "1px dashed var(--border)",
};
const cardCtaStyle = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 14px",
  borderRadius: 9,
  background: "linear-gradient(135deg, #a855f7, #60a5fa)",
  color: "#fff",
  fontSize: 12.5, fontWeight: 700,
  textDecoration: "none",
  border: "1px solid var(--accent-border)",
};
const emptyStyle = {
  padding: 40,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  color: "var(--text-2)",
  fontSize: 13,
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  textAlign: "center",
};
const errorStyle = {
  padding: 14, marginBottom: 14, borderRadius: 10,
  background: "rgba(255, 77, 77, 0.08)",
  border: "1px solid rgba(255, 77, 77, 0.3)",
  color: "var(--red)",
  fontSize: 12,
};
const linkStyle = { color: "var(--accent)", textDecoration: "none", fontWeight: 700 };
