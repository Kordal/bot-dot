// Forget erases, and a removed note ends (ADR 016): against the store and the pure functions, with no server.
// The erase and what it leaves, "left out" and its readers in the store, what a run learned as kinds and ids, the
// one rebuild of the index, the 30 days of a removed note, a note's end, a deleted bot, the audit lines, the chips.
// The routes, the tools and the Chief's readers are in test/memory-forget-api.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { scratchMemory, runMeta, daysAgo } = require('./memory-helpers');
const memoryLib = require('../lib/memory');
const { learnedView, learnedViews, chipOf, waitingChip, cardOf, answerOf, forgotChip, SAY } = require('../lib/learning');
const { noteLine, dayOf, dayWords, MEMORY_RULE } = require('../lib/prompt-text');
const chatHistory = require('../lib/chat-history');
const look = require('../lib/look');

const SHARED = memoryLib.SHARED;
const recall = (m, query, opts = {}) => m.search({ query, notesOf: ['alpha', SHARED], runsOf: ['alpha'], ...opts });
// Every table of the store that could hold a note's text, read as it is on disk.
function everywhere(dir, word) {
  const db = new DatabaseSync(path.join(dir, 'memory.db'));
  const found = [];
  for (const [table, columns] of [['notes', 'text, topic'], ['notes_fts', 'text, topic'], ['note_versions', 'text, topic, reason'], ['versions_fts', 'text'], ['pending', 'text, topic, reason, detail'], ['runs', 'learned'], ['runs_fts', 'learned'], ['erasing', 'notes, runs']]) {
    for (const row of db.prepare(`SELECT ${columns} FROM ${table}`).all()) if (JSON.stringify(row).toLowerCase().includes(word.toLowerCase())) found.push(table);
  }
  db.close();
  return [...new Set(found)];
}
const count = (dir, sql, ...args) => { const db = new DatabaseSync(path.join(dir, 'memory.db')); const n = db.prepare(sql).get(...args).n; db.close(); return n; };
// A clock a test moves: the store reads the day and the time from it.
function clockAt(iso) { const c = { now: new Date(iso) }; c.fn = () => new Date(c.now); c.set = (to) => { c.now = new Date(to); }; return c; }
const day = (d) => dayOf(d);
const plusDays = (d, n) => new Date(new Date(d).getTime() + n * 864e5);

// ---------- forget ----------

test('a forget deletes the note, every version of it, its search rows, its vectors and its waiting changes, and leaves the runs that wrote it out', async (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const first = runMeta({ prompt: 'My dentist is Dr Zebrowska', result: 'Noted.' });
  const second = runMeta({ prompt: 'Actually the dentist is Dr Zebrowska-Nowak', result: 'Updated.' });
  const other = runMeta({ prompt: 'What is the weather', result: 'Sunny.' });
  for (const r of [first, second, other]) m.indexRun(r);
  const n = m.addNote('alpha', 'The dentist is Dr Zebrowska', { runId: first.id, source: 'owner' }).note;
  m.editNote('alpha', n.id, 'The dentist is Dr Zebrowska-Nowak', { runId: second.id, reason: 'corrected' });
  const kept = m.addNote('alpha', 'Prefers tea').note;
  m.propose({ action: 'edit', owner: 'alpha', noteId: n.id, text: 'The dentist is Dr Zebrowska of Gdansk', by: 'bot', runId: 'r9', botId: 'alpha' });
  // Vectors as meaning search keeps them: of the note, of its earlier version, of the runs.
  const vid = m.history(n.id)[0].vid;
  const db = new DatabaseSync(path.join(dir, 'memory.db'));
  for (const [kind, ref] of [['note', n.id], ['old', String(vid)], ['run', first.id], ['part', `${first.id}:0`], ['run', other.id], ['note', kept.id]]) db.prepare('INSERT OR REPLACE INTO embeddings (kind, ref, model, vec) VALUES (?, ?, ?, ?)').run(kind, ref, 'bge-m3', Buffer.alloc(8));
  db.close();
  assert.deepEqual(everywhere(dir, 'zebrowska').sort(), ['note_versions', 'notes', 'notes_fts', 'pending', 'versions_fts']);

  const done = m.erase({ notes: [n.id] });
  assert.deepEqual(done.erased, [n.id]);
  assert.deepEqual(done.leftOut.sort(), [first.id, second.id].sort(), 'the runs that wrote it, the earlier text too');
  assert.deepEqual(everywhere(dir, 'zebrowska'), [], 'in no table');
  assert.equal(m.getNote(n.id), undefined);
  assert.deepEqual(m.history(n.id), []);
  assert.deepEqual(m.pending(), []);
  assert.equal(count(dir, "SELECT COUNT(*) AS n FROM embeddings WHERE ref IN (?, ?, ?, ?)", n.id, String(vid), first.id, `${first.id}:0`), 0, 'its vectors, and those of the runs left out');
  assert.equal(count(dir, 'SELECT COUNT(*) AS n FROM embeddings'), 2, 'nothing else lost its vector');
  assert.ok(m.leftOut(first.id) && m.leftOut(second.id) && !m.leftOut(other.id));
  assert.equal(m.getNote(kept.id).text, 'Prefers tea');
  assert.equal(count(dir, 'SELECT COUNT(*) AS n FROM erasing'), 0, 'the erase is complete');
  assert.ok(m.forgottenNote(n.id), 'the id is remembered, without a text');
});

test('one function answers "left out": for a record, an entry of the index and an id, for the owner\'s mark and for a forget', (t) => {
  const { memory: m } = scratchMemory(t);
  const a = runMeta();
  const b = runMeta();
  const c = runMeta();
  for (const r of [a, b, c]) m.indexRun(r);
  assert.equal(m.leftOut(a.id), false);
  assert.equal(m.leftOut(null), false);
  assert.equal(m.leftOut({ id: 'nowhere' }), false);
  assert.equal(m.leftOut({ id: 'x', excludedFromMemory: true }), true, "the owner's mark in a run's record");
  assert.equal(m.leftOut({ id: 'x', forgotten: true }), true, "a forget's mark in a run's record");
  m.setExcluded(a.id, true);
  assert.deepEqual([m.leftOut(a.id), m.leftOut(m.getRun(a.id)), m.leftOut({ id: a.id })], [true, true, true]);
  m.erase({ runs: [b.id] });
  assert.deepEqual([m.leftOut(b.id), m.leftOut(m.getRun(b.id)), m.leftOut({ id: b.id })], [true, true, true], 'whatever its file says');
  // The owner takes their own mark back; a forget's stays.
  m.setExcluded(a.id, false);
  m.setExcluded(b.id, false);
  assert.deepEqual([m.leftOut(a.id), m.leftOut(b.id)], [false, true]);
  // A run not in the index (older than what is kept searchable) that a forget named is left out all the same.
  m.erase({ runs: ['pruned-long-ago'] });
  assert.equal(m.leftOut({ id: 'pruned-long-ago', result: 'text' }), true);
  // No rebuild of the index brings a forgotten run back.
  m.indexRun({ ...b, result: 'Indexed again' });
  assert.equal(m.leftOut(b.id), true);
  assert.deepEqual(m.forgottenRuns().sort(), [b.id, 'pruned-long-ago'].sort());
});

