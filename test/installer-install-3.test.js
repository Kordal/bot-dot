// install.sh on a stand-in machine (test/installer-helpers.js): a first install, botdot's signed images, and what
// the installer tells a stranger. The other installer tests are in installer-*.test.js, so that they run side by side.
// Part 3 of 6 of the install tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, script, SUB, installer, rerun } = require('./installer-helpers');

// The log limits every container's Docker gets (#980).
const LOGS = { 'log-driver': 'json-file', 'log-opts': { 'max-size': '20m', 'max-file': '5' } };

const logsOf = (daemon) => ({ 'log-driver': daemon['log-driver'], 'log-opts': daemon['log-opts'] });

const machineDaemon = (done) => path.join(done.etc, 'docker', 'daemon.json');

test("a local install on the Linux computer itself guards the account's user, never the computer's own traffic (ADR 170)", (t) => {
  const done = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_LOCAL_HOST: '1' }, systemd: true });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(done.env.BOT_DOT_LOCAL_HOST, '1', 'kept for the updates');
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'http://localhost:4700');
  assert.ok(!fs.existsSync(path.join(done.dir, 'bin', 'local-firewall.sh')), "no chain on all of OUTPUT: it would cut the owner's computer off its network");
  assert.doesNotMatch(done.system, /BOTDOT-LOCAL|local-firewall/);
  assert.doesNotMatch(done.said, /This VM can't reach/);
  assert.match(done.said, /botdot's computers can't reach this computer's network/);
  const uid = fs.readFileSync(path.join(done.top, 'users'), 'utf8').split('\n').find((l) => l.startsWith('botdot-owner:')).split(':')[1];
  assert.match(done.system, new RegExp(`^-A BOTDOT-EGRESS -m owner --uid-owner ${uid} -j BOTDOT-GUARD$`, 'm'), "the account's Linux user alone");
  assert.match(done.system, /^-A BOTDOT-GUARD -d 192\.168\.0\.0\/16 -j REJECT$/m, 'no home network');
  assert.ok(done.system.indexOf('iptables-restore -n') < done.system.search(/^systemctl (re)?start botdot-account@owner$/m), "before the account's Docker starts");
  assert.match(fs.readFileSync(path.join(done.etc, 'systemd', 'system', 'botdot-account@.service'), 'utf8'), /^Requires=botdot-egress\.service$/m);

  // An update keeps it, with no answer given.
  const dotenv = fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8');
  const again = installer(t, { dotenv, again: done });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.equal(again.env.BOT_DOT_LOCAL_HOST, '1');
  assert.doesNotMatch(again.system, /BOTDOT-LOCAL/);

  // Chosen with local at the first install alone.
  const server = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com', BOT_DOT_ADMIN: 'ann', BOT_DOT_LOCAL_HOST: '1' } });
  assert.equal(server.status, 1);
  assert.match(server.stderr, /BOT_DOT_LOCAL_HOST goes with BOT_DOT_REACH=local alone\./);
  const vm = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' } });
  const later = installer(t, { dotenv: fs.readFileSync(path.join(vm.dir, 'front-door', '.env'), 'utf8'), again: vm, given: { BOT_DOT_LOCAL_HOST: '1' } });
  assert.equal(later.status, 1);
  assert.match(later.stderr, /This botdot runs in a VM of its own, and that is chosen at its first install/);
  const odd = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_LOCAL_HOST: 'yes' } });
  assert.equal(odd.status, 1);
  assert.match(odd.stderr, /BOT_DOT_LOCAL_HOST is 1, or nothing/);
});

test('the question offers a public domain and a tailnet only: local is never an answer to it (#882)', (t) => {
  const done = installer(t, { dotenv: '', input: 'local\n3\n' });
  assert.equal(done.status, 1);
  assert.equal(done.said.match(/How will people reach botdot\?/g).length, 3, '"local" and "3" are asked again');
  assert.doesNotMatch(done.said, /3\)|local/);
  assert.equal(done.env.BOT_DOT_REACH, undefined);
});

test('the front door takes the one account and its setup key from .env', () => {
  const door = fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8');
  assert.match(door, /FRONT_DOOR_ONE_ACCOUNT: \$\{FRONT_DOOR_ONE_ACCOUNT:-\}/);
  assert.match(door, /FRONT_DOOR_SETUP_KEY: \$\{FRONT_DOOR_SETUP_KEY:-\}/);
});

