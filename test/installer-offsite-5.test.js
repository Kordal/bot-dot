// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 5 of 9 of the off-site backup tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, extracts } = require('./installer-helpers');
const { machine, resticCalls, withBobsData, scratch, doorData, instanceOf, ask, holdLock, fresh } = require('./installer-offsite-helpers');

test('RESTORE-TEST is refused while an off-site backup holds the lock, and nothing is restored', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  holdLock(t, m);
  const done = ask(m, 'RESTORE-TEST', 'bob\n');
  const said = status(done, 'restore-test.json');
  assert.deepEqual({ state: said.state, account: said.account }, { state: 'refused', account: 'bob' });
  assert.equal(said.error, 'An off-site backup runs now: test the restore when it is done.');
  assert.deepEqual(resticCalls(done), [], 'the repository isn\'t touched');
});

test('RESTORE-TEST and OFFSITE-RESTORE the front door made are refused, and neither touches the repository', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  m.offsite();
  const before = doorData(m);
  const requests = path.join(m.dir, 'front-door', 'requests');
  for (const [name, body] of [['RESTORE-TEST', 'bob\n'], ['OFFSITE-RESTORE', 'latest\n']]) {
    fs.writeFileSync(path.join(requests, name), body);
    fs.chownSync(path.join(requests, name), 990, 990);
  }
  const done = ask(m, 'bob', '');
  assert.deepEqual(status(done, 'restore-test.json'), { ...status(done, 'restore-test.json'), state: 'refused', error: 'Only root asks for this.' });
  // What the front door wrote is never read: it could be a pipe by then, which a read would wait on for ever.
  assert.ok(!('account' in status(done, 'restore-test.json')), 'the front door\'s file is not read');
  assert.deepEqual(status(done, 'restore.json'), { ...status(done, 'restore.json'), state: 'refused', from: 'offsite', error: 'Only root asks for this.' });
  assert.deepEqual(resticCalls(done), []);
  assert.equal(doorData(m), before);
});

test('OFFSITE-RESTORE of the latest backup restores it into a scratch folder, puts it back as a set and removes the folder', (t) => {
  const m = machine(t);
  m.offsite();
  const backedUp = doorData(m);
  const manifestId = status(m.first, 'offsite.json').snapshots['manifest.json'];
  fresh(m);
  const done = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, snapshot: said.snapshot, version: said.version }, { state: 'restored', from: 'offsite', snapshot: manifestId, version: 'abc1234' }, done.said);
  assert.ok(!('instance' in said), 'no instance was named');
  assert.equal(doorData(m), backedUp, 'the front door\'s data is the backup\'s');
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), '[]', 'bob\'s data is the backup\'s');
  const instance = instanceOf(m);
  const calls = resticCalls(done);
  assert.ok(calls.some((c) => c.endsWith(` snapshots --json --host ${instance} --tag instance=${instance},part=manifest --latest 1`)), calls.join('\n'));
  const restored = calls.filter((c) => / restore /.test(c));
  assert.equal(restored.length, 10, 'the manifest and its nine parts');
  for (const c of restored) assert.match(c, new RegExp(` restore [0-9a-f]{64} --target ${scratch(m)}(/\\.offsite)? --verify$`));
  assert.ok(!fs.existsSync(scratch(m)), 'the scratch folder is removed');
  const bob = done.docker.filter((c) => c.host.endsWith('/bob/docker.sock')).map((c) => c.call);
  assert.ok(bob.some((c) => / -v \S+:\/v /.test(c) && c.includes('computer-workspace')), 'bob\'s computer\'s volumes are put back');
});

test('OFFSITE-RESTORE of a named snapshot restores that one, not the latest', (t) => {
  const m = machine(t);
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), '["first"]');
  m.offsite();
  const first = status(m.first, 'offsite.json').snapshots['manifest.json'];
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), '["second"]');
  m.offsite();
  assert.notEqual(status(m.first, 'offsite.json').snapshots['manifest.json'], first);
  fresh(m);
  const done = ask(m, 'OFFSITE-RESTORE', `${first.slice(0, 12)}\n`, { dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, snapshot: said.snapshot }, { state: 'restored', from: 'offsite', snapshot: first }, done.said);
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), '["first"]');
  assert.ok(!resticCalls(done).some((c) => /--latest/.test(c)));
  assert.ok(!fs.existsSync(scratch(m)));
});
