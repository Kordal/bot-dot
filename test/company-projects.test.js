// Several projects per account (#689, ADR 115): the company of ADR 110 becomes the first project of a list. Every
// route takes `?project=<id>`, without it the first, as older apps had their one company; each project keeps its own
// teams, goal and objectives, and a bot is in at most one team of each project.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, writeData, feed } = require('./helpers');
const companyLib = require('../lib/company');

let srv; let a; let b;
before(async () => {
  srv = await startServer();
  a = await makeBot(srv, { name: 'Outreach', emoji: '📣' });
  b = await makeBot(srv, { name: 'Lead Finder', emoji: '🔎' });
});
after(async () => { await srv.stop(); });

const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;

test('the company there was is the first project, kept as it was in its file', async () => {
  writeData(path.join(srv.data, 'company.json'), { id: 'old1', name: 'Fernhill', start: 'fernhill.app', kind: 'site', phase: 'running', startedAt: new Date().toISOString(), goal: '50 sign-ups', teams: [{ id: 't1', name: 'Growth', bots: [a.id], lead: a.id }] });
  assert.ok((await srv.api('/version')).data.features.includes('projects-many'));
  const r = await srv.api('/company/list');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.projects.map((c) => [c.id, c.name, c.goal]), [['old1', 'Fernhill', '50 sign-ups']]);
  assert.match(r.data.projects[0].color, /^#[0-9a-f]{6}$/);
  assert.equal((await srv.api('/company')).data.company.id, 'old1');
  assert.equal((await srv.asChief('/company/list')).status, 200, 'the Chief may read the list');
});

test('a second project is made beside the first; each keeps its own teams, goal and objectives', async () => {
  const live = await feed(srv);
  let r = await srv.api('/company', { method: 'POST', body: { start: 'A meal-planning app for busy parents' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const second = r.data.id;
  assert.notEqual(second, 'old1');
  assert.notEqual(r.data.color, (await srv.api('/company')).data.company.color, 'a colour of its own');
  await live.wait('project', (d) => d.id === second && d.project?.id === second);
  // Older apps are never handed the second: their `company` is the first.
  assert.ok(live.events.filter((e) => e.type === 'company').every((e) => e.data.company?.id === 'old1'));

  r = await srv.api(at('/company', second), { method: 'PATCH', body: { name: 'Mealwise', goal: '10 parents a week', objectives: [{ name: 'Parents', target: 10, current: 2 }] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // The same bot leads a team in each project.
  r = await srv.api(at('/company/teams', second), { method: 'POST', body: { name: 'Kitchen', bots: [a.id, b.id] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.teams.map((t) => [t.name, t.lead]), [['Kitchen', a.id]]);
  const first = (await srv.api('/company')).data.company;
  assert.deepEqual([first.name, first.goal, first.objectives, first.teams.map((t) => t.bots)], ['Fernhill', '50 sign-ups', [], [[a.id]]]);
  const list = (await srv.api('/company/list')).data.projects;
  assert.deepEqual(list.map((c) => [c.name, c.goal]), [['Fernhill', '50 sign-ups'], ['Mealwise', '10 parents a week']]);

  // The Chief's tools name the project; one that is not there is 404.
  r = await srv.asChief(at(`/company/objectives/${list[1].objectives[0].id}`, second), { method: 'PUT', body: { current: 4 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.objectives[0].current, 4);
  assert.equal((await srv.asChief(at('/company', 'nope'))).status, 404);

  // With two projects the file holds them both.
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'company.json'), 'utf8'));
  assert.deepEqual(kept.projects.map((c) => c.id), ['old1', second]);
  live.close();
});

test('a deleted bot leaves its team in every project', async () => {
  const extra = await makeBot(srv, { name: 'Temp', emoji: '🧪' });
  const second = (await srv.api('/company/list')).data.projects[1].id;
  await srv.api('/company/teams', { method: 'POST', body: { name: 'One', bots: [extra.id] } });
  await srv.api(at('/company/teams/' + (await srv.api(at('/company', second))).data.company.teams[0].id, second), { method: 'PUT', body: { bots: [a.id, b.id, extra.id] } });
  assert.equal((await srv.api(`/bots/${extra.id}`, { method: 'DELETE' })).status, 200);
  const list = (await srv.api('/company/list')).data.projects;
  assert.ok(list.every((c) => c.teams.every((t) => !t.bots.includes(extra.id))), JSON.stringify(list.map((c) => c.teams)));
});

test('deleting the first makes the next one the first, and older apps are told', async () => {
  const live = await feed(srv);
  const [first, second] = (await srv.api('/company/list')).data.projects.map((c) => c.id);
  assert.equal((await srv.api(at('/company', first), { method: 'DELETE' })).status, 200);
  await live.wait('project', (d) => d.id === first && d.project === null);
  await live.wait('company', (d) => d.company?.id === second);
  assert.equal((await srv.api('/company')).data.company.id, second);
  // One project again: the file is its record, as an older server reads it.
  assert.equal(JSON.parse(fs.readFileSync(path.join(srv.data, 'company.json'), 'utf8')).id, second);
  live.close();
});

test('the Chief is told each project with its id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-'));
  const file = path.join(dir, 'company.json');
  fs.writeFileSync(file, JSON.stringify({ projects: [{ id: 'p1', name: 'Fernhill', start: 'x', goal: 'G1' }, { id: 'p2', name: 'Mealwise', start: 'y', goal: 'G2' }, { id: 'p1', name: 'dup', start: 'z' }] }));
  const s = companyLib.create({ file });
  assert.deepEqual(s.list().map((c) => c.id), ['p1', 'p2'], 'a repeated id is read once');
  const note = s.promptNote();
  assert.match(note, /project p1: Fernhill .*project: "p1"/);
  assert.match(note, /project p2: Mealwise .*project: "p2"/);
  assert.match(note, /90-day goal: G2/);
  assert.equal(s.of('p2').read().name, 'Mealwise');
  // A bot in a team of each project is told of both.
  fs.writeFileSync(file, JSON.stringify({ projects: [{ id: 'p1', name: 'Fernhill', start: 'x', teams: [{ id: 't1', name: 'Growth', bots: ['b1'] }] }, { id: 'p2', name: 'Mealwise', start: 'y', teams: [{ id: 't2', name: 'Kitchen', bots: ['b2', 'b1'] }] }] }));
  const told = s.botNote('b1');
  assert.match(told, /You lead team "Growth" in the owner's project "Fernhill"/);
  assert.match(told, /You are on team "Kitchen" in the owner's project "Mealwise"/);
  assert.equal(s.of('gone').read(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
