// install.sh on a stand-in machine (test/installer-helpers.js): each account's owner chooses when it switches to a new
// version.
// Part 1 of 3 of the version switch tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PIN, SIGNED, status } = require('./installer-helpers');
const { onOlderVersion } = require('./installer-switch-helpers');

test('an update leaves an account whose owner turned "Update automatically" off on its version, with the new one in its Docker', (t) => {
  const { first, update } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  const done = update();
  const result = status(done, 'update.json');
  assert.equal(result.state, 'updated', `a waiting account doesn't fail the update\n${done.log}`);
  assert.deepEqual(result.accounts, [{ name: 'ann', result: 'updated' }, { name: 'bob', result: 'waiting' }]);
  assert.ok(done.up('ann'), "ann's account is switched");
  assert.ok(!done.up('bob'), "bob's isn't restarted");
  assert.ok(done.calls('bob').some((c) => c === `pull ghcr.io/ladrok/bot-dot${SIGNED}`), 'the new version is downloaded into its Docker');
  assert.ok(!done.calls('bob').some((c) => /update-install\.js --clean/.test(c)), 'and its old images stay');
  assert.equal(done.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${PIN}`, 'it runs the version it ran');
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`, 'the front door pins the new version');
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
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${PIN}`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`, 'the front door moves on');
  assert.equal(status(done, 'account-ann.json').state, 'waiting');
  const now = request('SWITCH-ann');
  assert.ok(now.up('ann'), '"Update now" switches it');
  assert.equal(now.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  assert.equal(status(now, 'account-ann.json').state, 'updated');
});
