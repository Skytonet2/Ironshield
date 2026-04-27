// backend/ws/feedHub.js
//
// WebSocket hub for the AIO feed stream. One Set of clients, broadcast
// fan-out, exponential-backoff friendly client-side. Public events
// (trades, dex, newpair, etc.) flow through `broadcast()` and reach
// every subscribed client.
//
// Per-wallet private events (DMs, notifications) flow through
// `publish(wallet, event)` and reach only sockets that completed the
// HMAC-ticket auth handshake for that wallet. Day 5.5 added this path
// when /api/dm/conversations and /api/notifications polling was
// removed — the WS replacement has to be auth-gated because broadcast
// would leak per-wallet metadata across all connected clients.
//
// Shape of a FeedEvent is mirrored in src/lib/ws/wsClient.js — keep the
// two in sync.
//
// Attached to the existing Express HTTP server via `attach(server)`.

const { WebSocketServer } = require("ws");
const { nanoid } = require("nanoid");
const wsTicket = require("../services/wsTicket");
const db = require("../db/client");

const clients = new Set();
// wallet -> Set of client entries authed for that wallet. Maintained
// in lockstep with `clients`; entries appear here only after a valid
// ticket on the `auth` message.
const walletIndex = new Map();

// DM presence: emit `presence:update` events when a wallet's
// connection count crosses 0↔1. Online state is the live walletIndex;
// the offline "last seen" timestamp is persisted to feed_users on
// disconnect so peers that reload after the disconnect still get a
// meaningful "Active 5m ago" badge.
//
// We deliberately broadcast presence (not publish per-wallet). Public-ish
// signal: anyone you've DM'd with sees your online state, and the
// per-peer filter happens client-side. publish() would force the hub
// to know "who cares about wallet X" which it doesn't.
function emitPresenceOnline(wallet) {
  broadcast({ type: "presence:update", wallet, online: true });
}
async function emitPresenceOffline(wallet) {
  let lastSeenAt = new Date().toISOString();
  try {
    const r = await db.query(
      "UPDATE feed_users SET last_seen_at = NOW() WHERE LOWER(wallet_address) = $1 RETURNING last_seen_at",
      [wallet]
    );
    if (r.rows[0]?.last_seen_at) lastSeenAt = new Date(r.rows[0].last_seen_at).toISOString();
  } catch (err) {
    // DB blip — broadcast best-effort with our local timestamp. Peer
    // dashboards still update; the persisted state lags one cycle.
    console.warn("[feedHub] last_seen_at persist failed:", err.message);
  }
  broadcast({ type: "presence:update", wallet, online: false, lastSeenAt });
}

function indexAdd(wallet, entry) {
  let set = walletIndex.get(wallet);
  if (!set) { set = new Set(); walletIndex.set(wallet, set); }
  set.add(entry);
}
function indexRemove(wallet, entry) {
  const set = walletIndex.get(wallet);
  if (!set) return;
  set.delete(entry);
  if (set.size === 0) walletIndex.delete(wallet);
}

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
]);
const PROD_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ||
    "https://ironshield.pages.dev,https://ironshield.near.page"
  ).split(",").map((s) => s.trim()).filter(Boolean)
);
// Cloudflare Pages preview-alias subdomains. Same pattern + reasoning
// as backend/server.js: only CF can mint *.pages.dev subdomains, so
// the wildcard isn't an open door. Mirrors the REST CORS allowlist
// so DM presence + delivery work on previews too.
const PAGES_HOSTNAME = (process.env.CF_PAGES_HOSTNAME || "ironshield.pages.dev").trim();
const previewRe = new RegExp(`^https://[a-z0-9][a-z0-9-]*\\.${PAGES_HOSTNAME.replace(/\./g, "\\.")}$`);

