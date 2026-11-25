// install.sh on a stand-in machine (test/installer-helpers.js): a first install, botdot's signed images, and what
// the installer tells a stranger. The other installer tests are in installer-*.test.js, so that they run side by side.
// Part 2 of 3 of the install tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
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

test('a local install is one account on localhost, made with a setup key, for the desktop app alone (#882)', (t) => {
  const done = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /How will people reach|The domain botdot|account's name/, 'it asks nothing');
  assert.equal(done.env.BOT_DOT_REACH, 'local');
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'http://localhost:4700', 'a passkey can belong to localhost');
  assert.equal(done.env.FRONT_DOOR_PORT, '4700');
  assert.equal(done.env.FRONT_DOOR_SITES_ORIGIN, 'http://localhost:4701', "bots' interactive pages on an origin of their own");
  assert.equal(done.env.FRONT_DOOR_SITES_PORT, '4701');
  assert.equal(done.env.FRONT_DOOR_ADMIN, 'owner');
  assert.equal(done.env.FRONT_DOOR_ONE_ACCOUNT, 'owner', 'the front door holds this one account');
  const key = done.env.FRONT_DOOR_SETUP_KEY;
  assert.match(key, /^[0-9a-f]{64}$/, 'a setup key the front door takes (32 to 100 base64url characters)');
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', '.env')).mode & 0o777, 0o600, 'kept where only root reads it');
  assert.equal(done.env.COMPOSE_PROFILES, '', 'no Caddy');
  assert.equal(done.read('front-door/Caddyfile'), '');
  assert.doesNotMatch(done.system, /^tailscale/m, 'no Tailscale');
  assert.ok(!done.calls.some((c) => /sign-up-link/.test(c)), 'no sign-up link is made');
  assert.doesNotMatch(done.said, /admin page|Whoever has full control/);
  assert.ok(fs.existsSync(path.join(done.dir, 'accounts', 'owner', 'compose.yaml')), "the account's botdot server is made");
  assert.match(done.system, /^curl -fsS -o \/dev\/null -H Host: localhost:4700 http:\/\/127\.0\.0\.1:4700\/api\/version$/m);
  const lines = done.said.trim().split('\n');
  assert.match(lines.at(-1), /^BOTDOT_READY \{"origin":"http:\/\/localhost:4700","version":"[0-9a-f]*","reach":"local","accounts":\["owner"\]\}$/, 'the last line is the one for a program, without the key (#981)');
  assert.equal(lines.at(-2), `BOTDOT_LOCAL {"origin":"http://localhost:4700","signUp":"http://localhost:4700/sign-up/${key}"}`, "the last line is the app's");
  assert.equal(done.said.split(key).length, 2, 'the key is on the screen in that line alone');
  assert.deepEqual(JSON.parse(lines.at(-2).slice('BOTDOT_LOCAL '.length)), { origin: 'http://localhost:4700', signUp: `http://localhost:4700/sign-up/${key}` });

  // A rerun keeps the address, the key and the account; once the account exists its line has no sign-up address.
  const dotenv = fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8');
  fs.writeFileSync(path.join(done.dir, 'front-door', 'data', 'front-door.json'), JSON.stringify({ accounts: { owner: { created: '2026-11-02T12:00:00.000Z', userId: 'u' } }, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} }));
  const again = installer(t, { dotenv, again: done, given: { BOT_DOT_REACH: 'tailnet', BOT_DOT_PORT: '5000' } });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.equal(again.env.BOT_DOT_REACH, 'local', 'how it is reached is chosen once');
  assert.equal(again.env.FRONT_DOOR_ORIGIN, 'http://localhost:4700', 'and its address, which its passkey belongs to');
  assert.equal(again.env.FRONT_DOOR_SETUP_KEY, key);
  assert.equal(again.said.trim().split('\n').at(-2), 'BOTDOT_LOCAL {"origin":"http://localhost:4700"}');

  const port = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_PORT: '5100', BOT_DOT_ADMIN: 'bart' } });
  assert.equal(port.status, 0, port.stderr);
  assert.equal(port.env.FRONT_DOOR_ORIGIN, 'http://localhost:5100');
  assert.equal(port.env.FRONT_DOOR_SITES_ORIGIN, 'http://localhost:5101');
  assert.equal(port.env.FRONT_DOOR_ONE_ACCOUNT, 'bart');
  assert.match(port.said, /BOTDOT_LOCAL \{"origin":"http:\/\/localhost:5100","signUp":"http:\/\/localhost:5100\/sign-up\/[0-9a-f]{64}"\}\nBOTDOT_READY \{"origin":"http:\/\/localhost:5100",[^\n]*"accounts":\["bart"\]\}\n$/);

  const bad = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_PORT: '80' } });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /BOT_DOT_PORT: a port is a number from 1024 to 65534\./);
});

