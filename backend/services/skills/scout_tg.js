// backend/services/skills/scout_tg.js
//
// Telegram scout — used by the Freelancer Hunter Kit. The TG connector
// is outbound-only (rawSend / notifyWallet / broadcast) — inbound
// monitoring requires the orchestrator bot to subscribe to channels
// and emit eventBus events.
//
// v1 wires that as a soft-fail: this skill returns the most recent N
// inbound events buffered by the orchestrator (when present), or a
// `degraded: true` shape with a clear reason. The Kit chains scout_x
// alongside this one so a degraded TG scout doesn't kill the mission.

const eventBus = require("../../services/eventBus");

// Ring buffer of recent inbound TG messages, populated by the
// orchestrator bot via `eventBus.emit('connector:tg:message', ...)`.
// Bounded to MAX_BUFFER entries — older messages drop off.
const MAX_BUFFER = 256;
const buffer = [];

eventBus.on?.("connector:tg:message", (msg) => {
  buffer.push({ ...msg, _ts: Date.now() });
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
});

module.exports = {
  id: "scout_tg",
  manifest: {
    title:   "Telegram scout",
    summary: "Surfaces recent inbound Telegram messages buffered by the orchestrator bot, optionally filtered by a substring. Returns degraded:true if inbound monitoring isn't wired yet.",
    params: [
      { key: "filter",  type: "string", hint: "Optional case-insensitive substring filter on message text" },
      { key: "since_ms", type: "number", hint: "Only return messages newer than this Unix epoch ms" },
      { key: "limit",   type: "number", default: 25 },
    ],
  },
  async execute({ params = {} }) {
    if (buffer.length === 0) {
      return {
        source: "tg",
        items: [],
        degraded: true,
        reason: "no inbound TG events buffered — orchestrator bot must emit connector:tg:message events from the channels you've added it to",
      };
    }
    const filt = params.filter ? String(params.filter).toLowerCase() : null;
    const since = Number(params.since_ms) || 0;
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
    const out = buffer
      .filter((m) => m._ts >= since)
      .filter((m) => !filt || String(m.text || "").toLowerCase().includes(filt))
      .slice(-limit)
      .reverse();
    return { source: "tg", count: out.length, items: out };
  },
  // exposed for tests
  _buffer: buffer,
};
