// Recall's paging and the store's part of MEM-005 ("The right note arrives"), against the store with nothing
// running: a page of a search with its total, every note listed once in a fixed order, the private reply of a
// quiet run in the index, a new run that deletes nothing, the ids of the pinned notes of a prompt, a job's last
// runs, and the limits of the scale test (docs/product/milestone9.md, Test budget) at 10,000 past runs.
// The same through the server and the bots' own tools: test/memory-recall-api.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { scratchMemory, daysAgo, runMeta } = require('./memory-helpers');
const memoryLib = require('../lib/memory');
const { NOT_SENT } = require('../lib/prompt-text');

const SHARED = '_shared';
const page = (m, query, extra = {}) => m.page({ query, notesOf: ['alpha', SHARED], runsOf: ['alpha'], ...extra });
const idOf = (r) => (r.kind === 'run' ? r.runId : r.id);
// A second connection to a store's database, for rows the store's own functions would not write.
const direct = (t, dir) => { const db = new DatabaseSync(path.join(dir, 'memory.db')); t.after(() => { try { db.close(); } catch { /* closed */ } }); return db; };

test('a page of a search has a limit, an offset and the total', async (t) => {
  const { memory: m } = scratchMemory(t);
  for (let i = 1; i <= 12; i++) m.addNote('alpha', `Orchard ledger entry ${i}: apples picked.`, { pinned: false });
  for (let i = 1; i <= 9; i++) m.indexRun(runMeta({ startedAt: daysAgo(i), prompt: `Update the orchard ledger, week ${i}`, result: `The orchard ledger is up to date for week ${i}.` }));
  const first = await page(m, 'orchard ledger');
  assert.deepEqual([first.results.length, first.total, first.offset, first.limit], [8, 21, 0, 8], 'eight a page unless asked otherwise');
  const seen = [];
  for (let offset = 0; offset < 21; offset += 5) {
    const p = await page(m, 'orchard ledger', { limit: 5, offset });
    assert.deepEqual([p.total, p.offset, p.limit], [21, offset, 5]);
    seen.push(...p.results.map(idOf));
  }
  assert.deepEqual([seen.length, new Set(seen).size], [21, 21], 'the pages together hold each match once');
  assert.deepEqual((await page(m, 'orchard ledger', { limit: 5, offset: 21 })).results, [], 'past the end: nothing');
  assert.equal((await page(m, 'orchard ledger', { limit: 400 })).limit, 25, '25 a page at most');
  assert.deepEqual(first.results.map(idOf), (await m.search({ query: 'orchard ledger', notesOf: ['alpha', SHARED], runsOf: ['alpha'], limit: 8 })).map(idOf), 'the first page is what a search answers');
});

test('two searches answer the same order when the clock moves on between two of the items they weigh', async (t) => {
  // Twelve notes that match equally, saved a millisecond apart: how recent each is decides their order.
  let saved = Date.now() - 60_000;
  const { memory: m } = scratchMemory(t, { clock: () => new Date(saved++) });
  for (let i = 1; i <= 12; i++) m.addNote('alpha', `Orchard ledger entry ${i}: apples picked.`, { pinned: false });
  const search = async () => (await m.search({ query: 'orchard ledger', notesOf: ['alpha'], kinds: ['notes'], limit: 12 })).map(idOf);
  const real = Date.now;
  t.after(() => { Date.now = real; });
  const at = real();
  Date.now = () => at;
  const still = await search();
  // A clock that moves 3 ms on every read, as a slow machine's does now and then between two items.
  let reads = 0;
  Date.now = () => at + 3 * reads++;
  const moving = await search();
  Date.now = real;
  assert.deepEqual(moving, still, 'the order is that of a clock that stood still');
});

