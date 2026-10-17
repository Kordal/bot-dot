// A group is a record of its own (GRP-001, ADR 018): made from a name and two to six bots, placed in the list as
// a bot is, changed and deleted by the owner, kept across a restart, and told to every app as an event of its own.
// Its chat has the key "group:<id>" wherever a chat has a key. (What a turn in a group is: group-runs.test.js.)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, restartServer, makeBot, feed, readData } = require('./helpers');

let srv;
const bot = {};
before(async () => {
  srv = await startServer();
  for (const [key, name, group] of [['coder', 'Coder', 'Programming'], ['reviewer', 'Reviewer', 'Programming'], ['writer', 'Issue Writer', 'Programming'], ['cook', 'Cook', 'Home']]) {
    bot[key] = await makeBot(srv, { name, group });
  }
});
after(() => srv?.stop());

const make = (body) => srv.api('/group-chats', { method: 'POST', body });
const change = (id, body) => srv.api(`/group-chats/${id}`, { method: 'PUT', body });
const groups = async () => (await srv.api('/group-chats')).data;
const places = async () => Object.fromEntries((await groups()).map((g) => [g.name, [g.category, g.pinned, g.order]]));
const sameBots = async (fn) => { const was = (await srv.api('/bots')).data.map((b) => [b.id, b.group, b.pinned, b.order]); await fn(); assert.deepEqual((await srv.api('/bots')).data.map((b) => [b.id, b.group, b.pinned, b.order]), was, 'no bot moved'); };

test('features has groups', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('groups'));
});

let dev;
test('the owner makes a group from a name and two to six bots; it is last in the category of the first bot', async () => {
  const r = await make({ name: '  Dev  ', members: [bot.coder.id, bot.reviewer.id, bot.writer.id] });
  assert.equal(r.status, 201);
  dev = r.data;
  assert.deepEqual([dev.name, dev.members, dev.category, dev.pinned, dev.order], ['Dev', [bot.coder.id, bot.reviewer.id, bot.writer.id], 'Programming', 0, 1]);
  assert.match(dev.id, /^[0-9a-f]{8}$/);
  // A bot can be in several groups; the next group of that category goes after the first.
  const pair = (await make({ name: 'Pair', members: [bot.reviewer.id, bot.coder.id] })).data;
  assert.deepEqual([pair.category, pair.order], ['Programming', 2]);
  const kitchen = (await make({ name: 'Kitchen', members: [bot.cook.id, bot.coder.id] })).data;
  assert.deepEqual([kitchen.category, kitchen.order], ['Home', 1], "the first bot's category, whatever the others'");
  assert.deepEqual((await srv.api(`/group-chats/${dev.id}`)).data, dev);
  assert.deepEqual((await groups()).map((g) => g.name), ['Dev', 'Pair', 'Kitchen']);
  assert.equal((await srv.api('/group-chats/nope')).status, 404);
});

test('what is no group is refused, each with its reason, and nothing is kept', async () => {
  const before = await groups();
  const extra = [];
  for (const name of ['One', 'Two', 'Three']) extra.push(await makeBot(srv, { name }));
  const twin = await makeBot(srv, { name: 'issue  writer' }); // @IssueWriter too: a mention ignores case and spaces
  const refused = async (body, reason) => { const r = await make(body); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.data.error, reason); };
  // A group not made yet is not one to delete: the sentence ends with the rule.
  await refused({ name: 'Solo', members: [bot.coder.id] }, /^A group has at least two bots\.$/);
  await refused({ name: 'None', members: [] }, /^A group has at least two bots\.$/);
  await refused({ name: 'No list' }, /which bots/);
  await refused({ name: 'Crowd', members: [bot.coder.id, bot.reviewer.id, bot.writer.id, bot.cook.id, ...extra.map((b) => b.id)] }, /at most six bots/);
  await refused({ name: 'Ghost', members: [bot.coder.id, 'nobody00'] }, /no bot "nobody00"/);
  await refused({ name: 'Twice', members: [bot.coder.id, bot.reviewer.id, bot.coder.id] }, /Coder is in the group twice/);
  await refused({ name: 'Twins', members: [bot.writer.id, twin.id] }, /Issue Writer and issue {2}writer would both be @IssueWriter/);
  await refused({ name: '   ', members: [bot.coder.id, bot.reviewer.id] }, /Give the group a name/);
  await refused(null, /Give the group a name/);
  await refused('Dev', /Give the group a name/);
  assert.deepEqual(await groups(), before);
  // Six is a group.
  const six = await make({ name: 'Six', members: [bot.coder.id, bot.reviewer.id, bot.writer.id, bot.cook.id, extra[0].id, extra[1].id] });
  assert.equal(six.status, 201);
  assert.equal((await srv.api(`/group-chats/${six.data.id}`, { method: 'DELETE' })).status, 200);
  // Bots whose names are signs alone have no mention name: no mention can mistake one for the other.
  const signs = [await makeBot(srv, { name: '🏠' }), await makeBot(srv, { name: '🌱' })];
  const quiet = await make({ name: 'Signs', members: signs.map((b) => b.id) });
  assert.equal(quiet.status, 201);
  await srv.api(`/group-chats/${quiet.data.id}`, { method: 'DELETE' });
  for (const b of [...extra, twin, ...signs]) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
});

