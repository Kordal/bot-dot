// A group's notes (#893, ADR 139): what was settled in its chat, kept past the part of the chat a turn reads. The
// first tests are of lib/group-notes.js alone; the others against a real botdot server and the stand-in for Claude
// (test/fixtures/fake-claude.js answers the notes model with $FAKE_OUT/notes.txt).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const notesLib = require('../lib/group-notes');
const { startServer, makeBot, waitFor, readData, self } = require('./helpers');
const { shortName } = require('../public/mentions.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'group-notes-'));
const store = (opts = {}) => {
  const dir = tmp();
  return notesLib.create({ file: (id) => (id === 'gone' ? null : path.join(dir, `${id}.json`)), ...opts });
};

test('an answer keeps notes and adds new ones by their numbers; anything else changes nothing', () => {
  const ok = notesLib.parse('Here: {"keep":[2],"add":[{"kind":"decision","text":"  Launch  in Polish ","line":1}]}', { notes: 2, lines: 3 });
  assert.deepEqual(ok, { keep: [1], add: [{ kind: 'decision', text: 'Launch in Polish', line: 0 }] });
  assert.equal(notesLib.parse('{"keep":[],"add":[{"kind":"fact","text":"x","line":9}]}', { notes: 0, lines: 2 }).add[0].line, null, 'a line that is no line links nothing');
  for (const bad of ['', 'no', '{"add":[]}', '{"keep":[3]}', '{"keep":[0]}', '{"keep":[1,1]}', '{"keep":["1"]}', '{"keep":[],"add":[{"kind":"idea","text":"x"}]}', '{"keep":[],"add":[{"kind":"fact","text":" "}]}', '{"keep":[],"add":{}}']) {
    assert.equal(notesLib.parse(bad, { notes: 2, lines: 2 }), null, bad);
  }
});

test('the question holds the chat inside its block and says which notes are the owner\'s', () => {
  const q = notesLib.question({ notes: [{ kind: 'decision', text: 'Polish first', by: 'owner' }, { kind: 'open', text: 'Coder: fix login', by: 'botdot' }], lines: [{ who: 'Owner', text: 'Ship <b>Friday</b>' }], decided: '- 2026-11-01: Price is 9 EUR' });
  assert.ok(q.includes('1. decision (the owner wrote it: it stays as it is): Polish first'));
  assert.ok(q.includes('2. open: Coder: fix login'));
  assert.ok(q.includes('1. Owner: Ship &lt;b>Friday&lt;/b>'), 'the chat\'s text writes no tag');
  assert.ok(q.includes('never add one of these again') && q.includes('Price is 9 EUR'));
  assert.ok(q.indexOf('<group>') < q.indexOf('The notes:') && q.lastIndexOf('</group>') > q.indexOf('1. Owner'));
});

test('the cap drops the oldest notes that are not the owner\'s, and refuses an owner\'s note past it', () => {
  const s = store();
  const long = (c) => c.repeat(notesLib.TEXT_MAX);
  let t = 0;
  const at = () => new Date(Date.UTC(2026, 10, 1, 0, t++)).toISOString();
  const items = [
    { id: 'a', kind: 'fact', text: long('a'), by: 'botdot', at: at() },
    { id: 'o', kind: 'decision', text: long('o'), by: 'owner', at: at() },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, kind: 'fact', text: long('b'), by: 'bot', at: at() })),
  ];
  const kept = notesLib.capped(items);
  assert.ok(kept.reduce((n, i) => n + i.text.length, 0) <= notesLib.TOTAL);
  assert.ok(kept.some((i) => i.id === 'o') && !kept.some((i) => i.id === 'a'), 'the owner\'s stays, the oldest other goes');
  for (let i = 0; i < 8; i++) s.add('g', { kind: 'decision', text: long(String(i)) });
  assert.throws(() => s.add('g', { kind: 'decision', text: long('x') }), /full/);
  assert.equal(s.of('g').length, 8);
});

