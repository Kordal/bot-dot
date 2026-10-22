// Shared rooms in the front door (ADR 060, #318): the admin's switch, rooms, invites, bots added by their owners, and
// turns given to mentioned bots through their own account's botdot server (stand-ins here, answering room-bots and
// room-turn as #315 and #316 describe them).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { waitFor } = require('./helpers');
const rooms = require('../lib/front-door/rooms');

let door;
const stands = {};
// What each stand-in account says: its bots with their room settings, and what a turn answers.
const accounts = {};
const turnsAsked = []; // { account, headers, body }

function account(name) {
  accounts[name] = { bots: [], reply: (body) => [200, { reply: `Hello from ${body.bot}` }] };
  return accounts[name];
}
const answer = (name) => (req) => {
  const a = accounts[name];
  const sent = stands[name].seen.at(-1);
  if (req.url === '/api/room-bots') {
    if (req.headers['x-botdot-room'] !== '1') return [403, { error: 'Not from the front door' }];
    return [200, { bots: a.bots }];
  }
  if (req.url === '/api/room-turn') {
    const body = JSON.parse(sent.body);
    turnsAsked.push({ account: name, headers: req.headers, body });
    return a.reply(body);
  }
  if (req.url === '/api/room-notice') return [200, { ok: true }];
  return null;
};

before(async () => {
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  account('ann');
  stands.ann = await standIn(door, 'ann', { answer: answer('ann') });
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
});

async function signUp(name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
let annB = null;
const admin = async () => (annB ||= await signUp('ann', door.firstLink));
async function owner(name) {
  const link = (await (await admin()).post('/admin/links', {})).data.url;
  account(name);
  stands[name] = await standIn(door, name, { answer: answer(name) });
  return signUp(name, { path: new URL(link).pathname });
}
const bot = (id, name, rooms = { allowRooms: true, whoMayMention: 'owner' }) => ({ id, name, emoji: '🤖', color: '#336699', rooms });

// The live events of a session, as they come: [{ event, data }].
function events(b) {
  const got = [];
  const req = http.request({ host: '127.0.0.1', port: door.port, path: '/front-door/rooms/events', headers: { Host: `localhost:${door.port}`, Cookie: b.cookie() } }, (res) => {
    let buf = '';
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = block.match(/^event: (.*)$/m);
        const data = block.match(/^data: (.*)$/m);
        if (ev && data) got.push({ event: ev[1], data: JSON.parse(data[1]) });
      }
    });
  });
  req.end();
  return { got, close: () => req.destroy() };
}
const messagesOf = async (b, id) => (await b.get(`/front-door/rooms/${id}/messages`)).data.messages;

test('rooms are off until the admin turns them on, and only the admin reaches the switch', async () => {
  const a = await admin();
  const session = await a.get('/front-door/session');
  assert.equal(session.data.account, 'ann');
  assert.equal(session.data.rooms, false);
  assert.equal((await a.get('/front-door/rooms')).status, 404);
  assert.equal((await a.post('/front-door/rooms', { name: 'x' })).status, 404);
  const bob = await owner('bob');
  assert.equal((await bob.get('/admin/rooms')).status, 404);
  assert.equal((await bob.post('/admin/rooms', { on: true })).status, 404);
  assert.deepEqual((await a.get('/admin/rooms')).data, { on: false });
  assert.equal((await a.post('/admin/rooms', { on: 'yes' })).status, 400);
  assert.deepEqual((await a.post('/admin/rooms', { on: true })).data, { on: true });
  assert.equal((await bob.get('/front-door/session')).data.rooms, true);
  assert.equal((await bob.get('/front-door/session')).data.account, 'bob');
  assert.deepEqual((await bob.get('/front-door/rooms')).data, { rooms: [], invites: [] });
  assert.equal((await door.browser().get('/front-door/rooms')).status, 401);
  assert.match((await a.get('/admin')).text, /Shared rooms/);
});

