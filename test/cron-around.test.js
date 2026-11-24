// A job the owner asked for without a clock time runs around its time (lib/cron.js "A loose time", docs/decisions/
// 2026-11-24-a-job-with-no-clock-time-runs-around-its-time.md): the schedule's time plus an offset of up to 15 minutes
// either way, a different one each day, the same after a restart. Whether a minute is a run (due), the next run (next)
// and the last run in a downtime (lastDueBetween) read one set of runs: none runs twice and none is lost.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const cron = require('../lib/cron');
const { dueAt, nextRun, lastDueBetween, normalizeJob, whenWords, definitionOf, JOB_GUIDE } = require('../lib/jobs');

const MIN = 60_000;
const iso = (t) => new Date(t).toISOString().slice(0, 16);
// The minutes from `from` up to `to` at which the job is due, by asking each minute.
const dueMinutes = (job, from, to) => {
  const out = [];
  for (let t = Date.parse(from); t < Date.parse(to); t += MIN) if (dueAt(job, new Date(t))) out.push(t);
  return out;
};
const job = (cronExpr, extra = {}) => ({ id: 'jabc123', cron: cronExpr, around: true, enabled: true, approved: true, ...extra });

test('a daily job runs once a day, within 15 minutes of its time, and not at the same minute every day', () => {
  const runs = dueMinutes(job('0 8 * * *'), '2026-06-01T00:00Z', '2026-07-01T00:00Z'); // 30 days
  assert.equal(runs.length, 30);
  const minutes = new Set();
  runs.forEach((t, i) => {
    const day = Date.parse(`2026-06-${String(i + 1).padStart(2, '0')}T08:00Z`);
    assert.ok(Math.abs(t - day) <= 15 * MIN, `${iso(t)} is within 15 minutes of 08:00`);
    minutes.add((t - day) / MIN);
  });
  assert.ok(minutes.size >= 12, `${minutes.size} different offsets in 30 days`);
  assert.ok([...minutes].some((m) => m < 0) && [...minutes].some((m) => m > 0), 'before and after the time');
});

test('every offset from -15 to +15 comes up, and no other', () => {
  const offs = new Set();
  const j = job('0 8 * * *', { id: 'jspread' });
  for (let d = 0; d < 400; d++) {
    const at = nextRun(j, new Date(Date.UTC(2026, 0, 1 + d, 0, 0)));
    offs.add((at.getTime() - Date.UTC(2026, 0, 1 + d, 8)) / MIN);
  }
  assert.ok([...offs].every((o) => Number.isInteger(o) && o >= -15 && o <= 15));
  assert.equal(offs.size, 31, 'all 31 minutes');
});

test('the minute is the job\'s own: two jobs on the same time do not run together every day', () => {
  const a = dueMinutes(job('0 8 * * *', { id: 'ja' }), '2026-06-01T00:00Z', '2026-06-21T00:00Z');
  const b = dueMinutes(job('0 8 * * *', { id: 'jb' }), '2026-06-01T00:00Z', '2026-06-21T00:00Z');
  const same = a.filter((t, i) => t === b[i]).length;
  assert.ok(same <= 5, `${same} of 20 days at the same minute`);
});

test('it is the same after a restart: the minute depends on the job and the day alone', () => {
  const j = job('0 8 * * *');
  const first = dueMinutes(j, '2026-06-01T00:00Z', '2026-06-10T00:00Z');
  delete require.cache[require.resolve('../lib/cron')];
  delete require.cache[require.resolve('../lib/jobs')];
  const again = require('../lib/jobs');
  const second = [];
  for (let t = Date.parse('2026-06-01T00:00Z'); t < Date.parse('2026-06-10T00:00Z'); t += MIN) if (again.dueAt(j, new Date(t))) second.push(t);
  assert.deepEqual(second, first);
});