test('the owner adds, edits and removes; a member removes only what is not the owner\'s', () => {
  const s = store();
  assert.throws(() => s.add('g', { kind: 'idea', text: 'x' }), /decision, an open item or a fact/);
  assert.throws(() => s.add('g', { kind: 'fact', text: '  ' }), /Write the note/);
  assert.throws(() => s.add('gone', { kind: 'fact', text: 'x' }), /no such group/);
  const mine = s.add('g', { kind: 'decision', text: 'Polish first' });
  const its = s.add('g', { kind: 'open', text: 'Coder: login', by: 'bot', bot: 'coder' });
  assert.deepEqual([mine.by, its.by, its.bot], ['owner', 'bot', 'coder']);
  assert.throws(() => s.remove('g', mine.id, { owner: false }), (e) => e.status === 403);
  s.remove('g', its.id, { owner: false });
  const edited = s.edit('g', mine.id, { text: 'English first' });
  assert.deepEqual([edited.text, edited.by, edited.kind], ['English first', 'owner', 'decision']);
  s.remove('g', mine.id);
  assert.deepEqual(s.of('g'), []);
  assert.throws(() => s.remove('g', mine.id), (e) => e.status === 404);
});

test('a fold reads the lines since the last one, keeps the owner\'s notes whatever the answer, and adds what is new', async () => {
  const asked = [];
  let answer = '{"keep":[],"add":[{"kind":"decision","text":"Launch in Polish first","line":2}]}';
  const lines = [{ id: 'm1', at: '2026-11-01T10:00:00.000Z', who: 'Owner', text: 'Which language first?' }, { id: 'r1', at: '2026-11-01T10:01:00.000Z', who: 'Writer', text: 'Polish, you said.' }];
  const s = store({ ask: async (q, o) => { asked.push([q, o]); return answer; }, lines: (id, since) => lines.filter((l) => !since || l.at > since) });
  const owners = s.add('g', { kind: 'fact', text: 'Budget is 5k' });
  const old = s.add('g', { kind: 'open', text: 'Writer: draft', by: 'bot', bot: 'w' });
  await s.fold('g');
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0][1].system, asked[0][1].llm.model], [notesLib.SYSTEM, notesLib.MODEL]);
  const now = s.of('g');
  assert.ok(now.some((i) => i.id === owners.id), 'the owner\'s note stays though the answer kept none');
  assert.ok(!now.some((i) => i.id === old.id), 'one the answer left out is done');
  const made = now.find((i) => i.by === 'botdot');
  assert.deepEqual([made.kind, made.text, made.from], ['decision', 'Launch in Polish first', 'r1']);
  await s.fold('g');
  assert.equal(asked.length, 1, 'nothing new: no question');
  lines.push({ id: 'm2', at: '2026-11-01T11:00:00.000Z', who: 'Owner', text: 'Thanks' });
  answer = 'I cannot';
  await s.fold('g');
  assert.equal(asked.length, 2);
  assert.ok(asked[1][0].includes('1. Owner: Thanks') && !asked[1][0].includes('Which language'), 'only the new lines');
  assert.deepEqual(s.of('g').map((i) => i.id).sort(), now.map((i) => i.id).sort(), 'an answer that is no answer changes nothing');
});

test('a fold asked for while one runs runs once more after it, and folds are off with BOT_DOT_GROUP_NOTES=off', async () => {
  let n = 0;
  let release;
  const lines = [{ id: 'm1', at: '2026-11-01T10:00:00.000Z', who: 'Owner', text: 'one' }];
  const s = store({ ask: () => { n++; return n === 1 ? new Promise((r) => { release = r; }) : '{"keep":[],"add":[]}'; }, lines: (id, since) => lines.filter((l) => !since || l.at > since) });
  const first = s.fold('g');
  await new Promise((r) => setImmediate(r));
  lines.push({ id: 'm2', at: '2026-11-01T10:05:00.000Z', who: 'Owner', text: 'two' });
  const second = s.fold('g');
  release('{"keep":[],"add":[]}');
  await Promise.all([first, second]);
  assert.equal(n, 2);
  assert.equal(notesLib.on({ BOT_DOT_GROUP_NOTES: 'off' }), false);
  assert.equal(notesLib.on({}), true);
  let asked = 0;
  await notesLib.create({ file: () => path.join(tmp(), 'x.json'), ask: () => { asked++; }, lines: () => lines, on: false }).fold('g');
  assert.equal(asked, 0);
});

