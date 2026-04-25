// backend/services/agents/index.js
//
// Adapter dispatcher. Resolves a framework key to its adapter module
// and exposes a uniform surface (`validate`, `healthPoll`,
// `sendMessage`, `listMetrics`) that routes don't have to switch on.

const openclaw = require("./openclawAdapter");
const ironclaw = require("./ironclawAdapter");
const webhook  = require("./webhookAdapter");

const ADAPTERS = {
  openclaw,
  ironclaw,
  self_hosted: webhook,
};

function get(framework) {
  const a = ADAPTERS[framework];
  if (!a) throw new Error(`Unknown framework: ${framework}`);
  return a;
}

function listFrameworks() {
  return Object.values(ADAPTERS).map(a => ({
    key:      a.name,
    display:  a.display,
    docs_url: a.docs_url,
  }));
}

module.exports = { get, listFrameworks, ADAPTERS };
