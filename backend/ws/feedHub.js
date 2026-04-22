// backend/ws/feedHub.js
//
// WebSocket hub for the AIO feed stream. One Set of clients, broadcast
// fan-out, exponential-backoff friendly client-side. This is a *public*
// broadcast bus right now — Privy (Phase 2) will add per-socket JWT
// verification and turn `wallet` + `trade` events into authenticated
// topics. Today, every connected client sees every event that passes
// the client's own `subscribe` filter.
//
// Shape of a FeedEvent is mirrored in src/lib/ws/wsClient.js — keep the
// two in sync.
//
// Attached to the existing Express HTTP server via `attach(server)`.
// We *don't* create our own HTTP server; sharing avoids a second open
// port on Render's single-port allocation.

const { WebSocketServer } = require("ws");
const { nanoid } = require("nanoid");

const clients = new Set();

// Origin allowlist. Rendering the comma-separated env into a Set once
// at boot is cheaper than splitting on every connection. Dev origins
// are always allowed so `npm run dev:all` works out-of-the-box.
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

function originAllowed(origin) {
  if (!origin) return true; // server-to-server tools, curl, etc.
  return DEV_ORIGINS.has(origin) || PROD_ORIGINS.has(origin);
}

/**
 * Attach a WS server to an existing HTTP server.
 * The WS path is `/ws/feed` so the same hostname can continue serving
 * REST on everything else.
 */
function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws/feed") return; // let other upgrade handlers win
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
    // Per-socket state. `subs` is a Set<FeedEventType>; empty means
    // "pass everything" (matches the client's filter semantics).
    const state = {
      id: nanoid(8),
      subs: new Set(),
      authed: false,
      userId: null,
    };
    clients.add({ ws, state });

    ws.send(JSON.stringify({ type: "hello", id: state.id, ts: Date.now() }));

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg !== "object") return;

      switch (msg.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
          break;

        case "auth":
          // Privy JWT verification lands in Phase 2. Today we trust any
          // string, mark the socket authed, and let it through — every
          // event is still public so this is just bookkeeping.
          state.authed = !!msg.token;
          state.userId = msg.userId || null;
          ws.send(JSON.stringify({ type: "authed", ok: state.authed }));
          break;

        case "subscribe":
          // Replace the sub set rather than union — clients that want
          // to widen their filter should send the full desired list.
          if (Array.isArray(msg.trackers)) {
            state.subs = new Set(msg.trackers);
            ws.send(JSON.stringify({ type: "subscribed", trackers: [...state.subs] }));
          }
          break;

        default:
          // Unknown message types are ignored; never crash on client junk.
          break;
      }
    });

    ws.on("close", () => {
      for (const c of clients) if (c.ws === ws) { clients.delete(c); break; }
    });

    ws.on("error", () => { /* let close handler run; nothing to log here */ });
  });

  return wss;
}

/**
 * Broadcast a FeedEvent to every subscribed client. Safe to call from
 * anywhere in the backend (cron jobs, route handlers, on-chain
 * listeners). Adds `id` + `ts` if the caller didn't.
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
    try { ws.send(payload); } catch { /* drop; close handler cleans up */ }
  }
}

function stats() {
  return { clients: clients.size };
}

module.exports = { attach, broadcast, stats };
