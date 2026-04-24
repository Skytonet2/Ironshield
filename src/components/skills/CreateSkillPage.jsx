"use client";
// Create a skill — /skills/create. Four-step wizard with live preview.
//
// Layout:
//   ┌ Header (icon + title + "Free to author" badge + close) ────────┐
//   ├ Stepper: Details → Permissions → Configure → Review ────────────┤
//   │ Left: form (Basic info, Category, Tags, Pricing, Early-access)  │
//   │ Right: live preview card + Permissions summary + Tips + Help    │
//   ├ Sticky footer: Save draft · autosave indicator · Continue → ────┤
//   └ Footer strip: Free to publish | Instant publishing | Reach agents
//
// All state is local. The submit flow and contract call (create_skill)
// land in the follow-up PR.

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Zap, X as XIcon, CheckCircle2, Check, ChevronDown, ArrowRight,
  ShieldCheck, Bell, Lightbulb, HelpCircle, Store, Eye, Package,
  Gift, DollarSign, CircleCheck,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";

const STEPS = ["Details", "Permissions", "Configure", "Review"];

const CATEGORIES = [
  { key: "airdrops",    label: "Airdrops & Rewards" },
  { key: "defi",        label: "DeFi" },
  { key: "trading",     label: "Trading" },
  { key: "analytics",   label: "Analytics" },
  { key: "social",      label: "Social" },
  { key: "security",    label: "Security" },
  { key: "productivity",label: "Productivity" },
  { key: "gaming",      label: "Gaming" },
  { key: "other",       label: "Other" },
];

const PERMISSIONS_PREVIEW = [
  { key: "read",  label: "Read wallet address", note: "Required to analyze eligibility" },
  { key: "data",  label: "Access blockchain data", note: "Fetch airdrop and campaign data" },
  { key: "no-tx", label: "No transaction signing", note: "This skill cannot transfer funds" },
];

const TIPS = [
  "Use a clear and specific name",
  "Write a detailed description",
  "Add relevant tags",
  "Keep pricing fair and competitive",
];

/* ──────────────────── Header ──────────────────── */

function WizardHeader({ t }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "20px 24px",
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16,
      marginBottom: 20,
    }}>
      <span aria-hidden style={{
        width: 40, height: 40, borderRadius: 10,
        background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 6px 18px rgba(168,85,247,0.35)`,
      }}>
        <Zap size={18} color="#fff" strokeWidth={2.6} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: t.white, margin: 0, letterSpacing: -0.3 }}>
          Create a skill
        </h1>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginTop: 4,
          fontSize: 12.5, color: t.textMuted,
        }}>
          Publish a capability other agents can install.
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
            background: "rgba(168,85,247,0.2)", color: "#c4b8ff",
          }}>
            Free to author
          </span>
        </div>
      </div>
      <Link href="/skills" aria-label="Close" style={{
        width: 36, height: 36, borderRadius: 10,
        background: t.bgSurface, border: `1px solid ${t.border}`, color: t.textMuted,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        textDecoration: "none",
      }}>
        <XIcon size={15} />
      </Link>
    </div>
  );
}

/* ──────────────────── Stepper ──────────────────── */

function Stepper({ t, active }) {
  return (
    <div className="cs-stepper" style={{
      display: "flex", alignItems: "center", gap: 0,
      padding: "16px 24px",
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16,
      marginBottom: 20, overflowX: "auto",
    }}>
      {STEPS.map((s, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", flex: i === STEPS.length - 1 ? "0 0 auto" : 1, minWidth: "fit-content" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                width: 26, height: 26, borderRadius: "50%",
                background: current
                  ? `linear-gradient(135deg, #a855f7, ${t.accent})`
                  : done ? "rgba(16,185,129,0.25)" : t.bgSurface,
                border: done ? `1px solid rgba(16,185,129,0.5)` : `1px solid ${t.border}`,
                color: current || done ? "#fff" : t.textDim,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700,
                boxShadow: current ? `0 0 0 4px rgba(168,85,247,0.15)` : "none",
              }}>
                {done ? <Check size={12} /> : i + 1}
              </span>
              <span style={{
                fontSize: 13, fontWeight: current ? 700 : 600,
                color: current ? t.white : done ? t.textMuted : t.textDim,
                whiteSpace: "nowrap",
              }}>
                {s}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, minWidth: 40, margin: "0 16px",
                height: 1, background: done ? `rgba(16,185,129,0.4)` : t.border,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────── Left: form sections ──────────────────── */

function FormSection({ t, children, title, subtitle }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 22,
    }}>
      {title && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: 0 }}>
            {title}
          </h2>
          {subtitle && (
            <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 4, marginBottom: 16 }}>
              {subtitle}
            </div>
          )}
        </>
      )}
      {children}
    </section>
  );
}

