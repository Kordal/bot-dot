// Per-bot room settings (#316, ADR 060, ADR 269): every bot may be in shared rooms, always, and says who may mention it
// there. Owner-only by default, changed by its owner alone, and the front door reads the bots of the account.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const put = (bot, rooms, opts = {}) => srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { rooms }, ...opts });

test('a bot may be in rooms and is owner-only by default, and the features say so', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('room-settings'));
  assert.ok((await srv.api('/version')).data.features.includes('rooms-every-bot'), 'ADR 269: apps draw no switch for it');
  const bot = await makeBot(srv, { name: 'Scout' });
  assert.deepEqual(bot.rooms, { allowRooms: true, whoMayMention: 'owner' });
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.rooms, { allowRooms: true, whoMayMention: 'owner' });
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test('rooms cannot be turned off: a save or a PUT of allowRooms false keeps it true (ADR 269)', async () => {
  const bot = await makeBot(srv, { name: 'Kept', rooms: { allowRooms: false } });
  assert.deepEqual(bot.rooms, { allowRooms: true, whoMayMention: 'owner' });
  let r = await put(bot, { allowRooms: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.rooms, { allowRooms: true, whoMayMention: 'owner' });
  r = await put(bot, { allowRooms: false, whoMayMention: 'anyone' });
  assert.deepEqual(r.data.rooms, { allowRooms: true, whoMayMention: 'anyone' });
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.rooms, { allowRooms: true, whoMayMention: 'anyone' });
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test('the owner picks who may mention it; a partial change keeps the rest', async () => {
  const bot = await makeBot(srv, { name: 'Talker' });
  let r = await put(bot, { whoMayMention: 'anyone', extra: 'dropped' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.rooms, { allowRooms: true, whoMayMention: 'anyone' });
  // Other edits leave the room settings as they are.
  r = await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { description: 'talks' } });
  assert.deepEqual(r.data.rooms, { allowRooms: true, whoMayMention: 'anyone' });
  assert.deepEqual((await srv.api('/bots')).data.find((b) => b.id === bot.id).rooms, { allowRooms: true, whoMayMention: 'anyone' });
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test('bad room settings are refused with a sentence and change nothing', async () => {
  const bot = await makeBot(srv, { name: 'Strict' });
  for (const [rooms, words] of [
    ['yes', /rooms must be an object/],
    [[true], /rooms must be an object/],
    [{ allowRooms: 'yes' }, /allowRooms must be true or false/],
    [{ whoMayMention: 'room members' }, /whoMayMention must be "owner" or "anyone"/],
  ]) {
    const r = await put(bot, rooms);
    assert.equal(r.status, 400, JSON.stringify(rooms));
    assert.match(r.data.error, words);
  }
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.rooms, { allowRooms: true, whoMayMention: 'owner' });
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test('only the owner changes them: the Chief is refused, a copy starts with the defaults', async () => {
  const bot = await makeBot(srv, { name: 'Guarded' });
  let r = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { rooms: { whoMayMention: 'anyone' } } });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /Only the owner changes a bot's room settings/);
  r = await srv.asChief('/bots', { method: 'POST', body: { name: 'Chief Made', prompt: 'x', rooms: { whoMayMention: 'anyone' } } });
  assert.equal(r.status, 403);
  await put(bot, { whoMayMention: 'anyone' });
  // The Chief may still change the rest, and sending the settings as they are is no change.
  r = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { description: 'kept', rooms: { allowRooms: true, whoMayMention: 'anyone' } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const copy = (await srv.api(`/bots/${bot.id}/duplicate`, { method: 'POST', body: {} })).data;
  assert.deepEqual(copy.rooms, { allowRooms: true, whoMayMention: 'owner' });
  for (const b of [bot, copy]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test('the front door reads every bot of the account, and nobody else does', async () => {
  const inRoom = await makeBot(srv, { name: 'Roomy', emoji: '🗣️' });
  const out = await makeBot(srv, { name: 'Homebody' });
  await put(inRoom, { whoMayMention: 'anyone' });
  const r = await srv.api('/room-bots', { headers: { 'x-botdot-room': '1' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.bots, [
    { id: inRoom.id, name: 'Roomy', emoji: '🗣️', color: inRoom.color, rooms: { allowRooms: true, whoMayMention: 'anyone' } },
    { id: out.id, name: 'Homebody', emoji: out.emoji, color: out.color, rooms: { allowRooms: true, whoMayMention: 'owner' } },
  ]);
  // A person's request (the front door strips the header from theirs) and the Chief's tools are refused.
  assert.equal((await srv.api('/room-bots')).status, 403);
  const chief = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/room-bots`, { headers: { 'X-Chief-Key': srv.chiefKey, 'x-botdot-room': '1' } });
  assert.equal(chief.status, 403);
  for (const b of [inRoom, out]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test('mayAnswerInRoom: the owner asks or anyone may, whatever allowRooms was saved as', () => {
  const { mayAnswerInRoom } = require('../lib/room-settings');
  assert.equal(mayAnswerInRoom({ rooms: { allowRooms: false, whoMayMention: 'anyone' } }, { byOwner: true }), true, 'an old save of false: ADR 269');
  assert.equal(mayAnswerInRoom({}, { byOwner: true }), true, 'an old bot with no room settings');
  assert.equal(mayAnswerInRoom({ rooms: { allowRooms: true } }, { byOwner: true }), true);
  assert.equal(mayAnswerInRoom({ rooms: { allowRooms: true } }, { byOwner: false }), false);
  assert.equal(mayAnswerInRoom({ rooms: { allowRooms: true, whoMayMention: 'anyone' } }, { byOwner: false }), true);
  assert.equal(mayAnswerInRoom(null, { byOwner: true }), false);
});

test("the room turn follows the bot's settings: owner-only until anyone may", async () => {
  const bot = await makeBot(srv, { name: 'Gate' });
  const turn = (account) => srv.api('/room-turn', { method: 'POST', headers: { 'x-botdot-room': '1' }, body: {
    bot: bot.id, room: { id: 'r1', name: 'Room' }, messages: [{ account, name: 'Someone', bot: false, text: '@Gate hi' }],
  } });
  let r = await turn('another-account');
  assert.equal(r.status, 403);
  assert.match(r.data.error, /doesn't answer others in rooms/);
  await put(bot, { whoMayMention: 'anyone' });
  r = await turn('another-account');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});
