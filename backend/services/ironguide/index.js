// backend/services/ironguide/index.js
//
// AZUKA Guide — the free, always-available concierge that interviews a
// new user and walks them to the right Kit.
//
// Flow shape (rewritten 2026-04-30 to drop the LLM-driven free-form
// interview that produced wall-of-text answers and zero structured
// options). The conversation is now a **deterministic step machine**
// (see ./steps.js) that asks ONE question at a time with clickable
// option chips. The LLM is only involved at the final step, when we
// have enough signal to score Kits and frame a recommendation in
// natural language.
//
// API:
//   start({channel, subject})   → creates a session, returns
//                                 { session, question }, where
//                                 `question` is a structured object
//                                 with id, text, options[], allow_other.
//   reply({sessionId, content}) → records the user's answer, advances
//                                 the step, returns the next question
//                                 OR a recommendation if at terminal.
//   recommend({sessionId})      → force a kit pick from current
//                                 answers (used by the UI's "I'm
//                                 ready, recommend now" CTA).
//   confirmDeployed({sessionId})→ flip status to 'deployed' after
//                                 the deploy wizard finishes.
//   findOpen({channel, …})      → resume the most recent open session.
//
// Storage shape:
//   ironguide_sessions
//     id, channel, subject_wallet, subject_tg_id, status,
//     messages_json   — chat transcript [{role, content, ts}]
//     answers_json    — typed answers keyed by step id (added in
//                       this rewrite via idempotent ALTER COLUMN)
//     current_step    — id of the step that's currently waiting on
//                       the user (added same)
//     classified_json — output of the classifier at finalize time
//     recommended_kit_id, recommended_presets_json
//     created_at, updated_at
//
// The classifier (./classifier.js) is unchanged and still runs over
// the answers at the final step to score Kits.

const db = require("../../db/client");
const { classify, pickKit } = require("./classifier");
const steps = require("./steps");

const OPENER_PREFIX = "Hey, I'm the AZUKA Guide.";

