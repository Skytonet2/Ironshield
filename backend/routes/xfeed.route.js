// backend/routes/xfeed.route.js
// Inspired by Uxento's "watchlist feed": let users curate a list of X
// (Twitter) accounts and pull a merged timeline into IronFeed alongside
// the existing "For you" / "Squad" post feeds. A default preset of top
// Crypto-Twitter voices ships out of the box so the tab is useful even
// for anonymous visitors.
//
// We deliberately do NOT hold a Twitter API v2 key — those cost $200+/mo
// for basic access and regress if revoked. Instead we speak Nitter RSS
// (open-source X frontend, RSS per-handle) and fail soft if no instance
// is reachable. Admin configures NITTER_BASE_URL (comma-separated list
// of candidate instances) — the first one that answers wins, others
// serve as fallbacks.
//
// Endpoints:
//   GET    /api/xfeed/presets                       → default CT handles
//   GET    /api/xfeed/follows?wallet=<a>            → wallet's handle list (incl. preset if none)
//   POST   /api/xfeed/follows                       → { wallet, handle } add
//   DELETE /api/xfeed/follows                       → { wallet, handle } remove
//   GET    /api/xfeed/timeline?handles=a,b,c&limit=30  → merged tweet stream
//
// Per-handle responses are cached in-process for 3 minutes so a room full
// of clients hitting the same preset doesn't hammer the upstream Nitter.

const express = require("express");
const router  = express.Router();
const db      = require("../db/client");

/* ── Defaults ──────────────────────────────────────────────────── */

// Curated "top CT voices" preset. Handles only (no @), one per row.
// Picked for signal-to-noise across on-chain analysis, macro, and
// protocol research. Governance can rotate this via a PromptUpdate
// proposal later (we'll move it into activeMission.json when the
// governance contract ships that proposal type).
const PRESET_HANDLES = [
  "cobie",
  "0xMert_",
  "gainzy222",
  "trader1sz",
  "ansemf",
  "icebergy_",
  "zachxbt",
  "Loopifyyy",
  "AltcoinGordon",
  "jesse_pollak",
  "CryptoHayes",
  "hasufl",
  "RyanSAdams",
  "punk9059",
  "tayvano_",
];

// Comma-separated env is nicer than JSON for ops. If nothing is set,
// the timeline endpoint returns a structured "not_configured" payload
// and the UI shows a friendly stub — nothing crashes.
//
// ── Rotation playbook ─────────────────────────────────────────────
// Nitter instances are volunteer-run and die often. As of 2026-04-21
// nitter.net is the only reliably-up public instance. When it goes:
//   1. Pull the latest green list from the upstream wiki:
//        https://github.com/zedeus/nitter/wiki/Instances
//      (or the Markdown mirror: https://status.d420.de)
//   2. Test the candidate with a preset handle:
//        curl -sI <base>/cobie/rss | head -1    # expect 200
//        curl -s  <base>/cobie/rss | head -c 400
//      A healthy instance returns `<rss` in the body; a gateway returns
//      empty/HTML. Check multiple handles — some instances rate-limit
//      high-volume accounts.
//   3. Update NITTER_BASE_URL on Render to `new.instance,nitter.net`
//      (comma-separated, preferred first). The cache TTL is 3 min, so
//      the first batch of stale responses will age out quickly.
//   4. If every public instance is dead, stand up a private one: the
//      Nitter Docker image plus a Twitter guest-token pool takes ~20
//      min on a small VPS. Document the host in NITTER_BASE_URL and
//      keep it off the public wiki to preserve the token budget.
// The list order matters: `fetchWithFallback` tries them left-to-right
// and returns the first 2xx, so put the fastest responder first.
const NITTER_INSTANCES = (process.env.NITTER_BASE_URL || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const CACHE_TTL_MS = 3 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7000;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

// In-process cache: handle → { ts, items, error }
const cache = new Map();

/* ── Helpers ───────────────────────────────────────────────────── */

function normalizeHandle(raw) {
  if (!raw) return null;
  const h = String(raw).trim().replace(/^@/, "");
  return HANDLE_RE.test(h) ? h : null;
}

// Tiny RSS parser — avoids pulling xml2js just to read Nitter.
// Returns an array of { title, link, pubDate, html, guid }.
function parseRss(xml) {
  const items = [];
  const itemBlocks = xml.split(/<item[\s>]/i).slice(1);
  for (const raw of itemBlocks) {
    const block = raw.split(/<\/item>/i)[0];
    const pick = (tag) => {
      const re = new RegExp(
        `<${tag}[^>]*>([\\s\\S]*?)</${tag}>`,
        "i"
      );
      const m = block.match(re);
      if (!m) return "";
      let v = m[1].trim();
      // Strip CDATA.
      v = v.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
      return v;
    };
    items.push({
      title:   pick("title"),
      link:    pick("link"),
      pubDate: pick("pubDate"),
      html:    pick("description"),
      guid:    pick("guid"),
    });
  }
  return items;
}

// Nitter RSS concatenates a quote-tweet's original content into the same
// <description> blob as the author's own text, using a `Re @<handle>:`
// marker (optionally preceded by a fresh <p> or a double <br>). Split on
// that marker so the UI can render the quoted post as a nested card
// instead of a run-on paragraph. If no marker is found, the whole blob
// is the main body and `quoted*` are null. Replies (Nitter titles like
// `R to @x:`) are left alone — those go into `text` as-is because the
// reply target is metadata, not embedded content.
function splitQuotedTweet(html = "") {
  const markerRe = /(?:<p[^>]*>\s*|<br\s*\/?>\s*<br\s*\/?>\s*|\n\s*\n\s*)Re\s+@([A-Za-z0-9_]{1,15}):\s*/i;
  const m = html.match(markerRe);
  if (!m) return { mainHtml: html, quotedHandle: null, quotedHtml: null };
  const mainHtml = html.slice(0, m.index);
  const quotedHtml = html.slice(m.index + m[0].length);
  return { mainHtml, quotedHandle: m[1], quotedHtml };
}

// Turn the HTML description from Nitter RSS into plain text, preserving
// image URLs as a separate field so the UI can render them inline.
function extractTextAndMedia(html = "") {
  const media = [];
  const imgRe = /<img[^>]+src="([^"]+)"/gi;
  let m;
  while ((m = imgRe.exec(html))) media.push(m[1]);
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, media };
}

