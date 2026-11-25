// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 8 of 9 of the off-site backup tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, extracts } = require('./installer-helpers');
const { restic, machine, resticCalls, doorData, instanceOf, ask, holdLock, moveDoor, elsewhere } = require('./installer-offsite-helpers');

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

test('IMPORT-bob waits while an off-site backup runs, and asks nothing of the front door', (t) => {
  const m = machine(t);
  m.offsite();
  const old = instanceOf(m);
  elsewhere(m);
  const release = holdLock(t, m);
  const done = ask(m, 'IMPORT-bob', `${old}\n`, { dockerFirst: [...moveDoor(m), ...extracts] });
  release();
  const said = status(done, 'import-bob.json');
  assert.deepEqual([said.state, said.error], ['failed', 'An off-site backup runs now: import the account when it is done.']);
  assert.ok(!done.docker.some((c) => / import-account /.test(c.call)));
});

test('IMPORT-bob reads the repository and password it names, puts the key on the sub-account, and keeps neither password', (t) => {
  const m = machine(t);
  m.offsite();
  const old = instanceOf(m);
  elsewhere(m);
  const repo = 'sftp://u1-sub3@u1.your-storagebox.de:23/botdot';
  const ssh = '#!/bin/sh\necho "ssh $*" >> "$STAND_IN_LOG"\ncat > /dev/null\n';
  const log = path.join(m.first.top, 'system.log');
  const before = fs.readFileSync(log, 'utf8').length;
  const done = m.step('IMPORT-bob', { body: `${old}\n${repo}\nold-restic-password\nsub-password\n`, dockerFirst: [...moveDoor(m), ...extracts], bins: { restic: restic(m.store), ssh, 'ssh-keygen': '#!/bin/sh\nf=""; p=""; for a; do [ "$p" = -f ] && f="$a"; p="$a"; done; echo key > "$f"; echo pub > "$f.pub"\n' } });
  const system = fs.readFileSync(log, 'utf8').slice(before);
  assert.equal(status(done, 'import-bob.json').state, 'imported', done.said);
  assert.match(system, new RegExp(`^restic-env ${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\S+/offsite/import-password `, 'm'));
  assert.match(system, /^ssh -p 23 .* u1-sub3@u1\.your-storagebox\.de install-ssh-key$/m);
  for (const f of ['import-password', 'subpass', 'askpass']) assert.ok(!fs.existsSync(path.join(m.secrets, f)), `${f} is gone`);
});
