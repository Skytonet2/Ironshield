// POST /api/livekit/token — issues a LiveKit AccessToken for a voice room.
// Env vars required in the Cloudflare Pages project:
//   LIVEKIT_URL         e.g. wss://your-project.livekit.cloud
//   LIVEKIT_API_KEY     LiveKit API key (secret)
//   LIVEKIT_API_SECRET  LiveKit API secret (secret)
//
// Auth model: we trust the x-wallet header as identity. DB-level room
// membership checks from the Node backend are skipped here — any wallet
// with the roomId can join. Fine for public voice rooms; tighten later
// with signed challenges if you need strict membership.

import { mintLiveKitToken, json, cors } from "../../_lib/livekit.js";

export const onRequestOptions = () => new Response(null, { status: 204, headers: cors });

export async function onRequestPost({ request, env }) {
  try {
    const wallet = request.headers.get("x-wallet") || "";
    if (!wallet) return json({ error: "x-wallet header required" }, 401);
    const body = await request.json().catch(() => ({}));
    const roomId = String(body?.roomId || "").trim();
    if (!roomId) return json({ error: "roomId required" }, 400);

    const url       = env.LIVEKIT_URL || "";
    const apiKey    = env.LIVEKIT_API_KEY || "";
    const apiSecret = env.LIVEKIT_API_SECRET || "";

    const roomName = `room-${roomId}`;

    if (!apiKey || !apiSecret || !url) {
      return json({ token: null, url: null, roomName, identity: wallet, mocked: true });
    }

    const token = await mintLiveKitToken({
      apiKey, apiSecret,
      identity: wallet,
      name: wallet,
      room: roomName,
    });

    return json({ token, url, roomName, identity: wallet, mocked: false });
  } catch (e) {
    return json({ error: e?.message || "livekit token failed" }, 500);
  }
}
