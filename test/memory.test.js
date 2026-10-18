// Storage and lexical recall contracts, including regressions that should remain visible until fixed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { describeStep, PIN_LIMITS } = require('../lib/memory');
const { scratchMemory, daysAgo, runMeta } = require('./memory-helpers');

const recall = (m, query, opts = {}) => m.search({ query, notesOf: ['alpha', '_shared'], runsOf: ['alpha'], limit: 25, ...opts });

test('recall searches notes, topics, shared facts and all four indexed run fields, with scope isolation', async (t) => {
  const { memory: m } = scratchMemory(t);
  const own = m.addNote('alpha', 'The telescope is on the balcony.', { topic: 'astronomy', pinned: false }).note;
  const shared = m.addNote('_shared', 'The owner has a telescope.').note;
  m.addNote('beta', 'The private telescope code is BANANASECRET.');
  const run = runMeta({ prompt: 'telescope calibration', result: 'The lens has a scratch.', learned: [{ kind: 'job', text: 'Added job Wear mittens' }] });
  m.indexRun(run, ['visited an observatory']);
  m.indexRun(runMeta({ botId: 'beta', result: 'Private telescope result BANANASECRET' }));
  const hits = await recall(m, 'telescope');
  assert.deepEqual(new Set(hits.filter((x) => x.kind === 'note').map((x) => x.id)), new Set([own.id, shared.id]));
  assert.deepEqual(hits.filter((x) => x.kind === 'run').map((x) => x.runId), [run.id]);
  assert.ok(!JSON.stringify(hits).includes('BANANASECRET'));
  for (const word of ['calibration', 'scratch', 'mittens', 'observatory']) {
    assert.equal((await recall(m, word, { kinds: ['runs'] }))[0].runId, run.id, word);
  }
  assert.equal((await recall(m, 'astronomy', { kinds: ['notes'] }))[0].id, own.id);
  assert.deepEqual(await recall(m, 'BANANASECRET'), []);
  assert.equal((await recall(m, 'BANANASECRET', { notesOf: ['beta'], runsOf: 'all' })).length, 2);
});

test('stemming, prefixes, diacritics and FTS punctuation work without executing query syntax', async (t) => {
  const { memory: m } = scratchMemory(t);
  const n = m.addNote('alpha', 'The server crashed in Kraków; café backups recovered it.').note;
  for (const query of ['crashes', 'backu', 'krakow', 'cafe', '"crashed" OR *', 'crashed); DROP TABLE notes; --']) {
    assert.ok((await recall(m, query)).some((r) => r.id === n.id), query);
  }
  m.addNote('alpha', 'The VM has two CPUs.');
  m.addNote('alpha', 'The VMWARE host is separate.');
  assert.equal((await recall(m, 'vm')).length, 1, 'two-letter terms do not match arbitrary prefixes');
  assert.deepEqual(await recall(m, 'no-such-zebra-94281'), []);
  assert.equal(m.notesOf('alpha').length, 3);
});

test('empty recall, kind filters, date windows and result bounds', async (t) => {
  const { memory: m } = scratchMemory(t);
  m.addNote('alpha', 'Old compass', { createdAt: daysAgo(40) });
  const recent = m.addNote('alpha', 'Recent compass', { createdAt: daysAgo(1) }).note;
  m.indexRun(runMeta({ prompt: 'Old compass', startedAt: daysAgo(40) }));
  const recentRun = runMeta({ prompt: 'Recent compass', startedAt: daysAgo(1) });
  m.indexRun(recentRun);
  assert.deepEqual(new Set((await recall(m, 'compass', { days: 7 })).map((x) => x.id || x.runId)), new Set([recent.id, recentRun.id]));
  assert.ok((await recall(m, '', { kinds: ['notes'] })).every((x) => x.kind === 'note'));
  assert.ok((await recall(m, '', { kinds: ['runs'] })).every((x) => x.kind === 'run'));
  assert.equal((await recall(m, '', { limit: 1 })).length, 1);
  for (let i = 0; i < 35; i++) m.addNote('alpha', `Compass station ${i}`, { pinned: false });
  assert.equal((await recall(m, 'compass', { limit: 1000 })).length, 25);
});

