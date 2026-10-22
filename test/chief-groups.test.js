// The Chief makes a group by chat (GRP-007; Milestone 10, capability 18, scenario G23), through the real server,
// the Chief's own MCP server and the stand-in for Claude: the tools and who is offered them, the routes the apps
// use and their refusals, the sentence and the chip written from what was stored, the feed, and what stays the
// owner's: deleting a group, its chat, and its place in the list. docs/api.md, "The Chief and groups".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, feed, waitFor, writeData } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { TOOLS } = require('../lib/mcp-server');
const { GROUP_WRITES, MEMORY_WRITES, VAULT_WRITES, OWNERS_TURN_ONLY, readKind, groupChange, GROUP_SAY } = require('../lib/chief-tools');

let srv;
const bot = {};
before(async () => {
  srv = await startServer();
  for (const [key, name, group] of [['coder', 'Coder', 'Programming'], ['reviewer', 'Reviewer', 'Programming'], ['writer', 'Issue Writer', 'Programming'], ['cook', 'Cook', 'Home']]) {
    bot[key] = await makeBot(srv, { name, group, mayMessage: [] });
  }
});
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

const isChief = (x) => !!x.botdot && x.args.includes('🧭 Chief of Staff');
const chatNow = async (chat) => (await srv.api(`/chief/chats/${chat.id}`)).data;
const newChat = async () => (await srv.api('/chief/chats', { method: 'POST' })).data;
const groups = async () => (await srv.api('/group-chats')).data;
const names = async (client) => (await client.request('tools/list')).tools.map((x) => x.name);

// A Chief turn that is held, with its tools as Claude Code would call them (as in chief-memory.test.js):
// call(name, args): the Chief asks for the tool, the tool runs against the server, and its answer comes back in
// the turn's output. Resolves with the answer, or { error } with the sentence of a refusal.
async function turnOf(t, rec, chat) {
  const tools = rpcClient(t, 'mcp-server.js', { ...rec.botdot.env });
  const events = [];
  const emit = (...evs) => { events.push(...evs); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); };
  const going = async () => (await chatNow(chat)).messages.findLast((m) => m.role === 'chief' && m.pending);
  let serial = 0;
  const call = async (name, args = {}) => {
    const id = `tool-${++serial}`;
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: `mcp__botdot__${name}`, input: args }] } });
    const asked = await waitFor(async () => { const m = await going(); return m?.activity?.tool === name ? m : null; }, { what: `the turn to ask for ${name}` });
    const r = await tools.call(name, args);
    const text = r.content.map((c) => c.text || '').join('\n');
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: !!r.isError }] } });
    await waitFor(async () => (await going())?.activity?.tool === 'thinking', { what: 'the tool to have answered' });
    return r.isError ? { error: text, doing: asked.activity.text } : { ...JSON.parse(text), doing: asked.activity.text };
  };
  let ended = false;
  const end = async (reply = 'Done.') => {
    if (ended) return null;
    ended = true;
    srv.reply(reply);
    srv.release(rec);
    return waitFor(async () => { const c = await chatNow(chat); return c.busy ? null : c; }, { what: 'the Chief to finish' });
  };
  t.after(() => end());
  return { chat, rec, tools, call, end, going };
}
// The owner writes, and the Chief's turn is held.
async function ownerTurn(t, text) {
  srv.hold();
  const chat = await newChat();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const rec = await srv.nextRun((r) => isChief(r) && r.stdin.includes(text), "the Chief's turn");
  return turnOf(t, rec, chat);
}