// Race N fetches; return the first 2xx response or throw.
async function fetchWithFallback(paths) {
  if (!NITTER_INSTANCES.length) {
    const err = new Error("NITTER_BASE_URL not configured");
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  let lastErr;
  for (const base of NITTER_INSTANCES) {
    for (const p of paths) {
      const url = `${base}${p}`;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
        // nitter.net (Caddy) serves empty bodies to clients that don't
        // look browser-ish. These headers plus Accept-Encoding: identity
        // bypass the content negotiation path that strips the RSS body.
        const res = await fetch(url, {
          signal: ctl.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; IronShield/xfeed; +https://ironshield.near.page)",
            "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "identity",
          },
        });
        clearTimeout(timer);
        if (res.ok) {
          const text = await res.text();
          return { text, instance: base };
        }
        lastErr = new Error(`${url} → ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error("All Nitter instances failed");
}

async function fetchHandleTweets(handle, limit = 10) {
  const cached = cache.get(handle);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.items.slice(0, limit);
  }
  try {
    const { text, instance } = await fetchWithFallback([`/${handle}/rss`]);
    const raw = parseRss(text).slice(0, 20);
    // Rewrite nitter.net/<h>/status/<id> → x.com/<h>/status/<id>. Keeps
    // links durable even if the upstream nitter dies tomorrow, and sends
    // clickthroughs to the canonical source instead of our mirror.
    const toXUrl = (u) => {
      if (!u) return u;
      try {
        const parsed = new URL(u);
        parsed.hostname = "x.com";
        parsed.protocol = "https:";
        parsed.hash = "";
        return parsed.toString();
      } catch { return u; }
    };
    const items = raw.map((r) => {
      const { mainHtml, quotedHandle, quotedHtml } = splitQuotedTweet(r.html);
      const { text: body, media } = extractTextAndMedia(mainHtml);
      let quoted = null;
      if (quotedHandle && quotedHtml) {
        const q = extractTextAndMedia(quotedHtml);
        if (q.text || q.media.length) {
          quoted = {
            handle: quotedHandle,
            text: q.text,
            media: q.media,
            url: `https://x.com/${quotedHandle}`,
          };
        }
      }
      return {
        id: r.guid || r.link,
        handle,
        url: toXUrl(r.link),
        text: body || r.title,
        media,
        quoted,
        createdAt: r.pubDate ? new Date(r.pubDate).toISOString() : null,
        source: "nitter",
        instance,
      };
    });
    cache.set(handle, { ts: Date.now(), items, error: null });
    return items.slice(0, limit);
  } catch (e) {
    const code = e.code || "FETCH_FAILED";
    cache.set(handle, { ts: Date.now(), items: [], error: { code, message: e.message } });
    if (code === "NOT_CONFIGURED") throw e; // propagate so caller can send 503
    return [];
  }
}

/* ── Persistence (soft — falls back to preset if DB offline) ───── */

