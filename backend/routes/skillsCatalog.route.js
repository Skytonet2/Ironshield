// backend/routes/skillsCatalog.route.js
//
// Phase 10 Tier 5 — read-side catalog surface.
// Mounted under /api/skills/catalog (slice 2), /api/skills/authors
// (slice 4), /api/skills/:skill_id/versions (slice 5).
//
// All endpoints are public reads. The execution surface (run, registry,
// http_callback, record-install, revenue, history) lives in
// skills.route.js; this file is intentionally separate so the catalog
// can scale independently of the runtime.
//
// Source of truth:
//   - skill_runtime_manifests   (off-chain manifest row, with name +
//                                description mirrored from the contract,
//                                lifecycle_status set by admins)
//   - skill_sales               (rev/install counts per skill + per author)
//   - skill_reviews             (avg rating / review count)
//
// FTS uses the GIN index added in slice 1
// (idx_skill_manifests_fts), built over a tsvector over name +
// description + prompt_fragment. The query path uses
// websearch_to_tsquery so users get sensible quoted-phrase / negation
// behavior without learning postgres syntax.

const router = require("express").Router({ mergeParams: true });
const db = require("../db/client");

// Default to showing only the moderation states that are meant to be
// publicly browsable. Admins can override via ?status= but anonymous
// users only see curated/public.
const PUBLIC_LIFECYCLES = ["curated", "public"];

// Cap LIMIT so a curious request can't request a million rows. The
// frontend uses cursor pagination via ?cursor=<id>, not page numbers.
const MAX_LIMIT = 50;

const VALID_SORTS = new Set(["relevance", "rating", "installs", "newest"]);

