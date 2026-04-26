// backend/routes/media.route.js
// Accepts a file upload from the browser and forwards it to a cascade of
// free, no-account, anonymous file hosts. Each upload tries them in order;
// the first success wins. 25MB per-file cap enforced by busboy.
//
// Cascade (probed 2026-04-23):
//   1. uguu.se       — JSON POST, returns files[0].url. Primary.
//                      Temporary host (files expire after a few hours);
//                      good enough for immediate sharing in the feed.
//   2. tmpfiles.org  — JSON POST, returns data.url (rewritten to /dl/).
//                      60-minute TTL. Secondary because uguu's API is
//                      simpler and uguu returns a direct CDN URL.
//   3. 0x0.st        — intermittently disabled ("AI botnet spam"). Keep
//                      as a speculative third — zero cost when it 503s,
//                      works for free when the maintainer re-opens it.
//   4. catbox.moe    — similarly paused ("storage issues"). Fourth
//                      speculative fallback.
//   5. Inline data URL — last resort for images ≤ 1.5MB, so a user
//                       never gets stuck when every external host fails.
// Hosts are tried in order with a 20s per-host timeout. First success
// wins; `host` in the response tells the caller which one served.
//
// Response shape: { url, type, bytes, host? }
const express = require("express");
const crypto  = require("crypto");
const router = express.Router();
const requireWallet = require("../middleware/requireWallet");
const db = require("../db/client");

const Busboy = (() => { try { return require("busboy"); } catch { return null; } })();
const sharp  = (() => { try { return require("sharp");  } catch { return null; } })();

// Day 5.1 hardening:
//   - 5 MB cap (was 25 MB; image hosts reject anything bigger anyway)
//   - magic-byte MIME allowlist (jpeg/png/webp only — defends against
//     mismatched extensions and policy-violating uploads)
//   - random server-side filename (never trust client name)
//   - 10/day per wallet (admins bypass)
//   - EXIF stripped on images
const MAX_BYTES   = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_FOR_MIME = {
  "image/jpeg": ".jpg",
  "image/png":  ".png",
  "image/webp": ".webp",
};
const PER_DAY_QUOTA = 10;

const INLINE_LIMIT = 1.5 * 1024 * 1024; // 1.5MB — fits a decent JPEG
const PER_HOST_TIMEOUT_MS = 20_000;

// AbortController-based fetch timeout. Node's fetch honors AbortSignal.
async function timedFetch(url, init, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Build a multipart body from a set of named fields. Each entry is
// either { name, value } for a plain field or
// { name, filename, mimeType, buffer } for a file part.
function buildMultipart(boundary, parts) {
  const nl = "\r\n";
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}${nl}`));
    if (p.buffer) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"${nl}` +
        `Content-Type: ${p.mimeType}${nl}${nl}`));
      chunks.push(p.buffer);
      chunks.push(Buffer.from(nl));
    } else {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${p.name}"${nl}${nl}${p.value}${nl}`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--${nl}`));
  return Buffer.concat(chunks);
}

async function tryHost_uguu(fileBuf, filename, mimeType) {
  const crypto = require("crypto");
  const boundary = "----ironfeed" + crypto.randomBytes(12).toString("hex");
  // uguu's upload endpoint takes the file under `files[]`, not `file`.
  const body = buildMultipart(boundary, [
    { name: "files[]", filename, mimeType, buffer: fileBuf },
  ]);
  const r = await timedFetch("https://uguu.se/upload.php", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "user-agent": "IronShield/1.0 (+https://ironshield.near.page)",
    },
    body,
  }, PER_HOST_TIMEOUT_MS);
  const j = await r.json().catch(() => null);
  const url = j?.files?.[0]?.url;
  if (!r.ok || !url) {
    throw new Error(j?.description || `uguu status ${r.status}`);
  }
  return url;
}