function originAllowed(origin) {
  if (!origin) return true;
  return DEV_ORIGINS.has(origin) || PROD_ORIGINS.has(origin) || previewRe.test(origin);
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws/feed") return;
    const origin = req.headers.origin;
    if (!originAllowed(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const state = {
      id: nanoid(8),
      subs: new Set(),
      authedWallet: null,
    };
    const entry = { ws, state };
    clients.add(entry);

    ws.send(JSON.stringify({ type: "hello", id: state.id, ts: Date.now() }));

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== "object") return;

      switch (msg.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
          break;

        case "auth": {
          // Ticket-gated wallet binding. Old shape `{token, userId}`
          // (Phase 2 placeholder) is rejected — sockets that don't
          // present a valid ticket simply never appear in walletIndex
          // and never receive a wallet-targeted event.
          const { wallet, ticket } = msg;
          const verified = ticket ? wsTicket.verify(ticket) : null;
          if (!verified || !wallet || verified.wallet !== String(wallet).toLowerCase().trim()) {
            ws.send(JSON.stringify({ type: "authed", ok: false, error: "bad-ticket" }));
            break;
          }
          // If this socket re-auths for a different wallet, detach the
          // old binding first. If that drops the prior wallet's count
          // to zero, fire its offline event before swapping.
          if (state.authedWallet && state.authedWallet !== verified.wallet) {
            const prev = state.authedWallet;
            indexRemove(prev, entry);
            if (!walletIndex.has(prev)) emitPresenceOffline(prev);
          }
          // Detect the 0→1 crossing. If walletIndex didn't have an
          // entry for this wallet yet, this auth just brought them
          // online — emit before the index add so the broadcast
          // reflects the transition cleanly.
          const wasOffline = !walletIndex.has(verified.wallet);
          state.authedWallet = verified.wallet;
          indexAdd(verified.wallet, entry);
          if (wasOffline) emitPresenceOnline(verified.wallet);
          ws.send(JSON.stringify({ type: "authed", ok: true, wallet: verified.wallet }));
          break;
        }

        case "subscribe":
          if (Array.isArray(msg.trackers)) {
            state.subs = new Set(msg.trackers);
            ws.send(JSON.stringify({ type: "subscribed", trackers: [...state.subs] }));
          }
          break;

        default:
          break;
      }
    });

    ws.on("close", () => {
      if (state.authedWallet) {
        const w = state.authedWallet;
        indexRemove(w, entry);
        // 1→0 crossing. indexRemove deletes the wallet's set entirely
        // when the last socket leaves; check has() rather than peek
        // at set.size (the set is gone by here).
        if (!walletIndex.has(w)) emitPresenceOffline(w);
      }
      clients.delete(entry);
    });

    ws.on("error", () => { /* close handler runs */ });
  });

  return wss;
}

/**
 * Broadcast a FeedEvent to every subscribed client. Public events only
 * (no per-wallet content) — DMs and notifications must use publish().
 */
function broadcast(event) {
  if (!event || !event.type) return;
  const normalized = {
    id: event.id || nanoid(12),
    ts: event.ts || Date.now(),
    ...event,
  };
  const payload = JSON.stringify({ type: "event", event: normalized });
  for (const { ws, state } of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (state.subs.size > 0 && !state.subs.has(normalized.type)) continue;
    try { ws.send(payload); } catch { /* drop */ }
  }
}

/**
 * Publish a FeedEvent only to sockets that authenticated for `wallet`.
 * Used for `dm:new` and `notification:new` — events that would leak
 * cross-wallet metadata if broadcast.
 *
 * Subscription filters still apply: a socket that did `subscribe` to a
 * narrow tracker list must include the event's type, otherwise the
 * client would have to widen its filter just to receive private events.
 * In practice clients keep DM/notification types in their tracker set.
 */
function publish(wallet, event) {
  if (!wallet || !event || !event.type) return;
  const set = walletIndex.get(String(wallet).toLowerCase().trim());
  if (!set || set.size === 0) return;
  const normalized = {
    id: event.id || nanoid(12),
    ts: event.ts || Date.now(),
    ...event,
  };
  const payload = JSON.stringify({ type: "event", event: normalized });
  for (const { ws, state } of set) {
    if (ws.readyState !== ws.OPEN) continue;
    if (state.subs.size > 0 && !state.subs.has(normalized.type)) continue;
    try { ws.send(payload); } catch { /* drop */ }
  }
}

function stats() {
  return { clients: clients.size, wallets: walletIndex.size };
}

// True if any socket is currently authed for `wallet` and OPEN. Day 8.2
// uses this to decide whether a freshly-sent DM was actually delivered
// to the recipient's client (so the sender can flip "sent" → "delivered").
function hasAuthedSocket(wallet) {
  const set = walletIndex.get(String(wallet || "").toLowerCase().trim());
  if (!set) return false;
  for (const { ws } of set) {
    if (ws.readyState === ws.OPEN) return true;
  }
  return false;
}

module.exports = { attach, broadcast, publish, hasAuthedSocket, stats };
