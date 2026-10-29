// The project's calendar (#695, ADR 116): the owner, the Chief and the project's bots add events; the calendar also
// shows the day 30, 60 and 90 check-ins, the to-dos with a due day (a repeating one on the days it comes back) and the
// scheduled jobs of the project's bots, by day.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, makeBot, writeData, heldRun, self, feed } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const calendar = require('../lib/project-calendar');
const { today, addDays } = require('../lib/company');

// ---------- the range and the items, without a server ----------

test('the range is five weeks from this Monday unless given, and never longer than 62 days', () => {
  const now = new Date(2026, 9, 29, 10); // a Thursday
  assert.deepEqual(calendar.rangeOf({}, now), { from: '2026-10-26', to: '2026-11-29' });
  assert.deepEqual(calendar.rangeOf({ from: '2026-10-01', to: '2026-10-31' }, now), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(calendar.rangeOf({ from: '2026-01-01', to: '2026-12-31' }, now), { from: '2026-01-01', to: '2026-03-03' });
  assert.deepEqual(calendar.rangeOf({ from: 'soon', to: '2026-10-01' }, now), { from: '2026-10-26', to: '2026-11-29' });
});

test('check-ins, dated and repeating to-dos and jobs fall on their days', () => {
  const started = new Date(2026, 9, 1, 9);
  const c = {
    phase: 'running', startedAt: started.toISOString(), checkins: [{ day: 30, decision: 'keep' }],
    teams: [{ id: 't1', bots: ['b1'] }],
    events: [{ id: 'e1', title: 'Demo call: Ana', day: '2026-10-30', time: '10:00', by: 'b1' }, { id: 'e2', title: 'Launch', day: '2026-10-29', by: 'you' }],
    todos: [
      { id: 'w', text: 'Count active users', due: '2026-10-26', repeat: { every: 'week', days: [1] }, done: false },
      { id: 'n', text: 'No day', done: false },
      { id: 'd', text: 'Done one', due: '2026-10-27', done: true },
    ],
  };
  const bot = { id: 'b1', jobs: [
    { id: 'j1', name: 'Morning check', enabled: true, approved: true, cron: '30 8 * * 1-5' },
    { id: 'j2', name: 'Often', enabled: true, approved: true, cron: '0 * * * *' },
    { id: 'j3', name: 'Off', enabled: false, approved: true, cron: '0 9 * * *' },
    { id: 'j4', name: 'Waits', enabled: true, approved: false, cron: '0 9 * * *' },
  ] };
  const all = calendar.items(c, { from: '2026-10-26', to: '2026-11-09', bots: (id) => (id === 'b1' ? bot : null), now: new Date(2026, 9, 25) });
  const on = (day) => all.filter((x) => x.day === day);
  assert.deepEqual(on('2026-10-30').map((x) => [x.kind, x.title, x.time, x.runs]), [['checkin', undefined, undefined, undefined], ['job', 'Often', '00:00', 24], ['job', 'Morning check', '08:30', undefined], ['event', 'Demo call: Ana', '10:00', undefined]]);
  assert.deepEqual(all.find((x) => x.kind === 'checkin'), { kind: 'checkin', day: '2026-10-30', n: 30, decision: 'keep' }, 'day 30 of a project started on 1 October');
  assert.deepEqual(all.filter((x) => x.kind === 'todo').map((x) => [x.id, x.day, !!x.ahead, x.done]), [['w', '2026-10-26', false, false], ['d', '2026-10-27', false, true], ['w', '2026-11-02', true, false], ['w', '2026-11-09', true, false]]);
  assert.equal(all.filter((x) => x.title === 'Morning check').length, 11, 'weekdays only');
  assert.ok(!all.some((x) => x.title === 'Off' || x.title === 'Waits'), 'only switched-on, approved jobs');
  assert.equal(on('2026-10-29')[0].title, 'Launch', 'a whole-day event first');
  assert.match(calendar.itemLine(on('2026-10-30').find((x) => x.kind === 'event'), () => 'Launch Poster'), /^2026-10-30 10:00 Demo call: Ana \(event e1, added by Launch Poster\)$/);
});

test('a job is on the calendar from now on, a one-time job on its one day', () => {
  const daily = { id: 'b1', jobs: [{ id: 'j', name: 'Daily', enabled: true, approved: true, cron: '0 9 * * *' }] };
  const days = calendar.items({ teams: [{ bots: ['b1'] }] }, { from: '2026-11-01', to: '2026-11-07', bots: () => daily, now: new Date(2026, 10, 4, 12) }).map((x) => x.day);
  assert.deepEqual(days, ['2026-11-05', '2026-11-06', '2026-11-07'], 'none of the days gone, nor 9:00 of a day past it');
  const at = new Date(2026, 10, 3, 15, 0);
  const bot = { id: 'b1', jobs: [{ id: 'j', name: 'Once', enabled: true, approved: true, cron: '0 15 3 11 *', at: at.toISOString() }] };
  const all = calendar.items({ teams: [{ bots: ['b1'] }], todos: [], events: [], checkins: [] }, { from: '2026-11-01', to: '2026-11-30', bots: () => bot, now: new Date(2026, 9, 1) });
  assert.deepEqual(all.map((x) => [x.day, x.time]), [['2026-11-03', '15:00']]);
});

// ---------- against a botdot server ----------

let srv; let a; let b; let loner;
before(async () => {
  srv = await startServer();
  a = await makeBot(srv, { name: 'Cal Lead', emoji: '📣' });
  b = await makeBot(srv, { name: 'Cal Helper', emoji: '🔎' });
  loner = await makeBot(srv, { name: 'Cal Loner', emoji: '🚪' });
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'A planner for busy parents' } })).status, 201);
  const c = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), {
    ...c, name: 'Fernhill', phase: 'running', startedAt: new Date().toISOString(),
    teams: [{ id: 't1', name: 'Growth', bots: [a.id, b.id], lead: a.id }],
  });
});
after(() => { srv.unhold(); return srv.stop(); });

