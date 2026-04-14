// backend/routes/media.route.js
// Accepts a file upload from the browser and forwards it to Cloudinary.
// No SDK required — uses the unsigned REST API.
const express = require("express");
const router = express.Router();
const crypto = require("crypto");

// We use the built-in multipart parser via busboy (bundled with express 4? no —
// fallback to a tiny raw parser using `Buffer.concat` on req stream).
// For reliability, read the raw body ourselves.
const Busboy = (() => { try { return require("busboy"); } catch { return null; } })();

router.post("/upload", (req, res) => {
  const cloud  = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !apiKey || !secret) {
    return res.status(503).json({ error: "Cloudinary not configured" });
  }
  if (!Busboy) {
    return res.status(503).json({ error: "busboy module missing — run `npm i busboy`" });
  }

  const bb = Busboy({ headers: req.headers, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB
  let fileBuf = null, filename = "upload.bin", mimeType = "application/octet-stream";

  bb.on("file", (_name, stream, info) => {
    filename = info.filename || filename;
    mimeType = info.mimeType || mimeType;
    const chunks = [];
    stream.on("data", c => chunks.push(c));
    stream.on("end", () => { fileBuf = Buffer.concat(chunks); });
  });
  bb.on("close", async () => {
    if (!fileBuf) return res.status(400).json({ error: "no file" });

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = "ironfeed";
    const toSign = `folder=${folder}&timestamp=${timestamp}${secret}`;
    const signature = crypto.createHash("sha1").update(toSign).digest("hex");

    // Build multipart body for Cloudinary
    const boundary = "----ironfeed" + crypto.randomBytes(12).toString("hex");
    const nl = "\r\n";
    const parts = [];
    const add = (name, val) => {
      parts.push(Buffer.from(`--${boundary}${nl}Content-Disposition: form-data; name="${name}"${nl}${nl}${val}${nl}`));
    };
    add("api_key", apiKey);
    add("timestamp", timestamp);
    add("signature", signature);
    add("folder", folder);
    parts.push(Buffer.from(
      `--${boundary}${nl}Content-Disposition: form-data; name="file"; filename="${filename}"${nl}` +
      `Content-Type: ${mimeType}${nl}${nl}`));
    parts.push(fileBuf);
    parts.push(Buffer.from(`${nl}--${boundary}--${nl}`));
    const body = Buffer.concat(parts);

    try {
      const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/auto/upload`, {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || "cloudinary error" });
      res.json({
        url: data.secure_url,
        type: (data.resource_type === "video") ? "VIDEO" : "IMAGE",
        bytes: data.bytes,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  req.pipe(bb);
});

module.exports = router;
