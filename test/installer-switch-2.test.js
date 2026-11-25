// install.sh on a stand-in machine (test/installer-helpers.js): each account's owner chooses when it switches to a new
// version.
// Part 2 of 3 of the version switch tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PIN, SIGNED, status } = require('./installer-helpers');
const { onOlderVersion } = require('./installer-switch-helpers');

test('"Update now" switches that account alone to the version the front door pins, with its way back', (t) => {
  const { update, request } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  update();
  const done = request('SWITCH-bob');
  assert.ok(done.up('bob'), 'bob is started on the new version');
  assert.ok(!done.up('ann'), 'ann is left as it is');
  assert.ok(!done.docker.some((c) => c.host === 'machine' && /^compose .* up/.test(c.call)), 'and the front door');
  assert.deepEqual(done.checks, [], 'no new release is looked for: it is the one the admin installed');
  assert.equal(done.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
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
  assert.equal(done.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${PIN}`);
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