/** Parse a comma-separated query param into a clean array. */
function csv(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** GET /api/skills/catalog
 *  Query params:
 *    q         — full-text query (websearch syntax: phrases, OR, -neg)
 *    vertical  — comma-separated vertical_tags (any-match, OR semantics)
 *    connector — comma-separated required_connectors (any-match)
 *    min_rating — float 1.0–5.0
 *    sort      — relevance | rating | installs | newest (default relevance
 *                if q present, else newest)
 *    cursor    — opaque pagination cursor (id of last row from prev page)
 *    limit     — 1..50 (default 24)
 *    status    — admin-only override; defaults to PUBLIC_LIFECYCLES
 *
 *  Returns: { rows: [...], nextCursor: id|null, total_estimate: int }
 *
 *  rows shape:
 *    skill_id, version, name, description, category, vertical_tags,
 *    required_connectors, lifecycle_status, manifest_hash,
 *    deployed_at, avg_rating, review_count, install_count,
 *    earnings_yocto
 */
router.get("/catalog", async (req, res) => {
  try {
    const q          = String(req.query.q || "").trim();
    const verticals  = csv(req.query.vertical);
    const connectors = csv(req.query.connector);
    const minRating  = req.query.min_rating ? Number(req.query.min_rating) : null;
    const limit      = Math.min(Math.max(Number(req.query.limit) || 24, 1), MAX_LIMIT);
    const cursor     = req.query.cursor ? Number(req.query.cursor) : null;
    const status     = csv(req.query.status).filter(s =>
      ["internal","curated","public","deprecated","slashed"].includes(s)
    );

    let sort = String(req.query.sort || "").toLowerCase();
    if (!VALID_SORTS.has(sort)) sort = q ? "relevance" : "newest";
    if (sort === "relevance" && !q) sort = "newest";

    const params = [];
    const where = [];
    let qIdx = null; // index of the q param, for ts_rank reuse

    // Lifecycle filter. Anonymous users see curated/public; admin
    // panel can pass explicit ?status=internal,deprecated etc. We
    // intentionally don't gate "internal" behind admin auth here —
    // exposing internal skill metadata isn't a privacy concern, the
    // runtime just won't surface them by default.
    const lifecycles = status.length ? status : PUBLIC_LIFECYCLES;
    params.push(lifecycles);
    where.push(`m.lifecycle_status = ANY($${params.length}::text[])`);

    if (q) {
      params.push(q);
      qIdx = params.length;
      where.push(`to_tsvector('english',
                    coalesce(m.name,'') || ' ' ||
                    coalesce(m.description,'') || ' ' ||
                    coalesce(m.prompt_fragment,''))
                  @@ websearch_to_tsquery('english', $${qIdx})`);
    }

    if (verticals.length) {
      params.push(verticals);
      where.push(`m.vertical_tags && $${params.length}::text[]`);
    }

    if (connectors.length) {
      params.push(connectors);
      where.push(`m.required_connectors && $${params.length}::text[]`);
    }

    if (cursor && Number.isFinite(cursor)) {
      params.push(cursor);
      where.push(`m.id < $${params.length}`);
    }

    // min_rating is a HAVING clause because it filters on the
    // aggregated avg(rating).
    let havingClause = "";
    if (minRating !== null && Number.isFinite(minRating)) {
      params.push(minRating);
      havingClause = `HAVING COALESCE(AVG(r.rating), 0) >= $${params.length}`;
    }

    // Sort clause is parameterless; we already validated `sort`
    // against VALID_SORTS so it's safe to interpolate.
    let orderBy;
    if (sort === "relevance" && qIdx) {
      // Reuse the q param index for ts_rank — captured at push time.
      orderBy = `ORDER BY ts_rank(
        to_tsvector('english',
          coalesce(m.name,'') || ' ' ||
          coalesce(m.description,'') || ' ' ||
          coalesce(m.prompt_fragment,'')),
        websearch_to_tsquery('english', $${qIdx})) DESC, m.id DESC`;
    } else if (sort === "rating") {
      orderBy = `ORDER BY COALESCE(AVG(r.rating), 0) DESC NULLS LAST, m.id DESC`;
    } else if (sort === "installs") {
      orderBy = `ORDER BY install_count DESC, m.id DESC`;
    } else {
      orderBy = `ORDER BY m.deployed_at DESC, m.id DESC`;
    }

    params.push(limit + 1); // +1 to detect hasMore

    const sql = `
      SELECT
        m.id,
        m.skill_id,
        m.version,
        m.name,
        m.description,
        m.category,
        m.vertical_tags,
        m.required_connectors,
        m.lifecycle_status,
        m.manifest_hash,
        m.deployed_at,
        COALESCE(AVG(r.rating), 0)::float                   AS avg_rating,
        COUNT(r.*)::int                                     AS review_count,
        COALESCE(s.install_count, 0)::int                   AS install_count,
        COALESCE(s.earnings_yocto, 0)::text                 AS earnings_yocto
      FROM skill_runtime_manifests m
      LEFT JOIN skill_reviews r
        ON r.skill_id = m.skill_id
      LEFT JOIN (
        SELECT skill_id,
               COUNT(*)::int                       AS install_count,
               SUM(creator_take_yocto)::numeric    AS earnings_yocto
          FROM skill_sales
         GROUP BY skill_id
      ) s ON s.skill_id::bigint = m.skill_id
      WHERE ${where.join(" AND ")}
      GROUP BY m.id, s.install_count, s.earnings_yocto
      ${havingClause}
      ${orderBy}
      LIMIT $${params.length}`;

    const r = await db.query(sql, params);
    const hasMore = r.rows.length > limit;
    const rows = hasMore ? r.rows.slice(0, limit) : r.rows;
    const nextCursor = hasMore ? rows[rows.length - 1].id : null;

    res.json({ rows, nextCursor });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/skills/catalog/facets
 *  Returns the distinct values currently present in the catalog so
 *  the UI can render filter chips without hard-coding lists. Cheap
 *  query — distinct over arrays, no joins.
 */
router.get("/catalog/facets", async (_req, res) => {
  try {
    const verticalsQ = db.query(`
      SELECT unnest(vertical_tags) AS v, COUNT(*)::int AS n
        FROM skill_runtime_manifests
       WHERE lifecycle_status = ANY($1::text[])
       GROUP BY v
       ORDER BY n DESC
       LIMIT 50`,
      [PUBLIC_LIFECYCLES]
    );
    const connectorsQ = db.query(`
      SELECT unnest(required_connectors) AS c, COUNT(*)::int AS n
        FROM skill_runtime_manifests
       WHERE lifecycle_status = ANY($1::text[])
       GROUP BY c
       ORDER BY n DESC
       LIMIT 50`,
      [PUBLIC_LIFECYCLES]
    );
    const [verticals, connectors] = await Promise.all([verticalsQ, connectorsQ]);
    res.json({
      verticals: verticals.rows,
      connectors: connectors.rows,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/skills/authors
 *  Slice 4 — leaderboard of skill authors by lifetime earnings.
 *  Public read. Joins skill_sales (creator_wallet) with feed_users so
 *  we can show username + avatar instead of just a wallet hash.
 *
 *  Query params:
 *    sort   — earnings (default) | sales | skills_count
 *    window — all (default) | 7d | 30d
 *    limit  — 1..100, default 50
 *    cursor — page boundary (last row's earnings_yocto from prev page)
 */
router.get("/authors", async (req, res) => {
  try {
    const sort   = ["earnings", "sales", "skills_count"].includes(String(req.query.sort))
      ? String(req.query.sort)
      : "earnings";
    const window = ["all", "7d", "30d"].includes(String(req.query.window))
      ? String(req.query.window)
      : "all";
    const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);

    let windowClause = "";
    if (window === "7d") windowClause = "AND sold_at >= NOW() - INTERVAL '7 days'";
    if (window === "30d") windowClause = "AND sold_at >= NOW() - INTERVAL '30 days'";

    let orderBy;
    if (sort === "sales") orderBy = "sales DESC, earnings_yocto DESC";
    else if (sort === "skills_count") orderBy = "skills_count DESC, earnings_yocto DESC";
    else orderBy = "earnings_yocto DESC, sales DESC";

    const sql = `
      WITH agg AS (
        SELECT creator_wallet,
               COUNT(*)::int                          AS sales,
               COUNT(DISTINCT skill_id)::int          AS skills_count,
               SUM(creator_take_yocto)::numeric       AS earnings_yocto,
               SUM(creator_take_yocto)
                 FILTER (WHERE sold_at >= NOW() - INTERVAL '30 days')::numeric
                                                      AS earnings_30d_yocto,
               MAX(sold_at)                           AS last_sale_at
          FROM skill_sales
         WHERE creator_wallet IS NOT NULL
           ${windowClause}
         GROUP BY creator_wallet
      ),
      skill_totals AS (
        SELECT creator_wallet, skill_id,
               SUM(creator_take_yocto)::numeric AS skill_earnings_yocto
          FROM skill_sales
         WHERE creator_wallet IS NOT NULL
         GROUP BY creator_wallet, skill_id
      ),
      top_skill AS (
        -- Pick each author's top-earning skill_id. DISTINCT ON is the
        -- standard postgres trick for "first row per group" with a
        -- chosen ordering.
        SELECT DISTINCT ON (creator_wallet)
               creator_wallet, skill_id, skill_earnings_yocto
          FROM skill_totals
         ORDER BY creator_wallet, skill_earnings_yocto DESC
      )
      SELECT a.creator_wallet                    AS wallet,
             u.username,
             u.pfp_url                            AS avatar_url,
             u.display_name,
             a.sales,
             a.skills_count,
             a.earnings_yocto::text              AS earnings_yocto,
             a.earnings_30d_yocto::text          AS earnings_30d_yocto,
             a.last_sale_at,
             t.skill_id                          AS top_skill_id,
             tm.name                             AS top_skill_name,
             t.skill_earnings_yocto::text        AS top_skill_earnings_yocto
        FROM agg a
        LEFT JOIN feed_users u
          ON LOWER(u.wallet_address) = LOWER(a.creator_wallet)
        LEFT JOIN top_skill t
          ON t.creator_wallet = a.creator_wallet
        LEFT JOIN LATERAL (
          SELECT name FROM skill_runtime_manifests
           WHERE skill_id::text = t.skill_id
           ORDER BY deployed_at DESC LIMIT 1
        ) tm ON TRUE
       ORDER BY ${orderBy}
       LIMIT $1`;

    const r = await db.query(sql, [limit]);
    res.json({ rows: r.rows, sort, window });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/skills/:skill_id/versions
 *  Slice 5 — list every version of a skill plus its hash, statuses,
 *  and a row count of how many fields differ from the previous
 *  version (computed lazily by the diff endpoint, not here).
 */
router.get("/:skill_id/versions", async (req, res) => {
  try {
    const skillId = Number(req.params.skill_id);
    if (!Number.isFinite(skillId)) {
      return res.status(400).json({ error: "skill_id must be an integer" });
    }
    const r = await db.query(
      `SELECT id, skill_id, version, name, description, category,
              vertical_tags, required_connectors,
              manifest_hash, status, lifecycle_status, deployed_at
         FROM skill_runtime_manifests
        WHERE skill_id = $1
        ORDER BY deployed_at DESC, id DESC`,
      [skillId]
    );
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/skills/:skill_id/versions/:version
 *  Returns the full manifest body for a single version.
 */
router.get("/:skill_id/versions/:version", async (req, res) => {
  try {
    const skillId = Number(req.params.skill_id);
    const version = String(req.params.version);
    if (!Number.isFinite(skillId)) {
      return res.status(400).json({ error: "skill_id must be an integer" });
    }
    const r = await db.query(
      `SELECT id, skill_id, version, name, description, category,
              vertical_tags, prompt_fragment,
              tool_manifest_json AS tool_manifest,
              required_connectors,
              io_schema_json AS io_schema,
              manifest_hash, status, lifecycle_status, deployed_at
         FROM skill_runtime_manifests
        WHERE skill_id = $1 AND version = $2`,
      [skillId, version]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "not found" });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/skills/:skill_id/diff?from=<v1>&to=<v2>
 *  Structured field-level diff between two manifest versions of the
 *  same skill. Returns null on any field that's identical, or
 *  { from, to } pairs on changed fields. JSONB fields are compared by
 *  stringify-and-equal — good enough for v1, doesn't paint a tree.
 */
router.get("/:skill_id/diff", async (req, res) => {
  try {
    const skillId = Number(req.params.skill_id);
    const from = String(req.query.from || "");
    const to   = String(req.query.to   || "");
    if (!Number.isFinite(skillId)) return res.status(400).json({ error: "skill_id must be an integer" });
    if (!from || !to) return res.status(400).json({ error: "from and to versions required" });
    if (from === to) return res.status(400).json({ error: "from and to must differ" });

    const r = await db.query(
      `SELECT version, name, description, category, vertical_tags,
              prompt_fragment,
              tool_manifest_json AS tool_manifest,
              required_connectors,
              io_schema_json AS io_schema,
              manifest_hash, status, lifecycle_status, deployed_at
         FROM skill_runtime_manifests
        WHERE skill_id = $1 AND version = ANY($2::text[])`,
      [skillId, [from, to]]
    );
    if (r.rows.length < 2) {
      return res.status(404).json({ error: "one or both versions not found" });
    }
    const a = r.rows.find(x => x.version === from);
    const b = r.rows.find(x => x.version === to);

    const eqArr = (x, y) => {
      const xa = Array.isArray(x) ? x : [];
      const ya = Array.isArray(y) ? y : [];
      if (xa.length !== ya.length) return false;
      const xs = [...xa].sort();
      const ys = [...ya].sort();
      return xs.every((v, i) => v === ys[i]);
    };
    const eqJson = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
    const change = (key, equal = (x, y) => x === y) =>
      equal(a[key], b[key]) ? null : { from: a[key], to: b[key] };

    const diff = {
      name:                change("name"),
      description:         change("description"),
      category:            change("category"),
      vertical_tags:       change("vertical_tags", eqArr),
      prompt_fragment:     change("prompt_fragment"),
      tool_manifest:       change("tool_manifest", eqJson),
      required_connectors: change("required_connectors", eqArr),
      io_schema:           change("io_schema", eqJson),
      manifest_hash:       change("manifest_hash"),
      status:              change("status"),
      lifecycle_status:    change("lifecycle_status"),
    };
    res.json({
      skill_id: skillId,
      from: { version: a.version, deployed_at: a.deployed_at, manifest_hash: a.manifest_hash },
      to:   { version: b.version, deployed_at: b.deployed_at, manifest_hash: b.manifest_hash },
      diff,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
