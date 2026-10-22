// A shared room end to end (ADR 060): the real front door, and two accounts' real botdot servers (Claude Code stood in
// by fake-claude). An owner puts their bot in a room with another account; a mention there reaches the bot's own
// account as a talk-only room turn (#315), its room settings decide (#316), and the reply comes back into the room.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor } = require('./front-door-helpers');
const { startServer, makeBot, waitFor } = require('./helpers');

let door, ann, bob, annB, bobB;
before(async () => {
  ann = await startServer({ account: 'ann' });
  bob = await startServer({ account: 'bob' });
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  // Each account's socket folder, where the front door looks for it.
  for (const srv of [ann, bob]) fs.symlinkSync(path.dirname(srv.socket), path.join(door.sockets, srv.account));
  annB = await signUp('ann', door.firstLink);
  const link = (await annB.post('/admin/links', {})).data.url;
  bobB = await signUp('bob', { path: new URL(link).pathname });
});
after(async () => {
  await door?.stop();
  for (const srv of [ann, bob]) {
    if (!srv) continue;
    await srv.stop();
    fs.rmSync(srv.dir, { recursive: true, force: true });
  }
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
const messagesOf = async (b, id) => (await b.get(`/front-door/rooms/${id}/messages`)).data.messages;

test("a mention in a room gives another account's bot a talk-only turn in its own account, and its reply comes back", async () => {
  assert.equal((await annB.post('/admin/rooms', { on: true })).status, 200);
  const scout = await makeBot(bob, { name: 'Scout', description: 'Finds plants.' });

  // Rooms off in its settings: the front door doesn't let its owner add it.
  const room = (await annB.post('/front-door/rooms', { name: 'Garden club' })).data.room;
  await annB.post(`/front-door/rooms/${room.id}/invite`, { account: 'bob' });
  assert.equal((await bobB.post(`/front-door/rooms/${room.id}/accept`, {})).status, 200);
  assert.equal((await bobB.post(`/front-door/rooms/${room.id}/bots`, { bot: scout.id })).status, 404);

  // Its owner lets it in (in the account, through the front door as every request of theirs).
  const put = await bob.api(`/bots/${scout.id}`, { method: 'PUT', body: { rooms: { allowRooms: true } } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const added = await bobB.post(`/front-door/rooms/${room.id}/bots`, { bot: scout.id });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(added.data.room.bots.map((b) => [b.account, b.name]), [['bob', 'Scout']]);
  // ann may not mention bob's bot yet: only its owner may (the default).
  const runsBefore = bob.runs().length;
  await annB.post(`/front-door/rooms/${room.id}/messages`, { text: '@Scout what grows in shade?' });
  await waitFor(async () => (await messagesOf(annB, room.id)).some((m) => m.text === 'Scout · bob answers only bob here.'), { what: 'the refusal' });

  // bob mentions it: a turn in bob's account, with the room as its transcript.
  bob.reply('Ferns and hostas.');
  await bobB.post(`/front-door/rooms/${room.id}/messages`, { text: '@Scout ann asks what grows in shade' });
  await waitFor(async () => (await messagesOf(annB, room.id)).some((m) => m.bot?.name === 'Scout'), { what: "Scout's reply", timeout: 30_000 });
  const reply = (await messagesOf(annB, room.id)).find((m) => m.bot?.name === 'Scout');
  assert.deepEqual({ account: reply.account, bot: reply.bot, text: reply.text }, { account: 'bob', bot: { id: scout.id, name: 'Scout' }, text: 'Ferns and hostas.' });
  const turn = bob.runs().slice(runsBefore).find((r) => r.args.includes('--tools'));
  assert.ok(turn, 'Claude Code ran in bob\'s account');
  assert.equal(turn.args[turn.args.indexOf('--tools') + 1], '', 'talk-only: no tools');
  assert.match(turn.stdin, /Garden club/);
  assert.match(turn.stdin, /what grows in shade/);
  assert.equal(ann.runs().length, 0, "nothing ran in ann's account");

  // bob lets anyone mention it: now ann's mention gets a turn too.
  await bob.api(`/bots/${scout.id}`, { method: 'PUT', body: { rooms: { whoMayMention: 'anyone' } } });
  bob.reply('Also ivy.');
  await annB.post(`/front-door/rooms/${room.id}/messages`, { text: 'Anything else, @Scout?' });
  await waitFor(async () => (await messagesOf(annB, room.id)).some((m) => m.text === 'Also ivy.'), { what: "Scout's answer to ann", timeout: 30_000 });
});