test('recent, pinned and used notes rank ahead of equally relevant older notes', async (t) => {
  const { memory: m } = scratchMemory(t);
  m.addNote('alpha', 'Acorn storage in cellar', { pinned: false, createdAt: daysAgo(180) });
  const fresh = m.addNote('_shared', 'Acorn storage in cellar', { pinned: true, createdAt: daysAgo(1) }).note;
  m.touch([fresh.id]);
  assert.equal((await recall(m, 'acorn'))[0].id, fresh.id);
  assert.equal(m.getNote(fresh.id).uses, 1);
  assert.ok(m.getNote(fresh.id).usedAt);
});

test('notes normalize whitespace, deduplicate per owner and reject invalid or oversized writes atomically', (t) => {
  const { memory: m } = scratchMemory(t);
  const note = m.addNote('alpha', '  Drink\n green   tea  ').note;
  assert.equal(note.text, 'Drink green tea');
  assert.equal(m.addNote('alpha', 'drink green tea').duplicate, true);
  assert.equal(m.addNote('beta', 'drink green tea').duplicate, false);
  for (const text of ['', '  ', 'x'.repeat(401)]) {
    assert.throws(() => m.addNote('alpha', text));
    assert.throws(() => m.editNote('alpha', note.id, text));
  }
  assert.throws(() => m.editNote('beta', note.id, 'overwrite'));
  assert.throws(() => m.removeNote('beta', note.id));
  assert.equal(m.getNote(note.id).text, 'Drink green tea');
  assert.deepEqual(m.history(note.id), []);
});

test('updates and deletion retain dated historical recall; both forms restore with the same note id', async (t) => {
  const { memory: m } = scratchMemory(t);
  const original = m.addNote('alpha', 'The owner lives in Bruges.', { by: 'you', topic: 'home', createdAt: daysAgo(60) }).note;
  m.editNote('alpha', original.id, 'The owner lives in Ghent.', { by: 'bot', reason: 'The owner moved' });
  assert.deepEqual(await recall(m, 'Bruges'), [], 'recall shows what is true now');
  const [old] = await recall(m, 'Bruges', { history: true });
  assert.equal(old.kind, 'old');
  assert.equal(old.noteId, original.id);
  assert.equal(old.reason, 'The owner moved');
  assert.ok(old.validFrom < old.validTo);
  assert.equal((await recall(m, 'Ghent'))[0].kind, 'note');
  assert.equal(m.restore(old.vid).id, original.id);
  assert.equal(m.getNote(original.id).text, original.text);
  m.removeNote('alpha', original.id, { by: 'you', reason: 'No longer needed' });
  assert.equal(m.getNote(original.id), undefined);
  const [deleted] = m.deletedOf('alpha');
  assert.equal(deleted.change, 'deleted');
  assert.ok((await recall(m, 'Bruges', { history: true })).every((x) => x.kind === 'old'));
  assert.equal(m.restore(deleted.vid).id, original.id);
  assert.equal(m.deletedOf('alpha').length, 0);
  assert.equal(m.notesOf('alpha')[0].versions, 3);
});

test('pin pressure preserves owner pins and what the owner said, and evicted notes remain searchable', async (t) => {
  const { memory: m } = scratchMemory(t);
  const locked = m.addNote('alpha', 'Always use metric', { locked: true, createdAt: daysAgo(60) }).note;
  const said = m.addNote('alpha', 'Orchid watering', { source: 'owner', createdAt: daysAgo(59) }).note;
  const evicted = m.addNote('alpha', 'Marigold watering', { createdAt: daysAgo(58) }).note;
  for (let i = 3; i < PIN_LIMITS.notes; i++) m.addNote('alpha', `Garden note ${i}`, { createdAt: daysAgo(58 - i) });
  m.touch([evicted.id]); // the oldest of the bot's own goes, used a moment ago or not (ADR 015)
  const result = m.addNote('alpha', 'New hydrangea note');
  assert.deepEqual(result.unpinned.map((n) => n.id), [evicted.id]);
  assert.equal(m.getNote(locked.id).pinned, true);
  assert.equal(m.getNote(said.id).pinned, true);
  assert.equal((await recall(m, 'marigold'))[0].id, evicted.id);
  assert.ok(!m.forPrompt('alpha').text.includes('Marigold'));
  assert.equal(m.forPrompt('alpha').more, 1);
});

test('a full owner-pinned set keeps new notes searchable, and the 1000-note cap does not discard data', (t) => {
  const { memory: m } = scratchMemory(t);
  for (let i = 0; i < 1000; i++) m.addNote('alpha', `Remember marker ${i}`, { locked: true, id: `cap-${i}` });
  assert.equal(m.notesOf('alpha').filter((n) => n.pinned).length, 30);
  assert.equal(m.forPrompt('alpha').more, 970);
  assert.throws(() => m.addNote('alpha', 'one too many'), /very full/);
  assert.equal(m.addNote('alpha', 'Remember marker 999').duplicate, true);
  assert.equal(m.notesOf('alpha').length, 1000);
});

