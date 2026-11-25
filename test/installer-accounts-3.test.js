// install.sh on a stand-in machine (test/installer-helpers.js): new accounts from sign-up links, suspend, resume and
// delete from the admin page, shares of the machine, and the uninstaller.
// Part 3 of 4 of the accounts and uninstaller tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, script, installer, rerun, withBob } = require('./installer-helpers');

test('an update leaves a suspended account stopped, and erases one the admin deleted', (t) => {
  const { first, door, upIn } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  const update = installer(t, { again: first });
  assert.equal(update.status, 0, `${update.said}\n${update.stderr}`);
  assert.match(update.said, /The account bob is suspended, so it stays stopped/);
  const since = { docker: update.docker.slice(before) };
  assert.ok(upIn(since, 'ann'), "ann's account is updated");
  assert.ok(!upIn(since, 'bob'), "bob's isn't started");

  door({ accounts: { ann: {} }, deleted: { bob: '2026-10-16T12:00:00.000Z' } });
  const later = installer(t, { again: first });
  assert.equal(later.status, 0, `${later.said}\n${later.stderr}`);
  assert.match(later.said, /The account bob is erased/);
  assert.ok(!fs.existsSync(path.join(first.dir, 'accounts', 'bob')));
});

// --- Shares of the machine (#471) -------------------------------------------------------------------

test('each account gets its share: CPU and RAM on its unit and, for its computer, in a file only root writes, and its disk', (t) => {
  const done = rerun(t);
  const home = `${done.dir}/accounts/ann`;
  // The default share (DEFAULT_SHARE, as the front door's): 2 CPUs, 5 GB of RAM (no RAM measured here), 30 GB of disk.
  assert.match(done.system, /^systemctl set-property botdot-account@ann\.service CPUQuota=200% MemoryHigh=infinity MemoryMax=5G$/m, 'hard limits, applied at once and kept');
  assert.equal(fs.readFileSync(path.join(home, 'share', 'share.json'), 'utf8'), '{"cpu":2,"ram":5}\n');
  assert.match(done.system, new RegExp(`^chown 0:0 ${home}/share$`, 'm'), 'root writes it, not the account');
  assert.equal(fs.statSync(path.join(home, 'share', 'share.json')).mode & 0o777, 0o644);
  assert.match(done.system, new RegExp(`^truncate -s 30G ${done.dir}/disks/ann\\.img\\.new$`, 'm'));
  assert.match(done.system, new RegExp(`^mkfs\\.ext4 -q -F -m 0 ${done.dir}/disks/ann\\.img\\.new$`, 'm'));
  assert.match(done.system, new RegExp(`^mount -o loop ${done.dir}/disks/ann\\.img ${home}$`, 'm'));
  assert.equal(fs.statSync(path.join(done.dir, 'disks')).mode & 0o777, 0o700, "only root reaches the accounts' disks");
  // The account's docker-helper reads the file, read-only, and nothing else of the account does.
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  assert.match(compose, /^ {6}- \.\/share:\/run\/botdot-share:ro$/m);
  assert.match(compose, /^ {6}BOT_DOT_SHARE_FILE: \/run\/botdot-share\/share\.json$/m);
  assert.equal(compose.match(/botdot-share/g).length, 2, 'only the helper has it');

  // A rerun keeps its disk as it is: it makes none and mounts none again.
  const again = rerun(t, '', {}, { again: done, dotenv: null });
  const since = again.system.slice(done.system.length);
  assert.doesNotMatch(since, /^(truncate|mkfs\.ext4|mount -o loop|resize2fs)/m);
});

test("the share in the installer is the front door's default", () => {
  const { DEFAULT_SHARE } = require('../lib/front-door/store');
  assert.match(script, new RegExp(`^DEFAULT_SHARE="${DEFAULT_SHARE.cpu} \\$\\{DEFAULT_RAM:-${DEFAULT_SHARE.ram}\\} ${DEFAULT_SHARE.disk}"$`, 'm'));
  // Its RAM from the machine's (#126), by the front door's rule.
  const awk = script.match(/^DEFAULT_RAM="\$\(awk '([^']+)'/m)[1];
  const { defaultRam } = require('../lib/front-door/store');
  for (const kb of [1_000_000, 2_044_723, 4_000_000, 6_000_000, 7_000_000, 8_000_000, 16_300_000, 65_800_000, 131_000_000]) {
    const out = require('child_process').execFileSync('awk', [awk], { input: `MemTotal:       ${kb} kB\n` }).toString().trim();
    assert.equal(Number(out), defaultRam(kb * 1024), `${kb} kB`);
  }
  assert.doesNotMatch(script, /computers at once|COMPUTERS/, 'a share has no computers at once (#108)');
  // The admin page's use counts the account's one computer, not the bots' old ones.
  assert.match(script, /docker ps -q --filter label=botdot\.computer=account --filter status=running/);
});

test("root's step gives an account the share the front door names, its own or the default, and grows its disk", (t) => {
  const { first, door, step } = withBob(t);
  // A share the front door kept before #108 still has its computers at once: it is read without them.
  door({ accounts: { ann: {}, bob: { share: { cpu: 1, ram: 3, computers: 1, disk: 40 } } } });
  const own = step('bob');
  assert.match(own.system, /^systemctl set-property botdot-account@bob\.service CPUQuota=100% MemoryHigh=infinity MemoryMax=3G$/m);
  assert.equal(fs.readFileSync(path.join(first.dir, 'accounts', 'bob', 'share', 'share.json'), 'utf8'), '{"cpu":1,"ram":3}\n');
  assert.match(own.system, new RegExp(`^truncate -s 40G ${first.dir}/disks/bob\\.img$`, 'm'), 'a bigger disk grows at once');
  assert.match(own.system, /^losetup -c \/dev\/loop7$/m);
  assert.match(own.system, /^resize2fs \/dev\/loop7$/m);
  assert.match(own.said, /The account bob is made already, and runs, with its share: 1 CPUs, 3 GB of RAM, 40 GB of disk$/m);
  assert.doesNotMatch(own.said, /at once/);

  door({ share: { cpu: 3, ram: 6, disk: 20 }, accounts: { ann: {}, bob: {} } });
  const byDefault = step('bob');
  assert.match(byDefault.system, /^systemctl set-property botdot-account@bob\.service CPUQuota=300% MemoryHigh=infinity MemoryMax=6G$/m, 'the default the admin set');
  assert.equal(fs.readFileSync(path.join(first.dir, 'accounts', 'bob', 'share', 'share.json'), 'utf8'), '{"cpu":3,"ram":6}\n');
  assert.doesNotMatch(byDefault.system, /^(truncate|resize2fs)/m, 'a smaller disk is never shrunk');
});

test('without systemd the CPU and RAM share are said not to be applied', (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  assert.match(done.said, /This machine has no systemd, so the CPU and RAM share of the account ann aren't applied\./);
  assert.doesNotMatch(done.system, /set-property/);
  assert.equal(fs.readFileSync(path.join(done.dir, 'accounts', 'ann', 'share', 'share.json'), 'utf8'), '{"cpu":2,"ram":5}\n', 'its computer is sized all the same');
});