test('a room: made, an account invited by name accepts, a stranger sees nothing, and both are told live', async () => {
  const a = await admin();
  const cat = await owner('cat');
  const dan = await owner('dan');
  const catLive = events(cat);
  try {
    const made = await a.post('/front-door/rooms', { name: '  Planning\nroom ' });
    assert.equal(made.status, 201, made.text);
    const room = made.data.room;
    assert.equal(room.name, 'Planning room');
    assert.equal(room.by, 'ann');
    assert.deepEqual(room.members.map((m) => m.account), ['ann']);
    assert.equal((await a.post('/front-door/rooms', { name: ' ' })).status, 400);
    assert.equal((await a.post('/front-door/rooms', { name: 'x'.repeat(61) })).status, 400);

    assert.equal((await a.post(`/front-door/rooms/${room.id}/invite`, { account: 'nobody' })).status, 404);
    const inv = await a.post(`/front-door/rooms/${room.id}/invite`, { account: 'cat' });
    assert.equal(inv.status, 200, inv.text);
    assert.equal((await a.post(`/front-door/rooms/${room.id}/invite`, { account: 'cat' })).status, 409);
    await waitFor(() => catLive.got.some((e) => e.event === 'invite' && e.data.room.id === room.id), { what: 'the invite event' });
    assert.deepEqual((await cat.get('/front-door/rooms')).data.invites.map((i) => [i.room.id, i.by]), [[room.id, 'ann']]);
    // Invited is not a member: it reads nothing yet.
    assert.equal((await cat.get(`/front-door/rooms/${room.id}`)).status, 404);
    assert.equal((await cat.get(`/front-door/rooms/${room.id}/messages`)).status, 404);
    // A stranger: as if there were no room, also for an invitation it doesn't have.
    assert.equal((await dan.get(`/front-door/rooms/${room.id}`)).status, 404);
    assert.equal((await dan.post(`/front-door/rooms/${room.id}/accept`, {})).status, 404);
    assert.equal((await dan.post(`/front-door/rooms/${room.id}/messages`, { text: 'hi' })).status, 404);
    assert.equal((await dan.post(`/front-door/rooms/${room.id}/invite`, { account: 'dan' })).status, 404);

    const joined = await cat.post(`/front-door/rooms/${room.id}/accept`, {});
    assert.equal(joined.status, 200, joined.text);
    assert.deepEqual(joined.data.room.members.map((m) => m.account), ['ann', 'cat']);
    assert.deepEqual((await cat.get('/front-door/rooms')).data.rooms.map((r) => r.id), [room.id]);
    const said = await cat.post(`/front-door/rooms/${room.id}/messages`, { text: 'Hi all', key: 'k1' });
    assert.equal(said.status, 201, said.text);
    assert.deepEqual({ account: said.data.message.account, bot: said.data.message.bot, text: said.data.message.text, kind: said.data.message.kind }, { account: 'cat', bot: null, text: 'Hi all', kind: 'text' });
    const again = await cat.post(`/front-door/rooms/${room.id}/messages`, { text: 'Hi all', key: 'k1' });
    assert.equal(again.status, 200);
    assert.equal(again.data.message.id, said.data.message.id);
    await waitFor(() => catLive.got.some((e) => e.event === 'room_message' && e.data.message.id === said.data.message.id), { what: 'the message event' });
    const list = await messagesOf(a, room.id);
    assert.deepEqual(list.map((m) => m.kind === 'notice' ? `notice: ${m.text}` : `${m.account}: ${m.text}`), ['notice: cat joined the room.', 'cat: Hi all']);
    assert.equal((await a.post(`/front-door/rooms/${room.id}/messages`, { text: 'x'.repeat(rooms.TEXT_MAX + 1) })).status, 400);
    assert.equal((await a.post(`/front-door/rooms/${room.id}/messages`, { text: '  ' })).status, 400);

    // Only its maker deletes it; another member leaves.
    assert.equal((await cat.post(`/front-door/rooms/${room.id}/delete`, {})).status, 403);
    assert.equal((await cat.post(`/front-door/rooms/${room.id}/leave`, {})).status, 200);
    await waitFor(() => catLive.got.some((e) => e.event === 'room_gone' && e.data.id === room.id), { what: 'room_gone' });
    assert.equal((await cat.get(`/front-door/rooms/${room.id}`)).status, 404);
    assert.equal((await a.post(`/front-door/rooms/${room.id}/delete`, {})).status, 200);
    assert.equal((await a.get(`/front-door/rooms/${room.id}`)).status, 404);
  } finally { catLive.close(); }
});