test('an empty query pages every note of the bot and the shared ones, in a fixed order: with 1,000 notes, the pages together hold each note once', async (t) => {
  const { memory: m, dir } = scratchMemory(t);
  // 1,000 notes of the bot and 40 shared ones, written straight into the tables: the store's own save reads every
  // note of an owner for each new one. Some pinned, with their dates out of order.
  const db = direct(t, dir);
  db.exec('BEGIN');
  const put = db.prepare('INSERT INTO notes (id, owner, text, topic, pinned, source, by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const fts = db.prepare('INSERT INTO notes_fts (id, owner, text, topic) VALUES (?, ?, ?, ?)');
  const all = [];
  for (let i = 0; i < 1040; i++) {
    const owner = i < 1000 ? 'alpha' : SHARED;
    const id = `n${String(i).padStart(4, '0')}`;
    const at = daysAgo((i * 37) % 400); // many notes share a day's moment: the order is fixed among them too
    put.run(id, owner, `Note ${i} of the archive.`, i % 9 ? '' : 'archive', i % 40 === 0 ? 1 : 0, ['owner', 'bot', 'outside'][i % 3], 'bot', at, at);
    fts.run(id, owner, `Note ${i} of the archive.`, '');
    all.push(id);
  }
  db.exec('COMMIT');
  m.addNote('beta', "Another bot's note.", { pinned: false });
  for (let i = 1; i <= 7; i++) m.indexRun(runMeta({ startedAt: daysAgo(i), prompt: `Archive run ${i}`, result: 'Filed.' }));

  const seen = [];
  let total = null;
  for (let offset = 0; ; offset += 25) {
    const p = await page(m, '', { kinds: ['notes'], limit: 25, offset });
    total ??= p.total;
    assert.equal(p.total, 1040);
    if (!p.results.length) break;
    assert.ok(p.results.every((r) => r.kind === 'note' && r.owner !== 'beta'));
    seen.push(...p.results.map(idOf));
  }
  assert.equal(seen.length, 1040);
  assert.deepEqual([...seen].sort(), [...all].sort(), 'each note once, none of another bot');
  // The order is fixed: the same pages again, also after notes were looked up (which a search counts as use).
  m.touch(all.slice(0, 50));
  const again = [];
  for (let offset = 0; offset < 1040; offset += 25) again.push(...(await page(m, '', { kinds: ['notes'], limit: 25, offset })).results.map(idOf));
  assert.deepEqual(again, seen);
  // With the past runs: the notes first, then the runs, the newest first, in one count.
  const tail = await page(m, '', { limit: 25, offset: 1030 });
  assert.equal(tail.total, 1047);
  assert.deepEqual(tail.results.map((r) => r.kind), [...Array(10).fill('note'), ...Array(7).fill('run')]);
  assert.deepEqual(tail.results.slice(10).map((r) => r.asked), [1, 2, 3, 4, 5, 6, 7].map((i) => `Archive run ${i}`));
  assert.equal((await page(m, '', { kinds: ['runs'], limit: 3, offset: 6 })).results[0].asked, 'Archive run 7');
});

test('removed notes are paged too, and counted', (t) => {
  const { memory: m } = scratchMemory(t);
  const gone = [];
  for (let i = 1; i <= 7; i++) { const n = m.addNote('alpha', `Pergola plan ${i}.`, { pinned: false }).note; m.removeNote('alpha', n.id, { by: 'bot', reason: 'done' }); gone.push(n.id); }
  m.addNote('alpha', 'Pergola plan that stays.', { pinned: false });
  assert.equal(m.countRemoved(['alpha', SHARED]), 7);
  assert.equal(m.countRemoved(['alpha', SHARED], { query: 'pergola' }), 7);
  const pages = [0, 3, 6].flatMap((offset) => m.removedOf(['alpha', SHARED], { limit: 3, offset }).map((v) => v.noteId));
  assert.deepEqual([...pages].sort(), [...gone].sort());
  assert.equal(m.removedOf(['alpha', SHARED], { query: 'pergola', limit: 3, offset: 6 }).length, 1);
});

test('the private reply of a quiet run is indexed, marked as not sent to the owner, and recall finds it', async (t) => {
  const { memory: m } = scratchMemory(t);
  // As reporting.js finishReport leaves a quiet run: no reply for the owner, its own in rawResult.
  const quiet = runMeta({ trigger: 'schedule', jobId: 'j1', jobName: 'Tide check', customPrompt: false, notify: 'report-only', reporting: 'quiet', result: '', rawResult: 'The tide table for Porthcawl is unchanged: high water at 06:12.' });
  const told = runMeta({ trigger: 'schedule', jobId: 'j1', jobName: 'Tide check', customPrompt: false, notify: 'report-only', reporting: 'delivered', result: 'High water moved to 07:40.', rawResult: 'I sent the report about Porthcawl.' });
  const long = runMeta({ trigger: 'schedule', jobId: 'j1', jobName: 'Tide check', customPrompt: false, notify: 'report-only', reporting: 'suppressed', result: '', rawResult: `${'Nothing moved in the harbour log. '.repeat(120)}The dredger ZEPHYRINE left at noon.` });
  for (const r of [quiet, told, long]) m.indexRun(r);
  const [hit] = (await page(m, 'Porthcawl tide table')).results;
  assert.equal(hit.runId, quiet.id);
  assert.equal(hit.notSent, true);
  assert.deepEqual([m.getRun(quiet.id).reply, m.getRun(quiet.id).quiet], ['The tide table for Porthcawl is unchanged: high water at 06:12.', 1], 'the reply as it was written; that it was not sent is a mark of the entry, not a word of it');
  // What the owner was sent is indexed as before, unmarked.
  const sent = (await page(m, 'high water moved')).results.find((r) => r.runId === told.id);
  assert.ok(sent && !sent.notSent && m.getRun(told.id).quiet === 0);
  // A reply the owner was sent that happens to start with those words is not marked.
  const posing = runMeta({ prompt: 'Report on the harbour', result: `(${NOT_SENT}) The harbour chain was oiled.` });
  m.indexRun(posing);
  assert.ok(!(await page(m, 'harbour chain oiled')).results.find((r) => r.runId === posing.id).notSent);
  // A long private reply is searchable to its end, in sections.
  const far = (await page(m, 'dredger ZEPHYRINE')).results.find((r) => r.runId === long.id);
  assert.ok(far?.notSent && far.part > 1, JSON.stringify(far));
  // The lookup before a run says it too.
  const given = await m.relevantFor({ botId: 'alpha', text: 'Is the Porthcawl tide table still right?' });
  assert.deepEqual([given[0].runId, given[0].notSent], [quiet.id, true]);
});

test('an index made before quiet replies were kept gets them at the next start, once, and nothing else is made again', async (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const quiet = runMeta({ trigger: 'schedule', jobName: 'Tide check', customPrompt: false, reporting: 'quiet', result: '', rawResult: 'The KITTIWAKE colony count is 412.' });
  const other = runMeta({ prompt: 'Count the gulls', result: 'There are 30 gulls.' });
  const gone = runMeta({ trigger: 'schedule', jobName: 'Tide check', customPrompt: false, reporting: 'quiet', result: '', rawResult: 'The file of this run is gone.' });
  // As the code before this task indexed them: a quiet run with no reply.
  for (const r of [quiet, gone]) m.indexRun({ ...r, rawResult: undefined });
  m.indexRun(other);
  m.setMeta('index_version', '4');
  assert.deepEqual((await page(m, 'kittiwake colony')).results, []);
  const files = new Map([quiet, other].map((r) => [r.id, r]));
  const read = [];
  const start = () => m.backfill({ listRuns: () => [...files.values()], readMeta: (id) => { read.push(id); return files.get(id) || null; }, readEvents: () => [], stepsOf: () => [] });
  assert.equal(start(), 0, 'no run is new to the index');
  assert.deepEqual(read.sort(), [quiet.id, gone.id].sort(), 'only the runs that ended well with no reply are read again');
  assert.equal(m.getMeta('index_version'), memoryLib.INDEX_VERSION);
  assert.equal((await page(m, 'kittiwake colony')).results[0].runId, quiet.id);
  assert.equal(m.getRun(gone.id).reply, '', 'a run whose file is gone stays as it was');
  read.length = 0;
  start();
  assert.deepEqual(read, [], 'a second start reads nothing again');
  // Thousands of quiet runs, as a job that runs every few minutes leaves them: their old rows leave in one statement.
  const many = scratchMemory(t);
  const bulk = direct(t, many.dir);
  const quiets = Array.from({ length: 3000 }, (_, i) => runMeta({ id: `q-${String(i).padStart(5, '0')}`, startedAt: daysAgo(i % 300), trigger: 'schedule', jobName: 'Tide check', customPrompt: false, reporting: 'quiet', result: '', rawResult: `Reading ${i}: nothing moved in the harbour.` }));
  bulk.exec('BEGIN');
  const put = bulk.prepare("INSERT INTO runs (run_id, bot_id, bot_name, at, trigger, job, status, asked, reply, steps, learned, excluded) VALUES (?, 'alpha', 'Alpha', ?, 'schedule', 'Tide check', 'success', ?, '', '', '', 0)");
  const putFts = bulk.prepare("INSERT INTO runs_fts (run_id, bot_id, asked, reply, steps, learned) VALUES (?, 'alpha', ?, '', '', '')");
  for (const r of quiets) { put.run(r.id, r.startedAt, '(the scheduled job "Tide check")'); putFts.run(r.id, '(the scheduled job "Tide check")'); }
  bulk.exec('COMMIT');
  many.memory.setMeta('index_version', '4');
  const byId = new Map(quiets.map((r) => [r.id, r]));
  const t0 = performance.now();
  many.memory.backfill({ listRuns: () => quiets, readMeta: (id) => byId.get(id), readEvents: () => [], stepsOf: () => [] });
  const took = performance.now() - t0;
  assert.ok(took < 1000, `3,000 quiet runs were made again in ${took.toFixed(0)} ms`);
  assert.deepEqual([bulk.prepare('SELECT COUNT(*) AS c FROM runs_fts').get().c, bulk.prepare('SELECT COUNT(*) AS c FROM runs WHERE quiet = 1').get().c], [3000, 3000]);
  assert.equal((await many.memory.page({ query: 'reading 2999 harbour', runsOf: ['alpha'] })).results[0].runId, 'q-02999');
  // A database from before ADR 016 takes both steps in one start.
  const older = scratchMemory(t);
  older.memory.indexRun({ ...quiet, rawResult: undefined });
  older.memory.setMeta('index_version', '3');
  older.memory.backfill({ listRuns: () => [quiet], readMeta: () => quiet, readEvents: () => [], stepsOf: () => [] });
  assert.equal(older.memory.getMeta('index_version'), memoryLib.INDEX_VERSION);
  assert.ok(older.memory.getRun(quiet.id).reply.includes('KITTIWAKE'));
  assert.ok(dir);
});

test('indexing a new run deletes nothing from the search tables; indexing it again replaces its own rows', (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const db = direct(t, dir);
  const run = runMeta({ prompt: 'Survey the quarry', result: `${'The quarry face is stable. '.repeat(80)}The north ledge needs a fence.` });
  // Rows under this run's id that no run in the index owns: a delete by its id would take them.
  db.prepare('INSERT INTO runs_fts (run_id, bot_id, asked, reply, steps, learned) VALUES (?, ?, ?, ?, ?, ?)').run(run.id, 'alpha', 'planted', 'planted', '', '');
  db.prepare('INSERT INTO parts_fts (run_id, n, text) VALUES (?, ?, ?)').run(run.id, 99, 'planted');
  db.prepare("INSERT INTO embeddings (kind, ref, model, vec) VALUES ('run', ?, 'bge-m3', ?), ('part', ?, 'bge-m3', ?)").run(run.id, new Uint8Array(4), `${run.id}:99`, new Uint8Array(4));
  const count = (table, where = 'run_id = ?', arg = run.id) => db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get(arg).c;
  m.indexRun(run);
  const sections = count('run_parts');
  assert.ok(sections > 1);
  assert.deepEqual([count('runs_fts'), count('parts_fts'), count('embeddings', "ref = ? OR ref LIKE ? || ':%'", run.id) >= 1], [2, sections + 1, true], 'what was there is still there');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM embeddings WHERE ref = ? OR ref = ?').get(run.id, `${run.id}:99`).c, 2, 'and so are the vectors');
  // The same run again, with another reply: now it is in the index, and its rows are replaced.
  m.indexRun({ ...run, result: 'The quarry is closed.' });
  assert.deepEqual([count('runs_fts'), count('parts_fts'), count('run_parts')], [1, 0, 0]);
  assert.equal(m.getRun(run.id).reply, 'The quarry is closed.');
});

test('a run leaves the index whole, and what an older botdot left half-removed goes at the next start', async (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const db = direct(t, dir);
  const run = runMeta({ prompt: 'Survey the quarry', result: 'The quarry face is stable.' });
  m.indexRun(run);
  // As a stop between the deletes of an older botdot left it: gone from `runs`, still in the search table.
  db.prepare('DELETE FROM runs WHERE run_id = ?').run(run.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM runs_fts WHERE run_id = ?').get(run.id).c, 1);
  assert.equal(m.backfill({ listRuns: () => [run], readMeta: () => run, readEvents: () => [], stepsOf: () => [] }), 1, 'the run is indexed again from its file');
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM runs_fts WHERE run_id = ?').get(run.id).c, 1, 'once');
  const found = await page(m, 'quarry face');
  assert.deepEqual([found.results.length, found.total], [1, 1]);
  // Retention takes a run out of every table at once.
  m.indexRun(runMeta({ startedAt: daysAgo(900), prompt: 'An old survey', result: `${'Old findings. '.repeat(200)}` }));
  m.prune();
  for (const table of ['runs', 'runs_fts', 'run_parts', 'parts_fts']) assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c, table.startsWith('run_') || table === 'parts_fts' ? 0 : 1, table);
});

test('a prompt\'s pinned notes come with their ids, and a job\'s newest runs are found by its name', (t) => {
  const { memory: m } = scratchMemory(t);
  const a = m.addNote('alpha', 'Pinned one.').note;
  const b = m.addNote('alpha', 'Pinned two.').note;
  m.addNote('alpha', 'Not pinned.', { pinned: false });
  const p = m.forPrompt('alpha');
  assert.deepEqual(p.ids, [a.id, b.id]);
  assert.equal(p.text.split('\n').length, 2);
  assert.deepEqual(m.forPrompt('nobody').ids, []);

  const runs = [3, 1, 2].map((d) => runMeta({ startedAt: daysAgo(d), trigger: 'schedule', jobName: 'Tide check', customPrompt: false, result: `Day ${d}.` }));
  for (const r of runs) m.indexRun(r);
  m.indexRun(runMeta({ startedAt: daysAgo(0), trigger: 'schedule', jobName: 'Other job', customPrompt: false }));
  m.indexRun(runMeta({ startedAt: daysAgo(0), botId: 'beta', trigger: 'schedule', jobName: 'Tide check', customPrompt: false }));
  m.setExcluded(runs[1].id, true); // the newest is left out: it is still named, for the caller to see that it is
  assert.deepEqual(m.lastRunOfJob('alpha', 'Tide check'), [runs[1].id, runs[2].id, runs[0].id]);
  assert.deepEqual(m.lastRunOfJob('alpha', 'Tide check', 1), [runs[1].id]);
  assert.deepEqual(m.lastRunOfJob('alpha', ''), []);
});

// The scale test: 10,000 past runs, built by bulk insert in one transaction (a few seconds), then the two limits
// the milestone states. Each is the best of several tries, so a busy machine does not fail it. On the CI runners,
// which ran this three times slower than a laptop (a recall at 119 ms, 40 ms here), the limits are three times as wide.
test('with 10,000 past runs, indexing one run stays under 20 ms and a recall under 100 ms', async (t) => {
  const { memory: m, dir } = scratchMemory(t);
  const db = direct(t, dir);
  const words = 'harbour ledger invoice orchard turbine kettle marimba lantern quarry greenhouse sensor backup router invoice budget travel hiring licence meadow pelican'.split(' ');
  const pick = (i, k) => words[(i * 7 + k * 13) % words.length];
  const text = (i, n) => Array.from({ length: n }, (_, k) => pick(i, k)).join(' ');
  db.exec('BEGIN');
  const put = db.prepare('INSERT INTO runs (run_id, bot_id, bot_name, at, trigger, job, status, asked, reply, steps, learned, excluded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
  const fts = db.prepare('INSERT INTO runs_fts (run_id, bot_id, asked, reply, steps, learned) VALUES (?, ?, ?, ?, ?, ?)');
  const part = db.prepare('INSERT INTO run_parts (run_id, n, at, text) VALUES (?, ?, ?, ?)');
  const partFts = db.prepare('INSERT INTO parts_fts (run_id, n, text) VALUES (?, ?, ?)');
  for (let i = 0; i < 10_000; i++) {
    const id = `bulk-${String(i).padStart(5, '0')}`;
    const bot = i % 4 ? 'alpha' : 'beta';
    const asked = `Run ${i}: ${text(i, 12)}`;
    const reply = `${text(i + 3, 120)}.`;
    const steps = `read the file ${pick(i, 1)}.md\nsearched the web for "${pick(i, 2)}"`;
    put.run(id, bot, bot, daysAgo(i % 300), i % 5 ? 'manual' : 'schedule', i % 5 ? '' : 'Daily check', 'success', asked, reply, steps, '');
    fts.run(id, bot, asked, reply, steps, '');
    if (i % 10 === 0) for (let n = 0; n < 3; n++) { part.run(id, n, n * 1500, text(i + n, 200)); partFts.run(id, n, text(i + n, 200)); }
  }
  db.exec('COMMIT');
  for (let i = 0; i < 40; i++) m.addNote('alpha', `Note ${i}: ${text(i, 10)}.`, { pinned: false });
  assert.equal(m.stats().runs, 10_000);

  const best = async (tries, fn) => { let least = Infinity; for (let i = 0; i < tries; i++) { const t0 = performance.now(); await fn(i); least = Math.min(least, performance.now() - t0); } return least; };
  const fresh = (i) => runMeta({ id: `new-${i}-${crypto.randomUUID()}`, prompt: `Check the ${pick(i, 0)} ${pick(i, 1)} today`, result: `${text(i, 400)}. ${'More of it. '.repeat(300)}` });
  const index = await best(7, (i) => m.indexRun(fresh(i), ['read the file notes.md']));
  const recall = await best(7, (i) => page(m, `${pick(i, 0)} ${pick(i, 3)} invoice`, { limit: 25 }));
  const lookup = await best(5, (i) => m.relevantFor({ botId: 'alpha', text: `Please check the ${pick(i, 0)} ${pick(i, 3)} invoice and the budget for travel`, job: 'Daily check' }));
  const listing = await best(5, () => page(m, '', { limit: 25, offset: 5000 }));
  t.diagnostic(`10,000 runs: indexing one run ${index.toFixed(1)} ms, a recall ${recall.toFixed(1)} ms, a lookup ${lookup.toFixed(1)} ms, a page of the listing ${listing.toFixed(1)} ms`);
  const slack = process.env.CI ? 3 : 1;
  assert.ok(index < 20 * slack, `indexing one run took ${index.toFixed(1)} ms`);
  assert.ok(recall < 100 * slack, `a recall took ${recall.toFixed(1)} ms`);
  assert.ok((await page(m, 'harbour invoice', { limit: 25 })).results.length === 25);
});
