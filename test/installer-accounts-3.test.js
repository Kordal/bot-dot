// install.sh on a stand-in machine (test/installer-helpers.js): new accounts from sign-up links, suspend, resume and
// delete from the admin page, shares of the machine, and the uninstaller.
// Part 3 of 3 of the accounts and uninstaller tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, script, installer, rerun, withBob } = require('./installer-helpers');

// --- Uninstall (#76) -------------------------------------------------------------------------------

// install.sh --uninstall, run from the source on the machine `first` installed, answering `input`.
const uninstall = (t, first, options = {}) => installer(t, { again: first, dotenv: '', args: ['--uninstall'], ...options });

// The AppArmor profile the installer writes on Ubuntu 24.04, where rootless Docker needs one.
const PROFILE = '# botdot (install.sh): rootless Docker for each account needs user namespaces.\nabi <abi/4.0>,\ninclude <tunables/global>\n\nprofile botdot-rootlesskit /usr/bin/rootlesskit flags=(unconfined) {\n  userns,\n}\n';

// A userdel on the machine `first` that removes every user but `refused`, which a process still uses.
const refusingUserdel = (first, refused) => ['#!/bin/sh', 'echo "userdel $*" >> "$STAND_IN_LOG"',
  `[ "$1" = ${refused} ] && { echo "userdel: user ${refused} is currently used by process 42" >&2; exit 8; }`,
  `grep -v "^$1:" "${path.join(first.top, 'users')}" > "${first.top}/users.new"; mv "${first.top}/users.new" "${path.join(first.top, 'users')}"`, 'exit 0', ''].join('\n');

const UNITS = ['botdot-account@.service', 'botdot-accounts.path', 'botdot-accounts.service', 'botdot-load.timer', 'botdot-load.service'];

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

test('the uninstaller lists what it removes, and removes nothing without a typed yes', (t) => {
  const { first, home } = withBob(t);
  fs.writeFileSync(path.join(first.etc, 'apparmor.d', 'botdot-rootlesskit'), PROFILE);
  // ann's share on her unit, as systemctl set-property keeps it.
  fs.mkdirSync(path.join(first.etc, 'systemd', 'system.control', 'botdot-account@ann.service.d'), { recursive: true });
  const before = first.system.length;
  for (const input of ['y\n', '']) {
    const done = uninstall(t, first, { input });
    assert.equal(done.status, 1, `${done.said}\n${done.stderr}`);
    assert.match(done.said, /botdot uninstaller/);
    assert.ok(done.said.includes([
      'This removes botdot from this machine for good:',
      "  - the front door: its containers and volumes in this machine's Docker, and its Linux user botdot-door",
      "  - the shared embedding server's Linux user botdot-embed",
      "  - the account ann: its botdot server, its bots' computers, its rootless Docker, its Linux user botdot-ann, its disk and its data",
      "  - the account bob: its botdot server, its bots' computers, its rootless Docker, its Linux user botdot-bob, its disk and its data",
      `  - botdot's systemd units: ${UNITS.join(', ')}, and the accounts' shares`,
      '  - the AppArmor profile botdot-rootlesskit',
      `  - ${first.dir}: every account's bots, chats, memory, vault and backups, and the passkeys`,
      'Docker and Tailscale stay. This can\'t be undone.', '',
      'Type yes to remove all of it: ',
    ].join('\n')), done.said);
    assert.match(done.stderr, /Nothing was removed\./);
    assert.doesNotMatch(done.system.slice(before), /^(userdel|systemctl disable|apparmor_parser -R|umount|apt-get)/m);
    assert.ok(!done.calls.some((c) => / down /.test(c)), 'the front door runs on');
    assert.ok(fs.existsSync(path.join(home, 'compose.yaml')) && fs.existsSync(path.join(first.dir, 'front-door', '.env')));
  }
});