test('the owner renames a group, adds a member, takes one out and changes their order', async () => {
  const renamed = await change(dev.id, { name: 'Dev team' });
  assert.deepEqual([renamed.status, renamed.data.name, renamed.data.members], [200, 'Dev team', dev.members]);
  assert.ok(renamed.data.updatedAt >= dev.updatedAt);
  assert.match((await change(dev.id, { name: '' })).data.error, /Give the group a name/);
  assert.deepEqual((await change(dev.id, null)).data.name, 'Dev team', 'a body that is no object changes nothing');
  // The whole list as it is to be: one more, in another order, then one fewer.
  assert.deepEqual((await change(dev.id, { members: [bot.writer.id, bot.coder.id, bot.reviewer.id, bot.cook.id] })).data.members, [bot.writer.id, bot.coder.id, bot.reviewer.id, bot.cook.id]);
  assert.deepEqual((await change(dev.id, { members: [bot.writer.id, bot.coder.id, bot.reviewer.id] })).data.members, [bot.writer.id, bot.coder.id, bot.reviewer.id]);
  assert.match((await change(dev.id, { members: [bot.writer.id, bot.coder.id, bot.writer.id] })).data.error, /twice/);
  // A group of two keeps both.
  const pair = (await groups()).find((g) => g.name === 'Pair');
  const out = await change(pair.id, { members: [bot.reviewer.id] });
  assert.equal(out.status, 400);
  assert.equal(out.data.error, 'A group has at least two bots. Add another, or delete the group.');
  assert.deepEqual((await srv.api(`/group-chats/${pair.id}`)).data.members, [bot.reviewer.id, bot.coder.id]);
  assert.equal((await change('nope', { name: 'x' })).status, 404);
  await change(dev.id, { name: 'Dev', members: dev.members });
});

test('a group is moved as a bot is: category, order, pinned, among the groups, and no bot moves with it', async () => {
  await sameBots(async () => {
    assert.deepEqual(await places(), { Dev: ['Programming', 0, 1], Pair: ['Programming', 0, 2], Kitchen: ['Home', 0, 1] });
    const g = Object.fromEntries((await groups()).map((x) => [x.name, x.id]));
    // A place in its category: the others make room.
    await change(g.Pair, { order: 1 });
    assert.deepEqual(await places(), { Dev: ['Programming', 0, 2], Pair: ['Programming', 0, 1], Kitchen: ['Home', 0, 1] });
    // To another category: last there without a place, and the one it left closes the gap.
    await change(g.Pair, { category: ' Home ' });
    assert.deepEqual(await places(), { Dev: ['Programming', 0, 1], Pair: ['Home', 0, 2], Kitchen: ['Home', 0, 1] });
    await change(g.Dev, { category: 'Home', order: 1 });
    assert.deepEqual(await places(), { Dev: ['Home', 0, 1], Pair: ['Home', 0, 3], Kitchen: ['Home', 0, 2] });
    // Pinned: out of its category's order, in the order of the pinned groups.
    await change(g.Kitchen, { pinned: true });
    await change(g.Pair, { pinned: 1 });
    assert.deepEqual(await places(), { Dev: ['Home', 0, 1], Pair: ['Home', 1, 0], Kitchen: ['Home', 2, 0] });
    await change(g.Kitchen, { pinned: true });
    assert.deepEqual((await places()).Kitchen, ['Home', 2, 0], 'pinned already: it stays where it is');
    // Unpinned: last in its category again.
    await change(g.Pair, { pinned: 0 });
    assert.deepEqual(await places(), { Dev: ['Home', 0, 1], Pair: ['Home', 0, 2], Kitchen: ['Home', 1, 0] });
    await change(g.Kitchen, { pinned: 0, order: 1 });
    await change(g.Dev, { category: 'Programming' });
    await change(g.Pair, { category: 'Programming' });
    assert.deepEqual(await places(), { Dev: ['Programming', 0, 1], Pair: ['Programming', 0, 2], Kitchen: ['Home', 0, 1] });
  });
});

