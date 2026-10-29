// The Company (#669, ADR 110): one company per account, made from a site or an idea, with teams of bots that each
// have exactly one lead, objectives and the owner's tasks. The Chief's tools may read it and change its teams and
// objectives, never make or delete it; a deleted bot leaves its team.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot } = require('./helpers');
const companyLib = require('../lib/company');

let srv; let a; let b; let c;
before(async () => {
  srv = await startServer();
  a = await makeBot(srv, { name: 'Outreach', emoji: '📣' });
  b = await makeBot(srv, { name: 'Lead Finder', emoji: '🔎' });
  c = await makeBot(srv, { name: 'Support Triage', emoji: '🧰' });
});
after(async () => { await srv.stop(); });

test('a site is told from an idea, and a site names the company', () => {
  for (const s of ['fernhill.app', 'https://www.fernhill.app/about', 'shop.example.co.uk']) assert.equal(companyLib.kindOf(s), 'site', s);
  for (const s of ['A meal-planning app for busy parents', 'fernhill', 'just.', '']) assert.equal(companyLib.kindOf(s), 'idea', s);
  assert.equal(companyLib.nameFrom('site', 'https://www.fernhill.app/x'), 'Fernhill');
  assert.equal(companyLib.nameFrom('idea', 'A meal planner'), '');
});

test('there is no company, then the owner makes one; a second is refused; the Chief may not make one', async () => {
  let r = await srv.api('/company');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { company: null });
  assert.equal((await srv.asChief('/company', { method: 'POST', body: { start: 'x.io' } })).status, 403);
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: '  ' } })).status, 400);
  r = await srv.api('/company', { method: 'POST', body: { start: 'fernhill.app', sources: [{ kind: 'link', url: 'linkedin.com/company/fernhill' }, { kind: 'file', upload: { name: 'deck.pdf', file: 'uploads/1-a-deck.pdf', size: 1200 } }, { kind: 'nope' }] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.kind, 'site');
  assert.equal(r.data.name, 'Fernhill');
  assert.equal(r.data.phase, 'setup');
  assert.equal(r.data.day, null);
  assert.deepEqual(r.data.sources.map((s) => [s.kind, s.name]), [['link', 'linkedin.com/company/fernhill'], ['file', 'deck.pdf']]);
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'other.io' } })).status, 409);
  assert.equal((await srv.asChief('/company')).status, 200);
  assert.ok((await srv.api('/version')).data.features.includes('company'));
});