test('a typed yes removes the front door, every account, root\'s step, the AppArmor profile and botdot\'s folder', (t) => {
  const { first } = withBob(t);
  const profile = path.join(first.etc, 'apparmor.d', 'botdot-rootlesskit');
  fs.writeFileSync(profile, PROFILE);
  fs.writeFileSync(path.join(first.etc, 'apparmor.d', 'usr.bin.man'), '# not botdot\'s');
  const before = first.system.length;
  const done = uninstall(t, first, { input: 'yes\nn\n', given: { STAND_IN_PACKAGES: 'runsc' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const system = done.system.slice(before);
  assert.match(system, /^systemctl disable --now botdot-accounts\.path botdot-load\.timer botdot-offsite\.timer$/m, "root's step stops first");
  assert.ok(done.calls.includes(`compose --project-directory ${first.dir}/front-door down -v --remove-orphans`), JSON.stringify(done.calls));
  for (const name of ['ann', 'bob']) {
    assert.match(system, new RegExp(`^systemctl disable --now botdot-account@${name}$`, 'm'));
    assert.match(system, new RegExp(`^userdel botdot-${name}$`, 'm'));
    assert.match(done.said, new RegExp(`The account ${name} is erased: its data, containers and Linux user`));
  }
  assert.match(system, /^userdel botdot-door$/m);
  assert.match(system, /^userdel botdot-embed$/m);
  assert.match(system, new RegExp(`^apparmor_parser -R ${profile}$`, 'm'));
  assert.ok(!fs.existsSync(profile));
  assert.ok(fs.existsSync(path.join(first.etc, 'apparmor.d', 'usr.bin.man')), 'another profile stays');
  for (const unit of UNITS) assert.ok(!fs.existsSync(path.join(first.etc, 'systemd', 'system', unit)), `${unit} is gone`);
  assert.ok(!fs.existsSync(first.dir), `${first.dir} is gone`);
  assert.ok(!fs.existsSync(first.run), `${first.run} is gone`);
  for (const map of ['subuid', 'subgid']) assert.equal(fs.readFileSync(path.join(first.etc, map), 'utf8'), 'ubuntu:100000:65536\n', `${map} keeps the others' IDs`);
  assert.equal(fs.readFileSync(path.join(first.etc, 'passwd'), 'utf8'), 'root:x:0:0:root:/root:/bin/bash\n');
  assert.match(done.said, /Remove them too\? Docker itself and Tailscale stay\. \[y\/N\]/);
  assert.doesNotMatch(system, /^apt-get/m, 'the packages stay when the answer is no');
  assert.doesNotMatch(system, /^tailscale serve .*off/m, 'a public install has no Serve setting');
  assert.match(done.said, /botdot is removed from this machine\. Docker and Tailscale stay\./);
});

test('BOT_DOT_YES=1 asks nothing, and keeps the packages', (t) => {
  const first = rerun(t);
  fs.mkdirSync(path.join(first.etc, 'apt', 'sources.list.d'), { recursive: true });
  fs.writeFileSync(path.join(first.etc, 'apt', 'sources.list.d', 'gvisor.list'), 'deb [arch=amd64 signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases release main\n');
  const before = first.system.length;
  const done = uninstall(t, first, { given: { BOT_DOT_YES: '1', STAND_IN_PACKAGES: 'runsc docker-ce-rootless-extras' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /Type yes|\[y\/N\]/);
  assert.match(done.said, /This removes botdot from this machine for good:/, 'it still says what it removes');
  assert.ok(done.said.includes(`The packages stay. Remove them yourself with: sudo apt-get remove runsc docker-ce-rootless-extras && sudo rm ${first.etc}/apt/sources.list.d/gvisor.list ${first.etc}/apt/keyrings/gvisor.gpg\n`), done.said);
  assert.match(done.system.slice(before), /^userdel botdot-ann$/m);
  assert.doesNotMatch(done.system.slice(before), /^apt-get/m);
  assert.ok(fs.existsSync(path.join(first.etc, 'apt', 'sources.list.d', 'gvisor.list')));
  assert.ok(!fs.existsSync(first.dir));
});

test('the packages go when asked, never Docker itself or Tailscale', (t) => {
  const first = rerun(t);
  for (const [folder, name] of [['sources.list.d', 'gvisor.list'], ['keyrings', 'gvisor.gpg'], ['sources.list.d', 'docker.list']]) {
    fs.mkdirSync(path.join(first.etc, 'apt', folder), { recursive: true });
    fs.writeFileSync(path.join(first.etc, 'apt', folder, name), '');
  }
  const before = first.system.length;
  const done = uninstall(t, first, { input: 'yes\ny\n', given: { STAND_IN_PACKAGES: 'docker-ce docker-ce-cli runsc docker-ce-rootless-extras tailscale uidmap' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /botdot's installer may have installed these: runsc, docker-ce-rootless-extras and gVisor's apt source\./);
  const system = done.system.slice(before);
  assert.match(system, /^apt-get -s remove runsc docker-ce-rootless-extras$/m, 'apt-get is asked first what else it would remove');
  assert.deepEqual(system.match(/^apt-get remove .*/gm), ['apt-get remove -y -qq runsc docker-ce-rootless-extras']);
  assert.ok(!fs.existsSync(path.join(first.etc, 'apt', 'sources.list.d', 'gvisor.list')));
  assert.ok(!fs.existsSync(path.join(first.etc, 'apt', 'keyrings', 'gvisor.gpg')));
  assert.ok(fs.existsSync(path.join(first.etc, 'apt', 'sources.list.d', 'docker.list')), "Docker's apt source stays");

  // apt-get would take Docker with them: nothing is removed, and the uninstaller says so.
  const other = rerun(t);
  const aptGet = ['#!/bin/sh', 'echo "apt-get $*" >> "$STAND_IN_LOG"', '[ "$1" = -s ] && { echo "Remv runsc [20261005.0]"; echo "Remv docker-ce [5:29.9.1-1]"; }', 'exit 0', ''].join('\n');
  const refused = uninstall(t, other, { input: 'yes\ny\n', bins: { 'apt-get': aptGet }, given: { STAND_IN_PACKAGES: 'runsc docker-ce' } });
  assert.equal(refused.status, 1, `${refused.said}\n${refused.stderr}`);
  assert.doesNotMatch(refused.system, /^apt-get remove/m);
  assert.match(refused.said, / {2}- the packages runsc: apt-get would remove docker-ce with them/);
});

test("a tailnet install's Serve setting for botdot goes, and Tailscale's others stay", (t) => {
  const serving = (to) => ['#!/bin/sh', 'echo "tailscale $*" >> "$STAND_IN_LOG"', `[ "$1" = serve ] && [ "$2" = status ] && { echo "https://vm.example.ts.net (tailnet only)"; echo "|-- / proxy http://127.0.0.1:${to}"; }`, 'exit 0', ''].join('\n');
  const first = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(first.status, 0, first.stderr);
  const other = uninstall(t, first, { given: { BOT_DOT_YES: '1' }, bins: { tailscale: serving(8080) } });
  assert.equal(other.status, 0, `${other.said}\n${other.stderr}`);
  assert.doesNotMatch(other.said, /Tailscale Serve's setting/);
  assert.doesNotMatch(other.system, /^tailscale serve --https=443 off$/m, 'Serve passes to something else: not botdot\'s');

  const again = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(again.status, 0, again.stderr);
  const before = again.system.length;
  const done = uninstall(t, again, { input: 'yes\n', bins: { tailscale: serving(4700) } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, / {2}- Tailscale Serve's setting for botdot\n/);
  assert.match(done.system.slice(before), /^tailscale serve --https=443 off$/m);
  assert.doesNotMatch(done.system.slice(before), /^tailscale (down|logout|up)/m);
});

test("the sandbox's address for interactive pages (#399): an update adds it and restarts Caddy once, and the uninstaller takes its Serve setting away", (t) => {
  const first = rerun(t);
  const caddy = (r) => r.calls.filter((c) => / restart caddy$/.test(c)).length;
  // An install made before #399: its Caddyfile has no port 8443.
  fs.writeFileSync(path.join(first.dir, 'front-door', 'Caddyfile'), '# botdot (install.sh): HTTPS for the front door on its public domain. Caddy fetches the certificate.\nbotdot.example.com {\n\treverse_proxy 127.0.0.1:4700\n}\n');
  const seen = first.calls.length;
  const updated = installer(t, { again: first, dotenv: '', args: ['--update'] });
  assert.equal(updated.status, 0, `${updated.said}\n${updated.stderr}`);
  assert.match(updated.read('front-door/Caddyfile'), /botdot\.example\.com:8443 \{\n\treverse_proxy 127\.0\.0\.1:4701\n\}/);
  assert.equal(updated.env.FRONT_DOOR_SITES_ORIGIN, 'https://botdot.example.com:8443');
  assert.equal(caddy({ calls: updated.calls.slice(seen) }), 1, 'Caddy reads its new file');
  const again = installer(t, { again: updated, dotenv: '', args: ['--update'] });
  assert.equal(caddy({ calls: again.calls.slice(updated.calls.length) }), 0, 'and an unchanged one restarts nothing');

  const serving = ['#!/bin/sh', 'echo "tailscale $*" >> "$STAND_IN_LOG"', '[ "$1" = serve ] && [ "$2" = status ] && { echo "https://vm.example.ts.net (tailnet only)"; echo "|-- / proxy http://127.0.0.1:4700"; echo "https://vm.example.ts.net:8443 (tailnet only)"; echo "|-- / proxy http://127.0.0.1:4701"; }', 'exit 0', ''].join('\n');
  const tailnet = installer(t, { dotenv: '', input: '2\nann\n' });
  const before = tailnet.system.length;
  const kept = installer(t, { again: tailnet, dotenv: '', args: ['--update'], bins: { tailscale: serving } });
  assert.doesNotMatch(kept.system.slice(before), /^tailscale serve --bg/m, 'Serve set up already: left as it is');
  const gone = uninstall(t, kept, { input: 'yes\n', bins: { tailscale: serving } });
  assert.equal(gone.status, 0, `${gone.said}\n${gone.stderr}`);
  assert.match(gone.system, /^tailscale serve --https=443 off$/m);
  assert.match(gone.system, /^tailscale serve --https=8443 off$/m);
});

test("the uninstaller never touches what isn't botdot's, and says what it couldn't remove", (t) => {
  const { first } = withBob(t);
  fs.appendFileSync(path.join(first.etc, 'passwd'), 'botdot-zed:x:1500:1500:not an account:/home/zed:/bin/sh\n');
  fs.writeFileSync(path.join(first.dir, 'notes.txt'), "the admin's");
  const before = first.system.length;
  const done = uninstall(t, first, { input: 'yes\n', bins: { userdel: refusingUserdel(first, 'botdot-door') } });
  assert.equal(done.status, 1, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /account zed/, "a user named botdot-… whose home isn't an account's is no account");
  assert.doesNotMatch(done.system.slice(before), /^userdel botdot-zed$/m);
  assert.match(done.system.slice(before), /^userdel botdot-bob$/m, 'the others go on');
  assert.ok(fs.existsSync(path.join(first.dir, 'notes.txt')), "a file botdot didn't make stays");
  for (const gone of ['accounts', 'front-door', 'sockets', 'embed', 'disks', 'bin']) assert.ok(!fs.existsSync(path.join(first.dir, gone)), `${gone} is gone`);
  assert.ok(done.said.includes([
    "These couldn't be removed:",
    '  - the Linux user botdot-door',
    `  - ${first.dir}, which holds files botdot didn't make: notes.txt`,
  ].join('\n')), done.said);
  assert.doesNotMatch(done.said, /botdot is removed from this machine/);
});

test("an account that couldn't be removed keeps botdot's folder, and a second run finishes", (t) => {
  const { first } = withBob(t);
  const done = uninstall(t, first, { input: 'yes\n', bins: { userdel: refusingUserdel(first, 'botdot-bob') } });
  assert.equal(done.status, 1, `${done.said}\n${done.stderr}`);
  assert.match(done.stderr, /Couldn't remove the Linux user botdot-bob\./);
  assert.ok(done.said.includes([
    "These couldn't be removed:",
    '  - the account bob (see above)',
    `  - ${first.dir}, as an account in it wasn't removed: run the uninstaller again`,
  ].join('\n')), done.said);
  assert.ok(fs.existsSync(first.dir));

  const again = uninstall(t, first, { input: 'yes\n' });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.match(again.said, /The account bob is erased/);
  assert.ok(!fs.existsSync(first.dir));
});

test('on a machine without botdot the uninstaller removes nothing', (t) => {
  const done = installer(t, { dotenv: '', args: ['--uninstall'], input: 'yes\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /Nothing of botdot is on this machine\./);
  assert.doesNotMatch(done.system, /^(userdel|systemctl disable|apt-get)/m);
});
