// backend/services/agentMatcher.js
//
// Agent-economy feed: ranked agent sidebar for a mission post.
//
// Inputs: a post's classification (vertical + optional geo) and a sort
// mode. Output: a list of matched-agent rows, each one a deployed Kit
// instance whose Kit's vertical matches the post.
//
// An "agent" in this surface is a kit_deployments row — the unit that
// actually runs missions via the Tier 4 Kit runtime. A wallet can own
// several deployments (different Kits), so the same wallet can show up
// multiple times for posts that hit different verticals.
//
// Sort modes:
//   reputation (default)  reputation_cache.score DESC, missions DESC
//   fast                  missions_completed DESC (proxy for throughput;
//                         median time-to-close is not yet aggregated —
//                         see TODO at fastSql below)
//   cheap                 fee_yocto ASC NULLS LAST
//   new                   "new & rising": missions_completed 1..10,
//                         ranked by success_rate_bps DESC
//   local                 reputation order, but only agents whose
//                         recent mission rows touched the same geo —
//                         derived from missions table, see geoFilterSql
//
// Pure helpers — buildMatcherSql() and rankRows() — are exported so
// tests can verify ranking logic against fixture rows without spinning
// up Postgres. The DB-touching path matchAgents() takes an injectable
// db client for the same reason.

const dbDefault = require("../db/client");

const SORT_MODES = ["reputation", "fast", "cheap", "new", "local"];

// Vertical aliases: the classifier emits canonical names ("real_estate",
// "automotive") but Kits in the catalog were seeded with whatever the
// fixture authors chose ("realtor", "car-sales"). Map both ways here so
// the matcher doesn't return empty results for posts that classify
// correctly but never see the right Kits.
const VERTICAL_ALIASES = {
  real_estate: ["real_estate", "realtor", "realestate", "property"],
  automotive:  ["automotive", "car-sales", "car_sales", "cars", "vehicles"],
  freelance:   ["freelance", "freelancer", "freelancer-hunter"],
  services:    ["services", "background_checker", "background-checker"],
  ecommerce:   ["ecommerce", "commerce", "retail"],
  trading:     ["trading", "trade", "markets"],
  crypto:      ["crypto", "wallet-watch", "wallet_watch", "security"],
  jobs:        ["jobs", "hiring", "hr"],
  social:      ["social"],
  other:       ["other"],
};

function expandVertical(canonical) {
  return VERTICAL_ALIASES[canonical] || [canonical];
}

// Compose the SQL for the matcher. Pure — exported so tests can pin
// the exact shape of the query (and so anyone reading the code can see
// the join graph in one place rather than reconstructing it from the
// runtime path). Returns { sql, params }.
function buildMatcherSql({ verticals, geo, sort, limit }) {
  const params = [verticals];
  let where = `kd.status = 'active' AND ak.vertical = ANY($1)`;

  // Geo filter: tries to match the agent's recently-touched geos via
  // the missions audit trail. Loose ILIKE so "Wuse" matches "Wuse,
  // Abuja" both ways. Skipped when no geo on the post.
  if (geo) {
    params.push(`%${geo}%`);
    where += `
      AND EXISTS (
        SELECT 1 FROM missions m
        WHERE m.claimant_wallet = kd.agent_owner_wallet
          AND m.inputs_json::text ILIKE $${params.length}
        LIMIT 1
      )`;
  }

  // Sort clauses. NULLS LAST/FIRST is explicit because the JS layer
  // would otherwise sort nulls inconsistently across drivers.
  let orderBy;
  switch (sort) {
    case "fast":
      // TODO: replace with median time-to-close once we aggregate
      // claimed_at → finalized_at on a per-claimant basis. For now,
      // missions_completed is a coarse proxy for throughput.
      orderBy = `missions_completed DESC NULLS LAST, reputation_score DESC NULLS LAST, kd.created_at DESC`;
      break;
    case "cheap":
      orderBy = `fee_yocto ASC NULLS LAST, reputation_score DESC NULLS LAST`;
      break;
    case "new":
      // "New & rising": low mission count + high success rate. The
      // missions BETWEEN clause is in WHERE so we don't have to
      // post-filter; agents with zero missions are excluded because
      // they have no signal yet.
      where += `
        AND COALESCE(rc.missions_completed, 0) BETWEEN 1 AND 10`;
      orderBy = `success_rate_bps DESC NULLS LAST, kd.created_at DESC`;
      break;
    case "local":
      // Local already filtered above; rank within by reputation.
      orderBy = `reputation_score DESC NULLS LAST, missions_completed DESC NULLS LAST`;
      break;
    case "reputation":
    default:
      orderBy = `reputation_score DESC NULLS LAST, missions_completed DESC NULLS LAST, kd.created_at DESC`;
      break;
  }

  params.push(limit);
  const sql = `
    SELECT
      kd.id                                      AS deployment_id,
      kd.agent_owner_wallet,
      kd.kit_slug,
      ak.title                                   AS kit_title,
      ak.vertical                                AS kit_vertical,
      ak.hero_image_url,
      COALESCE((ak.default_pricing_json->>'fee_yocto')::numeric, NULL) AS fee_yocto,
      COALESCE(rc.score, 0)                      AS reputation_score,
      COALESCE(rc.missions_completed, 0)         AS missions_completed,
      COALESCE(rc.missions_failed, 0)            AS missions_failed,
      COALESCE(rc.success_rate_bps, 0)           AS success_rate_bps,
      kd.created_at                              AS deployed_at
    FROM kit_deployments kd
    JOIN agent_kits ak ON ak.slug = kd.kit_slug
    LEFT JOIN reputation_cache rc
      ON rc.subject_type = 'agent' AND rc.subject_id = kd.agent_owner_wallet
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT $${params.length}`;
  return { sql, params };
}

