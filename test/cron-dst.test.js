// The hour daylight saving time repeats or skips (#312): a job at a fixed time in it starts once that day, as
// classic cron does. On the fall-back day its time comes twice and only the first one counts; on the spring-forward
// day the clock jumps over it and the job starts at the jump. A job whose minute or hour is "*" (every minute,
// every quarter, every hour) goes by the clock as before: in both copies of the repeated hour, and not in the
// skipped one. This file sets its own time zone; the other tests run in UTC, which has no DST.
process.env.TZ = 'Europe/Warsaw';
const test = require('node:test');
const assert = require('node:assert/strict');
const cron = require('../lib/cron');
const { lastDueBetween, dueAt } = require('../lib/jobs');

const MIN = 60_000;
// The minutes from `from` up to `to` at which a job on `expr` starts, as UTC "YYYY-MM-DDTHH:MM".
const starts = (expr, from, to) => {
  const out = [];
  for (let t = Date.parse(from); t < Date.parse(to); t += MIN) if (cron.due(expr, new Date(t))) out.push(new Date(t).toISOString().slice(0, 16));
  return out;
};
// The local days of the two changes in 2026: 25 October has 25 hours, 29 March 23.
const FALL = ['2026-10-24T22:00Z', '2026-10-25T23:00Z'];
const SPRING = ['2026-03-28T23:00Z', '2026-03-29T22:00Z'];

test('the zone of this file has DST: 02:30 comes twice on 25 October and never on 29 March', () => {
  assert.equal(cron.matches('30 2 * * *', new Date('2026-10-25T00:30:00Z')), true);
  assert.equal(cron.matches('30 2 * * *', new Date('2026-10-25T01:30:00Z')), true);
  assert.deepEqual([new Date('2026-03-29T00:59:00Z').getHours(), new Date('2026-03-29T01:00:00Z').getHours()], [1, 3]);
});

test('clocks go back: a job at a fixed time in the repeated hour starts once, at its first copy', () => {
  assert.deepEqual(starts('30 2 * * *', ...FALL), ['2026-10-25T00:30']);
  assert.deepEqual(starts('0 2 * * *', ...FALL), ['2026-10-25T00:00']);
  assert.deepEqual(starts('59 2 * * 0', ...FALL), ['2026-10-25T00:59']);
  assert.deepEqual(starts('0 3 * * *', ...FALL), ['2026-10-25T02:00'], 'the hour after it is not repeated');
  assert.deepEqual(starts('0 1 * * *', ...FALL), ['2026-10-24T23:00'], 'nor the hour before it');
  assert.deepEqual(starts('0 9 * * *', ...FALL), ['2026-10-25T08:00']);
});

test('clocks go back: a job whose minute or hour is "*" goes by the clock, in both copies of the repeated hour', () => {
  assert.equal(starts('* * * * *', ...FALL).length, 25 * 60);
  assert.equal(starts('*/15 * * * *', ...FALL).length, 25 * 4);
  const hourly = starts('0 * * * *', ...FALL);
  assert.equal(hourly.length, 25);
  assert.ok(hourly.includes('2026-10-25T00:00') && hourly.includes('2026-10-25T01:00'), 'local 02:00 twice');
  assert.equal(starts('* 2 * * *', ...FALL).length, 120);
  // As in classic cron, a field counts as "*" only when it starts with one: hours written as a range are fixed times.
  assert.equal(starts('0 0-23 * * *', ...FALL).length, 24, 'local 02:00 once');
});

test('clocks go forward: a job at a fixed time in the skipped hour starts at the jump, local 03:00', () => {
  for (const expr of ['30 2 * * *', '0 2 * * *', '45 2 * * *', '59 2 * * 0', '0 2-3 * * *']) assert.deepEqual(starts(expr, ...SPRING), ['2026-03-29T01:00'], expr);
  assert.deepEqual(starts('30 2 * * 1', ...SPRING), [], 'not its day');
  assert.deepEqual(starts('30 2 28 3 *', ...SPRING), [], 'nor its date');
  assert.deepEqual(starts('0 3 * * *', ...SPRING), ['2026-03-29T01:00']);
  assert.deepEqual(starts('0 1 * * *', ...SPRING), ['2026-03-29T00:00']);
  assert.deepEqual(starts('0 9 * * *', ...SPRING), ['2026-03-29T07:00']);
});

