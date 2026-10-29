// The board's pieces (#780): a project made from now on starts with an empty board, one made before shows every piece,
// and the owner sets the list with PATCH.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, writeData } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;

test('the server says it has the board pieces', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-board'));
});

test('a new project starts with an empty board; one made before has no board, so it shows every piece', async () => {
  writeData(path.join(srv.data, 'company.json'), { id: 'old', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt: '2026-10-01T00:00:00.000Z' });
  assert.equal('board' in (await srv.api(at('/company', 'old'))).data.company, false);
  const r = await srv.api('/company', { method: 'POST', body: { start: 'A tool for dog walkers' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const made = (await srv.api('/company/list')).data.projects.find((p) => p.id !== 'old');
  assert.deepEqual(made.board, []);
});

test('the owner sets the pieces in order, each once; anything else is refused and changes nothing', async () => {
  let r = await srv.api(at('/company', 'old'), { method: 'PATCH', body: { board: ['teams', 'goals', 'teams'] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.board, ['teams', 'goals']);
  r = await srv.api(at('/company', 'old'), { method: 'PATCH', body: { board: ['teams', 'whiteboard'] } });
  assert.equal(r.status, 400);
  assert.equal((await srv.api(at('/company', 'old'), { method: 'PATCH', body: { board: 'teams' } })).status, 400);
  assert.deepEqual((await srv.api(at('/company', 'old'))).data.company.board, ['teams', 'goals']);
  r = await srv.api(at('/company', 'old'), { method: 'PATCH', body: { board: [] } });
  assert.deepEqual(r.data.board, []);
});

test('the Chief may not change the board', async () => {
  assert.equal((await srv.asChief(at('/company', 'old'), { method: 'PATCH', body: { board: ['days'] } })).status, 403);
});
