// install.sh on a stand-in machine (test/installer-helpers.js): each account's owner chooses when it switches to a new
// version.
// Part 3 of 3 of the version switch tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PIN, SIGNED, installer, status, running } = require('./installer-helpers');
const { onOlderVersion } = require('./installer-switch-helpers');

test('an update switches an account that would be two versions behind, and one an earlier update kept back', (t) => {
  // bob waits for the version the front door pins (b…b), and runs the one before (a…a); the newest is c…c.
  const NEXT = `@sha256:${'b'.repeat(64)}`;
  const { first, update } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } }, { pins: { door: `ghcr.io/ladrok/bot-dot${NEXT}`, ann: `ghcr.io/ladrok/bot-dot${NEXT}` } });
  fs.writeFileSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json'), JSON.stringify({ state: 'waiting', at: '2026-10-20T12:00:00Z', since: '2026-10-20T12:00:00Z' }));
  const done = update();
  assert.ok(done.up('bob'), done.log);
  assert.equal(status(done, 'update.json').accounts.find((a) => a.name === 'bob').result, 'updated');
  assert.equal(status(done, 'account-bob.json').state, 'updated');

  // Kept back by a failure (it runs a…a, the front door pins c…c and nothing says it waits): switched as before.
  const { update: again } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } }, { pins: { door: `ghcr.io/ladrok/bot-dot${SIGNED}`, ann: `ghcr.io/ladrok/bot-dot${SIGNED}` } });
  assert.ok(again().up('bob'));
});

test('an update finds nothing new while an account waits for the newest, and keeps when it began to wait', (t) => {
  const { first, update } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } }, { pins: { door: `ghcr.io/ladrok/bot-dot${SIGNED}`, ann: `ghcr.io/ladrok/bot-dot${SIGNED}` } });
  const waiting = { state: 'waiting', at: '2026-10-20T12:00:00Z', since: '2026-10-20T12:00:00Z', version: 'ccccccc' };
  fs.writeFileSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json'), JSON.stringify(waiting));
  const done = update({ dockerFirst: running(`ghcr.io/ladrok/bot-dot${SIGNED}`, { account: 'bob', old: `ghcr.io/ladrok/bot-dot${PIN}` }) });
  assert.match(done.log, /It was the newest already/);
  assert.ok(!done.up('bob') && !done.up('ann'));
  assert.deepEqual(status(done, 'account-bob.json'), waiting);

  // Something else is new (the computer's image): bob still waits, since the same time.
  const env = path.join(first.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^BOT_DOT_COMPUTER_IMAGE=.*$/m, `BOT_DOT_COMPUTER_IMAGE=ghcr.io/ladrok/bot-dot-desktop${PIN}`));
  const later = update();
  assert.ok(!later.up('bob'), later.log);
  assert.equal(status(later, 'account-bob.json').since, waiting.since);
});

test('the installer run by hand switches every account, and deleting an account removes what was said of it', (t) => {
  const { first, door, request } = onOlderVersion(t, { ann: {}, bob: { autoUpdate: false } });
  const byHand = installer(t, { again: first, dotenv: null });
  assert.equal(byHand.status, 0, `${byHand.said}\n${byHand.stderr}`);
  assert.equal(byHand.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  fs.writeFileSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json'), '{"state":"waiting"}');
  door({ accounts: { ann: {} }, deleted: { bob: '2026-10-21T12:00:00.000Z' } });
  request('bob');
  assert.ok(!fs.existsSync(path.join(first.dir, 'front-door', 'status', 'account-bob.json')));
});

// --- The front door decides every switch (#1689, ADR 271): it writes `autoUpdate: false` for every account ------------

test("an update only downloads when the front door says `autoUpdate: false` for every account, and each switches when asked (#1689)", (t) => {
  const { update, request } = onOlderVersion(t, { ann: { updateWhen: 'night', autoUpdate: false }, bob: { updateWhen: 'ready', autoUpdate: false } });
  const done = update();
  const result = status(done, 'update.json');
  assert.equal(result.state, 'updated', done.log);
  assert.deepEqual(result.accounts, [{ name: 'ann', result: 'waiting' }, { name: 'bob', result: 'waiting' }], 'the admin\'s Update restarts no account');
  assert.ok(!done.up('ann') && !done.up('bob'), 'neither is restarted');
  for (const name of ['ann', 'bob']) {
    assert.ok(done.calls(name).some((c) => c === `pull ghcr.io/ladrok/bot-dot${SIGNED}`), `the new version is downloaded into ${name}'s Docker`);
    assert.equal(done.accountEnv(name).BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${PIN}`, `${name} runs the version it ran`);
    assert.equal(status(done, `account-${name}.json`).state, 'waiting');
  }
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`, 'the front door moves on');
  // The front door asks each switch with SWITCH-<name>, when it decides to.
  const bob = request('SWITCH-bob');
  assert.ok(bob.up('bob') && !bob.up('ann'), 'bob alone');
  assert.equal(bob.accountEnv('bob').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  const ann = request('SWITCH-ann');
  assert.ok(ann.up('ann') && !ann.up('bob'), 'then ann');
  assert.equal(status(ann, 'account-ann.json').state, 'updated');
});

test('a machine of one account: the update downloads and leaves its account waiting, and it switches on SWITCH-<name> (#1689, ADR 271)', (t) => {
  const { update, request } = onOlderVersion(t, { ann: { updateWhen: 'night', autoUpdate: false } }, { one: true });
  const done = update();
  const result = status(done, 'update.json');
  assert.equal(result.state, 'updated', done.log);
  assert.deepEqual(result.accounts, [{ name: 'ann', result: 'waiting' }], 'step one: downloaded, and left waiting');
  assert.ok(!done.up('ann'), 'its bots are not restarted');
  assert.ok(done.calls('ann').some((c) => c === `pull ghcr.io/ladrok/bot-dot${SIGNED}`), 'the new version is in its Docker');
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${PIN}`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`, 'the front door runs the new version');
  assert.equal(status(done, 'account-ann.json').state, 'waiting');
  // Step two: the front door's own plan asks for the switch.
  const now = request('SWITCH-ann');
  assert.ok(now.up('ann'), 'switched');
  assert.equal(now.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/ladrok/bot-dot${SIGNED}`);
  assert.equal(status(now, 'account-ann.json').state, 'updated');
});