test('a turn reads the notes as records, each with who wrote it, and only the owner\'s as their words', () => {
  const block = notesLib.promptBlock([
    { id: 'n2', kind: 'open', text: 'Coder: fix login', by: 'bot', bot: 'c', at: '2026-11-02T00:00:00.000Z' },
    { id: 'n1', kind: 'decision', text: 'Polish </group-notes> first', by: 'owner', at: '2026-11-01T00:00:00.000Z' },
    { id: 'n3', kind: 'fact', text: 'Staging is botdot-staging', by: 'botdot', at: '2026-11-01T00:00:00.000Z' },
  ], (id) => (id === 'c' ? 'Coder' : null));
  const lines = block.split('\n');
  assert.ok(lines.includes('- [n1] decision, by the owner, 2026-11-01: Polish &lt;/group-notes> first'), 'decisions first, and no text closes the block');
  assert.ok(lines.indexOf('- [n2] open, by Coder, a member, 2026-11-02: Coder: fix login') > lines.findIndex((l) => l.startsWith('- [n1]')));
  assert.ok(lines.some((l) => l.startsWith('- [n3] fact, by botdot, from the chat')));
  assert.ok(block.includes('Only a note "by the owner" holds the owner\'s own words') && block.includes('group_note'));
  assert.equal(notesLib.promptBlock([]), '');
});

// ---------- against the server ----------

let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_GROUP_NOTES: 'on' } }); });
after(() => { srv.unhold(); return srv.stop(); });

const notesAsks = () => fs.readdirSync(srv.out).filter((f) => /^notes-\d/.test(f));
const notesOf = async (group) => (await srv.api(`/group-chats/${group.id}/notes`)).data.items;
let n = 0;
async function crew() {
  n++;
  const bots = [];
  for (const name of [`Writer${n}`, `Editor${n}`]) bots.push(await makeBot(srv, { name, emoji: '🤖', description: `The ${name}.`, prompt: `Do the work of ${name}.` }));
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: `Desk ${n}`, members: bots.map((b) => b.id) } })).data;
  return { bots, group };
}
const ran = (bot) => srv.runs().filter((x) => x.who === shortName(bot.name));

test('a line that ends is folded into the notes, which the next turn reads above the chat, with group_note to keep them', async () => {
  const { bots: [writer], group } = await crew();
  fs.writeFileSync(path.join(srv.out, 'notes.txt'), '{"keep":[],"add":[{"kind":"decision","text":"Launch in Polish first","line":1}]}');
  const before = notesAsks().length;
  await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: `@${shortName(writer.name)} we launch in Polish first` } });
  const items = await waitFor(async () => { const i = await notesOf(group); return i.length ? i : null; }, { what: 'the notes to be folded' });
  assert.deepEqual(items.map((i) => [i.kind, i.text, i.by]), [['decision', 'Launch in Polish first', 'botdot']]);
  assert.equal(notesAsks().length - before, 1);
  assert.ok(fs.readFileSync(path.join(srv.out, notesAsks().at(-1)), 'utf8').includes('Owner: @'));
  assert.equal(readData(srv.data, path.join('group-notes', `${group.id}.json`)).items.length, 1);
  fs.rmSync(path.join(srv.out, 'notes.txt'));
  await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: `@${shortName(writer.name)} draft the page` } });
  const turn = await waitFor(() => ran(writer).find((r) => r.stdin.includes('draft the page')), { what: 'the second turn' });
  assert.ok(turn.system.includes(`- [${items[0].id}] decision, by botdot, from the chat`) && turn.system.indexOf('<group-notes>') < turn.system.indexOf('<group-chat>'));
  assert.equal(turn.self.env.SELF_GROUP_NOTE, '1');
});