test('an owner adds only their own bot that its settings let in; a mention gives it a turn through its own account', async () => {
  const a = await admin();
  const eve = await owner('eve');
  accounts.ann.bots = [bot('scout', 'Scout'), bot('shy', 'Shy', { allowRooms: false, whoMayMention: 'owner' })];
  accounts.eve.bots = [bot('helper', 'Helper Bee', { allowRooms: true, whoMayMention: 'anyone' })];
  const room = (await a.post('/front-door/rooms', { name: 'Mixed' })).data.room;
  await a.post(`/front-door/rooms/${room.id}/invite`, { account: 'eve' });
  await eve.post(`/front-door/rooms/${room.id}/accept`, {});

  assert.equal((await a.post(`/front-door/rooms/${room.id}/bots`, { bot: 'helper' })).status, 404, "eve's bot is not ann's to add");
  assert.equal((await a.post(`/front-door/rooms/${room.id}/bots`, { bot: 'shy' })).status, 403);
  const added = await a.post(`/front-door/rooms/${room.id}/bots`, { bot: 'scout' });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(added.data.room.bots, [{ account: 'ann', id: 'scout', name: 'Scout', emoji: '🤖', color: '#336699' }]);
  assert.equal((await a.post(`/front-door/rooms/${room.id}/bots`, { bot: 'scout' })).status, 409);
  assert.equal((await eve.post(`/front-door/rooms/${room.id}/bots`, { bot: 'helper' })).status, 200);
  assert.equal((await eve.post(`/front-door/rooms/${room.id}/bots/remove`, { bot: 'scout' })).status, 404, 'only its owner takes a bot out');

  // ann mentions her own bot: it answers, labelled by the front door.
  const asked = turnsAsked.length;
  const sent = await a.post(`/front-door/rooms/${room.id}/messages`, { text: 'What now, @scout? (`@HelperBee` in code names nobody)' });
  assert.equal(sent.status, 201, sent.text);
  assert.deepEqual(sent.data.message.mentions, [{ account: 'ann', bot: 'scout', name: 'Scout' }]);
  await waitFor(async () => (await messagesOf(a, room.id)).some((m) => m.bot?.id === 'scout'), { what: "Scout's reply" });
  const turn = turnsAsked.slice(asked);
  assert.equal(turn.length, 1);
  assert.equal(turn[0].account, 'ann');
  assert.equal(turn[0].headers['x-botdot-room'], '1');
  assert.equal(turn[0].headers['x-botdot-account'], 'ann');
  assert.equal(turn[0].body.bot, 'scout');
  assert.deepEqual(turn[0].body.room, { id: room.id, name: 'Mixed' });
  const last = turn[0].body.messages.at(-1);
  assert.deepEqual({ ...last, at: undefined }, { account: 'ann', name: 'ann', bot: false, text: sent.data.message.text, at: undefined });
  assert.ok(turn[0].body.messages.every((m) => !/joined|added/.test(m.text)), 'no notices in a transcript');
  const reply = (await messagesOf(a, room.id)).find((m) => m.bot?.id === 'scout');
  assert.deepEqual({ account: reply.account, bot: reply.bot, text: reply.text }, { account: 'ann', bot: { id: 'scout', name: 'Scout' }, text: 'Hello from scout' });

  // eve mentions ann's bot, which answers only ann: no turn, a notice. eve's bot answers anyone.
  const before2 = turnsAsked.length;
  await eve.post(`/front-door/rooms/${room.id}/messages`, { text: '@Scout and @HelperBee, hi' });
  await waitFor(async () => (await messagesOf(eve, room.id)).some((m) => m.bot?.id === 'helper'), { what: "Helper Bee's reply" });
  await waitFor(async () => (await messagesOf(eve, room.id)).some((m) => m.kind === 'notice' && m.text === 'Scout · ann answers only ann here.'), { what: 'the refusal notice' });
  assert.deepEqual(turnsAsked.slice(before2).map((t) => `${t.account}/${t.body.bot}`), ['eve/helper']);
  // ann mentions eve's bot, which answers anyone.
  const before3 = turnsAsked.length;
  await a.post(`/front-door/rooms/${room.id}/messages`, { text: 'thanks', mentions: [{ account: 'eve', bot: 'helper' }] });
  await waitFor(() => turnsAsked.length > before3, { what: 'the picked mention' });
  assert.equal(turnsAsked.at(-1).body.messages.at(-1).account, 'ann');

  // The account refuses on its own: its sentence is the notice.
  accounts.eve.reply = () => [403, { error: 'Helper Bee answers only its owner in this room.' }];
  await a.post(`/front-door/rooms/${room.id}/messages`, { text: '@HelperBee again' });
  await waitFor(async () => (await messagesOf(a, room.id)).some((m) => m.kind === 'notice' && m.text === 'Helper Bee answers only its owner in this room.'), { what: "the account's refusal" });
  accounts.eve.reply = () => [502, { error: 'failed' }];
  await a.post(`/front-door/rooms/${room.id}/messages`, { text: '@HelperBee once more' });
  await waitFor(async () => (await messagesOf(a, room.id)).some((m) => m.kind === 'notice' && m.text === 'Helper Bee · eve could not answer.'), { what: 'the failure notice' });

  // eve leaves: her bot goes with her.
  await eve.post(`/front-door/rooms/${room.id}/leave`, {});
  assert.deepEqual((await a.get(`/front-door/rooms/${room.id}`)).data.room.bots.map((b) => b.id), ['scout']);
});