async function tryHost_0x0st(fileBuf, filename, mimeType) {
  const crypto = require("crypto");
  const boundary = "----ironfeed" + crypto.randomBytes(12).toString("hex");
  const body = buildMultipart(boundary, [
    { name: "file", filename, mimeType, buffer: fileBuf },
  ]);
  const r = await timedFetch("https://0x0.st", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      // 0x0.st asks for a user agent — it 403s on requests without one.
      "user-agent": "IronShield/1.0 (+https://ironshield.near.page)",
    },
    body,
  }, PER_HOST_TIMEOUT_MS);
  const text = (await r.text()).trim();
  if (!r.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(text.slice(0, 160) || `0x0.st status ${r.status}`);
  }
  return text;
}

async function tryHost_tmpfiles(fileBuf, filename, mimeType) {
  const crypto = require("crypto");
  const boundary = "----ironfeed" + crypto.randomBytes(12).toString("hex");
  const body = buildMultipart(boundary, [
    { name: "file", filename, mimeType, buffer: fileBuf },
  ]);
  const r = await timedFetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
  }, PER_HOST_TIMEOUT_MS);
  const j = await r.json().catch(() => null);
  const rawUrl = j?.data?.url;
  if (!r.ok || !rawUrl) {
    throw new Error(j?.error || `tmpfiles status ${r.status}`);
  }
  // tmpfiles returns a viewer page URL like https://tmpfiles.org/123/foo.png.
  // Rewrite to the direct-download form https://tmpfiles.org/dl/123/foo.png
  // so <img src=…> renders the actual image instead of an HTML page.
  return rawUrl.replace("tmpfiles.org/", "tmpfiles.org/dl/");
}

async function tryHost_catbox(fileBuf, filename, mimeType) {
  const crypto = require("crypto");
  const boundary = "----ironfeed" + crypto.randomBytes(12).toString("hex");
  const body = buildMultipart(boundary, [
    { name: "reqtype", value: "fileupload" },
    { name: "fileToUpload", filename, mimeType, buffer: fileBuf },
  ]);
  const r = await timedFetch("https://catbox.moe/user/api.php", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
  }, PER_HOST_TIMEOUT_MS);
  const text = (await r.text()).trim();
  if (!r.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(text.slice(0, 160) || `catbox status ${r.status}`);
  }
  return text;
}

// Per-wallet daily quota check. Admins (admin_wallets row) bypass the cap.
async function isWithinQuota(wallet) {
  const admin = await db.query("SELECT 1 FROM admin_wallets WHERE wallet = $1 LIMIT 1", [wallet]);
  if (admin.rows.length) return { ok: true, used: null, cap: null, admin: true };
  const r = await db.query(
    `SELECT COUNT(*)::int AS used FROM media_uploads
       WHERE wallet = $1 AND uploaded_at > NOW() - INTERVAL '24 hours'`,
    [wallet]
  );
  const used = r.rows[0]?.used || 0;
  return { ok: used < PER_DAY_QUOTA, used, cap: PER_DAY_QUOTA, admin: false };
}

// Verify magic bytes, then run sharp to re-encode and strip EXIF. Returns
// the cleaned buffer + the canonical mime + extension.
async function sanitizeImage(buf) {
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(buf);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    const err = new Error(`unsupported file type${detected ? `: ${detected.mime}` : ""}`);
    err.statusCode = 415;
    throw err;
  }
  if (!sharp) {
    // sharp unavailable — fall back to passthrough. The MIME is still
    // verified by magic bytes so the safety floor holds; only the EXIF
    // strip is skipped. Log so ops sees it.
    console.warn("[media] sharp not available; skipping EXIF strip");
    return { buf, mime: detected.mime, ext: EXT_FOR_MIME[detected.mime] };
  }
  const pipeline = sharp(buf, { failOn: "error" }).rotate(); // honors EXIF orientation, then drops the rest
  const cleaned = detected.mime === "image/png"
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
    : detected.mime === "image/webp"
      ? await pipeline.webp({ quality: 90 }).toBuffer()
      : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { buf: cleaned, mime: detected.mime, ext: EXT_FOR_MIME[detected.mime] };
}