test('due, next and lastDueBetween agree: every run is found by each, none twice', () => {
  for (const expr of ['0 8 * * *', '30 7 * * 1-5', '0 8,20 * * *', '5 0 * * *', '55 23 * * *', '0 9 1 * *', '15 6 * * 0']) {
    const j = job(expr, { id: `j-${expr}` });
    const runs = dueMinutes(j, '2026-03-01T00:00Z', '2026-05-15T00:00Z');
    assert.ok(runs.length > 0, expr);
    // next, chained from just before the first run, lists the same runs in the same order
    const chain = [];
    for (let at = nextRun(j, new Date(Date.parse('2026-03-01T00:00Z') - MIN)); at && at < Date.parse('2026-05-15T00:00Z'); at = nextRun(j, at)) chain.push(at.getTime());
    assert.deepEqual(chain, runs, `${expr}: next lists the minutes that are due`);
    assert.equal(new Set(runs).size, runs.length, expr);
    // the last run of a downtime is the last that is due in it
    for (const [a, b] of [['2026-03-10T00:00Z', '2026-03-20T12:00Z'], ['2026-04-01T08:00Z', '2026-04-01T08:30Z'], ['2026-04-02T23:59Z', '2026-04-04T00:01Z']]) {
      const inside = runs.filter((t) => t > Date.parse(a) && t < Date.parse(b));
      const got = lastDueBetween(j, new Date(a), new Date(b));
      assert.equal(got ? got.getTime() : null, inside.length ? inside.at(-1) : null, `${expr}: ${a} to ${b}`);
    }
  }
});

test('a run moved before its time by a negative offset is not lost, by a downtime that starts after the time', () => {
  const j = job('0 8 * * *', { id: 'jneg' });
  // The first day whose run is before 08:00.
  let day = 1;
  while (nextRun(j, new Date(Date.UTC(2026, 5, day, 0, 0))).getTime() >= Date.UTC(2026, 5, day, 8)) day++;
  const run = nextRun(j, new Date(Date.UTC(2026, 5, day, 0, 0)));
  assert.ok(run.getTime() < Date.UTC(2026, 5, day, 8));
  // botdot was off from before the run to 08:01, after the schedule's time: the run was missed, and is caught up.
  const got = lastDueBetween(j, new Date(run.getTime() - 5 * MIN), new Date(Date.UTC(2026, 5, day, 8, 1)));
  assert.equal(got.getTime(), run.getTime());
  // and a downtime that ends before it misses nothing.
  assert.equal(lastDueBetween(j, new Date(run.getTime() - 60 * MIN), new Date(run.getTime())), null);
  // The scheduler looked at the minute of the run, then was off: that run is not caught up again.
  assert.ok(!(lastDueBetween(j, run, new Date(Date.UTC(2026, 5, day, 12, 0)))), 'a run it already made is not caught up');
});

test('a run moved past midnight keeps the day of its time: 00:05 can run at 23:52 the evening before', () => {
  const j = job('5 0 * * *', { id: 'jmid' });
  const runs = dueMinutes(j, '2026-05-31T12:00Z', '2026-06-30T12:00Z');
  assert.equal(runs.length, 30);
  const before = runs.filter((t) => new Date(t).getUTCHours() === 23);
  assert.ok(before.length > 3, 'some run the evening before');
  assert.ok(runs.every((t, i) => i === 0 || t - runs[i - 1] > 23 * 60 * MIN), 'a run a day');
  // Off over the evening: the run before midnight, whose time comes after, is caught up once.
  const early = before[0];
  const caught = lastDueBetween(j, new Date(early - 10 * MIN), new Date(Date.UTC(2026, 5, 30, 0, 0)));
  assert.ok(caught, 'caught up');
  assert.equal(dueAt(j, caught), true);
  assert.equal(lastDueBetween(j, new Date(early), new Date(early + 3 * 60 * MIN)), null, 'it ran: not caught up again');
});

test('a job on a list of times runs around each of them', () => {
  const j = job('0 8,20 * * *', { id: 'jtwo' });
  const runs = dueMinutes(j, '2026-06-01T00:00Z', '2026-06-04T00:00Z');
  assert.equal(runs.length, 6);
  for (const t of runs) {
    const h = new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes();
    assert.ok(Math.abs(h - 480) <= 15 || Math.abs(h - 1200) <= 15, iso(t));
  }
});

