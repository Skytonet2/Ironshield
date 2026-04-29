// backend/services/ironclawBridge.js
//
// Off-chain relay between ironclaw.com agents and AZUKA.
//
// Why this exists:
//   The contract emits `ironclaw_linked` + stores a `source` string per
//   owner, but there is no on-chain primitive for forwarding posts,
//   tasks, or signals between the two runtimes. The bridge is the
//   off-chain counterpart that turns the `source` pointer into real
//   bidirectional traffic:
//
//   • Inbound  (ironclaw.com → AZUKA): external relay POSTs
//     webhook payloads here; we translate them into feed posts
//     attributed to the linked owner.
//
//   • Outbound (AZUKA → ironclaw.com): callers invoke
//     `outboundRelay(owner, event, payload)`; we resolve the owner's
//     source, and if it parses as an HTTP(S) URL we POST the signal
//     there with an HMAC signature header. Bare handles get logged —
//     we can't contact them without a directory lookup service.
//
// HMAC auth:
//   Every inbound request and every outbound POST carries
//   `X-Ironclaw-Signature: <hex sha256 hmac>` computed over the raw
//   JSON body using IRONCLAW_BRIDGE_SECRET. Bodies larger than 64 KB
//   are rejected — this is a signal relay, not a file upload path.
//
// No DB migrations needed: feed rows are reused. Bridge state lives
// in agent/ironclawBridgeState.json (delivery counters + seen
// webhook ids for dedupe).

require("dotenv").config();

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");

const { connect, keyStores } = require("near-api-js");
const db           = require("../db/client");
const feedHelpers  = require("./feedHelpers");

const STAKING_CONTRACT = process.env.STAKING_CONTRACT_ID   || "ironshield.near";
const NODE_URL         = process.env.NEAR_RPC_URL          || "https://rpc.mainnet.near.org";
const BRIDGE_SECRET    = process.env.IRONCLAW_BRIDGE_SECRET || "";

const STATE_FILE = path.join(__dirname, "../../agent/ironclawBridgeState.json");
const MAX_BODY   = 64 * 1024;

const SOURCE_CACHE_TTL_MS = 60_000;

