"use client";
// Create a skill — /skills/create. Wired to the Phase 7 contract:
// create_skill(name, description, price_yocto, category, tags, image_url).
//
// Wizard contract:
//   Step 1 Details  → collect name, short/long description, category,
//                     tags, price
//   Step 2 Permissions → placeholder (no on-chain permission model yet)
//   Step 3 Configure   → placeholder (ditto)
//   Step 4 Review      → confirm + call create_skill. On success redirect
//                        to /skills.
//
// Category and tags were removed in the design pass because no on-chain
// slot existed for them; Phase 7 Sub-PR A adds SkillMetadata so they're
// back as first-class fields here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Zap, X as XIcon, CheckCircle2, Check, ArrowRight, ArrowLeft,
  ShieldCheck, Lightbulb, HelpCircle, Store, Eye, Package,
  Info, CircleCheck, Loader2, Tag, ChevronDown, Gift,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

const STEPS = ["Details", "Permissions", "Configure", "Review"];

const NAME_MAX           = 48;
const SHORT_MAX          = 120;
const LONG_MAX           = 240; // contract cap on description
const CATEGORY_MAX       = 32;  // contract cap on category
const TAG_MAX            = 24;  // contract cap per tag
const MAX_TAGS           = 5;   // contract cap on tag count
const IMAGE_URL_MAX      = 256; // contract cap on image_url
const YOCTO_PER_NEAR     = 1_000_000_000_000_000_000_000_000n;

// Canonical categories surfaced in the marketplace sidebar. Free-form
// strings are allowed on-chain but the picker constrains new listings
// so the filter UX stays coherent.
const CATEGORIES = [
  { key: "defi",        label: "DeFi" },
  { key: "airdrops",    label: "Airdrops & Rewards" },
  { key: "trading",     label: "Trading" },
  { key: "analytics",   label: "Analytics" },
  { key: "social",      label: "Social" },
  { key: "security",    label: "Security" },
  { key: "gaming",      label: "Gaming" },
  { key: "productivity",label: "Productivity" },
  { key: "other",       label: "Other" },
];

function nearToYocto(nearStr) {
  // Accepts "0", "0.1", "1.23". Returns a stringified yoctoNEAR integer.
  const n = String(nearStr ?? "0").trim();
  if (!n) return "0";
  const [whole = "0", frac = ""] = n.split(".");
  const fracPadded = (frac + "000000000000000000000000").slice(0, 24);
  const y = BigInt(whole) * YOCTO_PER_NEAR + BigInt(fracPadded || "0");
  return y.toString();
}

const TIPS = [
  "Use a clear and specific name",
  "Write a detailed description",
  "Keep pricing fair and competitive",
];

const PERMISSIONS_PREVIEW = [
  { key: "read",  label: "Read wallet address", note: "Required to analyze eligibility" },
  { key: "data",  label: "Access blockchain data", note: "Fetch public data from NEAR" },
  { key: "no-tx", label: "No transaction signing", note: "This skill cannot transfer funds" },
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
          fontSize: 12.5, color: t.textMuted, flexWrap: "wrap",
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

/* ──────────────────── Form sections ──────────────────── */

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

function Field({ t, label, value, onChange, maxLength, placeholder, multiline, hint, error }) {
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
        border: `1px solid ${error ? "#ef4444" : t.border}`, borderRadius: 10,
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
        {!error && value && (
          <CheckCircle2 size={14} color="#10b981" style={{
            position: "absolute", right: 12, top: multiline ? 14 : "50%",
            transform: multiline ? "none" : "translateY(-50%)",
          }} />
        )}
      </div>
      {error ? (
        <div style={{ fontSize: 11.5, color: "#fca5a5", marginTop: 6 }}>
          {error}
        </div>
      ) : hint ? (
        <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 6 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

// Phase 7: category + tags fields moved back in once SkillMetadata
// landed on-chain. Both stay author-editable after publish via
// update_skill_metadata (exposed by the hook but UI-ed in a later slice).
/** SkillKindField — picks how the skill is wired at run time.
 *    "metadata" → marketplace listing only (current default)
 *    "http"     → author-hosted endpoint, runnable via call_skill */
function SkillKindField({ t, kind, onChange }) {
  const options = [
    {
      key: "metadata",
      label: "Listing",
      hint: "Discoverable in the marketplace. No execution.",
    },
    {
      key: "http",
      label: "Author-hosted",
      hint: "You host the code. We POST to your /run endpoint when it fires.",
    },
  ];
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 12, color: t.textMuted, fontWeight: 600, marginBottom: 8 }}>
        Skill kind
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {options.map(o => {
          const active = kind === o.key;
          return (
            <button key={o.key} type="button" onClick={() => onChange(o.key)}
                    style={{
                      textAlign: "left", padding: "12px 14px",
                      background: active ? `${t.accent}14` : t.bgSurface,
                      border: active ? `1.5px solid ${t.accent}` : `1px solid ${t.border}`,
                      borderRadius: 12, cursor: "pointer", color: "inherit",
                      transition: "border-color 120ms ease, background 120ms ease",
                    }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 4 }}>
                {o.label}
              </div>
              <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.5 }}>
                {o.hint}
              </div>
            </button>
          );
        })}
      </div>
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
            color: t.white, fontSize: 13, cursor: "pointer", appearance: "none",
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

