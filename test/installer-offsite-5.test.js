// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 5 of 6 of the off-site backup tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, extracts } = require('./installer-helpers');
const { machine, resticCalls, withBobsData, scratch, doorData, instanceOf, ask, holdLock, fresh, moveDoor, elsewhere } = require('./installer-offsite-helpers');

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

test('IMPORT-bob restores bob alone from another machine\'s latest backup, after the front door made it, and leaves no scratch folder', (t) => {
  const m = machine(t);
  fs.mkdirSync(path.join(m.dir, 'born'), { recursive: true });
  fs.writeFileSync(path.join(m.dir, 'born', 'bob'), '20260101T000000Z\n');
  m.offsite();
  const old = instanceOf(m);
  const backedUp = doorData(m);
  elsewhere(m);
  // An erase of bob with this born stamp waits here (a half-made import before, or bob moved away once): it would
  // forget the snapshots of the bob imported now.
  fs.mkdirSync(m.secrets, { recursive: true });
  fs.writeFileSync(path.join(m.secrets, 'erased'), 'bob 20260101T000000Z 1790000000 2026-10-21T12:00:00Z\ncarl 20250101T000000Z 1790000000 2026-10-21T12:00:00Z\n');
  const done = ask(m, 'IMPORT-bob', `${old}\n`, { dockerFirst: [...moveDoor(m), ...extracts] });
  assert.equal(fs.readFileSync(path.join(m.dir, 'born', 'bob'), 'utf8').trim(), '20260101T000000Z', 'bob keeps his born stamp');
  assert.equal(fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8'), 'carl 20250101T000000Z 1790000000 2026-10-21T12:00:00Z\n', 'bob is no erase to finish');
  const said = status(done, 'import-bob.json');
  assert.deepEqual({ state: said.state, account: said.account, instance: said.instance }, { state: 'imported', account: 'bob', instance: old }, done.said);
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(path.join(m.first.top, 'import-record.json'), 'utf8'), backedUp, 'the front door is handed the other machine\'s data');
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), '[]', 'bob\'s data is the backup\'s');
  assert.equal(instanceOf(m), '0badcafe', 'the machine keeps its own instance');
  const calls = resticCalls(done);
  assert.ok(calls.some((c) => c.endsWith(` snapshots --json --host ${old} --tag instance=${old},part=manifest --latest 1`)), calls.join('\n'));
  const restored = calls.filter((c) => / restore /.test(c));
  assert.equal(restored.length, 8, 'the manifest, the front door\'s data and bob\'s six parts');
  const named = fs.readdirSync(path.join(m.store, 'byid')).filter((f) => f.endsWith('.name')).map((f) => [f.slice(0, 64), fs.readFileSync(path.join(m.store, 'byid', f), 'utf8').trim()]);
  const parts = restored.map((c) => named.find(([id]) => c.includes(` restore ${id} `))?.[1]).filter(Boolean);
  assert.ok(parts.includes('front-door/data.tar') && parts.every((p) => !p.startsWith('accounts/ann/')), parts.join(' '));
  assert.ok(!fs.existsSync(path.join(m.dir, 'account-import')), 'the scratch folder is removed');
  assert.match(done.said, /The account bob is imported from the machine/);
  assert.equal(fs.readFileSync(path.join(m.first.top, 'import-lock'), 'utf8').trim(), 'held', 'the off-site lock is held past the download');
});

test('IMPORT-bob that fails once the front door made bob deletes and erases what it made, and can be asked again', (t) => {
  const m = machine(t);
  m.offsite();
  const old = instanceOf(m);
  elsewhere(m);
  // bob's botdot server won't stop, so his data can't be put back: once.
  const once = path.join(m.first.top, 'compose-failed');
  const stuck = [`case "$*" in *"compose --project-directory"*"/bob down"*) [ -e ${once} ] || { touch ${once}; exit 1; } ;; esac`];
  const failed = ask(m, 'IMPORT-bob', `${old}\n`, { dockerFirst: [...stuck, ...moveDoor(m), ...extracts] });
  const said = status(failed, 'import-bob.json');
  assert.deepEqual([said.state, said.phase], ['failed', 'account'], JSON.stringify(said));
  assert.match(said.error, /Couldn't stop the account bob's botdot server/);
  assert.ok(failed.docker.some((c) => c.call.endsWith('exec -T front-door node front-door.js delete-account --account bob --by console')), 'the front door is asked to delete bob');
  assert.match(failed.system, /^userdel botdot-bob$/m, 'bob is erased');
  const again = ask(m, 'IMPORT-bob', `${old}\n`, { dockerFirst: [...stuck, ...moveDoor(m), ...extracts] });
  assert.equal(status(again, 'import-bob.json').state, 'imported', again.said);
});

test("IMPORT-bob of the machine's own account that fails keeps what it made, for the next import to write over", (t) => {
  const m = machine(t);
  m.offsite();
  const old = instanceOf(m);
  elsewhere(m);
  // bob is the admin's own here, as a machine of one account's is: never erased.
  const env = path.join(m.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^FRONT_DOOR_ADMIN=.*$/m, 'FRONT_DOOR_ADMIN=bob'));
  const once = path.join(m.first.top, 'compose-failed');
  const stuck = [`case "$*" in *"compose --project-directory"*"/bob down"*) [ -e ${once} ] || { touch ${once}; exit 1; } ;; esac`];
  const failed = ask(m, 'IMPORT-bob', `${old}\n`, { dockerFirst: [...stuck, ...moveDoor(m), ...extracts] });
  const said = status(failed, 'import-bob.json');
  assert.deepEqual([said.state, said.phase], ['failed', 'account'], JSON.stringify(said));
  assert.match(said.error, /what was made of the account stays on the machine: ask for the import again, which writes over it$/);
  assert.doesNotMatch(failed.system, /^userdel botdot-bob$/m, 'not erased');
});
