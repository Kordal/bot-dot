// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 7 of 9 of the off-site backup tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, extracts } = require('./installer-helpers');
const { machine, resticCalls, withBobsData, scratch, instanceOf, ask, holdLock, fresh } = require('./installer-offsite-helpers');

test('an account made in the same run as an off-site restore gets the restored instance', (t) => {
  const m = machine(t);
  // carol signed up at the front door, and wasn't made yet when it was backed up.
  m.door({ accounts: { ann: {}, bob: {}, carol: {} } });
  m.offsite();
  const old = instanceOf(m);
  const env = path.join(m.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^BOT_DOT_INSTANCE=.*$/m, 'BOT_DOT_INSTANCE=0badcafe'));
  fresh(m);
  // The restored front door asks for her in the same run.
  fs.writeFileSync(path.join(m.dir, 'front-door', 'requests', 'carol'), '');
  const done = ask(m, 'OFFSITE-RESTORE', `latest\n${old}\n`, { dockerFirst: extracts });
  assert.equal(status(done, 'restore.json').state, 'restored', done.said);
  assert.equal(instanceOf(m), old);
  const carol = fs.readFileSync(path.join(m.dir, 'accounts', 'carol', '.env'), 'utf8');
  assert.equal(carol.match(/^BOT_DOT_INSTANCE=(.*)$/m)[1], old, 'not the instance the run started with');
});

test('the scratch folders a cut-off restore, restore test or import left are removed by the next off-site backup, under its lock', (t) => {
  const m = machine(t);
  m.offsite();
  const left = [scratch(m), path.join(m.dir, 'restore-test'), path.join(m.dir, 'account-import')];
  for (const dir of left) {
    fs.mkdirSync(path.join(dir, 'accounts', 'bob'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'accounts', 'bob', 'env'), 'SECRET=1\n');
  }
  const release = holdLock(t, m);
  m.offsite();
  for (const dir of left) assert.ok(fs.existsSync(dir), 'kept while a restore may be using it');
  release();
  const done = m.offsite();
  assert.equal(done.status, 0, done.stderr);
  for (const dir of left) assert.ok(!fs.existsSync(dir), `${dir} is removed`);
});

test('a restore test and an off-site backup stop at a step that fails, from a request and from the command line', (t) => {
  // Called with || (or in an if), a function's subshell runs with set -e off, and goes on past the failure.
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const cache = path.join(m.secrets, 'cache');
  fs.rmSync(cache, { recursive: true });
  fs.writeFileSync(cache, 'not a folder');
  const asked = ask(m, 'RESTORE-TEST', 'bob\n');
  assert.equal(status(asked, 'restore-test.json').state, 'failed', asked.said);
  const run = m.restoreTest('bob');
  assert.notEqual(run.status, 0);
  assert.equal(status(run, 'restore-test.json').state, 'failed');
  const backup = m.offsite();
  assert.notEqual(backup.status, 0);
  assert.equal(status(backup, 'offsite.json').state, 'failed');
  assert.ok(!resticCalls(backup).some((c) => / backup /.test(c)), 'nothing is backed up past it');
});
