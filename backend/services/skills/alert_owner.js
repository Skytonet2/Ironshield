// backend/services/skills/alert_owner.js
//
// Phase 10 — Wallet Watch Kit, Outreach role.
//
// Dispatches the formatted alert to the wallet owner via Telegram.
// Auth gating happens upstream: `crewOrchestrator` calls
// `authEngine.check({ action_type: 'send_message', ... })` before this
// skill runs. Recipient_count = 1 falls below the mass-DM threshold,
// so the verdict is auto and we just dispatch. This module deliberately
// does NOT call authEngine.check itself — doing so would write a second
// escalation row whenever the orchestrator's pre-step check returns
// notify, and the gate is already covered.
//
// `tg_chat_id` is resolved by tgNotify.notifyWallet via the
// feed_users → feed_tg_links join, so the only owner identifier we
// need here is the NEAR wallet.

const tgNotify = require("../tgNotify");

const ALERT_SETTING_KEY = "mission_alert";

function buildText({ headline, summary }) {
  const lines = [];
  lines.push(`*${headline || "Wallet watch alert"}*`);
  if (summary) {
    lines.push("");
    lines.push(String(summary).slice(0, 1024));
  }
  return lines.join("\n");
}

module.exports = {
  id: "alert_owner",
  manifest: {
    title:   "Owner alert dispatcher",
    summary: "Sends the wallet-watch alert to the owner over Telegram. Single recipient — runs at auto policy.",
    params: [
      { key: "owner_wallet", type: "string", hint: "Wallet of the alert recipient" },
      { key: "headline",     type: "string", hint: "One-line summary from classify_alert" },
      { key: "summary",      type: "string", default: "", hint: "Multi-line body from classify_alert" },
      { key: "channel",      type: "string", default: "tg", hint: "Reserved for future SMS/email channels" },
    ],
  },
  async execute({ params = {} }) {
    const ownerWallet = String(params.owner_wallet || "").trim();
    if (!ownerWallet) throw new Error("alert_owner: params.owner_wallet required");
    const channel = String(params.channel || "tg");
    if (channel !== "tg") {
      return { dispatched: false, channel, recipients: 0, reason: "unsupported_channel" };
    }

    const text = buildText({ headline: params.headline, summary: params.summary });

    const notify = params._notify || tgNotify.notifyWallet;
    let recipients = 0;
    try {
      recipients = await notify(ownerWallet, ALERT_SETTING_KEY, text, { markdown: true });
    } catch (e) {
      return { dispatched: false, channel, recipients: 0, error: e.message };
    }

    return {
      dispatched: recipients > 0,
      channel,
      recipients,
    };
  },
};
