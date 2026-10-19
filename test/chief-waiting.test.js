// What waits, and who (QW-002, docs/api.md "Bots" and "What waits after the Chief's change"): the answers of the
// bot routes and of the Chief's create_bot and update_bot say what was held back for the owner, and the chips
// say it too and name the bot.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pendingChanges, waitingWords } = require('../lib/bot-changes');
const { startServer, makeBot, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());
const chiefTools = (t) => rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey }).json;

// ---------- the words ----------

test('each held field has its words; what was given at once has none', () => {
  const before = { prompt: 'Task', systemPrompt: 'Rules', allowedTools: ['Read', 'WebSearch'], computer: 'none', connectors: ['slack'] };
  const held = (next, appName) => { const { safe, changes } = pendingChanges(before, { ...before, ...next }); return waitingWords(changes, safe, appName); };
  assert.deepEqual(held({}), []);
  assert.deepEqual(held({ allowedTools: ['Read', 'WebSearch', 'WebFetch'] }), ['web access']);
  assert.deepEqual(held({ allowedTools: ['Read', 'WebSearch', 'Bash(git log:*)'] }), ['commands']);
  assert.deepEqual(held({ allowedTools: ['Read', 'WebSearch', 'Edit', 'Write'] }), [], 'files are given at once');
  assert.deepEqual(held({ allowedTools: ['Read'] }), [], 'taking a tool away waits for nothing');
  assert.deepEqual(held({ computer: 'linux' }), ['the computer']);
  assert.deepEqual(held({ connectors: ['slack', 'gmail', 'notion'] }, (app) => ({ gmail: 'Gmail', notion: 'Notion' })[app]), ['Gmail', 'Notion'], 'only the apps it did not have');
  assert.deepEqual(held({ prompt: 'Another task' }), ['new main assignment']);
  assert.deepEqual(held({ systemPrompt: 'Other rules' }), ['new rules']);
  assert.deepEqual(held({ prompt: 'x', systemPrompt: 'y', allowedTools: ['Bash', 'WebFetch'], computer: 'linux', connectors: ['gmail'] }, () => 'Gmail'),
    ['web access', 'commands', 'the computer', 'Gmail', 'new main assignment', 'new rules']);
});

// ---------- the routes ----------

