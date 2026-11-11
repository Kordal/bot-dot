// install.sh on a stand-in machine (test/installer-helpers.js): an update to a named version, the snapshot of each
// account's data before its switch, and a rollback to it (#979, ADR 155).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checked, installer, withBob, status } = require('./installer-helpers');

const NAMED = `sha256:${'e'.repeat(64)}`;
const REVISION = 'f'.repeat(40);

// An install with bob, whose data holds `note`, and an update through root's step asked for with `request` (the text
// of the UPDATE file). options: more for the installer (answers, dockerFirst, given). What it did, update.json, the
// front door's .env and bob's home.
function update(t, request, options = {}, { dotenv = '' } = {}) {
  const bob = withBob(t);
  const { first, home } = bob;
  fs.mkdirSync(path.join(home, 'data'), { recursive: true });
  fs.writeFileSync(path.join(home, 'data', 'note'), 'before');
  fs.appendFileSync(path.join(home, 'compose.yaml'), '# the version before\n');
  if (dotenv) fs.appendFileSync(path.join(first.dir, 'front-door', '.env'), dotenv);
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), request);
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], ...options });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const log = fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8');
  const calls = (name) => done.docker.slice(before).filter((c) => c.host === `unix://${first.run}/${name}/docker.sock`).map((c) => c.call);
  return { ...bob, done, log, calls, before, update: status(done, 'update.json'), env: done.env };
}

test('an update request that names a digest installs exactly that signed release, and its computer of the same source', (t) => {
  const { done, update: u, log, calls, first } = update(t, `${NAMED}\n`, { answers: { revision: REVISION, release: '7' } });
  assert.equal(u.state, 'updated', log);
  assert.equal(u.named, NAMED, 'update.json says the version it was asked for');
  const asked = done.checks.map(checked);
  const server = asked.find((a) => a[1] === 'server');
  assert.deepEqual(server, [`ghcr.io/kordal/bot-dot@${NAMED}`, 'server', '--release', '--at', 'e'.repeat(64), '--installed', '1'], 'that release, by its own signed tag, never older than the one installed');
  const desktop = asked.find((a) => a[1] === 'desktop');
  assert.deepEqual(desktop, ['ghcr.io/kordal/bot-dot-desktop:latest', 'desktop', '--at', REVISION], 'the computer of the same source revision');
  const env = fs.readFileSync(path.join(first.dir, 'front-door', '.env'), 'utf8');
  assert.match(env, new RegExp(`^BOT_DOT_IMAGE=ghcr\\.io/kordal/bot-dot@${NAMED}$`, 'm'), 'the front door pins it');
  assert.match(env, /^BOT_DOT_RELEASE=7$/m, 'and its release number, against which an older one is refused');
  assert.ok(calls('bob').some((c) => c === `pull ghcr.io/kordal/bot-dot@${NAMED}`), 'bob got that very image');
  assert.match(fs.readFileSync(path.join(first.dir, 'accounts', 'bob', '.env'), 'utf8'), new RegExp(`^BOT_DOT_IMAGE=ghcr\\.io/kordal/bot-dot@${NAMED}$`, 'm'));
});

test('an update request without a digest takes the newest, as before', (t) => {
  const { done, update: u, log } = update(t, '');
  assert.equal(u.state, 'updated', log);
  assert.equal(u.named, undefined);
  assert.deepEqual(done.checks.map(checked).map((a) => a.slice(0, 3)), [['ghcr.io/kordal/bot-dot:latest', 'server', '--release'], ['ghcr.io/kordal/bot-dot-desktop:latest', 'desktop']]);
  assert.ok(!done.checks.some((a) => a.includes('--at')));
});

// What a refused named update leaves: nothing downloaded, nothing restarted, update.json failed at check.
function refusedAtCheck(r, why) {
  assert.equal(r.update.state, 'failed', r.log);
  assert.equal(r.update.phase, 'check', 'it stopped at check');
  assert.match(r.update.error, why);
  const since = r.done.docker.slice(r.before).map((c) => c.call);
  assert.ok(!since.some((c) => /^(pull|load)\b|^compose .* (up|stop)/.test(c)), `nothing downloaded or restarted:\n${since.join('\n')}`);
  assert.match(fs.readFileSync(path.join(r.home, 'compose.yaml'), 'utf8'), /# the version before/);
}

test('a digest that is not a signed release is refused at check, and nothing restarts', (t) => {
  refusedAtCheck(update(t, NAMED, { signed: { [`ghcr.io/kordal/bot-dot@${NAMED}`]: 'it has no botdot signature' } }), new RegExp(`Refused ghcr\\.io/kordal/bot-dot@${NAMED}: it has no botdot signature\\. Nothing was downloaded or started\\.`));
});

test('a request that names no digest is refused at check', (t) => {
  refusedAtCheck(update(t, 'latest please'), /Refused the version asked for: name it as sha256: and the 64 hex digits/);
});

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
