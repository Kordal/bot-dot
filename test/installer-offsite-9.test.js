// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 9 of 9 of the off-site backup tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, extracts } = require('./installer-helpers');
const { machine, resticCalls, instanceOf, ask, holdLock, moveDoor, elsewhere } = require('./installer-offsite-helpers');

// HOLD-<account> (ADR 254): the account held still on the machine it leaves, and backed up off-site from then on.
const holdDoor = (m) => {
  const data = path.join(m.dir, 'front-door', 'data', 'front-door.json');
  return [
    'case "$*" in',
    `  *"front-door.js hold-account --account bob --by console"*) printf '%s' '{"accounts":{"ann":{},"bob":{"suspended":"2026-11-16T12:00:00.000Z","held":"2026-11-16T12:00:00.000Z"}}}' > ${data}; echo '{"state":"held","account":"bob","changed":true}'; exit 0 ;;`,
    `  *"front-door.js release-account --account bob --by console"*) printf '%s' '{"accounts":{"ann":{},"bob":{}}}' > ${data}; echo '{"state":"released","account":"bob","changed":true}'; exit 0 ;;`,
    'esac',
  ];
};

test('IMPORT-bob is refused for an account the machine has, a request that names no instance, or one the front door refuses, and changes nothing', (t) => {
  const m = machine(t);
  m.offsite();
  const old = instanceOf(m);
  const has = ask(m, 'IMPORT-bob', `${old}\n`, { dockerFirst: moveDoor(m) });
  assert.deepEqual([status(has, 'import-bob.json').state, status(has, 'import-bob.json').error], ['refused', 'This machine has an account bob already.']);
  assert.deepEqual(resticCalls(has), [], 'nothing is read');
  elsewhere(m);
  const bad = ask(m, 'IMPORT-bob', 'not-one\n', { dockerFirst: moveDoor(m) });
  assert.equal(status(bad, 'import-bob.json').error, 'The request named no instance: an instance id is 8 hex digits.');
  const noPass = ask(m, 'IMPORT-bob', `${old}\nsftp://u1-sub3@u1.your-storagebox.de:23/botdot\n`, { dockerFirst: moveDoor(m) });
  assert.equal(status(noPass, 'import-bob.json').error, 'The request named a repository without its password.');
  const refused = ask(m, 'IMPORT-bob', `${old}\n`, { dockerFirst: [...moveDoor(m, { refuse: true }), ...extracts] });
  assert.deepEqual([status(refused, 'import-bob.json').state, status(refused, 'import-bob.json').error], ['refused', 'This machine holds one account, ann, and takes no other.']);
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), 'fresh', 'nothing is put back');
  assert.ok(!fs.existsSync(path.join(m.dir, 'account-import')));
});

test('IMPORT-bob of a machine with no backup, or of another version, fails in its download, and makes no account', (t) => {
  const m = machine(t);
  m.offsite();
  const old = instanceOf(m);
  elsewhere(m);
  const none = ask(m, 'IMPORT-bob', 'deadbeef\n', { dockerFirst: moveDoor(m) });
  assert.deepEqual([status(none, 'import-bob.json').state, status(none, 'import-bob.json').phase, status(none, 'import-bob.json').error], ['failed', 'download', 'The off-site repository holds no backup of the machine deadbeef.']);
  fs.writeFileSync(path.join(m.dir, 'front-door', 'status', 'version.json'), '{"version":"def5678","selfBuilt":false}\n');
  const other = ask(m, 'IMPORT-bob', `${old}\n`, { dockerFirst: moveDoor(m) });
  assert.equal(status(other, 'import-bob.json').error, 'The backup is of version abc1234, and this machine runs def5678: install version abc1234 here first.');
  for (const done of [none, other]) assert.ok(!done.docker.some((c) => / import-account /.test(c.call)), 'the front door is asked nothing');
  assert.ok(!fs.existsSync(path.join(m.dir, 'account-import')));
});

test('DELETE-bob has the front door delete bob and erases it from the machine at once', (t) => {
  const m = machine(t);
  const done = ask(m, 'DELETE-bob', '', { dockerFirst: moveDoor(m) });
  assert.ok(done.docker.some((c) => c.call.endsWith('exec -T front-door node front-door.js delete-account --account bob --by console')));
  assert.match(done.system, /^userdel botdot-bob$/m);
  const said = status(done, 'delete-bob.json');
  assert.deepEqual({ state: said.state, account: said.account }, { state: 'deleted', account: 'bob' });
});

test('DELETE-bob the front door is still deleting fails, to be asked again, and erases nothing yet', (t) => {
  const m = machine(t);
  const slow = ['case "$*" in', `  *"front-door.js delete-account --account bob --by console"*) echo '{"state":"deleting","account":"bob"}'; exit 0 ;;`, 'esac'];
  const done = ask(m, 'DELETE-bob', '', { dockerFirst: [...slow, ...moveDoor(m)] });
  assert.doesNotMatch(done.system, /userdel botdot-bob/);
  const said = status(done, 'delete-bob.json');
  assert.deepEqual([said.state, said.error], ['failed', 'The front door is still deleting the account: ask again in a few minutes.']);
});

