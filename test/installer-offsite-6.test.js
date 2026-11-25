// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 6 of 9 of the off-site backup tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, extracts, code } = require('./installer-helpers');
const { machine, resticCalls, withBobsData, scratch, doorData, instanceOf, ask, holdLock, fresh } = require('./installer-offsite-helpers');

test('OFFSITE-RESTORE reads another instance\'s backups when its second line names it, and the machine takes its instance', (t) => {
  const m = machine(t);
  m.offsite();
  const old = instanceOf(m);
  // A new machine of its own instance, given the old one's repository.
  const env = path.join(m.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^BOT_DOT_INSTANCE=.*$/m, 'BOT_DOT_INSTANCE=0badcafe'));
  fresh(m);
  const own = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  const none = status(own, 'restore.json');
  assert.deepEqual({ state: none.state, from: none.from, snapshot: none.snapshot, phase: none.phase }, { state: 'failed', from: 'offsite', snapshot: 'latest', phase: 'download' });
  assert.equal(none.error, 'The off-site repository holds no backup of the machine 0badcafe.');
  assert.ok(!fs.existsSync(scratch(m)), 'the scratch folder is removed after a failure');

  const done = ask(m, 'OFFSITE-RESTORE', `latest\n${old}\n`, { dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, instance: said.instance }, { state: 'restored', from: 'offsite', instance: old }, done.said);
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.ok(resticCalls(done).some((c) => c.endsWith(` snapshots --json --host ${old} --tag instance=${old},part=manifest --latest 1`)));
  assert.equal(instanceOf(m), old, 'the backup\'s instance, as a set\'s');
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), '[]');
  assert.ok(!fs.existsSync(scratch(m)));
});

test('OFFSITE-RESTORE fails without an off-site repository, or with no room for the backup, or a request that names none, and changes nothing', (t) => {
  const m = machine(t);
  const noRepo = ask(m, 'OFFSITE-RESTORE', 'latest\n');
  assert.deepEqual(status(noRepo, 'restore.json'), { ...status(noRepo, 'restore.json'), state: 'failed', from: 'offsite', snapshot: 'latest', phase: 'download', error: 'This machine has no off-site repository: give it one with OFFSITE-SET.' });
  assert.deepEqual(resticCalls(noRepo), []);

  m.offsite();
  fresh(m);
  const before = doorData(m);
  const full = ask(m, 'OFFSITE-RESTORE', 'latest\n', { given: { STAND_IN_ROOT_FREE: '1024' }, dockerFirst: extracts });
  const said = status(full, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, phase: said.phase }, { state: 'failed', from: 'offsite', phase: 'download' });
  assert.match(said.snapshot, /^[0-9a-f]{64}$/, 'the manifest it found');
  assert.match(said.error, /^It needs 0\.5 GB free in \S+ \(the backup, its data put back, and 512 MB to spare\), and has 0\.0 GB\.$/);
  assert.equal(resticCalls(full).filter((c) => / restore /.test(c)).length, 1, 'only the manifest is restored');
  assert.ok(!fs.existsSync(scratch(m)));
  assert.equal(doorData(m), before, 'nothing is put back');

  const bad = ask(m, 'OFFSITE-RESTORE', '../../etc\n');
  assert.equal(status(bad, 'restore.json').state, 'failed');
  assert.match(status(bad, 'restore.json').error, /named no snapshot/);
  const badInstance = ask(m, 'OFFSITE-RESTORE', 'latest\nnot-one\n');
  assert.match(status(badInstance, 'restore.json').error, /named no instance/);
  assert.deepEqual([...resticCalls(bad), ...resticCalls(badInstance)], []);
});

test('an OFFSITE-RESTORE whose part can\'t be restored fails, puts nothing back and removes the scratch folder', (t) => {
  const m = machine(t);
  m.offsite();
  fresh(m);
  const before = doorData(m);
  const done = ask(m, 'OFFSITE-RESTORE', 'latest\n', { given: { STAND_IN_RESTIC_RESTORE_FAIL: 'accounts/bob/workspace.tar' }, dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, phase: said.phase }, { state: 'failed', from: 'offsite', phase: 'download' });
  assert.equal(said.error, "Couldn't restore accounts/bob/workspace.tar: Fatal: failed to load pack 3f1a: ciphertext verification failed");
  assert.ok(!fs.existsSync(scratch(m)), 'the scratch folder is removed');
  assert.equal(doorData(m), before);
  assert.ok(!done.docker.some((c) => /compose .* (stop|down)$/.test(c.call)), 'nothing was stopped');
});

