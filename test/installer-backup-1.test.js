// install.sh on a stand-in machine (test/installer-helpers.js): a backup set of the whole machine and its restore,
// asked of root's step with the requests BACKUP and RESTORE (#986). The restore's own run through each account's
// Docker is in `make install-real`; here the stand-in Docker writes down what it was asked.
// Part 1 of 3 of the backup tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { status } = require('./installer-helpers');
const { sha256, machine } = require('./installer-backup-helpers');

const members = (tar) => spawnSync('tar', ['-tf', tar], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();

test('a backup set holds the front door\'s data and every account\'s data, .env, Vault key and computer volumes, with a checksum of each', (t) => {
  const m = machine(t);
  const done = m.step('BACKUP');
  assert.match(done.said, new RegExp(`The backup set is in ${m.set}`));

  const manifest = JSON.parse(fs.readFileSync(path.join(m.set, 'manifest.json'), 'utf8'));
  assert.equal(manifest.kind, 'botdot-backup-set');
  assert.equal(manifest.format, 1);
  assert.equal(manifest.version, status(done, 'version.json').version, 'the version the machine runs');
  assert.match(manifest.instance, /^[0-9a-f]{8}$/, 'the machine\'s instance id');
  assert.equal(done.env.BOT_DOT_INSTANCE ?? fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8').match(/^BOT_DOT_INSTANCE=(.*)$/m)[1], manifest.instance, 'kept in .env');
  assert.equal(manifest.admin, 'ann');
  assert.deepEqual(manifest.accounts, ['ann', 'bob']);
  assert.deepEqual(manifest.parts.map((p) => p.path).sort(), [
    'accounts/ann/data.tar', 'accounts/ann/env',
    'accounts/bob/browser.tar', 'accounts/bob/config.tar', 'accounts/bob/data.tar', 'accounts/bob/env', 'accounts/bob/tailscale.tar',
    'accounts/bob/workspace.tar', 'front-door/data.tar',
  ]);
  for (const part of manifest.parts) {
    assert.equal(part.sha256, sha256(path.join(m.set, part.path)), `${part.path}'s checksum`);
    assert.equal(part.bytes, fs.statSync(path.join(m.set, part.path)).size);
  }

  assert.ok(members(path.join(m.set, 'front-door', 'data.tar')).includes('./audit.jsonl'), 'the audit log');
  assert.ok(members(path.join(m.set, 'front-door', 'data.tar')).includes('./front-door.json'), 'accounts, passkeys and sign-up links');
  const annData = members(path.join(m.set, 'accounts', 'ann', 'data.tar'));
  assert.ok(annData.includes('./bots.json'));
  assert.ok(!annData.some((f) => f.startsWith('./backups')), 'without the account\'s own backups');
  assert.equal(fs.readFileSync(path.join(m.set, 'accounts', 'bob', 'env'), 'utf8'), fs.readFileSync(path.join(m.home, '.env'), 'utf8'));
  assert.ok(members(path.join(m.set, 'accounts', 'bob', 'config.tar')).includes('./vault.key'), 'the Vault key');
  assert.ok(members(path.join(m.set, 'accounts', 'bob', 'workspace.tar')).includes('./b1/notes.md'), 'a bot\'s file');
  const browser = members(path.join(m.set, 'accounts', 'bob', 'browser.tar'));
  assert.ok(browser.includes('./profiles/b1/cookies.sqlite'), 'the browser\'s logins');
  assert.deepEqual(browser.filter((f) => /lock$/i.test(f)), [], 'without a profile\'s lock files');
  assert.ok(members(path.join(m.set, 'accounts', 'bob', 'tailscale.tar')).includes('./tailscaled.state'), 'the computer\'s tailnet identity');

  // Root's alone.
  for (const f of ['', 'manifest.json', 'front-door', 'front-door/data.tar', 'accounts/bob', 'accounts/bob/env']) {
    const st = fs.statSync(path.join(m.set, f));
    assert.equal(st.mode & 0o777, st.isDirectory() ? 0o700 : 0o600, `${f || 'the set'} is root's alone`);
  }
  assert.deepEqual(fs.readdirSync(m.dir).filter((f) => f.startsWith('backup')), ['backup'], 'nothing is left beside it');
  assert.equal(status(done, 'backup.json').state, 'done');
});

test("an account's memory.db is the copy its server made for the set, not the live file and its WAL (#1015)", (t) => {
  const m = machine(t);
  const data = path.join(m.home, 'data');
  fs.writeFileSync(path.join(data, 'memory.db'), 'the live file');
  fs.writeFileSync(path.join(data, 'memory.db-wal'), 'its WAL');
  fs.mkdirSync(path.join(data, 'workspaces', 'b1'), { recursive: true });
  fs.writeFileSync(path.join(data, 'workspaces', 'b1', 'memory.db'), "a bot's own file of that name");
  const content = (tar, member) => spawnSync('tar', ['-xOf', tar, member], { encoding: 'utf8' }).stdout;
  const bobTar = path.join(m.set, 'accounts', 'bob', 'data.tar');

  m.step('BACKUP');
  let listed = members(bobTar);
  assert.equal(content(bobTar, './memory.db'), 'a consistent copy');
  assert.ok(!listed.includes('./memory.db-wal') && !listed.includes('./.snapshot/memory.db'), listed.join(' '));
  assert.equal(content(bobTar, './workspaces/b1/memory.db'), "a bot's own file of that name", 'only the top one is replaced');
  assert.ok(!fs.existsSync(path.join(data, '.snapshot', 'memory.db')), 'the copy goes once it is in the set');
  assert.equal(JSON.parse(fs.readFileSync(path.join(m.set, 'manifest.json'), 'utf8')).memory.bob, 'copy');

  // A server that doesn't run writes nothing: its file is copied as it is, and the manifest says so.
  fs.rmSync(path.join(m.dir, 'sockets', 'bob', 'botdot.sock'));
  m.step('BACKUP');
  listed = members(bobTar);
  assert.equal(content(bobTar, './memory.db'), 'the live file');
  assert.ok(listed.includes('./memory.db-wal'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(m.set, 'manifest.json'), 'utf8')).memory.bob, 'as-is');
});

test('a set whose owners are written as the account\'s Docker sees them, so the restore gives them to the same users', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  // The stand-in useradd gives bob the sub-IDs from 165536: the server's user, 60000 in bob's Docker, is 225535 here.
  const file = path.join(m.home, 'data', 'vault.json');
  fs.chownSync(file, 165536 + 59999, 165536 + 59999);
  m.step('BACKUP');
  const listed = spawnSync('tar', ['-tvf', path.join(m.set, 'accounts', 'bob', 'data.tar'), '--numeric-owner', './vault.json'], { encoding: 'utf8' }).stdout;
  assert.match(listed, /^-\S+ 60000\/60000 /, listed);
});

