// backend/services/skills/http_runner.js
//
// Executor for author-hosted skills. The on-chain SkillMetadata.category
// is "http:<base_url>"; we POST to <base_url>/run with the user's
// params + a short-lived callback token the author can use to ask
// the user's framework agent for LLM judgement.
//
// Wire protocol (author endpoint contract):
//
//   POST {base_url}/run
//     {
//       "params":         <user-supplied JSON>,
//       "callback_url":   "https://<our-backend>/api/skills/http_callback/<jwt>",
//       "callback_token": "<jwt>",
//       "agent_account":  "agent2.alice.near"
//     }
//
//   Author can during the run POST back to callback_url with:
//     { "kind": "agent_message", "message": "...", "system": "..." }
//   and we return: { "reply": "..." }
//   The author's process then continues and ultimately replies to the
//   original /run with: { "ok": true, "result": <JSON> }
//
// Safety:
//   • only http(s) URLs accepted
//   • 30-second timeout per /run; agent callbacks have their own 30s
//   • payload size cap: 256KB return, 64KB per callback message
//   • callback_token is a short-lived JWT signed with our backend
//     secret; the callback route validates it before forwarding
//   • we don't load author URLs as iframes / scripts; this is purely
//     server-to-server JSON

const fetch  = require("node-fetch");
const crypto = require("crypto");

const RUN_TIMEOUT_MS         = 30_000;
const RETURN_BODY_CAP_BYTES  = 256 * 1024;
const TOKEN_TTL_SECONDS      = 60;

const SECRET = (process.env.SKILL_CALLBACK_SECRET ||
                process.env.CUSTODIAL_ENCRYPT_KEY ||
                "ironshield-skill-callback-default").slice(0, 64);

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(str.length / 4) * 4, "=");
  return Buffer.from(s, "base64");
}

/** Tiny HMAC-signed token. Encodes (owner, agent_account, framework,
 *  exp) so the callback handler can authenticate without a DB lookup
 *  per request. Not a full JWT — just the smallest thing that works. */
function mintCallbackToken({ owner, agent_account, framework, run_id }) {
  const payload = {
    owner, agent_account, framework, run_id,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig  = b64url(crypto.createHmac("sha256", SECRET).update(body).digest());
  return `${body}.${sig}`;
}

function verifyCallbackToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", SECRET).update(body).digest());
  if (sig !== expected) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString("utf8")); }
  catch { return null; }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function deriveBackendOrigin() {
  // The /run handler sends a callback_url back to the author; we need
  // an origin for our own service. PUBLIC_BACKEND_URL is preferred;
  // fallback to localhost for dev so the protocol still demos when
  // pointed at a local skill server.
  return (process.env.PUBLIC_BACKEND_URL || "http://localhost:3001").replace(/\/+$/, "");
}

async function execute({ params = {}, agent_account, owner, agent, http_url }) {
  if (!http_url) throw new Error("http_runner requires http_url");
  let url;
  try { url = new URL(http_url); }
  catch { throw new Error(`Invalid http skill URL: ${http_url}`); }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Skill URL must be http(s)");
  }

  const runId = crypto.randomBytes(8).toString("hex");
  const token = mintCallbackToken({
    owner,
    agent_account,
    framework: "auto",  // resolved at callback time from the active connection
    run_id:    runId,
  });

  const backendOrigin = deriveBackendOrigin();
  const body = JSON.stringify({
    params,
    agent_account,
    callback_url:    `${backendOrigin}/api/skills/http_callback/${token}`,
    callback_token:  token,
  });

  // The /run hop is the long one — author code is allowed to take
  // multiple agent callbacks before responding.
  const res = await fetch(`${url.toString().replace(/\/+$/, "")}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    timeout: RUN_TIMEOUT_MS,
  });

  const text = await res.text();
  if (text.length > RETURN_BODY_CAP_BYTES) {
    throw new Error(`HTTP skill returned ${text.length} bytes (cap ${RETURN_BODY_CAP_BYTES})`);
  }
  if (!res.ok) {
    throw new Error(`HTTP skill returned ${res.status}: ${text.slice(0, 200)}`);
  }

  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* tolerate plain text */ }

  return {
    skill_url: url.toString(),
    ok:        parsed?.ok !== false,
    result:    parsed?.result ?? parsed ?? text,
  };
}

module.exports = {
  execute,
  mintCallbackToken,
  verifyCallbackToken,
};