test('the front door runs as its own user, with the accounts\' socket folders and its data', (t) => {
  const done = rerun(t);
  assert.match(done.system, /^useradd --system --user-group --no-create-home --home-dir \/nonexistent --shell \/usr\/sbin\/nologin botdot-door$/m);
  assert.equal(done.env.FRONT_DOOR_USER, '990:990');
  assert.equal(done.env.BOT_DOT_SOCKETS, `${done.dir}/sockets`);
  assert.equal(done.env.COMPOSE_PROJECT_NAME, 'botdot');
  assert.match(done.system, new RegExp(`^chown 990:990 ${done.dir}/front-door/data$`, 'm'));
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', 'data')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', '.env')).mode & 0o777, 0o600);
  assert.equal(done.env.FRONT_DOOR_ANDROID_KEYS, undefined, 'no Android app signs in until its keys are given');

  const keys = `${'AB:'.repeat(31)}AB`;
  const android = rerun(t, '', { FRONT_DOOR_ANDROID_KEYS: keys });
  assert.equal(android.env.FRONT_DOOR_ANDROID_KEYS, keys, 'the Android app\'s signing keys are kept for the front door');
  // An update from the admin page is given no keys: it keeps the ones given before (#82).
  const update = rerun(t, `FRONT_DOOR_ANDROID_KEYS=${keys}\n`, {}, { args: ['--update'] });
  assert.equal(update.env.FRONT_DOOR_ANDROID_KEYS, keys, 'an update keeps them');
  assert.match(fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8'), /FRONT_DOOR_ANDROID_KEYS: \$\{FRONT_DOOR_ANDROID_KEYS:-\}/);
});

test("the admin's account gets its own Linux user, rootless Docker under gVisor, and botdot server", (t) => {
  const done = rerun(t);
  const home = `${done.dir}/accounts/ann`;
  assert.match(done.system, new RegExp(`^useradd --no-create-home --home-dir ${home} --shell /usr/sbin/nologin --comment botdot account ann botdot-ann$`, 'm'));
  assert.match(done.system, new RegExp(`^chown 1002:1002 ${home}$`, 'm'), 'its home, its disk, is its own');
  assert.ok(done.system.indexOf(`mount -o loop ${done.dir}/disks/ann.img ${home}`) < done.system.indexOf('useradd --no-create-home'), 'its disk is its home before anything is in it');
  const daemon = JSON.parse(fs.readFileSync(path.join(home, '.config', 'docker', 'daemon.json'), 'utf8'));
  assert.equal(daemon['default-runtime'], 'runsc');
  assert.deepEqual(daemon.runtimes.runsc.runtimeArgs, ['--ignore-cgroups', '--net-raw', '--overlay2=none'],
    'the spike\'s flags (ADR 028), and a computer\'s files are written to its disk, so they outlive a stop (#68): no host sockets for a bot\'s computer (#72)');
  assert.deepEqual(daemon.runtimes['runsc-uds'], { path: daemon.runtimes.runsc.path, runtimeArgs: ['--ignore-cgroups', '--net-raw', '--overlay2=none', '--host-uds=all'] },
    'the server and the helper meet through Unix sockets in their mounts');
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  for (const service of ['bot-dot', 'docker-helper']) {
    assert.match(compose, new RegExp(`\\n  ${service}:\\n(    .*\\n)*?    runtime: runsc-uds\\b`), service);
  }
  assert.deepEqual(daemon['exec-opts'], ['native.cgroupdriver=cgroupfs']);
  // gVisor through root's script beside the share, which sizes each sandbox by it (ADR 152).
  assert.equal(daemon.runtimes.runsc.path, `${home}/share/runsc`);
  const runsc = path.join(home, 'share', 'runsc');
  assert.equal(fs.statSync(runsc).mode & 0o777, 0o755);
  assert.match(fs.readFileSync(runsc, 'utf8'), /^RUNSC='\/\S+\/runsc'$/m, 'the machine\'s runsc');
  assert.match(done.system, new RegExp(`^chown 0:0 ${home}/share$`, 'm'), 'root\'s');

  // Started by systemd as the account's own user.
  const unit = fs.readFileSync(path.join(done.etc, 'systemd', 'system', 'botdot-account@.service'), 'utf8');
  assert.match(unit, /^User=botdot-%i$/m);
  assert.match(unit, new RegExp(`^Environment=XDG_RUNTIME_DIR=${done.run}/%i$`, 'm'));
  assert.match(unit, /^ExecStart=.*\/dockerd-rootless\.sh$/m);
  assert.match(unit, /^Delegate=yes$/m);
  assert.match(unit, new RegExp(`^ExecStartPre=\\+/bin/sh -c '\\[ ! -f ${done.dir}/disks/%i\\.img \\] \\|\\| mountpoint -q ${done.dir}/accounts/%i \\|\\| mount -o loop ${done.dir}/disks/%i\\.img ${done.dir}/accounts/%i'$`, 'm'), 'it starts only on its disk, mounted by root');
  assert.match(done.system, /^systemctl enable botdot-account@ann$/m);
  assert.match(done.system, /^systemctl restart botdot-account@ann$/m, 'its Docker settings are new');

  // Its socket folder: botdot's server user of its containers owns it, the front door may only pass through.
  const folder = `${done.dir}/sockets/ann`;
  assert.match(done.system, new RegExp(`^chown ${SUB + 59999}:${SUB + 59999} ${folder}$`, 'm'));
  assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
  assert.match(done.system, new RegExp(`^setfacl -m g:botdot-door:x,m::x ${folder}$`, 'm'));

  // Its botdot server, in its own Docker.
  assert.equal(done.read('accounts/ann/compose.yaml').trim(), fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8').trim());
  const env = done.accountEnv('ann');
  assert.equal(env.BOT_DOT_ACCOUNT, 'ann');
  assert.equal(env.BOT_DOT_FRONT_DOOR_FOLDER, folder);
  assert.equal(env.DOCKER_SOCKET, `${done.run}/ann/docker.sock`);
  assert.equal(env.TZ, 'UTC');
  assert.match(env.BOT_DOT_INSTANCE, /^[0-9a-f]{8}$/, "the machine's own id, in its boat.dev machines' names (#982)");
  assert.ok(done.accountCalls('ann').includes(`compose --project-directory ${home} up -d --remove-orphans`));
  assert.ok(!done.calls.some((c) => /^compose --project-directory .*accounts/.test(c)), 'never in the machine\'s Docker');
  assert.match(done.said, /The account ann is running/);
});

test("an account's Docker without a runtime the compose file names stops the installer before the server starts", (t) => {
  const done = installer(t, { runtimes: '' });
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /The account ann's Docker has no runsc-uds runtime, which this version's compose file needs\. Restart it \(systemctl restart botdot-account@ann\) and run this again\./);
  assert.ok(!done.accountCalls('ann').some((c) => / up\b/.test(c)), done.accountCalls('ann').join('\n'));
});

