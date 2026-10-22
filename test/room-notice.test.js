// A new message in a shared room (ADR 060): the front door tells each member's account (POST /api/room-notice), and the
// account rings its owner through the feed (`room_notice`), which the web page's push and the Android app turn into a
// notification. Only the front door may send it; the owner's own words ring nothing; a preview, never the whole text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const roomNotice = require('../lib/room-notice');
const push = require('../lib/push');
const { startServer, makeBot, feed } = require('./helpers');

const ROOM = { id: '0123456789abcdef0123456789abcdef', name: 'Garden club' };
const said = (over = {}) => ({ id: 'm1', at: '2026-10-22T13:00:00.000Z', account: 'ann', bot: null, text: 'Hello all', mentions: [], kind: 'text', ...over });
const body = (over = {}) => ({ room: ROOM, message: said(), ...over });

test('a body that is not a room notice is a 400; only what is named is kept', () => {
  const bads = [
    null, [], {}, body({ room: { id: 'a b', name: 'x' } }), body({ room: { id: 'r1', name: '' } }), body({ message: null }),
    body({ message: said({ kind: 'notice', account: null }) }), body({ message: said({ account: 'Ann!' }) }),
    body({ message: said({ text: 5 }) }), body({ message: said({ text: 'x'.repeat(4001) }) }),
    body({ message: said({ bot: { id: '', name: 'Scout' } }) }), body({ message: said({ bot: { id: 'b1', name: '' } }) }), body({ message: said({ bot: 'b1' }) }),
  ];
  for (const b of bads) assert.throws(() => roomNotice.check(b), (e) => e.status === 400, JSON.stringify(b)?.slice(0, 80));
  assert.deepEqual(roomNotice.check(body({ extra: 1, message: said({ mentions: [{ account: 'bob' }], extra: 2 }) })),
    { room: ROOM, message: { id: 'm1', at: '2026-10-22T13:00:00.000Z', account: 'ann', bot: null, text: 'Hello all' } });
});

test('who wrote, as the front door labels them, the room and a short plain preview; the owner\'s own words ring nothing', () => {
  const of = (m, own = () => null) => roomNotice.eventOf(roomNotice.check(body({ message: said(m) })), 'bob', own);
  assert.deepEqual(of({}), { roomId: ROOM.id, roomName: 'Garden club', from: { name: 'ann', account: 'ann' }, preview: 'Hello all', messageId: 'm1', sentAt: '2026-10-22T13:00:00.000Z' });
  assert.deepEqual(of({ bot: { id: 'b9', name: 'Scout' } }).from, { name: 'Scout · ann', account: 'ann', botId: 'b9' }, "another account's bot: no colour of ours");
  assert.equal(of({ account: 'bob' }), null, "the owner's own message");
  assert.deepEqual(of({ account: 'bob', bot: { id: 'c1', name: 'Coder' } }, (id) => (id === 'c1' ? { color: '#3b82f6' } : null)).from,
    { name: 'Coder · bob', account: 'bob', botId: 'c1', color: '#3b82f6' }, "the owner's own bot rings, in its colour");
  const long = of({ text: `## Plan\n\n**Tomatoes** first, then ${'beans '.repeat(60)}` }).preview;
  assert.ok(long.startsWith('Plan Tomatoes first, then beans'), long);
  assert.equal(long.length, roomNotice.PREVIEW_MAX);
  assert.ok(long.endsWith('…'));
  assert.equal(of({ text: '' }).preview, '…');
});

test('the web page rings a room message under the room\'s name, opens the room, and stays quiet while it is in use', () => {
  const f = push.follower({ rung: new Set() });
  const data = roomNotice.eventOf(roomNotice.check(body({ message: said({ bot: { id: 'b9', name: 'Scout' }, text: 'Tomatoes.' }) })), 'bob');
  assert.deepEqual(f.take({ type: 'room_notice', data }).notices,
    [{ title: 'Scout · ann in Garden club', body: 'Tomatoes.', target: `room:${ROOM.id}`, tag: `room:${ROOM.id}`, urgency: undefined }]);
  assert.deepEqual(f.take({ type: 'room_notice', data, webActive: true }).notices, []);
  assert.deepEqual(f.take({ type: 'room_notice', data: { ...data, roomId: 'a b' } }).notices, [], 'no room, no notification');
});

test('only the front door sends a room notice, and it becomes a room_notice in the feed', async () => {
  const srv = await startServer();
  const live = await feed(srv);
  try {
    const bot = await makeBot(srv, { name: 'Coder' });
    const asked = body({ message: said({ text: 'Is the soil ready?' }) });
    const owner = await srv.api('/room-notice', { method: 'POST', body: asked });
    assert.equal(owner.status, 403, 'a person without the header');
    assert.match(owner.data.error, /Only the front door/);
    assert.equal((await srv.asChief('/room-notice', { method: 'POST', body: asked, headers: { 'X-Botdot-Room': '1' } })).status, 403, "the Chief's tools can't");
    const port = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/room-notice`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Botdot-Room': '1' }, body: JSON.stringify(asked) });
    assert.equal(port.status, 403, 'nothing on the port');
    const door = (b) => srv.api('/room-notice', { method: 'POST', body: b, headers: { 'X-Botdot-Room': '1' } });
    assert.equal((await door({ room: ROOM })).status, 400);
    assert.deepEqual((await door(asked)).data, { ok: true, rung: true });
    const ev = await live.wait('room_notice');
    assert.deepEqual({ ...ev.data, at: undefined, webActive: undefined }, { roomId: ROOM.id, roomName: 'Garden club', from: { name: 'ann', account: 'ann' }, preview: 'Is the soil ready?', messageId: 'm1', sentAt: said().at, at: undefined, webActive: undefined });
    // The owner's own words ring nothing; the owner's own bot's reply rings, in its colour.
    assert.deepEqual((await door(body({ message: said({ id: 'm2', account: srv.account }) }))).data, { ok: true, rung: false });
    assert.deepEqual((await door(body({ message: said({ id: 'm3', account: srv.account, bot: { id: bot.id, name: 'Coder' } }) }))).data, { ok: true, rung: true });
    const mine = (await live.wait('room_notice', (d) => d.messageId === 'm3')).data;
    assert.equal(mine.from.name, `Coder · ${srv.account}`);
    assert.equal(mine.from.color, bot.color);
    assert.ok(!live.events.some((e) => e.type === 'room_notice' && e.data.messageId === 'm2'));
  } finally { live.close(); await srv.stop(); }
});