test('REGRESSION: editing pinned notes must keep the prompt within its character budget', (t) => {
  const { memory: m } = scratchMemory(t);
  const notes = Array.from({ length: 30 }, (_, i) => m.addNote('alpha', `Small ${i}`).note);
  for (const [i, n] of notes.entries()) m.editNote('alpha', n.id, `${i} ${'x'.repeat(390)}`);
  const chars = m.notesOf('alpha').filter((n) => n.pinned).reduce((sum, n) => sum + n.text.length, 0);
  assert.ok(chars <= PIN_LIMITS.chars, `pinned content is ${chars} chars; limit is ${PIN_LIMITS.chars}`);
});

test('REGRESSION: a refused pin must not silently unpin unrelated notes', (t) => {
  const { memory: m } = scratchMemory(t);
  for (let i = 0; i < 12; i++) m.addNote('alpha', `${i}:`.padEnd(400, 'x'), { locked: true });
  const keeper = m.addNote('alpha', 'k'.repeat(100)).note;
  const tooLarge = m.addNote('alpha', 'z'.repeat(300), { pinned: false }).note;
  assert.throws(() => m.setPinned(tooLarge.id, true), /full/);
  assert.equal(m.getNote(keeper.id).pinned, true, 'the failed operation must leave existing pins alone');
});

test('REGRESSION: a new note that cannot be pinned must not unpin unrelated notes either', (t) => {
  const { memory: m } = scratchMemory(t);
  for (let i = 0; i < 12; i++) m.addNote('alpha', `${i}:`.padEnd(400, 'x'), { locked: true });
  const keeper = m.addNote('alpha', 'k'.repeat(100)).note;
  const r = m.addNote('alpha', 'z'.repeat(300));
  assert.equal(r.note.pinned, false, 'the new note stays searchable');
  assert.deepEqual(r.unpinned, []);
  assert.equal(m.getNote(keeper.id).pinned, true);
});

test('a pinned note that grows past the budget: others make room, else it stays searchable, owner pins refuse', (t) => {
  const { memory: m } = scratchMemory(t);
  for (let i = 0; i < 11; i++) m.addNote('alpha', `${i}:`.padEnd(400, 'x'), { locked: true });
  const old = m.addNote('alpha', 'old '.padEnd(300, 'o'), { createdAt: daysAgo(30) }).note; // 4,700 pinned
  const edited = m.addNote('alpha', 'Grows later').note;
  m.editNote('alpha', edited.id, 'g'.repeat(350)); // 5,050 with the old note
  assert.equal(m.getNote(old.id).pinned, false, 'the least used ordinary note made room');
  assert.equal(m.getNote(edited.id).pinned, true);
  m.addNote('alpha', 'f'.repeat(240), { locked: true }); // 4,990: only owner pins besides the edited note
  m.editNote('alpha', edited.id, 'h'.repeat(399));
  assert.equal(m.getNote(edited.id).pinned, false, 'no room left: the edit is saved, searchable');
  assert.equal(m.getNote(edited.id).text, 'h'.repeat(399));
  const locked = m.addNote('alpha', 'Owner pinned', { pinned: false }).note;
  m.setPinned(locked.id, true);
  assert.throws(() => m.editNote('alpha', locked.id, 'l'.repeat(399)), /owner pinned/);
  assert.equal(m.getNote(locked.id).text, 'Owner pinned');
  assert.equal(m.history(locked.id).length, 0, 'a refused edit leaves no version behind');
  const chars = m.notesOf('alpha').filter((n) => n.pinned).reduce((s, n) => s + n.text.length, 0);
  assert.ok(chars <= PIN_LIMITS.chars, `${chars}`);
});

test('backfill leaves out runs past retention and keeps runs left out in their own files out of recall', async (t) => {
  const { memory: m } = scratchMemory(t);
  m.setRetentionDays(30);
  const old = runMeta({ startedAt: daysAgo(40), result: 'Old zebra' });
  const hidden = runMeta({ excludedFromMemory: true, result: 'Hidden zebra' });
  const fresh = runMeta({ result: 'Fresh zebra' });
  const sources = { listRuns: () => [old, hidden, fresh], readEvents: () => [], stepsOf: () => [] };
  assert.equal(m.backfill(sources), 2);
  assert.equal(m.getRun(old.id), null);
  assert.equal(m.getRun(hidden.id).excluded, 1);
  assert.deepEqual((await m.search({ query: 'zebra', runsOf: ['alpha'], kinds: ['runs'] })).map((r) => r.runId), [fresh.id]);
  assert.equal(m.backfill(sources), 0, 'nothing is indexed twice');
});