function TagsField({ t, tags, draft, onDraftChange, onAdd, onRemove }) {
  const full = tags.length >= MAX_TAGS;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>
          Tags{" "}
          <span style={{ color: t.textDim, fontWeight: 500, fontSize: 11.5 }}>
            (up to {MAX_TAGS}, {TAG_MAX} chars each)
          </span>
        </label>
        <span style={{ fontSize: 11, color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
          {tags.length}/{MAX_TAGS}
        </span>
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
              onClick={() => onRemove(tag)}
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
        {!full && (
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value.slice(0, TAG_MAX))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                onAdd(draft);
              } else if (e.key === "Backspace" && !draft && tags.length) {
                onRemove(tags[tags.length - 1]);
              }
            }}
            onBlur={() => { if (draft) onAdd(draft); }}
            placeholder={tags.length ? "Add another…" : "e.g. trading"}
            maxLength={TAG_MAX}
            style={{
              flex: 1, minWidth: 120,
              border: "none", background: "transparent", outline: "none",
              color: t.white, fontSize: 12,
            }}
          />
        )}
      </div>
      <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 6 }}>
        Lowercased + deduped on save. Press Enter or comma to add.
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
        Set 0 for free. Paid installs land with the Phase 7 marketplace migration
        (99% author / 1% platform).
      </div>
    </FormSection>
  );
}

/* ──────────────────── Right rail ──────────────────── */

function PreviewCard({ t, state, author }) {
  const { name, shortDesc, price } = state;
  const priceNum = Number(price || 0);
  const priceStr = priceNum > 0 ? `${priceNum} NEAR` : "Free";
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
        <span style={{
          fontSize: 11.5, color: t.textDim, fontWeight: 600,
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          <Eye size={11} /> Live
        </span>
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
            color: "#c4b8ff",
          }}>
            <Package size={22} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: t.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
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
              fontFamily: "var(--font-jetbrains-mono), monospace",
              display: "inline-flex", alignItems: "center", gap: 4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%",
            }}>
              by {author || "your wallet"}
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 12.5, color: t.textMuted, marginBottom: 12, lineHeight: 1.55,
          minHeight: 36,
        }}>
          {shortDesc || "Short description will appear here."}
        </div>

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          paddingTop: 12, borderTop: `1px solid ${t.border}`,
        }}>
          <div style={{ fontSize: 12, color: t.textMuted }}>Install price</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
            {priceStr}
          </div>
        </div>
      </div>
    </section>
  );
}

function PermissionsPreview({ t }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 16,
    }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <ShieldCheck size={14} color={t.accent} />
        <h3 style={{ fontSize: 14, fontWeight: 800, color: t.white, margin: 0 }}>
          Permissions
        </h3>
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

function BottomStrip({ t }) {
  const items = [
    { title: "Free to publish", sub: "No fees during beta" },
    { title: "Instant publishing", sub: "Go live in seconds" },
    { title: "Reach agents", sub: "Grow your installs" },
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
            <Zap size={15} />
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

/* ──────────────────── Steps 2 & 3 (placeholder) ──────────────────── */

function PlaceholderStep({ t, title, body }) {
  return (
    <FormSection t={t}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Info size={14} color={t.accent} />
        <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: 0 }}>
          {title}
        </h2>
      </div>
      <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.6 }}>
        {body}
      </div>
    </FormSection>
  );
}

/* ──────────────────── Review step ──────────────────── */

