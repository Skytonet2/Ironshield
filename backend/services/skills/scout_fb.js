// backend/services/skills/scout_fb.js
//
// Facebook scout — used by the Realtor + Car Sales + Background
// Checker Kits. The connector's `marketplace_search` is unsupported
// (no Graph API endpoint), so this skill scopes to public-Group reads
// when the user has supplied a group_id, and otherwise returns an
// explicit "no-Graph-API" hint that the calling Kit uses to fall back
// to the jiji connector.

const connectors = require("../../connectors");

module.exports = {
  id: "scout_fb",
  manifest: {
    title:   "Facebook scout",
    summary: "Reads public Facebook Groups the user has access to. Marketplace search is intentionally unsupported by Graph API; Kits fall back to jiji.",
    params: [
      { key: "group_id", type: "string", hint: "Facebook Group ID. If empty, skill returns a fallback hint." },
      { key: "limit",    type: "number", default: 25 },
      { key: "filter",   type: "string", hint: "Optional substring filter applied client-side to message bodies" },
    ],
  },
  async execute({ owner, params = {} }) {
    if (!params.group_id) {
      return {
        source: "facebook",
        items: [],
        fallback: "use jiji connector for classifieds search; Facebook Marketplace has no public Graph API",
      };
    }
    const resp = await connectors
      .invoke("facebook", "groups_read", {
        wallet: owner,
        params: { groupId: params.group_id, limit: params.limit || 25 },
      })
      .catch((e) => ({ error: e.message, status: e.status }));
    if (resp.error) {
      return { source: "facebook", items: [], error: resp.error };
    }
    const raw = Array.isArray(resp?.data) ? resp.data : [];
    const filt = params.filter ? String(params.filter).toLowerCase() : null;
    const items = raw
      .filter((p) => !filt || (p.message || "").toLowerCase().includes(filt))
      .map((p) => ({
        id: p.id,
        text: p.message || "",
        author: p.from?.name || null,
        created_at: p.created_time || null,
        url: p.permalink_url || null,
      }));
    return { source: "facebook", group_id: params.group_id, count: items.length, items };
  },
};
