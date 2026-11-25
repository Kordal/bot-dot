// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 3 of 9 of the off-site backup tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status } = require('./installer-helpers');
const { machine, resticCalls, withBobsData } = require('./installer-offsite-helpers');

// The restore drills (#1018): a weekly check of a rotating twentieth, and a restore test of one account.
test('once a week a run checks the next twentieth of the repository, and says so in its status', (t) => {
  const m = machine(t);
  m.offsite();
  assert.equal(fs.readFileSync(path.join(m.store, 'checked'), 'utf8'), '--read-data-subset=1/20\n');
  let said = status(m.offsite(), 'offsite.json');
  assert.equal(fs.readFileSync(path.join(m.store, 'checked'), 'utf8').split('\n').filter(Boolean).length, 1, 'not again within the week');
  assert.deepEqual({ subset: said.check.subset, ok: said.check.ok }, { subset: '1/20', ok: true }, 'the last check stays in the status');
  // A week later, the next twentieth; after the twentieth, the first again.
  fs.utimesSync(path.join(m.secrets, 'checked'), new Date(Date.now() - 8 * 86400_000), new Date(Date.now() - 8 * 86400_000));
  fs.writeFileSync(path.join(m.secrets, 'check-next'), '20\n');
  said = status(m.offsite(), 'offsite.json');
  assert.equal(said.check.subset, '20/20');
  assert.equal(fs.readFileSync(path.join(m.secrets, 'check-next'), 'utf8').trim(), '1');
});

test('a check that finds damage fails the run, as a part that fails does', (t) => {
  const m = machine(t);
  const done = m.offsite({ given: { STAND_IN_RESTIC_DAMAGED: '1' } });
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'failed');
  assert.equal(said.part, 'integrity');
  assert.match(said.error, /^check 1\/20: Pack 3f1a: hash mismatch/);
  assert.deepEqual({ ok: said.check.ok, error: said.check.error }, { ok: false, error: 'Pack 3f1a: hash mismatch' });
  assert.ok(!fs.existsSync(path.join(m.secrets, 'checked')), 'checked again at the next run');
});

test('a restore test restores one account\'s parts of the latest backup, checks them, counts its bots and leaves nothing', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const done = m.restoreTest('bob');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.said, /The restore test of bob passed: 2 bots/);
  const said = status(done, 'restore-test.json');
  assert.deepEqual({ state: said.state, account: said.account, bots: said.bots }, { state: 'passed', account: 'bob', bots: 2 });
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.ok(said.bytes > 4096);
  const dumped = resticCalls(done).filter((c) => / dump /.test(c)).map((c) => c.split(' ').at(-1));
  assert.deepEqual(dumped.sort(), ['accounts/bob/browser.tar', 'accounts/bob/config.tar', 'accounts/bob/data.tar', 'accounts/bob/env', 'accounts/bob/tailscale.tar', 'accounts/bob/workspace.tar', 'manifest.json']);
  assert.ok(!fs.existsSync(path.join(m.dir, 'restore-test')), 'the scratch folder is removed');
});

test('a part that comes back short fails the test, which says so in its status', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const done = m.restoreTest('bob', { given: { STAND_IN_RESTIC_SHORT: 'accounts/bob/workspace.tar' } });
  assert.notEqual(done.status, 0);
  const said = status(done, 'restore-test.json');
  assert.equal(said.state, 'failed');
  assert.match(said.error, /^accounts\/bob\/workspace.tar came back with 3 bytes, and restic recorded \d+\.$/);
  assert.match(done.stderr, /came back with 3 bytes/);
  assert.ok(!fs.existsSync(path.join(m.dir, 'restore-test')));
});

test('a restore test the disk has no room for is refused before anything is restored, saying what it needs', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const done = m.restoreTest('bob', { given: { STAND_IN_ROOT_FREE: '1024' } });
  assert.notEqual(done.status, 0);
  const said = status(done, 'restore-test.json');
  assert.equal(said.state, 'refused');
  assert.match(said.error, /^It needs 0\.5 GB free in \S+ and has 0\.0 GB\.$/);
  assert.ok(!resticCalls(done).some((c) => / dump \S+ accounts\//.test(c)), 'nothing of the account is restored');
});
