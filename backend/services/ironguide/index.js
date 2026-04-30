// backend/services/ironguide/index.js
//
// IronGuide — the free, always-available concierge that interviews a
// new user and walks them to the right Kit. The flow:
//
//   1. start({channel, subject})  → creates a session + IronClaw thread,
//                                    returns the opening question.
//   2. reply({sessionId, content}) → records the user's turn, asks
//                                    IronClaw for the next question OR
//                                    a recommendation when enough signal.
//   3. recommend({sessionId})      → forces a Kit pick from the current
//                                    transcript (used by the UI when the
//                                    user clicks "I'm ready, recommend now").
//   4. confirm({sessionId, kit_slug, presets}) → marks the session
//                                    deployed and returns the deploy URL.
//
// IronClaw is the LLM here — we don't run our own runtime. The classifier
// (./classifier.js) is what actually maps the transcript onto a Kit; the
// LLM's job is to keep the conversation flowing and to surface the
// recommendation in user-friendly language.

const db = require("../../db/client");
const { classify, pickKit } = require("./classifier");

const SYSTEM_PROMPT = `You are the AZUKA Guide — the concierge that helps new users pick their first agent. Your job is to interview a new user with short, plain-language questions to figure out the right Kit for them. Ask one question at a time. Keep questions under 20 words. Avoid jargon. After 3-4 questions you should have enough to suggest a Kit.

Topics to cover (in this order):
1. What kind of business / activity they want help with.
2. Where their customers or audience are.
3. Whether they have a budget for it (free, low, mid, high).
4. Preferred language if not English.

When the user has answered enough, finish with a single line:
RECOMMEND: <one-line summary of what kind of agent they need>

Otherwise reply with just the next question, no preamble.`;

const ENOUGH_SIGNAL_FIELDS = ["vertical", "geo", "budget"]; // language is optional

function loadIronclaw() {
  try {
    return require("../ironclawClient");
  } catch (_) {
    return null;
  }
}