test('a long reply is searchable to its end, in sections that point to where they start', async (t) => {
  const { memory: m } = scratchMemory(t);
  const filler = Array.from({ length: 60 }, (_, i) => `Check ${i}: the valves and the pump were fine, nothing to replace at this point.`).join('\n\n');
  const result = `Boiler report\n\n${filler}\n\nFinal verdict: replace the ignition electrode, part BX-40417.`;
  const run = runMeta({ prompt: 'Write the boiler report', result });
  m.indexRun(run);
  const [hit] = await recall(m, 'ignition electrode', { kinds: ['runs'] });
  assert.equal(hit.runId, run.id, 'found past the 6,000 characters the reply index keeps whole');
  assert.match(hit.excerpt, /BX-40417/);
  assert.equal(hit.part, hit.parts);
  assert.ok(hit.parts > 3);
  assert.equal(result.slice(hit.from).includes('BX-40417'), true, 'read_run from here reaches it');
  assert.match(result.slice(hit.from - 2, hit.from + 1), /\n/, 'sections start at a paragraph break');
  assert.equal(m.searchChats('electrode')[0].runId, run.id, 'the owner\'s search box finds it too');
  const [start] = await recall(m, 'boiler report', { kinds: ['runs'] });
  assert.ok(!start.part || start.from === 0, 'a match at the start shows the start');
  m.indexRun({ ...run, result: 'Short now.' });
  assert.deepEqual(await recall(m, 'electrode'), [], 'sections follow the reply');
  m.indexRun(run);
  m.setExcluded(run.id, true);
  assert.deepEqual(await recall(m, 'electrode'), []);
  m.setExcluded(run.id, false);
  m.forgetRunsOfBot('alpha');
  assert.deepEqual(await recall(m, 'electrode'), []);
  assert.deepEqual(m.searchChats('electrode'), []);
});

test('asked for history, an earlier version ranks with current notes instead of below all of them', async (t) => {
  const { memory: m } = scratchMemory(t);
  for (const place of ['the garage', 'the cottage', 'the office', 'the shed', 'the gym', 'the flat']) for (const thing of ['alarm', 'gate', 'safe']) m.addNote('alpha', `The code for the ${thing} at ${place} is ${place.length}${thing.length}17.`, { pinned: false });
  const boat = m.addNote('alpha', 'The code for the alarm at the boat is 1884.', { pinned: false }).note;
  m.editNote('alpha', boat.id, 'The code for the alarm at the boat is 5520.');
  assert.ok((await recall(m, 'alarm code boat')).every((r) => r.kind !== 'old'));
  const hits = await recall(m, 'alarm code boat', { history: true });
  assert.ok(hits.slice(0, 2).some((r) => r.kind === 'old' && r.text.includes('1884')), hits.slice(0, 4).map((r) => r.text).join(' | '));
});

test('memories for a run: relevant, unpinned, not the job\'s own runs, within the budget', async (t) => {
  const { memory: m } = scratchMemory(t);
  const lock = m.addNote('alpha', 'The bike lock code in the garage is 4817.', { pinned: false }).note;
  m.addNote('alpha', 'The garage door opener battery was changed in May.', { pinned: true });
  const shared = m.addNote('_shared', 'The owner keeps the bike in the garage.', { pinned: false }).note;
  m.addNote('beta', 'Beta knows the bike lock code is 0000.', { pinned: false });
  m.addNote('alpha', 'The fern needs water every week.', { pinned: false });
  const own = runMeta({ prompt: 'Check the bike', result: 'The bike lock works.', jobName: 'Bike check' });
  const other = runMeta({ prompt: 'Oil the bike chain', result: 'Oiled the bike chain.' });
  m.indexRun(own);
  m.indexRun(other);
  const found = await m.relevantFor({ botId: 'alpha', text: "What's the code for the bike lock?", job: 'Bike check' });
  const ids = found.map((r) => r.id || r.runId);
  assert.equal(ids[0], lock.id);
  assert.ok(!ids.includes(own.id), "a job doesn't get its own earlier runs");
  assert.ok(found.every((r) => !r.pinned && r.owner !== 'beta' && !/fern/.test(r.text || '')), JSON.stringify(found));
  assert.ok((await m.relevantFor({ botId: 'alpha', text: "What's the code for the bike lock?" })).some((r) => r.runId === own.id), 'other runs do');
  assert.ok(found.length <= 5);
  assert.deepEqual(await m.relevantFor({ botId: 'alpha', text: 'Quantum chromodynamics' }), []);
  for (let i = 0; i < 12; i++) m.addNote('alpha', `Bike lock note ${i}: ${'details '.repeat(40)}`, { pinned: false });
  const many = await m.relevantFor({ botId: 'alpha', text: 'bike lock' });
  assert.ok(many.length <= 5 && many.reduce((a, r) => a + (r.text || `${r.asked}${r.excerpt}`).length, 0) <= 1500);
  assert.ok(shared);
});

