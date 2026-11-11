const { test } = require('node:test');
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