function transcriptText(messages) {
  return (messages || [])
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

function hasEnoughSignal(classified) {
  return ENOUGH_SIGNAL_FIELDS.every((k) => classified[k]);
}

async function listKits() {
  const { rows } = await db.query(
    `SELECT slug, title, vertical, description, hero_image_url,
            example_missions, required_connectors, bundled_skill_ids,
            preset_config_schema_json, default_pricing_json,
            curator_wallet, manifest_hash, kit_curator_bps,
            agent_owner_bps, platform_bps, status
       FROM agent_kits
      WHERE status IN ('active','beta')
      ORDER BY status DESC, updated_at DESC`,
  );
  return rows;
}

async function loadSession(id) {
  const { rows } = await db.query(
    `SELECT * FROM ironguide_sessions WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function persistSession(id, patch) {
  const fields = [];
  const params = [];
  for (const [k, v] of Object.entries(patch)) {
    params.push(v);
    fields.push(`${k} = $${params.length}`);
  }
  params.push(id);
  await db.query(
    `UPDATE ironguide_sessions
        SET ${fields.join(", ")}, updated_at = NOW()
      WHERE id = $${params.length}`,
    params,
  );
}

/**
 * Start a new IronGuide interview. `subject` carries either
 * { wallet } for the web channel or { tg_id } for Telegram.
 * Returns { session, question } where question is the opener.
 */
async function start({ channel, subject = {} }) {
  if (!["web", "tg"].includes(channel)) {
    throw new Error(`unknown channel ${channel}`);
  }
  const wallet = subject.wallet || null;
  const tgId   = subject.tg_id || null;
  const { rows } = await db.query(
    `INSERT INTO ironguide_sessions
       (channel, subject_wallet, subject_tg_id, messages_json)
     VALUES ($1, $2, $3, '[]'::jsonb)
     RETURNING *`,
    [channel, wallet, tgId],
  );
  const session = rows[0];

  // Hardcoded opener so a misconfigured IronClaw doesn't block onboarding.
  const opener = "Hey, I'm the AZUKA Guide. To find you the right agent in under a minute — what kind of work would you like an agent to help you with?";
  const messages = [{ role: "assistant", content: opener, ts: Date.now() }];
  await persistSession(session.id, { messages_json: JSON.stringify(messages) });
  return { session: { ...session, messages_json: messages }, question: opener };
}

/**
 * User sends a turn. We append it, ask IronClaw for the next move, and
 * persist the new state. If the LLM returns "RECOMMEND: ..." OR our
 * deterministic classifier already has enough signal, we run pickKit
 * and return a recommendation. Otherwise we return the next question.
 */
async function reply({ sessionId, content }) {
  const session = await loadSession(sessionId);
  if (!session) throw new Error("session not found");
  if (session.status !== "active") {
    throw new Error(`session is ${session.status}, cannot accept new turns`);
  }
  const messages = Array.isArray(session.messages_json) ? session.messages_json.slice() : [];
  messages.push({ role: "user", content: String(content || "").slice(0, 2000), ts: Date.now() });

  const transcript = transcriptText(messages);
  const classified = classify(transcript);

  // If the deterministic classifier has enough signal, jump straight
  // to a recommendation regardless of what the LLM thinks. This
  // also covers the IronClaw-unreachable path.
  if (hasEnoughSignal(classified)) {
    return finalizeRecommendation(session, messages, classified);
  }

  // Otherwise, ask IronClaw for the next question.
  const ironclaw = loadIronclaw();
  let nextQ = null;
  let threadId = session.ironclaw_thread_id || null;
  if (ironclaw) {
    try {
      const { threadId: tid, reply: r } = await ironclaw.chat({
        threadId,
        content: String(content || ""),
        systemPrompt: SYSTEM_PROMPT,
        timeoutMs: 20_000,
      });
      threadId = tid;
      nextQ = (r || "").trim();
    } catch (_) {
      nextQ = null;
    }
  }

  // If the LLM signalled it has enough, finalize even without classifier
  // hitting the gate (covers "RECOMMEND: …" output mid-conversation).
  if (nextQ && /^RECOMMEND:/i.test(nextQ)) {
    return finalizeRecommendation(session, messages, classified, nextQ.replace(/^RECOMMEND:\s*/i, ""));
  }

  // Fallback: deterministic next question if IronClaw is down or returned
  // empty. We pick the next missing classifier field.
  if (!nextQ) nextQ = fallbackQuestion(classified);

  messages.push({ role: "assistant", content: nextQ, ts: Date.now() });
  await persistSession(sessionId, {
    messages_json: JSON.stringify(messages),
    classified_json: JSON.stringify(classified),
    ironclaw_thread_id: threadId,
  });
  return {
    session: { ...session, messages_json: messages, classified_json: classified, ironclaw_thread_id: threadId },
    question: nextQ,
    classified,
    recommendation: null,
  };
}

function fallbackQuestion(classified) {
  if (!classified.vertical) {
    return "Got it. What's the main work you'd like the agent to take off your plate?";
  }
  if (!classified.geo) {
    return "And where are most of your customers — country or region is enough.";
  }
  if (!classified.budget) {
    return "What budget can you put behind it? Free, a small monthly amount, or more?";
  }
  return "Last one — what language should the agent reply in?";
}

async function finalizeRecommendation(session, messages, classified, llmSummary = null) {
  const kits = await listKits();
  const pick = pickKit(kits, classified);
  let kit = null;
  let presets = {};
  if (pick) {
    kit = pick.kit;
    presets = derivePresets(kit, classified);
  }
  const summary = llmSummary || summaryFromClassified(classified);

  const closingMsg = kit
    ? `Got it. Based on what you told me, the **${kit.title}** Kit fits best — ${kit.description.slice(0, 160)}. Tap "Deploy this Kit" to wire it up in one click.`
    : `Got it — but no existing Kit fits this profile yet. I've logged it for the AZUKA team to look at, and you'll see it appear in your inbox when one is ready. In the meantime you can browse the live Kits.`;
  messages.push({ role: "assistant", content: closingMsg, ts: Date.now() });

  if (kit) {
    await persistSession(session.id, {
      messages_json: JSON.stringify(messages),
      classified_json: JSON.stringify(classified),
      recommended_kit_id: kit.slug,
      recommended_presets_json: JSON.stringify(presets),
      status: "recommended",
    });
  } else {
    await persistSession(session.id, {
      messages_json: JSON.stringify(messages),
      classified_json: JSON.stringify(classified),
      status: "recommended",
    });
    await db.query(
      `INSERT INTO kit_requests
         (ironguide_session_id, classified_json, summary, channel, subject_wallet, subject_tg_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.id,
        JSON.stringify(classified),
        summary,
        session.channel,
        session.subject_wallet,
        session.subject_tg_id,
      ],
    );
  }

  return {
    session: {
      ...session,
      messages_json: messages,
      classified_json: classified,
      recommended_kit_id: kit ? kit.slug : null,
      recommended_presets_json: presets,
      status: "recommended",
    },
    question: closingMsg,
    classified,
    recommendation: kit
      ? { kit, presets, score: pick.score }
      : null,
  };
}