test('shared proposals deduplicate, wait for approval, support rejection, and preserve change reasons', (t) => {
  const { memory: m } = scratchMemory(t);
  const input = { action: 'add', owner: '_shared', text: 'Cycling is preferred.', by: 'bot:alpha', botId: 'alpha', runId: 'r1' };
  const p = m.propose(input);
  assert.equal(m.propose(input).id, p.id);
  assert.equal(m.notesOf('_shared').length, 0);
  const added = m.settle(p.id, true).note;
  assert.equal(added.by, 'bot:alpha');
  const edit = m.propose({ ...input, action: 'edit', noteId: added.id, text: 'Walking is preferred.', reason: 'Owner correction' });
  m.settle(edit.id, true);
  assert.equal(m.history(added.id)[0].reason, 'Owner correction');
  const remove = () => m.propose({ ...input, action: 'remove', noteId: added.id });
  assert.deepEqual(m.settle(remove().id, false), { declined: true });
  assert.ok(m.getNote(added.id));
  m.settle(remove().id, true);
  assert.equal(m.pending().length, 0);
  assert.equal(m.deletedOf('_shared')[0].noteId, added.id);
});

test('run indexing ignores active runs, preserves exclusions on reindex, and does not index raw tool output', async (t) => {
  const { memory: m } = scratchMemory(t);
  const run = runMeta({ result: 'Report: violet', rawToolOutput: 'RAWSECRET', learned: [{ kind: 'job', text: 'Added job Use indigo' }] });
  m.indexRun({ ...run, status: 'running' });
  assert.equal(m.getRun(run.id), null);
  m.indexRun(run, ['looked at lavender', 'looked at lavender', null]);
  assert.equal(m.getRun(run.id).steps, 'looked at lavender');
  assert.deepEqual(await recall(m, 'RAWSECRET'), []);
  m.setExcluded(run.id, true);
  m.indexRun({ ...run, result: 'New report: violet' });
  assert.deepEqual(await recall(m, 'violet'), []);
  assert.equal(m.searchChats('violet')[0].runId, run.id, 'owner chat search still finds excluded runs');
  m.setExcluded(run.id, false);
  assert.equal((await recall(m, 'violet'))[0].runId, run.id);
});

test('chat search requires every term, searches only asked/replied text, and drops deleted Chief chats', (t) => {
  const { memory: m } = scratchMemory(t);
  const run = runMeta({ result: 'Juniper invoice paid', learned: [{ kind: 'job', text: 'Added job MANGO' }] });
  m.indexRun(run, ['visited PAPAYA']);
  m.indexRun(runMeta({ id: 'chief-chatone-1', botId: 'chief', result: 'Juniper invoice pending' }));
  m.indexRun(runMeta({ id: 'chief-chattwo-1', botId: 'chief', result: 'Juniper invoice closed' }));
  assert.equal(m.searchChats('juniper invoi').length, 3);
  assert.equal(m.searchChats('juniper pineapple').length, 0);
  for (const term of ['MANGO', 'PAPAYA', 'j', 'the and']) assert.deepEqual(m.searchChats(term), []);
  assert.equal(m.forgetChat('chatone'), 1);
  assert.deepEqual(m.searchChats('pending'), []);
  assert.equal(m.searchChats('closed').length, 1);
});