test('left out, in recall with history: neither the run nor a section of it is found', async (t) => {
  const { memory: m } = scratchMemory(t);
  const long = `${'Filler sentence about nothing. '.repeat(120)}The WOMBAT clinic is on Elm Street.`;
  const r = runMeta({ prompt: 'Where is the wombat clinic', result: long });
  const still = runMeta({ prompt: 'A wombat fact', result: 'Wombats are marsupials.' });
  m.indexRun(r);
  m.indexRun(still);
  assert.deepEqual((await recall(m, 'wombat clinic elm', { history: true })).map((x) => x.runId).sort(), [r.id, still.id].sort());
  m.erase({ runs: [r.id] });
  assert.deepEqual((await recall(m, 'wombat clinic elm', { history: true })).map((x) => x.runId), [still.id]);
  assert.deepEqual((await recall(m, '', { kinds: ['runs'] })).map((x) => x.runId), [still.id], 'nor among the newest');
});

test('left out, in the lookup before a run', async (t) => {
  const { memory: m } = scratchMemory(t);
  const r = runMeta({ prompt: 'Notes on the OCELOT migration', result: 'The ocelot migration moves the billing tables.', startedAt: daysAgo(10) });
  m.indexRun(r);
  const ask = { botId: 'alpha', text: 'Continue the ocelot migration' };
  assert.deepEqual((await m.relevantFor(ask)).map((x) => x.runId), [r.id]);
  m.erase({ runs: [r.id] });
  assert.deepEqual(await m.relevantFor(ask), []);
});

test("left out, in the review's list of recent runs", (t) => {
  const { memory: m } = scratchMemory(t);
  const a = runMeta({ startedAt: daysAgo(1) });
  const b = runMeta({ startedAt: daysAgo(2) });
  const c = runMeta({ startedAt: daysAgo(3) });
  for (const r of [a, b, c]) m.indexRun(r);
  m.erase({ runs: [b.id] });
  m.setExcluded(c.id, true);
  assert.deepEqual(m.runsSince('alpha', '').map((r) => r.run_id), [a.id]);
  assert.equal(m.countRunsSince('alpha', ''), 1);
});

