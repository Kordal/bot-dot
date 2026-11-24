// A job that runs around its time (lib/cron.js "A loose time") on the days daylight saving time moves the clock: it runs
// once each day, whether its time is in the hour the clock skips or repeats, or a few minutes after the jump.
// due, next and lastDueBetween agree there too. This file sets its own time zone, as cron-dst.test.js does.
process.env.TZ = 'Europe/Warsaw';
const test = require('node:test');
const assert = require('node:assert/strict');
const cron = require('../lib/cron');
const { dueAt, nextRun, lastDueBetween } = require('../lib/jobs');

const MIN = 60_000;
const job = (cronExpr, id = 'jdst') => ({ id, cron: cronExpr, around: true, enabled: true, approved: true });
const runsBetween = (j, from, to) => {
  const out = [];
  for (let t = Date.parse(from); t < Date.parse(to); t += MIN) if (dueAt(j, new Date(t))) out.push(t);
  return out;
};
// The days around the two changes of 2026: 29 March (23 hours) and 25 October (25 hours).
const WINDOWS = [['2026-03-25T00:00Z', '2026-04-03T00:00Z'], ['2026-10-21T00:00Z', '2026-10-30T00:00Z']];

test('the zone of this file has DST', () => {
  assert.deepEqual([new Date('2026-03-29T00:59:00Z').getHours(), new Date('2026-03-29T01:00:00Z').getHours()], [1, 3]);
});

test('around a time on the days the clock moves: one run each local day, within the window', () => {
  for (const expr of ['0 8 * * *', '30 2 * * *', '0 3 * * *', '45 1 * * *', '0 2 * * *', '5 0 * * *', '55 23 * * *']) {
    for (const [from, to] of WINDOWS) {
      const j = job(expr, `j${expr}`);
      const runs = runsBetween(j, from, to);
      // One a day, whichever way a run is moved: never two within 22 hours, none after more than 26 (a day is 23 to 25 hours, and
      // each run is up to 15 minutes either way).
      assert.ok(runs.length >= 8, `${expr}: ${runs.length} runs in 9 days`);
      runs.slice(1).forEach((t, i) => assert.ok(t - runs[i] > 22 * 60 * MIN && t - runs[i] < 26 * 60 * MIN, `${expr}: ${new Date(runs[i]).toISOString()} then ${new Date(t).toISOString()}`));
      // each run is within 15 minutes of a time of the schedule, as the clock gives it (the jump for a skipped time)
      for (const t of runs) {
        const near = [];
        for (let k = -15; k <= 15; k++) if (cron.due(expr, new Date(t + k * MIN))) near.push(k);
        assert.ok(near.length >= 1, `${expr}: ${new Date(t).toISOString()} is near a time of the schedule`);
      }
    }
  }
});

test('due, next and lastDueBetween agree across a change of the clock', () => {
  for (const expr of ['0 8 * * *', '30 2 * * *', '0 3 * * *', '45 1 * * *', '55 23 * * *', '5 0 * * *']) {
    for (const [from, to] of WINDOWS) {
      const j = job(expr, `j${expr}`);
      const runs = runsBetween(j, from, to);
      const chain = [];
      for (let at = nextRun(j, new Date(Date.parse(from) - MIN)); at && at < Date.parse(to); at = nextRun(j, at)) chain.push(at.getTime());
      assert.deepEqual(chain, runs, `${expr} ${from}: next lists the minutes that are due`);
      // downtimes of every start and end across each run: the last run inside is the one that is caught up
      for (const t of runs) {
        for (const [a, b] of [[-90, 90], [-1, 1], [-1, 2], [0, 60], [-60, 0], [-20, 40]]) {
          const [after, before] = [t + a * MIN, t + b * MIN];
          const inside = runs.filter((r) => r > after && r < cron.minuteOf(new Date(before)).getTime());
          const got = lastDueBetween(j, new Date(after), new Date(before));
          assert.equal(got ? got.getTime() : null, inside.length ? inside.at(-1) : null, `${expr}: ${new Date(after).toISOString()} to ${new Date(before).toISOString()}`);
        }
      }
    }
  }
});

test('the day the clock goes back, a time in the repeated hour runs once; the day it goes forward, a time in the skipped hour does', () => {
  const fall = runsBetween(job('30 2 * * *'), '2026-10-24T12:00Z', '2026-10-26T12:00Z');
  assert.equal(fall.length, 2, 'one on the 25th, one on the 26th');
  const spring = runsBetween(job('30 2 * * *'), '2026-03-28T12:00Z', '2026-03-30T12:00Z');
  assert.equal(spring.length, 2);
  const jump = Date.parse('2026-03-29T01:00Z');
  assert.ok(spring.some((t) => Math.abs(t - jump) <= 15 * MIN), 'the 29th runs around the jump, local 03:00');
});