test('a renamed category takes its groups with it', async () => {
  assert.equal((await srv.api('/groups/rename', { method: 'POST', body: { from: 'Programming', to: 'Code' } })).data.moved, 3);
  assert.deepEqual(await places(), { Dev: ['Code', 0, 1], Pair: ['Code', 0, 2], Kitchen: ['Home', 0, 1] });
  assert.deepEqual((await srv.api('/bots')).data.filter((b) => b.group === 'Code').length, 3);
  await srv.api('/groups/rename', { method: 'POST', body: { from: 'Code', to: 'Programming' } });
  assert.deepEqual(await places(), { Dev: ['Programming', 0, 1], Pair: ['Programming', 0, 2], Kitchen: ['Home', 0, 1] });
});

test("the Chief's tools delete no group, and make none outside a turn the owner started", async () => {
  // What the Chief may do with a group, and when: chief-groups.test.js (GRP-007).
  assert.equal((await srv.asChief('/group-chats', { method: 'POST', body: { name: 'By the Chief', members: [bot.coder.id, bot.cook.id] } })).status, 403);
  assert.equal((await srv.asChief(`/group-chats/${dev.id}`, { method: 'PUT', body: { name: 'By the Chief' } })).status, 403);
  assert.equal((await srv.asChief(`/group-chats/${dev.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await groups()).length, 3);
  assert.equal((await groups()).find((g) => g.id === dev.id).name, 'Dev');
});

test('group:<id> is a chat: its read position, the presence of an app', async () => {
  const chat = `group:${dev.id}`;
  const live = feed(srv);
  try {
    await live.wait('hello');
    const read = await srv.api('/read', { method: 'POST', body: { chat, app: 'phone-1' } });
    assert.deepEqual([read.status, read.data.chat], [200, chat]);
    assert.ok(read.data.readAt);
    assert.equal(readData(srv.data, 'read-positions.json').chats[chat], read.data.readAt, 'kept on disk under its key');
    assert.equal((await srv.api('/read', { method: 'POST', body: { chat: 'group:nope', app: 'phone-1' } })).status, 400, 'a group that does not exist is no chat');
    // The same report again is no news; the app says when it shows the chat no longer.
    assert.equal((await srv.api('/read', { method: 'POST', body: { chat, app: 'phone-1' } })).data.readAt, read.data.readAt);
    assert.deepEqual((await srv.api('/read', { method: 'POST', body: { chat: null, app: 'phone-1' } })).data.chat, null);
    // `chat_seen` is for apps from before read positions, which know no group: none is sent for one, by either
    // route. A bot's chat sends it as before.
    await srv.api('/presence', { method: 'POST', body: { chat } });
    await srv.api('/read', { method: 'POST', body: { chat: `bot:${bot.cook.id}`, app: 'phone-1' } });
    await live.wait('chat_seen', (d) => d.chat === `bot:${bot.cook.id}`);
    assert.deepEqual(live.events.filter((e) => e.type === 'chat_seen').map((e) => e.data.chat), [`bot:${bot.cook.id}`]);
    await srv.api('/read', { method: 'POST', body: { chat: null, app: 'phone-1' } });
  } finally { live.close(); }
});

test('a message key is kept for a group apart from a bot with the same id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-keys-'));
  try {
    const keys = require('../lib/message-keys').create(dir);
    keys.take('group:abc12345', 'key-12345678', { messageId: 'm1' });
    assert.equal(keys.taken('group:abc12345', 'key-12345678').messageId, 'm1');
    assert.equal(keys.taken('bot:abc12345', 'key-12345678'), null);
    assert.equal(require('../lib/message-keys').create(dir).taken('group:abc12345', 'key-12345678').messageId, 'm1', 'across a restart');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a change to a group is an event of its own, and nothing an app from before acts on', async () => {
  const live = feed(srv);
  try {
    await live.wait('hello');
    const from = live.events.length;
    const made = (await make({ name: 'Temp', members: [bot.coder.id, bot.cook.id] })).data;
    await live.wait('groups');
    await change(made.id, { name: 'Temp 2' });
    await change(made.id, { pinned: true });
    await srv.api(`/group-chats/${made.id}`, { method: 'DELETE' });
    await new Promise((r) => setTimeout(r, 150));
    const types = live.events.slice(from).map((e) => e.type).filter((t) => t !== 'claude'); // the sign-in check, in its own time
    assert.deepEqual(types, ['groups', 'groups', 'groups', 'groups'], 'one event per change, and no other');
    // What a refusal changes: nothing.
    await make({ name: 'Solo', members: [bot.coder.id] });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(live.events.slice(from).filter((e) => e.type !== 'claude').length, 4);
  } finally { live.close(); }
});

test('the groups survive a restart', async () => {
  const was = await groups();
  await srv.api('/read', { method: 'POST', body: { chat: `group:${dev.id}`, app: 'phone-1' } });
  const readAt = readData(srv.data, 'read-positions.json').chats[`group:${dev.id}`];
  srv = await restartServer(srv);
  assert.deepEqual(await groups(), was);
  assert.equal(readData(srv.data, 'read-positions.json').chats[`group:${dev.id}`], readAt);
});

test('deleting a group deletes no bot; its read position and its messages go with it', async () => {
  const temp = (await make({ name: 'Temp', members: [bot.coder.id, bot.cook.id] })).data;
  await srv.api('/read', { method: 'POST', body: { chat: `group:${temp.id}`, app: 'phone-1' } });
  const messages = path.join(srv.data, 'group-messages', `${temp.id}.json`);
  fs.mkdirSync(path.dirname(messages), { recursive: true });
  fs.writeFileSync(messages, '[]');
  const bots = (await srv.api('/bots')).data.map((b) => b.id);
  const gone = await srv.api(`/group-chats/${temp.id}`, { method: 'DELETE' });
  assert.deepEqual([gone.status, gone.data], [200, { ok: true, name: 'Temp' }]);
  assert.equal((await srv.api(`/group-chats/${temp.id}`)).status, 404);
  assert.deepEqual((await srv.api('/bots')).data.map((b) => b.id), bots);
  assert.equal(readData(srv.data, 'read-positions.json').chats[`group:${temp.id}`], undefined);
  assert.equal(fs.existsSync(messages), false);
  assert.equal((await srv.api('/read', { method: 'POST', body: { chat: `group:${temp.id}`, app: 'phone-1' } })).status, 400);
});

test('a deleted bot leaves every group it was in; a group with one member left keeps its record', async () => {
  const live = feed(srv);
  try {
    await live.wait('hello');
    assert.equal((await srv.api(`/bots/${bot.coder.id}`, { method: 'DELETE' })).status, 200);
    await live.wait('groups');
    const now = Object.fromEntries((await groups()).map((g) => [g.name, g.members]));
    assert.deepEqual(now, { Dev: [bot.reviewer.id, bot.writer.id], Pair: [bot.reviewer.id], Kitchen: [bot.cook.id] });
    // One member left: still a group with its chat, to rename, to move, to add a bot to, or to delete.
    const pair = (await groups()).find((g) => g.name === 'Pair');
    assert.equal((await change(pair.id, { name: 'Pair of one' })).status, 200);
    assert.equal((await srv.api('/read', { method: 'POST', body: { chat: `group:${pair.id}`, app: 'phone-1' } })).status, 200);
    assert.deepEqual((await change(pair.id, { members: [bot.reviewer.id, bot.writer.id] })).data.members, [bot.reviewer.id, bot.writer.id]);
  } finally { live.close(); }
});
