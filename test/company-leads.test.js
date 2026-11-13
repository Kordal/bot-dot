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

test('a lead given its rhythm by the owner does not ask for it; a new lead alone still asks (#1087)', () => {
  const { s } = storeAt(RUNNING, new Date(2026, 9, 27, 9));
  s.setTeam('t1', { report: 'weekly' });
  assert.deepEqual(s.leadsToAsk().map((t) => t.id), ['t2'], 'the owner just picked Growth\'s rhythm');
  s.setTeam('t2', { lead: 'c', report: 'daily' });
  assert.deepEqual(s.leadsToAsk(), []);
  s.setTeam('t1', { lead: 'b' });
  assert.deepEqual(s.leadsToAsk().map((t) => [t.id, t.lead]), [['t1', 'b']], 'a new lead asks once, as ADR 118 says');
  s.setTeam('t1', { report: null });
  assert.deepEqual(s.leadsToAsk().map((t) => t.id), ['t1'], 'turning the report off answers nothing');
  const n = s.addTeam({ name: 'Ops', bots: ['d'], report: 'twice-weekly' }).teams.at(-1);
  assert.equal(n.asked, 'd', 'a new team with a rhythm already');
  assert.equal(s.addTeam({ name: 'Ads', bots: ['e'] }).teams.at(-1).asked, undefined);
});

test('a team whose lead was not started on the approved plan is still to start, this week only (#1082)', () => {
  const { s, clock } = storeAt(RUNNING, new Date(2026, 9, 27, 9));
  s.setPlan({ items: [{ text: 'Ask 10 parents', team: 't1' }, { text: 'Answer tickets', team: 't2' }] });
  assert.deepEqual(s.planToStart(), [], 'not before it is approved');
  s.approvePlan();
  assert.deepEqual(s.planToStart().map((x) => x.team.id), ['t1', 't2']);
  s.planStarted('t1');
  assert.deepEqual(s.planToStart().map((x) => x.team.id), ['t2'], 'one start was refused: it is tried again');
  assert.deepEqual(s.read().plan.started, ['t1']);
  clock.at = new Date(2026, 10, 3, 9);
  assert.deepEqual(s.planToStart(), [], "not last week's plan");
  clock.at = new Date(2026, 9, 27, 9);
  s.setPlan({ items: [{ text: 'New', team: 't1' }] });
  assert.equal(s.read().plan.started, undefined, 'a new plan starts again');
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

test('legacy report tools keep working, without automatic questions for each lead', async () => {
  srv.hold();
  let r = await srv.api('/company/teams', { method: 'POST', body: { name: 'Growth', bots: [a.id, b.id] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const team = r.data.teams[0];
  await srv.api(`/bots/${a.id}/run`, { method: 'POST', body: { prompt: 'Keep the report rhythm I asked for' } });
  const asked = await runOf(a, 'Keep the report rhythm I asked for');
  assert.equal(asked.self.env.SELF_LEAD, '1');
  assert.equal((await srv.api('/company')).data.company.teams[0].asked, undefined, 'no per-lead setup question');

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
  const finished = await waitFor(async () => (await srv.api(`/runs?botId=${a.id}`)).data.find((x) => x.prompt === 'Keep the report rhythm I asked for' && x.status !== 'running'), { what: "the lead's run" });
  assert.equal(finished.notificationAudience, 'owner');
  let t = (await srv.api('/company')).data.company.teams[0];
  assert.equal(t.report, 'weekly');
  assert.deepEqual([t.lastReport.text, t.lastReport.bot], ['Done: landing page\nNeeds you: pick a price', a.id]);

  // The owner changes the rhythm on the page; the Chief may too.
  r = await srv.api(`/company/teams/${team.id}`, { method: 'PUT', body: { report: 'daily' } });
  assert.equal(r.data.teams[0].report, 'daily');
  r = await srv.asChief(`/company/teams/${team.id}`, { method: 'PUT', body: { report: 'often' } });
  assert.equal(r.status, 400);

  // Changing the lead no longer starts another report-preference interview.
  const before = (await srv.api('/runs')).data.length;
  await srv.api(`/company/teams/${team.id}`, { method: 'PUT', body: { lead: b.id } });
  await srv.api(`/company/teams/${team.id}`, { method: 'PUT', body: { lead: a.id } });
  assert.equal((await srv.api('/runs')).data.length, before);
});

test('a saved lead report is included in one project update rather than starting another report run', async () => {
  const co = (await srv.api('/company')).data.company;
  const raw = JSON.parse(fs.readFileSync(path.join(srv.data, 'company.json'), 'utf8'));
  const from = new Date(Date.now() - 3 * 86_400_000).toISOString();
  writeData(path.join(srv.data, 'company.json'), { ...raw, teams: raw.teams.map((t) => ({ ...t, report: 'daily', reportFrom: from })) });
  const before = (await srv.api('/runs')).data.length;
  await srv.api(`/company/teams/${co.teams[0].id}`, { method: 'PUT', body: { name: 'Growth' } });
  const r = await srv.api('/company/updates/now', { method: 'POST', body: { key: 'saved-team-report' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.update.text, /Done: landing page/);
  assert.equal((await srv.api('/runs')).data.length, before, 'Chief snapshot starts no bot run');
});

test('approving the plan starts each lead on its team\'s items', async () => {
  const team = (await srv.api('/company')).data.company.teams[0];
  const r = await srv.asChief('/company/plan', { method: 'PUT', body: { items: [{ text: 'Ask 10 parents to pre-order', objective: 'o1', team: team.id }, { text: 'Write the FAQ', team: team.id }] } });
  assert.deepEqual(r.data.plan.items.map((x) => x.team), [team.id, team.id]);
  assert.equal((await srv.api('/company/plan/approve', { method: 'POST', body: {} })).status, 200);
  const run = await runOf(a, "The owner approved this week's plan");
  assert.match(run.stdin, /1\. Ask 10 parents to pre-order 2\. Write the FAQ/);
  assert.deepEqual((await srv.api('/company')).data.company.plan.started, [team.id], 'the start is kept, so it is not tried again (#1082)');
});
