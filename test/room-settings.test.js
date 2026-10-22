// Per-bot room settings (#316, ADR 060): each bot says whether it takes part in shared rooms and who may mention it
// there. Off and owner-only by default, changed by its owner alone, and the front door reads the bots let into rooms.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const put = (bot, rooms, opts = {}) => srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { rooms }, ...opts });

test('a bot is out of rooms and owner-only by default, and the features say so', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('room-settings'));
  const bot = await makeBot(srv, { name: 'Scout' });
  assert.deepEqual(bot.rooms, { allowRooms: false, whoMayMention: 'owner' });
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.rooms, { allowRooms: false, whoMayMention: 'owner' });
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test('the owner turns rooms on and picks who may mention it; a partial change keeps the rest', async () => {
  const bot = await makeBot(srv, { name: 'Talker' });
  let r = await put(bot, { allowRooms: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.rooms, { allowRooms: true, whoMayMention: 'owner' });
  r = await put(bot, { whoMayMention: 'anyone', extra: 'dropped' });
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
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.rooms, { allowRooms: false, whoMayMention: 'owner' });
  await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
});

test('only the owner changes them: the Chief is refused, a copy starts with the defaults', async () => {
  const bot = await makeBot(srv, { name: 'Guarded' });
  let r = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { rooms: { allowRooms: true } } });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /Only the owner changes a bot's room settings/);
  r = await srv.asChief('/bots', { method: 'POST', body: { name: 'Chief Made', prompt: 'x', rooms: { allowRooms: true } } });
  assert.equal(r.status, 403);
  await put(bot, { allowRooms: true, whoMayMention: 'anyone' });
  // The Chief may still change the rest, and sending the settings as they are is no change.
  r = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { description: 'kept', rooms: { allowRooms: true, whoMayMention: 'anyone' } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const copy = (await srv.api(`/bots/${bot.id}/duplicate`, { method: 'POST', body: {} })).data;
  assert.deepEqual(copy.rooms, { allowRooms: false, whoMayMention: 'owner' });
  for (const b of [bot, copy]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test('the front door reads the bots let into rooms, and nobody else does', async () => {
  const inRoom = await makeBot(srv, { name: 'Roomy', emoji: '🗣️' });
  const out = await makeBot(srv, { name: 'Homebody' });
  await put(inRoom, { allowRooms: true });
  const r = await srv.api('/room-bots', { headers: { 'x-botdot-room': '1' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.bots, [{ id: inRoom.id, name: 'Roomy', emoji: '🗣️', color: inRoom.color, rooms: { allowRooms: true, whoMayMention: 'owner' } }]);
  // A person's request (the front door strips the header from theirs) and the Chief's tools are refused.
  assert.equal((await srv.api('/room-bots')).status, 403);
  const chief = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/room-bots`, { headers: { 'X-Chief-Key': srv.chiefKey, 'x-botdot-room': '1' } });
  assert.equal(chief.status, 403);
  for (const b of [inRoom, out]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test('mayAnswerInRoom: rooms on, and the owner asks or anyone may', () => {
  const { mayAnswerInRoom } = require('../lib/room-settings');
  assert.equal(mayAnswerInRoom({ rooms: { allowRooms: false, whoMayMention: 'anyone' } }, { byOwner: true }), false);
  assert.equal(mayAnswerInRoom({}, { byOwner: true }), false, 'an old bot: out of rooms');
  assert.equal(mayAnswerInRoom({ rooms: { allowRooms: true } }, { byOwner: true }), true);
  assert.equal(mayAnswerInRoom({ rooms: { allowRooms: true } }, { byOwner: false }), false);
  assert.equal(mayAnswerInRoom({ rooms: { allowRooms: true, whoMayMention: 'anyone' } }, { byOwner: false }), true);
  assert.equal(mayAnswerInRoom(null, { byOwner: true }), false);
});