function Field({ t, label, value, onChange, maxLength, placeholder, multiline, hint }) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6,
      }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>{label}</label>
        {maxLength && (
          <span style={{ fontSize: 11, color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
            {(value || "").length}/{maxLength}
          </span>
        )}
      </div>
      <div style={{
        position: "relative",
        border: `1px solid ${t.border}`, borderRadius: 10,
        background: t.bgSurface,
      }}>
        <Tag
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={multiline ? 4 : undefined}
          style={{
            width: "100%", padding: "11px 36px 11px 14px",
            border: "none", background: "transparent", outline: "none",
            color: t.white, fontSize: 13, lineHeight: 1.5,
            resize: multiline ? "vertical" : "none",
            minHeight: multiline ? 100 : undefined,
            fontFamily: "inherit",
          }}
        />
        {value && (
          <CheckCircle2 size={14} color="#10b981" style={{
            position: "absolute", right: 12, top: multiline ? 14 : "50%",
            transform: multiline ? "none" : "translateY(-50%)",
          }} />
        )}
      </div>
      {hint && (
        <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 6 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function CategoryField({ t, value, onChange }) {
  const current = CATEGORIES.find(c => c.key === value) || CATEGORIES[0];
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>Category</label>
        <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 2 }}>
          Choose the best fit for your skill.
        </div>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "11px 14px",
        background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
      }}>
        <Gift size={14} color={t.accent} />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none",
            color: t.white, fontSize: 13, cursor: "pointer",
            appearance: "none",
          }}
        >
          {CATEGORIES.map(c => (
            <option key={c.key} value={c.key} style={{ background: t.bgCard, color: t.white }}>
              {c.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} color={t.textDim} style={{ pointerEvents: "none" }} />
      </div>
    </div>
  );
}

function TagsField({ t, tags, onChange }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>
          Tags{" "}
          <span style={{ color: t.textDim, fontWeight: 500, fontSize: 11.5 }}>
            (up to 5)
          </span>
        </label>
      </div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
        padding: "8px 12px",
        background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
        minHeight: 40,
      }}>
        {tags.map((tag) => (
          <span key={tag} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 10px", borderRadius: 999,
            background: t.bgCard, border: `1px solid ${t.border}`,
            fontSize: 11.5, fontWeight: 600, color: t.textMuted,
          }}>
            {tag}
            <button
              type="button" aria-label={`Remove ${tag}`}
              onClick={() => onChange(tags.filter(x => x !== tag))}
              style={{
                width: 14, height: 14, borderRadius: "50%",
                background: "transparent", border: "none", color: t.textDim,
                cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <XIcon size={9} />
            </button>
          </span>
        ))}
        <ChevronDown size={13} color={t.textDim} style={{ marginLeft: "auto" }} />
      </div>
    </div>
  );
}

function PricingSection({ t, price, onChange }) {
  return (
    <FormSection t={t}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: 0 }}>
          Pricing
        </h2>
        <Link href="/docs/pricing" style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 11.5, color: t.accent, textDecoration: "none", fontWeight: 600,
        }}>
          <HelpCircle size={11} /> How pricing works
        </Link>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>
          Install price (NEAR)
        </label>
      </div>
      <div style={{
        display: "flex", alignItems: "center",
        padding: "11px 14px", marginBottom: 10,
        background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
      }}>
        <input
          type="number" min={0} step="0.01"
          value={price}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, border: "none", background: "transparent", outline: "none",
            color: t.white, fontSize: 14, fontFamily: "var(--font-jetbrains-mono), monospace",
          }}
        />
        <span style={{ fontSize: 11.5, color: t.textDim, fontWeight: 700 }}>NEAR</span>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 11.5, color: t.textMuted,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
          background: "rgba(16,185,129,0.2)", color: "#10b981",
        }}>
          Free
        </span>
        Set 0 for free. Paid installs will be available with Marketplace v2.
      </div>
    </FormSection>
  );
}

/* ──────────────────── Right rail ──────────────────── */

