// install.sh on a stand-in machine (test/installer-helpers.js): an update to a named version, the snapshot of each
// account's data before its switch, and a rollback to it (#979, ADR 155).
// Part 2 of 3 of the named update tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer, withBob, status } = require('./installer-helpers');

const NAMED = `sha256:${'e'.repeat(64)}`;

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
  refusedAtCheck(update(t, NAMED, { signed: { [`ghcr.io/ladrok/bot-dot@${NAMED}`]: 'it has no botdot signature' } }), new RegExp(`Refused ghcr\\.io/ladrok/bot-dot@${NAMED}: it has no botdot signature\\. Nothing was downloaded or started\\.`));
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
