// install.sh on a stand-in machine (test/installer-helpers.js): each account's owner chooses when it switches to a new
// version.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PIN, SIGNED, installer, withBob, status, running } = require('./installer-helpers');

// --- Each account's owner chooses when it switches to a new version (#259, ADR 053) ---------------------------

// An install of ann and bob on the version before (PIN), the front door pinning it too, whose front door's data says
// `accounts`. update(): the admin page's update through root's step, which finds the newest (SIGNED); request(name):
// root's step for one request. Each returns what it did since the last one.
function onOlderVersion(t, accounts, { pins = {} } = {}) {
  const { first, door, upIn } = withBob(t);
  door({ accounts });
  const pin = (f, image) => fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^BOT_DOT_IMAGE=.*$/m, `BOT_DOT_IMAGE=${image}`));
  pin(path.join(first.dir, 'front-door', '.env'), pins.door || `ghcr.io/kordal/bot-dot${PIN}`);
  for (const name of ['ann', 'bob']) pin(path.join(first.dir, 'accounts', name, '.env'), pins[name] || `ghcr.io/kordal/bot-dot${PIN}`);
  let seen = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  const request = (name, options = {}) => {
    fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', name), '');
    const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], ...options });
    assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
    assert.deepEqual(fs.readdirSync(path.join(first.dir, 'front-door', 'requests')), [], 'the request is taken');
    const docker = done.docker.slice(seen);
    seen = done.docker.length;
    const calls = (name) => docker.filter((c) => c.host === `unix://${first.run}/${name}/docker.sock`).map((c) => c.call);
    const log = path.join(first.dir, 'update.log');
    return { ...done, docker, calls, up: (name) => upIn({ docker }, name), log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
  };
  return { first, door, request, update: (options) => request('UPDATE', options), started: path.join(first.top, 'started') };
}