test('retention prunes old indexed runs, always retains with zero, and review counts exclude review runs', (t) => {
  const { memory: m } = scratchMemory(t);
  const old = runMeta({ startedAt: daysAgo(400) });
  const recent = runMeta({ startedAt: daysAgo(1) });
  const review = runMeta({ jobName: 'Memory review' });
  for (const r of [old, recent, review]) m.indexRun(r);
  m.setRetentionDays(0);
  assert.equal(m.prune(), 0);
  assert.equal(m.countRunsSince('alpha', ''), 2);
  assert.equal(m.countRunsSince('alpha', daysAgo(7)), 1);
  m.setExcluded(recent.id, true);
  assert.equal(m.countRunsSince('alpha', daysAgo(7)), 0);
  assert.deepEqual(m.runsSince('alpha', daysAgo(7)).map((r) => r.run_id), [review.id]);
  m.setRetentionDays(7);
  assert.equal(m.getRun(old.id), null);
  for (const value of [-1, 6, 3651, 'bad']) assert.throws(() => m.setRetentionDays(value));
  assert.equal(m.retentionDays(), 7);
});

test('legacy migration keeps a backup, preserves provenance/history, and runs only once', (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const learning = path.join(dir, 'learning');
  fs.mkdirSync(learning);
  const legacy = { memory: [{ id: 'abc123', text: 'Use the red folder.', at: daysAgo(2), by: 'you', runId: 'legacy-run' }], history: [{ field: 'prompt' }] };
  const file = path.join(learning, 'alpha.json');
  fs.writeFileSync(file, JSON.stringify(legacy));
  fs.writeFileSync(path.join(learning, 'broken.json'), '{');
  assert.equal(m.migrateFrom(learning), 1);
  assert.equal(m.migrateFrom(learning), 0);
  assert.equal(m.getNote('abc123').runId, 'legacy-run');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(learning, 'before-memory-db', 'alpha.json'))), legacy);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { history: legacy.history });
});

test('backfill is idempotent, skips broken and active records, and rebuilds the run FTS index', async (t) => {
  const { memory: m } = scratchMemory(t);
  const run = runMeta({ result: 'Peacock report' });
  const opts = { listRuns: () => [run, runMeta({ status: 'running' }), { id: 'broken', status: 'success' }], readEvents: () => [], stepsOf: () => [] };
  assert.equal(m.backfill(opts), 1);
  assert.equal(m.backfill(opts), 0);
  m.setExcluded(run.id, true);
  m.setMeta('index_version', 'previous');
  assert.equal(m.backfill(opts), 1);
  assert.deepEqual(await recall(m, 'peacock'), []);
  m.setExcluded(run.id, false);
  assert.equal((await recall(m, 'peacock'))[0].runId, run.id);
});

test('snapshot includes current notes, versions, settings and pending approvals in a consistent database', (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const n = m.addNote('alpha', 'Before').note;
  m.editNote('alpha', n.id, 'After');
  m.propose({ action: 'add', owner: '_shared', text: 'Waiting', by: 'bot', botId: 'alpha', runId: 'run' });
  m.setReviewSettings({ enabled: false, day: 2, time: '12:34', model: 'haiku' });
  const file = path.join(dir, "snapshot's.db");
  m.snapshot(file);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare('SELECT text FROM notes').get().text, 'After');
    assert.equal(db.prepare('SELECT text FROM note_versions').get().text, 'Before');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pending').get().n, 1);
    assert.equal(m.reviewSettings().model, 'haiku');
  } finally { db.close(); }
  for (const file of ['memory.db', 'memory.db-wal', 'memory.db-shm']) {
    if (fs.existsSync(path.join(dir, file))) assert.equal(fs.statSync(path.join(dir, file)).mode & 0o777, 0o600, file);
  }
});

test('step summaries omit typed passwords and raw tool content', () => {
  assert.equal(describeStep('mcp__computer__type_login', { field: 'password', login: 'mail', password: 'SECRET' }), 'signed in with the saved login mail');
  assert.equal(describeStep('mcp__computer__type_text', { text: 'SECRET' }), null);
  assert.equal(describeStep('mcp__computer__run_with_login', { login: 'Bridge', command: 'curl --user "$BOTDOT_USERNAME:$BOTDOT_PASSWORD" imap://127.0.0.1:1143/' }), 'ran a command with the saved login Bridge: curl --user "$BOTDOT_USERNAME:$BOTDOT_PASSWORD" imap://127.0.0.1:1143/');
  assert.equal(describeStep('WebFetch', { url: 'https://example.com', result: 'SECRET' }), 'read https://example.com');
  assert.equal(describeStep('unrecognized_tool', { output: 'SECRET' }), null);
});