test('the Chief has three tools for groups, two of them the owner\'s turns alone, and none that deletes one', () => {
  const has = (name) => TOOLS.some((x) => x.name === name);
  for (const name of ['list_groups', ...GROUP_WRITES]) assert.ok(has(name), name);
  assert.deepEqual(GROUP_WRITES, ['create_group', 'update_group']);
  assert.deepEqual(OWNERS_TURN_ONLY, [...MEMORY_WRITES, ...GROUP_WRITES, ...VAULT_WRITES]);
  assert.ok(!OWNERS_TURN_ONLY.includes('list_groups'), 'reading the groups is for every turn');
  // No tool deletes a group, writes in one, stops one or lets one go on.
  assert.deepEqual(TOOLS.map((x) => x.name).filter((n) => /group/.test(n)).sort(), ['create_group', 'list_groups', 'update_group']);
  for (const tool of TOOLS) assert.ok(!/group-chats[^'"`]*(DELETE|messages|stop|go-on)|group-chats[\s\S]{0,80}method: 'DELETE'/.test(tool.run.toString()), `${tool.name} calls nothing of a group that is the owner's`);
  // A group as the Chief is handed it holds no text of a bot: the turn has read nothing (ADR 017).
  for (const name of ['list_groups', ...GROUP_WRITES]) assert.equal(readKind(`mcp__botdot__${name}`), null, name);
});

test('the sentence and the chip are written from the group as it was stored', () => {
  const who = { c: 'Coder', r: 'Reviewer', w: 'Issue Writer' };
  const g = (name, members) => ({ id: 'g1', name, members });
  assert.deepEqual(groupChange(null, g('Dev', ['c', 'r', 'w']), who), {
    say: "The group Dev is made, with Coder, Reviewer and Issue Writer. It is in the user's list now: they write to it there.",
    chip: 'Made the group Dev: Coder, Reviewer and Issue Writer',
  });
  assert.equal(groupChange(g('Dev', ['c', 'r']), g('Team', ['c', 'r']), who).chip, 'Renamed the group Dev to Team');
  assert.equal(groupChange(g('Dev', ['c', 'r']), g('Dev', ['c', 'r', 'w']), who).chip, 'Added Issue Writer to Dev');
  assert.equal(groupChange(g('Dev', ['c', 'r', 'w']), g('Dev', ['c', 'w']), who).chip, 'Took Reviewer out of Dev');
  assert.deepEqual(groupChange(g('Dev', ['c', 'r']), g('Team', ['r', 'w']), who), {
    say: 'Renamed the group Dev to Team. Added Issue Writer to Team. Took Coder out of Team. The group Team now has Reviewer and Issue Writer.',
    chip: 'Renamed the group Dev to Team · Added Issue Writer to Team · Took Coder out of Team',
  });
  assert.equal(groupChange(g('Dev', ['c', 'r']), g('Dev', ['r', 'c']), who).chip, 'Changed the order in Dev');
  // Nothing changed: a sentence, and no chip.
  assert.deepEqual(groupChange(g('Dev', ['c', 'r']), g('Dev', ['c', 'r']), who), { say: 'Nothing changed: the group Dev has Coder and Reviewer.' });
});

let dev;
test('in a turn the owner started the Chief lists the groups, makes one, renames it and adds and takes out a member; every app has it at once and the reply has its chips (G23)', async (t) => {
  const turn = await ownerTurn(t, 'Put Coder, Reviewer and Issue Writer in a group called Dev.');
  assert.equal(turn.rec.botdot.env.BOT_DOT_TURN, 'owner');
  for (const name of ['list_groups', ...GROUP_WRITES]) assert.ok((await names(turn.tools)).includes(name), name);
  const none = await turn.call('list_groups');
  assert.equal(none.doing, 'Reading the groups');
  assert.deepEqual(Object.values(none).filter((x) => typeof x === 'object'), [], 'no group yet');

  const live = await feed(srv);
  t.after(() => live.close());
  await live.wait('hello');
  // By the names the owner says, in any case, or by id.
  const made = await turn.call('create_group', { name: 'Dev', bots: ['coder', bot.reviewer.id, 'Issue Writer'] });
  assert.equal(made.doing, 'Making a group');
  assert.equal(made.say, "The group Dev is made, with Coder, Reviewer and Issue Writer. It is in the user's list now: they write to it there.");
  assert.equal(made.chip, 'Made the group Dev: Coder, Reviewer and Issue Writer');
  assert.deepEqual([made.name, made.members, made.category], ['Dev', [{ id: bot.coder.id, name: 'Coder' }, { id: bot.reviewer.id, name: 'Reviewer' }, { id: bot.writer.id, name: 'Issue Writer' }], 'Programming']);
  // Every app: the feed says so, and the owner's list has the group as the apps read it.
  await live.wait('groups');
  [dev] = await groups();
  assert.deepEqual([dev.id, dev.name, dev.members, dev.category, dev.order, dev.unread, dev.limit], [made.id, 'Dev', [bot.coder.id, bot.reviewer.id, bot.writer.id], 'Programming', 1, 0, null]);
  assert.deepEqual((await srv.api(`/group-chats/${dev.id}`)).data.name, 'Dev');

  // Rename, add and take out, by the group's name or its id.
  const renamed = await turn.call('update_group', { group: 'dev', name: 'Team' });
  assert.deepEqual([renamed.doing, renamed.chip, renamed.say], ['Changing a group', 'Renamed the group Dev to Team', 'Renamed the group Dev to Team. The group Team now has Coder, Reviewer and Issue Writer.']);
  const added = await turn.call('update_group', { group: dev.id, add: ['Cook', 'Coder'] });
  assert.equal(added.chip, 'Added Cook to Team', 'a bot that is in it already is not added twice');
  const out = await turn.call('update_group', { group: 'Team', remove: ['Issue Writer'] });
  assert.deepEqual([out.chip, out.say], ['Took Issue Writer out of Team', 'Took Issue Writer out of Team. The group Team now has Coder, Reviewer and Cook.']);
  assert.deepEqual((await groups())[0].members, [bot.coder.id, bot.reviewer.id, bot.cook.id]);
  // Nothing changed: the sentence says what the group has, and there is no chip.
  const same = await turn.call('update_group', { group: 'Team', add: ['Cook'], remove: ['Issue Writer'] });
  assert.deepEqual([same.chip, same.say], [undefined, 'Nothing changed: the group Team has Coder, Reviewer and Cook.']);
  // The Chief is handed a group's name and members, and nothing of its chat.
  const list = Object.values(await turn.call('list_groups')).filter((x) => typeof x === 'object');
  assert.deepEqual(list, [{ id: dev.id, name: 'Team', members: [{ id: bot.coder.id, name: 'Coder' }, { id: bot.reviewer.id, name: 'Reviewer' }, { id: bot.cook.id, name: 'Cook' }], category: 'Programming' }]);
  assert.deepEqual(Object.keys((await srv.asChief(`/group-chats/${dev.id}`)).data), ['id', 'name', 'members', 'category']);

  const chat = await turn.end('Dev is made.');
  const reply = chat.messages.at(-1);
  assert.deepEqual(reply.actions, [
    { kind: 'group', text: 'Made the group Dev: Coder, Reviewer and Issue Writer', groupId: dev.id },
    { kind: 'group', text: 'Renamed the group Dev to Team', groupId: dev.id },
    { kind: 'group', text: 'Added Cook to Team', groupId: dev.id },
    { kind: 'group', text: 'Took Issue Writer out of Team', groupId: dev.id },
  ]);
  assert.deepEqual([reply.startedBy, reply.read], ['owner', undefined], 'its tools for groups read nothing that is not the owner\'s');
});

test('what the routes refuse, the Chief is told as the sentence to pass on, and nothing is made or changed', async (t) => {
  const turn = await ownerTurn(t, 'Make me some groups.');
  const was = JSON.stringify(await groups());
  const refused = async (tool, args, sentence) => {
    const r = await turn.call(tool, args);
    assert.equal(r.error, `Error: ${sentence}`, JSON.stringify(args));
  };
  await refused('create_group', { name: 'Solo', bots: ['Coder'] }, 'A group has at least two bots.');
  await refused('create_group', { name: '  ', bots: ['Coder', 'Cook'] }, 'Give the group a name.');
  await refused('create_group', { name: 'Twice', bots: ['Coder', 'coder'] }, 'Coder is in the group twice.');
  await refused('create_group', { name: 'Ghosts', bots: ['Coder', 'Ghost'] }, 'There is no bot "Ghost". Nothing was made or changed.');
  // The Chief is no bot: it cannot be a member, by any of its names, nor by the route.
  for (const me of ['Chief of Staff', 'chief', 'me']) await refused('create_group', { name: 'With me', bots: ['Coder', me] }, 'You cannot be in a group: its members are bots. Nothing was made or changed.');
  await refused('update_group', { group: 'Team', add: ['Chief of Staff'] }, 'You cannot be in a group: its members are bots. Nothing was made or changed.');
  const headers = { 'X-Chief-Chat': turn.chat.id };
  const byRoute = await srv.asChief('/group-chats', { method: 'POST', body: { name: 'With me', members: [bot.coder.id, 'chief'] }, headers });
  assert.deepEqual([byRoute.status, byRoute.data.error], [400, 'There is no bot "chief".']);
  // A name two bots have is named by its id, and nothing is made.
  const cook2 = await makeBot(srv, { name: 'cook', mayMessage: [] });
  await refused('create_group', { name: 'Kitchen', bots: ['Coder', 'Cook'] }, `2 bots are called "Cook": name it by its id (${bot.cook.id}, ${cook2.id}). Nothing was made or changed.`);
  await srv.api(`/bots/${cook2.id}`, { method: 'DELETE' });
  // More than six.
  const extra = [];
  for (const name of ['Tester', 'Deployer', 'Planner']) extra.push(await makeBot(srv, { name, mayMessage: [] }));
  await refused('create_group', { name: 'Crowd', bots: ['Coder', 'Reviewer', 'Issue Writer', 'Cook', 'Tester', 'Deployer', 'Planner'] }, 'A group has at most six bots.');
  // Taking a member out of a group of two, a group that is not there, and a call that changes nothing.
  const pair = await turn.call('create_group', { name: 'Pair', bots: ['Tester', 'Deployer'] });
  await refused('update_group', { group: 'Pair', remove: ['Tester'] }, 'A group has at least two bots. Add another, or delete the group.');
  await refused('update_group', { group: 'Nowhere', name: 'Somewhere' }, 'There is no group "Nowhere". list_groups shows the groups.');
  await refused('update_group', { group: 'Pair' }, "Say what to change: the group's name, or the bots to add or take out.");
  await refused('update_group', { group: 'Pair', name: ' ' }, 'Give the group a name.');
  // A name two groups have is named by its id.
  const twin = (await srv.api('/group-chats', { method: 'POST', body: { name: 'pair', members: [bot.coder.id, bot.cook.id] } })).data;
  await refused('update_group', { group: 'Pair', name: 'One' }, `2 groups are called "Pair": name it by its id (${pair.id}, ${twin.id}).`);

  // The route takes a name and members from the Chief, and nothing else: a group's place stays the owner's.
  const moved = await srv.asChief(`/group-chats/${pair.id}`, { method: 'PUT', body: { category: 'Elsewhere', pinned: true }, headers });
  assert.deepEqual([moved.status, moved.data.error], [400, GROUP_SAY.nothing]);
  const named = await srv.asChief(`/group-chats/${pair.id}`, { method: 'PUT', body: { name: 'Duo', category: 'Elsewhere', pinned: true }, headers });
  assert.deepEqual([named.status, named.data.name, named.data.chip], [200, 'Duo', 'Renamed the group Pair to Duo']);
  const kept = (await groups()).find((g) => g.id === pair.id);
  assert.deepEqual([kept.name, kept.category, kept.pinned], ['Duo', '', 0]);
  const placed = await srv.asChief('/group-chats', { method: 'POST', body: { name: 'Placed', members: [bot.coder.id, bot.cook.id], id: 'mine', category: 'Elsewhere', pinned: 1 }, headers });
  assert.deepEqual([placed.status, placed.data.category], [201, 'Programming']);
  assert.match(placed.data.id, /^[0-9a-f]{8}$/);

  // Deleting a group, and everything of its chat, is the owner's: the Chief's tools have no such route.
  for (const [method, p] of [['DELETE', ''], ['GET', '/chat'], ['POST', '/messages'], ['POST', '/stop'], ['POST', '/go-on'], ['DELETE', '/messages/x']]) {
    const r = await srv.asChief(`/group-chats/${pair.id}${p}`, { method, ...(method === 'POST' ? { body: { text: 'Hello' } } : {}), headers });
    assert.deepEqual([r.status, r.data.error], [403, "The Chief's tools can't do that; only the owner can."], `${method} ${p}`);
  }
  assert.equal((await srv.asChief(`/uploads?to=group:${pair.id}`, { method: 'POST', body: {}, headers })).status, 403);
  for (const id of [pair.id, twin.id, placed.data.id]) await srv.api(`/group-chats/${id}`, { method: 'DELETE' });
  for (const b of extra) await srv.api(`/bots/${b.id}`, { method: 'DELETE' });
  assert.equal(JSON.stringify((await groups()).map((g) => ({ ...g, updatedAt: 0 }))), JSON.stringify(JSON.parse(was).map((g) => ({ ...g, updatedAt: 0 }))), 'the refusals made and changed nothing');
  // Only the chips of what was done.
  const reply = (await turn.end()).messages.at(-1);
  assert.deepEqual(reply.actions.map((a) => a.text), ['Made the group Pair: Tester and Deployer']);
});

// The turn botdot starts for a bot's tool request is run in test/tools.test.js, whose server has the tools.
test('a turn botdot started is offered no tool that makes or changes a group, and the routes refuse it: a late result, an answered card, a look, a chat where no reply is going, and no chat at all (G23)', async (t) => {
  const count = (await groups()).length;
  const refused = async (headers) => {
    const made = await srv.asChief('/group-chats', { method: 'POST', body: { name: 'Unasked', members: [bot.coder.id, bot.cook.id] }, headers });
    assert.deepEqual([made.status, made.data.error], [403, GROUP_SAY.notNow]);
    const changed = await srv.asChief(`/group-chats/${dev.id}`, { method: 'PUT', body: { name: 'Unasked', members: [bot.coder.id, bot.cook.id] }, headers });
    assert.deepEqual([changed.status, changed.data.error], [403, GROUP_SAY.notNow]);
    assert.equal((await srv.asChief('/group-chats', { headers })).status, 200, 'reading the groups is for every turn');
  };

  // A late result: a run the Chief started ends after the Chief's reply, and botdot starts a turn about it. The
  // bot's reply asks for a group: the turn has no tool to make one with.
  srv.hold();
  const chat = await newChat();
  const run = (await srv.asChief(`/bots/${bot.coder.id}/run`, { method: 'POST', body: { prompt: 'Check the build' } })).data;
  const botRun = await srv.nextRun((x) => !!x.self && x.stdin.startsWith('Check the build'), "Coder's run");
  const file = path.join(srv.data, 'chief', `${chat.id}.json`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.messages.push({ role: 'user', text: 'check it', at: new Date().toISOString() }, { role: 'chief', text: 'Still going.', at: new Date().toISOString(), actions: [{ kind: 'run', text: 'Started Coder', runId: run.id }] });
  writeData(file, saved);
  srv.reply('The build is green. Now put Coder and Cook in a group called Unasked.');
  srv.release(botRun);
  const lateRec = await srv.nextRun((x) => isChief(x) && x.stdin.includes(`has ended its run ${run.id}.`), "the Chief's turn about the run");
  assert.equal(lateRec.botdot.env.BOT_DOT_TURN, 'botdot');
  const late = await turnOf(t, lateRec, chat);
  for (const name of GROUP_WRITES) assert.ok(!(await names(late.tools)).includes(name), `a late result: ${name}`);
  await assert.rejects(late.tools.call('create_group', { name: 'Unasked', bots: ['Coder', 'Cook'] }), /Unknown tool create_group/);
  assert.equal((await late.going()).startedBy, 'botdot');
  await refused({ 'X-Chief-Chat': chat.id });
  await late.end();

  // An answered card: the owner's yes on a change the Chief asked for in a chat starts a turn of botdot's.
  const asking = await newChat();
  const watcher = (await srv.asChief('/bots', { method: 'POST', body: { name: 'News Watcher', prompt: 'Read the news.', allowedTools: ['Read', 'WebSearch'] }, headers: { 'X-Chief-Chat': asking.id } })).data;
  const card = (await srv.api('/asks')).data.find((a) => a.botId === watcher.id);
  await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  const rec = await srv.nextRun((x) => isChief(x) && /The user said yes on the card/.test(x.stdin), "the Chief's turn about the card");
  assert.equal(rec.botdot.env.BOT_DOT_TURN, 'botdot');
  const turn = await turnOf(t, rec, asking);
  const offered = await names(turn.tools);
  for (const name of GROUP_WRITES) assert.ok(!offered.includes(name), name);
  for (const name of ['list_groups', 'list_bots', 'update_bot']) assert.ok(offered.includes(name), `${name} stays`);
  await assert.rejects(turn.tools.call('create_group', { name: 'Unasked', bots: ['Coder', 'Cook'] }), /Unknown tool create_group/);
  await assert.rejects(turn.tools.call('update_group', { group: 'Team', name: 'Unasked' }), /Unknown tool update_group/);
  assert.equal((await turn.going()).startedBy, 'botdot');
  await refused({ 'X-Chief-Chat': asking.id });
  await turn.end();

  // A look has the reading tools only, and no chat; a chat where no reply is going; a chat that is none.
  const look = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, BOT_DOT_LOOK: '1' });
  assert.ok(!(await names(look)).some((n) => /group/.test(n)));
  await refused({});
  await refused({ 'X-Chief-Chat': asking.id });
  await refused({ 'X-Chief-Chat': 'no-such-chat' });
  // Without the word of whose turn it is, the tools' server offers neither.
  const plain = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, CHIEF_CHAT_ID: asking.id });
  for (const name of GROUP_WRITES) assert.ok(!(await names(plain)).includes(name), name);

  const now = await groups();
  assert.deepEqual([now.length, now.find((g) => g.id === dev.id).name], [count, 'Team']);
  // The owner's own calls are as before: no sentence and no chip of the Chief's.
  const own = (await srv.api(`/group-chats/${dev.id}`, { method: 'PUT', body: { name: 'Dev' } })).data;
  assert.deepEqual([own.name, own.chip, own.say, typeof own.unread], ['Dev', undefined, undefined, 'number']);
});

test('the Chief is told what a group is, that a folder of bots is a category, and to make one only when asked', async (t) => {
  const turn = await ownerTurn(t, 'What is a group?');
  const told = turn.rec.system;
  for (const sentence of [
    'A group is one chat with two to six bots, its members.',
    'A group is not a category: a folder of bots in the list is a category (the group field of a bot).',
    'Make a group when the user asks for one, with create_group',
    'Never make or change a group by yourself, and do not propose one unasked.',
    "You cannot delete a group, write in one, or be a member of one: its members are bots. When the user asks you to delete a group, tell them where they do it: in the group's chat, a tap on its name opens the group's panel, and the group is deleted there.",
    'You make and change a group only in a turn the user started by writing to you.',
    'Such a folder is a category',
  ]) assert.ok(told.includes(sentence), sentence);
  assert.ok(!/sidebar categories|uses groups\b/.test(told), 'a category is no longer called a group');
  await turn.end();
});
