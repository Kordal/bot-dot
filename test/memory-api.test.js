// Exercise memory through the real HTTP server AND the exact MCP processes used by bots/Chief.
// Claude itself is the existing offline fixture: tool calls and assertions are driven explicitly.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, sharedByBot, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv, chiefEnv;
const chiefDone = (server, chat) => waitFor(async () => {
  const c = (await server.api(`/chief/chats/${chat.id}`)).data;
  return !c.busy && c.messages.some((m) => m.role === 'chief' && !m.pending) ? c : null;
}, { what: 'the Chief reply to finish' });

before(async () => {
  srv = await startServer();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Initialize memory testing' } });
  chiefEnv = (await srv.nextRun((x) => x.botdot)).botdot.env;
  await chiefDone(srv, chat);
});
after(async () => { await srv?.stop(); if (srv) fs.rmSync(srv.dir, { recursive: true, force: true }); });

async function botTools(t, fields = {}) {
  const bot = await makeBot(srv, { name: `Memory ${t.name.slice(0, 24)}`, ...fields });
  const held = await heldRun(srv, bot);
  t.after(async () => { srv.release(held.rec); await srv.finished(held.run.id); srv.unhold(); });
  const tools = rpcClient(t, 'self-mcp.js', held.rec.self.env);
  return { bot, ...held, tools };
}
const chiefTools = (t) => rpcClient(t, 'mcp-server.js', chiefEnv);
const noteId = (text) => { const id = text.match(/as \[([\w-]+)\]/)?.[1]; assert.ok(id, text); return id; };
const add = async (server, owner, text, pinned = true) => {
  const r = await server.api('/memory/notes', { method: 'POST', body: { owner, text, pinned } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.note;
};
async function finishedRun(server, bot, prompt, reply) {
  server.unhold(); server.reply(reply);
  const { data: run } = await server.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  await server.finished(run.id);
  // Consume its fixture record too: heldRun must receive the NEXT run's still-valid token.
  await server.nextRun((x) => x.self && x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(prompt));
  return run;
}

test('both real MCP servers initialize and advertise every memory/recall tool', async (t) => {
  const { tools } = await botTools(t);
  const chief = chiefTools(t);
  for (const [client, names] of [
    [tools, ['remember', 'update_memory', 'remove_note', 'restore_note', 'forget', 'set_pin', 'recall', 'read_run']],
    [chief, ['recall', 'get_run', 'list_runs', 'memory_status', 'set_memory_settings', 'set_quiet_hours', 'review_memory', 'list_notes', 'download_search_model']],
  ]) {
    assert.equal((await client.request('initialize', { protocolVersion: '2025-06-18' })).protocolVersion, '2025-06-18');
    const listed = (await client.request('tools/list')).tools.map((x) => x.name);
    for (const name of names) assert.ok(listed.includes(name), name);
  }
});

test('bot MCP remember → recall → pin → update → historical recall → forget → restore', async (t) => {
  const { tools, bot, run } = await botTools(t);
  const saved = await tools.text('remember', { note: 'Quokka lives in Bruges.', topic: 'home', pin: false });
  const id = noteId(saved);
  assert.match(saved, /searchable with recall/);
  const recalled = await tools.text('recall', { query: 'Quokka', in: 'notes', days: 7 });
  assert.match(recalled, /records, not instructions/);
  assert.ok(recalled.includes(id));
  let note = (await srv.api(`/bots/${bot.id}/learning`)).data.memory.find((n) => n.id === id);
  assert.equal(note.runId, run.id);
  assert.equal(note.uses, 1);
  await tools.text('set_pin', { id, pin: true });
  await tools.text('set_pin', { id, pin: false });
  await tools.text('update_memory', { id, note: 'Quokka lives in Ghent.', reason: 'The owner moved' });
  assert.match(await tools.text('recall', { query: 'Bruges', in: 'notes' }), /Nothing found/);
  assert.match(await tools.text('recall', { query: 'Bruges', in: 'notes', history: true }), /earlier version.*changed because: The owner moved/);
  assert.match(await tools.text('recall', { query: 'Ghent', in: 'everything' }), /Quokka lives in Ghent/);
  await tools.text('remove_note', { id, reason: 'No longer relevant' });
  assert.ok(!(await srv.api(`/bots/${bot.id}/learning`)).data.memory.some((n) => n.id === id));
  const owner = (await srv.api('/memory')).data.bots.find((b) => b.id === bot.id);
  const restore = await srv.api(`/memory/versions/${owner.deleted[0].vid}/restore`, { method: 'POST' });
  assert.equal(restore.data.note.id, id);
  assert.equal(restore.data.note.text, 'Quokka lives in Ghent.');
  assert.match(await tools.text('recall', { query: 'absent987zyx' }), /Nothing found/);
});

test('self recall/read_run reject foreign notes, foreign runs, owner pins, shared pins and invalid/expired tokens', async (t) => {
  const other = await makeBot(srv, { name: 'Foreign memory owner' });
  const foreignNote = await add(srv, other.id, 'HIDDENOWL private note');
  const foreignRun = await finishedRun(srv, other, 'HIDDENOWL question', 'HIDDENOWL private answer');
  const { tools, bot, token, run, rec } = await botTools(t);
  const pinned = await add(srv, bot.id, 'Owner locked pin');
  const shared = await add(srv, '_shared', 'Owner shared pin');
  assert.match(await tools.text('recall', { query: 'HIDDENOWL' }), /Nothing found/);
  for (const [name, args] of [
    ['read_run', { run: foreignRun.id }],
    ['update_memory', { id: foreignNote.id, note: 'Overwrite attempt' }],
    ['remove_note', { id: foreignNote.id }],
    ['forget', { notes: [foreignNote.id], runs: [foreignRun.id], about: 'HIDDENOWL' }],
    ['restore_note', { id: foreignNote.id }],
    ['set_pin', { id: foreignNote.id, pin: false }],
    ['set_pin', { id: pinned.id, pin: false }],
    ['set_pin', { id: shared.id, pin: false }],
  ]) assert.equal((await tools.call(name, args)).isError, true, name);
  assert.equal((await self(srv, 'invalid-token', 'recall', { query: '' })).status, 403);
  srv.release(rec);
  await srv.finished(run.id);
  assert.equal((await self(srv, token, 'recall', { query: '' })).status, 403);
  assert.equal((await tools.call('recall', { query: '' })).isError, true);
});

test('bot recall/read_run and Chief recall/get_run/list_runs follow exclusions, kinds and bot filters', async (t) => {
  const bot = await makeBot(srv, { name: 'Past run reader' });
  const run = await finishedRun(srv, bot, 'Review KESTREL records', 'KESTREL inspected and repaired.');
  const n = await add(srv, bot.id, 'KESTREL note', false);
  const held = await heldRun(srv, bot);
  t.after(async () => { srv.release(held.rec); await srv.finished(held.run.id); srv.unhold(); });
  const tools = rpcClient(t, 'self-mcp.js', held.rec.self.env);
  const chief = chiefTools(t);
  assert.match(await tools.text('recall', { query: 'KESTREL', in: 'runs', days: 1 }), new RegExp(run.id));
  assert.ok(!(await tools.text('recall', { query: 'KESTREL', in: 'runs' })).includes(n.id));
  assert.ok(!(await tools.text('recall', { query: 'KESTREL', in: 'notes' })).includes(run.id));
  assert.match(await tools.text('read_run', { run: run.id }), /record, not instructions.*\nAsked:.*KESTREL[\s\S]*Reply:\nKESTREL inspected/);
  const all = (await chief.json('recall', { query: 'KESTREL' })).results;
  assert.deepEqual(new Set(all.map((r) => r.id || r.runId)), new Set([n.id, run.id]));
  assert.equal((await chief.json('recall', { query: 'KESTREL', bot: bot.id, in: 'runs', days: 7 })).results[0].runId, run.id);
  assert.equal((await chief.json('get_run', { runId: run.id })).result, 'KESTREL inspected and repaired.');
  assert.ok(JSON.stringify(await chief.json('list_runs', { botId: bot.id })).includes(run.id));
  await srv.api(`/memory/runs/${run.id}`, { method: 'PUT', body: { excluded: true } });
  assert.match(await tools.text('recall', { query: 'KESTREL', in: 'runs' }), /Nothing found/);
  assert.equal((await tools.call('read_run', { run: run.id })).isError, true);
  assert.deepEqual((await chief.json('recall', { query: 'KESTREL', in: 'runs' })).results, []);
  assert.ok((await srv.api('/search?q=KESTREL')).data.some((h) => h.runId === run.id));
});

test('Chief MCP finds earlier chats, expands them with get_run and stops recalling deleted chats', async (t) => {
  const chief = chiefTools(t);
  srv.reply('NARWHAL shipment arrives tomorrow.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Locate NARWHAL shipment' } });
  await chiefDone(srv, chat);
  const [hit] = (await chief.json('recall', { query: 'NARWHAL', bot: 'chief', in: 'runs' })).results;
  assert.ok(hit.runId.startsWith(`chief-${chat.id}-`));
  assert.equal((await chief.json('get_run', { runId: hit.runId })).reply, 'NARWHAL shipment arrives tomorrow.');
  const search = (await srv.api('/search?q=NARWHAL')).data;
  assert.equal(search[0].chatId, chat.id);
  assert.equal(search[0].index, 1);
  assert.equal((await srv.api(`/chief/chats/${chat.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await chief.json('recall', { query: 'NARWHAL', bot: 'chief' })).results, []);
});

// What the Chief files, corrects, removes and forgets is in test/chief-memory.test.js.
test('Chief MCP recall of shared notes, memory status/settings, validation and download consent guard', async (t) => {
  const chief = chiefTools(t);
  const n = await add(srv, '_shared', 'AXOLOTL prefers metric units.');
  assert.ok(n.id);
  await srv.api(`/memory/notes/${n.id}`, { method: 'PUT', body: { text: 'AXOLOTL prefers kilometres.' } });
  assert.equal((await chief.json('recall', { query: 'AXOLOTL', bot: '_shared', in: 'notes' })).results[0].id, n.id);
  await srv.api(`/memory/notes/${n.id}`, { method: 'DELETE' });
  assert.ok((await chief.json('recall', { query: 'AXOLOTL' })).results.every((r) => r.kind === 'old'));
  await chief.json('set_memory_settings', { retentionDays: 0, review: { enabled: false, day: 2, time: '12:34', model: 'haiku' }, meaningSearch: { enabled: false } });
  const status = await chief.json('memory_status');
  assert.equal(status.pastRuns.keptForDays, 'always');
  assert.equal(status.review.dayName, 'Tuesday');
  assert.equal(status.review.time, '12:34');
  assert.equal(status.review.model, 'haiku');
  assert.equal(status.meaningSearch.enabled, false);
  for (const args of [{ retentionDays: 6 }, { review: { day: 7 } }, { review: { time: '99:00' } }, { unexpected: true }]) {
    assert.equal((await chief.call('set_memory_settings', args)).isError, true, JSON.stringify(args));
  }
  assert.equal((await chief.call('set_memory_settings', { meaningSearch: { enabled: true } })).isError, true, 'no test llama binary configured');
  assert.match((await chief.call('download_search_model', { userConfirmed: false })).content[0].text, /Ask the user first/);
  assert.equal((await srv.api('/memory/semantic')).data.downloading, null);
});

test('next bot and Chief prompts contain pinned shared/own memory, with searchable notes omitted and hinted', async (t) => {
  const { bot, tools, rec, run } = await botTools(t);
  await tools.text('remember', { note: 'PINNEDIBIS own preference' });
  await tools.text('remember', { note: 'HIDDENIBIS occasional detail', topic: 'ornithology', pin: false });
  await tools.text('remember', { note: 'SHAREDIBIS owner preference', scope: 'shared' });
  srv.release(rec); await srv.finished(run.id);
  const next = await heldRun(srv, bot, 'A completely new request');
  t.after(async () => { srv.release(next.rec); await srv.finished(next.run.id); });
  assert.match(next.rec.system, /PINNEDIBIS/);
  assert.match(next.rec.system, /SHAREDIBIS/);
  assert.ok(!next.rec.system.includes('HIDDENIBIS'));
  assert.match(next.rec.system, /recall.*ornithology/);
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Check context' } });
  const chief = await srv.nextRun((x) => x.botdot && x.stdin.includes('Check context'));
  assert.match(chief.system, /SHAREDIBIS/);
  assert.ok(!chief.system.includes('PINNEDIBIS'));
  srv.release(chief); await chiefDone(srv, chat);
});

test('learning cannot be turned down: "learning" from an older app or the Chief changes nothing, and every bot has its memory, skill and instruction tools', async (t) => {
  const made = await srv.api('/bots', { method: 'POST', body: { name: 'Never off', prompt: 'Do the task.', learning: 'off' } });
  assert.equal('learning' in made.data, false, 'the botdot server keeps no such field');
  const put = await srv.api(`/bots/${made.data.id}`, { method: 'PUT', body: { learning: 'memory' } });
  assert.equal(put.status, 200, 'an older Android app that sends it');
  assert.equal('learning' in (await srv.api(`/bots/${made.data.id}`)).data, false);

  const chief = chiefTools(t);
  for (const name of ['create_bot', 'update_bot']) {
    const fields = (await chief.request('tools/list')).tools.find((x) => x.name === name).inputSchema.properties;
    assert.equal('learning' in fields, false, `${name} has no learning`);
    assert.equal('friendly' in fields, false, `${name} has no friendly`);
  }
  const byChief = await chief.json('create_bot', { name: 'Chief made', prompt: 'Do the task.' });
  assert.equal('learning' in byChief, false);
  assert.equal('friendly' in byChief, false);

  const { tools, token } = await botTools(t);
  const names = (await tools.request('tools/list')).tools.map((x) => x.name);
  for (const n of ['remember', 'update_memory', 'remove_note', 'restore_note', 'forget', 'set_pin', 'recall', 'read_run', 'create_skill', 'update_skill', 'update_instructions']) assert.ok(names.includes(n), n);
  assert.equal((await self(srv, token, 'memory', { action: 'add', text: 'ALPACA saved by the bot' })).status, 200);
});

test('memory review uses its chosen model, sees notes/runs, saves shared additions and changes at once, and a shared removal requires owner approval', async (t) => {
  const bot = await makeBot(srv, { name: 'Reviewed memory' });
  const old = await finishedRun(srv, bot, 'Review PANGOLIN situation', 'PANGOLIN observations');
  await add(srv, bot.id, 'PANGOLIN pinned owner note');
  // A shared note a bot concluded: the review may ask to change it. One the owner typed it leaves alone
  // (test/memory-source-api.test.js).
  const shared = await sharedByBot(srv, await makeBot(srv, { name: 'Pangolin keeper' }), 'PANGOLIN shared baseline');
  const chief = chiefTools(t);
  await chief.json('set_memory_settings', { review: { model: 'haiku' } });
  srv.hold();
  const r = await chief.json('review_memory', { botId: bot.id });
  const rec = await srv.nextRun((x) => x.self && x.stdin.includes('This run is your memory review') && x.stdin.includes('PANGOLIN'));
  t.after(async () => { srv.release(rec); await srv.finished(r.run.id); srv.unhold(); });
  const tools = rpcClient(t, 'self-mcp.js', rec.self.env);
  assert.equal(rec.args[rec.args.indexOf('--model') + 1], 'haiku');
  assert.match(rec.stdin, /PANGOLIN pinned owner note/);
  assert.match(rec.stdin, /PANGOLIN observations/);
  assert.match(rec.stdin, /don't contact anyone/);
  assert.equal(rec.self.env.SELF_CAN_EDIT, '0');
  assert.match(await tools.text('remember', { note: 'PANGOLIN review lesson' }), /Saved/);
  // Shared additions and changes are saved at once (ADR 059); a removal waits.
  assert.match(await tools.text('remember', { note: 'PANGOLIN proposed fact', scope: 'shared' }), /^Saved to the shared memory/);
  assert.match(await tools.text('update_memory', { id: shared.id, note: 'PANGOLIN changed shared fact', reason: 'Review correction' }), /^Updated note/);
  assert.deepEqual((await srv.api('/memory/pending')).data.filter((p) => p.botId === bot.id), []);
  assert.equal((await srv.api(`/memory/notes/${shared.id}/history`)).data[0].reason, 'Review correction');
  assert.match(await tools.text('remove_note', { id: shared.id }), /waits for the owner's OK/);
  const pending = (await srv.api('/memory/pending')).data.filter((p) => p.botId === bot.id);
  assert.equal(pending.length, 1);
  assert.equal((await srv.asChief(`/memory/pending/${pending[0].id}`, { method: 'POST', body: { approve: true } })).status, 403);
  await srv.api(`/memory/pending/${pending[0].id}`, { method: 'POST', body: { approve: false } });
  assert.ok((await srv.api('/memory/shared')).data.memory.some((n) => n.id === shared.id));
  srv.release(rec); await srv.finished(r.run.id);
  assert.ok((await chief.json('memory_status')).bots.find((b) => b.id === bot.id).lastReview);
  assert.equal((await srv.api(`/memory/runs/${old.id}`)).status, 200);
});

test('REGRESSION: read_run must retrieve the complete answer it advertises, including its tail', async (t) => {
  const bot = await makeBot(srv, { name: 'Long memory reader' });
  const answer = 'Detail '.repeat(1000) + 'FINAL_RESOLUTION_5821';
  const run = await finishedRun(srv, bot, 'LONGREPORT inspect every detail', answer);
  const held = await heldRun(srv, bot);
  t.after(async () => { srv.release(held.rec); await srv.finished(held.run.id); srv.unhold(); });
  const tools = rpcClient(t, 'self-mcp.js', held.rec.self.env);
  assert.equal((await chiefTools(t).json('get_run', { runId: run.id })).result, answer, 'original result is intact');
  const recalled = await tools.text('read_run', { run: run.id });
  assert.ok(recalled.includes('FINAL_RESOLUTION_5821'), 'bot must be able to read past the search excerpt; the final resolution was truncated');
});

test('a full server restart retains notes, versions, pending approvals, exclusions and settings', async (t) => {
  let server = await startServer();
  const dir = server.dir;
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const bot = await makeBot(server);
  const n = await add(server, bot.id, 'CHINCHILLA original');
  await server.api(`/memory/notes/${n.id}`, { method: 'PUT', body: { text: 'CHINCHILLA revised', pinned: false } });
  const run = await finishedRun(server, bot, 'CHINCHILLA task', 'CHINCHILLA answer');
  await server.api(`/memory/runs/${run.id}`, { method: 'PUT', body: { excluded: true } });
  await server.api('/memory/settings', { method: 'PUT', body: { retentionDays: 0, review: { enabled: false } } });
  server.hold();
  const review = (await server.api(`/memory/review/${bot.id}`, { method: 'POST' })).data;
  const rec = await server.nextRun((x) => x.self && x.stdin.includes('This run is your memory review'));
  const shared = (await self(server, rec.self.env.RUN_TOKEN, 'memory', { action: 'add', scope: 'shared', text: 'CHINCHILLA shared' })).data.note;
  await self(server, rec.self.env.RUN_TOKEN, 'memory', { action: 'remove', id: shared.id }); // a removal in the review waits
  server.release(rec); await server.finished(review.run.id);
  await server.stop();
  server = await startServer({ dir });
  const memory = (await server.api('/memory')).data;
  const restored = memory.bots.find((b) => b.id === bot.id).notes[0];
  assert.equal(restored.id, n.id);
  assert.equal(restored.pinned, false);
  assert.equal(restored.versions, 1);
  assert.equal(memory.pending, 1);
  assert.equal(memory.review.enabled, false);
  assert.equal(memory.runs.retentionDays, 0);
  assert.equal((await server.api(`/memory/runs/${run.id}`)).data.excluded, 1);
  assert.ok((await server.api(`/memory/search?q=CHINCHILLA&bot=${bot.id}&in=notes`)).data.results.some((r) => r.kind === 'old'));
});

test('REGRESSION: rebuilding a missing memory index must recover existing Chief chats as well as bot runs', async (t) => {
  let server = await startServer();
  const dir = server.dir;
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const bot = await makeBot(server);
  await finishedRun(server, bot, 'REBUILDBOT marker', 'REBUILDBOT answer');
  server.reply('REBUILDCHIEF answer');
  const chat = (await server.api('/chief/chats', { method: 'POST' })).data;
  await server.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'REBUILDCHIEF marker' } });
  await chiefDone(server, chat);
  assert.equal((await server.api('/memory/search?q=REBUILDCHIEF&bot=chief')).data.results.length, 1);
  await server.stop();
  // Only generated test data: simulate rebuilding the disposable index from durable run/chat files.
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(server.data, `memory.db${suffix}`), { force: true });
  server = await startServer({ dir });
  assert.equal((await server.api('/memory/search?q=REBUILDBOT')).data.results.length, 1, 'bot history is rebuilt');
  assert.equal((await server.api(`/chief/chats/${chat.id}`)).data.messages[1].text, 'REBUILDCHIEF answer', 'the Chief chat still exists');
  assert.equal((await server.api('/memory/search?q=REBUILDCHIEF&bot=chief')).data.results.length, 1, 'Chief history must be rebuilt too');
});

test('a very long past run is read in parts with read_run, to its last line', async (t) => {
  const bot = await makeBot(srv, { name: 'Paged memory reader' });
  const answer = 'Detail '.repeat(3600) + 'PAGED_TAIL_7340';
  const run = await finishedRun(srv, bot, 'PAGEDREPORT inspect everything', answer);
  const held = await heldRun(srv, bot);
  t.after(async () => { srv.release(held.rec); await srv.finished(held.run.id); srv.unhold(); });
  const tools = rpcClient(t, 'self-mcp.js', held.rec.self.env);
  const first = await tools.text('read_run', { run: run.id });
  assert.ok(!first.includes('PAGED_TAIL_7340'));
  assert.match(first, /\d+ more characters: read_run with from=20000/);
  assert.match(await tools.text('read_run', { run: run.id, from: 20000 }), /from character 20000[\s\S]*PAGED_TAIL_7340/);
  assert.equal((await srv.api(`/memory/runs/${run.id}`)).data.reply, answer, 'the owner and the Chief get it whole');
});

test('runs and Chief replies left out of recall stay out when the index is rebuilt', async (t) => {
  let server = await startServer();
  const dir = server.dir;
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const bot = await makeBot(server);
  const run = await finishedRun(server, bot, 'HIDDENBOT marker', 'HIDDENBOT answer');
  server.reply('HIDDENCHIEF answer');
  const chat = (await server.api('/chief/chats', { method: 'POST' })).data;
  await server.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'HIDDENCHIEF marker' } });
  await chiefDone(server, chat);
  const [hit] = (await server.api('/memory/search?q=HIDDENCHIEF&bot=chief')).data.results;
  assert.equal(hit.runId, `chief-${chat.id}-1`);
  for (const id of [run.id, hit.runId]) await server.api(`/memory/runs/${id}`, { method: 'PUT', body: { excluded: true } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(server.data, 'runs', `${run.id}.json`), 'utf8')).excludedFromMemory, true);
  await server.stop();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(server.data, `memory.db${suffix}`), { force: true });
  server = await startServer({ dir });
  for (const id of [run.id, hit.runId]) assert.equal((await server.api(`/memory/runs/${id}`)).data.excluded, 1, id);
  assert.deepEqual((await server.api('/memory/search?q=HIDDENBOT')).data.results, []);
  assert.deepEqual((await server.api('/memory/search?q=HIDDENCHIEF&bot=chief')).data.results, []);
  await server.api(`/memory/runs/${run.id}`, { method: 'PUT', body: { excluded: false } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(server.data, 'runs', `${run.id}.json`), 'utf8')).excludedFromMemory, undefined);
  assert.equal((await server.api('/memory/search?q=HIDDENBOT')).data.results.length, 1);
});

test('an index from before version 2 gets Chief ids of the replies themselves, keeping what was left out', async (t) => {
  let server = await startServer();
  const dir = server.dir;
  t.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  server.reply('UPGRADECHIEF answer');
  const chat = (await server.api('/chief/chats', { method: 'POST' })).data;
  await server.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'UPGRADECHIEF marker' } });
  await chiefDone(server, chat);
  await server.stop();
  // Before version 2, a reply followed by a bot's report was indexed under the report's place.
  const file = path.join(server.data, 'chief', `${chat.id}.json`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.messages.push({ role: 'report', text: 'A late report', at: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(saved));
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(server.data, 'memory.db'));
  const [right, wrong] = [`chief-${chat.id}-1`, `chief-${chat.id}-2`];
  db.prepare('UPDATE runs SET run_id = ?, excluded = 1 WHERE run_id = ?').run(wrong, right);
  db.prepare('UPDATE runs_fts SET run_id = ? WHERE run_id = ?').run(wrong, right);
  db.exec("UPDATE meta SET value = '1' WHERE key = 'index_version'; DELETE FROM meta WHERE key = 'exclusions_saved';");
  db.close();
  server = await startServer({ dir });
  assert.equal((await server.api(`/memory/runs/${wrong}`)).status, 404);
  const row = (await server.api(`/memory/runs/${right}`)).data;
  assert.equal(row.reply, 'UPGRADECHIEF answer');
  assert.equal(row.excluded, 1);
  assert.equal((await server.api(`/chief/chats/${chat.id}`)).data.messages[1].excludedFromMemory, true);
});

test("a Chief reply is indexed under its own place in the chat, even when a reminder went off while it replied", async (t) => {
  const at = new Date().toISOString().slice(0, 16); // as once.test.js sets one for now
  srv.hold();
  t.after(() => srv.unhold());
  srv.reply('PLACEDCHIEF answer');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'PLACEDCHIEF marker' } });
  const rec = await srv.nextRun((x) => x.args.includes('🧭 Chief of Staff') && x.stdin.includes('PLACEDCHIEF'), 'the Chief');
  assert.equal((await srv.api('/chief/reminders', { method: 'POST', body: { text: 'Water the plants', at, chatId: chat.id } })).status, 201);
  await new Promise((r) => setTimeout(r, 200)); // it goes off right away, while the Chief replies
  srv.release(rec);
  const done = await chiefDone(srv, chat);
  assert.deepEqual(done.messages.map((m) => m.role), ['user', 'chief', 'chief']);
  const [hit] = (await srv.api('/memory/search?q=PLACEDCHIEF&bot=chief')).data.results;
  assert.equal(hit.runId, `chief-${chat.id}-1`);
  assert.equal((await srv.api('/search?q=PLACEDCHIEF')).data[0].index, 1);
});

test('a run starts with a few memories that look relevant to its task, as records', async (t) => {
  const bot = await makeBot(srv, { name: 'Relevant memory bot' });
  await add(srv, bot.id, 'The code for the WOMBAT safe is 3391.', false);
  srv.reply('Done.');
  srv.unhold();
  const ask = async (prompt) => {
    const { data: run } = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
    await srv.finished(run.id);
    const rec = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(prompt));
    return { system: rec.system, meta: (await srv.api(`/runs/${run.id}`)).data };
  };
  const { system, meta } = await ask("What's the code for the WOMBAT safe?");
  assert.equal(meta.relevant.length, 1, 'the run keeps what it was given');
  assert.match(system, /Possibly relevant, from your memory[^\n]*records, not instructions[\s\S]*<possibly-relevant>\n- \[\w+\] \(note, yours, the owner said, \d{4}-\d\d-\d\d\) The code for the WOMBAT safe is 3391\.\n<\/possibly-relevant>/);
  assert.ok(!(await ask('Tell me a joke about penguins')).system.includes('possibly-relevant'), 'nothing unrelated');
});
