// install.sh on a stand-in machine (test/installer-helpers.js): a backup set of the whole machine and its restore,
// asked of root's step with the requests BACKUP and RESTORE (#986). The restore's own run through each account's
// Docker is in `make install-real`; here the stand-in Docker writes down what it was asked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withBob, status } = require('./installer-helpers');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const members = (tar) => spawnSync('tar', ['-tf', tar], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
const volume = (home, name) => path.join(home, '.local', 'share', 'docker', 'volumes', name, '_data');

// A machine with ann and bob, their data and bob's computer's volumes, as root's step finds them.
function machine(t) {
  const m = withBob(t);
  const { dir } = m.first;
  const ann = path.join(dir, 'accounts', 'ann');
  fs.mkdirSync(path.join(ann, 'data', 'backups'), { recursive: true });
  fs.writeFileSync(path.join(ann, 'data', 'bots.json'), '[{"id":"b1"}]');
  fs.writeFileSync(path.join(ann, 'data', 'backups', 'bot-dot-20261101-0300.bdb'), 'an account backup');
  fs.mkdirSync(path.join(m.home, 'data'), { recursive: true });
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), '[]');
  fs.mkdirSync(volume(m.home, 'bob_bot-dot-config'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'bob_bot-dot-config'), 'vault.key'), 'ab'.repeat(32));
  fs.mkdirSync(path.join(volume(m.home, 'botdot-bob.account.computer-workspace'), 'b1'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'botdot-bob.account.computer-workspace'), 'b1', 'notes.md'), 'a bot file');
  const profile = path.join(volume(m.home, 'botdot-bob.account.computer-browser'), 'profiles', 'b1');
  fs.mkdirSync(profile, { recursive: true });
  for (const f of ['cookies.sqlite', 'lock', '.parentlock', 'SingletonLock']) fs.writeFileSync(path.join(profile, f), f);
  fs.mkdirSync(volume(m.home, 'botdot-bob.account.computer-tailscale'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'botdot-bob.account.computer-tailscale'), 'tailscaled.state'), '{"_machinekey":"x"}');
  fs.writeFileSync(path.join(dir, 'front-door', 'data', 'audit.jsonl'), '{"what":"sign-in"}\n');
  m.door({ accounts: { ann: {}, bob: {} }, passkeys: { k1: { account: 'ann' } } });
  // The version the install wrote, as of an image with a source revision.
  fs.writeFileSync(path.join(dir, 'front-door', 'status', 'version.json'), '{"version":"abc1234","selfBuilt":false}\n');
  return { ...m, dir, set: path.join(dir, 'backup') };
}

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

// A set from this machine, then the machine as a fresh install finds it: the stand-in Docker writes into a bind folder
// what a restore's tar is given.
const extracts = [
  '[ "$1" = volume ] && [ "$2" = inspect ] && exit 1',
  'if [ "$1" = run ] && [ "$4" = --pull ]; then v=""; p=""; for a; do [ "$p" = -v ] && v="${a%%:*}"; p="$a"; done; case "$v" in /*) find "$v" -mindepth 1 -delete; tar -x -f - -C "$v" ;; *) cat > /dev/null ;; esac; exit 0; fi',
];

test('a restore puts the front door\'s data back first, then each account with its volumes, and starts them again', (t) => {
  const m = machine(t);
  m.step('BACKUP');
  const door = fs.readFileSync(path.join(m.dir, 'front-door', 'data', 'front-door.json'), 'utf8');
  // What a fresh install has: its own front door's data, and empty accounts.
  m.door({ accounts: { ann: {} } });
  fs.rmSync(path.join(m.dir, 'front-door', 'data', 'audit.jsonl'));
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), 'fresh');
  const done = m.step('RESTORE', { dockerFirst: extracts });
  assert.match(done.said, /The backup set is back on this machine/);
  assert.equal(status(done, 'restore.json').state, 'restored');
  assert.equal(fs.readFileSync(path.join(m.dir, 'front-door', 'data', 'front-door.json'), 'utf8'), door, 'the front door\'s data is the set\'s');
  assert.ok(fs.existsSync(path.join(m.dir, 'front-door', 'data', 'audit.jsonl')));
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), '[]', 'bob\'s data is the set\'s');

  const machineCalls = done.docker.filter((c) => c.host === 'machine').map((c) => c.call);
  const stopped = machineCalls.findIndex((c) => /^compose --project-directory \S+\/front-door stop$/.test(c));
  assert.ok(stopped >= 0, 'the front door stops while its data is put back');
  const bob = done.docker.filter((c) => c.host.endsWith('/bob/docker.sock')).map((c) => c.call);
  const down = bob.findIndex((c) => /^compose .* down$/.test(c));
  const puts = bob.map((c, i) => [c, i]).filter(([c]) => /^run --rm -i --pull never --network none --user 0:0 -v /.test(c));
  assert.deepEqual(puts.map(([c]) => c.match(/-v (\S+):\/v/)[1].replace(m.home, '~')), ['~/data', 'bob_bot-dot-config', 'botdot-bob.account.computer-workspace', 'botdot-bob.account.computer-browser', 'botdot-bob.account.computer-tailscale']);
  assert.ok(down >= 0 && puts.every(([, i]) => i > down), 'its server is stopped before its parts go back');
  const up = bob.map((c, i) => [c, i]).filter(([c]) => /^compose .* up -d/.test(c)).map(([, i]) => i);
  assert.ok(up.some((i) => i > puts.at(-1)[1]), 'and started again after');
  assert.ok(bob.includes('volume create --label botdot.volume=account --label botdot.instance=bob botdot-bob.account.computer-workspace'), 'a computer\'s volume is made for it');
});