function ReviewStep({ t, state, author, yoctoPrice, submitting, error, onBack, onSubmit }) {
  return (
    <FormSection t={t} title="Review" subtitle="Confirm your skill, then publish on-chain.">
      <div style={{
        display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 16, rowGap: 10,
        padding: "14px 16px",
        background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 12,
        fontSize: 13,
      }}>
        <div style={{ color: t.textDim }}>Name</div>
        <div style={{ color: t.white, fontWeight: 700 }}>{state.name || <em style={{ color: t.textDim }}>missing</em>}</div>
        <div style={{ color: t.textDim }}>Short description</div>
        <div style={{ color: t.textMuted, lineHeight: 1.5 }}>
          {state.shortDesc || <em style={{ color: t.textDim }}>missing</em>}
        </div>
        <div style={{ color: t.textDim }}>Long description</div>
        <div style={{ color: t.textMuted, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          {state.longDesc || <em style={{ color: t.textDim }}>empty</em>}
        </div>
        <div style={{ color: t.textDim }}>Category</div>
        <div style={{ color: t.white }}>
          {(CATEGORIES.find(c => c.key === state.category) || {}).label || state.category || <em style={{ color: t.textDim }}>none</em>}
        </div>
        <div style={{ color: t.textDim }}>Tags</div>
        <div style={{ color: t.textMuted, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {state.tags.length
            ? state.tags.map(tag => (
                <span key={tag} style={{
                  padding: "2px 8px", borderRadius: 999,
                  background: t.bgCard, border: `1px solid ${t.border}`,
                  fontSize: 11, fontWeight: 600,
                }}>{tag}</span>
              ))
            : <em style={{ color: t.textDim }}>none</em>}
        </div>
        {state.imageUrl && (
          <>
            <div style={{ color: t.textDim }}>Image URL</div>
            <div style={{
              color: t.textMuted, fontSize: 11.5,
              fontFamily: "var(--font-jetbrains-mono), monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {state.imageUrl}
            </div>
          </>
        )}
        <div style={{ color: t.textDim }}>Install price</div>
        <div style={{ color: t.white, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
          {Number(state.price) > 0 ? `${state.price} NEAR` : "Free"}
          <span style={{
            marginLeft: 8,
            fontSize: 11, color: t.textDim,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}>
            ({yoctoPrice} yoctoNEAR)
          </span>
        </div>
        <div style={{ color: t.textDim }}>Author</div>
        <div style={{ color: t.white, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
          {author || <em style={{ color: t.textDim }}>wallet not connected</em>}
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: 14, padding: "12px 14px",
          borderRadius: 10,
          border: `1px solid rgba(239,68,68,0.35)`,
          background: "rgba(239,68,68,0.08)",
          color: "#fecaca", fontSize: 12.5,
        }}>
          {error}
        </div>
      )}

      <div style={{
        marginTop: 16,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <button type="button" onClick={onBack} style={{
          padding: "11px 16px",
          background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
          fontSize: 12.5, fontWeight: 700, color: t.text, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <ArrowLeft size={13} /> Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          style={{
            padding: "12px 22px",
            background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
            border: "none", borderRadius: 10,
            fontSize: 13, fontWeight: 700, color: "#fff",
            cursor: submitting ? "progress" : "pointer",
            opacity: submitting ? 0.7 : 1,
            display: "inline-flex", alignItems: "center", gap: 8,
            boxShadow: `0 10px 28px rgba(168,85,247,0.4)`,
          }}
        >
          {submitting
            ? <><Loader2 size={13} style={{ animation: "cs-spin 0.9s linear infinite" }} /> Publishing…</>
            : <>Publish skill <ArrowRight size={13} /></>}
        </button>
      </div>

      <style jsx global>{`
        @keyframes cs-spin { to { transform: rotate(360deg); } }
      `}</style>
    </FormSection>
  );
}

/* ──────────────────── Footer nav (steps 1–3) ──────────────────── */

function WizardFooter({ t, canContinue, onBack, onContinue, showBack }) {
  return (
    <div className="cs-footer" style={{
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      padding: "16px 0 0",
      marginTop: 20,
      borderTop: `1px solid ${t.border}`,
    }}>
      {showBack && (
        <button type="button" onClick={onBack} style={{
          padding: "11px 18px",
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10,
          fontSize: 13, fontWeight: 700, color: t.text, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <ArrowLeft size={13} /> Back
        </button>
      )}
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onContinue}
        disabled={!canContinue}
        style={{
          padding: "12px 22px",
          background: canContinue
            ? `linear-gradient(135deg, #a855f7, ${t.accent})`
            : t.bgSurface,
          border: canContinue ? "none" : `1px solid ${t.border}`,
          borderRadius: 10,
          fontSize: 13, fontWeight: 700,
          color: canContinue ? "#fff" : t.textDim,
          cursor: canContinue ? "pointer" : "not-allowed",
          display: "inline-flex", alignItems: "center", gap: 8,
          boxShadow: canContinue ? `0 10px 28px rgba(168,85,247,0.4)` : "none",
        }}
      >
        Continue <ArrowRight size={13} />
      </button>
    </div>
  );
}

/* ──────────────────── Page ──────────────────── */

export default function CreateSkillPage() {
  const t = useTheme();
  const router = useRouter();
  const { createSkill } = useAgent();
  const { connected, address, showModal } = useWallet?.() || {};

  const [step, setStep] = useState(0);
  const [state, setState] = useState({
    name:      "",
    shortDesc: "",
    longDesc:  "",
    price:     "0",
    category:  "defi",
    // Phase 8 / hybrid skill model: skills can be metadata-only
    // (browse-only listing), or runnable. Runnable splits into:
    //   "builtin"     — orchestrator-side code we maintain (admins only)
    //   "http"        — author-hosted endpoint, anyone can publish
    // The kind selector below picks which path; "metadata" keeps the
    // legacy CategoryField in play for category labelling.
    kind:        "metadata", // "metadata" | "http"
    httpUrl:     "",
    tags:      [],
    imageUrl:  "",
  });
  const [tagDraft, setTagDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const patch = (next) => setState(s => ({ ...s, ...next }));

  const yoctoPrice = useMemo(() => nearToYocto(state.price), [state.price]);

  // Contract description cap is 240 chars. Combine short + long into one
  // blob for submission, bounded.
  const detailsValid = useMemo(() => {
    const nameOk = state.name.trim().length > 0 && state.name.length <= NAME_MAX;
    const shortOk = state.shortDesc.trim().length > 0 && state.shortDesc.length <= SHORT_MAX;
    if (state.kind === "http") {
      try { new URL(state.httpUrl); } catch { return false; }
      if (!/^https?:\/\//i.test(state.httpUrl)) return false;
    }
    return nameOk && shortOk;
  }, [state]);

  const priceValid = useMemo(() => {
    const n = Number(state.price);
    return !Number.isNaN(n) && n >= 0;
  }, [state.price]);

  const canAdvance = (from) => {
    if (from === 0) return detailsValid && priceValid;
    return true;
  };

  const goBack = () => setStep(s => Math.max(0, s - 1));
  const goNext = () => setStep(s => Math.min(STEPS.length - 1, s + 1));

  const handleSubmit = async () => {
    if (!connected) { showModal?.(); return; }
    setSubmitting(true);
    setError(null);
    try {
      // Concatenate short + long within the 240-char contract cap.
      const combined = [state.shortDesc.trim(), state.longDesc.trim()]
        .filter(Boolean).join("\n\n").slice(0, LONG_MAX);
      // Build the on-chain category. HTTP skills get a "http:<url>"
      // prefix so the orchestrator can dispatch to the author's
      // endpoint at run time. Metadata-only listings keep their
      // human-readable category label (clamped to CATEGORY_MAX).
      let category;
      if (state.kind === "http") {
        const url = state.httpUrl.trim();
        category = `http:${url}`;
        // Contract caps category at 32 chars currently — the URL
        // wouldn't fit. We bump the user up against that here so
        // they get a clear error before the on-chain call rejects.
        if (category.length > 240) {
          throw new Error("Endpoint URL too long for on-chain category");
        }
      } else {
        const label = (CATEGORIES.find(c => c.key === state.category) || {}).label || state.category;
        category = label.slice(0, CATEGORY_MAX);
      }
      await createSkill({
        name:        state.name.trim().slice(0, NAME_MAX),
        description: combined,
        priceYocto:  yoctoPrice,
        category,
        tags:        state.tags.slice(0, MAX_TAGS),
        imageUrl:    state.imageUrl.trim().slice(0, IMAGE_URL_MAX),
      });
      router.push("/skills");
    } catch (e) {
      setError(e?.message || "Publish failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <WizardHeader t={t} />
      <Stepper t={t} active={step} />

      <div className="cs-grid" style={{
        display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px",
        gap: 22, alignItems: "flex-start",
      }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {step === 0 && (
            <>
              <FormSection t={t} title="Basic information" subtitle="Give your skill a clear name and description.">
                <Field t={t} label="Skill name" maxLength={NAME_MAX}
                  value={state.name} onChange={(v) => patch({ name: v })}
                  placeholder="e.g. Airdrop Hunter"
                  error={state.name.length > NAME_MAX ? "Too long" : null}
                  hint="Choose a name that describes what your skill does." />
                <Field t={t} label="Short description" maxLength={SHORT_MAX}
                  value={state.shortDesc} onChange={(v) => patch({ shortDesc: v })}
                  placeholder="One-liner visible in the marketplace"
                  hint="One line summary of what your skill does." />
                <Field t={t} label="Detailed description"
                  value={state.longDesc} onChange={(v) => patch({ longDesc: v })}
                  placeholder="Explain what your skill does in detail"
                  multiline
                  hint={`Short + detailed are merged and capped at ${LONG_MAX} chars on-chain.`} />

                <SkillKindField t={t}
                  kind={state.kind}
                  onChange={(k) => patch({ kind: k })} />

                {state.kind === "http" && (
                  <Field t={t} label="Author endpoint URL"
                    value={state.httpUrl} onChange={(v) => patch({ httpUrl: v })}
                    placeholder="https://my-skill.example.com"
                    error={state.httpUrl && !/^https?:\/\/.+/i.test(state.httpUrl) ? "Must be http(s)://" : null}
                    hint="When the skill fires, our orchestrator POSTs to <url>/run with the user's params + a signed callback token. See /docs/skills for the full protocol." />
                )}

                {state.kind === "metadata" && (
                  <CategoryField t={t}
                    value={state.category}
                    onChange={(v) => patch({ category: v })} />
                )}

                <TagsField t={t}
                  tags={state.tags}
                  draft={tagDraft}
                  onDraftChange={setTagDraft}
                  onAdd={(raw) => {
                    const clean = String(raw || "").trim().toLowerCase();
                    if (!clean) return;
                    if (clean.length > TAG_MAX) return;
                    if (state.tags.includes(clean)) return;
                    if (state.tags.length >= MAX_TAGS) return;
                    patch({ tags: [...state.tags, clean] });
                    setTagDraft("");
                  }}
                  onRemove={(tag) => patch({ tags: state.tags.filter(x => x !== tag) })} />

                <Field t={t} label="Image URL (optional)"
                  value={state.imageUrl}
                  onChange={(v) => patch({ imageUrl: v })}
                  placeholder="https://…/skill.png"
                  maxLength={IMAGE_URL_MAX}
                  hint="Square tile used in the marketplace card. Falls back to a placeholder if empty." />
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
                  <strong style={{ color: t.white }}>Paid installs live.</strong> Phase 7 install fees
                  split 99% to the author and 1% to the IronShield treasury.
                  <div style={{ marginTop: 2, fontSize: 11.5, color: t.textDim }}>
                    Set price to 0 to keep the skill free.
                  </div>
                </div>
              </div>

              <WizardFooter t={t} canContinue={canAdvance(0)} showBack={false}
                onContinue={goNext} />
            </>
          )}

          {step === 1 && (
            <>
              <PlaceholderStep
                t={t}
                title="Permissions"
                body={
                  <>
                    Per-skill permissions land with the Phase 7 contract migration.
                    For now every skill is classified as read-only: it can see a
                    connected agent's profile fields, but cannot sign transactions
                    or transfer tokens. The preview on the right reflects that
                    baseline.
                  </>
                }
              />
              <WizardFooter t={t} canContinue showBack onBack={goBack} onContinue={goNext} />
            </>
          )}

          {step === 2 && (
            <>
              <PlaceholderStep
                t={t}
                title="Configure"
                body={
                  <>
                    Skill parameters (input schema, default config, webhook URL)
                    are captured off-chain in the functionality UI coming next.
                    Until then every skill publishes with the default empty
                    config and is invoked by name.
                  </>
                }
              />
              <WizardFooter t={t} canContinue showBack onBack={goBack} onContinue={goNext} />
            </>
          )}

          {step === 3 && (
            <ReviewStep
              t={t}
              state={state}
              author={address}
              yoctoPrice={yoctoPrice}
              submitting={submitting}
              error={error || (!connected ? "Connect a NEAR wallet to publish." : null)}
              onBack={goBack}
              onSubmit={handleSubmit}
            />
          )}
        </div>

        <aside style={{ minWidth: 0, position: "sticky", top: 76, display: "flex", flexDirection: "column", gap: 0 }}>
          <PreviewCard t={t} state={state} author={address} />
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
