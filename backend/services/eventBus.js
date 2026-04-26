// backend/services/eventBus.js
//
// Tiny in-process pub/sub for internal events that should fire
// automations or notifications without going through an external HTTP
// hop. Day 12.2 introduced this so a governance proposal executing,
// or a DM landing, can drive an automation directly.
//
// Single web service consumes its own events. Multi-instance buses
// (Postgres LISTEN/NOTIFY, Redis pub/sub) are a v1.1 upgrade tracked
// in docs/runbook.md — swap in a backing transport without changing
// callers, the emit/on contract stays.
//
// emit(channel, payload) fanouts on the named channel and a "*"
// wildcard the automation router subscribes to. on(channel, handler)
// returns an unsubscribe function so callers can clean up.

const EventEmitter = require("events");

const bus = new EventEmitter();
// Default 10 is too low: 1 router + ~5 ad-hoc subscribers + room for
// a handful of automations to hold their own subs. 100 leaves slack
// without hiding a genuine listener leak.
bus.setMaxListeners(100);

function emit(channel, payload = {}) {
  if (!channel || typeof channel !== "string") return;
  bus.emit(channel, payload);
  bus.emit("*", { channel, payload });
}

function on(channel, handler) {
  if (!channel || typeof handler !== "function") return () => {};
  bus.on(channel, handler);
  return () => bus.off(channel, handler);
}

function once(channel, handler) {
  if (!channel || typeof handler !== "function") return () => {};
  bus.once(channel, handler);
  return () => bus.off(channel, handler);
}

function listenerCount(channel) {
  return bus.listenerCount(channel);
}

module.exports = { emit, on, once, listenerCount };
