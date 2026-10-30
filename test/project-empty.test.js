// An empty project (#788): made from the first screen with no setup, no answers and no team; it starts at once on
// its blank board, named as the app says until the owner names it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;

test('the server says it makes empty projects', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-empty'));
});

test('an empty project runs at once on a blank board, with no setup, answers or team', async () => {
  const r = await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Nowy projekt' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const c = r.data;
  assert.equal(c.name, 'Nowy projekt');
  assert.equal(c.phase, 'running');
  assert.equal(c.start, '');
  assert.ok(c.startedAt);
  assert.deepEqual(c.board, []);
  assert.deepEqual(c.teams, []);
  assert.deepEqual(c.sources, []);
  assert.equal(c.proposal, null);
  assert.equal(c.goal, '');
  // Its home's New card works, and it can be named later.
  const card = await srv.api(at('/company/cards', c.id), { method: 'POST', body: { ask: 'Show the open tasks' } });
  assert.equal(card.status, 201, JSON.stringify(card.data));
  const named = await srv.api(at('/company', c.id), { method: 'PATCH', body: { name: 'HomeKeep' } });
  assert.equal(named.data.name, 'HomeKeep');
  assert.ok((await srv.api('/company/list')).data.projects.some((p) => p.id === c.id && p.phase === 'running'));
});

test('without a name it is a New project; without empty a start is still needed; the Chief may not make one', async () => {
  const r = await srv.api('/company', { method: 'POST', body: { empty: true } });
  assert.equal(r.status, 201);
  assert.equal(r.data.name, 'New project');
  assert.equal((await srv.api('/company', { method: 'POST', body: { empty: 'yes' } })).status, 400);
  assert.equal((await srv.api('/company', { method: 'POST', body: {} })).status, 400);
  assert.equal((await srv.asChief('/company', { method: 'POST', body: { empty: true } })).status, 403);
});
