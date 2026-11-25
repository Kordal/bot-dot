// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 4 of 9 of the off-site backup tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBob, status } = require('./installer-helpers');
const { machine, resticCalls, withBobsData, ask } = require('./installer-offsite-helpers');

// An erased account's snapshots (#1019): what the stand-in repository keeps of the account NAME, as "part born".
const kept = (m, name) => fs.readFileSync(path.join(m.store, 'snaps'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '))
  .filter(([, tags]) => tags.split(',').includes(`account=${name}`)).map(([, tags, part]) => `${part} ${(tags.match(/born=(\S+)/) || [])[1] || '-'}`).sort();

const DAY = 86400;

test('a restore test of an account the backup lacks, or with no name, says so', (t) => {
  const m = machine(t);
  m.offsite();
  const none = m.restoreTest('carol');
  assert.notEqual(none.status, 0);
  assert.match(status(none, 'restore-test.json').error, /holds no data of the account carol/);
  const bad = m.restoreTest('');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Name the account to test the restore of/);
});

test('an erased account\'s off-site snapshots are forgotten after the grace period and pruned, and one made again under its name is untouched', (t) => {
  const m = machine(t);
  fs.mkdirSync(path.join(m.dir, 'born'), { recursive: true });
  fs.writeFileSync(path.join(m.dir, 'born', 'bob'), '20260101T000000Z\n');
  m.offsite();
  // A part of bob's from before born stamps, as an earlier version kept it.
  const instance = fs.readFileSync(path.join(m.parts, 'front-door', 'data.tar.tags'), 'utf8').match(/instance=(\w+)/)[1];
  fs.appendFileSync(path.join(m.store, 'snaps'), `${'e'.repeat(64)} instance=${instance},part=env,account=bob accounts/bob/env\n`);
  assert.deepEqual(kept(m, 'bob').filter((k) => / -$/.test(k)), ['accounts/bob/env -']);

  m.door({ accounts: { ann: {} }, deleted: { bob: '2026-11-05T12:00:00.000Z' } });
  const erased = m.step('bob');
  assert.match(erased.said, /The account bob is erased/);
  const [name, born, epoch] = fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8').trim().split(' ');
  assert.deepEqual([name, born], ['bob', '20260101T000000Z'], 'the erase is written down with its born stamp');
  assert.ok(Math.abs(Number(epoch) - Date.now() / 1000) < 60);
  assert.ok(!fs.existsSync(path.join(m.dir, 'born', 'bob')), 'its stamp goes with it');

  // Made again under the same name, and backed up, before the grace period ends: nothing of bob's is forgotten yet.
  m.door({ accounts: { ann: {}, bob: {} } });
  m.step('bob');
  const inGrace = m.offsite();
  assert.equal(inGrace.status, 0, inGrace.stderr);
  assert.ok(!resticCalls(inGrace).some((c) => / forget --quiet [0-9a-f]{64}/.test(c)), 'nothing forgotten in the grace period');
  const newBorn = fs.readFileSync(path.join(m.dir, 'born', 'bob'), 'utf8').trim();
  assert.notEqual(newBorn, '20260101T000000Z', 'the new bob has a stamp of its own');

  // The grace period over.
  fs.writeFileSync(path.join(m.secrets, 'erased'), `bob 20260101T000000Z ${Math.floor(Date.now() / 1000) - 15 * DAY} 2026-10-21T12:00:00Z\n`);
  const after = m.offsite();
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.said, /The off-site snapshots of the account bob, erased 2026-10-21T12:00:00Z, are forgotten: 7/);
  const calls = resticCalls(after);
  assert.match(calls.find((c) => / snapshots /.test(c) && /account=bob/.test(c)), /--host [0-9a-f]{8} --tag instance=[0-9a-f]{8},account=bob$/);
  assert.match(calls.find((c) => / forget --quiet [0-9a-f]{64}/.test(c)), /forget --quiet( [0-9a-f]{64}){7}$/);
  assert.match(calls.find((c) => / forget --quiet --host /.test(c)), /--prune$/, 'pruned in the same run');
  assert.deepEqual(kept(m, 'bob').map((k) => k.split(' ')[1]).filter((b, i, a) => a.indexOf(b) === i), [newBorn], 'only the new bob\'s are kept');
  assert.ok(kept(m, 'ann').length > 0, "ann's are untouched");
  assert.equal(fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8'), '', 'the erase is done');
  const forgotten = status(after, 'offsite-forgotten.json').forgotten;
  assert.equal(forgotten.length, 1);
  assert.deepEqual({ ...forgotten[0], at: null }, { account: 'bob', erased: '2026-10-21T12:00:00Z', at: null, snapshots: 7 });
  assert.equal(status(after, 'offsite.json').state, 'done');

  const later = m.offsite();
  assert.ok(!resticCalls(later).some((c) => / forget --quiet [0-9a-f]{64}/.test(c)), 'forgotten once');
});

test('a forget that fails keeps the erase for the next run, and fails this one', (t) => {
  const m = machine(t);
  m.offsite();
  m.door({ accounts: { ann: {} }, deleted: { bob: '2026-11-05T12:00:00.000Z' } });
  m.step('bob');
  const line = fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8').trim().split(' ');
  line[2] = String(Math.floor(Date.now() / 1000) - 15 * DAY);
  fs.writeFileSync(path.join(m.secrets, 'erased'), `${line.join(' ')}\n`);
  const done = m.offsite({ given: { STAND_IN_RESTIC_NO_FORGET: '1' } });
  assert.match(done.stderr + done.said, /The off-site snapshots of the erased account bob weren't forgotten: .*already locked/);
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'failed');
  assert.match(said.error, /^forget bob: /);
  assert.equal(fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8'), `${line.join(' ')}\n`, 'kept for the next run');
  const again = m.offsite();
  assert.match(again.said, /The off-site snapshots of the account bob, .* are forgotten: 6/);
});

test('a machine without the off-site backup writes no erase down', (t) => {
  const { first, door, step } = withBob(t);
  door({ accounts: { ann: {} }, deleted: { bob: '2026-11-05T12:00:00.000Z' } });
  step('bob');
  assert.ok(!fs.existsSync(path.join(first.dir, 'offsite', 'erased')));
});

test('RESTORE-TEST from root runs the restore test of its account, and says it passed or failed as the command line does', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const passed = ask(m, 'RESTORE-TEST', 'bob\n');
  const said = status(passed, 'restore-test.json');
  assert.deepEqual({ state: said.state, account: said.account, bots: said.bots }, { state: 'passed', account: 'bob', bots: 2 }, passed.said);
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.ok(said.bytes > 4096);
  assert.ok(resticCalls(passed).some((c) => / dump \S+ accounts\/bob\/data\.tar$/.test(c)), 'bob\'s data is read back');
  assert.ok(!fs.existsSync(path.join(m.dir, 'restore-test')), 'the scratch folder is removed');

  const failed = ask(m, 'RESTORE-TEST', 'bob\n', { given: { STAND_IN_RESTIC_SHORT: 'accounts/bob/workspace.tar' } });
  const why = status(failed, 'restore-test.json');
  assert.deepEqual({ state: why.state, account: why.account }, { state: 'failed', account: 'bob' });
  assert.match(why.error, /^accounts\/bob\/workspace.tar came back with 3 bytes, and restic recorded \d+\.$/);
  assert.match(failed.said + failed.stderr, /The restore test of bob didn't pass: accounts\/bob\/workspace.tar came back with 3 bytes/);
  assert.ok(!fs.existsSync(path.join(m.dir, 'restore-test')));

  const none = ask(m, 'RESTORE-TEST', 'Bob; rm -rf /\n');
  assert.deepEqual(status(none, 'restore-test.json').state, 'refused');
  assert.equal(status(none, 'restore-test.json').error, 'The request named no account.');
  assert.ok(!resticCalls(none).length, 'nothing is read');
});