test('answers are saved as given, cut to plain text; what is not a field is not kept', async () => {
  const r = await srv.api('/company', { method: 'PATCH', body: {
    name: 'Mealwise', goal: '10 parents use it every week', never: ['E-mail someone new', '', 'Spend money'], time: 'A few hours a week',
    about: [{ key: 'who', question: 'Who is it for?', answer: 'Parents of kids under 10', chips: ['Parents', 7] }, { question: '' }],
    stories: [{ who: 'users', items: [{ text: 'Create a weekly meal plan' }, { text: 'Share the plan', start: false }, { text: '' }] }],
    swot: { strengths: ['Plan and list in one tap'], weaknesses: [], opportunities: [], threats: ['WeekBite'], firstTest: 'Ask 10 parents to pre-order' },
    objectives: [{ name: 'Sign-ups', target: 50, current: 12 }, { name: '' }],
    phase: 'running', teams: [{ name: 'x', bots: [a.id] }], evil: '<script>',
  } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const co = r.data;
  assert.equal(co.name, 'Mealwise');
  assert.deepEqual(co.never, ['E-mail someone new', 'Spend money']);
  assert.deepEqual(co.about, [{ key: 'who', question: 'Who is it for?', answer: 'Parents of kids under 10', chips: ['Parents', '7'] }]);
  assert.deepEqual(co.stories, [{ who: 'users', items: [{ text: 'Create a weekly meal plan', start: true }, { text: 'Share the plan', start: false }] }]);
  assert.equal(co.swot.firstTest, 'Ask 10 parents to pre-order');
  assert.equal(co.objectives.length, 1);
  assert.match(co.objectives[0].id, /^[0-9a-f]{8}$/);
  assert.equal(co.phase, 'setup', 'the phase is not the owner’s to patch');
  assert.deepEqual(co.teams, [], 'teams change through their own routes');
  assert.equal(co.evil, undefined);
});

test('a team has exactly one lead; a bot is in one team; an empty team goes', async () => {
  let r = await srv.api('/company/teams', { method: 'POST', body: { name: 'Sales', bots: [a.id, b.id] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const sales = r.data.teams[0];
  assert.equal(sales.lead, a.id, 'the first bot leads when none is named');
  assert.equal((await srv.api('/company/teams', { method: 'POST', body: { name: 'X', bots: [c.id], lead: a.id } })).status, 400, 'the lead is one of its bots');
  assert.equal((await srv.api('/company/teams', { method: 'POST', body: { name: 'X', bots: ['nobody'] } })).status, 400);
  assert.equal((await srv.api('/company/teams', { method: 'POST', body: { name: '', bots: [c.id] } })).status, 400);
  assert.equal((await srv.api('/company/teams', { method: 'POST', body: { name: 'X', bots: [] } })).status, 400);

  // Moving the lead to the support team: Sales is led by the next bot.
  r = await srv.api('/company/teams', { method: 'POST', body: { name: 'Support', bots: [c.id, a.id], lead: c.id } });
  const [s1, s2] = r.data.teams;
  assert.deepEqual([s1.name, s1.bots, s1.lead], ['Sales', [b.id], b.id]);
  assert.deepEqual([s2.name, s2.bots, s2.lead], ['Support', [c.id, a.id], c.id]);
  assert.notEqual(s1.color, s2.color);

  // Make lead, rename; the Chief may change a team, not delete one.
  r = await srv.asChief(`/company/teams/${s2.id}`, { method: 'PUT', body: { lead: a.id, name: 'Help' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.teams[1].name, r.data.teams[1].lead], ['Help', a.id]);
  assert.equal((await srv.api(`/company/teams/${s2.id}`, { method: 'PUT', body: { lead: b.id } })).status, 400);
  assert.equal((await srv.asChief(`/company/teams/${s1.id}`, { method: 'DELETE' })).status, 403);

  // Its only bot goes to another team: the empty team goes.
  r = await srv.api(`/company/teams/${s2.id}`, { method: 'PUT', body: { bots: [c.id, a.id, b.id] } });
  assert.deepEqual(r.data.teams.map((t) => t.name), ['Help']);
  assert.equal((await srv.api('/company/teams/nope', { method: 'PUT', body: { lead: a.id } })).status, 404);
});

test('a deleted bot leaves its team and the next bot leads', async () => {
  const d = await makeBot(srv, { name: 'Temp', emoji: '⏳' });
  let r = await srv.api('/company/teams', { method: 'POST', body: { name: 'Temp team', bots: [d.id, c.id], lead: d.id } });
  const t = r.data.teams.find((x) => x.name === 'Temp team');
  assert.equal(t.lead, d.id);
  assert.equal((await srv.api(`/bots/${d.id}`, { method: 'DELETE' })).status, 200);
  r = await srv.api('/company');
  const after = r.data.company.teams.find((x) => x.id === t.id);
  assert.deepEqual([after.bots, after.lead], [[c.id], c.id]);
});

test("objectives move by the owner or the Chief's tool; tasks are the owner's", async () => {
  let r = await srv.api('/company');
  const o = r.data.company.objectives[0];
  r = await srv.asChief(`/company/objectives/${o.id}`, { method: 'PUT', body: { current: 14 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.objectives[0].current, 14);
  assert.equal((await srv.api(`/company/objectives/${o.id}`, { method: 'PUT', body: { current: 'a lot' } })).status, 400);
  assert.equal((await srv.api('/company/objectives/nope', { method: 'PUT', body: { current: 1 } })).status, 404);

  r = await srv.api('/company/todos', { method: 'POST', body: { text: 'Review notes for v2.3' } });
  assert.equal(r.status, 201);
  const todo = r.data.todos.at(-1);
  assert.deepEqual([todo.text, todo.done, todo.bot], ['Review notes for v2.3', false, undefined]);
  r = await srv.api(`/company/todos/${todo.id}`, { method: 'PUT', body: { done: true } });
  assert.equal(r.data.todos.at(-1).done, true);
  assert.equal((await srv.asChief('/company/todos', { method: 'POST', body: { text: 'x' } })).status, 403);
  assert.equal((await srv.api('/company/todos', { method: 'POST', body: { text: '' } })).status, 400);
  assert.equal((await srv.api('/company/todos', { method: 'POST', body: { text: 'x', bot: 'nobody' } })).status, 400);
  r = await srv.api(`/company/todos/${todo.id}`, { method: 'DELETE' });
  assert.ok(!r.data.todos.some((t) => t.id === todo.id));
});

test('"@Bot task" gives the bot the task as a message of the owner', async () => {
  const r = await srv.api('/company/todos', { method: 'POST', body: { text: 'Find 5 parents', bot: b.id } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.todos.at(-1).bot, b.id);
  const runs = (await srv.api(`/runs?botId=${b.id}&limit=5`)).data;
  assert.ok((runs.runs || runs).some((x) => x.prompt === 'Find 5 parents'), JSON.stringify(runs).slice(0, 400));
});

test('deleting the company keeps its bots', async () => {
  assert.equal((await srv.asChief('/company', { method: 'DELETE' })).status, 403);
  assert.equal((await srv.api('/company', { method: 'DELETE' })).status, 200);
  assert.deepEqual((await srv.api('/company')).data, { company: null });
  assert.ok((await srv.api(`/bots/${a.id}`)).status === 200);
});

test('the record reads a damaged or foreign file as it can, and counts the days from the start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-'));
  const file = path.join(dir, 'company.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'abc', start: 'x', phase: 'running', startedAt: '2026-10-01T09:00:00Z', teams: [{ name: 'T', bots: ['1', '1', '2'], lead: '9' }, { name: 'E', bots: [] }], checkins: [{ day: 30, decision: 'keep' }, { day: 31, decision: 'keep' }] }));
  const s = companyLib.create({ file, now: () => new Date('2026-10-23T08:00:00Z') });
  const co = s.read();
  assert.deepEqual(co.teams.map((t) => [t.bots, t.lead]), [[['1', '2'], '1']]);
  assert.deepEqual(co.checkins.map((k) => k.day), [30]);
  assert.equal(s.day(co), 22);
  assert.match(s.promptNote(), /day 22 of 90/);
  fs.rmSync(dir, { recursive: true, force: true });
});
