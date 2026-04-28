// backend/__tests__/scout_tg.bus.test.js
//
// End-to-end-ish: emit a connector:tg:message on the event bus and
// verify the scout_tg skill picks it up. This is what the bot wires
// into via bot/attach.js after a TG webhook update arrives.

const test = require("node:test");
const assert = require("node:assert/strict");

const eventBus = require("../services/eventBus");
const scoutTg  = require("../services/skills/scout_tg");

test("scout_tg: receives connector:tg:message events into the buffer", async () => {
  // Start clean — earlier tests may have emitted into the shared bus.
  scoutTg._buffer.length = 0;

  eventBus.emit("connector:tg:message", {
    chat_id: 100, chat_title: "DevOps", chat_type: "supergroup",
    from_user: "Ada", from_username: "ada", text: "anyone know a good react contractor?",
    message_id: 1,
  });
  eventBus.emit("connector:tg:message", {
    chat_id: 100, chat_title: "DevOps", chat_type: "supergroup",
    from_user: "Bo", from_username: "bo", text: "looking for a Solidity audit",
    message_id: 2,
  });

  const all = await scoutTg.execute({ params: { limit: 10 } });
  assert.equal(all.source, "tg");
  assert.equal(all.degraded, undefined);
  assert.equal(all.count, 2);
  // Most-recent first.
  assert.equal(all.items[0].text, "looking for a Solidity audit");

  const filtered = await scoutTg.execute({ params: { filter: "react" } });
  assert.equal(filtered.count, 1);
  assert.match(filtered.items[0].text, /react/i);
});
