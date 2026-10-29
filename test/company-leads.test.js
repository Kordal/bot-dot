// A project's leads (#696): each item of the week's plan names a team, and once the owner approves the plan each
// team's lead is started on its items; a new lead asks the owner how often to report, the rhythm is kept on the team,
// and the lead's report shows on the project's page.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, writeData, self, waitFor } = require('./helpers');
const companyLib = require('../lib/company');

// A store on a file of its own, at a clock the test moves.
function storeAt(record, at) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-leads-')), 'company.json');
  fs.writeFileSync(file, JSON.stringify(record));
  const clock = { at };
  return { s: companyLib.create({ file, now: () => clock.at }), clock };
}
const RUNNING = { id: 'abc', start: 'x', phase: 'running', startedAt: '2026-10-01T09:00:00Z', objectives: [{ id: 'o1', name: 'Sign-ups', current: 1, target: 5 }],
  teams: [{ id: 't1', name: 'Growth', bots: ['a', 'b'], lead: 'a' }, { id: 't2', name: 'Support', bots: ['c'], lead: 'c' }] };

test('a plan item keeps the team that does it; one of no team is left without', () => {
  const { s } = storeAt(RUNNING, new Date(2026, 9, 27, 9));
  const c = s.setPlan({ items: [{ text: 'Ask 10 parents', objective: 'o1', team: 't1' }, { text: 'Answer tickets', team: 't2' }, { text: 'Book interviews', team: 'gone' }] });
  assert.deepEqual(c.plan.items, [{ text: 'Ask 10 parents', objective: 'o1', team: 't1' }, { text: 'Answer tickets', team: 't2' }, { text: 'Book interviews' }]);
  const { teams, loose } = s.planByTeam();
  assert.deepEqual(teams.map((x) => [x.team.id, x.items.map((i) => i.text)]), [['t1', ['Ask 10 parents']], ['t2', ['Answer tickets']]]);
  assert.deepEqual(loose.map((x) => x.text), ['Book interviews']);
});

test('a lead is asked once how often to report, and again when the team gets a new lead', () => {
  const { s } = storeAt(RUNNING, new Date(2026, 9, 27, 9));
  assert.deepEqual(s.leadsToAsk().map((t) => [t.id, t.lead]), [['t1', 'a'], ['t2', 'c']]);
  s.askedLead('t1', 'a');
  s.askedLead('t2', 'c');
  assert.deepEqual(s.leadsToAsk(), []);
  s.setTeam('t1', { lead: 'b' });
  assert.deepEqual(s.leadsToAsk().map((t) => [t.id, t.lead]), [['t1', 'b']]);
  const { s: setup } = storeAt({ ...RUNNING, phase: 'setup' }, new Date());
  assert.deepEqual(setup.leadsToAsk(), [], 'not while the project is set up');
});

test('only the lead keeps its rhythm and its report; the report comes due at the rhythm', () => {
  const { s, clock } = storeAt(RUNNING, new Date(2026, 9, 27, 9)); // a Tuesday
  assert.throws(() => s.setReport('b', 'weekly'), { status: 403 }, 'a member leads no team');
  assert.throws(() => s.setReport('a', 'hourly'), { status: 400 });
  let c = s.setReport('a', 'twice-weekly');
  assert.equal(c.teams[0].report, 'twice-weekly');
  assert.deepEqual(s.reportsDue(), []);
  clock.at = new Date(2026, 9, 27, 17, 5); // Tuesday 17:05
  assert.deepEqual(s.reportsDue().map((t) => t.id), ['t1']);
  s.reportStarted('t1');
  assert.deepEqual(s.reportsDue(), [], 'started once');
  clock.at = new Date(2026, 9, 30, 16, 0);
  assert.deepEqual(s.reportsDue(), [], 'Friday before 17:00');
  clock.at = new Date(2026, 9, 30, 17, 0);
  assert.deepEqual(s.reportsDue().map((t) => t.id), ['t1']);

  assert.throws(() => s.postReport('b', 'Done'), { status: 403 });
  assert.throws(() => s.postReport('a', ' \n '), { status: 400 });
  c = s.postReport('a', 'Done: page live\n\nBlocked: <b>nothing</b>');
  assert.deepEqual(c.teams[0].lastReport, { text: 'Done: page live\nBlocked: <b>nothing</b>', at: clock.at.toISOString(), bot: 'a' });
  // The owner switches reports off; a rhythm that is not one is refused.
  c = s.setTeam('t1', { report: null });
  assert.equal(c.teams[0].report, undefined);
  assert.throws(() => s.setTeam('t1', { report: 'often' }), { status: 400 });
});

