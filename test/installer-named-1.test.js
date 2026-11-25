// install.sh on a stand-in machine (test/installer-helpers.js): an update to a named version, the snapshot of each
// account's data before its switch, and a rollback to it (#979, ADR 155).
// Part 1 of 2 of the named update tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checked } = require('./installer-helpers');
const { NAMED, update, refusedAtCheck } = require('./installer-named-helpers');

const REVISION = 'f'.repeat(40);

test('an update request that names a digest installs exactly that signed release, and its computer of the same source', (t) => {
  const { done, update: u, log, calls, first } = update(t, `${NAMED}\n`, { answers: { revision: REVISION, release: '7' } });
  assert.equal(u.state, 'updated', log);
  assert.equal(u.named, NAMED, 'update.json says the version it was asked for');
  const asked = done.checks.map(checked);
  const server = asked.find((a) => a[1] === 'server');
  assert.deepEqual(server, [`ghcr.io/ladrok/bot-dot@${NAMED}`, 'server', '--release', '--at', 'e'.repeat(64), '--installed', '1'], 'that release, by its own signed tag, never older than the one installed');
  const desktop = asked.find((a) => a[1] === 'desktop');
  assert.deepEqual(desktop, ['ghcr.io/ladrok/bot-dot-desktop:latest', 'desktop', '--at', REVISION], 'the computer of the same source revision');
  const env = fs.readFileSync(path.join(first.dir, 'front-door', '.env'), 'utf8');
  assert.match(env, new RegExp(`^BOT_DOT_IMAGE=ghcr\\.io/ladrok/bot-dot@${NAMED}$`, 'm'), 'the front door pins it');
  assert.match(env, /^BOT_DOT_RELEASE=7$/m, 'and its release number, against which an older one is refused');
  assert.ok(calls('bob').some((c) => c === `pull ghcr.io/ladrok/bot-dot@${NAMED}`), 'bob got that very image');
  assert.match(fs.readFileSync(path.join(first.dir, 'accounts', 'bob', '.env'), 'utf8'), new RegExp(`^BOT_DOT_IMAGE=ghcr\\.io/ladrok/bot-dot@${NAMED}$`, 'm'));
});

test('an update request without a digest takes the newest, as before', (t) => {
  const { done, update: u, log } = update(t, '');
  assert.equal(u.state, 'updated', log);
  assert.equal(u.named, undefined);
  assert.deepEqual(done.checks.map(checked).map((a) => a.slice(0, 3)), [['ghcr.io/ladrok/bot-dot:latest', 'server', '--release'], ['ghcr.io/ladrok/bot-dot-desktop:latest', 'desktop']]);
  assert.ok(!done.checks.some((a) => a.includes('--at')));
});

test('a digest that is not a signed release is refused at check, and nothing restarts', (t) => {
  refusedAtCheck(update(t, NAMED, { signed: { [`ghcr.io/ladrok/bot-dot@${NAMED}`]: 'it has no botdot signature' } }), new RegExp(`Refused ghcr\\.io/ladrok/bot-dot@${NAMED}: it has no botdot signature\\. Nothing was downloaded or started\\.`));
});

test('a request that names no digest is refused at check', (t) => {
  refusedAtCheck(update(t, 'latest please'), /Refused the version asked for: name it as sha256: and the 64 hex digits/);
});
