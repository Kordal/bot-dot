// The tests' clock (server.js test-tick, helpers.js srv.tick) is the tests' alone: a botdot started without
// BOT_DOT_TEST_TICK=1, as an owner's is, has no such route.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

test("srv.tick() runs the scheduler's next minutes, one after another; an owner's botdot has no such route", async () => {
  const srv = await startServer();
  const owner = await startServer({ env: { BOT_DOT_TEST_TICK: '' } });
  try {
    const first = Date.parse(await srv.tick());
    assert.equal(first % 60_000, 0, 'a whole minute');
    assert.ok(first > Date.now() && first <= Date.now() + 60_000, 'the next one');
    assert.equal(Date.parse(await srv.tick()), first + 60_000, 'a second call runs the minute after it');
    assert.notEqual((await owner.api('/test-tick', { method: 'POST' })).status, 200);
  } finally { await srv.stop(); await owner.stop(); }
});
