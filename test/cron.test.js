// lib/cron.js: what the parser refuses, and how fast. A schedule comes from the Chief, a bot or the owner,
// and is parsed on the server's one thread: a field must never keep it busy.
const test = require('node:test');
const assert = require('node:assert');
const cron = require('../lib/cron');
const { describe } = require('../lib/cron-words');

const timed = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

test('a field without an end is refused at once, not counted through', () => {
  for (const expr of ['Infinity * * * *', '0 9 * * 1e999', '0-Infinity * * * *', '*/Infinity * * * *', '-Infinity * * * *', '0-16000000 * * * *', '0 0-1e300 * * *', '1e300 * * * *']) {
    const ms = timed(() => assert.throws(() => cron.parse(expr), /Bad cron field|out of range/, expr));
    assert.ok(ms < 50, `${expr} took ${ms} ms`);
    assert.strictEqual(describe(expr), 'Invalid schedule', expr);
  }
});

test('what the parser refused before, it refuses with the same words', () => {
  assert.throws(() => cron.parse('61 * * * *'), /Value 61 out of range in "61"/);
  assert.throws(() => cron.parse('0 5-30 * * *'), /Value 24 out of range in "5-30"/);
  assert.throws(() => cron.parse('0 9 * * 8'), /Value 8 out of range in "8"/);
  assert.throws(() => cron.parse('0 9 0 * *'), /Value 0 out of range in "0"/);
  assert.throws(() => cron.parse('x * * * *'), /Bad cron field "x"/);
  assert.throws(() => cron.parse('*/0 * * * *'), /Bad cron field/);
  assert.throws(() => cron.parse('0 9 * *'), /Cron needs 5 fields/);
});

test('what the parser took before, it takes as before', () => {
  const sets = (expr) => cron.parse(expr).map((s) => [...s]);
  assert.deepStrictEqual(sets('0 9 * * 7')[4], [0]); // 7 is Sunday
  assert.deepStrictEqual(sets('0 9 * * 5-7')[4], [5, 6, 0]);
  assert.deepStrictEqual(sets('0 21-8 * * *')[1], []); // an empty run of hours: "Never runs"
  assert.deepStrictEqual(sets('0-100/200 * * * *')[0], [0]); // a step past the end leaves the first value
  assert.deepStrictEqual(sets('5/15 * * * *')[0], [5, 20, 35, 50]);
  assert.deepStrictEqual(sets('*/15 8-10 1,15 * 1-5').map((s) => s.length), [4, 3, 2, 12, 5]);
});
