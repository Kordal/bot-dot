// install.sh on a stand-in machine (test/installer-helpers.js): new accounts from sign-up links, suspend, resume and
// delete from the admin page, shares of the machine, and the uninstaller.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, script, installer, rerun, withBob } = require('./installer-helpers');

// --- New accounts from sign-up links (#467) -----------------------------------------------------------

test('the front door asks for new accounts in a folder of its own, and root\'s step is a copy of the installer that systemd starts', (t) => {
  const done = rerun(t);
  const requests = `${done.dir}/front-door/requests`;
  assert.match(done.system, new RegExp(`^chown 0:990 ${requests}$`, 'm'), 'root owns it, the front door\'s group may write in it');
  assert.equal(fs.statSync(requests).mode & 0o777, 0o770);
  const compose = fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8');
  assert.match(compose, /^ {6}- \.\/requests:\/requests /m);
  assert.match(compose, /^ {6}FRONT_DOOR_REQUESTS: \/requests$/m);

  // Root's copy of the installer, which only root can change.
  const bin = `${done.dir}/bin`;
  assert.equal(fs.readFileSync(`${bin}/install.sh`, 'utf8'), script);
  assert.equal(fs.statSync(bin).mode & 0o777, 0o700);
  assert.equal(fs.statSync(`${bin}/install.sh`).mode & 0o777, 0o600);
  assert.match(done.system, new RegExp(`^chown 0:0 ${bin}$`, 'm'));

  const unit = (name) => fs.readFileSync(path.join(done.etc, 'systemd', 'system', name), 'utf8');
  assert.match(unit('botdot-accounts.path'), new RegExp(`^DirectoryNotEmpty=${requests}$`, 'm'));
  assert.match(unit('botdot-accounts.service'), /^Type=oneshot$/m);
  assert.match(unit('botdot-accounts.service'), new RegExp(`^ExecStart=/bin/sh ${bin}/install.sh --requested$`, 'm'), 'one fixed command, nothing from the front door on it');
  assert.doesNotMatch(unit('botdot-accounts.service'), /^User=/m, 'root');
  assert.match(unit('botdot-accounts.service'), new RegExp(`^Environment=BOT_DOT_DIR=${done.dir} BOT_DOT_RUN=${done.run} BOT_DOT_ETC=${done.etc}$`, 'm'), 'the folders this install has');
  assert.match(done.system, /^systemctl enable --now botdot-accounts\.path$/m);
  assert.match(done.said, /Make sign-up links for other people on the admin page: https:\/\/botdot\.example\.com\/admin/);
});

