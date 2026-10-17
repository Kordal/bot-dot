// Deterministic HTTP embeddings exercise indexing/ranking/failure mechanics. Real model quality is
// covered separately by memory-bge-m3.test.js; these vectors deliberately are not an AI substitute.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { once } = require('events');
const { scratchMemory, runMeta, daysAgo } = require('./memory-helpers');

async function service(t) {
  const state = { healthy: true, error: false, requests: [], hold: null };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') { res.writeHead(state.healthy ? 200 : 503); return res.end('{}'); }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    state.requests.push(body);
    if (state.hold) { const hold = state.hold; state.hold = null; await hold(body); }
    if (state.error) { res.writeHead(503); return res.end(JSON.stringify({ error: { message: 'test embedding outage' } })); }
    // Non-unit vectors in reversed response order catch missing normalization and ordering.
    const data = body.input.map((text, index) => ({ index, embedding: /violet|petal/i.test(text) ? [6, 8, 0] : [0, 0, 5] })).reverse();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const previous = process.env.EMBED_URL;
  process.env.EMBED_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    if (previous === undefined) delete process.env.EMBED_URL; else process.env.EMBED_URL = previous;
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const fixture = scratchMemory(t);
  fixture.memory.setSemanticSettings({ enabled: true });
  return { ...fixture, state };
}

const search = (m, query, extra = {}) => m.search({ query, notesOf: ['alpha', '_shared'], runsOf: ['alpha'], limit: 25, ...extra });

test('semantic-only matches honor bot/shared scope, kinds, recency, exclusions and normalized response order', async (t) => {
  const { memory: m, state } = await service(t);
  const note = m.addNote('alpha', 'Violet greenhouse', { pinned: false }).note;
  m.addNote('alpha', 'A submarine', { pinned: false });
  const shared = m.addNote('_shared', 'Violet preference').note;
  m.addNote('beta', 'Private violet');
  m.addNote('alpha', 'Old violet', { createdAt: daysAgo(90), pinned: false });
  const run = runMeta({ result: 'Violet inspection' });
  const excluded = runMeta({ result: 'Violet excluded' });
  for (const r of [run, excluded, runMeta({ botId: 'beta', result: 'Violet private run' })]) m.indexRun(r);
  m.setExcluded(excluded.id, true);
  assert.equal(await m.embedPending(20), 7);
  const hits = await search(m, 'petal', { days: 7 });
  assert.deepEqual(new Set(hits.map((x) => x.id || x.runId)), new Set([note.id, shared.id, run.id]));
  assert.equal((await search(m, 'petal', { kinds: ['runs'] })).length, 1);
  assert.ok((await search(m, 'petal', { kinds: ['notes'] })).every((x) => x.kind === 'note'));
  assert.equal((await search(m, 'petal', { notesOf: [], runsOf: 'all', kinds: ['runs'] })).length, 2);
  assert.equal(await m.embedPending(), 0, 'unchanged content is not re-embedded');
  assert.ok(state.requests.every((r) => r.model === 'bge-m3'));
  assert.equal((await m.semanticStatus()).last.ok, true);
});

test('normal note edits/deletion and run reindexing invalidate old vectors', async (t) => {
  const { memory: m } = await service(t);
  const note = m.addNote('alpha', 'Violet note').note;
  const run = runMeta({ result: 'Violet run' });
  m.indexRun(run);
  assert.equal(await m.embedPending(), 2);
  m.editNote('alpha', note.id, 'Submarine note');
  m.indexRun({ ...run, result: 'Submarine run' });
  assert.equal((await m.semanticStatus()).done, 0);
  assert.equal(await m.embedPending(), 3, 'the note, the run, and the note\'s earlier version');
  assert.deepEqual(await search(m, 'petal'), [], 'what is true now has another meaning');
  assert.deepEqual((await search(m, 'petal', { history: true })).map((r) => [r.kind, r.text]), [['old', 'Violet note']]);
  m.removeNote('alpha', note.id);
  const status = await m.semanticStatus();
  assert.deepEqual([status.done, status.total], [2, 3], 'the run and the first version; the deleted one waits');
});

test('unhealthy or failing embedding services fall back to lexical recall without losing notes', async (t) => {
  const { memory: m, state } = await service(t);
  const note = m.addNote('alpha', 'Violet fallback').note;
  await m.embedPending();
  state.error = true;
  assert.equal((await search(m, 'violet'))[0].id, note.id);
  assert.match((await m.semanticStatus()).last.error, /test embedding outage/);
  state.healthy = false;
  assert.equal((await search(m, 'violet'))[0].id, note.id);
  assert.deepEqual(await search(m, 'petal'), []);
  assert.equal(await m.embedPending(), 0);
  state.healthy = true;
  state.error = false;
  assert.equal((await search(m, 'petal'))[0].id, note.id, 'recovery reuses intact vectors');
  m.setSemanticSettings({ enabled: false });
  assert.deepEqual(await search(m, 'petal'), []);
  assert.equal((await search(m, 'violet'))[0].id, note.id);
});