async function ensureTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS feed_xfeed_follows (
        id SERIAL PRIMARY KEY,
        wallet TEXT NOT NULL,
        handle TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (wallet, LOWER(handle))
      );
      CREATE INDEX IF NOT EXISTS idx_xfeed_follows_wallet ON feed_xfeed_follows(wallet);
    `);
  } catch (e) {
    // DB offline — fine, route returns preset-only and silent-fails on writes.
  }
}
ensureTable();

async function readFollows(wallet) {
  if (!wallet) return [];
  try {
    const r = await db.query(
      "SELECT handle FROM feed_xfeed_follows WHERE wallet = $1 ORDER BY created_at ASC",
      [wallet]
    );
    return r.rows.map((x) => x.handle);
  } catch {
    return [];
  }
}

/* ── Routes ────────────────────────────────────────────────────── */

router.get("/presets", (_req, res) => {
  res.json({ handles: PRESET_HANDLES });
});

router.get("/follows", async (req, res) => {
  const wallet = String(req.query.wallet || "").trim().toLowerCase();
  const custom = await readFollows(wallet);
  // If the wallet hasn't customised its list yet, we seed the UI with
  // the preset so anon/newcomers see signal immediately. `custom: true`
  // means the user actively curates their own list.
  const handles = custom.length ? custom : PRESET_HANDLES;
  res.json({
    handles,
    custom: custom.length > 0,
    preset: PRESET_HANDLES,
  });
});

router.post("/follows", async (req, res) => {
  const wallet = String(req.body?.wallet || "").trim().toLowerCase();
  const handle = normalizeHandle(req.body?.handle);
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  if (!handle) return res.status(400).json({ error: "invalid X handle (1-15 chars, a-z 0-9 _)" });
  try {
    // Seed with preset on first add so the user's curated list is
    // additive, not a surprise wipe.
    const existing = await readFollows(wallet);
    if (!existing.length) {
      for (const h of PRESET_HANDLES) {
        await db.query(
          `INSERT INTO feed_xfeed_follows (wallet, handle) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
          [wallet, h]
        );
      }
    }
    await db.query(
      `INSERT INTO feed_xfeed_follows (wallet, handle) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
      [wallet, handle]
    );
    const handles = await readFollows(wallet);
    res.json({ handles, added: handle });
  } catch (e) {
    res.status(503).json({ error: "database offline", detail: e.message });
  }
});

router.delete("/follows", async (req, res) => {
  const wallet = String(req.body?.wallet || req.query.wallet || "").trim().toLowerCase();
  const handle = normalizeHandle(req.body?.handle || req.query.handle);
  if (!wallet || !handle) return res.status(400).json({ error: "wallet and handle required" });
  try {
    await db.query(
      "DELETE FROM feed_xfeed_follows WHERE wallet = $1 AND LOWER(handle) = LOWER($2)",
      [wallet, handle]
    );
    const handles = await readFollows(wallet);
    res.json({ handles, removed: handle });
  } catch (e) {
    res.status(503).json({ error: "database offline", detail: e.message });
  }
});

router.get("/timeline", async (req, res) => {
  const raw = String(req.query.handles || "").split(",").map(normalizeHandle).filter(Boolean);
  const wallet = String(req.query.wallet || "").trim().toLowerCase();
  let handles;
  if (raw.length) {
    handles = raw.slice(0, 30);
  } else if (wallet) {
    const custom = await readFollows(wallet);
    handles = custom.length ? custom : PRESET_HANDLES;
  } else {
    handles = PRESET_HANDLES;
  }
  const limit = Math.min(parseInt(req.query.limit || "30", 10) || 30, 100);
  const perHandle = Math.max(2, Math.ceil(limit / Math.max(handles.length, 1)));

  if (!NITTER_INSTANCES.length) {
    return res.json({
      tweets: [],
      handles,
      notConfigured: true,
      hint: "Set NITTER_BASE_URL in .env (comma-separated instances) to enable live tweets.",
    });
  }

  try {
    const results = await Promise.all(
      handles.map((h) => fetchHandleTweets(h, perHandle).catch(() => []))
    );
    const merged = results
      .flat()
      .filter((t) => t && t.id)
      .sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return tb - ta;
      })
      .slice(0, limit);
    res.json({ tweets: merged, handles, notConfigured: false });
  } catch (e) {
    res.status(503).json({ error: e.message, handles });
  }
});

// Single-handle convenience (handy for profile hovercards later).
router.get("/handle/:handle", async (req, res) => {
  const handle = normalizeHandle(req.params.handle);
  if (!handle) return res.status(400).json({ error: "invalid handle" });
  const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 50);
  if (!NITTER_INSTANCES.length) return res.json({ tweets: [], notConfigured: true });
  const items = await fetchHandleTweets(handle, limit);
  res.json({ handle, tweets: items });
});

module.exports = router;