test('an OFFSITE-RESTORE of a backup of another version is refused by the set\'s checks, and fails while an off-site backup runs', (t) => {
  const m = machine(t);
  m.offsite();
  fresh(m);
  const before = doorData(m);
  fs.writeFileSync(path.join(m.dir, 'front-door', 'status', 'version.json'), '{"version":"def5678","selfBuilt":false}\n');
  const other = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  const said = status(other, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from }, { state: 'refused', from: 'offsite' });
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.match(said.error, /The set is of version abc1234, and this machine runs def5678/);
  assert.ok(!fs.existsSync(scratch(m)));
  assert.equal(doorData(m), before);

  holdLock(t, m);
  const locked = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  assert.deepEqual(status(locked, 'restore.json'), { ...status(locked, 'restore.json'), state: 'failed', from: 'offsite', snapshot: 'latest', error: 'An off-site backup runs now: restore from it when it is done.' });
  assert.deepEqual(resticCalls(locked), []);
});

test('an account\'s Docker, which an off-site restore may start, is started without the off-site lock\'s descriptor', () => {
  // Started with it, it would hold the lock after the restore, and every nightly backup would find one running.
  const docker = code.split('\n').filter((line) => /nohup '\$ROOTLESS'/.test(line));
  assert.equal(docker.length, 1);
  assert.match(docker[0], /9>&- 8>&-/, docker[0].trim());
});

test('RESTORE-TEST on a machine whose repository was never opened makes no repository and no password', (t) => {
  const m = machine(t);
  withBobsData(m);
  const done = ask(m, 'RESTORE-TEST', 'bob\n', { given: { BOT_DOT_OFFSITE_REPO: m.store } });
  const said = status(done, 'restore-test.json');
  assert.deepEqual({ state: said.state, account: said.account }, { state: 'failed', account: 'bob' });
  assert.match(said.error, /^This machine has no password of the off-site repository \S+: give it with OFFSITE-SET\.$/);
  assert.ok(!fs.existsSync(path.join(m.secrets, 'password')), 'no password that nobody is shown');
  assert.ok(!resticCalls(done).some((c) => / init /.test(c)), 'no repository is made');
});

test('a part whose size restic doesn\'t say stops an off-site restore and a restore test before anything is restored', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  fresh(m);
  const before = doorData(m);
  const done = ask(m, 'OFFSITE-RESTORE', 'latest\n', { given: { STAND_IN_RESTIC_NO_SIZE: '1' }, dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, phase: said.phase }, { state: 'failed', phase: 'download' });
  assert.equal(said.error, 'Couldn\'t read the size of front-door/data.tar: restic said no total_size.');
  assert.equal(resticCalls(done).filter((c) => / restore /.test(c)).length, 1, 'only the manifest is restored');
  assert.equal(doorData(m), before);
  assert.ok(!fs.existsSync(scratch(m)));

  const test = m.restoreTest('bob', { given: { STAND_IN_RESTIC_NO_SIZE: '1' } });
  assert.notEqual(test.status, 0);
  assert.match(status(test, 'restore-test.json').error, /^Couldn't read the size of accounts\/bob\/\S+: restic said no total_size\.$/);
  assert.ok(!resticCalls(test).some((c) => / dump \S+ accounts\//.test(c)), 'nothing of the account is restored');
});

test('an OFFSITE-RESTORE gives each account the born stamp its snapshots carry, so that its erase forgets them', (t) => {
  const m = machine(t);
  const born = path.join(m.dir, 'born');
  fs.mkdirSync(born, { recursive: true });
  fs.writeFileSync(path.join(born, 'bob'), '20260101T000000Z\n');
  m.offsite();
  const annBorn = fs.readFileSync(path.join(born, 'ann'), 'utf8');
  // The new machine: stamps of its own, made by its first backup.
  fs.writeFileSync(path.join(born, 'ann'), '20261106T000000Z\n');
  fs.writeFileSync(path.join(born, 'bob'), '20261106T000000Z\n');
  fresh(m);
  const done = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  assert.equal(status(done, 'restore.json').state, 'restored', done.said);
  assert.equal(fs.readFileSync(path.join(born, 'bob'), 'utf8'), '20260101T000000Z\n', 'bob\'s, as his snapshots are tagged');
  assert.equal(fs.readFileSync(path.join(born, 'ann'), 'utf8'), annBorn);
  assert.ok(!fs.existsSync(scratch(m)));
});
