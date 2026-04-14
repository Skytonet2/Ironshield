// backend/routes/media.route.js
// Accepts a file upload from the browser and forwards it to catbox.moe — a
// free, no-account, anonymous image/video host. No Cloudinary required.
// Fallback: if catbox fails and the file is < 512KB, returns a base64 data URL.
const express = require("express");
const router = express.Router();

const Busboy = (() => { try { return require("busboy"); } catch { return null; } })();

router.post("/upload", (req, res) => {
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

    const crypto = require("crypto");
    const boundary = "----ironfeed" + crypto.randomBytes(12).toString("hex");
    const nl = "\r\n";

    // catbox.moe multipart form: reqtype=fileupload + fileToUpload
    const parts = [];
    parts.push(Buffer.from(`--${boundary}${nl}Content-Disposition: form-data; name="reqtype"${nl}${nl}fileupload${nl}`));
    parts.push(Buffer.from(
      `--${boundary}${nl}Content-Disposition: form-data; name="fileToUpload"; filename="${filename}"${nl}` +
      `Content-Type: ${mimeType}${nl}${nl}`));
    parts.push(fileBuf);
    parts.push(Buffer.from(`${nl}--${boundary}--${nl}`));
    const body = Buffer.concat(parts);

    const type = mimeType.startsWith("video") ? "VIDEO"
               : mimeType.startsWith("image/gif") ? "GIF"
               : "IMAGE";

    try {
      const r = await fetch("https://catbox.moe/user/api.php", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
      });
      const text = (await r.text()).trim();
      if (!r.ok || !/^https?:\/\//i.test(text)) {
        throw new Error(text.slice(0, 200) || `catbox status ${r.status}`);
      }
      return res.json({ url: text, type, bytes: fileBuf.length });
    } catch (e) {
      // Fallback: inline as data URL for small images
      if (fileBuf.length <= 512 * 1024 && mimeType.startsWith("image/")) {
        return res.json({
          url: `data:${mimeType};base64,${fileBuf.toString("base64")}`,
          type, bytes: fileBuf.length, fallback: "inline",
        });
      }
      return res.status(502).json({ error: `upload failed: ${e.message}` });
    }
  });

  req.pipe(bb);
});

module.exports = router;
