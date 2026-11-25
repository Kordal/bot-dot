// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 2 of 9 of the off-site backup tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status } = require('./installer-helpers');
const { restic, machine, resticCalls, keygen, ssh } = require('./installer-offsite-helpers');

// The off-site backup set up from the admin page (ADR 161): the front door made a Storage Box sub-account and asks with
// OFFSITE-SET. A stand-in ssh says what it was given: its arguments, the password its askpass answers and the key.
const BOX = 'sftp://u1-sub1@u1-sub1.your-storagebox.de:23/botdot';

const setUp = (m, { body = `${BOX}\n\nsub-secret-1\n`, given = {} } = {}) => m.step('OFFSITE-SET', { body, given: { OFFSITE_KEY_WAIT: '0', ...given }, bins: { restic: restic(m.store), ssh, 'ssh-keygen': keygen } });

test('a restic download that fails is tried again over IPv4, and the error says GitHub could not be reached', (t) => {
  const m = machine(t);
  const curl = '#!/bin/sh\necho "curl $*" >> "$STAND_IN_LOG"\nexit 7\n';
  const done = m.offsite({ bins: { curl, restic: null } });
  assert.notEqual(done.status, 0);
  const calls = done.system.split('\n').filter((l) => /^curl .*restic_0\.19\.1_linux_amd64\.bz2/.test(l));
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0], / -4 /);
  assert.match(calls[1], /^curl -4 /);
  assert.match(status(done, 'offsite.json').error, /\(github\.com could not be reached, over IPv6 or IPv4\)/);
});

test('root\'s OFFSITE request starts the backup in a run of its own, and the nightly timer is set between 02:00 and 04:00', (t) => {
  const m = machine(t);
  fs.appendFileSync(path.join(m.dir, 'front-door', '.env'), `BOT_DOT_OFFSITE_REPO=${m.store}\n`);
  const done = m.step('OFFSITE');
  assert.match(done.system, /systemctl start --no-block botdot-offsite\.service/);
  const timer = fs.readFileSync(path.join(m.first.etc, 'systemd', 'system', 'botdot-offsite.timer'), 'utf8');
  const [, hh, mm] = timer.match(/^OnCalendar=\*-\*-\* (\d\d):(\d\d):00$/m);
  const minute = Number(hh) * 60 + Number(mm);
  const instance = fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8').match(/^BOT_DOT_INSTANCE=(.*)$/m)[1];
  assert.equal(minute, 120 + (parseInt(instance, 16) % 120), 'offset by the instance id');
  assert.match(timer, /^Persistent=true$/m);
  const service = fs.readFileSync(path.join(m.first.etc, 'systemd', 'system', 'botdot-offsite.service'), 'utf8');
  assert.match(service, /^ExecStart=\/bin\/sh \S+\/bin\/install\.sh --offsite$/m);
  assert.match(done.system, /systemctl enable --now botdot-offsite\.timer/);
});

test('a machine without an off-site repository has no timer, and an OFFSITE request says so', (t) => {
  const m = machine(t);
  assert.ok(!fs.existsSync(path.join(m.first.etc, 'systemd', 'system', 'botdot-offsite.timer')), 'the install set none');
  assert.equal(status(m.first, 'offsite.json'), null, 'nor any status');
  const done = m.step('OFFSITE');
  assert.doesNotMatch(done.system, /botdot-offsite/);
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'off', 'no backup to miss (#1017)');
  assert.match(said.error, /This machine has no off-site repository/);
});

test('an OFFSITE request the front door made starts a run too: the admin page\'s "Back up now" (ADR 161)', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  fs.appendFileSync(path.join(m.dir, 'front-door', '.env'), `BOT_DOT_OFFSITE_REPO=${m.store}\n`);
  const request = path.join(m.dir, 'front-door', 'requests', 'OFFSITE');
  fs.writeFileSync(request, '');
  fs.chownSync(request, 990, 990);
  const done = m.step('bob');
  assert.match(done.system, /systemctl start --no-block botdot-offsite\.service/);
});

test('the number of latest backups the admin page set is what forget keeps, pruned at once when it changes (ADR 161)', (t) => {
  const m = machine(t);
  m.offsite();
  fs.writeFileSync(path.join(m.dir, 'front-door', 'data', 'offsite-keep.json'), '{"last":2}');
  const forget = (done) => resticCalls(done).find((c) => / forget .*--keep/.test(c));
  const two = m.offsite();
  assert.match(forget(two), /--host [0-9a-f]{8} --keep-last 2 --prune$/, 'a new number prunes now');
  assert.match(forget(m.offsite()), /--keep-last 2$/, 'not again within the week');
  fs.writeFileSync(path.join(m.dir, 'front-door', 'data', 'offsite-keep.json'), '{"last":"2; rm -rf /"}');
  assert.match(forget(m.offsite()), /--keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune$/, 'anything else is the default');
});

