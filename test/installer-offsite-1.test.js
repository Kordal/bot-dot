// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
// Part 1 of 9 of the off-site backup tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { status } = require('./installer-helpers');
const { machine, resticCalls } = require('./installer-offsite-helpers');

const members = (tar) => spawnSync('tar', ['-tf', tar], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();

test('the off-site backup streams every part of a set into the repository, made on first use, and keeps no copy here', (t) => {
  const m = machine(t);
  const done = m.offsite();
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /The off-site repository .* is made/);
  assert.match(done.said, /This machine is backed up to /);
  const calls = resticCalls(done);
  assert.ok(calls.some((c) => /(^| )init --repository-version 2$/.test(c)), 'the repository is made, format 2');

  // Each part a backup of its own, in a set's order, with the manifest last.
  const backups = calls.filter((c) => / backup /.test(c)).map((c) => c.match(/--stdin-filename (\S+)/)[1]);
  assert.deepEqual(backups, [
    'front-door/data.tar',
    'accounts/ann/data.tar', 'accounts/ann/env',
    'accounts/bob/data.tar', 'accounts/bob/env', 'accounts/bob/config.tar', 'accounts/bob/workspace.tar', 'accounts/bob/browser.tar',
    'accounts/bob/tailscale.tar', 'manifest.json',
  ]);
  for (const c of calls.filter((c) => / backup /.test(c))) {
    assert.match(c, /--stdin-from-command -- /, 'streamed, from the command that makes it');
    assert.match(c, /--host [0-9a-f]{8} /);
  }
  const tags = (part) => fs.readFileSync(path.join(m.parts, `${part}.tags`), 'utf8').trim();
  assert.match(tags('accounts/bob/workspace.tar'), /^instance=[0-9a-f]{8},part=workspace,account=bob,born=\d{8}T\d{6}Z$/);
  assert.match(tags('front-door/data.tar'), /^instance=[0-9a-f]{8},part=front-door$/);

  assert.ok(members(path.join(m.parts, 'front-door', 'data.tar')).includes('./audit.jsonl'));
  const ann = members(path.join(m.parts, 'accounts', 'ann', 'data.tar'));
  assert.ok(ann.includes('./bots.json'));
  assert.ok(ann.includes('./workspaces/b1/app/package.json'));
  for (const left of ['./backups', 'node_modules', '.part']) {
    assert.ok(!ann.some((f) => f === left || f.startsWith(`${left}/`) || (!left.startsWith('./') && f.includes(left))), `without ${left}`);
  }
  // bob's memory is the consistent copy its server made (#1015), in the live file's place, and the copy goes after.
  const bobTar = path.join(m.parts, 'accounts', 'bob', 'data.tar');
  const bob = members(bobTar);
  assert.equal(spawnSync('tar', ['-xOf', bobTar, './memory.db'], { encoding: 'utf8' }).stdout, 'a consistent copy');
  assert.ok(!bob.includes('./memory.db-wal') && !bob.includes('./memory.db-shm') && !bob.includes('./.snapshot/memory.db'), bob.join(' '));
  assert.ok(!fs.existsSync(path.join(m.home, 'data', '.snapshot', 'memory.db')));
  assert.equal(fs.readFileSync(path.join(m.parts, 'accounts', 'bob', 'env'), 'utf8'), fs.readFileSync(path.join(m.home, '.env'), 'utf8'));
  assert.ok(members(path.join(m.parts, 'accounts', 'bob', 'config.tar')).includes('./vault.key'));
  const browser = members(path.join(m.parts, 'accounts', 'bob', 'browser.tar'));
  assert.ok(browser.includes('./profiles/b1/cookies.sqlite'));
  assert.deepEqual(browser.filter((f) => /lock$/i.test(f)), [], 'without a profile\'s lock files');

  const manifest = JSON.parse(fs.readFileSync(path.join(m.parts, 'manifest.json'), 'utf8'));
  assert.equal(manifest.kind, 'botdot-offsite');
  assert.equal(manifest.version, 'abc1234');
  assert.equal(manifest.admin, 'ann');
  assert.deepEqual(manifest.accounts, ['ann', 'bob']);
  assert.deepEqual(Object.keys(manifest.snapshots), backups.slice(0, -1), 'each part\'s snapshot');

  // Kept 7 days, 4 weeks and 3 months; pruned on the first run.
  const forget = calls.find((c) => / forget /.test(c));
  assert.match(forget, /--host [0-9a-f]{8} --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune$/);

  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'done');
  assert.equal(said.instance, forget.match(/--host ([0-9a-f]{8})/)[1], 'the instance its snapshots carry, for a restore elsewhere');
  assert.equal(said.bytesAdded, 1000);
  assert.equal(said.lastSuccess, said.finished);
  assert.ok(said.started <= said.finished);
  assert.deepEqual(Object.keys(said.snapshots), backups);
  assert.match(said.snapshots['accounts/bob/data.tar'], /^[0-9a-f]{64}$/);
  assert.deepEqual(said.failed, []);
  assert.equal(said.error, undefined);

  // Its secrets are root's alone; nothing of the backup stays on the machine.
  assert.equal(fs.statSync(m.secrets).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(m.secrets, 'password')).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(path.join(m.secrets, 'password'), 'utf8'), /^[0-9a-f]{64}$/, 'a new password, made at random');
  assert.match(done.said, new RegExp(`A new password for the off-site repository is in ${m.secrets}/password: keep a copy off this machine`));
  assert.ok(done.system.includes(`restic-env ${m.store} ${m.secrets}/password ${m.secrets}/cache`), 'the password from its file, never on the command line');
  assert.deepEqual(fs.readdirSync(m.secrets).sort(), ['cache', 'check-next', 'check.json', 'checked', 'keep', 'password', 'pruned']);
  assert.ok(!fs.existsSync(path.join(m.dir, 'backup')), 'no set on the machine\'s disk');
  assert.match(fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8'), new RegExp(`^BOT_DOT_OFFSITE_REPO=${m.store}$`, 'm'), 'the repository is kept in .env');

  // The next night finds the repository, keeps the password and doesn't prune again within the week.
  const password = fs.readFileSync(path.join(m.secrets, 'password'), 'utf8');
  const next = m.offsite();
  assert.equal(next.status, 0, next.said);
  assert.ok(!resticCalls(next).some((c) => / init /.test(c)));
  assert.doesNotMatch(resticCalls(next).find((c) => / forget /.test(c)), /--prune/);
  assert.equal(fs.readFileSync(path.join(m.secrets, 'password'), 'utf8'), password);
  assert.doesNotMatch(next.said, /new password/);
});