test('without systemd a loop started now takes the requests, and the installer says it won\'t come back by itself', async (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  // Started in the background: the stand-in writes it down a moment after the installer ends.
  const log = path.join(done.top, 'system.log');
  for (let i = 0; i < 50 && !/^nohup /m.test(fs.readFileSync(log, 'utf8')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(fs.readFileSync(log, 'utf8'), /^nohup sh -c i=0; while :; do \[ -z "\$\(ls -A '.+\/front-door\/requests' 2>\/dev\/null\)" \] \|\| BOT_DOT_DIR='.+' BOT_DOT_RUN='.+' BOT_DOT_ETC='.+' sh '.+\/bin\/install\.sh' --requested; \[ \$\(\(i % 20\)\) != 0 \] \|\| BOT_DOT_DIR='.+' BOT_DOT_RUN='.+' BOT_DOT_ETC='.+' sh '.+\/bin\/install\.sh' --load; i=\$\(\(i \+ 1\)\); sleep 3; done$/m, 'and every minute measures the load');
  assert.match(done.said, /This machine has no systemd, so the accounts sign-up links make are made by a loop started now, which doesn't start again after a restart\./);
});

test("root's step makes each account the front door made and asked for, as the install made the admin's, and nothing else", (t) => {
  const first = rerun(t);
  const requests = path.join(first.dir, 'front-door', 'requests');
  fs.writeFileSync(path.join(first.dir, 'front-door', 'data', 'front-door.json'), JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {} }));
  for (const name of ['bob', 'carl', 'ann', 'Bad Name', '.hidden', '..dots', 'dan\nab']) fs.writeFileSync(path.join(requests, name), '');
  fs.mkdirSync(path.join(requests, 'eve'));
  const before = { system: first.system.length, docker: first.docker.length };

  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.deepEqual(fs.readdirSync(requests), [], 'every request is taken');
  const system = done.system.slice(before.system);
  const docker = done.docker.slice(before.docker);

  // bob: made as the admin's account was.
  const home = `${done.dir}/accounts/bob`;
  assert.match(system, new RegExp(`^useradd --no-create-home --home-dir ${home} --shell /usr/sbin/nologin --comment botdot account bob botdot-bob$`, 'm'));
  assert.match(system, /^systemctl enable botdot-account@bob$/m);
  assert.match(system, new RegExp(`^setfacl -m g:botdot-door:x,m::x ${done.dir}/sockets/bob$`, 'm'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.config', 'docker', 'daemon.json'), 'utf8'))['default-runtime'], 'runsc');
  const env = done.accountEnv('bob');
  assert.equal(env.BOT_DOT_ACCOUNT, 'bob');
  assert.equal(env.DOCKER_SOCKET, `${done.run}/bob/docker.sock`);
  assert.equal(env.BOT_DOT_IMAGE, first.accountEnv('ann').BOT_DOT_IMAGE, 'the images the install pinned');
  assert.equal(env.BOT_DOT_COMPUTER_IMAGE, first.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE);
  assert.ok(docker.some((c) => c.host === `unix://${done.run}/bob/docker.sock` && c.call === `compose --project-directory ${home} up -d --remove-orphans`));
  assert.match(done.said, /Making the account bob, which a sign-up link made at the front door/);
  assert.match(done.said, /The account bob is running/);

  // Nothing else: no account the front door doesn't have, no name that isn't one, nothing made twice.
  assert.doesNotMatch(system, /useradd .*botdot-(carl|ann|dan|eve)/);
  assert.match(done.said, /Not an account's name, so nothing was done: danab/, 'a name of two lines is no name');
  assert.match(done.said, /The front door has no account carl, so nothing was done\./);
  assert.match(done.said, /Not an account's name, so nothing was done: BadName/);
  assert.match(done.said, /The account ann is made already/);
  assert.ok(!docker.some((c) => c.host === `unix://${done.run}/ann/docker.sock` && /^compose .* up/.test(c.call)), "ann's botdot server is left as it is");
  // And nothing of the machine: no package, no front door, no Caddy or Tailscale, no unit, no link.
  assert.doesNotMatch(system, /^(apt-get|apparmor_parser|tailscale|systemctl daemon-reload|useradd --system)/m);
  assert.ok(!docker.some((c) => c.host === 'machine' && /^compose --project-directory/.test(c.call)), JSON.stringify(docker));
  assert.doesNotMatch(done.said, /botdot installer|\/sign-up\//);
});

// --- Suspend, resume and delete from the admin page (#470) -------------------------------------------


test("root's step stops a suspended account's Docker, and with it all it runs, and keeps its data and user", (t) => {
  const { door, step, home, upIn, users } = withBob(t);
  fs.writeFileSync(path.join(home, 'data', 'bots.json'), '[]');
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  const done = step('bob');
  assert.match(done.system, /^systemctl disable --now botdot-account@bob$/m, "its Docker stops, and doesn't start with the machine");
  assert.ok(!upIn(done, 'bob'), 'nothing of it is started');
  assert.match(done.said, /The account bob is suspended: it is stopped, and its data kept/);
  assert.ok(fs.existsSync(path.join(home, 'data', 'bots.json')), 'its data stays');
  assert.match(fs.readFileSync(users, 'utf8'), /^botdot-bob:/m, 'its Linux user stays');
  assert.doesNotMatch(done.system, /^(userdel|useradd)/m);
});

test("root's step starts a resumed account again as it was, and leaves a running one as it is", (t) => {
  const { door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: {} } });
  const running = step('bob');
  assert.match(running.said, /The account bob is made already, and runs/);
  assert.ok(!upIn(running, 'bob'));

  fs.rmSync(started); // suspended: its Docker doesn't answer
  const done = step('bob');
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.match(done.system, /^systemctl enable botdot-account@bob$/m);
  assert.match(done.system, /^systemctl (re)?start botdot-account@bob$/m);
  assert.ok(upIn(done, 'bob'), 'its botdot server starts');
  assert.doesNotMatch(done.system, /^useradd/m, 'the same user, made once');
  assert.doesNotMatch(done.system, /\/accounts\/bob\/data$/m, 'the data folder its restarted server owns stays its');
  assert.match(done.said, /The account bob is running/);
});

test("root's step reads the front door again when it is done, so the admin's resume meanwhile isn't lost", (t) => {
  const { first, door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  // While bob's Docker stops, the admin resumes bob: the front door's data says so, and its request found this one.
  const data = path.join(first.dir, 'front-door', 'data', 'front-door.json');
  const resumed = JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} });
  const systemctl = ['#!/bin/sh', 'echo "systemctl $*" >> "$STAND_IN_LOG"', '[ "$1" = show ] && exit 0',
    `[ "$1" = disable ] && { rm -f "${started}"; printf '%s' '${resumed}' > "${data}"; }`,
    `case "$1" in start|restart) touch "${started}" ;; esac`, 'exit 0', ''].join('\n');
  const done = step('bob', { bins: { systemctl } });
  assert.match(done.said, /The account bob is suspended: it is stopped/);
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.ok(upIn(done, 'bob'), 'bob runs again');
});

test("root's step keeps a request made while it read the front door once more, and the next run takes it", (t) => {
  const { first, door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  const requests = path.join(first.dir, 'front-door', 'requests');
  const data = path.join(first.dir, 'front-door', 'data', 'front-door.json');
  const resumed = JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} });
  fs.writeFileSync(path.join(requests, 'bob'), '');
  // The front door's data is read once more after bob is stopped: while it is read (the file it reads is the one from
  // before), the admin resumes bob, and the front door asks again.
  const resumes = [
    `if [ "$1" = run ] && [ "$5" = node ] && [ "$7" = -e ] && [ ! -e "${requests}/bob" ] && [ ! -e "${first.top}/resumed" ]; then`,
    `  touch "${first.top}/resumed"; printf '%s' '${resumed}' > "${data}.new"; mv "${data}.new" "${data}"; touch "${requests}/bob"`,
    'fi',
  ];
  const suspended = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ["--requested"], dockerFirst: resumes });
  assert.equal(suspended.status, 0, `${suspended.said}\n${suspended.stderr}`);
  assert.match(suspended.said, /The account bob is suspended: it is stopped/);
  assert.ok(fs.existsSync(path.join(requests, 'bob')), 'the new request stays');
  fs.rmSync(started, { force: true });
  const done = step('bob');
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.ok(upIn(done, 'bob'), 'bob runs again');
});

