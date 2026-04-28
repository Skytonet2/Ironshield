// backend/services/skills/scout_jiji.js
//
// Jiji classifieds scout — used by the Realtor + Car Sales Kits as the
// primary classifieds source for Nigerian markets. Best-effort: the
// connector throws JIJI_PLAYWRIGHT_MISSING on hosts without runtime
// playwright; we return that as a normal fallback shape so the Kit
// chain continues with its other scouts.

const connectors = require("../../connectors");

module.exports = {
  id: "scout_jiji",
  manifest: {
    title:   "Jiji classifieds scout",
    summary: "Searches jiji.ng listings for the supplied query + filters. Best-effort scraper — see connector COMPLIANCE.md.",
    params: [
      { key: "query",      type: "string", required: true },
      { key: "location",   type: "string", hint: "Filter by Nigerian state / city" },
      { key: "min_price",  type: "number" },
      { key: "max_price",  type: "number" },
      { key: "limit",      type: "number", default: 20 },
    ],
  },
  async execute({ owner, params = {} }) {
    if (!params.query) throw new Error("scout_jiji: { query } required");
    const resp = await connectors
      .invoke("jiji", "search", {
        wallet: owner,
        params: {
          query: params.query,
          location: params.location,
          minPrice: params.min_price,
          maxPrice: params.max_price,
          limit: params.limit || 20,
        },
      })
      .catch((e) => ({ error: e.message, code: e.code }));
    if (resp.error) {
      // Treat as soft-fail so Kits chain through other scouts.
      return { source: "jiji.ng", items: [], degraded: true, error: resp.error };
    }
    return resp; // already shaped { source, query, count, items }
  },
};