test('the admin page\'s OFFSITE-SET puts the machine\'s key on the sub-account, opens the repository, leaves its password for the page and starts a run', (t) => {
  const m = machine(t);
  const done = setUp(m);
  const call = done.system.split('\n').find((l) => l.startsWith('ssh '));
  assert.ok(call, done.said);
  assert.match(call, /^ssh -p 23 .*-o PubkeyAuthentication=no .* u1-sub1@u1-sub1\.your-storagebox\.de install-ssh-key askpass=sub-secret-1 require=force key=ssh-ed25519 AAAA botdot$/);
  assert.ok(resticCalls(done).some((c) => / init --repository-version 2$/.test(c)), 'the repository is made');
  assert.match(fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8'), /^BOT_DOT_OFFSITE_REPO=sftp:\/\/u1-sub1@u1-sub1\.your-storagebox\.de:23\/botdot$/m);
  assert.match(done.system, /systemctl start --no-block botdot-offsite\.service/);
  assert.equal(status(done, 'offsite.json').state, 'setting-up');
  // The sub-account's password is nowhere; the repository's is in the front door's data for the page, the front door's own.
  assert.deepEqual(fs.readdirSync(m.secrets).filter((f) => /subpass|askpass/.test(f)), []);
  const shown = path.join(m.dir, 'front-door', 'data', 'offsite-password.json');
  const password = fs.readFileSync(path.join(m.secrets, 'password'), 'utf8').trim();
  assert.equal(JSON.parse(fs.readFileSync(shown, 'utf8')).password, password);
  assert.equal(fs.statSync(shown).mode & 0o777, 0o600);
  assert.equal(fs.statSync(shown).uid, fs.statSync(path.join(m.dir, 'front-door', 'data')).uid);
  assert.ok(!JSON.stringify(fs.readdirSync(path.join(m.dir, 'front-door', 'status')).map((f) => fs.readFileSync(path.join(m.dir, 'front-door', 'status', f), 'utf8'))).includes('sub-secret-1'));
  assert.ok(!done.said.includes('sub-secret-1') && !done.said.includes(password), 'neither password is said');

  // Set up again (another box): the repository's password stays and isn't left for the page again.
  fs.rmSync(shown);
  const again = setUp(m, { body: `${BOX.replace(/u1-sub1/g, 'u1-sub2')}\n\nsub-secret-2\n` });
  assert.match(again.system, /askpass=sub-secret-2/);
  assert.equal(fs.readFileSync(path.join(m.secrets, 'password'), 'utf8').trim(), password);
  assert.ok(!fs.existsSync(shown));
});

test('a setup whose key can\'t be put on the sub-account says why, and leaves the machine without an off-site repository', (t) => {
  const m = machine(t);
  const done = setUp(m, { given: { STAND_IN_SSH_FAIL: '1', OFFSITE_KEY_TRIES: '2' } });
  assert.equal(done.system.split('\n').filter((l) => l.startsWith('ssh ')).length, 2, 'tried again');
  const said = status(done, 'offsite.json');
  assert.deepEqual({ state: said.state, setup: said.setup }, { state: 'off', setup: true });
  assert.match(said.error, /Couldn't put this machine's key on u1-sub1@u1-sub1\.your-storagebox\.de: Permission denied/);
  assert.doesNotMatch(fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8'), /BOT_DOT_OFFSITE_REPO/);
  assert.ok(!fs.existsSync(path.join(m.secrets, 'password')), 'no password of a repository never opened');
  assert.ok(!fs.existsSync(path.join(m.dir, 'front-door', 'data', 'offsite-password.json')));
  assert.doesNotMatch(done.system, /botdot-offsite\.service/);
});

test('an OFFSITE-SET the front door made may name only a Storage Box, and gives no password', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  const request = path.join(m.dir, 'front-door', 'requests', 'OFFSITE-SET');
  fs.writeFileSync(request, 'sftp://evil@example.com:22/x\n\npw\n');
  fs.chownSync(request, 990, 990);
  const done = m.step('bob');
  assert.equal(status(done, 'offsite.json').state, 'off');
  assert.match(status(done, 'offsite.json').error, /Only a Hetzner Storage Box/);
  assert.doesNotMatch(fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8'), /BOT_DOT_OFFSITE_REPO/);
});