let srv; let a; let b;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_LEAD_DELAY_MS: '0' } });
  a = await makeBot(srv, { name: 'Outreach', emoji: '📣' });
  b = await makeBot(srv, { name: 'Lead Finder', emoji: '🔎' });
  await srv.api('/company', { method: 'POST', body: { start: 'A meal-planning app for busy parents' } });
  const co = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), { ...co, phase: 'running', startedAt: new Date().toISOString(), objectives: [{ id: 'o1', name: 'Sign-ups', current: 0, target: 50 }] });
});
after(async () => { await srv.stop(); });

const runOf = (bot, words) => srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(words), `a run of ${bot.name} with "${words}"`);

test('a new lead asks how often to report; its answer is kept on the team, and its report shows on the page', async () => {
  srv.hold();
  let r = await srv.api('/company/teams', { method: 'POST', body: { name: 'Growth', bots: [a.id, b.id] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const team = r.data.teams[0];
  const asked = await runOf(a, 'how often you should send them the team');
  assert.equal(asked.self.env.SELF_LEAD, '1');
  await waitFor(async () => (await srv.api('/company')).data.company.teams[0].asked === a.id, { what: 'the lead marked asked' });

  // A member may not; the lead keeps what the owner answered, and posts its report.
  await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt: 'hi' } });
  const member = await runOf(b, 'hi');
  assert.equal(member.self.env.SELF_LEAD, '0');
  assert.equal((await self(srv, member.self.env.RUN_TOKEN, 'report-rhythm', { every: 'weekly' })).data.ok, false);
  assert.deepEqual((await self(srv, asked.self.env.RUN_TOKEN, 'report-rhythm', { every: 'weekly' })).data, { ok: true });
  assert.deepEqual((await self(srv, asked.self.env.RUN_TOKEN, 'team-report', { text: 'Done: landing page\nNeeds you: pick a price' })).data, { ok: true });
  srv.unhold();
  srv.release(asked);
  srv.release(member);
  const finished = await waitFor(async () => (await srv.api(`/runs?botId=${a.id}`)).data.find((x) => x.trigger === 'project' && x.status !== 'running'), { what: "the lead's run" });
  assert.equal(finished.notificationAudience, 'owner');
  let t = (await srv.api('/company')).data.company.teams[0];
  assert.equal(t.report, 'weekly');
  assert.deepEqual([t.lastReport.text, t.lastReport.bot], ['Done: landing page\nNeeds you: pick a price', a.id]);

  // The owner changes the rhythm on the page; the Chief may too.
  r = await srv.api(`/company/teams/${team.id}`, { method: 'PUT', body: { report: 'daily' } });
  assert.equal(r.data.teams[0].report, 'daily');
  r = await srv.asChief(`/company/teams/${team.id}`, { method: 'PUT', body: { report: 'often' } });
  assert.equal(r.status, 400);

  // A new lead is asked again.
  await srv.api(`/company/teams/${team.id}`, { method: 'PUT', body: { lead: b.id } });
  await runOf(b, 'how often you should send them the team');
  t = (await srv.api('/company')).data.company.teams[0];
  await waitFor(async () => (await srv.api('/company')).data.company.teams[0].asked === b.id, { what: 'the new lead marked asked' });
  await srv.api(`/company/teams/${team.id}`, { method: 'PUT', body: { lead: a.id } });
  await runOf(a, 'how often you should send them the team');
});

test("a lead's report counts a draft as done only when its file is in the project's folder", async () => {
  const co = (await srv.api('/company')).data.company;
  const raw = JSON.parse(fs.readFileSync(path.join(srv.data, 'company.json'), 'utf8'));
  const from = new Date(Date.now() - 3 * 86_400_000).toISOString();
  writeData(path.join(srv.data, 'company.json'), { ...raw, teams: raw.teams.map((t) => ({ ...t, report: 'daily', reportFrom: from })) });
  await srv.api(`/company/teams/${co.teams[0].id}`, { method: 'PUT', body: { name: 'Growth' } });
  const run = await runOf(a, 'daily report of team');
  assert.match(run.stdin, /First check the project's folder \(list_project_files, or the folder on your computer\): a draft, text or file counts as done or waiting for the owner only when it is there, whatever a run or a member said/);
});

test('approving the plan starts each lead on its team\'s items', async () => {
  const team = (await srv.api('/company')).data.company.teams[0];
  const r = await srv.asChief('/company/plan', { method: 'PUT', body: { items: [{ text: 'Ask 10 parents to pre-order', objective: 'o1', team: team.id }, { text: 'Write the FAQ', team: team.id }] } });
  assert.deepEqual(r.data.plan.items.map((x) => x.team), [team.id, team.id]);
  assert.equal((await srv.api('/company/plan/approve', { method: 'POST', body: {} })).status, 200);
  const run = await runOf(a, "The owner approved this week's plan");
  assert.match(run.stdin, /1\. Ask 10 parents to pre-order 2\. Write the FAQ/);
});
