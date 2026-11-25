// install.sh on a stand-in machine (test/installer-helpers.js): a backup set of the whole machine and its restore,
// asked of root's step with the requests BACKUP and RESTORE (#986). The restore's own run through each account's
// Docker is in `make install-real`; here the stand-in Docker writes down what it was asked.
// Part 2 of 3 of the backup tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { status, rerun, installer, extracts } = require('./installer-helpers');
const { machine } = require('./installer-backup-helpers');

test('a request of root\'s that has a second name is refused, as a hard link the front door made to it would be', (t) => {
  const m = machine(t);
  const requests = path.join(m.dir, 'front-door', 'requests');
  for (const name of ['BACKUP', 'RESTORE']) {
    const other = path.join(m.dir, `elsewhere-${name}`);
    fs.writeFileSync(other, '');
    fs.linkSync(other, path.join(requests, name));
  }
  const done = m.step('bob');
  assert.equal(status(done, 'backup.json').state, 'refused');
  assert.equal(status(done, 'restore.json').state, 'refused');
  assert.ok(!fs.existsSync(m.set), 'no set was made');
  assert.ok(fs.existsSync(path.join(m.dir, 'elsewhere-RESTORE')), 'only the name in requests is removed');
});

// The front door runs as its own user in the group of REQUESTS. Root's requests (written by the console's agent, 600)
// sit there beside the front door's own.
test('the requests folder is sticky after an install and an update, so the front door can rename or remove no request of root\'s', { skip: process.getuid?.() !== 0 && 'acting as the front door\'s user needs root' }, (t) => {
  const first = rerun(t);
  const requests = path.join(first.dir, 'front-door', 'requests');
  assert.equal(fs.statSync(requests).mode & 0o7777, 0o1770);
  fs.chmodSync(requests, 0o770);
  const again = installer(t, { again: first, dotenv: '', args: ['--update'] });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.equal(fs.statSync(requests).mode & 0o7777, 0o1770, 'an update sets it on a machine installed before');

  // As the front door's user (the stand-in chown changed nothing, so the folder is given its group here, as on a
  // machine), with the folders above it open to pass through.
  const [uid, gid] = again.env.FRONT_DOOR_USER.split(':').map(Number);
  fs.chownSync(requests, 0, gid);
  for (let d = path.dirname(requests); d.startsWith(first.top); d = path.dirname(d)) fs.chmodSync(d, fs.statSync(d).mode | 0o011);
  const asDoor = (...args) => spawnSync(args[0], args.slice(1), { uid, gid, encoding: 'utf8' });
  const at = (name) => path.join(requests, name);
  fs.writeFileSync(at('BACKUP'), '', { mode: 0o600 });
  fs.writeFileSync(at('.agent-UPDATE'), 'sha256:x\n', { mode: 0o600 });
  assert.equal(asDoor('sh', '-c', `printf 'mine' > '${at('ann')}'`).status, 0, 'the front door still asks for accounts');
  for (const [what, args] of [
    ['rename root\'s BACKUP to RESTORE', ['mv', at('BACKUP'), at('RESTORE')]],
    ['rename root\'s file before it is in place', ['mv', at('.agent-UPDATE'), at('RESTORE')]],
    ['put its own file over root\'s', ['mv', at('ann'), at('BACKUP')]],
    ['remove root\'s', ['rm', '-f', at('BACKUP')]],
  ]) {
    const r = asDoor(...args);
    assert.notEqual(r.status, 0, `the front door could ${what}`);
    assert.match(r.stderr, /Operation not permitted/, what);
  }
  assert.deepEqual(fs.readdirSync(requests).sort(), ['.agent-UPDATE', 'BACKUP', 'ann']);
  assert.equal(fs.statSync(at('BACKUP')).uid, 0);
  assert.equal(asDoor('rm', at('ann')).status, 0, 'its own it may remove');
  // Without the sticky bit the same rename goes through: what an install before this one left.
  fs.chmodSync(requests, 0o770);
  assert.equal(asDoor('mv', at('BACKUP'), at('RESTORE')).status, 0);
  assert.equal(fs.statSync(at('RESTORE')).uid, 0, 'still root\'s, so by owner alone it passed as root\'s');
});

// A set from this machine, then the machine as a fresh install finds it (extracts: test/installer-helpers.js).

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
