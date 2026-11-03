// The audit log's store (#911, ADR 141): one line of JSON an entry in audit.jsonl (mode 600), newest first when
// listed, filtered by account and action, paged with `before`, and nothing older than 13 months kept.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const auditStore = require('../lib/front-door/audit');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fd-audit-'));

test('an entry is appended as one line, private to the front door, and read back after a restart', () => {
  const d = dir();
  let t = Date.parse('2026-11-03T10:00:00Z');
  const a = auditStore.open(d, { now: () => t });
  a.record({ actor: 'ann', action: 'suspend', account: 'bob' });
  a.record({ actor: 'front-door', action: 'account-made', account: 'cat', detail: '  from a\nsign-up link ' });
  const file = path.join(d, 'audit.jsonl');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, 'utf8').trim().split('\n').length, 2);
  const again = auditStore.open(d, { now: () => t }).list();
  assert.deepEqual(again.entries, [
    { at: '2026-11-03T10:00:00.001Z', actor: 'front-door', action: 'account-made', account: 'cat', detail: 'from a sign-up link' },
    { at: '2026-11-03T10:00:00.000Z', actor: 'ann', action: 'suspend', account: 'bob' },
  ], 'newest first, a later `at` for an entry of the same millisecond');
  assert.deepEqual(again.accounts, ['bob', 'cat']);
  assert.ok(again.actions.includes('slowed-down'));
});

test('a wrong actor, action or account is no entry', () => {
  const a = auditStore.open(dir());
  assert.throws(() => a.record({ actor: 'Ann!', action: 'suspend' }));
  assert.throws(() => a.record({ actor: 'ann', action: 'read-chat' }));
  assert.throws(() => a.record({ actor: 'ann', action: 'suspend', account: '../x' }));
  assert.deepEqual(a.list().entries, []);
});

test('the list filters by account and by action, and pages with before', () => {
  let t = Date.parse('2026-11-01T00:00:00Z');
  const a = auditStore.open(dir(), { now: () => (t += 1000) });
  for (let i = 0; i < 120; i++) a.record({ actor: 'ann', action: i % 2 ? 'suspend' : 'resume', account: i % 3 ? 'bob' : 'cat' });
  const first = a.list();
  assert.equal(first.entries.length, 50);
  assert.equal(first.more, true);
  const seen = [...first.entries];
  let page = first;
  while (page.more) { page = a.list({ before: page.entries.at(-1).at }); seen.push(...page.entries); }
  assert.equal(seen.length, 120);
  assert.equal(new Set(seen.map((e) => e.at)).size, 120, 'none twice');
  assert.deepEqual(seen.map((e) => e.at), [...seen.map((e) => e.at)].sort().reverse());
  const bob = a.list({ account: 'bob', action: 'suspend', limit: 200 });
  assert.ok(bob.entries.length > 0);
  assert.ok(bob.entries.every((e) => e.account === 'bob' && e.action === 'suspend'));
  assert.equal(bob.entries.length, [...Array(120).keys()].filter((i) => i % 2 && i % 3).length);
  assert.equal(a.list({ limit: 1000 }).entries.length, 120, 'at most 200 a page');
  assert.equal(a.list({ limit: 5 }).entries.length, 5);
});

test('entries older than 13 months are dropped, on start and as time goes by', () => {
  const d = dir();
  let t = Date.parse('2025-09-01T00:00:00Z');
  const a = auditStore.open(d, { now: () => t });
  a.record({ actor: 'ann', action: 'rooms', detail: 'on' });
  t = Date.parse('2025-11-01T00:00:00Z');
  a.record({ actor: 'ann', action: 'rooms', detail: 'off' });
  t = Date.parse('2026-11-03T00:00:00Z');
  assert.equal(a.prune(), 1);
  assert.deepEqual(a.list().entries.map((e) => e.detail), ['off']);
  assert.equal(fs.readFileSync(path.join(d, 'audit.jsonl'), 'utf8').trim().split('\n').length, 1);
  t = Date.parse('2026-12-02T00:00:00Z');
  assert.deepEqual(auditStore.open(d, { now: () => t }).list().entries, [], 'on start too');
});