test('a set made before the computer\'s Tailscale identity was in it still restores, without that volume (#1021)', (t) => {
  const m = machine(t);
  m.step('BACKUP');
  const manifest = path.join(m.set, 'manifest.json');
  const old = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  old.parts = old.parts.filter((p) => p.path !== 'accounts/bob/tailscale.tar');
  fs.writeFileSync(manifest, `${JSON.stringify(old)}\n`);
  fs.rmSync(path.join(m.set, 'accounts', 'bob', 'tailscale.tar'));
  m.door({ accounts: { ann: {} } });
  const done = m.step('RESTORE', { dockerFirst: extracts });
  assert.equal(status(done, 'restore.json').state, 'restored');
  const bob = done.docker.filter((c) => c.host.endsWith('/bob/docker.sock')).map((c) => c.call);
  assert.ok(!bob.some((c) => c.includes('computer-tailscale')), 'no Tailscale volume is made or emptied');
});

test('a set of another version, of another admin, or with a part whose checksum doesn\'t match is refused, and nothing changes', (t) => {
  const m = machine(t);
  m.step('BACKUP');
  const manifest = path.join(m.set, 'manifest.json');
  const good = fs.readFileSync(manifest, 'utf8');
  const doorData = path.join(m.dir, 'front-door', 'data', 'front-door.json');
  m.door({ accounts: { ann: {} } });
  const fresh = fs.readFileSync(doorData, 'utf8');
  const refused = (change, why) => {
    fs.writeFileSync(manifest, good);
    change();
    const done = m.step('RESTORE', { dockerFirst: extracts });
    const said = status(done, 'restore.json');
    assert.equal(said.state, 'refused', JSON.stringify(said));
    assert.match(said.error, why);
    assert.equal(said.phase, undefined);
    assert.equal(fs.readFileSync(doorData, 'utf8'), fresh, 'the front door\'s data is as it was');
    assert.ok(!done.docker.some((c) => /compose .* (stop|down)$/.test(c.call) || / -v \S+:\/v /.test(c.call)), 'nothing was stopped or written');
  };
  refused(() => fs.writeFileSync(manifest, good.replace(/"version":"[^"]*"/, '"version":"1234567"')), /The set is of version 1234567, and this machine runs abc1234: install version 1234567/);
  refused(() => fs.writeFileSync(manifest, good.replace('"admin":"ann"', '"admin":"zoe"')), /The set's admin is zoe, and this machine's is ann/);
  refused(() => fs.appendFileSync(path.join(m.set, 'accounts', 'bob', 'env'), 'X=1\n'), /doesn't match its checksum/);
  fs.writeFileSync(path.join(m.set, 'accounts', 'bob', 'env'), fs.readFileSync(path.join(m.home, '.env')));
  refused(() => fs.writeFileSync(manifest, good.replace('accounts/bob/env', '../../etc/passwd')), /a part that can't be one/);
  refused(() => fs.rmSync(manifest), /There is no backup set/);
});

test('an erased account leaves the backup set at once, and the set still names a checksum for each part it holds (#1019)', (t) => {
  const m = machine(t);
  m.step('BACKUP');
  m.door({ accounts: { ann: {} }, deleted: { bob: '2026-11-05T12:00:00.000Z' } });
  const done = m.step('bob');
  assert.match(done.said, /The account bob is out of the backup set/);
  assert.ok(!fs.existsSync(path.join(m.set, 'accounts', 'bob')));
  const manifest = JSON.parse(fs.readFileSync(path.join(m.set, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.accounts, ['ann']);
  assert.ok(!('bob' in manifest.memory));
  assert.ok(manifest.parts.length > 0 && manifest.parts.every((p) => !p.path.startsWith('accounts/bob/')));
  for (const p of manifest.parts) assert.equal(sha256(path.join(m.set, p.path)), p.sha256, p.path);
  assert.equal(manifest.kind, 'botdot-backup-set');
});
