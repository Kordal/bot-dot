// install.sh on a stand-in machine (test/installer-helpers.js): a backup set of the whole machine and its restore,
// asked of root's step with the requests BACKUP and RESTORE (#986). The restore's own run through each account's
// Docker is in `make install-real`; here the stand-in Docker writes down what it was asked.
// Part 3 of 3 of the backup tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, extracts } = require('./installer-helpers');
const { sha256, machine } = require('./installer-backup-helpers');

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