test('left out, in the conversation block and for a tapped answer', () => {
  const now = Date.now();
  const at = (min) => new Date(now - min * 60_000).toISOString();
  const run = (id, min, extra = {}) => ({ id, botId: 'alpha', status: 'success', trigger: 'manual', customPrompt: true, prompt: `question ${id}`, result: `answer ${id}`, startedAt: at(min), ...extra });
  const runs = [run('new', 1, { choices: ['Yes', 'No'] }), run('secret', 2), run('marked', 3, { forgotten: true }), run('old', 4)];
  // The store's function knows a forget whose mark has not reached the run's file; the record's own marks count too.
  const leftOut = (m) => m.id === 'secret' || !!m.excludedFromMemory || !!m.forgotten;
  const block = chatHistory.build(runs, { now, leftOut });
  assert.deepEqual(block.match(/^\[run (\w+)/gm), ['[run old', '[run new']);
  assert.ok(!block.includes('answer secret') && !block.includes('question secret') && !block.includes('answer marked'));
  assert.deepEqual(chatHistory.build(runs, { now }).match(/^\[run (\w+)/gm), ['[run old', '[run secret', '[run new'], 'without the function a record\'s own marks decide');
  assert.equal(chatHistory.answered(runs, 'yes', { leftOut }), 'new');
  assert.equal(chatHistory.answered(runs, 'yes', { leftOut: (m) => m.id === 'new' }), null, 'a tap under a left-out reply answers nothing');
});

test("left out, in the look's digest: a bot's result, a reply of the Chief's with the message it answered, and nothing else", () => {
  const chat = {
    id: 'c1', title: 'Planning', updatedAt: '2026-10-07T10:00:00.000Z',
    messages: [
      { role: 'user', text: 'What did the dentist bot find?' },
      { role: 'chief', text: 'It found the ZEBROWSKA appointment.' },
      { role: 'report', from: { name: 'Dentist Bot' }, runId: 'r-secret', text: 'ZEBROWSKA on Friday at 9' },
      { role: 'user', text: 'And the weather?' },
      { role: 'chief', text: 'Sunny all week.' },
      { role: 'report', from: { name: 'Weather Bot' }, runId: 'r-fine', text: 'Sunny' },
      { role: 'chief', unasked: true, text: 'A tip about ZEBROWSKA', excludedFromMemory: true },
    ],
  };
  // The one function is asked: with a run's id for a bot's result, with the reply's record for a reply of the Chief's.
  const asked = [];
  const leftOut = (run) => { asked.push(run); return run === 'r-secret' || run?.id === 'chief-c1-1' || !!run?.excludedFromMemory; };
  assert.deepEqual([...look.leftOutIn(chat, leftOut)].sort(), [0, 1, 2, 6]);
  assert.deepEqual(asked, [{ id: 'chief-c1-1', excludedFromMemory: false, forgotten: false }, 'r-secret', { id: 'chief-c1-4', excludedFromMemory: false, forgotten: false }, 'r-fine', { id: 'chief-c1-6', excludedFromMemory: true, forgotten: false }], 'every bot result and every reply of the Chief, once');
  const told = look.digest([chat], { leftOut });
  assert.ok(!/zebrowska|dentist bot find/i.test(told), told);
  assert.match(told, /Owner: And the weather\?\nYou: Sunny all week\.\nWeather Bot \(a bot\): Sunny$/);
  assert.match(look.digest([chat]), /ZEBROWSKA on Friday/, 'without a left-out run the digest is as before');
  assert.match(look.prompt({ now: new Date('2026-10-07T12:00:00Z'), timeZone: 'UTC', chats: [chat], leftOut }), /Sunny all week/);
  assert.doesNotMatch(look.prompt({ now: new Date('2026-10-07T12:00:00Z'), timeZone: 'UTC', chats: [chat], leftOut }), /ZEBROWSKA on Friday|It found the ZEBROWSKA/);
});

test("a left-out run is still in the owner's search over all chats", (t) => {
  const { memory: m } = scratchMemory(t);
  const r = runMeta({ prompt: 'My dentist is Dr Zebrowska', result: 'Noted.' });
  m.indexRun(r);
  m.erase({ runs: [r.id] });
  assert.deepEqual(m.searchChats('zebrowska').map((h) => h.runId), [r.id]);
  m.indexRun({ ...r, result: 'Noted again.' });
  assert.deepEqual(m.searchChats('zebrowska').map((h) => h.runId), [r.id], 'after it is indexed again too');
});

test('the answer names what still matches, a second call takes those too, and a forget of what was said only in chat erases no note', (t) => {
  const { memory: m } = scratchMemory(t);
  const wrote = runMeta({ prompt: 'I am seeing a therapist on Tuesdays', result: 'Saved.' });
  const chat = runMeta({ prompt: 'Move my therapist appointment to Wednesday', result: 'Done, the therapist is now on Wednesday.' });
  const fine = runMeta({ prompt: 'Book a table for two', result: 'Booked.' });
  const asking = runMeta({ prompt: 'Forget what I told you about my therapist', status: 'success', result: 'Forgotten.' });
  for (const r of [wrote, chat, fine, asking]) m.indexRun(r);
  const a = m.addNote('alpha', 'Sees a therapist on Tuesdays', { runId: wrote.id, source: 'owner' }).note;
  const b = m.addNote(SHARED, 'The therapist is Dr Lind', { source: 'bot' }).note;
  const gone = m.addNote('alpha', 'Therapist appointments are private').note;
  m.removeNote('alpha', gone.id, { by: 'bot' });
  m.addNote('alpha', 'Prefers window seats');
  const where = { about: 'therapist', owners: ['alpha', SHARED], runsOf: ['alpha'], not: [asking.id] };

  const first = m.erase({ notes: [a.id], runs: [asking.id] });
  assert.deepEqual([first.erased, first.leftOut.sort()], [[a.id], [wrote.id, asking.id].sort()]);
  const still = m.stillMatching(where);
  assert.deepEqual(still.notes.map((n) => [n.id, !!n.removed]).sort(), [[b.id, false], [gone.id, true]].sort(), 'a shared note, and a removed one');
  assert.deepEqual(still.runs.map((r) => r.runId), [chat.id], 'a chat that holds it; not the asking run, not one already left out');

  const second = m.erase({ notes: still.notes.map((n) => n.id), runs: still.runs.map((r) => r.runId) });
  assert.deepEqual([second.erased.sort(), second.leftOut], [[b.id, gone.id].sort(), [chat.id]]);
  assert.deepEqual(m.stillMatching(where), { notes: [], runs: [] });
  assert.equal(m.leftOut(fine.id), false);

  // Said only in chat: the runs are left out, and no note is erased.
  const said = runMeta({ prompt: 'My locker code is 4417', result: 'OK.' });
  m.indexRun(said);
  const notes = m.notesOf('alpha').length;
  assert.deepEqual(m.erase({ runs: [said.id] }), { erased: [], leftOut: [said.id] });
  assert.equal(m.notesOf('alpha').length, notes);
  assert.deepEqual(m.stillMatching({ about: '', owners: ['alpha'], runsOf: ['alpha'] }), { notes: [], runs: [] }, 'no words, nothing to match');
});

test('an erase botdot was stopped in the middle of is completed at the next start: no reader finds a part of the note', async (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const wrote = runMeta({ prompt: 'The alarm code is 7731 KESTREL', result: 'Saved.' });
  m.indexRun(wrote);
  const n = m.addNote('alpha', 'The alarm code is KESTREL', { runId: wrote.id }).note;
  m.editNote('alpha', n.id, 'The alarm code is KESTREL 7731');
  // botdot had written down what the erase names, and stopped before erasing.
  const db = new DatabaseSync(path.join(dir, 'memory.db'));
  db.prepare('INSERT INTO erasing (notes, runs, at) VALUES (?, ?, ?)').run(JSON.stringify([n.id]), JSON.stringify(['named-run']), new Date().toISOString());
  db.close();
  assert.ok(everywhere(dir, 'kestrel').length > 0);

  const again = memoryLib.create(dir); // the next start
  t.after(() => again.setSemanticSettings({ enabled: false }));
  assert.deepEqual(everywhere(dir, 'kestrel'), []);
  assert.deepEqual(await again.search({ query: 'kestrel alarm', notesOf: ['alpha'], runsOf: ['alpha'], history: true, removed: true }), []);
  assert.equal(again.forPrompt('alpha').text, '');
  assert.ok(again.leftOut(wrote.id) && again.leftOut('named-run'));
  assert.deepEqual(again.forgottenRuns().sort(), ['named-run', wrote.id].sort(), 'the runs whose files get the mark at start');
  assert.equal(count(dir, 'SELECT COUNT(*) AS n FROM erasing'), 0);
  assert.equal(again.completeErases(), 0, 'a second start finds nothing to complete');
});

test('the same sentence saved again after a forget is a new note', (t) => {
  const ids = ['aaaaaa', 'aaaaaa', 'bbbbbb'];
  const { memory: m } = scratchMemory(t, { newId: () => ids.shift() });
  const first = m.addNote('alpha', 'Lives in Lisbon', { source: 'owner' }).note;
  m.erase({ notes: [first.id] });
  const again = m.addNote('alpha', 'Lives in Lisbon', { source: 'owner' });
  assert.equal(again.duplicate, false);
  assert.equal(again.note.id, 'bbbbbb', 'under a new id: an erased note\'s id is not given out again');
  assert.deepEqual(m.history(again.note.id), []);
});

test('a forget leaves out every run that wrote the note: the first of two that said the same sentence, and one whose earlier version is purged', (t) => {
  const clock = clockAt('2026-10-07T12:00:00Z');
  const { memory: m, dir } = scratchMemory(t, { clock: clock.fn });
  const [a, b, c, d, other] = ['run-a', 'run-b', 'run-c', 'run-d', 'run-other'];
  for (const id of [a, b, c, d, other]) m.indexRun(runMeta({ id, prompt: `Said in ${id}`, result: 'OK.' }));
  // Run A saves it, run B says the same sentence again as the owner (the note's run is B from then on), and a
  // job's run tries to save it once more: all three hold the sentence.
  const n = m.addNote('alpha', 'The cat is called Mruczek', { runId: a, source: 'bot' }).note;
  assert.equal(m.addNote('alpha', 'the cat is called Mruczek.', { runId: b, source: 'owner' }).note.runId, b);
  assert.equal(m.addNote('alpha', 'The cat is called Mruczek', { runId: c, source: 'bot' }).duplicate, true);
  // Run D rewrites it; that earlier text is purged 30 days later, with the run it named.
  m.changeNote('alpha', n.id, 'The cat is called Mruczek and is grey', { runId: d });
  m.prune({ at: new Date('2026-11-20T12:00:00Z') });
  assert.deepEqual(m.history(n.id), []);
  const unrelated = m.addNote('alpha', 'Prefers tea', { runId: other }).note;

  assert.deepEqual(m.erase({ notes: [n.id] }).leftOut.sort(), [a, b, c, d]);
  assert.equal(m.leftOut(other), false);
  assert.equal(count(dir, 'SELECT COUNT(*) AS n FROM note_runs WHERE note_id = ?', n.id), 0, 'and what named them goes with the note');
  assert.equal(count(dir, 'SELECT COUNT(*) AS n FROM note_runs WHERE note_id = ?', unrelated.id), 1);
  // A removed note that is purged takes its runs' names with it; so does a deleted bot's.
  m.removeNote('alpha', unrelated.id);
  m.prune({ at: new Date('2027-01-20T12:00:00Z') });
  assert.equal(count(dir, 'SELECT COUNT(*) AS n FROM note_runs'), 0);
  m.addNote('gone', 'A note of a bot that is deleted', { runId: 'run-g' });
  m.removeOwner('gone');
  assert.equal(count(dir, 'SELECT COUNT(*) AS n FROM note_runs'), 0);
});

// ---------- a forget that waits ----------

test('a forget that waits names ids and holds no text; the yes erases, the no keeps, and it is always guarded', (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const wrote = runMeta({ prompt: 'My PIN hint is MAGNOLIA', result: 'Saved.' });
  const chat = runMeta({ prompt: 'Is magnolia a good hint', result: 'Yes.' });
  const asking = runMeta({ prompt: 'forget it' });
  for (const r of [wrote, chat]) m.indexRun(r);
  const n = m.addNote('alpha', 'PIN hint: MAGNOLIA', { runId: wrote.id, source: 'bot' }).note;
  const p = m.propose({ action: 'erase', owner: 'alpha', notes: [n.id], runs: [chat.id], by: 'bot', runId: asking.id, botId: 'alpha', source: 'outside' });
  assert.deepEqual([p.action, p.guarded, p.notes.map((x) => x.text), p.runs.map((x) => x.runId)], ['erase', true, ['PIN hint: MAGNOLIA'], [chat.id]]);
  assert.equal(p.text, 'PIN hint: MAGNOLIA · and 1 chat left out', 'what the card shows: nothing is approved unseen');
  assert.deepEqual(everywhere(dir, 'magnolia').sort(), ['notes', 'notes_fts'], 'the waiting change holds ids only');
  assert.equal(m.propose({ action: 'erase', owner: 'alpha', notes: [n.id], runs: [chat.id], by: 'bot', runId: asking.id, botId: 'alpha' }).id, p.id, 'asked twice, one card');
  assert.deepEqual(cardOf(p), { title: 'Forget for good', meta: 'after reading outside content', yes: 'Forget for good', no: 'Keep' });
  assert.equal(cardOf({ ...p, source: 'bot' }).meta, 'in a run you did not start');
  assert.deepEqual([answerOf(p, true), answerOf(p, false)], ['Forgotten', 'Kept']);
  assert.equal(waitingChip(p), 'Asked to forget for good: 1 note and 1 chat (waiting for your OK)');
  assert.throws(() => m.propose({ action: 'erase', owner: 'alpha', notes: [], runs: [], botId: 'alpha' }), /Say which notes or runs/);

  // Keep: nothing is erased.
  assert.deepEqual(m.settle(p.id, false), { declined: true });
  assert.equal(m.getNote(n.id).text, 'PIN hint: MAGNOLIA');
  assert.equal(m.leftOut(wrote.id), false);

  // Forget for good: the note, the runs named, the run that wrote it and the run that asked.
  const again = m.propose({ action: 'erase', owner: 'alpha', notes: [n.id], runs: [chat.id], by: 'bot', runId: asking.id, botId: 'alpha' });
  const done = m.settle(again.id, true);
  assert.deepEqual([done.erased, done.leftOut.sort()], [[n.id], [wrote.id, chat.id, asking.id].sort()]);
  assert.deepEqual(everywhere(dir, 'magnolia'), []);
  assert.deepEqual(m.pending(), []);
});

test('a forget takes the changes that wait for its note with it, and a waiting forget no longer names an erased note', (t) => {
  const { memory: m } = scratchMemory(t);
  const a = m.addNote('alpha', 'First secret').note;
  const b = m.addNote('alpha', 'Second secret').note;
  m.propose({ action: 'remove', owner: 'alpha', noteId: a.id, by: 'bot', botId: 'alpha', guarded: true });
  const both = m.propose({ action: 'erase', owner: 'alpha', notes: [a.id, b.id], by: 'bot', botId: 'alpha' });
  const one = m.propose({ action: 'erase', owner: 'alpha', notes: [a.id], by: 'bot', botId: 'beta' });
  m.erase({ notes: [a.id] });
  assert.deepEqual(m.pending().map((p) => [p.id, p.notes.map((n) => n.id)]), [[both.id, [b.id]]]);
  assert.equal(m.getPending(one.id), undefined);
});

// ---------- what a run learned ----------

test("a run's entry in the index holds a kind and a note's id, and no note text", async (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const n = m.addNote('alpha', 'The MARMOSET report goes out on Mondays').note;
  const r = runMeta({ prompt: 'Remember when the report goes out', result: 'Saved.', learned: [
    { kind: 'memory', id: n.id, what: 'add', unpinned: [] },
    { kind: 'forgot', count: 2, runs: 3 },
    { kind: 'memory-pending', pending: 'abcd1234', action: 'add' },
    { kind: 'job', text: 'Added job Weekly digest' },
    // An entry as the code before this task wrote it: its text is a note's.
    { kind: 'memory', text: 'The MARMOSET report goes out on Mondays', chip: 'Remembered: The MARMOSET report goes out on Mondays' },
  ] });
  m.indexRun(r);
  assert.equal(m.getRun(r.id).learned, `memory: note ${n.id}\nforgot: 2 notes\nmemory-pending\nAdded job Weekly digest\nmemory`);
  assert.deepEqual(everywhere(dir, 'marmoset').sort(), ['notes', 'notes_fts']);
  assert.deepEqual((await recall(m, 'marmoset', { kinds: ['runs'] })), [], 'the run is not found by what it saved');
  assert.equal(memoryLib.learnedLines([{ kind: 'memory', id: 'not an id <b>' }, null, { text: 'no kind' }]), 'memory');
});

test('the index made by the code before this task is rebuilt once at the first start, and a second start rebuilds nothing', async (t) => {
  // A database and run files as the code before this task left them: version 3 of the index, a run's `learned`
  // as the texts it saved, in the entry and in its search row.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-memory-before-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = new DatabaseSync(path.join(dir, 'memory.db'));
  db.exec(`
    CREATE TABLE notes (id TEXT PRIMARY KEY, owner TEXT NOT NULL, text TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 1, pin_locked INTEGER NOT NULL DEFAULT 0,
      by TEXT, run_id TEXT, created_at TEXT, updated_at TEXT, used_at TEXT, uses INTEGER NOT NULL DEFAULT 0, source TEXT);
    CREATE TABLE runs (run_id TEXT PRIMARY KEY, bot_id TEXT, bot_name TEXT, at TEXT, trigger TEXT, job TEXT, status TEXT, asked TEXT, reply TEXT, steps TEXT, learned TEXT, excluded INTEGER NOT NULL DEFAULT 0);
    CREATE VIRTUAL TABLE runs_fts USING fts5(run_id UNINDEXED, bot_id UNINDEXED, asked, reply, steps, learned, tokenize = 'porter unicode61 remove_diacritics 2');
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO meta VALUES ('index_version', '3'), ('schema_version', '2'), ('sources_at', '2026-10-01T00:00:00.000Z'), ('migrated_learning', '2026-01-01'), ('exclusions_saved', '2026-01-01');
  `);
  const at = daysAgo(3);
  const before = {
    saved: { id: 'run-saved', learned: [{ kind: 'memory', text: 'The owner banks with NARWHAL Bank', chip: 'Remembered: The owner banks with NARWHAL Bank', at }, { kind: 'job', text: 'Added job Weekly digest', at }] },
    forgot: { id: 'run-forgot', learned: [{ kind: 'forgot', text: 'The spare key is under the NARWHAL statue', chip: 'Forgot: The spare key is under the NARWHAL statue', at }] },
    gone: { id: 'run-gone', learned: [{ kind: 'memory', text: 'NARWHAL is the wifi password', at }] }, // its file is gone
    plain: { id: 'run-plain', learned: [] },
  };
  const meta = (r) => ({ ...runMeta({ id: r.id, startedAt: at, prompt: `Asked in ${r.id}`, result: `Replied in ${r.id}` }), learned: r.learned });
  for (const r of Object.values(before)) {
    const text = r.learned.map((x) => x.text).join('\n');
    db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)').run(r.id, 'alpha', 'Alpha', at, 'manual', '', 'success', `Asked in ${r.id}`, `Replied in ${r.id}`, 'looked around', text);
    db.prepare('INSERT INTO runs_fts (run_id, bot_id, asked, reply, steps, learned) VALUES (?, ?, ?, ?, ?, ?)').run(r.id, 'alpha', `Asked in ${r.id}`, `Replied in ${r.id}`, 'looked around', text);
  }
  db.close();
  const files = new Map([before.saved, before.forgot, before.plain].map((r) => [r.id, meta(r)]));
  const read = [];
  const start = (m) => { let rebuilt = null; const added = m.backfill({ listRuns: () => [...files.values()], readMeta: (id) => { read.push(id); return files.get(id) || null; }, readEvents: () => [], stepsOf: () => [], rebuilt: (n) => { rebuilt = n; } }); return { added, rebuilt }; };

  const m = memoryLib.create(dir);
  t.after(() => m.setSemanticSettings({ enabled: false }));
  assert.deepEqual((await m.search({ query: 'narwhal', runsOf: ['alpha'] })).length, 3, 'as it was left: the texts are found, until the start has rebuilt it (bots.js does so before anything runs)');
  assert.deepEqual(start(m), { added: 0, rebuilt: 3 }, 'the three entries that held a learned text, and no other');
  assert.deepEqual(read.sort(), ['run-forgot', 'run-gone', 'run-saved']);
  assert.deepEqual(everywhere(dir, 'narwhal'), [], 'no note text in the index');
  assert.deepEqual(['run-saved', 'run-forgot', 'run-gone', 'run-plain'].map((id) => m.getRun(id).learned), ['memory\nAdded job Weekly digest', 'forgot', '', '']);
  assert.deepEqual((await m.search({ query: 'narwhal', runsOf: ['alpha'] })), []);
  assert.deepEqual((await m.search({ query: 'weekly digest', runsOf: ['alpha'] })).map((r) => r.runId), ['run-saved'], 'what is no note is still found');
  assert.deepEqual(m.searchChats('Replied run-gone').map((h) => h.runId), ['run-gone'], 'an entry whose file is gone keeps what was asked and replied');
  assert.equal(m.getRun('run-saved').steps, 'looked around', 'its steps are kept');
  assert.equal(m.getMeta('index_version'), memoryLib.INDEX_VERSION);

  read.length = 0;
  assert.deepEqual(start(m), { added: 0, rebuilt: null }, 'a second start rebuilds nothing');
  assert.deepEqual(read, []);
});

test('read_run and the review are handed a learned item\'s kind and no text', (t) => {
  const { memory: m } = scratchMemory(t);
  const n = m.addNote('alpha', 'Allergic to PISTACHIO').note;
  const r = runMeta({ startedAt: daysAgo(1), learned: [{ kind: 'memory', id: n.id, what: 'add' }, { kind: 'memory-removed', id: 'c0ffee' }] });
  m.indexRun(r);
  // What both print is the entry's `learned` (server.js, lib/bots.js reviewPrompt).
  assert.equal(m.getRun(r.id).learned, `memory: note ${n.id}\nmemory-removed: note c0ffee`);
  assert.equal(m.runsSince('alpha', '')[0].learned, `memory: note ${n.id}\nmemory-removed: note c0ffee`);
  assert.ok(!/pistachio/i.test(JSON.stringify(m.runsSince('alpha', ''))));
});

test('a chip is written when it is read, from the note as it then stands', (t) => {
  const { memory: m } = scratchMemory(t);
  const mine = m.addNote('alpha', 'Uses pnpm', { source: 'owner' }).note;
  const all = m.addNote(SHARED, 'In Berlin', { source: 'owner', until: '2099-10-11' }).note;
  const bots = m.addNote('alpha', 'The CI run takes 12 minutes', { source: 'bot' }).note;
  const view = (x) => learnedView(x, m);
  assert.deepEqual(view({ kind: 'memory', id: mine.id, what: 'add', at: 'T' }), { kind: 'memory', at: 'T', text: 'Uses pnpm', chip: 'Remembered: Uses pnpm' });
  assert.equal(view({ kind: 'memory-shared', id: all.id, what: 'add' }).chip, 'Remembered for all bots until Sun 11 Oct 2099: In Berlin');
  assert.equal(view({ kind: 'memory', id: bots.id, what: 'edit' }).chip, 'Updated, its own conclusion: The CI run takes 12 minutes');
  assert.equal(view({ kind: 'memory-pin', id: mine.id, unpinned: [bots.id, 'gone00'] }).chip, 'Pinned: Uses pnpm · unpinned its own “The CI run takes 12 minutes”');
  assert.deepEqual([view({ kind: 'forgot', count: 1, runs: 2 }).chip, view({ kind: 'forgot', count: 3, runs: 0 }).chip, view({ kind: 'forgot', count: 0, runs: 2 }).chip], ['Forgot 1 note', 'Forgot 3 notes', 'Forgot what was said in 2 chats']);
  assert.deepEqual([forgotChip(1, 0), view({ kind: 'forgot', count: 1, runs: 2 }).text], ['Forgot 1 note', '1 note'], 'an app from before the chips prints "Forgot: 1 note": a count and no text');
  // The note changes: the chip of the run that saved it follows.
  m.editNote('alpha', mine.id, 'Uses pnpm 9');
  assert.equal(view({ kind: 'memory', id: mine.id, what: 'add' }).chip, 'Remembered: Uses pnpm 9');
  // Removed: its text is the owner's to see for 30 days. Purged: no text. Forgotten: said so.
  m.removeNote('alpha', bots.id, { by: 'bot' });
  assert.equal(view({ kind: 'memory', id: bots.id, what: 'add' }).chip, 'Remembered, its own conclusion: The CI run takes 12 minutes (since removed)');
  assert.equal(view({ kind: 'memory-removed', id: bots.id }).chip, 'Removed: The CI run takes 12 minutes');
  m.restore(m.removedNote(bots.id).vid);
  assert.equal(view({ kind: 'memory-restored', id: bots.id }).chip, 'Restored: The CI run takes 12 minutes');
  m.erase({ notes: [mine.id] });
  assert.deepEqual(view({ kind: 'memory', id: mine.id, what: 'add' }), { kind: 'memory', text: 'a note, since forgotten', chip: 'Remembered a note, since forgotten' });
  assert.equal(view({ kind: 'memory-removed', id: mine.id }).chip, 'Removed a note, since forgotten');
  assert.equal(view({ kind: 'memory', id: 'never0', what: 'add' }).chip, 'Remembered a note, since removed', 'a note that was purged');
  // A change that waits: its chip while it waits, and without a text once it is answered.
  const p = m.propose({ action: 'add', owner: SHARED, text: 'Has a dog called Biscuit', by: 'bot:alpha', botId: 'alpha' });
  const item = { kind: 'memory-pending', pending: p.id, action: 'add' };
  assert.equal(view(item).chip, 'Asked to add to the shared memory: Has a dog called Biscuit (waiting for your OK)');
  m.settle(p.id, false);
  assert.deepEqual(view(item), { kind: 'memory-pending', text: 'Asked to add to the shared memory (since answered)', chip: 'Asked to add to the shared memory (since answered)' });
  assert.equal(view({ kind: 'memory-pending', pending: 'zz', action: 'erase', guarded: true }).chip, 'Asked to forget for good (since answered)');
  assert.equal(view({ kind: 'memory-pending', pending: 'zz', action: 'remove', guarded: true }).chip, 'Asked to remove what you said (since answered)');
  // What waits for the owner, and an entry from before this task, are handed out as they were written; a done
  // memory change, of before this task too, is not handed out at all (ADR 024), nor is a job that was added (ADR 025).
  const job = { kind: 'job', text: 'Added job Weekly digest, waiting for your approval', at: 'T' };
  const old = { kind: 'memory-pending', text: 'An old text', at: 'T' };
  const forgot = { kind: 'forgot', text: 'An old text', chip: 'Forgot: An old text', at: 'T' };
  assert.deepEqual(learnedViews([job, forgot, old, { kind: 'memory', id: 'never0', what: 'add' }, { kind: 'job', text: 'Added job Weekly digest', at: 'T' }], m), [job, old]);
  assert.equal(learnedViews(undefined, m), undefined);
});

// ---------- a removed note ----------

test('a removed note is in no prompt, no lookup and no recall unless removed notes are asked for, and can be restored', async (t) => {
  const { memory: m } = scratchMemory(t);
  const n = m.addNote('alpha', 'The IGUANA server is in rack 4', { source: 'owner', topic: 'servers' }).note;
  const live = m.addNote('alpha', 'The iguana backup runs at night').note;
  m.editNote('alpha', live.id, 'The iguana backup runs at 02:00', { reason: 'more exact' });
  m.removeNote('alpha', n.id, { by: 'bot', reason: 'the server was retired' });
  assert.ok(!m.forPrompt('alpha').text.includes('rack 4'));
  assert.deepEqual((await m.relevantFor({ botId: 'alpha', text: 'Where is the iguana server rack' })).map((r) => r.id), []);
  assert.deepEqual((await recall(m, 'iguana rack')).map((r) => r.id), [live.id]);
  const withHistory = await recall(m, 'iguana', { history: true });
  assert.deepEqual(withHistory.map((r) => [r.kind, r.noteId || r.id]).sort(), [['note', live.id], ['old', live.id]].sort(), 'history: what a note said before, never a removed note');
  // Asked for: the owner's own search, and a run the owner started (server.js decides who may ask).
  assert.deepEqual((await recall(m, 'iguana rack', { history: true, removed: true })).filter((r) => r.kind === 'old').map((r) => r.noteId).sort(), [live.id, n.id].sort());
  assert.deepEqual(m.removedOf(['alpha', SHARED], { query: 'iguana' }).map((v) => [v.noteId, v.text, v.reason]), [[n.id, 'The IGUANA server is in rack 4', 'the server was retired']]);
  assert.deepEqual(m.removedOf(['alpha'], {}).map((v) => v.noteId), [n.id], 'without words, the latest');
  // As recall: 25 at most, whatever is asked for.
  for (let i = 0; i < 28; i++) m.removeNote('beta', m.addNote('beta', `Removed note number ${i}`).note.id);
  assert.deepEqual([-1, 0, 1000, 3, 'many'].map((limit) => m.removedOf(['beta'], { limit }).length), [1, 20, 25, 3, 20]);
  assert.equal(m.removedOf(['beta'], { query: 'removed note number', limit: -1 }).length, 1);
  assert.deepEqual(m.removedOf(['gamma'], { query: 'iguana' }), []);
  assert.equal(m.removedNote(live.id), undefined, 'a note that is there is no removed note');
  const back = m.restore(m.removedNote(n.id).vid, { by: 'bot' });
  assert.deepEqual([back.id, back.text, back.topic, back.source], [n.id, 'The IGUANA server is in rack 4', 'servers', 'owner']);
  assert.match(m.forPrompt('alpha').text, /rack 4/);
  assert.deepEqual(m.removedOf(['alpha'], {}), []);
});

test('thirty days after its removal a note is in no table; the clock is handed in', (t) => {
  const clock = clockAt('2026-10-07T12:00:00Z');
  const { memory: m, dir } = scratchMemory(t, { clock: clock.fn });
  const n = m.addNote('alpha', 'The FLAMINGO contract ends in March', { topic: 'contracts' }).note;
  const live = m.addNote('alpha', 'The flamingo office is on floor 2').note;
  m.editNote('alpha', n.id, 'The FLAMINGO contract ends in April');
  clock.set('2026-10-10T12:00:00Z');
  m.removeNote('alpha', n.id, { by: 'bot', reason: 'cancelled' });
  m.editNote('alpha', live.id, 'The flamingo office is on floor 3');
  const dbIns = new DatabaseSync(path.join(dir, 'memory.db'));
  for (const v of m.history(n.id)) dbIns.prepare('INSERT INTO embeddings (kind, ref, model, vec) VALUES (?, ?, ?, ?)').run('old', String(v.vid), 'bge-m3', Buffer.alloc(8));
  dbIns.close();

  // The 30 days count from the removal, not from the note's last change.
  assert.equal(m.prune({ at: new Date('2026-11-08T12:00:00Z') }), 0);
  assert.equal(m.removedNote(n.id).text, 'The FLAMINGO contract ends in April', 'on day 29 it can still be brought back');
  m.prune({ at: new Date('2026-11-09T12:00:01Z') });
  assert.equal(m.removedNote(n.id), undefined);
  assert.deepEqual(m.history(n.id), []);
  assert.deepEqual(everywhere(dir, 'contract'), [], 'in no table');
  assert.equal(count(dir, "SELECT COUNT(*) AS n FROM embeddings WHERE kind = 'old'"), 0);
  assert.equal(m.getNote(live.id).text, 'The flamingo office is on floor 3', 'a note that is there stays');
  assert.deepEqual(m.history(live.id), [], 'the text it had 30 days ago is purged with the removed notes');
  assert.throws(() => m.restore(999), /That version is gone/);
  assert.equal(memoryLib.REMOVED_DAYS, 30);
});

// ---------- a passing state ----------

test('remember with an end date saves a note that is printed with "until" and its day; an end in the past is refused', (t) => {
  const clock = clockAt('2026-10-07T12:00:00');
  const { memory: m } = scratchMemory(t, { clock: clock.fn });
  const n = m.addNote(SHARED, 'In Berlin', { source: 'owner', until: '2026-10-11' }).note;
  assert.equal(n.until, '2026-10-11');
  assert.equal(noteLine(n), `- [${n.id}] (the owner said, 2026-10-07, until 2026-10-11) In Berlin`);
  assert.equal(m.forPrompt(SHARED).text, `- [${n.id}] (the owner said, 2026-10-07, until 2026-10-11) In Berlin`);
  assert.equal(noteLine({ id: 'x', text: 't', until: 'soon) the owner said' }), '- [x] (a bot\'s conclusion) t', 'only a day is printed as an end');
  assert.match(MEMORY_RULE, /"until" and a day is a passing state/);
  assert.equal(m.addNote('alpha', 'Ends today', { until: '2026-10-07' }).note.until, '2026-10-07', 'today is no past');
  assert.equal(m.addNote('alpha', 'Lasting').note.until, undefined);
  for (const past of ['2026-10-06', '2025-12-31']) assert.throws(() => m.addNote('alpha', 'Too late', { until: past }), /is in the past \(today is 2026-10-07\)/);
  for (const bad of ['Sunday', '11.10.2026', '2026-02-30', '2026-13-01']) assert.throws(() => m.addNote('alpha', 'No day', { until: bad }), /Give the end as a calendar day/);
  // An end can be changed and taken away; the earlier version keeps the one it had.
  assert.equal(m.changeNote(SHARED, n.id, 'In Berlin', { until: '2026-10-11' }).unchanged, true);
  assert.equal(m.changeNote(SHARED, n.id, 'In Berlin', { until: '2026-10-14' }).note.until, '2026-10-14');
  assert.equal(m.history(n.id)[0].until, '2026-10-11');
  assert.equal(m.changeNote(SHARED, n.id, 'In Berlin, at the fair', { until: null }).note.until, '2026-10-14', 'no end given, by leaving it out or as null: the note keeps its own');
  assert.equal(m.changeNote(SHARED, n.id, 'In Berlin').note.until, '2026-10-14');
  assert.equal(m.changeNote(SHARED, n.id, 'In Berlin for good', { until: '' }).note.until, undefined);
  assert.throws(() => m.changeNote(SHARED, n.id, 'In Berlin', { until: '2026-01-01' }), /in the past/);
  // The same sentence said again with an end: the note ends then, unless it is the owner's and a bot says it.
  const own = m.addNote('alpha', 'On holiday', { source: 'owner' }).note;
  assert.equal(m.addNote('alpha', 'On holiday', { source: 'bot', until: '2026-10-20' }).note.until, undefined);
  assert.equal(m.addNote('alpha', 'On holiday', { source: 'owner', until: '2026-10-20' }).note.until, '2026-10-20');
  assert.equal(own.id, m.addNote('alpha', 'On holiday', { source: 'owner' }).note.id);
  assert.deepEqual([dayWords('2026-10-11', new Date('2026-10-07')), dayWords('2027-01-03', new Date('2026-10-07')), dayWords('soon')], ['Sun 11 Oct', 'Sun 3 Jan 2027', '']);
  assert.equal(chipOf('add', { ...n, owner: SHARED, source: 'owner', until: day(plusDays(new Date(), 0)) }).startsWith('Remembered for all bots until '), true);
  assert.match(SAY.saved(n), /It holds until 2026-10-11; botdot removes it the day after\./);
});

test('from the day after its end a note is in no prompt, lookup or recall and is a removed note with the reason "ended", also when botdot was not running that day', async (t) => {
  const clock = clockAt('2026-10-07T12:00:00');
  const { memory: m, dir } = scratchMemory(t, { clock: clock.fn });
  const n = m.addNote(SHARED, 'In Berlin for the PELICAN conference', { source: 'owner', until: '2026-10-11' }).note;
  const lasting = m.addNote(SHARED, 'The pelican is the team mascot').note;
  const ask = { botId: 'alpha', text: 'Where is the pelican conference' };
  m.setPinned(n.id, false);
  // On its last day it holds, to the end of that day.
  clock.set('2026-10-11T23:59:00');
  assert.deepEqual((await m.relevantFor(ask)).map((r) => r.id), [n.id]);
  assert.deepEqual((await recall(m, 'pelican conference')).map((r) => r.id).sort(), [n.id, lasting.id].sort());
  assert.equal(m.notesOf(SHARED).length, 2);
  // The day after: before a prompt is built, a lookup made or recall answered.
  clock.set('2026-10-12T00:00:30');
  assert.deepEqual((await m.relevantFor(ask)).map((r) => r.id), []);
  assert.deepEqual((await recall(m, 'pelican conference', { history: true })).map((r) => r.id), [lasting.id]);
  assert.ok(!m.forPrompt(SHARED).text.includes('Berlin'));
  const was = m.removedNote(n.id);
  assert.deepEqual([was.change, was.reason, was.changedBy, was.until], ['deleted', 'ended', 'botdot', '2026-10-11']);
  // Brought back after its day, it has no end; before it, it keeps the end.
  assert.equal(m.restore(was.vid).until, undefined);

  // botdot was not running on that day, nor for weeks after: the next start sees to it.
  const other = m.addNote('alpha', 'Borrowing the PELICAN projector', { until: '2026-10-15' }).note;
  const later = clockAt('2026-11-02T08:00:00');
  const again = memoryLib.create(dir, { clock: later.fn });
  t.after(() => again.setSemanticSettings({ enabled: false }));
  again.prune();
  assert.equal(again.getNote(other.id), undefined);
  assert.equal(again.removedNote(other.id).reason, 'ended');
  assert.equal(again.endPast(), 0, 'once');
});

// ---------- a deleted bot ----------

test('after a bot is deleted no note, version, waiting change or indexed run of it remains, also after a restart', async (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const mine = runMeta({ botId: 'gone', prompt: 'OKAPI question', result: 'OKAPI answer' });
  const long = runMeta({ botId: 'gone', prompt: 'OKAPI essay', result: `${'Okapi filler. '.repeat(200)}The end.` });
  const others = runMeta({ botId: 'alpha', prompt: 'A question', result: 'An answer' });
  for (const r of [mine, long, others]) m.indexRun(r);
  const n = m.addNote('gone', 'The OKAPI lives in the Ituri forest').note;
  m.editNote('gone', n.id, 'The OKAPI lives in the Ituri rainforest');
  const removed = m.addNote('gone', 'The okapi is shy').note;
  m.removeNote('gone', removed.id);
  m.propose({ action: 'remove', owner: 'gone', noteId: n.id, by: 'bot', botId: 'gone', guarded: true });
  m.propose({ action: 'add', owner: SHARED, text: 'The owner likes the OKAPI', by: 'bot:gone', botId: 'gone' });
  m.propose({ action: 'erase', owner: 'gone', notes: [n.id], by: 'bot', botId: 'gone' });
  const shared = m.addNote(SHARED, 'Stays for everyone').note;
  const db = new DatabaseSync(path.join(dir, 'memory.db'));
  for (const [kind, ref] of [['note', n.id], ['old', String(m.history(n.id)[0].vid)], ['note', shared.id]]) db.prepare('INSERT INTO embeddings (kind, ref, model, vec) VALUES (?, ?, ?, ?)').run(kind, ref, 'bge-m3', Buffer.alloc(8));
  db.close();

  const files = [mine, long, others];
  const start = (mem) => mem.backfill({ listRuns: () => files, readEvents: () => [], stepsOf: () => [], botExists: (id) => id !== 'gone' });
  m.setMeta('index_version', memoryLib.INDEX_VERSION); // an index that is up to date, as after any start

  m.removeOwner('gone');
  const left = () => ({
    okapi: everywhere(dir, 'okapi'),
    rows: ['notes WHERE owner', 'note_versions WHERE owner', 'pending WHERE bot_id', 'runs WHERE bot_id', 'runs_fts WHERE bot_id'].map((w) => count(dir, `SELECT COUNT(*) AS n FROM ${w} = 'gone'`)),
    parts: count(dir, 'SELECT COUNT(*) AS n FROM run_parts WHERE run_id = ?', long.id),
    vectors: count(dir, 'SELECT COUNT(*) AS n FROM embeddings'),
  });
  assert.deepEqual(left(), { okapi: [], rows: [0, 0, 0, 0, 0], parts: 0, vectors: 1 });
  assert.equal(m.getNote(shared.id).text, 'Stays for everyone');
  assert.equal(m.getRun(others.id).bot_id, 'alpha');
  assert.deepEqual(m.searchChats('okapi'), []);

  // A restart: its run files are still in the run history, and are not indexed again.
  const again = memoryLib.create(dir);
  t.after(() => again.setSemanticSettings({ enabled: false }));
  assert.equal(start(again), 0);
  assert.deepEqual(left(), { okapi: [], rows: [0, 0, 0, 0, 0], parts: 0, vectors: 1 });
  // A run of it that was indexed after all (it ended as the bot was deleted) leaves at the next start.
  again.indexRun(mine);
  assert.equal(start(again), 0);
  assert.equal(again.getRun(mine.id), null);
});

// ---------- the audit log ----------

test('a memory event is one line of the audit log: who, which change, which notes by their ids, and never a text', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const audit = require('../lib/audit').create(dir);
  const lines = () => fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').trim().split('\n').map((l) => { const { time, ...rest } = JSON.parse(l); assert.ok(!Number.isNaN(Date.parse(time))); return rest; });
  audit('memory.forgotten', 'web-surfer', { notes: ['a1b2c3', 'd4e5f6'], runs: 3, bot: 'web-surfer' });
  audit('memory.approved', 'you', { change: 'edit', notes: ['a1b2c3'], bot: 'web-surfer' });
  audit('memory.declined', 'you', { change: 'erase', notes: ['a1b2c3'], bot: 'web-surfer' });
  audit('memory.declined', 'you', { change: 'add', notes: [] });
  // What does not look like an id is not written: no text reaches the log through this door.
  audit('memory.forgotten', 'you', { notes: ['ok0001', 'The owner lives in Lisbon', { text: 'x' }, ''], runs: 'many', text: 'The owner lives in Lisbon', reason: 'because Lisbon' });
  assert.deepEqual(lines(), [
    { actor: 'web-surfer', action: 'memory.forgotten', bot: 'web-surfer', notes: ['a1b2c3', 'd4e5f6'], runs: 3 },
    { actor: 'owner', action: 'memory.approved', change: 'edit', bot: 'web-surfer', notes: ['a1b2c3'] },
    { actor: 'owner', action: 'memory.declined', change: 'erase', bot: 'web-surfer', notes: ['a1b2c3'] },
    { actor: 'owner', action: 'memory.declined', change: 'add', notes: [] },
    { actor: 'owner', action: 'memory.forgotten', notes: ['ok0001'], runs: 0 },
  ]);
  assert.ok(!fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').includes('Lisbon'));
  assert.throws(() => audit('memory.approved', 'you', { change: 'rewrite everything', notes: [] }), /Invalid audit detail/);
  assert.throws(() => audit('memory.forgotten', 'you', { notes: [], bot: 'Not A Bot Id' }), /Invalid audit detail/);
  assert.throws(() => audit('memory.erased', 'you', {}), /Unknown audit event/);
});

// ---------- the tools' sentences ----------

test('a forget answers with what was erased, what is left out and what still matches', () => {
  const said = SAY.forgot({ erased: ['a1b2c3'], leftOut: ['r1', 'r2'], still: { notes: [{ id: 'd4e5f6', owner: SHARED, text: 'The therapist is Dr Lind' }, { id: 'aa11bb', owner: 'alpha', text: 'Old', removed: true }], runs: [{ runId: 'r7', at: '2026-10-01T09:00:00Z', asked: 'Move my appointment' }] } });
  assert.match(said, /^Forgotten for good: 1 note erased with its history, and 2 past runs left out of what you, other bots and the Chief read \(this run among them\)\. The owner still sees those chats in their own history\./);
  assert.match(said, /Notes: \[d4e5f6\] “The therapist is Dr Lind”; \[aa11bb\] \(removed\) “Old”\nPast runs: run r7 \(2026-10-01\): Move my appointment\nCall forget again with those that hold what the owner wants forgotten/);
  assert.match(SAY.forgot({ erased: ['a', 'b'], leftOut: ['r1'], still: { notes: [], runs: [] } }), /2 notes erased with their history, and 1 past run left out.*\nNothing else of yours matches those words\. Tell the owner what was forgotten, and that their own chat history still shows it\./s);
  assert.match(SAY.forgot({}), /^Nothing was erased/);
  assert.match(SAY.forgetWaits({ source: 'outside' }), /^Not done: a forget erases for good, and this run has read outside content\. It waits for the owner on a card in Needs you \("Forget for good" or "Keep"\)\. Nothing is erased until then\./);
  assert.match(SAY.forgetWaits({ source: 'bot' }), /the owner did not start this run/);
  assert.match(SAY.removed({ id: 'a1b2c3' }), /^Removed note \[a1b2c3\]\. No bot reads it any more\. For 30 days the owner can have it brought back; then it is gone\.$/);
});
