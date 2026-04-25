// 30 first-party avatar presets — emoji on a gradient ring. Stored
// references look like "preset:robot-purple"; the renderer parses the
// suffix to look up `{ emoji, from, to }` here. Adding a preset is a
// matter of appending to PRESETS — every consumer renders the same
// SVG so the avatar stays consistent across nav, dashboard, and
// share cards.
//
// Order is intentional: agent / mascot / abstract themes interleave
// so the wizard's grid feels varied at first glance instead of three
// solid color rows.

export const PRESETS = [
  { id: "robot-purple",   emoji: "🤖", from: "#a855f7", to: "#3b82f6" },
  { id: "shield-blue",    emoji: "🛡️", from: "#60a5fa", to: "#1e40af" },
  { id: "lightning-amber",emoji: "⚡", from: "#f59e0b", to: "#7c2d12" },
  { id: "rocket-pink",    emoji: "🚀", from: "#ec4899", to: "#7e22ce" },
  { id: "brain-teal",     emoji: "🧠", from: "#2dd4bf", to: "#0e7490" },
  { id: "magnify-cyan",   emoji: "🔍", from: "#22d3ee", to: "#0c4a6e" },
  { id: "owl-violet",     emoji: "🦉", from: "#8b5cf6", to: "#3730a3" },
  { id: "fox-orange",     emoji: "🦊", from: "#fb923c", to: "#9a3412" },
  { id: "wolf-slate",     emoji: "🐺", from: "#94a3b8", to: "#1e293b" },
  { id: "dragon-emerald", emoji: "🐉", from: "#34d399", to: "#064e3b" },
  { id: "phoenix-rose",   emoji: "🦅", from: "#f43f5e", to: "#7f1d1d" },
  { id: "ninja-graphite", emoji: "🥷", from: "#475569", to: "#0f172a" },
  { id: "pirate-ruby",    emoji: "🏴", from: "#dc2626", to: "#450a0a" },
  { id: "wizard-indigo",  emoji: "🧙", from: "#6366f1", to: "#1e1b4b" },
  { id: "alien-lime",     emoji: "👽", from: "#a3e635", to: "#365314" },
  { id: "ghost-mist",     emoji: "👻", from: "#cbd5e1", to: "#475569" },
  { id: "atom-sky",       emoji: "⚛️", from: "#38bdf8", to: "#075985" },
  { id: "diamond-aqua",   emoji: "💎", from: "#67e8f9", to: "#155e75" },
  { id: "fire-coral",     emoji: "🔥", from: "#fb7185", to: "#881337" },
  { id: "leaf-forest",    emoji: "🌿", from: "#86efac", to: "#14532d" },
  { id: "wave-deep",      emoji: "🌊", from: "#3b82f6", to: "#1e3a8a" },
  { id: "snow-arctic",    emoji: "❄️", from: "#bfdbfe", to: "#1e40af" },
  { id: "moon-night",     emoji: "🌙", from: "#a78bfa", to: "#312e81" },
  { id: "sun-gold",       emoji: "☀️", from: "#fde047", to: "#854d0e" },
  { id: "star-cosmic",    emoji: "⭐", from: "#fcd34d", to: "#7c2d12" },
  { id: "crystal-prism",  emoji: "🔮", from: "#c084fc", to: "#581c87" },
  { id: "trophy-laurel",  emoji: "🏆", from: "#facc15", to: "#713f12" },
  { id: "coin-treasure",  emoji: "🪙", from: "#fbbf24", to: "#78350f" },
  { id: "compass-azimuth",emoji: "🧭", from: "#5eead4", to: "#134e4a" },
  { id: "key-skeleton",   emoji: "🗝️", from: "#facc15", to: "#1f2937" },
];

const BY_ID = Object.fromEntries(PRESETS.map(p => [p.id, p]));

/** Parse an avatar reference into a renderable shape:
 *    "preset:<id>"          → { kind: "preset", preset }
 *    "data:image/...;base64" → { kind: "data",   src }
 *    "https://..." (or any URL) → { kind: "url", src }
 *    falsy                  → { kind: "none" }
 */
export function parseAvatar(value) {
  if (!value || typeof value !== "string") return { kind: "none" };
  if (value.startsWith("preset:")) {
    const id = value.slice(7);
    const preset = BY_ID[id] || PRESETS[0];
    return { kind: "preset", preset };
  }
  if (value.startsWith("data:image/")) return { kind: "data", src: value };
  if (/^https?:\/\//.test(value))      return { kind: "url",  src: value };
  // Anything else (raw filename, garbage) → fall back to default preset.
  return { kind: "preset", preset: PRESETS[0] };
}

export function defaultAvatar() {
  return `preset:${PRESETS[0].id}`;
}