function PreviewCard({ t, state }) {
  const { name, shortDesc, price, category } = state;
  const priceStr = Number(price) > 0 ? `${price} NEAR` : "Free";
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 16,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: t.white, margin: 0 }}>
          Preview
        </h3>
        <button type="button" style={{
          fontSize: 11.5, color: t.accent, fontWeight: 700,
          background: "transparent", border: "none", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          <Eye size={11} /> See full preview
        </button>
      </div>

      <div style={{
        padding: 14, borderRadius: 12,
        background: t.bgSurface, border: `1px solid ${t.border}`,
      }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <span aria-hidden style={{
            width: 52, height: 52, flexShrink: 0, borderRadius: 12,
            background: `linear-gradient(135deg, rgba(168,85,247,0.35), rgba(59,130,246,0.15))`,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 24,
          }}>🪂</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: t.white }}>
                {name || "Skill name"}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                background: "rgba(16,185,129,0.2)", color: "#10b981",
              }}>
                {priceStr === "Free" ? "Free" : "Paid"}
              </span>
            </div>
            <div style={{
              fontSize: 11.5, color: t.textMuted, marginTop: 2,
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              by 0xYourName.near <CheckCircle2 size={11} color={t.accent} />
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 12, lineHeight: 1.55 }}>
          {shortDesc || "Short description will appear here."}
        </div>
        <span style={{
          display: "inline-block", marginBottom: 14,
          fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
          background: `${t.accent}22`, color: t.accent,
        }}>
          {CATEGORIES.find(c => c.key === category)?.label || "Category"}
        </span>

        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          padding: 12, borderRadius: 10,
          background: t.bgCard, border: `1px solid ${t.border}`,
        }}>
          <PreviewRow t={t} icon={Package} label="Input"    value="Wallet address" />
          <PreviewRow t={t} icon={Package} label="Output"   value="List of eligible airdrops" />
          <PreviewRow t={t} icon={HelpCircle} label="Use case" value="Discover and track airdrop opportunities effortlessly." />
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 14, paddingTop: 12, borderTop: `1px solid ${t.border}`,
        }}>
          <div style={{ fontSize: 12, color: t.textMuted }}>Install price</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.white, display: "inline-flex", alignItems: "center", gap: 8 }}>
            {priceStr}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              background: "rgba(16,185,129,0.2)", color: "#10b981",
            }}>
              {Number(price) > 0 ? "Paid" : "Free"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function PreviewRow({ t, icon: Icon, label, value }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <Icon size={13} color={t.textDim} style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ fontSize: 11, color: t.textDim, width: 64, flexShrink: 0, marginTop: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5, flex: 1 }}>
        {value}
      </div>
    </div>
  );
}

