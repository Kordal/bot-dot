// install.sh on a stand-in machine (test/installer-helpers.js): an update to a named version, the snapshot of each
// account's data before its switch, and a rollback to it (#979, ADR 155).
// Part 2 of 2 of the named update tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer, withBob, status } = require('./installer-helpers');
const { NAMED, update, refusedAtCheck } = require('./installer-named-helpers');

// A snapshot as a switch that didn't finish leaves it: root's own, with the data and what the account ran before.
function snapshotOf(r) {
  const snap = path.join(r.home, 'snapshot');
  fs.mkdirSync(path.join(snap, 'data'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(snap, 'data', 'note'), 'before');
  fs.writeFileSync(path.join(snap, 'compose.yaml'), `${fs.readFileSync(path.join(r.home, 'compose.yaml'), 'utf8')}# the version before\n`);
  fs.copyFileSync(path.join(r.home, '.env'), path.join(snap, '.env'));
  fs.writeFileSync(path.join(snap, 'at'), `${new Date().toISOString()}\n`);
  return snap;
}

test("the admin page's Update of a front door from before #979, which writes the time it asked, takes the newest", (t) => {
  const { update: u, log } = update(t, `${new Date().toISOString()}\n`);
  assert.equal(u.state, 'updated', log);
  assert.equal(u.named, undefined, "it names no version");
  assert.doesNotMatch(log, /Refused the version asked for/);
});

test('a named version older than the one the front door runs is refused', (t) => {
  refusedAtCheck(update(t, NAMED, { answers: { release: '3' } }, { dotenv: 'BOT_DOT_RELEASE=5\n' }), /it is older than the version this machine runs/);
});

test("each account's data is kept as a snapshot before its switch, and goes once its new server answers", (t) => {
  const { home, calls, log, update: u, done } = update(t, NAMED);
  assert.equal(u.state, 'updated', log);
  const stop = calls('bob').findIndex((c) => /^compose .* stop bot-dot$/.test(c));
  assert.ok(stop >= 0 && stop < calls('bob').findIndex((c) => /^compose .* up -d/.test(c)), 'its server stops for the copy, before the switch');
  assert.match(log, /Keeping a snapshot of the account bob's data before it switches/);
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.startsWith('snapshot')), [], 'no copy of its data stays on its disk');
  // Its disk is an image that only grows: the copy's blocks go back to the machine at once.
  const trimmed = done.system.indexOf(`fstrim ${home}`);
  assert.ok(trimmed >= 0, `its disk is trimmed:\n${done.system}`);
});

test("an account whose disk wouldn't keep a fifth free after the snapshot switches without one", (t) => {
  const { home, calls, log, update: u } = update(t, NAMED, { given: { STAND_IN_DISK_FREE: '1024' } });
  assert.equal(u.state, 'updated', log);
  assert.match(log, /The account bob's disk has no room for a snapshot of its data \(0\.0 GB\), so it switches without one/);
  assert.doesNotMatch(log, /Keeping a snapshot of the account bob/);
  assert.ok(!calls('bob').some((c) => /^compose .* stop bot-dot$/.test(c)), "its server isn't stopped for a copy");
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.startsWith('snapshot')), []);
});

test("a new server that doesn't answer gets its data back from the snapshot, with its version (ADR 044)", (t) => {
  // bob's first `compose up` of the update starts a server that changes its data and never answers.
  const ups = '"$BOT_DOT_DIR/bob-ups"';
  const { home, first } = withBob(t);
  fs.mkdirSync(path.join(home, 'data'), { recursive: true });
  fs.writeFileSync(path.join(home, 'data', 'note'), 'before');
  fs.appendFileSync(path.join(home, 'compose.yaml'), '# the version before\n');
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), NAMED); // another version than it runs
  const sock = `${first.run}/bob/docker.sock`;
  const breaks = `[ "$1" = compose ] && [ "$4" = up ] && [ ! -e ${ups} ] && { touch ${ups}; echo migrated > "$3/data/note"; rm -f "$(sed -n 's/^BOT_DOT_FRONT_DOOR_FOLDER=//p' "$3/.env")/botdot.sock"; exit 0; }`;
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: [`if [ "\${DOCKER_HOST:-}" = "unix://${sock}" ]; then ${breaks}; fi`] });
  assert.equal(done.status, 0, done.stderr);
  const log = fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8');
  assert.equal(status(done, 'update.json').accounts.find((a) => a.name === 'bob').result, 'kept', log);
  assert.match(log, /Its data is the snapshot's again\./);
  assert.equal(fs.readFileSync(path.join(home, 'data', 'note'), 'utf8'), 'before', 'its data as it was');
  assert.match(fs.readFileSync(path.join(home, 'compose.yaml'), 'utf8'), /# the version before/, 'and its version');
});

test('a rollback request takes an account back to its snapshot and the version before, and its status file says so', (t) => {
  const r = update(t, NAMED);
  assert.equal(r.update.state, 'updated', r.log);
  snapshotOf(r);
  fs.writeFileSync(path.join(r.home, 'data', 'note'), 'after');
  const done = r.step('ROLLBACK-bob');
  assert.match(done.said, /Rolling the account bob back to its snapshot/);
  assert.equal(fs.readFileSync(path.join(r.home, 'data', 'note'), 'utf8'), 'before', 'its data is the snapshot\'s');
  assert.match(fs.readFileSync(path.join(r.home, 'compose.yaml'), 'utf8'), /# the version before/, 'its compose file the one it ran');
  assert.equal(fs.readFileSync(path.join(r.home, '.env'), 'utf8'), fs.readFileSync(path.join(r.first.dir, 'accounts', 'bob', '.env'), 'utf8'));
  assert.ok(!fs.existsSync(path.join(r.home, 'snapshot')) && !fs.existsSync(path.join(r.home, 'data.after')), 'the snapshot is used up');
  assert.equal(status(done, 'account-bob.json').state, 'rolledback');
  assert.ok(r.upIn(done, 'bob'), 'its server is started again');

  // Again: there is nothing to go back to.
  const none = r.step('ROLLBACK-bob');
  assert.equal(status(none, 'account-bob.json').state, 'kept');
  assert.equal(status(none, 'account-bob.json').error, 'It has no snapshot to go back to.');
  assert.ok(!r.upIn(none, 'bob'), 'nothing restarted');
});

test("a snapshot the account's own user made is not trusted", (t) => {
  const r = update(t, NAMED);
  const snap = path.join(r.home, 'snapshot');
  fs.symlinkSync('/etc', snap);
  const done = r.step('ROLLBACK-bob');
  assert.equal(status(done, 'account-bob.json').error, 'It has no snapshot to go back to.');
});