// ─── State ────────────────────────────────────────────────────────
// {
//   seenWebhookIds: string[]              // rolling dedupe set
//   deliveryCount:  { inbound: n, outbound: n, failedOutbound: n }
// }
function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      seenWebhookIds: Array.isArray(raw.seenWebhookIds) ? raw.seenWebhookIds : [],
      deliveryCount:  raw.deliveryCount && typeof raw.deliveryCount === "object"
        ? { inbound: 0, outbound: 0, failedOutbound: 0, ...raw.deliveryCount }
        : { inbound: 0, outbound: 0, failedOutbound: 0 },
    };
  } catch {
    return {
      seenWebhookIds: [],
      deliveryCount:  { inbound: 0, outbound: 0, failedOutbound: 0 },
    };
  }
}
function writeState(s) {
  // Keep the dedupe set bounded — we only need enough window to catch
  // an upstream retry storm, not full history.
  if (s.seenWebhookIds.length > 500) s.seenWebhookIds = s.seenWebhookIds.slice(-500);
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ─── HMAC ────────────────────────────────────────────────────────
function signBody(bodyString) {
  if (!BRIDGE_SECRET) return "";
  return crypto.createHmac("sha256", BRIDGE_SECRET).update(bodyString).digest("hex");
}
function verifySignature(bodyString, signatureHex) {
  if (!BRIDGE_SECRET || !signatureHex) return false;
  const expected = signBody(bodyString);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(signatureHex), "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── Source resolution ───────────────────────────────────────────
const sourceCache = new Map();

async function resolveSource(owner) {
  if (!owner) return null;
  const hit = sourceCache.get(owner);
  if (hit && Date.now() - hit.ts < SOURCE_CACHE_TTL_MS) return hit.source;
  try {
    const near    = await connect({
      networkId: "mainnet",
      nodeUrl:   NODE_URL,
      keyStore:  new keyStores.InMemoryKeyStore(),
    });
    const account = await near.account("anonymous");
    const source  = await account.viewFunction({
      contractId: STAKING_CONTRACT,
      methodName: "get_ironclaw_source",
      args: { owner },
    });
    sourceCache.set(owner, { source: source || null, ts: Date.now() });
    return source || null;
  } catch (err) {
    console.warn(`[ironclawBridge] resolveSource(${owner}) failed: ${err.message}`);
    return null;
  }
}

function invalidateSource(owner) {
  sourceCache.delete(owner);
}

// ─── Outbound relay ──────────────────────────────────────────────
// Callers pass a plain payload object; the bridge signs + POSTs.
// Returns { delivered: bool, reason?: string, status?: number }.
async function outboundRelay(owner, event, payload) {
  const state = readState();
  try {
    const source = await resolveSource(owner);
    if (!source) return { delivered: false, reason: "no linked source" };
    if (!isHttpUrl(source)) {
      console.log(`[ironclawBridge] outbound skipped — bare handle "${source}" for ${owner}`);
      return { delivered: false, reason: "source is a handle, no webhook URL" };
    }
    const body = JSON.stringify({
      id:    crypto.randomUUID(),
      event,
      owner,
      ts:    Date.now(),
      payload,
    });
    const res = await fetch(source, {
      method: "POST",
      headers: {
        "Content-Type":          "application/json",
        "X-Ironclaw-Signature":  signBody(body),
        "X-Ironclaw-Source":     "ironshield-bridge",
      },
      body,
    });
    if (!res.ok) {
      state.deliveryCount.failedOutbound += 1;
      writeState(state);
      return { delivered: false, status: res.status, reason: `upstream ${res.status}` };
    }
    state.deliveryCount.outbound += 1;
    writeState(state);
    return { delivered: true, status: res.status };
  } catch (err) {
    state.deliveryCount.failedOutbound += 1;
    writeState(state);
    return { delivered: false, reason: err.message };
  }
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// ─── Inbound ingest ──────────────────────────────────────────────
// Called by the webhook route after HMAC verification. Translates the
// payload into DB state; we only support a few event types up front,
// unknowns are logged without error so the relay can evolve without
// breaking existing callers.
//
// Supported events:
//   - "post"    — mirror a post from the linked agent into feed_posts
//   - "status"  — log-only; reserved for "online/offline" signals
async function ingestInbound({ id, event, owner, payload }) {
  const state = readState();
  if (id && state.seenWebhookIds.includes(id)) {
    return { deduped: true };
  }

  let handled;
  switch (event) {
    case "post":
      handled = await ingestPost(owner, payload);
      break;
    case "status":
      console.log(`[ironclawBridge] status from ${owner}:`, payload);
      handled = { stored: false };
      break;
    default:
      console.log(`[ironclawBridge] unhandled inbound event "${event}" from ${owner}`);
      handled = { stored: false, reason: "unhandled event" };
  }

  if (id) state.seenWebhookIds.push(id);
  state.deliveryCount.inbound += 1;
  writeState(state);
  return { deduped: false, ...handled };
}

async function ingestPost(owner, payload) {
  const content = String(payload?.content || "").trim();
  if (!content) return { stored: false, reason: "empty content" };
  if (content.length > 2000) return { stored: false, reason: "content > 2000 chars" };
  try {
    const user = await feedHelpers.getOrCreateUser(owner);
    if (!user) return { stored: false, reason: "could not resolve feed user" };
    const ts   = Date.now();
    const hash = feedHelpers.postHash(content, user.id, ts);
    const { rows } = await db.query(
      `INSERT INTO feed_posts (author_id, content, media_type, post_hash, created_at)
         VALUES ($1, $2, 'NONE', $3, NOW())
         RETURNING id`,
      [user.id, content, hash],
    );
    return { stored: true, postId: rows[0]?.id };
  } catch (err) {
    console.warn(`[ironclawBridge] ingestPost(${owner}) failed: ${err.message}`);
    return { stored: false, reason: err.message };
  }
}

// ─── Health snapshot ─────────────────────────────────────────────
function healthSnapshot() {
  const s = readState();
  return {
    secretConfigured:       Boolean(BRIDGE_SECRET),
    stakingContract:        STAKING_CONTRACT,
    sourceCacheEntries:     sourceCache.size,
    seenWebhookIdsTracked:  s.seenWebhookIds.length,
    deliveryCount:          s.deliveryCount,
  };
}

module.exports = {
  resolveSource,
  invalidateSource,
  outboundRelay,
  ingestInbound,
  verifySignature,
  signBody,
  healthSnapshot,
  MAX_BODY,
};
