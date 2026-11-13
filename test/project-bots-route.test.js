// The project's own bots over the API (ADR 233): PUT /api/company/bots sets them, a bot that is gone is refused, and a
// bot in no team is told the project in its run and uses the project's to-do.
const path = require('path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, self, writeData, heldRun } = require('./helpers');

let srv; let writer; let other;
before(async () => {
  srv = await startServer();
  writer = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
  other = await makeBot(srv, { name: 'Weather', emoji: '☀️' });
  writeData(path.join(srv.data, 'company.json'), { id: 'c1', name: 'Fernhill', start: 'fernhill.app', phase: 'running', startedAt: '2026-10-01T00:00:00Z', goal: '100 paying parents', teams: [] });
});
after(() => srv.stop());

test('PUT /api/company/bots sets the project\'s own bots and refuses a bot that is gone', async () => {
  const r = await srv.api('/company/bots', { method: 'PUT', body: { bots: [writer.id] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.bots, [writer.id]);
  assert.equal((await srv.api('/company/bots', { method: 'PUT', body: { bots: ['nobody'] } })).status, 400);
  assert.equal((await srv.api('/company/bots', { method: 'PUT', body: { bots: 'x' } })).status, 400);
});

test('a bot in no team is told the project and uses its to-do; a bot of no project is not', async () => {
  await srv.api('/company/bots', { method: 'PUT', body: { bots: [writer.id] } });
  const { run, rec, token } = await heldRun(srv, writer, 'What is on?');
  assert.match(rec.system, /You are a bot of the owner's project "Fernhill", in none of its teams/);
  const r = (await self(srv, token, 'todos', { action: 'add', text: 'Draft the post', who: 'me' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok((await srv.api('/company')).data.company.todos.some((x) => x.text === 'Draft the post'));
  srv.unhold(); srv.release(rec); await srv.finished(run.id);
  const o = await heldRun(srv, other, 'Hi');
  assert.doesNotMatch(o.rec.system, /Fernhill/);
  srv.unhold(); srv.release(o.rec); await srv.finished(o.run.id);
});

test('a deleted bot leaves the project', async () => {
  await srv.api('/company/bots', { method: 'PUT', body: { bots: [writer.id, other.id] } });
  assert.equal((await srv.api(`/bots/${other.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await srv.api('/company')).data.company.bots, [writer.id]);
});