test('HOLD-bob on suspends bob and backs the machine up off-site from then on; off lets go of it', (t) => {
  const m = machine(t);
  const given = { BOT_DOT_OFFSITE_REPO: m.store };
  const held = ask(m, 'HOLD-bob', 'on\n', { given, dockerFirst: holdDoor(m) });
  assert.ok(held.docker.some((c) => c.call.endsWith('exec -T front-door node front-door.js hold-account --account bob --by console')));
  assert.ok(resticCalls(held).some((c) => / backup /.test(c)), 'backed up');
  const said = status(held, 'hold-bob.json');
  assert.equal(said.state, 'held', JSON.stringify(said));
  assert.match(said.lastSuccess, /^\d{4}-\d\d-\d\dT/);
  assert.equal(said.lastSuccess, status(held, 'offsite.json').lastSuccess);
  const let_go = ask(m, 'HOLD-bob', 'off\n', { given, dockerFirst: holdDoor(m) });
  assert.ok(let_go.docker.some((c) => c.call.endsWith('exec -T front-door node front-door.js release-account --account bob --by console')));
  assert.equal(status(let_go, 'hold-bob.json').state, 'released');
});

test('HOLD-bob on is not held when the off-site run after the hold fails', (t) => {
  const m = machine(t);
  const given = { BOT_DOT_OFFSITE_REPO: m.store };
  // A success from before the hold, which the failed run keeps as its lastSuccess.
  ask(m, 'HOLD-bob', 'on\n', { given, dockerFirst: holdDoor(m) });
  const failed = ask(m, 'HOLD-bob', 'on\n', { given: { ...given, STAND_IN_RESTIC_FAIL: 'accounts/bob/workspace.tar' }, dockerFirst: holdDoor(m) });
  assert.equal(status(failed, 'offsite.json').state, 'failed');
  assert.ok(status(failed, 'offsite.json').lastSuccess, 'the earlier success is still named');
  const said = status(failed, 'hold-bob.json');
  assert.equal(said.state, 'failed', JSON.stringify(said));
  assert.match(said.error, /^The off-site backup since the account was held failed/);
  assert.equal(said.lastSuccess, undefined);
});

test('HOLD- is refused for the first account, without an off-site repository, and when another backup runs', (t) => {
  const m = machine(t);
  const first = ask(m, 'HOLD-ann', 'on\n', { given: { BOT_DOT_OFFSITE_REPO: m.store }, dockerFirst: holdDoor(m) });
  assert.deepEqual([status(first, 'hold-ann.json').state, status(first, 'hold-ann.json').error], ['refused', "The account ann is the machine's first account, which stays on it."]);
  const none = ask(m, 'HOLD-bob', 'on\n', { dockerFirst: holdDoor(m) });
  assert.equal(status(none, 'hold-bob.json').state, 'refused');
  assert.ok(!none.docker.some((c) => c.call.includes('hold-account')), 'nothing held');
  const release = holdLock(t, m);
  const busy = ask(m, 'HOLD-bob', 'on\n', { given: { BOT_DOT_OFFSITE_REPO: m.store }, dockerFirst: holdDoor(m) });
  release();
  const said = status(busy, 'hold-bob.json');
  assert.deepEqual([said.state, said.error], ['failed', 'Another off-site backup was running, so none was made since the account was held: ask again.']);
});

test("DELETE- of the machine's first account is refused before the front door is asked", (t) => {
  const m = machine(t);
  const done = ask(m, 'DELETE-ann', '', { dockerFirst: moveDoor(m) });
  assert.ok(!done.docker.some((c) => c.call.includes('front-door.js delete-account')), 'the front door is not asked');
  assert.doesNotMatch(done.system, /userdel/);
  const said = status(done, 'delete-ann.json');
  assert.deepEqual({ state: said.state, error: said.error }, { state: 'refused', error: "The account ann is the machine's first account, which stays on it." });
});

test('IMPORT- and DELETE- requests the front door made are refused, and nothing is read or deleted', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  m.offsite();
  const requests = path.join(m.dir, 'front-door', 'requests');
  for (const name of ['IMPORT-carl', 'DELETE-bob']) {
    fs.writeFileSync(path.join(requests, name), 'deadbeef\n');
    fs.chownSync(path.join(requests, name), 990, 990);
  }
  const done = ask(m, 'ann', '', { dockerFirst: moveDoor(m) });
  assert.equal(status(done, 'import-carl.json').error, 'Only root asks for this.');
  assert.equal(status(done, 'delete-bob.json').error, 'Only root asks for this.');
  assert.doesNotMatch(done.system, /^userdel botdot-bob$/m);
  assert.deepEqual(resticCalls(done), []);
});
