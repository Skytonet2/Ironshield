// backend/services/skills/outreach_dm.js
//
// Multi-channel outreach skill. Routes to whichever connector(s) the
// user has connected. Channel preference order:
//   whatsapp > tg > x > email > facebook
// Kits that need a single-channel send pin `channel` explicitly.

const connectors = require("../../connectors");

const CHANNELS = ["whatsapp", "tg", "x", "email", "facebook"];

async function pickConnected(owner) {
  // Cheap probe: the credentialStore is a single SELECT.
  const credStore = require("../../connectors/credentialStore");
  const rows = await credStore.listForWallet(owner).catch(() => []);
  const have = new Set(rows.map((r) => r.connector_name));
  return CHANNELS.find((c) => have.has(c)) || null;
}

async function sendVia(channel, owner, target, message) {
  switch (channel) {
    case "whatsapp":
      return connectors.invoke("whatsapp", "send", { wallet: owner, params: { to: target, text: message } });
    case "tg":
      return connectors.invoke("tg", "rawSend", { wallet: owner, params: { chatId: target, text: message } });
    case "x":
      return connectors.invoke("x", "dm", { wallet: owner, params: { participantId: target, text: message } });
    case "email":
      return connectors.invoke("email", "send", { wallet: owner, params: { to: target, subject: message.split("\n")[0].slice(0, 80), text: message } });
    case "facebook":
      throw new Error("facebook outreach must specify pageId + recipientId");
    default:
      throw new Error(`outreach_dm: unknown channel ${channel}`);
  }
}

module.exports = {
  id: "outreach_dm",
  manifest: {
    title:   "Outreach DM",
    summary: "Sends a single message to a target via the user's preferred connected channel (WhatsApp, TG, X DM, email, etc.)",
    params: [
      { key: "channel", type: "string",  hint: "Optional pin: whatsapp|tg|x|email. Defaults to first connected." },
      { key: "target",  type: "string",  required: true, hint: "Channel-specific identifier (phone, tg chat id, x user id, email)" },
      { key: "message", type: "string",  required: true },
    ],
  },
  async execute({ owner, params = {} }) {
    if (!owner) throw new Error("outreach_dm: owner wallet required");
    if (!params.target || !params.message) throw new Error("outreach_dm: { target, message } required");
    const channel = params.channel || (await pickConnected(owner));
    if (!channel) {
      return { sent: false, reason: "no connected outreach channel — connect WhatsApp / TG / X / email first" };
    }
    try {
      const out = await sendVia(channel, owner, params.target, params.message);
      return { sent: true, channel, response: out };
    } catch (e) {
      return { sent: false, channel, error: e.message };
    }
  },
};