test("root's step erases a deleted account: its Docker, data, socket folder, Linux user and sub-IDs", (t) => {
  const { first, door, step, home, users } = withBob(t);
  fs.mkdirSync(path.join(first.run, 'bob'), { recursive: true });
  door({ accounts: { ann: {} }, deleted: { bob: '2026-10-16T12:00:00.000Z' } });
  const done = step('bob');
  assert.match(done.system, /^systemctl disable --now botdot-account@bob$/m);
  assert.match(done.system, /^userdel botdot-bob$/m);
  assert.ok(fs.existsSync(path.join(first.dir, 'disks', 'bob.img')) === false, 'its disk is gone');
  assert.ok(fs.existsSync(path.join(first.dir, 'disks', 'ann.img')), "ann's stays");
  for (const gone of [home, path.join(first.dir, 'sockets', 'bob'), path.join(first.run, 'bob')]) assert.ok(!fs.existsSync(gone), `${gone} is gone`);
  for (const map of ['subuid', 'subgid']) {
    const ids = fs.readFileSync(path.join(first.etc, map), 'utf8');
    assert.doesNotMatch(ids, /^botdot-bob:/m, `${map} has nothing of bob`);
    assert.match(ids, /^botdot-ann:/m, "ann's stay");
  }
  assert.doesNotMatch(fs.readFileSync(users, 'utf8'), /^botdot-bob:/m);
  assert.match(done.said, /The account bob is erased: its data, containers and Linux user/);
  assert.ok(fs.existsSync(path.join(first.dir, 'accounts', 'ann', 'compose.yaml')), "ann's account is untouched");

  const again = step('bob');
  assert.match(again.said, /The account bob is deleted, and nothing of it is on this machine/);
  assert.doesNotMatch(again.system, /^userdel/m);
});

