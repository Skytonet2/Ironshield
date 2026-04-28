// src/components/connectors/connectorMeta.js
//
// Static UI metadata per connector — keeps the page + dialog free of
// switch statements. The backend's /api/connectors registry tells us
// which connectors exist and what auth_method they use; this file
// adds the human-facing copy and the form shape.

export const CONNECTOR_META = {
  tg: {
    label:    "Telegram",
    blurb:    "Notifications + outbound messaging via the IronShield bot.",
    color:    "#229ED9",
    flow:     "platform", // wired via TELEGRAM_BOT_TOKEN; users don't connect personally.
    fields:   [],
  },
  x: {
    label:    "X (Twitter)",
    blurb:    "Search, post, DM, and monitor mentions.",
    color:    "#1DA1F2",
    flow:     "oauth-soon",
    fields:   [],
  },
  facebook: {
    label:    "Facebook",
    blurb:    "Read public Groups + send Page DMs (24h customer-care window).",
    color:    "#1877F2",
    flow:     "oauth-soon",
    fields:   [],
  },
  jiji: {
    label:    "Jiji",
    blurb:    "Nigerian classifieds search (jiji.ng). No account required — best-effort scraper.",
    color:    "#10B981",
    flow:     "none",
    fields:   [],
  },
  email: {
    label:    "Email",
    blurb:    "Send via SMTP, read via IMAP. Use an app password (not your main login).",
    color:    "#A855F7",
    flow:     "form",
    fields:   [
      { key: "smtp.host",   label: "SMTP host",     placeholder: "smtp.gmail.com",   required: true },
      { key: "smtp.port",   label: "SMTP port",     placeholder: "587",              required: true, type: "number" },
      { key: "smtp.user",   label: "SMTP username", placeholder: "you@example.com",  required: true },
      { key: "smtp.pass",   label: "SMTP password", placeholder: "app password",     required: true, secret: true },
      { key: "imap.host",   label: "IMAP host",     placeholder: "imap.gmail.com",   required: true },
      { key: "imap.port",   label: "IMAP port",     placeholder: "993",              required: true, type: "number" },
      { key: "imap.user",   label: "IMAP username", placeholder: "you@example.com",  required: true },
      { key: "imap.pass",   label: "IMAP password", placeholder: "app password",     required: true, secret: true },
    ],
  },
  whatsapp: {
    label:    "WhatsApp Business",
    blurb:    "Cloud API. Needs a Meta Business Account + a system-user access token.",
    color:    "#25D366",
    flow:     "form",
    fields:   [
      { key: "access_token",         label: "System-user access token", placeholder: "EAA…", required: true, secret: true },
      { key: "phone_number_id",      label: "Phone number ID",          placeholder: "123…", required: true },
      { key: "business_account_id",  label: "WABA (Business) ID",       placeholder: "456…", required: true },
      { key: "app_secret",           label: "App secret (optional)",    placeholder: "for HMAC sig verification", secret: true },
    ],
  },
  linkedin: {
    label:    "LinkedIn",
    blurb:    "Best-effort cookie scraper. Account bans are an expected failure mode — read the compliance note before connecting.",
    color:    "#0A66C2",
    flow:     "form",
    fields:   [
      { key: "li_at", label: "li_at session cookie", placeholder: "AQED…", required: true, secret: true,
        hint: "In your browser's DevTools → Application → Cookies → linkedin.com → li_at. Treat this like a password." },
    ],
    warning:  "LinkedIn auto-apply is double-gated and disabled by default. Search and read-only profile scrape are best-effort.",
  },
};

/** Walk a "smtp.host" / "li_at" string into a nested payload object. */
export function flatToPayload(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    if (v == null || v === "") continue;
    const parts = k.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}
