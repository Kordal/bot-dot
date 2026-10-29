// Project settings (#701): what the settings page changes beyond the fields PATCH had, its site or idea (told apart
// again), its colour, the day its 90 days start and archived; and an archived project is one botdot starts nothing for.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, writeData, feed } = require('./helpers');

let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_COMPANY_EVERY_MS: '300', BOT_DOT_LEAD_DELAY_MS: 'off' } }); });
after(async () => { await srv.stop(); });

const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;
const one = async (id) => (await srv.api('/company/list')).data.projects.find((p) => p.id === id);
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

test('the server says it has project settings', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-settings'));
});

test('the site or idea, the colour and the start day change from settings; each change is sent to the apps', async () => {
  writeData(path.join(srv.data, 'company.json'), { projects: [
    { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt: '2026-10-01T00:00:00.000Z', color: '#ff6b35' },
    { id: 'p2', name: 'Mealwise', start: 'A meal planner', kind: 'idea', phase: 'setup', color: '#34c759' },
  ] });
  const live = await feed(srv);
  let r = await srv.api(at('/company', 'p1'), { method: 'PATCH', body: { start: 'A tool for dog walkers' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.start, r.data.kind, r.data.name], ['A tool for dog walkers', 'idea', 'Botdot']);
  await live.wait('project', (d) => d.id === 'p1' && d.project?.kind === 'idea');
  r = await srv.api(at('/company', 'p1'), { method: 'PATCH', body: { start: 'https://botdot.app' } });
  assert.equal(r.data.kind, 'site');
  assert.equal((await srv.api(at('/company', 'p1'), { method: 'PATCH', body: { start: '  ' } })).status, 400, 'never empty');

  r = await srv.api(at('/company', 'p1'), { method: 'PATCH', body: { color: '#3AA0FF' } });
  assert.equal(r.data.color, '#3aa0ff');
  assert.equal((await srv.api(at('/company', 'p1'), { method: 'PATCH', body: { color: 'red' } })).status, 400);

  r = await srv.api(at('/company', 'p1'), { method: 'PATCH', body: { startDay: '2026-10-20' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.startedAt, '2026-10-20T00:00:00.000Z');
  assert.equal((await srv.api(at('/company', 'p1'), { method: 'PATCH', body: { startDay: '2026-13-01' } })).status, 400);
  const setup = await srv.api(at('/company', 'p2'), { method: 'PATCH', body: { startDay: '2026-10-20' } });
  assert.equal(setup.status, 409, 'a project in setup has not started');
  assert.equal(setup.data.state, 'setup');
  live.close();
});

test('the Chief may not change a project’s settings', async () => {
  assert.equal((await srv.asChief(at('/company', 'p1'), { method: 'PATCH', body: { archived: true } })).status, 403);
});

test('archive hides nothing from the API but marks it, unarchive takes the mark off; delete removes the project', async () => {
  let r = await srv.api(at('/company', 'p2'), { method: 'PATCH', body: { archived: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.archived, true);
  assert.equal((await one('p2')).archived, true, 'still in the list, marked');
  assert.equal((await srv.api(at('/company', 'p2'), { method: 'PATCH', body: { archived: 'yes' } })).status, 400);
  r = await srv.api(at('/company', 'p2'), { method: 'PATCH', body: { archived: false } });
  assert.equal('archived' in r.data, false);
  assert.equal((await srv.api(at('/company', 'p2'), { method: 'DELETE' })).status, 200);
  assert.deepEqual((await srv.api('/company/list')).data.projects.map((p) => p.id), ['p1']);
});

test('botdot asks for no week’s plan of an archived project, and does once it is unarchived', async () => {
  writeData(path.join(srv.data, 'company.json'), { projects: [
    { id: 'a1', name: 'Kept', start: 'kept.app', kind: 'site', phase: 'running', startedAt: new Date().toISOString(), archived: true },
  ] });
  await new Promise((r) => setTimeout(r, 1200)); // a few of the looks, every 300 ms
  assert.equal((await one('a1')).planAsked, undefined, 'nothing asked for an archived project');
  await srv.api(at('/company', 'a1'), { method: 'PATCH', body: { archived: false } });
  assert.ok(await until(async () => !!(await one('a1')).planAsked), 'asked once it is back');
});