test('a rerun keeps its Docker running when nothing of its settings changed', (t) => {
  const first = rerun(t);
  const again = installer(t, { again: first });
  assert.equal(again.status, 0, again.stderr);
  const after = again.system.slice(first.system.length);
  assert.equal(again.accountEnv('ann').BOT_DOT_INSTANCE, first.accountEnv('ann').BOT_DOT_INSTANCE, "the machine's id is made once and kept");
  assert.match(after, /^systemctl start botdot-account@ann$/m);
  assert.doesNotMatch(after, /^systemctl restart/m, 'its bots keep running');
  assert.doesNotMatch(after, /^useradd .*botdot-ann$/m, 'its user is there already');
  assert.match(first.system, /^chown \d+:\d+ \S+\/accounts\/ann\/data$/m, 'its data folder is the account\'s when it is made');
  assert.doesNotMatch(after, /\/accounts\/ann\/data$/m, 'and then the server\'s: its running server keeps writing it');
});

test('an installer older than the image stops before it changes an account, and says to take the newer one (#142)', (t) => {
  const first = rerun(t);
  const file = path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json');
  const before = fs.readFileSync(file, 'utf8');
  // The image's compose names a runtime this installer doesn't set up in an account's Docker.
  const newer = `[ "$1" = run ] && [ "$8" = /opt/bot-dot/compose.yaml ] && { printf 'services:\\n  bot-dot:\\n    runtime: runsc-next\\n'; exit 0; }`;
  const again = installer(t, { again: first, dockerFirst: [newer] });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /runtime runsc-next/);
  assert.match(again.stderr, /older than the image/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the account\'s Docker keeps its settings');
  const after = again.system.slice(first.system.length);
  assert.doesNotMatch(after, /^systemctl (restart|stop) botdot-account@ann$/m, 'its containers keep running');
  assert.ok(!again.accountCalls('ann').slice(first.accountCalls('ann').length).some((c) => /^compose .* up /.test(c)), 'nothing of the account is made again');
});

test('the runtimes compose.yaml names are the ones an account\'s Docker gets', () => {
  const named = [...fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8').matchAll(/^\s*runtime:\s*([\w.-]+)/gm)].map((m) => m[1]);
  assert.ok(named.length > 0);
  const known = /^RUNTIMES='([^']*)'/m.exec(script)[1].split(' ');
  for (const r of named) assert.ok(known.includes(r), r);
});

test('an account installed before computers kept their files gets --overlay2=none, and its Docker restarts with it (#68)', (t) => {
  const first = rerun(t);
  const file = path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(', "--overlay2=none"', ''));
  const again = installer(t, { again: first });
  assert.equal(again.status, 0, again.stderr);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).runtimes.runsc.runtimeArgs.includes('--overlay2=none'));
  assert.match(again.system.slice(first.system.length), /^systemctl restart botdot-account@ann$/m, 'its computers keep their files from their next start');
});

test("the machine's and every account's Docker keep containers' logs to a fixed size, and the machine's restarts once for it (#980)", (t) => {
  const first = rerun(t);
  assert.deepEqual(logsOf(JSON.parse(fs.readFileSync(path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json'), 'utf8'))), LOGS);
  assert.deepEqual(JSON.parse(fs.readFileSync(machineDaemon(first), 'utf8')), LOGS);
  assert.equal(fs.statSync(machineDaemon(first)).mode & 0o777, 0o644);
  assert.equal(first.system.match(/^systemctl restart docker$/gm).length, 1);
  assert.ok(first.system.indexOf('systemctl restart docker') < first.system.indexOf('useradd'), 'before anything of botdot runs in it');
  const again = installer(t, { again: first });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.system.slice(first.system.length), /^systemctl restart docker$/m, 'a rerun leaves it running');
});
