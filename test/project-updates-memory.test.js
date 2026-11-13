// Server-written project receipts stay owner-visible without becoming a second model source for forgotten text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scratchMemory, runMeta } = require('./memory-helpers');

const update = () => runMeta({ kind: 'project-update', trigger: 'project', projectUpdate: 'garden-snapshot', prompt: '', result: 'PRIVATE_ORCHID: the orchard gate code is recorded in the project update.' });
const recalled = (m) => m.search({ query: 'PRIVATE_ORCHID', notesOf: [], runsOf: ['alpha'] });

test('generated updates stay out of recall, automatic lookup and memory review after indexing', async (t) => {
  const { memory: m } = scratchMemory(t);
  const r = update();
  m.indexRun(r);
  assert.equal(m.leftOut(r), true);
  assert.equal(m.leftOut(r.id), true);
  assert.deepEqual(m.runsSince('alpha', ''), []);
  assert.deepEqual(await recalled(m), []);
  assert.deepEqual(await m.relevantFor({ botId: 'alpha', text: 'What is the PRIVATE_ORCHID orchard gate code?' }), []);
  m.setExcluded(r.id, false);
  assert.equal(m.leftOut(r.id), true, 'a generated receipt cannot become a model source through a recall toggle');
  m.indexRun({ ...r, kind: 'ai', projectUpdate: undefined });
  assert.deepEqual(await recalled(m), [], 'reindexing preserves its stored classification');
  const plan = runMeta({ trigger: 'project', prompt: 'Approved garden work', result: 'The approved plan is ready.' });
  m.indexRun(plan);
  assert.equal(m.leftOut(plan.id), false, 'ordinary project work remains available');
  assert.deepEqual(m.runsSince('alpha', '').map((x) => x.run_id), [plan.id]);
});

test('startup backfill classifies a generated receipt that was already indexed by an earlier build', async (t) => {
  const { memory: m } = scratchMemory(t);
  const r = update();
  const legacy = { ...r, kind: 'ai', projectUpdate: undefined };
  m.backfill({ listRuns: () => [legacy], readMeta: () => legacy, readEvents: () => [], stepsOf: () => [] });
  assert.equal((await recalled(m)).length, 1, 'the legacy index really contains this text');
  m.backfill({ listRuns: () => [r], readMeta: () => r, readEvents: () => [], stepsOf: () => [] });
  assert.equal(m.leftOut(r.id), true);
  assert.deepEqual(m.runsSince('alpha', ''), []);
  assert.deepEqual(await recalled(m), []);
});