function summaryFromClassified(c) {
  const parts = [];
  if (c.vertical) parts.push(c.vertical);
  if (c.geo)      parts.push(`for ${c.geo.replace("_", " ")}`);
  if (c.budget)   parts.push(`budget=${c.budget}`);
  if (c.language) parts.push(`lang=${c.language}`);
  return parts.length ? parts.join(", ") : "uncategorized profile";
}

/**
 * Translate a classification into best-effort preset values for the Kit's
 * preset_config_schema_json. We only fill the fields the schema declares.
 */
function derivePresets(kit, classified) {
  const schema = kit?.preset_config_schema_json || {};
  const props = schema.properties || schema; // tolerate either shape
  const presets = {};
  for (const [key, def] of Object.entries(props)) {
    const lc = key.toLowerCase();
    if (classified.geo && (lc.includes("region") || lc.includes("geo") || lc.includes("country"))) {
      presets[key] = classified.geo;
    } else if (classified.language && lc.includes("lang")) {
      presets[key] = classified.language;
    } else if (def?.default !== undefined) {
      presets[key] = def.default;
    }
  }
  return presets;
}

/**
 * Force a recommendation now (user clicked "ready"). Same logic as the
 * implicit gate inside reply(), but bypasses the question loop.
 */
async function recommend({ sessionId }) {
  const session = await loadSession(sessionId);
  if (!session) throw new Error("session not found");
  const messages = Array.isArray(session.messages_json) ? session.messages_json.slice() : [];
  const classified = classify(transcriptText(messages));
  return finalizeRecommendation(session, messages, classified);
}

/**
 * Mark the session deployed (called after the deploy wizard finishes).
 */
async function confirmDeployed({ sessionId }) {
  await db.query(
    `UPDATE ironguide_sessions SET status = 'deployed', updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
  return loadSession(sessionId);
}

/**
 * Find the most-recent active or recommended session for a wallet/tg_id,
 * if any. Lets /onboard return the user to where they left off.
 */
async function findOpen({ channel, wallet, tg_id }) {
  if (channel === "web") {
    const { rows } = await db.query(
      `SELECT * FROM ironguide_sessions
        WHERE channel = 'web' AND subject_wallet = $1 AND status IN ('active','recommended')
        ORDER BY updated_at DESC LIMIT 1`,
      [wallet],
    );
    return rows[0] || null;
  }
  if (channel === "tg") {
    const { rows } = await db.query(
      `SELECT * FROM ironguide_sessions
        WHERE channel = 'tg' AND subject_tg_id = $1 AND status IN ('active','recommended')
        ORDER BY updated_at DESC LIMIT 1`,
      [tg_id],
    );
    return rows[0] || null;
  }
  return null;
}

module.exports = {
  start,
  reply,
  recommend,
  confirmDeployed,
  findOpen,
  loadSession,
  // exposed for tests / callers that need the same scoring
  classify,
  pickKit,
};