test('a schedule that is not at a fixed time of day, and a one-time job, run on their time', () => {
  for (const expr of ['*/15 * * * *', '0 * * * *', '30 */2 * * *']) {
    const made = normalizeJob({ name: 'x', kind: 'ai', cron: expr, around: true }, null, 'you');
    assert.equal(made.around, undefined, expr);
  }
  const once = normalizeJob({ name: 'x', kind: 'ai', at: '2099-10-02T07:00', around: true }, null, 'you');
  assert.equal(once.around, undefined);
  assert.equal(dueAt({ id: 'jx', cron: '30 7 * * *', at: '2026-06-01T07:30:00.000Z', around: true }, new Date('2026-06-01T07:30:00Z')), true, 'exactly then');
  assert.equal(nextRun({ id: 'jx', cron: '30 7 * * *', at: '2099-06-01T07:30:00.000Z', around: true }, new Date('2099-01-01')).toISOString(), '2099-06-01T07:30:00.000Z');
});

test('a job without the flag runs on the minute, as before', () => {
  const j = { id: 'jplain', cron: '0 8 * * *', enabled: true, approved: true };
  assert.deepEqual(dueMinutes(j, '2026-06-01T00:00Z', '2026-06-03T00:00Z').map(iso), ['2026-06-01T08:00', '2026-06-02T08:00']);
  assert.equal(nextRun(j, new Date('2026-06-01T08:00Z')).toISOString(), '2026-06-02T08:00:00.000Z');
});

test('the flag is part of what a job does: changing it is a change to the schedule', () => {
  const approved = normalizeJob({ name: 'Morning', kind: 'ai', cron: '0 8 * * *', prompt: 'p', around: true }, null, 'you');
  assert.equal(approved.around, true);
  assert.equal(approved.approved, true);
  // A script job of the owner's, and an AI job the owner approved: the bot's own edit of the flag waits.
  const script = normalizeJob({ name: 'S', kind: 'script', script: 'echo hi', cron: '0 8 * * *' }, null, 'you');
  const looser = normalizeJob({ ...script, around: true }, script, 'bot');
  assert.equal(looser.approved, true);
  assert.equal(looser.around, undefined, 'still approved as it was');
  assert.equal(looser.change.job.around, true, 'the change waits with the flag');
  assert.equal(definitionOf(looser).around, undefined);
  assert.equal(definitionOf({ ...script, around: true }).around, true);
  // Back to exact: also a change.
  const loose = normalizeJob({ ...script, around: true }, script, 'you');
  assert.equal(loose.around, true, 'the owner\'s own edit is made at once');
  const exact = normalizeJob({ ...loose, around: false }, loose, 'bot');
  assert.equal(exact.around, true, 'still around until the owner says yes');
  assert.equal(exact.change.job.around, undefined);
  // Nothing said keeps it.
  assert.equal(normalizeJob({ name: 'Morning renamed' }, approved, 'you').around, true);
  // The owner's own edit is made at once.
  assert.equal(normalizeJob({ around: false }, approved, 'you').around, undefined);
});

test('the words say around: "Daily around 08:00"', () => {
  assert.equal(whenWords(job('0 8 * * *')), 'Daily around 08:00');
  assert.equal(whenWords(job('0 8 * * *'), 'pl'), 'Codziennie około 08:00');
  assert.equal(whenWords(job('30 7 * * 1-5')), 'Weekdays around 07:30');
  assert.equal(whenWords(job('30 7 * * 1-5'), 'pl'), 'W dni robocze około 07:30');
  assert.equal(whenWords(job('0 2 * * *')), 'Daily around 02:00', 'not Nightly at 02:00');
  assert.equal(whenWords(job('0 9 * * 1')), 'Mondays around 09:00');
  assert.equal(whenWords(job('0 8,20 * * *')), 'Daily around 08:00 and 20:00');
  assert.equal(whenWords(job('0 8 * * *', { around: false })), 'Daily at 08:00');
  assert.equal(whenWords(job('0 8 * * *', { call: true })), 'Daily around 08:00, and when called');
  assert.equal(whenWords(job('*/15 * * * *')), 'Every 15 min', 'no time to be loose about');
});

test('the guide tells the Chief and the bots when to set it', () => {
  assert.match(JOB_GUIDE, /"around": true/);
  assert.match(JOB_GUIDE, /named a clock time/);
});
