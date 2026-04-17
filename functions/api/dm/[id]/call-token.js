// POST /api/dm/:id/call-token — LiveKit access token for a 1:1 DM voice call.
// Same auth + env-var model as /api/livekit/token. Room name derives from
// the conversation id so both participants end up in the same room.

import { mintLiveKitToken, json, cors } from "../../../_lib/livekit.js";

export const onRequestOptions = () => new Response(null, { status: 204, headers: cors });

export async function onRequestPost({ request, env, params }) {
  try {
    const wallet = request.headers.get("x-wallet") || "";
    if (!wallet) return json({ error: "x-wallet header required" }, 401);

    const id = String(params?.id || "").trim();
    if (!id) return json({ error: "conversation id required" }, 400);

    const url       = env.LIVEKIT_URL || "";
    const apiKey    = env.LIVEKIT_API_KEY || "";
    const apiSecret = env.LIVEKIT_API_SECRET || "";

    const roomName = `dm-${id}`;

    if (!apiKey || !apiSecret || !url) {
      return json({
        token: null, url: null, roomName,
        identity: wallet, peer: null, mocked: true,
      });
    }

    const token = await mintLiveKitToken({
      apiKey, apiSecret,
      identity: wallet,
      name: wallet,
      room: roomName,
    });

    return json({
      token, url, roomName,
      identity: wallet,
      peer: null, // CF function has no DB; DMCallPanel already falls back on missing peer
      mocked: false,
    });
  } catch (e) {
    return json({ error: e?.message || "call-token failed" }, 500);
  }
}
