// A bot's own key on the keypad (#366): `hotkey` 1 to 9 (0 = none), held by one bot at a time. Giving a bot a digit
// another bot holds takes it from that one; a copy gets none; the Chief's update_bot sets it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');

let srv; let coder; let mail;
before(async () => {
  srv = await startServer();
  coder = await makeBot(srv, { name: 'Coder' });
  mail = await makeBot(srv, { name: 'Mail', hotkey: 3 });
});
after(() => srv.stop());

const hotkeys = async () => Object.fromEntries((await srv.api('/bots')).data.map((b) => [b.name, b.hotkey]));

test('the server says it keeps hotkeys', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('bot-hotkeys'));
});

test('a new bot has none, unless given one', async () => {
  assert.deepEqual(await hotkeys(), { Coder: 0, Mail: 3 });
});

test('a digit as a number or a string is kept; anything else is none', async () => {
  for (const [given, kept] of [['5', 5], [9, 9], [0, 0], [10, 0], ['x', 0], [2.5, 0], [-1, 0], [null, 0]]) {
    const r = await srv.api(`/bots/${coder.id}`, { method: 'PUT', body: { hotkey: given } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.hotkey, kept, String(given));
  }
});

test('a change that leaves the hotkey out keeps it', async () => {
  await srv.api(`/bots/${coder.id}`, { method: 'PUT', body: { hotkey: 4 } });
  await srv.api(`/bots/${coder.id}`, { method: 'PUT', body: { description: 'Writes code' } });
  assert.equal((await hotkeys()).Coder, 4);
});

test("a digit another bot holds moves: that bot has none", async () => {
  await srv.api(`/bots/${coder.id}`, { method: 'PUT', body: { hotkey: 3 } });
  assert.deepEqual(await hotkeys(), { Coder: 3, Mail: 0 });
  const news = await makeBot(srv, { name: 'News', hotkey: 3 });
  assert.deepEqual(await hotkeys(), { Coder: 0, Mail: 0, News: 3 });
  await srv.api(`/bots/${news.id}`, { method: 'DELETE' });
});

test('a copy gets no hotkey', async () => {
  await srv.api(`/bots/${mail.id}`, { method: 'PUT', body: { hotkey: 7 } });
  const r = await srv.api(`/bots/${mail.id}/duplicate`, { method: 'POST', body: {} });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.hotkey, 0);
  assert.equal((await hotkeys()).Mail, 7, 'the original keeps it');
  await srv.api(`/bots/${r.data.id}`, { method: 'DELETE' });
});

test('the Chief sets it, with no card', async () => {
  const r = await srv.asChief(`/bots/${coder.id}`, { method: 'PUT', body: { hotkey: 7 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!r.data.waiting, 'nothing waits');
  assert.deepEqual(await hotkeys(), { Coder: 7, Mail: 0 });
});
