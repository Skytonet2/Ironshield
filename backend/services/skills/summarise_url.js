// backend/services/skills/summarise_url.js
//
// Fetch a URL, drop it on the connected agent, return a short
// summary. The fetch happens server-side so the agent doesn't need
// browsing tools — works against any framework adapter.

const fetch = require("node-fetch");

const MAX_BYTES = 200_000;     // ~200KB — enough for an article, bounded for safety
const PROMPT = (url, body) =>
  `You are a concise summariser. Read the content below (fetched from ${url}) and produce a 5-bullet summary. Each bullet ≤20 words. Respond with ONLY the bullets, one per line, no preamble.\n\n--- CONTENT ---\n${body.slice(0, 20_000)}`;

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  id: "summarise_url",
  manifest: {
    title:   "URL summariser",
    summary: "Fetches a URL server-side and returns a 5-bullet summary via your connected agent.",
    params: [
      { key: "url",  type: "string", required: true, hint: "Article / page URL" },
    ],
  },
  async execute({ params = {}, agent }) {
    if (!agent)        throw new Error("summarise_url requires a connected agent");
    if (!params.url)   throw new Error("url required");

    const url = String(params.url).trim();
    try { new URL(url); } catch { throw new Error("Invalid URL"); }

    const r = await fetch(url, { timeout: 8_000, redirect: "follow" });
    if (!r.ok) throw new Error(`Fetch failed: HTTP ${r.status}`);
    const ctype = r.headers.get("content-type") || "";
    const buf = await r.buffer();
    if (buf.length > MAX_BYTES) throw new Error(`Page too large (${buf.length} bytes)`);
    const text = ctype.includes("text/html")
      ? stripHtml(buf.toString("utf8"))
      : buf.toString("utf8");

    const reply = await agent({ message: PROMPT(url, text) });
    const bullets = String(reply.reply || "").split(/\n+/).map(l => l.trim()).filter(Boolean).slice(0, 5);
    return {
      url,
      bytes_fetched: buf.length,
      bullets,
      raw: reply.reply || "",
    };
  },
};