test('a failed embedding batch is retried, and concurrent requests do not start duplicate batches', async (t) => {
  const { memory: m, state } = await service(t);
  m.addNote('alpha', 'Violet retry');
  state.error = true;
  assert.equal(await m.embedPending(), 0);
  assert.equal((await m.semanticStatus()).done, 0);
  state.error = false;
  let entered;
  const started = new Promise((r) => { entered = r; });
  let release;
  state.hold = async () => { entered(); await new Promise((r) => { release = r; }); };
  const first = m.embedPending();
  await started;
  try { assert.equal(await m.embedPending(), 0); } finally { release(); }
  assert.equal(await first, 1);
  assert.equal((await m.semanticStatus()).done, 1);
});

test('REGRESSION: editing a note during embedding must not permanently attach a stale vector', async (t) => {
  const { memory: m, state } = await service(t);
  const note = m.addNote('alpha', 'Violet original').note;
  let entered, release;
  const started = new Promise((r) => { entered = r; });
  state.hold = async () => { entered(); await new Promise((r) => { release = r; }); };
  const pending = m.embedPending();
  await started;
  m.editNote('alpha', note.id, 'Submarine replacement');
  release();
  await pending;
  await m.embedPending();
  assert.deepEqual(await search(m, 'petal'), [], 'the changed note must no longer match the old meaning');
});

test('deleting a note, changing a run or leaving a run out during embedding stores no vector for it', async (t) => {
  const { memory: m, state } = await service(t);
  const note = m.addNote('alpha', 'Violet doomed').note;
  const changed = runMeta({ result: 'Violet first' });
  const left = runMeta({ result: 'Violet private' });
  m.indexRun(changed);
  m.indexRun(left);
  let entered, release;
  const started = new Promise((r) => { entered = r; });
  state.hold = async () => { entered(); await new Promise((r) => { release = r; }); };
  const pending = m.embedPending();
  await started;
  m.removeNote('alpha', note.id);
  m.indexRun({ ...changed, result: 'Submarine second' });
  m.setExcluded(left.id, true);
  release();
  assert.equal(await pending, 0);
  assert.equal(await m.embedPending(), 2, 'the changed run again, and the deleted note as an earlier version');
  assert.deepEqual(await search(m, 'petal'), []);
  const status = await m.semanticStatus();
  assert.deepEqual([status.done, status.total], [2, 2]);
});

for (const operation of ['removeOwner', 'forgetRunsOfBot', 'forgetChat', 'prune', 'setExcluded']) {
  test(`REGRESSION: semantic index accounting stays valid after ${operation}`, async (t) => {
    const { memory: m } = await service(t);
    if (operation === 'removeOwner') m.addNote('alpha', 'Violet note');
    else m.indexRun(runMeta({ id: 'chief-example-1', botId: operation === 'forgetChat' ? 'chief' : 'alpha', result: 'Violet run', startedAt: daysAgo(400) }));
    await m.embedPending();
    assert.equal((await m.semanticStatus()).done, 1);
    if (operation === 'removeOwner') m.removeOwner('alpha');
    if (operation === 'forgetRunsOfBot') m.forgetRunsOfBot('alpha');
    if (operation === 'forgetChat') m.forgetChat('example');
    if (operation === 'prune') m.prune();
    if (operation === 'setExcluded') m.setExcluded('chief-example-1', true);
    assert.deepEqual(await search(m, 'petal', { runsOf: 'all' }), [], 'removed content is never returned');
    const status = await m.semanticStatus();
    assert.ok(status.done <= status.total, `${operation}: UI reports ${status.done} indexed of ${status.total} eligible records`);
  });
}

test('indexing a run again keeps its vector while its text is the same', async (t) => {
  const { memory: m } = await service(t);
  const run = runMeta({ result: 'Violet unchanged' });
  m.indexRun(run);
  assert.equal(await m.embedPending(), 1);
  m.indexRun(run);
  assert.equal((await m.semanticStatus()).done, 1);
  assert.equal(await m.embedPending(), 0);
  m.indexRun({ ...run, result: 'Submarine changed' });
  assert.equal((await m.semanticStatus()).done, 0);
});

test('sections of a long reply get their own vectors: a meaning found only at the end points to that section', async (t) => {
  const { memory: m } = await service(t);
  const body = Array.from({ length: 40 }, (_, i) => `Line ${i}: the pump and the valves were fine.`).join('\n\n');
  const run = runMeta({ result: `${body}\n\nAt the very end: the violet flowers bloomed.` });
  m.indexRun(run);
  while (await m.embedPending(16));
  const status = await m.semanticStatus();
  assert.ok(status.total > 2 && status.done === status.total, JSON.stringify([status.done, status.total]));
  const [hit] = await search(m, 'petal', { kinds: ['runs'] });
  assert.equal(hit.runId, run.id);
  assert.equal(hit.part, hit.parts, 'the last section');
  assert.equal(run.result.slice(hit.from).includes('violet'), true, 'read_run from there reaches it');
  m.setExcluded(run.id, true);
  assert.deepEqual(await search(m, 'petal', { kinds: ['runs'] }), []);
  assert.equal((await m.semanticStatus()).total, 0);
  m.setExcluded(run.id, false);
  m.forgetRunsOfBot('alpha');
  await m.embedPending();
  assert.deepEqual([(await m.semanticStatus()).done, (await m.semanticStatus()).total], [0, 0], 'section vectors are swept up');
});