function PermissionsPreview({ t }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 16,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14,
      }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={14} color={t.accent} />
          <h3 style={{ fontSize: 14, fontWeight: 800, color: t.white, margin: 0 }}>
            Permissions
          </h3>
        </div>
        <button type="button" style={{
          fontSize: 11.5, color: t.accent, fontWeight: 700,
          background: "transparent", border: "none", cursor: "pointer",
        }}>
          Manage
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {PERMISSIONS_PREVIEW.map(p => (
          <div key={p.key} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <CircleCheck size={14} color="#10b981" style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>{p.label}</div>
              <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>{p.note}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TipsCard({ t }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Lightbulb size={14} color="#fbbf24" />
        <h3 style={{ fontSize: 14, fontWeight: 800, color: t.white, margin: 0 }}>
          Tips for a great listing
        </h3>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TIPS.map(tip => (
          <div key={tip} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CircleCheck size={13} color={t.accent} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: t.textMuted }}>{tip}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function NeedHelp({ t }) {
  return (
    <Link href="/docs/creators" style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "14px 16px",
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      color: "inherit", textDecoration: "none",
    }}>
      <span aria-hidden style={{
        width: 28, height: 28, flexShrink: 0, borderRadius: 8,
        background: t.bgSurface, border: `1px solid ${t.border}`, color: t.accent,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        <HelpCircle size={13} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>Need help?</div>
        <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>
          Check out our <span style={{ color: t.accent, fontWeight: 700 }}>creator guide</span>
        </div>
      </div>
      <ArrowRight size={13} color={t.textDim} />
    </Link>
  );
}

/* ──────────────────── Sticky footer + bottom strip ──────────────────── */

function WizardFooter({ t, onContinue }) {
  return (
    <div className="cs-footer" style={{
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      padding: "16px 0 0",
      marginTop: 20,
      borderTop: `1px solid ${t.border}`,
    }}>
      <button type="button" style={{
        padding: "11px 18px",
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10,
        fontSize: 13, fontWeight: 700, color: t.text, cursor: "pointer",
      }}>
        Save draft
      </button>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 11.5, color: t.textMuted,
      }}>
        <CheckCircle2 size={12} color="#10b981" />
        All changes are saved automatically
      </div>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={onContinue} style={{
        padding: "12px 22px",
        background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
        border: "none", borderRadius: 10,
        fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 8,
        boxShadow: `0 10px 28px rgba(168,85,247,0.4)`,
      }}>
        Continue <ArrowRight size={13} />
      </button>
    </div>
  );
}

function BottomStrip({ t }) {
  const items = [
    { Icon: DollarSign, title: "Free to publish", sub: "No fees during beta" },
    { Icon: Zap,        title: "Instant publishing", sub: "Go live in seconds" },
    { Icon: Store,      title: "Reach agents",    sub: "Grow your installs"  },
  ];
  return (
    <div className="cs-bottom" style={{
      marginTop: 22, padding: "18px 22px",
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16,
    }}>
      {items.map(it => (
        <div key={it.title} style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span aria-hidden style={{
            width: 36, height: 36, flexShrink: 0, borderRadius: 10,
            background: `${t.accent}22`, color: t.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <it.Icon size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>{it.title}</div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>{it.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────── Page ──────────────────── */

export default function CreateSkillPage() {
  const t = useTheme();
  const [step, setStep] = useState(0);
  const [state, setState] = useState({
    name:       "Airdrop Hunter",
    shortDesc:  "Finds potential airdrops for any wallet across multiple networks.",
    longDesc:   "Scans multiple blockchain networks to discover potential airdrop opportunities for a given wallet. It monitors eligibility criteria, tracks campaign updates, and delivers a clear list of active airdrops with estimated rewards.",
    category:   "airdrops",
    tags:       ["airdrop", "rewards", "wallet", "scanner"],
    price:      "0",
  });
  const patch = (next) => setState(s => ({ ...s, ...next }));

  const nameMax = 48;
  const shortMax = 120;
  const longMax = 2400;

  return (
    <>
      <WizardHeader t={t} />
      <Stepper t={t} active={step} />

      <div className="cs-grid" style={{
        display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px",
        gap: 22, alignItems: "flex-start",
      }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <FormSection t={t} title="Basic information" subtitle="Give your skill a clear name and description.">
            <Field t={t} label="Skill name" maxLength={nameMax}
              value={state.name} onChange={(v) => patch({ name: v })}
              placeholder="Airdrop Hunter"
              hint="Choose a name that describes what your skill does." />
            <Field t={t} label="Short description" maxLength={shortMax}
              value={state.shortDesc} onChange={(v) => patch({ shortDesc: v })}
              placeholder="One-liner visible in the marketplace"
              hint="One line summary of what your skill does." />
            <Field t={t} label="Detailed description" maxLength={longMax}
              value={state.longDesc} onChange={(v) => patch({ longDesc: v })}
              placeholder="Explain what your skill does in detail"
              multiline
              hint="Explain what your skill does, its inputs, outputs and use cases." />

            <CategoryField t={t} value={state.category} onChange={(v) => patch({ category: v })} />
            <TagsField t={t} tags={state.tags} onChange={(v) => patch({ tags: v })} />
          </FormSection>

          <PricingSection t={t} price={state.price} onChange={(v) => patch({ price: v })} />

          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px",
            background: `linear-gradient(135deg, rgba(168,85,247,0.16), rgba(59,130,246,0.08))`,
            border: `1px solid ${t.border}`, borderRadius: 12,
          }}>
            <Store size={16} color={t.accent} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.textMuted }}>
              <strong style={{ color: t.white }}>Early access:</strong> Publishing is free during beta.
              <div style={{ marginTop: 2, fontSize: 11.5, color: t.textDim }}>
                You can update pricing anytime.
              </div>
            </div>
          </div>

          <WizardFooter t={t} onContinue={() => setStep(s => Math.min(s + 1, STEPS.length - 1))} />
        </div>

        <aside style={{ minWidth: 0, position: "sticky", top: 76, display: "flex", flexDirection: "column", gap: 0 }}>
          <PreviewCard t={t} state={state} />
          <PermissionsPreview t={t} />
          <TipsCard t={t} />
          <NeedHelp t={t} />
        </aside>
      </div>

      <BottomStrip t={t} />

      <style jsx global>{`
        @media (max-width: 1100px) {
          .cs-grid { grid-template-columns: 1fr !important; }
          .cs-grid > aside { position: static !important; }
        }
        @media (max-width: 640px) {
          .cs-bottom { grid-template-columns: 1fr !important; }
          .cs-stepper { padding: 14px 16px !important; }
        }
      `}</style>
    </>
  );
}