test('POST and PUT /api/bots answer `waiting` when the Chief\'s change was held back, and not otherwise', async () => {
  const created = await srv.asChief('/bots', { method: 'POST', body: { name: 'News Watcher', prompt: 'Watch the news.', allowedTools: ['Read', 'WebSearch', 'Bash'], computer: 'linux', connectors: ['gmail'] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.deepEqual(created.data.waiting, ['web access', 'commands', 'the computer', 'Gmail']);
  assert.deepEqual(created.data.allowedTools, ['Read'], 'the bot in the answer is as it was saved');
  assert.ok(created.data.pendingChange);
  // The card of what waits says the same in its title, and who proposed it (docs/api.md, "Things that need the owner").
  const card = (await srv.api('/asks')).data.find((a) => a.id === created.data.pendingChange);
  assert.deepEqual([card.by, card.title], ['chief', 'Change News Watcher: web access, commands, the computer and Gmail?']);
  assert.deepEqual(card.parts.map((p) => [p.label, p.now, 'was' in p]), [['What it may do', 'browse the web and run commands', false], ['Computer', "a screen on the account's computer, which every bot there shares with sudo, on your home network: a saved login used there, they can all read", false], ['Connected apps', 'Gmail', false]]);
  assert.ok(!('chatId' in card), 'made from no chat');

  const plain = await srv.asChief('/bots', { method: 'POST', body: { name: 'Note Taker', prompt: 'Take notes.', allowedTools: ['Read', 'Edit'] } });
  assert.ok(!('waiting' in plain.data), 'nothing held: absent');

  const changed = await srv.asChief(`/bots/${plain.data.id}`, { method: 'PUT', body: { prompt: 'Take better notes.', systemPrompt: 'Be brief.', description: 'Takes notes' } });
  assert.deepEqual(changed.data.waiting, ['new main assignment', 'new rules']);
  assert.equal(changed.data.prompt, 'Take notes.');
  const texts = (await srv.api('/asks')).data.find((a) => a.id === changed.data.pendingChange);
  assert.equal(texts.title, 'Change Note Taker: new main assignment and new rules?');
  assert.deepEqual(texts.parts, [{ label: 'Main assignment', was: 'Take notes.', now: 'Take better notes.' }, { label: 'Rules', was: '', now: 'Be brief.' }]);
  assert.equal(changed.data.description, 'Takes notes');

  const renamed = await srv.asChief(`/bots/${plain.data.id}`, { method: 'PUT', body: { name: 'Notes' } });
  assert.ok(!('waiting' in renamed.data));
  const owner = await srv.api(`/bots/${plain.data.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'Bash'], prompt: 'The owner says.' } });
  assert.ok(!('waiting' in owner.data), "the owner's own change waits for nobody");
  assert.ok(!('waiting' in (await srv.api(`/bots/${plain.data.id}`)).data), 'it is not kept with the bot');
});

test('DELETE /api/bots/:id answers the name the bot had', async () => {
  const bot = await makeBot(srv, { name: 'Old Timer' });
  const gone = await srv.api(`/bots/${bot.id}`, { method: 'DELETE' });
  assert.deepEqual([gone.data.ok, gone.data.name], [true, 'Old Timer']);
});

// ---------- the Chief's tools ----------

test('create_bot and update_bot return `waiting` and the saved main assignment, so no get_bot is needed', async (t) => {
  // The Chief's tools run for one chat, and say so with every call: the card keeps it.
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const call = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, CHIEF_CHAT_ID: chat.id }).json;
  const made = await call('create_bot', { name: 'Price Watcher', prompt: 'Watch the price of one thing.', allowedTools: ['Read', 'WebFetch'] });
  assert.deepEqual(made.waiting, ['web access']);
  const card = (await srv.api('/asks')).data.find((a) => a.botId === made.id);
  assert.deepEqual([card.by, card.chatId, card.title], ['chief', chat.id, 'Let Price Watcher browse the web?']);
  assert.equal(made.prompt, 'Watch the price of one thing.');
  assert.deepEqual(made.allowedTools, ['Read']);
  assert.ok(!('applied' in made));

  // Everything of the call waits: said so.
  const all = await call('update_bot', { id: made.id, prompt: 'Watch two prices.', computer: 'linux' });
  assert.deepEqual(all.waiting, ['the computer', 'new main assignment']);
  assert.equal(all.prompt, 'Watch the price of one thing.', 'the main assignment as it is saved');
  assert.equal(all.applied, false);
  // Part of it was saved.
  const part = await call('update_bot', { id: made.id, description: 'Watches a price', systemPrompt: 'Never buy.' });
  assert.deepEqual(part.waiting, ['new rules']);
  assert.equal(part.description, 'Watches a price');
  assert.ok(!('applied' in part));
  // Nothing held.
  const none = await call('update_bot', { id: made.id, name: 'Price Hawk' });
  assert.ok(!('waiting' in none) && !('applied' in none));
  assert.equal(none.prompt, 'Watch the price of one thing.');
  // The list stays short: no main assignment in it.
  const listed = await call('list_bots', {});
  assert.ok(listed.every((b) => !('prompt' in b) && !('waiting' in b)));
});

test('the descriptions of create_bot and update_bot say what `waiting` lists, and no longer send the Chief to get_bot', async (t) => {
  const client = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const tools = (await client.request('tools/list')).tools;
  for (const name of ['create_bot', 'update_bot']) {
    const d = tools.find((x) => x.name === name).description;
    assert.match(d, /`waiting` in it lists what .* the user must approve .* in Needs you first/, name);
    assert.doesNotMatch(d, /get_bot/, name);
  }
});

// ---------- the chips ----------

// The chips of one Chief turn in which its tools answered `calls`: [[tool, input, output], …].
async function chips(calls) {
  const events = calls.flatMap(([tool, input, output], i) => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: `c${i}`, name: `mcp__botdot__${tool}`, input }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `c${i}`, content: JSON.stringify(output) }] } },
  ]);
  fs.writeFileSync(path.join(srv.out, 'events.json'), JSON.stringify(events));
  try {
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Do it' } });
    const done = await waitFor(async () => { const c = (await srv.api(`/chief/chats/${chat.id}`)).data; return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
    return done.messages.at(-1).actions;
  } finally { fs.rmSync(path.join(srv.out, 'events.json'), { force: true }); }
}

test('the chips name the bot, and say what waits for the owner', async () => {
  const actions = await chips([
    ['create_bot', { name: 'News Watcher' }, { id: 'b1', name: 'News Watcher', waiting: ['web access'] }],
    ['create_bot', { name: 'Runner' }, { id: 'b2', name: 'Runner', waiting: ['web access', 'commands', 'Gmail'] }],
    ['create_bot', { name: 'Reader' }, { id: 'b3', name: 'Reader' }],
    ['update_bot', { id: 'b1', description: 'd', systemPrompt: 's' }, { id: 'b1', name: 'News Watcher', waiting: ['new rules'] }],
    ['update_bot', { id: 'b1', prompt: 'p', computer: 'linux' }, { id: 'b1', name: 'News Watcher', waiting: ['the computer', 'new main assignment'], applied: false }],
    ['update_bot', { id: 'b3', name: 'Reader' }, { id: 'b3', name: 'Reader' }],
    ['delete_bot', { id: 'b3', userConfirmed: true }, { ok: true, name: 'Reader', computer: 'none', skillsRemoved: 0 }],
    ['delete_bot', { id: 'b9', userConfirmed: true }, { ok: true }],
  ]);
  assert.deepEqual(actions, [
    { kind: 'created', text: 'Created News Watcher', botId: 'b1', waits: 'web access waits for your OK' },
    { kind: 'created', text: 'Created Runner', botId: 'b2', waits: 'web access, commands and Gmail wait for your OK' },
    { kind: 'created', text: 'Created Reader', botId: 'b3' },
    { kind: 'updated', text: 'Updated News Watcher', botId: 'b1', waits: 'new rules waits for your OK' },
    { kind: 'updated', text: 'News Watcher', botId: 'b1', waits: 'the computer and new main assignment wait for your OK' },
    { kind: 'updated', text: 'Updated Reader', botId: 'b3' },
    { kind: 'deleted', text: 'Deleted Reader' },
    { kind: 'deleted', text: 'Deleted b9' },
  ]);
});

test('from the tool to the chip: what the Chief\'s real tools answer reads right on the chip', async (t) => {
  const call = chiefTools(t);
  const made = await call('create_bot', { name: 'Home Helper', prompt: 'Help at home.', allowedTools: ['Read', 'Bash'], computer: 'linux' });
  const all = await call('update_bot', { id: made.id, systemPrompt: 'Be kind.' });
  const gone = await call('delete_bot', { id: made.id, userConfirmed: true });
  const actions = await chips([['create_bot', {}, made], ['update_bot', { id: made.id }, all], ['delete_bot', { id: made.id, userConfirmed: true }, gone]]);
  assert.deepEqual(actions, [
    { kind: 'created', text: 'Created Home Helper', botId: made.id, waits: 'commands and the computer wait for your OK' },
    { kind: 'updated', text: 'Home Helper', botId: made.id, waits: 'new rules waits for your OK' },
    { kind: 'deleted', text: 'Deleted Home Helper' },
  ]);
});