router.post("/upload", requireWallet, (req, res) => {
  if (!Busboy) {
    return res.status(503).json({ error: "busboy module missing — run `npm i busboy`" });
  }

  // Busboy throws synchronously when the Content-Type header is absent
  // or not multipart, which bubbles up as a generic 500 via the Express
  // error handler. Check first so bare/curl-probed requests get a
  // useful 400 instead.
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (!ct.startsWith("multipart/form-data")) {
    return res.status(400).json({
      error: "multipart/form-data required",
      hint:  "POST a file as multipart form data (field name 'file').",
    });
  }

  let bb;
  try {
    bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES } });
  } catch (e) {
    return res.status(400).json({ error: `bad upload headers: ${e.message}` });
  }
  let fileBuf = null;
  let truncated = false;

  bb.on("file", (_name, stream, info) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("limit", () => { truncated = true; });
    stream.on("end", () => { fileBuf = Buffer.concat(chunks); });
  });

  bb.on("close", async () => {
    if (!fileBuf)   return res.status(400).json({ error: "no file" });
    if (truncated)  return res.status(413).json({ error: `file too large (${MAX_BYTES / (1024*1024)}MB max)` });

    const wallet = req.wallet;

    // Daily quota — bail before doing any sanitize/upload work.
    const quota = await isWithinQuota(wallet).catch(() => null);
    if (!quota) return res.status(503).json({ error: "quota lookup failed" });
    if (!quota.ok) {
      return res.status(429).json({
        error: "daily-upload-quota-exceeded",
        used:  quota.used,
        cap:   quota.cap,
        retryAfterSeconds: 24 * 60 * 60,
      });
    }

    // Magic-byte MIME check + EXIF strip via sharp.
    let sanitized;
    try { sanitized = await sanitizeImage(fileBuf); }
    catch (err) {
      const code = err.statusCode || 500;
      return res.status(code).json({ error: err.message || "sanitize failed" });
    }
    const cleanBuf  = sanitized.buf;
    const cleanMime = sanitized.mime;
    const cleanName = `${crypto.randomUUID()}${sanitized.ext}`;

    const hosts = [
      { name: "uguu.se",       fn: tryHost_uguu },
      { name: "tmpfiles.org",  fn: tryHost_tmpfiles },
      { name: "0x0.st",        fn: tryHost_0x0st },
      { name: "catbox.moe",    fn: tryHost_catbox },
    ];

    const attempts = [];
    for (const host of hosts) {
      try {
        const url = await host.fn(cleanBuf, cleanName, cleanMime);
        // Audit row — only after a host accepts. Failed attempts don't
        // count against the quota.
        await db.query(
          `INSERT INTO media_uploads (wallet, bytes, content_type, url, host)
             VALUES ($1, $2, $3, $4, $5)`,
          [wallet, cleanBuf.length, cleanMime, url, host.name]
        ).catch((e) => console.warn("[media] audit insert failed:", e.message));
        return res.json({ url, type: "IMAGE", bytes: cleanBuf.length, host: host.name });
      } catch (e) {
        attempts.push(`${host.name}: ${e.message?.slice(0, 80) || "failed"}`);
      }
    }

    // Inline fallback for small-enough images.
    if (cleanBuf.length <= INLINE_LIMIT) {
      const dataUrl = `data:${cleanMime};base64,${cleanBuf.toString("base64")}`;
      await db.query(
        `INSERT INTO media_uploads (wallet, bytes, content_type, url, host)
           VALUES ($1, $2, $3, $4, $5)`,
        [wallet, cleanBuf.length, cleanMime, "inline:data-url", "inline"]
      ).catch((e) => console.warn("[media] audit insert failed:", e.message));
      return res.json({
        url:    dataUrl,
        type:   "IMAGE",
        bytes:  cleanBuf.length,
        host:   "inline",
        notice: `external hosts unavailable: ${attempts.join("; ")}`,
      });
    }

    return res.status(502).json({
      error: "upload failed on every host",
      attempts,
      hint:  "try a smaller file or retry in a few minutes",
    });
  });

  req.pipe(bb);
});

module.exports = router;