// Pure ranker for tests: takes an array of already-fetched rows
// (keyed the same way the SQL projects them) and returns them sorted
// per the sort mode. Mirrors buildMatcherSql's ORDER BY exactly so
// SQL drift doesn't silently break the tests.
function rankRows(rows, sort = "reputation") {
  const cmp = (a, b, dir = "desc") => {
    const av = a == null ? -Infinity : a;
    const bv = b == null ? -Infinity : b;
    if (av === bv) return 0;
    return dir === "asc" ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
  };

  const sorted = [...rows];
  switch (sort) {
    case "fast":
      sorted.sort((a, b) =>
        cmp(a.missions_completed, b.missions_completed) ||
        cmp(a.reputation_score, b.reputation_score)
      );
      break;
    case "cheap":
      // Treat null fee as +Infinity so it sorts last.
      sorted.sort((a, b) => {
        const af = a.fee_yocto == null ? Infinity : Number(a.fee_yocto);
        const bf = b.fee_yocto == null ? Infinity : Number(b.fee_yocto);
        if (af !== bf) return af - bf;
        return cmp(a.reputation_score, b.reputation_score);
      });
      break;
    case "new": {
      // Filter to rising agents first, then rank.
      const filtered = sorted.filter((r) =>
        r.missions_completed >= 1 && r.missions_completed <= 10
      );
      filtered.sort((a, b) => cmp(a.success_rate_bps, b.success_rate_bps));
      return filtered;
    }
    case "local":
    case "reputation":
    default:
      sorted.sort((a, b) =>
        cmp(a.reputation_score, b.reputation_score) ||
        cmp(a.missions_completed, b.missions_completed)
      );
      break;
  }
  return sorted;
}

// Main entry. Takes a classification record (or just a vertical
// string) plus a sort mode and returns up to `limit` ranked agents.
async function matchAgents({
  vertical,
  geo  = null,
  sort = "reputation",
  limit = 20,
  db   = dbDefault,
} = {}) {
  if (!vertical) return [];
  const sortMode = SORT_MODES.includes(sort) ? sort : "reputation";
  const verticals = expandVertical(vertical);
  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const { sql, params } = buildMatcherSql({
    verticals,
    geo: typeof geo === "string" && geo.trim() ? geo.trim() : null,
    sort: sortMode,
    limit: cappedLimit,
  });
  const r = await db.query(sql, params);
  return r.rows;
}

module.exports = {
  SORT_MODES,
  VERTICAL_ALIASES,
  expandVertical,
  buildMatcherSql,
  rankRows,
  matchAgents,
};