test('clocks go forward: a job whose minute or hour is "*" has no time in the skipped hour, as before', () => {
  assert.equal(starts('* * * * *', ...SPRING).length, 23 * 60);
  assert.equal(starts('*/15 * * * *', ...SPRING).length, 23 * 4);
  assert.equal(starts('0 * * * *', ...SPRING).length, 23);
  assert.deepEqual(starts('* 2 * * *', ...SPRING), []);
});

test('the next run of a job, as the apps show it, is the minute it starts: at the jump, and not in the second copy', () => {
  const at = (expr, from) => cron.next(expr, new Date(from))?.toISOString() || null;
  assert.equal(at('30 2 * * *', '2026-03-28T23:00Z'), '2026-03-29T01:00:00.000Z');
  assert.equal(at('30 2 * * *', '2026-03-29T01:00Z'), '2026-03-30T00:30:00.000Z');
  assert.equal(at('30 2 * * *', '2026-10-24T23:00Z'), '2026-10-25T00:30:00.000Z');
  assert.equal(at('30 2 * * *', '2026-10-25T00:30Z'), '2026-10-26T01:30:00.000Z');
  assert.equal(at('0 * * * *', '2026-10-25T00:00Z'), '2026-10-25T01:00:00.000Z', 'every hour: local 02:00 again');
  // And the same minute as trying every one, from either side of each change.
  const slow = (expr, from) => {
    for (let t = Math.floor(Date.parse(from) / MIN) * MIN + MIN, n = 0; n < 10 * 1440; t += MIN, n++) if (cron.due(expr, new Date(t))) return new Date(t).toISOString();
    return null;
  };
  const exprs = ['30 2 * * *', '0 2 * * *', '59 2 * * 0', '0 2-3 * * *', '30 2 * * 1', '0 3 * * *', '0 9 * * *', '0 * * * *', '*/15 * * * *', '* 2 * * *'];
  const froms = ['2026-03-28T12:00:30Z', '2026-03-29T00:59Z', '2026-03-29T01:00Z', '2026-10-24T12:00Z', '2026-10-25T00:30Z', '2026-10-25T01:00Z', '2026-10-25T01:59Z'];
  for (const e of exprs) for (const f of froms) assert.equal(at(e, f), slow(e, f), `${e} from ${f}`);
});

test('botdot was off during a change: a job that ran, or that a start now catches up, was not missed', () => {
  const at = (cron, after, before) => lastDueBetween({ cron }, new Date(after), new Date(before))?.toISOString() || null;
  assert.equal(at('30 2 * * *', '2026-10-25T00:45:00Z', '2026-10-25T01:40:20Z'), null, 'it ran at the first 02:30; the second one is not its time');
  assert.equal(at('30 2 * * *', '2026-10-25T00:15:00Z', '2026-10-25T01:40:20Z'), '2026-10-25T00:30:00.000Z', 'off over the first one');
  assert.equal(at('0 * * * *', '2026-10-25T00:45:00Z', '2026-10-25T01:40:20Z'), '2026-10-25T01:00:00.000Z', 'every hour: the second 02:00 was its time');
  assert.equal(at('30 2 * * *', '2026-03-29T01:00:00Z', '2026-03-29T01:20:20Z'), null, 'caught up at the jump');
  assert.equal(at('30 2 * * *', '2026-03-29T00:50:00Z', '2026-03-29T01:00:20Z'), null, 'the start is the jump: it is caught up now');
  assert.equal(at('30 2 * * *', '2026-03-29T00:50:00Z', '2026-03-29T01:10:20Z'), '2026-03-29T01:00:00.000Z', 'off over the jump: missed, at local 03:00');
  assert.equal(at('0 * * * *', '2026-03-29T00:50:00Z', '2026-03-29T01:10:20Z'), '2026-03-29T01:00:00.000Z');
});

test('a one-time job in the repeated or the skipped hour starts once too', () => {
  const once = (cron, at, from, to) => {
    const out = [];
    for (let t = Date.parse(from); t < Date.parse(to); t += MIN) if (dueAt({ cron, at }, new Date(t))) out.push(new Date(t).toISOString().slice(0, 16));
    return out;
  };
  assert.deepEqual(once('30 2 25 10 *', '2026-10-25T00:30:00.000Z', ...FALL), ['2026-10-25T00:30']);
  assert.deepEqual(once('30 2 29 3 *', '2026-03-29T01:30:00.000Z', ...SPRING), ['2026-03-29T01:00']);
});