test('an update leaves an account whose owner turned "Update automatically" off on its version, with the new one in its Docker', (t) => {
  const { first, update } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  const done = update();
  const result = status(done, 'update.json');
  assert.equal(result.state, 'updated', `a waiting account doesn't fail the update\n${done.log}`);
  assert.deepEqual(result.accounts, [{ name: 'ann', result: 'updated' }, { name: 'bob', result: 'waiting' }]);
  assert.ok(done.up('ann'), "ann's account is switched");
  assert.ok(!done.up('bob'), "bob's isn't restarted");
  assert.ok(done.calls('bob').some((c) => c === `pull -q ghcr.io/kordal/bot-dot${SIGNED}`), 'the new version is downloaded into its Docker');
  assert.ok(!done.calls('bob').some((c) => /update-install\.js --clean/.test(c)), 'and its old images stay');
  assert.equal(done.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${PIN}`, 'it runs the version it ran');
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`, 'the front door pins the new version');
  const bob = status(done, 'account-bob.json');
  assert.equal(bob.state, 'waiting');
  assert.ok(!Number.isNaN(Date.parse(bob.since)), JSON.stringify(bob));
  assert.match(done.log, /The account bob waits for its owner on the version it runs/);
  assert.equal(status(done, 'account-ann.json'), null, "nothing said of an account that never waited");
  assert.equal(fs.statSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json')).mode & 0o777, 0o644, 'root writes it, the front door reads it');
});

test("the admin's own account waits by the same rule as any other, and the others switch (#274)", (t) => {
  const { update, request } = onOlderVersion(t, { ann: { autoUpdate: false }, bob: {} });
  const done = update();
  const result = status(done, 'update.json');
  assert.equal(result.state, 'updated', done.log);
  assert.deepEqual(result.accounts, [{ name: 'ann', result: 'waiting' }, { name: 'bob', result: 'updated' }]);
  assert.ok(!done.up('ann'), "the admin's account isn't restarted");
  assert.ok(done.up('bob'), "bob's is switched");
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${PIN}`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`, 'the front door moves on');
  assert.equal(status(done, 'account-ann.json').state, 'waiting');
  const now = request('SWITCH-ann');
  assert.ok(now.up('ann'), '"Update now" switches it');
  assert.equal(now.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.equal(status(now, 'account-ann.json').state, 'updated');
});

test('"Update now" switches that account alone to the version the front door pins, with its way back', (t) => {
  const { update, request } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  update();
  const done = request('SWITCH-bob');
  assert.ok(done.up('bob'), 'bob is started on the new version');
  assert.ok(!done.up('ann'), 'ann is left as it is');
  assert.ok(!done.docker.some((c) => c.host === 'machine' && /^compose .* up/.test(c.call)), 'and the front door');
  assert.deepEqual(done.checks, [], 'no new release is looked for: it is the one the admin installed');
  assert.equal(done.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.ok(done.calls('bob').some((c) => /update-install\.js --clean/.test(c)), 'what it replaced goes');
  assert.equal(status(done, 'account-bob.json').state, 'updated');
  assert.match(done.said, /Switching the account bob to the new version, as asked/);

  // Asked again: it runs it already, and nothing restarts.
  const again = request('SWITCH-bob');
  assert.ok(!again.up('bob'));
  assert.match(again.said, /The account bob runs the newest version already/);
});

test('a switch whose new server doesn\'t start puts the account back, and says why to its owner', (t) => {
  const { first, update, request } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  update();
  const sock = `${first.run}/bob/docker.sock`;
  const ups = '"$BOT_DOT_DIR/bob-ups"';
  const done = request('SWITCH-bob', { dockerFirst: [`if [ "\${DOCKER_HOST:-}" = "unix://${sock}" ] && [ "$1" = compose ] && [ "$4" = up ] && [ ! -e ${ups} ]; then touch ${ups}; rm -f "$(sed -n 's/^BOT_DOT_FRONT_DOOR_FOLDER=//p' "$3/.env")/botdot.sock"; exit 0; fi`] });
  assert.equal(done.calls('bob').filter((c) => /^compose .* up -d/.test(c)).length, 2, 'started again on its old compose file');
  assert.equal(done.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${PIN}`);
  const bob = status(done, 'account-bob.json');
  assert.equal(bob.state, 'kept');
  assert.match(bob.error, /Its new botdot server didn't start, so it runs the version it ran before\./);
});

test('a switch asks nothing of a suspended account, nor of a name that is no account', (t) => {
  const { door, update, request } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  update();
  door({ accounts: { ann: {}, bob: { autoUpdate: false, suspended: '2026-10-21T12:00:00.000Z' } } });
  const done = request('SWITCH-bob');
  assert.ok(!done.up('bob'));
  assert.match(done.said, /The account bob isn't running, so it wasn't switched/);
  const bad = request('SWITCH-Bad');
  assert.match(bad.said, /Not an account's name, so nothing was switched: Bad/);
});

test("a switch of an account whose Docker doesn't run says so, so that the front door doesn't ask again and again", (t) => {
  const { update, request, started } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  update();
  fs.rmSync(started);
  const done = request('SWITCH-bob');
  assert.ok(!done.up('bob'));
  const bob = status(done, 'account-bob.json');
  assert.equal(bob.state, 'kept');
  assert.match(bob.error, /was not running/);
});

test('an update switches an account that would be two versions behind, and one an earlier update kept back', (t) => {
  // bob waits for the version the front door pins (b…b), and runs the one before (a…a); the newest is c…c.
  const NEXT = `@sha256:${'b'.repeat(64)}`;
  const { first, update } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } }, { pins: { door: `ghcr.io/kordal/bot-dot${NEXT}`, ann: `ghcr.io/kordal/bot-dot${NEXT}` } });
  fs.writeFileSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json'), JSON.stringify({ state: 'waiting', at: '2026-10-20T12:00:00Z', since: '2026-10-20T12:00:00Z' }));
  const done = update();
  assert.ok(done.up('bob'), done.log);
  assert.equal(status(done, 'update.json').accounts.find((a) => a.name === 'bob').result, 'updated');
  assert.equal(status(done, 'account-bob.json').state, 'updated');

  // Kept back by a failure (it runs a…a, the front door pins c…c and nothing says it waits): switched as before.
  const { update: again } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } }, { pins: { door: `ghcr.io/kordal/bot-dot${SIGNED}`, ann: `ghcr.io/kordal/bot-dot${SIGNED}` } });
  assert.ok(again().up('bob'));
});

test('an update finds nothing new while an account waits for the newest, and keeps when it began to wait', (t) => {
  const { first, update } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } }, { pins: { door: `ghcr.io/kordal/bot-dot${SIGNED}`, ann: `ghcr.io/kordal/bot-dot${SIGNED}` } });
  const waiting = { state: 'waiting', at: '2026-10-20T12:00:00Z', since: '2026-10-20T12:00:00Z', version: 'ccccccc' };
  fs.writeFileSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json'), JSON.stringify(waiting));
  const done = update({ dockerFirst: running(`ghcr.io/kordal/bot-dot${SIGNED}`, { account: 'bob', old: `ghcr.io/kordal/bot-dot${PIN}` }) });
  assert.match(done.log, /It was the newest already/);
  assert.ok(!done.up('bob') && !done.up('ann'));
  assert.deepEqual(status(done, 'account-bob.json'), waiting);

  // Something else is new (the computer's image): bob still waits, since the same time.
  const env = path.join(first.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^BOT_DOT_COMPUTER_IMAGE=.*$/m, `BOT_DOT_COMPUTER_IMAGE=ghcr.io/kordal/bot-dot-desktop${PIN}`));
  const later = update();
  assert.ok(!later.up('bob'), later.log);
  assert.equal(status(later, 'account-bob.json').since, waiting.since);
});

test('the installer run by hand switches every account, and deleting an account removes what was said of it', (t) => {
  const { first, door, request } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  const byHand = installer(t, { again: first, dotenv: null });
  assert.equal(byHand.status, 0, `${byHand.said}\n${byHand.stderr}`);
  assert.equal(byHand.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  fs.writeFileSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json'), '{"state":"waiting"}');
  door({ accounts: { ann: {} }, deleted: { bob: '2026-10-21T12:00:00.000Z' } });
  request('bob');
  assert.ok(!fs.existsSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json')));
});
