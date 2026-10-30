// The Company (#669, ADR 110): one company per account, made from a site or an idea, with teams of bots that each
// have exactly one lead, objectives and the owner's tasks. The Chief's tools may read it and change its teams and
// objectives, never make or delete it; a deleted bot leaves its team.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, writeData, waitFor } = require('./helpers');
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

test('there is no company, then the owner makes one; the Chief may not make one', async () => {
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

test("objectives move by the owner or the Chief's tool; only the owner deletes a task (#692)", async () => {
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
  assert.equal((await srv.asChief(`/company/todos/${todo.id}`, { method: 'DELETE' })).status, 403);
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

// A running company on its day `day`, with two objectives and the bots a and b in a team.
async function running(day, more = {}) {
  const c = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), {
    ...c, phase: 'running', startedAt: new Date(Date.now() - (day - 1) * 86_400_000 - 3_600_000).toISOString(),
    objectives: [{ id: 'o1', name: 'Sign-ups', current: 20, target: 50 }, { id: 'o2', name: 'Paying users', current: 0, target: 4 }],
    teams: [{ id: 't1', name: 'Growth', bots: [a.id, b.id], lead: a.id }], checkins: [], plan: null, suggestion: null, ...more,
  });
}

test('a check-in waits from day 30 until it is answered; Stop switches off the jobs of the company\'s bots', async () => {
  await running(12);
  assert.equal((await srv.api('/company')).data.company.checkin, null, 'none before day 30');
  await running(31);
  let co = (await srv.api('/company')).data.company;
  assert.equal(co.day, 31);
  assert.equal(co.checkin.day, 30);
  // 30 of the 90 days gone: 20 / 50 is on track, 0 / 4 behind.
  assert.deepEqual(co.checkin.objectives.map((o) => [o.id, o.onTrack]), [['o1', true], ['o2', false]]);
  assert.ok(srv.api('/version').then((r) => r.data.features.includes('company-checkins')));
  assert.equal((await srv.asChief('/company/checkins', { method: 'POST', body: { day: 30, decision: 'keep' } })).status, 403);
  assert.equal((await srv.api('/company/checkins', { method: 'POST', body: { day: 30, decision: 'maybe' } })).status, 400);
  assert.equal((await srv.api('/company/checkins', { method: 'POST', body: { day: 60, decision: 'keep' } })).status, 409);
  let r = await srv.api('/company/checkins', { method: 'POST', body: { day: 30, decision: 'keep' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.company.checkin, null);
  assert.deepEqual(r.data.company.checkins.map((k) => [k.day, k.decision]), [[30, 'keep']]);
  assert.equal(r.data.paused, undefined);
  assert.equal((await srv.api('/company/checkins', { method: 'POST', body: { day: 30, decision: 'keep' } })).status, 409, 'answered once');

  // Day 61: Stop. Every job of a and b is switched off; c, in no team, keeps its own.
  await running(61, { checkins: [{ day: 30, decision: 'keep', at: null }] });
  co = (await srv.api('/company')).data.company;
  assert.equal(co.checkin.day, 60);
  const on = async (id) => (await srv.api(`/bots/${id}`)).data.jobs.filter((j) => j.enabled).length;
  const before = { a: await on(a.id), b: await on(b.id), c: await on(c.id) };
  r = await srv.api('/company/checkins', { method: 'POST', body: { day: 60, decision: 'stop' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.paused, before.a + before.b);
  assert.deepEqual([await on(a.id), await on(b.id), await on(c.id)], [0, 0, before.c]);
});

test('the Chief drafts the week\'s plan; the owner approves it or asks for a change', async () => {
  await running(10);
  assert.equal((await srv.api('/company/plan/approve', { method: 'POST', body: {} })).status, 404);
  assert.equal((await srv.asChief('/company/plan', { method: 'PUT', body: { items: [] } })).status, 400);
  let r = await srv.asChief('/company/plan', { method: 'PUT', body: { items: [{ text: 'Ask 10 parents to pre-order', objective: 'o2' }, { text: 'Get the page to 25 sign-ups', objective: 'o1' }, { text: 'Book 5 interviews', objective: 'nope' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.plan.items, [{ text: 'Ask 10 parents to pre-order', objective: 'o2' }, { text: 'Get the page to 25 sign-ups', objective: 'o1' }, { text: 'Book 5 interviews' }]);
  assert.equal(r.data.plan.approved, false);
  assert.equal(r.data.plan.week, companyLib.weekOf(new Date()));
  assert.equal((await srv.asChief('/company/plan/approve', { method: 'POST', body: {} })).status, 403);
  assert.equal((await srv.api('/company/plan/change', { method: 'POST', body: { text: ' ' } })).status, 400);
  r = await srv.api('/company/plan/change', { method: 'POST', body: { text: 'Less outreach this week' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await srv.api('/company/plan/approve', { method: 'POST', body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.plan.approved, true);
  // Both were the Chief's turns: they landed in a Chief chat.
  await waitFor(async () => (await srv.api('/chief')).data.chats.some((x) => x.title === 'Project'), { what: 'a Chief chat' });
});

test('a new week is due once a plan of it was neither drafted nor asked for', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-'));
  const file = path.join(dir, 'company.json');
  const monday = new Date(2026, 10, 2, 9); // Monday 2 November 2026, local time
  fs.writeFileSync(file, JSON.stringify({ id: 'abc', start: 'x', phase: 'running', startedAt: '2026-10-01T09:00:00Z', plan: { items: [{ text: 'x' }], week: '2026-10-26' } }));
  const s = companyLib.create({ file, now: () => monday });
  assert.equal(companyLib.weekOf(new Date(2026, 10, 8, 23)), '2026-11-02', 'a Sunday is the end of its week');
  assert.equal(s.planDue(), '2026-11-02');
  s.planAsked('2026-11-02');
  assert.equal(s.planDue(), null, 'asked once a week');
  assert.equal(s.planDue(undefined, new Date(2026, 10, 9, 0, 30)), '2026-11-09');
  s.setPlan({ items: [{ text: 'y' }] });
  assert.equal(s.read().plan.week, '2026-11-02');
  assert.match(s.promptNote(), /This week's plan \(waits for the owner\): y/);
  assert.match(s.promptNote(), /The day 30 check-in waits for the owner\./);
  assert.match(s.promptNote(), /suggest_company_bot/);
  fs.writeFileSync(file, JSON.stringify({ id: 'abc', start: 'x', phase: 'setup' }));
  assert.equal(s.planDue(), null, 'not while it is set up');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the Chief suggests one bot at a time; Add makes it in its team, dismiss keeps its name from coming back', async () => {
  await running(20);
  assert.equal((await srv.asChief('/company/suggestion', { method: 'PUT', body: { name: 'Support Desk' } })).status, 400);
  assert.equal((await srv.asChief('/company/suggestion', { method: 'PUT', body: { name: 'Support Desk', prompt: 'Answer sign-up questions.', why: 'Sign-ups are coming in', team: 'gone' } })).status, 400);
  let r = await srv.asChief('/company/suggestion', { method: 'PUT', body: { name: 'Support Desk', description: 'Answers questions from your first users', prompt: 'Answer sign-up questions.', why: 'Sign-ups are coming in', team: 't1' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.suggestion.name, 'Support Desk');
  assert.equal((await srv.asChief('/company/suggestion', { method: 'PUT', body: { name: 'Other', prompt: 'x', why: 'y' } })).status, 409, 'one at a time');
  assert.equal((await srv.asChief('/company/suggestion/add', { method: 'POST', body: {} })).status, 403);
  r = await srv.api('/company/suggestion/add', { method: 'POST', body: {} });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.suggestion, null);
  const made = (await srv.api('/bots')).data.find((x) => x.name === 'Support Desk');
  assert.ok(made, 'the bot is made');
  assert.deepEqual(r.data.teams[0].bots, [a.id, b.id, made.id]);

  r = await srv.asChief('/company/suggestion', { method: 'PUT', body: { name: 'Billing Helper', prompt: 'Answer billing.', why: 'First payments' } });
  assert.equal(r.status, 200);
  r = await srv.api('/company/suggestion', { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.suggestion, r.data.dismissed], [null, ['Billing Helper']]);
  assert.equal((await srv.asChief('/company/suggestion', { method: 'PUT', body: { name: 'billing helper', prompt: 'x', why: 'y' } })).status, 409);
  assert.equal((await srv.api('/company/suggestion', { method: 'DELETE' })).status, 404);
  // A suggestion without a team still lands in the project (#816): the first team.
  assert.equal((await srv.asChief('/company/suggestion', { method: 'PUT', body: { name: 'Ops Helper', prompt: 'Watch the queue.', why: 'Orders pile up' } })).status, 200);
  r = await srv.api('/company/suggestion/add', { method: 'POST', body: {} });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const ops = (await srv.api('/bots')).data.find((x) => x.name === 'Ops Helper');
  assert.ok(r.data.teams[0].bots.includes(ops.id));
  for (const x of [made, ops]) assert.equal((await srv.api(`/bots/${x.id}`, { method: 'DELETE' })).status, 200);
});

test('a bot added from a suggestion in a project with no team gets a team of its own (#816)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-'));
  const file = path.join(dir, 'company.json');
  fs.writeFileSync(file, JSON.stringify({ id: 'abc', name: 'My Gym', start: 'x', phase: 'running', startedAt: '2026-10-01T09:00:00Z', teams: [], suggestion: { name: 'Coach', prompt: 'Plan workouts.', why: 'y', at: '2026-10-01T09:00:00Z' } }));
  const s = companyLib.create({ file });
  s.added('b_coach');
  const c = s.read();
  assert.equal(c.suggestion, null);
  assert.equal(c.teams.length, 1);
  assert.deepEqual([c.teams[0].name, c.teams[0].bots, c.teams[0].lead], ['My Gym', ['b_coach'], 'b_coach']);
  fs.rmSync(dir, { recursive: true, force: true });
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