const events = async () => (await srv.api('/company')).data.company.events;

test('the owner adds, moves and deletes an event; the calendar has it beside the check-ins and jobs', async (t) => {
  assert.ok((await srv.api('/version')).data.features.includes('project-calendar'));
  const f = await feed(srv);
  t.after(() => f.close());
  const day = addDays(today(new Date()), 1);
  let r = await srv.api('/company/events', { method: 'POST', body: { title: 'Launch posts go out', day, time: '18:00' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const e = r.data.events.at(-1);
  assert.deepEqual([e.title, e.day, e.time, e.by], ['Launch posts go out', day, '18:00', 'you']);
  await f.wait('company', (d) => d.company?.events.some((x) => x.id === e.id));

  r = await srv.api('/company/calendar');
  assert.equal(r.status, 200);
  assert.ok(r.data.items.some((x) => x.kind === 'event' && x.id === e.id && x.day === day && x.time === '18:00'));
  assert.deepEqual(r.data.items.filter((x) => x.kind === 'checkin').map((x) => x.n), [30].filter((n) => addDays(today(new Date()), n - 1) <= r.data.to));

  r = await srv.api(`/company/events/${e.id}`, { method: 'PUT', body: { day: addDays(day, 2), time: '' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const moved = r.data.events.find((x) => x.id === e.id);
  assert.deepEqual([moved.day, moved.time], [addDays(day, 2), undefined]);
  r = await srv.api(`/company/events/${e.id}`, { method: 'DELETE' });
  assert.ok(!r.data.events.some((x) => x.id === e.id));
});

test('what the owner may not save is refused', async () => {
  for (const body of [{ title: '', day: '2026-11-01' }, { title: 'x' }, { title: 'x', day: '2026-02-30' }, { title: 'x', day: '2026-11-01', time: '25:00' }]) {
    assert.equal((await srv.api('/company/events', { method: 'POST', body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await srv.api('/company/events/nope', { method: 'PUT', body: { title: 'y' } })).status, 404);
});

test("the Chief reads the calendar and adds, moves and deletes events", async () => {
  let r = await srv.asChief('/company/events', { method: 'POST', body: { title: 'Demo call: Marek', day: '2099-03-03', time: '10:00' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const e = r.data.events.at(-1);
  assert.equal(e.by, 'chief');
  r = await srv.asChief('/company/calendar?from=2099-03-01&to=2099-03-31');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.items.filter((x) => x.kind === 'event').map((x) => x.title), ['Demo call: Marek']);
  assert.equal((await srv.asChief(`/company/events/${e.id}`, { method: 'PUT', body: { time: '11:00' } })).status, 200);
  assert.equal((await srv.asChief(`/company/events/${e.id}`, { method: 'DELETE' })).status, 200);
});

test("a dated to-do and a bot's job show on the calendar", async () => {
  await srv.api('/company/todos', { method: 'POST', body: { text: 'Pay the domain', due: '2099-04-02' } });
  const bot = (await srv.api(`/bots/${b.id}`)).data;
  const r = await srv.api(`/bots/${b.id}`, { method: 'PUT', body: { ...bot, jobs: [{ name: 'Weekly report', kind: 'ai', cron: '0 9 * * 1', prompt: 'Report.', enabled: true }] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const items = (await srv.api('/company/calendar?from=2099-03-30&to=2099-04-12')).data.items;
  assert.deepEqual(items.map((x) => [x.kind, x.day, x.title]), [['job', '2099-03-30', 'Weekly report'], ['todo', '2099-04-02', 'Pay the domain'], ['job', '2099-04-06', 'Weekly report']]);
  assert.equal(items[0].bot, b.id);
});

test('a bot of the project reads the calendar and adds an event; it moves only its own', async (t) => {
  const { id: other } = (await srv.api('/company/events', { method: 'POST', body: { title: "The owner's dentist", day: '2099-05-06' } })).data.events.at(-1);
  const { rec, token } = await heldRun(srv, a, 'What is on the calendar?');
  assert.equal(rec.self.env.SELF_PROJECT, '1');
  assert.match(rec.system, /It also has a calendar: list_project_calendar/);

  let r = (await self(srv, token, 'calendar', { action: 'add', title: 'Demo call: Ana', day: '2099-05-05', time: '10:00' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  const mine = (await events()).at(-1);
  assert.deepEqual([mine.title, mine.by], ['Demo call: Ana', a.id]);
  r = (await self(srv, token, 'calendar', { action: 'list', from: '2099-05-05', to: '2099-05-10' })).data;
  assert.match(r.text, /^2099-05-05 to 2099-05-10:\n2099-05-05 10:00 Demo call: Ana \(event \w+, added by Cal Lead\)\n2099-05-06 The owner's dentist \(event \w+, added by the owner\)$/);
  r = (await self(srv, token, 'calendar', { action: 'set', id: mine.id, day: '2099-05-06' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /^Now: 2099-05-06 10:00 Demo call: Ana/);
  r = (await self(srv, token, 'calendar', { action: 'set', id: other, title: 'Mine now' })).data;
  assert.equal(r.ok, false, 'not its event');
  assert.equal((await self(srv, token, 'calendar', { action: 'remove', id: other })).data.ok, false);
  const tools = rpcClient(t, 'self-mcp.js', rec.self.env);
  assert.deepEqual((await tools.request('tools/list')).tools.map((x) => x.name).filter((n) => /project_(calendar|event)/.test(n)), ['list_project_calendar', 'add_project_event', 'set_project_event', 'remove_project_event']);
  assert.match(await tools.text('list_project_calendar', { from: '2099-05-01', to: '2099-05-10' }), /Demo call: Ana/);
  assert.equal((await self(srv, token, 'calendar', { action: 'remove', id: mine.id })).data.ok, true);
  srv.unhold();
});

test('a bot in no team of the project is refused', async () => {
  const { token } = await heldRun(srv, loner, 'Hello.');
  const r = (await self(srv, token, 'calendar', { action: 'list' })).data;
  assert.deepEqual([r.ok, r.error], [false, 'You are in no team of a project.']);
  srv.unhold();
});
