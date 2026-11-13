// The scheduler's clock boundary: real persisted project records, fixed times, no sleeping.
process.env.TZ = 'UTC';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clean } = require('../lib/company');
const { due, text } = require('../lib/project-updates');
const { inQuietHours } = require('../lib/reporting');
const c = (extra = {}) => clean({ id: 'garden', phase: 'running', startedAt: '2026-11-12T00:00:00Z', teams: [{ id: 't1', name: 'Garden', bots: ['b1'], lead: 'b1', report: 'weekly', reportFrom: '2026-11-12T00:00:00Z' }], ...extra });
const options = { timeZone: 'UTC' };

test('one latest update preserves old opted-in times, coalesces overlap and waits through quiet hours', () => {
  const old = c({ updateThrough: '2026-11-12T18:00:00Z' });
  assert.equal(due(old, new Date('2026-11-13T08:59:00Z'), options), null);
  assert.equal(due(old, new Date('2026-11-13T09:00:00Z'), options).key, 'scheduled:2026-11-13T09:00:00.000Z');
  const sent = c({ updateThrough: '2026-11-13T09:02:00Z' });
  assert.equal(due(sent, new Date('2026-11-13T09:04:00Z'), options), null);
  // Reports historically use this machine's zone. Pin the process TZ in the test command to UTC.
  assert.equal(due(sent, new Date('2026-11-13T17:01:00Z'), options).key, 'scheduled:2026-11-13T17:00:00.000Z');
  const same = c({ standup: { on: true, time: '17:00' } });
  assert.equal(due(same, new Date('2026-11-13T17:01:00Z'), options).key, 'scheduled:2026-11-13T17:00:00.000Z');
  const q = { start: 8, end: 12, timeZone: 'UTC' };
  const quiet = { ...options, quiet: (d) => inQuietHours(d, q) };
  assert.equal(due(old, new Date('2026-11-13T09:01:00Z'), quiet), null);
  assert.equal(due(old, new Date('2026-11-13T12:00:00Z'), quiet).key, 'scheduled:2026-11-13T09:00:00.000Z');
});

test('a new preference replaces the old union; off, archived and setup projects stay quiet', () => {
  const weekly = c({ updates: { every: 'weekly' }, updatesFrom: '2026-11-12T00:00:00Z', updateThrough: '2026-11-13T09:01:00Z' });
  assert.equal(due(weekly, new Date('2026-11-13T17:01:00Z'), options), null);
  for (const extra of [{ updates: { every: 'off' }, updatePendingAt: '2026-11-13T12:00:00Z' }, { archived: true }, { phase: 'setup' }]) assert.equal(due(c(extra), new Date('2026-11-13T17:01:00Z'), options), null);
});

test('the quiet-hours zone and daylight-saving transition still produce a single stable daily slot', () => {
  const project = c({ updates: { every: 'daily' }, updatesFrom: '2026-10-24T00:00:00Z', updateThrough: '2026-10-24T12:00:00Z' });
  const warsaw = { timeZone: 'Europe/Warsaw' };
  assert.equal(due(project, new Date('2026-10-25T08:01:00Z'), warsaw).key, 'scheduled:2026-10-25T08:00:00.000Z');
  project.updateThrough = '2026-10-25T08:01:00Z';
  assert.equal(due(project, new Date('2026-10-25T09:01:00Z'), warsaw), null);
});

test('recorded completion, current work, failures, decisions and open questions stay distinct', () => {
  const project = c({ name: 'Garden', todos: [{ id: 'done', text: 'Choose the site', done: true, doneAt: '2026-11-13T10:00:00Z' }], decisions: [{ id: 'choice', text: 'Use the north bed', at: '2026-11-13T10:00:00Z', by: 'you' }] });
  const output = text(project, { work: [{ name: 'Planter', text: 'Preparing the beds' }], blockers: [{ name: 'Planter', state: 'failed', text: 'Connection failed' }, { name: 'Helper', state: 'asks', text: 'Which seeds?' }], replies: [{ name: 'Planter', text: 'I might be done', at: '2026-11-13T10:00:00Z' }] }, { since: '2026-11-13T09:00:00Z', cards: ['Garden Manager waits for your OK'] });
  assert.match(output, /Marked done\n• Choose the site/);
  assert.match(output, /Current work\n• Planter: Preparing the beds/);
  assert.match(output, /Blockers\n• Planter: Connection failed/);
  assert.match(output, /Needs you\n• Garden Manager waits for your OK\n• Helper: Which seeds/);
  assert.match(output, /Decisions\n• Use the north bed/);
  assert.match(output, /No new recorded team report: Garden/);
  assert.doesNotMatch(output.split('Current work')[0], /might be done/);
});

test('goal progress and a failed objective source reach the same update as other recorded work', () => {
  const project = c({ objectives: [{ id: 'users', name: 'Sign-ups', current: 12, target: 50, source: { app: 'stripe', what: 'Active accounts', failed: 'Analytics connection failed' } }] });
  const output = text(project, { work: [], blockers: [], replies: [] });
  assert.match(output, /Goal progress\n• Sign-ups: 12 \/ 50/);
  assert.match(output, /Blockers\n• Sign-ups: Analytics connection failed/);
});
