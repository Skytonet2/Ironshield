// Shared LiveKit JWT signer for Cloudflare Pages Functions.
// LiveKit AccessTokens are plain JWTs signed HS256 with the API Secret.
// https://docs.livekit.io/home/get-started/authentication/

function b64url(bytes) {
  let s = typeof bytes === "string" ? btoa(bytes) : btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(key, data) {
  const keyBuf = new TextEncoder().encode(key);
  const dataBuf = new TextEncoder().encode(data);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, dataBuf);
  return b64url(sig);
}

/**
 * Mint a LiveKit access token.
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.apiSecret
 * @param {string} opts.identity     — stable user id (wallet)
 * @param {string} [opts.name]       — display name
 * @param {string} opts.room         — room name
 * @param {number} [opts.ttlSeconds] — default 2h
 * @param {Object} [opts.grants]     — extra video grants override
 */
export async function mintLiveKitToken({ apiKey, apiSecret, identity, name, room, ttlSeconds = 7200, grants }) {
  if (!apiKey || !apiSecret) throw new Error("LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured");
  if (!identity) throw new Error("identity required");
  if (!room) throw new Error("room required");

  const now = Math.floor(Date.now() / 1000);
  const video = {
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
    ...(grants || {}),
  };

  const header  = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: apiKey,
    sub: identity,
    name: name || identity,
    nbf: now - 5,
    iat: now,
    exp: now + ttlSeconds,
    video,
  };

  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = await hmacSha256(apiSecret, `${h}.${p}`);
  return `${h}.${p}.${sig}`;
}

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-wallet",
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}