test('a local install keeps the VM from the computer it runs on and its network, and a server has no such rules (#887)', (t) => {
  const done = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' }, systemd: true });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const rules = fs.readFileSync(path.join(done.dir, 'bin', 'local-firewall.sh'), 'utf8');
  assert.match(rules, /-m conntrack ! --ctstate NEW -j RETURN/, 'what the VM answers stays open: the port forward and limactl shell');
  for (const net of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', '198.18.0.0/15']) assert.ok(rules.includes(net), net);
  assert.ok(rules.indexOf('--dport 53') < rules.indexOf('-j REJECT'), 'the DNS on the gateway stays open');
  assert.ok(rules.indexOf('docker+') < rules.indexOf('-j REJECT'), "and this machine's own Docker");
  assert.match(done.system, /^systemctl enable botdot-local-firewall$/m, 'it comes back with a restart');
  assert.match(done.system, /^systemctl restart botdot-local-firewall$/m);
  assert.match(done.said, /This VM can't reach the computer it runs on/);

  const noSystemd = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local' }, systemd: false });
  assert.match(noSystemd.system, /^iptables -A BOTDOT-LOCAL -d 192\.168\.0\.0\/16 -j REJECT$/m, 'without systemd the rules go in at once');

  const server = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com', BOT_DOT_ADMIN: 'ann' } });
  assert.equal(server.status, 0, server.stderr);
  assert.ok(!fs.existsSync(path.join(server.dir, 'bin', 'local-firewall.sh')));
  assert.doesNotMatch(server.system, /local-firewall|^iptables/m);
});

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

test("the admin's own Docker settings are kept: the limits join them, and a log driver the admin chose stays (#980)", (t) => {
  const first = rerun(t);
  fs.writeFileSync(machineDaemon(first), '{\n  "registry-mirrors": ["https://mirror.example.com"]\n}\n');
  const joined = installer(t, { again: first });
  assert.equal(joined.status, 0, joined.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(machineDaemon(first), 'utf8')), { ...LOGS, 'registry-mirrors': ['https://mirror.example.com'] });
  assert.match(joined.system.slice(first.system.length), /^systemctl restart docker$/m);
  const own = '{ "log-driver": "journald" }\n';
  fs.writeFileSync(machineDaemon(first), own);
  const kept = installer(t, { again: joined });
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(fs.readFileSync(machineDaemon(first), 'utf8'), own);
  assert.doesNotMatch(kept.system.slice(joined.system.length), /^systemctl restart docker$/m);
});

test('an update of a machine installed before log limits gives them to its Docker and every account\'s, each restarted once (#980)', (t) => {
  const first = rerun(t);
  const account = path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json');
  const before = JSON.parse(fs.readFileSync(account, 'utf8'));
  delete before['log-driver'];
  delete before['log-opts'];
  fs.writeFileSync(account, JSON.stringify(before, null, 2));
  fs.rmSync(machineDaemon(first));
  const update = installer(t, { again: first, args: ['--update'] });
  assert.equal(update.status, 0, `${update.said}\n${update.stderr}`);
  assert.deepEqual(logsOf(JSON.parse(fs.readFileSync(account, 'utf8'))), LOGS);
  assert.deepEqual(JSON.parse(fs.readFileSync(machineDaemon(first), 'utf8')), LOGS);
  const after = update.system.slice(first.system.length);
  assert.equal(after.match(/^systemctl restart docker$/gm).length, 1);
  assert.equal(after.match(/^systemctl restart botdot-account@ann$/gm).length, 1);
});

test("without systemd the machine's Docker gets its log limits in its settings, and the installer says they apply after its restart (#980)", (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(machineDaemon(done), 'utf8')), LOGS);
  assert.doesNotMatch(done.system, /^systemctl restart docker$/m);
  assert.match(done.said + done.stderr, /only after it next restarts/);
});