test('a part that fails doesn\'t stop the others, and the status names it and keeps the last success', (t) => {
  const m = machine(t);
  const first = status(m.offsite(), 'offsite.json');
  fs.rmSync(path.join(m.dir, 'accounts', 'ann', 'data'), { recursive: true });
  const done = m.offsite({ given: { STAND_IN_RESTIC_FAIL: 'accounts/bob/workspace.tar' } });
  assert.equal(done.status, 0, done.said);
  const backups = resticCalls(done).filter((c) => / backup /.test(c)).map((c) => c.match(/--stdin-filename (\S+)/)[1]);
  assert.ok(backups.includes('accounts/bob/browser.tar') && backups.includes('manifest.json'), 'the parts after them are backed up');
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'failed');
  assert.deepEqual(said.failed, ['accounts/ann/data.tar', 'accounts/bob/workspace.tar']);
  assert.equal(said.part, 'accounts/ann/data.tar');
  assert.match(said.error, /^accounts\/ann\/data\.tar: .*(exit status 2|Cannot open)/);
  assert.equal(said.lastSuccess, first.lastSuccess, 'the last success is still the one before');
  assert.ok(said.snapshots['accounts/bob/browser.tar']);
  assert.match(done.said, /The off-site backup of accounts\/bob\/workspace.tar failed: Fatal: unable to save snapshot: no space left on device/);
  const manifest = JSON.parse(fs.readFileSync(path.join(m.parts, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.failed, said.failed);
});

test('a repository that can\'t be reached fails the run at its check, and says why', (t) => {
  const m = machine(t);
  const done = m.offsite({ given: { STAND_IN_RESTIC_UNREACHABLE: '1' } });
  assert.notEqual(done.status, 0);
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'failed');
  assert.equal(said.part, 'check');
  assert.match(said.error, /Couldn't open the off-site repository .*: Fatal: unable to open repository: ssh: Permission denied \(publickey\)/);
  assert.ok(!resticCalls(done).some((c) => / (init|backup) /.test(c)), 'nothing is made or written');
  const instance = fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8').match(/^BOT_DOT_INSTANCE=(.*)$/m)[1];
  assert.equal(said.instance, instance, 'a run that never opened the repository names the instance too');
});

test('a Storage Box over SFTP gets a key of this machine\'s own, which restic signs in with, never asking', (t) => {
  const m = machine(t, { repo: 'sftp://u1-sub1@u1-sub1.your-storagebox.de:23/botdot' });
  const keygen = '#!/bin/sh\necho "ssh-keygen $*" >> "$STAND_IN_LOG"\nwhile [ "$1" != -f ]; do shift; done\necho key > "$2"; echo "ssh-ed25519 AAAA botdot" > "$2.pub"\n';
  const done = m.offsite({ bins: { 'ssh-keygen': keygen, ssh: '#!/bin/sh\nexit 0\n' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.system, /ssh-keygen -q -t ed25519 -N {2}-C botdot-[0-9a-f]{8} -f \S+\/offsite\/ssh_key/);
  assert.match(done.said, /ssh-ed25519 AAAA botdot/);
  assert.match(done.said, new RegExp(`cat ${m.secrets}/ssh_key.pub \\| ssh -p 23 u1-sub1@u1-sub1.your-storagebox.de install-ssh-key`));
  const call = resticCalls(done).find((c) => / backup /.test(c));
  assert.ok(call.startsWith(`-o sftp.args=-i ${m.secrets}/ssh_key -o IdentitiesOnly=yes -o UserKnownHostsFile=${m.secrets}/known_hosts -o StrictHostKeyChecking=accept-new -o BatchMode=yes`), call);
  assert.equal(fs.statSync(path.join(m.secrets, 'ssh_key')).mode & 0o777, 0o600);
  // Made once.
  const next = m.offsite({ bins: { 'ssh-keygen': keygen, ssh: '#!/bin/sh\nexit 0\n' } });
  assert.doesNotMatch(next.system, /ssh-keygen/);
});

test('restic is the pinned release, checked by its sha256: a download that doesn\'t match is refused', (t) => {
  const m = machine(t);
  const curl = '#!/bin/sh\necho "curl $*" >> "$STAND_IN_LOG"\nwhile [ "$1" != -o ]; do shift; done\necho "not restic" > "$2"\n';
  const done = m.offsite({ bins: { curl, restic: null } });
  assert.notEqual(done.status, 0);
  assert.match(done.system, /curl .*https:\/\/github\.com\/restic\/restic\/releases\/download\/v0\.19\.1\/restic_0\.19\.1_linux_amd64\.bz2/);
  assert.match(status(done, 'offsite.json').error, /Couldn't download restic 0\.19\.1 with its checksum \(its download did not match its sha256\), and this machine has no restic of 0\.17 or newer/);
  assert.ok(!fs.existsSync(path.join(m.dir, 'bin', 'restic')), 'nothing unchecked is kept');
  // An older restic of the machine's own isn't taken either.
  const old = m.offsite({ bins: { curl, restic: '#!/bin/sh\necho "restic 0.16.4 compiled with go1.22.2 on linux/amd64"\n' } });
  assert.match(status(old, 'offsite.json').error, /no restic of 0\.17 or newer/);
});
