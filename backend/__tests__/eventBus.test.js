// backend/__tests__/eventBus.test.js
// Day 12.2 — sanity tests for the in-process event bus. The bus is a
// thin EventEmitter wrapper, so these target the additions that
// matter to callers: wildcard fanout, ignoring bad inputs, and the
// returned unsubscribe function.

const test = require("node:test");
const assert = require("node:assert/strict");

const eventBus = require("../services/eventBus");

test("eventBus.emit fans out to channel listener", () => {
  const got = [];
  const off = eventBus.on("t.basic", (p) => got.push(p));
  eventBus.emit("t.basic", { a: 1 });
  off();
  assert.deepEqual(got, [{ a: 1 }]);
});

test("eventBus.emit also fans out to wildcard listener", () => {
  const got = [];
  const off = eventBus.on("*", (env) => got.push(env));
  eventBus.emit("t.wild", { x: 2 });
  off();
  assert.equal(got.length, 1);
  assert.equal(got[0].channel, "t.wild");
  assert.deepEqual(got[0].payload, { x: 2 });
});

test("eventBus.on returns an unsubscribe function", () => {
  let count = 0;
  const off = eventBus.on("t.unsub", () => count++);
  eventBus.emit("t.unsub", {});
  off();
  eventBus.emit("t.unsub", {});
  assert.equal(count, 1);
});

test("eventBus.emit ignores non-string channel", () => {
  let fired = false;
  const off = eventBus.on("*", () => { fired = true; });
  eventBus.emit(undefined, { a: 1 });
  eventBus.emit(null,      { a: 1 });
  eventBus.emit(123,       { a: 1 });
  off();
  assert.equal(fired, false);
});

test("eventBus.once fires exactly once", () => {
  let n = 0;
  eventBus.once("t.once", () => n++);
  eventBus.emit("t.once", {});
  eventBus.emit("t.once", {});
  assert.equal(n, 1);
});

test("eventBus.listenerCount tracks per-channel subs", () => {
  const offA = eventBus.on("t.count", () => {});
  const offB = eventBus.on("t.count", () => {});
  assert.equal(eventBus.listenerCount("t.count"), 2);
  offA();
  assert.equal(eventBus.listenerCount("t.count"), 1);
  offB();
  assert.equal(eventBus.listenerCount("t.count"), 0);
});