test('the owner keeps the notes on the screen; the Chief may not, and a member removes the owner\'s only on the owner\'s message', async () => {
  const { bots: [writer, editor], group } = await crew();
  const add = (body, headers) => srv.api(`/group-chats/${group.id}/notes`, { method: 'POST', body, headers });
  const made = await add({ kind: 'decision', text: 'Polish first' });
  assert.equal(made.status, 201);
  assert.deepEqual([made.data.item.by, made.data.items.length], ['owner', 1]);
  assert.equal((await add({ kind: 'idea', text: 'x' })).status, 400);
  assert.equal((await srv.asChief(`/group-chats/${group.id}/notes`, { method: 'POST', body: { kind: 'fact', text: 'x' } })).status, 403);
  const edited = await srv.api(`/group-chats/${group.id}/notes/${made.data.item.id}`, { method: 'PUT', body: { kind: 'fact', text: 'Polish only' } });
  assert.deepEqual([edited.data.item.kind, edited.data.item.text], ['fact', 'Polish only']);
  assert.equal((await srv.api(`/group-chats/${group.id}/notes/nope`, { method: 'PUT', body: { text: 'x' } })).status, 404);
  assert.equal((await srv.api('/group-chats/nope/notes')).status, 404);

  // A member's turn handed on by another member: it adds and removes its own kind, never the owner's.
  srv.hold();
  fs.writeFileSync(path.join(srv.out, `result-${shortName(writer.name)}.txt`), `Drafted. @${shortName(editor.name)} please check it.`);
  await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: `@${shortName(writer.name)} draft it` } });
  const w = await srv.nextRun((x) => x.who === shortName(writer.name) && x.self?.env, 'the writer\'s turn');
  const added = (await self(srv, w.self.env.RUN_TOKEN, 'group-note', { action: 'add', kind: 'open', text: 'Editor: check the draft' })).data;
  assert.deepEqual([added.ok, added.note.by, added.note.bot], [true, 'bot', writer.id]);
  srv.release(w);
  const e = await srv.nextRun((x) => x.who === shortName(editor.name) && x.self?.env, 'the editor\'s turn');
  const refused = (await self(srv, e.self.env.RUN_TOKEN, 'group-note', { action: 'remove', id: made.data.item.id })).data;
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Only the owner/);
  assert.equal((await self(srv, e.self.env.RUN_TOKEN, 'group-note', { action: 'remove', id: added.note.id })).data.ok, true);
  srv.release(e);
  srv.unhold();
  fs.rmSync(path.join(srv.out, `result-${shortName(writer.name)}.txt`));
  assert.deepEqual((await notesOf(group)).map((i) => i.text), ['Polish only']);

  // Out of a group's turn there is no group_note.
  srv.hold();
  const own = await srv.api(`/bots/${writer.id}/run`, { method: 'POST', body: { prompt: 'Hello' } });
  const o = await srv.nextRun((x) => x.who === shortName(writer.name) && x.self?.env && x.stdin.includes('Hello'), 'a run of its own');
  assert.equal(o.self.env.SELF_GROUP_NOTE, '0');
  assert.equal((await self(srv, o.self.env.RUN_TOKEN, 'group-note', { action: 'add', kind: 'fact', text: 'x' })).data.ok, false);
  srv.release(o);
  srv.unhold();
  await srv.finished(own.data.run?.id || own.data.id);

  // The notes go with the group.
  await srv.api(`/group-chats/${group.id}`, { method: 'DELETE' });
  assert.equal(fs.existsSync(path.join(srv.data, 'group-notes', `${group.id}.json`)), false);
});