test("bots hand on by naming each other, and stop after 12 replies without a person", async () => {
  const fay = await owner('fay');
  accounts.fay.bots = [bot('ping', 'Ping'), bot('pong', 'Pong')];
  accounts.fay.reply = (body) => [200, { reply: body.bot === 'ping' ? 'Over to you @Pong' : 'Back to you @Ping' }];
  const room = (await fay.post('/front-door/rooms', { name: 'Loop' })).data.room;
  await fay.post(`/front-door/rooms/${room.id}/bots`, { bot: 'ping' });
  await fay.post(`/front-door/rooms/${room.id}/bots`, { bot: 'pong' });
  await fay.post(`/front-door/rooms/${room.id}/messages`, { text: 'Start, @Ping' });
  await waitFor(async () => (await messagesOf(fay, room.id)).some((m) => /stopped after 12 replies/.test(m.text)), { what: 'the line to stop', timeout: 20_000 });
  const replies = (await messagesOf(fay, room.id)).filter((m) => m.bot);
  assert.equal(replies.length, 12);
  assert.deepEqual(replies[0].mentions, [{ account: 'fay', bot: 'pong', name: 'Pong' }]);
  const asking = turnsAsked.filter((t) => t.account === 'fay').at(-1).body.messages.at(-1);
  assert.equal(asking.bot, true);
  assert.equal(asking.name, 'Ping');
  // Its owner turned rooms off since: the account leaves it out of room-bots (#316), and it gets no turn.
  accounts.fay.bots = [bot('ping', 'Ping')];
  await fay.post(`/front-door/rooms/${room.id}/messages`, { text: '@Pong?' });
  await waitFor(async () => (await messagesOf(fay, room.id)).some((m) => m.text === 'Pong · fay is kept out of rooms by its owner.'), { what: 'the kept-out notice' });
});

test("a person's own x-botdot-room never reaches an account, and a deleted account leaves its rooms", async () => {
  const a = await admin();
  const gus = await owner('gus');
  const sent = await gus.get('/api/anything', { 'x-botdot-room': '1' });
  assert.equal(sent.status, 200);
  assert.equal(stands.gus.seen.at(-1).headers['x-botdot-room'], undefined);
  const room = (await a.post('/front-door/rooms', { name: 'With gus' })).data.room;
  await a.post(`/front-door/rooms/${room.id}/invite`, { account: 'gus' });
  await gus.post(`/front-door/rooms/${room.id}/accept`, {});
  assert.equal((await a.post('/admin/accounts/gus/delete', { name: 'gus' })).status, 200);
  assert.deepEqual((await a.get(`/front-door/rooms/${room.id}`)).data.room.members.map((m) => m.account), ['ann']);
});

test('turned off, every room route is 404 and the rooms are kept', async () => {
  const a = await admin();
  const room = (await a.post('/front-door/rooms', { name: 'Kept' })).data.room;
  await a.post('/admin/rooms', { on: false });
  assert.equal((await a.get('/front-door/rooms')).status, 404);
  assert.equal((await a.get('/front-door/session')).data.rooms, false);
  await a.post('/admin/rooms', { on: true });
  assert.equal((await a.get(`/front-door/rooms/${room.id}`)).data.room.name, 'Kept');
});

test('namedIn: names by the mention name, without case, outside code, each bot of that name once', () => {
  const room = { bots: [{ account: 'a', id: '1', name: 'Fleet Doctor' }, { account: 'b', id: '2', name: 'fleet doctor' }, { account: 'a', id: '3', name: 'Scout' }] };
  assert.deepEqual(rooms.namedIn(room, '@fleetdoctor and @FleetDoctor, not `@Scout`, not x@Scout').map((b) => b.id), ['1', '2']);
  assert.deepEqual(rooms.namedIn(room, '```\n@Scout\n```\n@Scout.').map((b) => b.id), ['3']);
});
