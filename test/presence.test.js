// While the web page is in use, events carry webActive, and the phone app doesn't notify.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, feed } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('events are marked only while the web page says it is in use', async () => {
  const f = await feed(srv);
  const bot = await makeBot(srv);
  const a = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'one' } });
  const quiet = await f.wait('run_finished', (d) => d.id === a.data.id);
  assert.equal(quiet.data.webActive, undefined);
  assert.equal((await srv.api('/presence', { method: 'POST' })).data.ok, true);
  const b = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'two' } });
  const marked = await f.wait('run_finished', (d) => d.id === b.data.id);
  assert.equal(marked.data.webActive, true);
  const hello = f.events.find((e) => e.type === 'hello');
  assert.ok(hello, 'the feed says hello first');
  f.close();
});