function loadIronclaw() {
  try {
    return require("../ironclawClient");
  } catch (_) {
    return null;
  }
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
 * Start a new AZUKA Guide interview. Always opens at the `country`
 * step regardless of what the user typed in `/start` — country is the
 * highest-signal field and locking it in first means classifier and
 * connector availability are already constrained by the time the user
 * picks a category.
 */
async function start({ channel, subject = {} }) {
  if (!["web", "tg"].includes(channel)) {
    throw new Error(`unknown channel ${channel}`);
  }
  const wallet = subject.wallet || null;
  const tgId   = subject.tg_id || null;

  const initialStepId = steps.INITIAL_STEP;
  const question = steps.publicQuestion(initialStepId);
  const opener = `${OPENER_PREFIX} ${question.text}`;

  const messages = [{ role: "assistant", content: opener, step: initialStepId, ts: Date.now() }];

  const { rows } = await db.query(
    `INSERT INTO ironguide_sessions
       (channel, subject_wallet, subject_tg_id,
        messages_json, current_step, answers_json)
     VALUES ($1, $2, $3, $4::jsonb, $5, '{}'::jsonb)
     RETURNING *`,
    [channel, wallet, tgId, JSON.stringify(messages), initialStepId],
  );
  const session = rows[0];

  return {
    session: { ...session, messages_json: messages, answers_json: {} },
    question,
  };
}

/**
 * User sends a turn. Validates the answer against the current step's
 * options (or accepts free text if allow_other), advances the step,
 * returns the next question. At the `recommend` terminal we hand off
 * to finalizeRecommendation.
 */
async function reply({ sessionId, content }) {
  const session = await loadSession(sessionId);
  if (!session) throw new Error("session not found");
  if (session.status !== "active") {
    throw new Error(`session is ${session.status}, cannot accept new turns`);
  }

  const currentStepId = session.current_step || steps.INITIAL_STEP;
  const canon = steps.canonicalize(currentStepId, content);
  if (!canon) {
    // Empty or invalid (strict step received an unknown value).
    // Don't advance; re-ask the same question. Surfaces gracefully
    // as a no-op so the bot/web can show "please pick one".
    return {
      session,
      question: steps.publicQuestion(currentStepId),
      error: "Please pick one of the options or type a custom answer.",
      recommendation: null,
    };
  }

  // Append the user's turn to the transcript with the human-readable
  // label (so re-rendering the chat shows "🇳🇬 Nigeria" not "ng").
  const messages = Array.isArray(session.messages_json)
    ? session.messages_json.slice()
    : [];
  messages.push({
    role: "user",
    content: canon.label,
    answer_value: canon.value,
    step: currentStepId,
    ts: Date.now(),
  });

  // Merge into typed answers — the classifier reads this map.
  const answers = { ...(session.answers_json || {}) };
  answers[currentStepId] = canon.value;

  // Resolve the next step.
  const nextStepId = steps.resolveNext(currentStepId, canon.value, answers);

  // Terminal? Hand off to recommendation.
  if (!nextStepId || nextStepId === "recommend") {
    return finalizeRecommendation({ ...session, answers_json: answers }, messages, answers);
  }

  // Append the next assistant question to the transcript.
  const nextQuestion = steps.publicQuestion(nextStepId);
  messages.push({
    role: "assistant",
    content: nextQuestion.text,
    step: nextStepId,
    ts: Date.now(),
  });

  await persistSession(sessionId, {
    messages_json: JSON.stringify(messages),
    answers_json:  JSON.stringify(answers),
    current_step:  nextStepId,
  });

  return {
    session: {
      ...session,
      messages_json: messages,
      answers_json:  answers,
      current_step:  nextStepId,
    },
    question: nextQuestion,
    recommendation: null,
  };
}

/**
 * Map the structured answers map into the classifier's expected
 * shape (vertical / geo / budget / language) and run pickKit. The
 * classifier still works on a free-text transcript too, but the
 * structured map is more reliable when present.
 */
function answersToClassified(answers) {
  const c = { vertical: null, geo: null, budget: null, language: null };

  if (answers.country)       c.geo     = answers.country;
  if (answers.budget_window) c.budget  = answers.budget_window;

  // Map category + sub-category → vertical
  const cat = answers.category;
  const item = answers.sell_item || answers.work_type;
  if (cat === "sell" && item === "car")              c.vertical = "commerce";
  else if (cat === "sell" && item === "property")    c.vertical = "realestate";
  else if (cat === "sell" && item === "service")     c.vertical = "lead_gen";
  else if (cat === "sell" && item === "product")     c.vertical = "commerce";
  else if (cat === "find_work" && item === "freelance") c.vertical = "lead_gen";
  else if (cat === "find_work" && item === "job")    c.vertical = "personal_ops";
  else if (cat === "find_work" && item === "leads")  c.vertical = "lead_gen";
  else if (cat === "watch_wallet")                   c.vertical = "security";
  else if (cat === "background_check")               c.vertical = "reputation";
  // "other" / free_describe leaves vertical null — classifier falls
  // back to the free-text path via the answers we have.

  return c;
}

async function finalizeRecommendation(session, messages, answers, llmSummary = null) {
  // Prefer the structured-answer mapping; fall back to free-text
  // classification of the transcript if a step was answered freely
  // ("other"). Both shapes feed pickKit.
  const fromAnswers = answersToClassified(answers);
  const transcript = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
  const fromText = classify(transcript);

  const classified = {
    vertical: fromAnswers.vertical || fromText.vertical || null,
    geo:      fromAnswers.geo      || fromText.geo      || null,
    budget:   fromAnswers.budget   || fromText.budget   || null,
    language: fromAnswers.language || fromText.language || null,
  };

  const kits = await listKits();
  const pick = pickKit(kits, classified);
  let kit = null;
  let presets = {};
  if (pick) {
    kit = pick.kit;
    presets = derivePresets(kit, classified);
  }
  const summary = llmSummary || summaryFromClassified(classified, answers);

  const closingMsg = kit
    ? `Got it. Based on what you told me, the **${kit.title}** Kit fits best — ${kit.description.slice(0, 160)}. Tap "Deploy this Kit" to wire it up in one click.`
    : `Got it — but no existing Kit fits this profile yet. I've logged it for the AZUKA team to look at, and you'll see it appear in your inbox when one is ready. In the meantime you can browse the live Kits.`;
  messages.push({ role: "assistant", content: closingMsg, step: "recommend", ts: Date.now() });

  if (kit) {
    await persistSession(session.id, {
      messages_json: JSON.stringify(messages),
      answers_json:  JSON.stringify(answers),
      current_step:  "recommend",
      classified_json: JSON.stringify(classified),
      recommended_kit_id: kit.slug,
      recommended_presets_json: JSON.stringify(presets),
      status: "recommended",
    });
  } else {
    await persistSession(session.id, {
      messages_json: JSON.stringify(messages),
      answers_json:  JSON.stringify(answers),
      current_step:  "recommend",
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
      answers_json:  answers,
      current_step:  "recommend",
      classified_json: classified,
      recommended_kit_id: kit ? kit.slug : null,
      recommended_presets_json: presets,
      status: "recommended",
    },
    question: null,
    classified,
    recommendation: kit
      ? { kit, presets, score: pick.score, summary: closingMsg }
      : { kit: null, summary: closingMsg },
  };
}

function summaryFromClassified(c, answers = {}) {
  const parts = [];
  if (c.vertical) parts.push(c.vertical);
  if (c.geo)      parts.push(`for ${c.geo}`);
  if (c.budget)   parts.push(`budget=${c.budget}`);
  if (answers.sell_item)   parts.push(`item=${answers.sell_item}`);
  if (answers.work_type)   parts.push(`work=${answers.work_type}`);
  return parts.length ? parts.join(", ") : "uncategorized profile";
}

/**
 * Translate a classification into best-effort preset values for the Kit's
 * preset_config_schema_json. We only fill the fields the schema declares.
 */
function derivePresets(kit, classified) {
  const schema = kit?.preset_config_schema_json || {};
  const props = schema.properties || schema;
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
  const answers = session.answers_json || {};
  return finalizeRecommendation(session, messages, answers);
}

async function confirmDeployed({ sessionId }) {
  await db.query(
    `UPDATE ironguide_sessions SET status = 'deployed', updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
  return loadSession(sessionId);
}

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
  classify,
  pickKit,
  // Re-exposed for tests + frontend hydration: lets a caller render
  // the right question for a session that was started in a prior visit.
  publicQuestion: steps.publicQuestion,
  resolveNext:    steps.resolveNext,
  canonicalize:   steps.canonicalize,
  STEPS:          steps.STEPS,
  INITIAL_STEP:   steps.INITIAL_STEP,
  // Internal helpers exposed for tests.
  answersToClassified,
};
