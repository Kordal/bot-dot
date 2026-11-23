const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { toDelete } = require('../deploy/prune-releases');

const script = path.resolve(__dirname, '../deploy/prune-releases.js');
const at = (n) => new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString();
const evidence = (run, n, extra = {}) => ({ tagName: `image-evidence-${run}-1`, createdAt: at(n), isPrerelease: true, isDraft: false, ...extra });
const many = (count) => Array.from({ length: count }, (_, i) => evidence(1000 + i, i));

test('the newest ten evidence releases stay and the older ones go, newest of those first', () => {
  const out = toDelete(many(14), 'image-evidence-', 10, 'image-evidence-1013-1');
  assert.deepEqual(out, ['image-evidence-1003-1', 'image-evidence-1002-1', 'image-evidence-1001-1', 'image-evidence-1000-1']);
});

test('ten or fewer evidence releases lose nothing', () => {
  assert.deepEqual(toDelete(many(10), 'image-evidence-', 10, 'image-evidence-1009-1'), []);
  assert.deepEqual(toDelete([], 'image-evidence-', 10, 'image-evidence-1-1'), []);
});

test("this run's release is never deleted, and counts among the ten kept", () => {
  // A re-run of an old run: its release is the oldest by date.
  const out = toDelete(many(12), 'image-evidence-', 10, 'image-evidence-1000-1');
  assert.ok(!out.includes('image-evidence-1000-1'));
  assert.equal(out.length, 2);
  assert.equal(12 - out.length, 10);
});

test('only evidence pre-releases are candidates: android, desktop, desktop-latest, near misses, drafts and full releases are never listed', () => {
  const others = [
    { tagName: 'android-v0.1.5', createdAt: at(-50), isPrerelease: false },
    { tagName: 'desktop-v0.1.5', createdAt: at(-50), isPrerelease: false },
    { tagName: 'desktop-latest', createdAt: at(-50), isPrerelease: true },
    { tagName: 'image-evidence-', createdAt: at(-50), isPrerelease: true },
    { tagName: 'image-evidence-abc-1', createdAt: at(-50), isPrerelease: true },
    { tagName: 'image-evidence-5-1-extra', createdAt: at(-50), isPrerelease: true },
    { tagName: 'x-image-evidence-5-1', createdAt: at(-50), isPrerelease: true },
    { tagName: 'image-evidence-6-1', createdAt: at(-50), isPrerelease: false },
    { tagName: 'image-evidence-7-1', createdAt: at(-50), isPrerelease: true, isDraft: true },
    { tagName: 'image-evidence-8-1', createdAt: 'yesterday', isPrerelease: true },
    null,
  ];
  assert.deepEqual(toDelete([...many(3), ...others], 'image-evidence-', 2, 'image-evidence-1002-1'), ['image-evidence-1000-1']);
});

test('a bad prefix or keep count is refused before anything is listed', () => {
  assert.throws(() => toDelete(many(3), '', 10, 'x'), /prefix/);
  assert.throws(() => toDelete(many(3), 'android-v', 10, 'x'), /prefix/);
  assert.throws(() => toDelete(many(3), '.*', 10, 'x'), /prefix/);
  assert.throws(() => toDelete(many(3), 'image-evidence-', 0, 'x'), /keep/);
  assert.throws(() => toDelete(many(3), 'image-evidence-', NaN, 'x'), /keep/);
  assert.throws(() => toDelete({}, 'image-evidence-', 10, 'x'), /list/);
});

test('the command reads gh JSON from stdin and prints the tags to delete', () => {
  const run = (input, ...args) => spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
  const ok = run(JSON.stringify(many(12)), 'image-evidence-', '10', 'image-evidence-1011-1');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, 'image-evidence-1001-1\nimage-evidence-1000-1\n');
  assert.equal(run(JSON.stringify(many(3)), 'image-evidence-', '10', 'image-evidence-1002-1').stdout, '');
  assert.notEqual(run('not json', 'image-evidence-', '10', 'x').status, 0);
  assert.notEqual(run('[]', 'image-evidence-', '10').status, 0);
});