test('without systemd the account\'s Docker is started now, as its own user, and the installer says it won\'t come back by itself', (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  assert.match(done.system, /^su -s \/bin\/sh botdot-ann -c cd '.+\/accounts\/ann' && exec env HOME='.+\/accounts\/ann' XDG_RUNTIME_DIR='.+\/run\/ann' PATH=\S+ nohup '.+\/dockerd-rootless\.sh' >> '.+\/accounts\/ann\/docker\.log' 2>&1 &$/m);
  assert.doesNotMatch(done.system, /^systemctl (enable|start|restart)/m);
  assert.match(done.said, /This machine has no systemd, so the account ann's Docker was started now and doesn't start again after a restart\./);
});

test('the install prints the admin\'s sign-up link, after it says that full control of the machine reaches every account', (t) => {
  const done = rerun(t);
  const root = done.said.indexOf('Whoever has full control of this machine can reach every account on it: its data, its bots and the logins they hold. Keep that control to yourself.');
  const link = done.said.indexOf('\n  https://botdot.example.com/sign-up/T0KEN\n');
  assert.ok(root > 0 && link > root, done.said);
  assert.ok(done.calls.includes(`compose --project-directory ${done.dir}/front-door exec -T front-door node front-door.js sign-up-link --account ann`));
  assert.match(done.said, /Done\. botdot is at https:\/\/botdot\.example\.com\u001b\[0m\nOpen this link to make your account, ann, the admin's \(it works once, for 7 days\):\n/);
  assert.match(done.said, /Until it is used, botdot shows only "Open the link from your server's install"\./);

  const made = rerun(t, '', {}, { exists: true });
  assert.doesNotMatch(made.said, /\/sign-up\/|Open this link/, 'once the account exists there is no link');
  assert.match(made.said, /Whoever has full control of this machine can reach every account/, 'and the warning stays');
});

test('a machine without rootless Docker, gVisor or setfacl is offered them, and told what they are', (t) => {
  const missing = { 'dockerd-rootless.sh': null, runsc: null, setfacl: null };
  const declined = installer(t, { bins: missing, input: 'n\n', given: { STAND_IN_PACKAGES: 'docker-ce' } });
  assert.equal(declined.status, 1);
  assert.match(declined.said, /Each account runs in a rootless Docker under gVisor, which needs: docker-ce-rootless-extras acl runsc/);
  assert.match(declined.said, /Install them now with apt-get \(gVisor's runsc from gVisor's own repository\)\?/);
  assert.match(declined.stderr, /botdot needs them\. Install them and run this again\./);
  assert.doesNotMatch(declined.system, /apt-get/);

  const agreed = installer(t, { bins: { ...missing, dpkg: '#!/bin/sh\necho amd64\n' }, input: 'y\n', given: { STAND_IN_PACKAGES: 'docker-ce' } });
  assert.match(agreed.system, /^apt-get install -y -qq docker-ce-rootless-extras acl runsc=20261102\.0$/m, 'gVisor at its pinned release');
  assert.equal(fs.readFileSync(path.join(agreed.etc, 'apt', 'sources.list.d', 'gvisor.list'), 'utf8'),
    'deb [arch=amd64 signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases 20261102 main\n',
    "gVisor's source names the release, not the moving channel");
});

test("an update moves gVisor's apt source off the moving channel, and names a runsc of another release", (t) => {
  const first = rerun(t);
  assert.doesNotMatch(first.said + first.stderr, /botdot is tested with/, 'the pinned runsc is not named');
  const list = path.join(first.etc, 'apt', 'sources.list.d', 'gvisor.list');
  fs.mkdirSync(path.dirname(list), { recursive: true });
  fs.writeFileSync(list, 'deb [arch=arm64 signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases release main\n');
  const done = installer(t, { again: first, args: ['--update'], bins: { runsc: '#!/bin/sh\necho "runsc version release-20261005.0"\n' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(fs.readFileSync(list, 'utf8'), 'deb [arch=arm64 signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases 20261102 main\n');
  assert.match(done.said, /gVisor's apt source now holds release 20261102\.0/);
  assert.match(done.said + done.stderr, /gVisor 20261005\.0 is installed; botdot is tested with 20261102\.0\. Once no account is busy: sudo apt-get update && sudo apt-get install --allow-downgrades runsc=20261102\.0/);
  assert.doesNotMatch(done.system, /^apt-get/m, 'runsc is not replaced under running sandboxes');

  const again = installer(t, { again: first, args: ['--update'] });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.doesNotMatch(again.said + again.stderr, /gVisor's apt source now holds|botdot is tested with/, 'once pinned, nothing more is said');
});