test('a set that fails midway leaves the last complete one in place, and its status names the failure', (t) => {
  const m = machine(t);
  m.step('BACKUP');
  const before = fs.readFileSync(path.join(m.set, 'manifest.json'), 'utf8');
  fs.rmSync(path.join(m.home, 'data'), { recursive: true });
  const done = m.step('BACKUP');
  assert.match(done.said, /The backup set wasn't made: Couldn't copy .*accounts\/bob\/data/);
  assert.equal(fs.readFileSync(path.join(m.set, 'manifest.json'), 'utf8'), before, 'the last set is as it was');
  assert.ok(!fs.existsSync(`${m.set}.new`), 'and nothing of the new one is left');
  const said = status(done, 'backup.json');
  assert.equal(said.state, 'failed');
  assert.equal(said.phase, 'account');
  assert.equal(said.account, 'bob');
  assert.match(said.error, /Couldn't copy/);
});

test('a request root didn\'t make is refused', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  const requests = path.join(m.dir, 'front-door', 'requests');
  for (const name of ['BACKUP', 'RESTORE']) {
    fs.writeFileSync(path.join(requests, name), '');
    fs.chownSync(path.join(requests, name), 990, 990);
  }
  const done = m.step('bob');
  assert.equal(status(done, 'backup.json').state, 'refused');
  assert.equal(status(done, 'restore.json').state, 'refused');
  assert.ok(!fs.existsSync(m.set), 'no set was made');
});
