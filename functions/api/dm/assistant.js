// Cloudflare Pages Function: /api/dm/assistant
// Serverless proxy to NEAR AI so the DM assistant works without a Node backend.
// Set the following env vars in the Cloudflare Pages project settings:
//   NEAR_AI_KEY       (secret)   — bearer key for NEAR AI
//   NEAR_AI_ENDPOINT  (plain)    — default https://cloud-api.near.ai/v1/chat/completions
//   NEAR_AI_MODEL     (plain)    — default Qwen/Qwen3-30B-A3B-Instruct-2507
// Optional fallback:
//   ANTHROPIC_API_KEY (secret)   — if set, uses Claude when NEAR AI is missing

const SYSTEM_PROMPT = `You are IronClaw Assistant — a brilliant, thoughtful AI agent operating as a personal agent inside IronFeed direct messages. You are modelled after the reasoning, helpfulness, and integrity of top-tier assistants like Claude: careful, honest, proactive, and direct.

CORE PRINCIPLES
- Think before you speak. Parse intent, context, and constraints first.
- Be genuinely useful: surface the actual answer, don't hedge endlessly.
- Be honest about uncertainty — "I'm not sure" beats confabulation.
- Respect the user's time: concise, concrete, structured.
- Be warm but never sycophantic. No filler like "Great question!".
- Never invent facts, prices, addresses, or transactions.

STYLE
- DMs are conversational — usually under ~200 words.
- Plain prose, light formatting (short lists/code blocks OK), no huge markdown headers.
- When drafting copy, give ready-to-paste output in a quoted block.
- Offer 2–4 crisp options when multiple good paths exist.

CAPABILITIES
- Draft posts, replies, DMs in the user's voice.
- Crypto/NEAR research, fact-checking, explain contracts.
- Security triage for links, addresses, contracts.
- IronFeed/IronShield product guidance (governance, staking, NewsCoin).

GROUND TRUTH
- NEAR explorer is nearblocks.io.
- Primary social source is x.com.
- IronShield = governance + staking for the IronClaw agent runtime.
- $IRONCLAW holders vote on missions and AI prompts.
- If you don't know, say so and suggest how to verify.`;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-wallet",
};

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

async function callNearAI(env, userText) {
  const endpoint = env.NEAR_AI_ENDPOINT || "https://cloud-api.near.ai/v1/chat/completions";
  const model    = env.NEAR_AI_MODEL    || "Qwen/Qwen3-30B-A3B-Instruct-2507";
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.NEAR_AI_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userText },
      ],
    }),
  });
  const raw = await r.text();
  if (!r.ok) throw new Error(`NEAR AI ${r.status}: ${raw.slice(0, 180)}`);
  let j; try { j = JSON.parse(raw); } catch { throw new Error("NEAR AI returned non-JSON"); }
  return (j.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
}

async function callClaude(env, userText) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    }),
  });
  const raw = await r.text();
  if (!r.ok) throw new Error(`Claude ${r.status}: ${raw.slice(0, 180)}`);
  let j; try { j = JSON.parse(raw); } catch { throw new Error("Claude returned non-JSON"); }
  const text = Array.isArray(j.content) ? j.content.map(c => c?.text || "").join("\n").trim() : "";
  return text;
}

export async function onRequestPost({ request, env }) {
  try {
    const wallet = request.headers.get("x-wallet") || "unknown";
    const body = await request.json().catch(() => ({}));
    const message = String(body?.message || "").trim();
    if (!message) return jsonResp({ error: "message required" }, 400);

    const userText = `Wallet: ${wallet}\n\nUser DM:\n${message}`;

    let reply = "";
    let provider = "none";
    try {
      if (env.NEAR_AI_KEY) {
        reply = await callNearAI(env, userText);
        provider = "near-ai";
      } else if (env.ANTHROPIC_API_KEY) {
        reply = await callClaude(env, userText);
        provider = "claude";
      } else {
        return jsonResp({
          reply: "The assistant isn't configured on this deployment. Ask an admin to set NEAR_AI_KEY or ANTHROPIC_API_KEY in the Cloudflare Pages environment.",
          assistant: { provider: "unconfigured" },
        });
      }
    } catch (primaryErr) {
      // Fallback to Claude if NEAR AI failed and Claude key exists
      if (provider !== "claude" && env.ANTHROPIC_API_KEY) {
        try { reply = await callClaude(env, userText); provider = "claude"; }
        catch (e) { return jsonResp({ error: `AI error: ${e.message}` }, 502); }
      } else {
        return jsonResp({ error: `AI error: ${primaryErr.message}` }, 502);
      }
    }

    return jsonResp({
      reply: reply || "I'm here — try asking again.",
      assistant: { provider, wallet },
    });
  } catch (e) {
    return jsonResp({ error: e?.message || "assistant failed" }, 500);
  }
}
