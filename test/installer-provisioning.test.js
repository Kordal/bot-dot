const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer, PIN, SIGNED } = require('./installer-helpers');

const managed = { BOT_DOT_MANAGED: '1', BOT_DOT_VARIANT: 'one', BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com' };

test('a managed install becomes ready before its computer download and keeps a durable task', (t) => {
  const done = installer(t, { dotenv: '', given: { ...managed, BOT_DOT_ADMIN: 'ann' } });
  assert.equal(done.status, 0, done.said + done.stderr);
  assert.match(done.said, /BOTDOT_READY /);
  assert.ok(!done.accountCalls('ann').some((c) => c.startsWith('pull ') && c.includes('desktop')));
  assert.match(done.read('computer-preparation/ann'), /@sha256:[0-9a-f]{64}/);
  assert.match(fs.readFileSync(path.join(done.etc, 'systemd/system/botdot-computers.service'), 'utf8'), /prepare-computers.sh/);
  assert.match(done.read('front-door/status/computer-preparation.json'), /"state":"preparing"/);
});

test('a transient server pull is retried without rerunning the installer', (t) => {
  const done = installer(t, { dockerFirst: [
    'if [ "$1" = pull ] && [ -z "${DOCKER_HOST:-}" ] && [ ! -f "$HOME/pull-once" ]; then touch "$HOME/pull-once"; echo "TLS handshake timeout" >&2; exit 1; fi',
  ] });
  assert.equal(done.status, 0, done.said + done.stderr);
  assert.match(done.said, /Retrying image download/);
});

test('managed image handoff streams when runtime storage cannot hold an archive', (t) => {
  const done = installer(t, { dotenv: '', given: { ...managed, BOT_DOT_ADMIN: 'ann' }, dockerFirst: [
    'if [ "$1" = save ]; then [ "$2" != -o ] || { echo "runtime archive: no space left on device" >&2; exit 1; }; printf "verified-image-stream"; exit 0; fi',
    'if [ "$1" = load ]; then [ "$(cat)" = verified-image-stream ] || exit 1; exit 0; fi',
  ] });
  assert.equal(done.status, 0, done.said + done.stderr);
  assert.match(done.said, /BOTDOT_READY /);
  assert.ok(!done.calls.some((c) => c.startsWith('save -o ')));
  assert.ok(!fs.readdirSync(done.run).some((n) => n.startsWith('image-transfer.')));
});

test('a partial export cannot report readiness even when the importer exits successfully', (t) => {
  const done = installer(t, { dotenv: '', given: { ...managed, BOT_DOT_ADMIN: 'ann' }, dockerFirst: [
    'if [ "$1" = save ]; then printf partial; echo "content digest missing" >&2; exit 23; fi',
    'if [ "$1" = load ]; then cat >/dev/null; exit 0; fi',
  ] });
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /Couldn't export .*exit 23.*content digest missing/);
  assert.doesNotMatch(done.said, /BOTDOT_READY /);
  assert.ok(!fs.readdirSync(done.run).some((n) => n.startsWith('image-transfer.')));
});

test('a failed importer reports its diagnostic and cleans up the stream', (t) => {
  const done = installer(t, { dotenv: '', given: { ...managed, BOT_DOT_ADMIN: 'ann' }, dockerFirst: [
    'if [ "$1" = save ]; then printf image; exit 0; fi',
    'if [ "$1" = load ]; then cat >/dev/null; echo "account disk full" >&2; exit 24; fi',
  ] });
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /Couldn't hand .*exit 24.*account disk full/);
  assert.doesNotMatch(done.said, /BOTDOT_READY /);
  assert.ok(!fs.readdirSync(done.run).some((n) => n.startsWith('image-transfer.')));
});

test('termination stops an active managed transfer and removes its FIFO', (t) => {
  const done = installer(t, { dotenv: '', given: { ...managed, BOT_DOT_ADMIN: 'ann' }, dockerFirst: [
    'if [ "$1" = save ]; then while :; do printf image; done; fi',
    'if [ "$1" = load ]; then kill -TERM "$PPID"; cat >/dev/null; exit 0; fi',
  ] });
  assert.equal(done.status, 1);
  assert.doesNotMatch(done.said, /BOTDOT_READY /);
  assert.ok(!fs.readdirSync(done.run).some((n) => n.startsWith('image-transfer.')));
});

test('an import error is preserved when the exporter also reports a broken pipe', (t) => {
  const done = installer(t, { dotenv: '', given: { ...managed, BOT_DOT_ADMIN: 'ann' }, dockerFirst: [
    'if [ "$1" = save ]; then echo "write stdout: broken pipe" >&2; exit 1; fi',
    'if [ "$1" = load ]; then cat >/dev/null; echo "account disk full" >&2; exit 24; fi',
  ] });
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /broken pipe.*import.*exit 24.*account disk full/);
  assert.doesNotMatch(done.said, /BOTDOT_READY /);
});

test('a first install checks the selected release rather than latest', (t) => {
  const done = installer(t, { dotenv: '', given: { ...managed, BOT_DOT_ADMIN: 'ann', BOT_DOT_INSTALL_TO: PIN.slice(1) } });
  assert.equal(done.status, 0, done.said + done.stderr);
  assert.ok(done.checks.some((c) => c.includes('--at') && c.includes(PIN.slice(8))), JSON.stringify(done.checks));
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${PIN}`);
});

test('preparing a base image installs prerequisites without making botdot accounts', (t) => {
  const done = installer(t, { dotenv: '', args: ['--prerequisites'], given: { BOT_DOT_YES: '1' } });
  assert.equal(done.status, 0, done.said + done.stderr);
  assert.ok(!fs.existsSync(path.join(done.dir, 'accounts')));
  assert.doesNotMatch(done.said, /BOTDOT_READY/);
});


test('offline image preparation validates packages without trying to reach a Docker daemon', (t) => {
  const done = installer(t, { dotenv: '', args: ['--prerequisites'], given: { BOT_DOT_YES: '1', BOT_DOT_IMAGE_BUILD: '1' }, dockerFirst: ['[ "$1" = info ] && exit 1'] });
  assert.equal(done.status, 0, done.said + done.stderr);
  assert.ok(!done.calls.includes('info'));
  assert.ok(!done.calls.some((c) => c.startsWith('pull ')));
});