test("root's step erases nothing the front door doesn't say it deleted, and never the admin's account", (t) => {
  const { first, door, step, home } = withBob(t);
  for (const data of ['{"accounts": {"ann": {}, "bo', JSON.stringify({ accounts: { ann: {} } })]) {
    door(data);
    const done = step('bob');
    assert.match(done.said, /The front door has no account bob, so nothing was done\./);
    assert.doesNotMatch(done.system, /^(userdel|systemctl disable)/m);
    assert.ok(fs.existsSync(path.join(home, 'compose.yaml')));
  }
  door({ accounts: {}, deleted: { ann: '2026-10-16T12:00:00.000Z' } });
  const admin = step('ann');
  assert.match(admin.stderr, /The account ann is the admin's own, so it wasn't erased\./);
  assert.doesNotMatch(admin.system, /^(userdel|systemctl disable)/m);
  assert.ok(fs.existsSync(path.join(first.dir, 'accounts', 'ann', 'compose.yaml')));
});

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
  assert.match(done.system, /^systemctl set-property botdot-account@ann\.service CPUQuota=200% MemoryHigh=4608M MemoryMax=5G$/m, 'hard limits, applied at once and kept');
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
  for (const kb of [4_000_000, 8_000_000, 16_300_000, 65_800_000, 131_000_000]) {
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
  assert.match(own.system, /^systemctl set-property botdot-account@bob\.service CPUQuota=100% MemoryHigh=2764M MemoryMax=3G$/m);
  assert.equal(fs.readFileSync(path.join(first.dir, 'accounts', 'bob', 'share', 'share.json'), 'utf8'), '{"cpu":1,"ram":3}\n');
  assert.match(own.system, new RegExp(`^truncate -s 40G ${first.dir}/disks/bob\\.img$`, 'm'), 'a bigger disk grows at once');
  assert.match(own.system, /^losetup -c \/dev\/loop7$/m);
  assert.match(own.system, /^resize2fs \/dev\/loop7$/m);
  assert.match(own.said, /The account bob is made already, and runs, with its share: 1 CPUs, 3 GB of RAM, 40 GB of disk$/m);
  assert.doesNotMatch(own.said, /at once/);

  door({ share: { cpu: 3, ram: 6, disk: 20 }, accounts: { ann: {}, bob: {} } });
  const byDefault = step('bob');
  assert.match(byDefault.system, /^systemctl set-property botdot-account@bob\.service CPUQuota=300% MemoryHigh=5529M MemoryMax=6G$/m, 'the default the admin set');
  assert.equal(fs.readFileSync(path.join(first.dir, 'accounts', 'bob', 'share', 'share.json'), 'utf8'), '{"cpu":3,"ram":6}\n');
  assert.doesNotMatch(byDefault.system, /^(truncate|resize2fs)/m, 'a smaller disk is never shrunk');
});

test('without systemd the CPU and RAM share are said not to be applied', (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  assert.match(done.said, /This machine has no systemd, so the CPU and RAM share of the account ann aren't applied\./);
  assert.doesNotMatch(done.system, /set-property/);
  assert.equal(fs.readFileSync(path.join(done.dir, 'accounts', 'ann', 'share', 'share.json'), 'utf8'), '{"cpu":2,"ram":5}\n', 'its computer is sized all the same');
});

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
  assert.match(system, /^systemctl disable --now botdot-accounts\.path botdot-load\.timer$/m, "root's step stops first");
  assert.ok(done.calls.includes(`compose --project-directory ${first.dir}/front-door down -v --remove-orphans`), JSON.stringify(done.calls));
  for (const name of ['ann', 'bob']) {
    assert.match(system, new RegExp(`^systemctl disable --now botdot-account@${name}$`, 'm'));
    assert.match(system, new RegExp(`^userdel botdot-${name}$`, 'm'));
    assert.match(done.said, new RegExp(`The account ${name} is erased: its data, containers and Linux user`));
  }
  assert.match(system, /^userdel botdot-door$/m);
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
  for (const gone of ['accounts', 'front-door', 'sockets', 'disks', 'bin']) assert.ok(!fs.existsSync(path.join(first.dir, gone)), `${gone} is gone`);
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
