// What waits, and who (QW-002, docs/api.md "Bots" and "What waits after the Chief's change"): the answers of the
// bot routes and of the Chief's create_bot and update_bot say what was held back for the owner, and the chips
// say it too and name the bot.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pendingChanges, waitingWords } = require('../lib/bot-changes');
const { startServer, makeBot, waitFor, withAlways } = require('./helpers');
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
  // A new bot gets everything it is made with (ADR 176): nothing of it waits on a card.
  const created = await srv.asChief('/bots', { method: 'POST', body: { name: 'News Watcher', prompt: 'Watch the news.', allowedTools: ['Read', 'WebSearch', 'Bash'], computer: 'linux', connectors: ['gmail'] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.ok(!('waiting' in created.data) && !('pendingChange' in created.data), JSON.stringify(created.data));
  assert.deepEqual([created.data.allowedTools, created.data.computer, created.data.connectors], [withAlways('Read', 'WebSearch', 'Bash'), 'linux', ['gmail']]);
  assert.ok(!(await srv.api('/asks')).data.some((a) => a.botId === created.data.id), 'no card for a new bot');
  // A change to it outside a turn of the owner's waits, and its card says what and who proposed it.
  const grown = await srv.asChief(`/bots/${created.data.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'WebSearch', 'Bash', 'Agent'], connectors: ['gmail', 'notion'] } });
  assert.deepEqual(grown.data.waiting, ['Notion'], 'helpers are given at once, and the web is every bot\'s (ADR 186)');
  const card = (await srv.api('/asks')).data.find((a) => a.id === grown.data.pendingChange);
  assert.equal(card.by, 'chief');
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
  assert.ok(!('waiting' in made) && !('applied' in made), 'a new bot gets what it is made with (ADR 176)');
  assert.equal(made.prompt, 'Watch the price of one thing.');
  assert.deepEqual(made.allowedTools, withAlways('Read', 'WebFetch'));
  // A tool given later, outside a turn of the owner's, waits on a card that keeps the chat.
  const web = await call('update_bot', { id: made.id, allowedTools: ['Read', 'WebFetch', 'Bash'] });
  assert.deepEqual(web.waiting, ['commands']);
  const card = (await srv.api('/asks')).data.find((a) => a.botId === made.id);
  assert.deepEqual([card.by, card.chatId, card.title], ['chief', chat.id, 'Let Price Watcher run commands?']);

  // Everything of the call waits: said so.
  const all = await call('update_bot', { id: made.id, prompt: 'Watch two prices.', allowedTools: ['Read', 'WebFetch', 'Bash'] });
  assert.deepEqual(all.waiting, ['commands', 'new main assignment']);
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
  const made = tools.find((x) => x.name === 'create_bot').description;
  assert.match(made, /everything you make it with at once, with no card/);
  assert.doesNotMatch(made, /`waiting`|get_bot/);
  const changed = tools.find((x) => x.name === 'update_bot').description;
  assert.match(changed, /`waiting` in it lists what .* the user must approve .* in Needs you first/);
  assert.doesNotMatch(changed, /get_bot/);
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
    { kind: 'created', text: 'Created Home Helper', botId: made.id },
    { kind: 'updated', text: 'Home Helper', botId: made.id, waits: 'new rules waits for your OK' },
    { kind: 'deleted', text: 'Deleted Home Helper' },
  ]);
});
